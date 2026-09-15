function headers(key, extra={}) {
  return {
    apikey:key,
    Authorization:`Bearer ${key}`,
    "Content-Type":"application/json",
    ...extra
  };
}

function hydrate(row) {
  return {
    ...row.data,
    id:row.id,
    numero:row.numero,
    folioInterno:row.folio_interno,
    creadaEn:row.creada_en || row.data?.creadaEn
  };
}

export class SupabaseFacturaRepository {
  constructor({url,serviceRoleKey}) {
    this.base=`${String(url).replace(/\/$/,"")}/rest/v1/facturas`;
    this.key=serviceRoleKey;
  }

  async request(url,options={}) {
    const response=await fetch(url,{...options,headers:headers(this.key,options.headers)});
    const text=await response.text();
    const data=text?JSON.parse(text):null;
    if(!response.ok) throw new Error(data?.message || data?.error || "No fue posible guardar la factura en Supabase");
    return data;
  }

  async list() {
    const rows=await this.request(`${this.base}?select=id,numero,folio_interno,creada_en,data&order=creada_en.desc`);
    return rows.map(hydrate);
  }

  async save(factura) {
    const rows=await this.request(`${this.base}?select=id,numero,folio_interno,creada_en,data`,{
      method:"POST",
      headers:{Prefer:"return=representation"},
      body:JSON.stringify({id:factura.id,data:factura})
    });
    return hydrate(rows[0]);
  }

  async findById(id) {
    const rows=await this.request(`${this.base}?id=eq.${encodeURIComponent(id)}&select=id,numero,folio_interno,creada_en,data&limit=1`);
    return rows.length?hydrate(rows[0]):null;
  }

  async update(id,patch) {
    const current=await this.findById(id);
    if(!current) return null;
    const data={...current,...patch};
    delete data.numero;
    delete data.folioInterno;
    const rows=await this.request(`${this.base}?id=eq.${encodeURIComponent(id)}&select=id,numero,folio_interno,creada_en,data`,{
      method:"PATCH",
      headers:{Prefer:"return=representation"},
      body:JSON.stringify({data})
    });
    return rows.length?hydrate(rows[0]):null;
  }
}

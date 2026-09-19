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
    this.root=String(url).replace(/\/$/,"");
    this.base=`${this.root}/rest/v1/facturas`;
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

  async page({q="",desde=null,hasta=null,origen="",estatus="",sync="",page=1,pageSize=25}={}){
    const limite=Math.min(Math.max(Number(pageSize)||25,1),5000),pagina=Math.max(Number(page)||1,1);
    const rows=await this.request(`${this.root}/rest/v1/rpc/facturas_historial_paginado`,{method:"POST",body:JSON.stringify({p_q:String(q).trim(),p_desde:desde||null,p_hasta:hasta||null,p_origen:origen||"",p_estatus:estatus||"",p_sync:sync||"",p_limit:limite,p_offset:(pagina-1)*limite})});
    return{items:rows.map(hydrate),total:Number(rows[0]?.total_registros||0),page:pagina,pageSize:limite};
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

  async findByFolioOrigen(folio) {
    const key=String(folio||"").trim();
    if(!key)return null;
    const rows=await this.request(`${this.base}?folio_origen=eq.${encodeURIComponent(key)}&select=id,numero,folio_interno,creada_en,data`);
    return rows.map(hydrate).find(f=>!String(f.estatus||"").startsWith("CANCELADA"))||null;
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

  async delete(id) {
    await this.request(`${this.base}?id=eq.${encodeURIComponent(id)}`,{method:"DELETE"});
    return true;
  }
}

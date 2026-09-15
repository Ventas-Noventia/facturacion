function headers(key,extra={}){
  return {
    apikey:key,
    Authorization:`Bearer ${key}`,
    "Content-Type":"application/json",
    ...extra
  };
}

function mapRow(row){
  return {
    id:row.id,
    tipoPersona:row.tipo_persona,
    razonSocial:row.razon_social,
    rfc:row.rfc,
    codigoPostal:row.codigo_postal,
    regimenFiscal:row.regimen_fiscal,
    usoCfdi:row.uso_cfdi,
    email:row.email||"",
    activo:row.activo,
    creadoEn:row.creado_en,
    actualizadoEn:row.actualizado_en
  };
}

export class SupabaseClienteFiscalRepository{
  constructor({url,serviceRoleKey}){
    this.base=`${String(url).replace(/\/$/,"")}/rest/v1/clientes_fiscales`;
    this.key=serviceRoleKey;
  }

  async request(url,options={}){
    const response=await fetch(url,{...options,headers:headers(this.key,options.headers)});
    const text=await response.text();
    const data=text?JSON.parse(text):null;
    if(!response.ok){
      if(response.status===409 || data?.code==="23505"){
        const error=new Error("Ya existe un cliente fiscal registrado con ese RFC");
        error.code="RFC_DUPLICADO";
        throw error;
      }
      throw new Error(data?.message||data?.error||"No fue posible guardar el cliente fiscal en Supabase");
    }
    return data;
  }

  async list(){
    const rows=await this.request(`${this.base}?select=*&activo=eq.true&order=razon_social.asc`);
    return rows.map(mapRow);
  }

  async search(q=""){
    const query=String(q).trim().toLowerCase();
    const data=await this.list();
    if(!query) return data;
    return data.filter(c=>`${c.razonSocial} ${c.rfc} ${c.email}`.toLowerCase().includes(query));
  }

  async save(input){
    const record={
      tipo_persona:input.tipoPersona,
      razon_social:String(input.razonSocial||"").trim().toUpperCase(),
      rfc:String(input.rfc||"").trim().toUpperCase(),
      codigo_postal:String(input.codigoPostal||"").trim(),
      regimen_fiscal:String(input.regimenFiscal||"").trim(),
      uso_cfdi:String(input.usoCfdi||"").trim(),
      email:String(input.email||"").trim().toLowerCase(),
      activo:true
    };
    const rows=await this.request(`${this.base}?select=*`,{
      method:"POST",
      headers:{Prefer:"return=representation"},
      body:JSON.stringify(record)
    });
    return mapRow(rows[0]);
  }
}

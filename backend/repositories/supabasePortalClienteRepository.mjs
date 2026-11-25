function headers(key,extra={}){
  return{apikey:key,Authorization:`Bearer ${key}`,"Content-Type":"application/json",...extra};
}

function map(row){
  if(!row)return null;
  return{
    userId:row.user_id,email:row.email||"",telefono:row.telefono||"",nombre:row.nombre||"",
    tipoPersona:row.tipo_persona||"FISICA",razonSocial:row.razon_social||"",rfc:row.rfc||"",
    codigoPostal:row.codigo_postal||"",regimenFiscal:row.regimen_fiscal||"",usoCfdi:row.uso_cfdi||"G03",
    avisoVersion:row.aviso_version||"",avisoAceptadoEn:row.aviso_aceptado_en||null,activo:row.activo!==false
  };
}

export class SupabasePortalClienteRepository{
  constructor({url,serviceRoleKey}){
    this.base=`${String(url).replace(/\/$/,"")}/rest/v1/portal_clientes`;
    this.key=serviceRoleKey;
  }
  async request(query,options={}){
    const response=await fetch(`${this.base}${query}`,{...options,headers:headers(this.key,options.headers)});
    const text=await response.text();
    const data=text?JSON.parse(text):null;
    if(!response.ok)throw new Error(data?.message||data?.error||"No fue posible guardar el perfil del cliente");
    return data;
  }
  async findById(userId){
    const rows=await this.request(`?user_id=eq.${encodeURIComponent(userId)}&select=*&limit=1`);
    return map(rows[0]);
  }
  async save(userId,input,soloCrear=false){
    const record={
      user_id:userId,email:String(input.email||"").trim().toLowerCase(),telefono:String(input.telefono||"").replace(/\D/g,""),
      nombre:String(input.nombre||input.razonSocial||"").trim(),tipo_persona:input.tipoPersona||"FISICA",
      razon_social:String(input.razonSocial||input.nombre||"").trim().toUpperCase(),rfc:String(input.rfc||"").trim().toUpperCase(),
      codigo_postal:String(input.codigoPostal||"").trim(),regimen_fiscal:String(input.regimenFiscal||"").trim(),
      uso_cfdi:String(input.usoCfdi||"G03"),aviso_version:String(input.avisoVersion||""),
      aviso_aceptado_en:input.avisoAceptadoEn||null,activo:true,actualizado_en:new Date().toISOString()
    };
    const rows=await this.request("?on_conflict=user_id&select=*",{method:"POST",headers:{Prefer:soloCrear?"resolution=ignore-duplicates,return=representation":"resolution=merge-duplicates,return=representation"},body:JSON.stringify(record)});
    if(soloCrear && !rows?.length)return this.findById(userId);
    return map(rows[0]);
  }
}

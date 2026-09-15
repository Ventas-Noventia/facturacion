function map(row){return row?{id:row.id,razonSocial:row.razon_social,rfc:row.rfc,regimenFiscal:row.regimen_fiscal,codigoPostal:row.codigo_postal,serie:row.serie,versionCfdi:row.version_cfdi,exportacion:row.exportacion,pacProveedor:row.pac_proveedor,ambiente:row.ambiente,actualizadoEn:row.actualizado_en}:null}

export class SupabaseConfiguracionFiscalRepository{
  constructor({url,serviceRoleKey}){this.base=`${String(url).replace(/\/$/,"")}/rest/v1/configuracion_fiscal`;this.key=serviceRoleKey}
  headers(extra={}){return{apikey:this.key,Authorization:`Bearer ${this.key}`,"Content-Type":"application/json",...extra}}
  async request(url,options={}){const response=await fetch(url,{...options,headers:this.headers(options.headers)});const text=await response.text();const data=text?JSON.parse(text):null;if(!response.ok)throw new Error(data?.message||"No fue posible guardar la configuración fiscal");return data}
  async get(){const rows=await this.request(`${this.base}?id=eq.principal&select=*&limit=1`);return map(rows[0])}
  async save(input){
    const record={id:"principal",razon_social:String(input.razonSocial||"").trim().toUpperCase(),rfc:String(input.rfc||"").trim().toUpperCase(),regimen_fiscal:String(input.regimenFiscal||"").trim(),codigo_postal:String(input.codigoPostal||"").trim(),serie:String(input.serie||"F").trim().toUpperCase(),version_cfdi:"4.0",exportacion:String(input.exportacion||"01"),pac_proveedor:String(input.pacProveedor||"PENDIENTE").trim().toUpperCase(),ambiente:String(input.ambiente||"PRUEBAS").toUpperCase(),actualizado_en:new Date().toISOString()};
    const rows=await this.request(`${this.base}?on_conflict=id&select=*`,{method:"POST",headers:{Prefer:"resolution=merge-duplicates,return=representation"},body:JSON.stringify(record)});return map(rows[0]);
  }
}

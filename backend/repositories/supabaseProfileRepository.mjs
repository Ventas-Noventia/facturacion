function headers(key){return{apikey:key,Authorization:`Bearer ${key}`}}
function map(row){return{id:row.id,nombre:row.nombre,email:row.email,rol:row.rol,activo:row.activo,creadoEn:row.creado_en}}

export class SupabaseProfileRepository{
  constructor({url,serviceRoleKey}){
    this.base=`${String(url).replace(/\/$/,"")}/rest/v1/profiles`;
    this.key=serviceRoleKey;
  }
  async request(query){
    const response=await fetch(`${this.base}${query}`,{headers:headers(this.key)});
    const text=await response.text();
    const data=text?JSON.parse(text):null;
    if(!response.ok)throw new Error(data?.message||"No fue posible consultar el perfil");
    return data;
  }
  async findById(id){
    const rows=await this.request(`?id=eq.${encodeURIComponent(id)}&select=*&limit=1`);
    return rows.length?map(rows[0]):null;
  }
  async list(){
    return (await this.request("?select=*&order=nombre.asc")).map(map);
  }
}

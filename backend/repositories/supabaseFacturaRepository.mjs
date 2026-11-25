import { randomUUID } from "node:crypto";
import { FacturaDuplicadaError } from "./facturaDuplicadaError.mjs";
import { SupabaseFacturaError } from "./supabaseFacturaError.mjs";

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
    const controller = new AbortController(), timer = setTimeout(() => controller.abort(), 15000);
    let response, text;
    try {
      response=await fetch(url,{...options,headers:headers(this.key,options.headers),signal:controller.signal});
      text=await response.text();
    } catch { throw new SupabaseFacturaError({network:true}); }
    finally { clearTimeout(timer); }
    let data;
    try { data=text?JSON.parse(text):null; }
    catch { throw new SupabaseFacturaError({status:response.status,invalidResponse:true}); }
    if (!response.ok && data?.code === "23505") throw new FacturaDuplicadaError();
    if(!response.ok) throw new SupabaseFacturaError({code:data?.code,status:response.status,remoteMessage:data?.message});
    return data;
  }

  async list() {
    const rows=await this.request(`${this.base}?select=id,numero,folio_interno,creada_en,data&order=creada_en.desc`);
    return rows.map(hydrate);
  }

  async listByPortalClienteId(userId) {
    if (!userId) return [];
    const query = new URLSearchParams({
      "data->>portalClienteId": `eq.${userId}`,
      select: "id,numero,folio_interno,creada_en,data",
      order: "creada_en.desc"
    });
    const rows = await this.request(`${this.base}?${query}`);
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
      body:JSON.stringify({id:factura.id,data:{...factura,revision:randomUUID()}})
    });
    if (!Array.isArray(rows) || !rows[0]?.id || !rows[0]?.data) throw new SupabaseFacturaError({invalidResponse:true});
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

  async findByEcommerceId(id) {
    const query = new URLSearchParams({
      "data->pedido->>ecommerceId": `eq.${id}`,
      "data->pedido->>fuente": "eq.ECOMMERCE_API",
      select: "id,numero,folio_interno,creada_en,data"
    });
    const rows = await this.request(`${this.base}?${query}`);
    return rows.map(hydrate).find(f => !String(f.estatus || "").startsWith("CANCELADA")) || null;
  }

  condition(expected) {
    const query = new URLSearchParams({id: `eq.${expected.id}`, "data->>estatus": `eq.${expected.estatus}`,
      "data->>revision": expected.revision ? `eq.${expected.revision}` : "is.null", select: "id,numero,folio_interno,creada_en,data"});
    return query;
  }

  async compareAndUpdate(expected, patch) {
    const data = {...expected,...patch,revision:randomUUID()};
    delete data.numero; delete data.folioInterno;
    const rows = await this.request(`${this.base}?${this.condition(expected)}`, {
      method: "PATCH", headers: {Prefer: "return=representation"}, body: JSON.stringify({data})
    });
    return rows.length ? hydrate(rows[0]) : null;
  }

  async update(id,patch) {
    const current = await this.findById(id);
    if (!current) return null;
    const updated = await this.compareAndUpdate(current,patch);
    if (!updated) {
      const error = new Error("La factura cambió durante la operación. Actualiza el historial.");
      error.statusCode = 409; throw error;
    }
    return updated;
  }

  async delete(id, expected = null) {
    const query = expected ? this.condition(expected) : new URLSearchParams({id:`eq.${id}`});
    const rows = await this.request(`${this.base}?${query}`,{method:"DELETE",headers:{Prefer:"return=representation"}});
    return !expected || rows.length > 0;
  }
}

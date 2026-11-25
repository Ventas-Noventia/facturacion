import {normalizarSku} from '../../shared/domain/catalogoFiscal.mjs';
export async function completarPedidoFiscal(pedido,repo){
 if(!pedido || !Array.isArray(pedido.productos))return pedido;
 let rows;try{rows=await repo.buscarSkus(pedido.productos.map(p=>p.sku||p.clave));}catch(e){if(!e.migracionPendiente)throw e;return {...pedido,avisoCatalogo:e.message};}
 const map=new Map(rows.map(r=>[r.sku,r]));
 return {...pedido,productos:pedido.productos.map(p=>{const saved=map.get(normalizarSku(p.sku||p.clave));return saved?{...p,titulo:saved.titulo,nombre:saved.titulo,descripcion:saved.titulo,claveProdServSat:saved.claveProdServSat,claveUnidad:saved.claveUnidad,unidad:saved.unidad,origenDatosFiscales:'CATALOGO'}:{...p,origenDatosFiscales:p.claveProdServSat?'PEDIDO_O_SUGERENCIA':'PENDIENTE'};})};
}

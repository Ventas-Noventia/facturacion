import test from "node:test";
import assert from "node:assert/strict";
import { iniciarServidorVentaPrueba, barreraPrueba } from "./fixtures/ventaServidor.mjs";
import { FacturamaProduccionService, solicitudProduccion, verificarXmlProduccion } from "../backend/services/facturamaProduccionService.mjs";
import { configuracionTimbrado } from "../backend/config/timbrado.mjs";
import { crearFactura } from "../shared/domain/factura.mjs";
import { pedidoProduccion, conceptosPedidoProduccion, pedidoCoincideProduccion } from "../backend/services/pedidoProduccionService.mjs";
import { FirebaseJsonService } from "../backend/services/firebaseJsonService.mjs";
import { huellaSolicitud } from "../backend/services/huellaSandbox.mjs";

const cliente={tipoPersona:"MORAL",razonSocial:"RECEPTOR REAL SINTETICO",rfc:"BBB010101BB1",codigoPostal:"53490",regimenFiscal:"601"};
const datos={folioOrigen:"1842",origen:"MANUAL",formaPago:"03",metodoPago:"PUE",usoCfdi:"G03",cliente,
  conceptos:[1,2,"envio-1842"].map(orderItemId=>({orderItemId,claveProdServSat:"01010101"}))};
const emisor={razonSocial:"EMISOR REAL SINTETICO",rfc:"AAA010101AAA",codigoPostal:"53490",regimenFiscal:"601",serie:"NV",ambiente:"PRODUCCION",exportacion:"01",versionCfdi:"4.0"};
const request=app=>(url,{method="POST",data,token="admin-session"}={})=>fetch(app.baseUrl+url,{method,headers:{Cookie:`facturacion_access=${token}`,"Content-Type":"application/json"},...(data?{body:JSON.stringify(data)}:{})});
const posts=app=>app.state.requests.filter(r=>r.pathname==="/fake-facturama-produccion/api-lite/4/cfdis"&&r.method==="POST").length;
const deletes=app=>app.state.requests.filter(r=>r.pathname.startsWith("/fake-facturama-produccion/")&&r.method==="DELETE").length;
async function context(t,options={}){
  const app=await iniciarServidorVentaPrueba({produccion:true,...options});t.after(()=>app.cerrar());
  return {app,call:request(app)};
}
async function draft(c,input=datos){const response=await c.call("/api/facturas",{data:input});assert.equal(response.status,201,JSON.stringify(await response.clone().json()));return response.json();}
async function issued(c){const f=await draft(c),r=await c.call(`/api/facturas/${f.id}/timbrar`);assert.equal(r.status,200,JSON.stringify(await r.clone().json()));return r.json();}

test("producción exige activación explícita, RFC propio, HTTPS fijo y credenciales separadas",async()=>{
  assert.throws(()=>configuracionTimbrado({TIMBRADO_PROVIDER:"facturama_produccion",FACTURAMA_PRODUCTION_ENABLED:"false"}));
  for(const baseUrl of ["https://apisandbox.facturama.mx","http://api.facturama.mx","https://u:p@api.facturama.mx","https://api.facturama.mx/?a=b"])
    assert.throws(()=>new FacturamaProduccionService({username:"fake",password:"secret",rfc:emisor.rfc,baseUrl}));
  for(const rfc of ["XAXX010101000","EKU9003173C9",""])assert.throws(()=>new FacturamaProduccionService({username:"fake",password:"secret",rfc}));
  const calls=[],api=new FacturamaProduccionService({username:"fake-prod",password:"secret-prod",rfc:emisor.rfc,fetchImpl:async(u,o)=>{calls.push([u,o]);return Response.json({})}});
  await api.consultar("TEST-ID");assert.equal(calls[0][0],"https://api.facturama.mx/api-lite/cfdis/TEST-ID");assert.equal(calls[0][1].redirect,"error");
  assert.equal(calls[0][1].headers.Authorization,`Basic ${Buffer.from("fake-prod:secret-prod").toString("base64")}`);
  await assert.rejects(api.crear({Issuer:{Rfc:emisor.rfc}}),/deshabilitadas/);assert.equal(calls.length,1);assert.doesNotMatch(JSON.stringify(api),/secret-prod|Basic/);
});

test("la solicitud productiva usa identidades reales y exige clave SAT explícita, PUE y un borrador nuevo",()=>{
  const f={...crearFactura({...datos,conceptos:[{descripcion:"Compra",cantidad:1,precioUnitario:100,unidad:"Pieza",claveUnidad:"H87",claveProdServSat:"01010101"}]}),ambienteOperacion:"PRODUCCION"};
  const p=solicitudProduccion(f,emisor);
  assert.equal(p.Issuer.Rfc,emisor.rfc);assert.equal(p.Issuer.Name,emisor.razonSocial);assert.equal(p.Receiver.Rfc,cliente.rfc);assert.equal(p.Receiver.Name,cliente.razonSocial);assert.equal(p.Serie,"NV");assert.ok(!Object.hasOwn(p,"OrderNumber"));assert.doesNotMatch(JSON.stringify(p),/EKU9003173C9|URE180429TM6|PRUEBA SANDBOX|NVSB/);
  for(const patch of [{ambienteOperacion:"SANDBOX"},{ambienteOperacion:undefined},{cliente:{...cliente,rfc:"XAXX010101000"}},{metodoPago:"PPD",formaPago:"99"},{conceptos:f.conceptos.map(c=>({...c,claveProdServSat:""}))},{total:1}])assert.throws(()=>solicitudProduccion({...f,...patch},emisor));
  for(const patch of [{ambiente:"PRUEBAS"},{serie:"NVSB"},{exportacion:"02"}])assert.throws(()=>solicitudProduccion(f,{...emisor,...patch}));
});

test("verificación productiva en Sandbox solo consulta cuenta/CSD y no expone certificados ni claves",async t=>{
  const c=await context(t,{produccion:false,sandbox:true,conProduccion:true});c.app.state.fiscal.ambiente="PRODUCCION";
  const r=await c.call("/api/timbrado/produccion/estado",{method:"GET"}),data=await r.json();
  assert.equal(r.status,200);assert.equal(data.ok,true);assert.equal(data.emisionHabilitada,false);assert.equal(data.cuenta.folios,100);assert.equal(data.csd.rfc,emisor.rfc);assert.equal(posts(c.app),0);
  assert.doesNotMatch(JSON.stringify(data),/Certificate|PrivateKey|Basic|FAKE-PROD-PASS|SECRETO/);
  c.app.state.failCsd=true;const missing=await(await c.call("/api/timbrado/produccion/estado",{method:"GET"})).json();assert.equal(missing.ok,false);assert.equal(posts(c.app),0);
  assert.equal((await c.call("/api/timbrado/produccion/estado",{method:"GET",token:"view-session"})).status,403);
});

test("HTTP real: conserva cupón/envío/IVA dentro de 1449, guarda primero la operación y entrega XML/PDF originales",async t=>{
  const c=await context(t),gate=barreraPrueba();t.after(()=>gate.release());c.app.state.beforeFacturama=gate.wait;
  const f=await draft(c,{...datos,ambienteOperacion:"MOCK",conceptos:datos.conceptos.map(p=>({...p,cantidad:999,precioUnitario:1}))});assert.equal(f.ambienteOperacion,"PRODUCCION");assert.equal(f.total,1449);
  const sending=c.call(`/api/facturas/${f.id}/timbrar`);await gate.entered;
  assert.equal(c.app.state.rows[0].data.estatus,"TIMBRANDO_PRODUCCION");assert.equal(c.app.state.rows[0].data.timbradoProduccion.estado,"ENVIADO");
  assert.equal((await c.call(`/api/facturas/${f.id}/timbrar`)).status,409);gate.release();
  const result=await sending;assert.equal(result.status,200,JSON.stringify(await result.clone().json()));const done=await result.json();
  assert.equal(done.estatus,"TIMBRADA");assert.equal(done.pac,"facturama_produccion");assert.equal(done.ambienteTimbrado,"PRODUCCION");assert.equal(done.documentosPendientes,false);assert.equal(posts(c.app),1);
  const payload=c.app.state.comprobantesProduccion[0].payload;assert.equal(payload.Issuer.Rfc,emisor.rfc);assert.equal(payload.Receiver.Rfc,cliente.rfc);assert.equal(payload.Items.length,3);assert.equal(Number(payload.Items.reduce((n,c)=>n+c.Total,0).toFixed(2)),1449);
  assert.ok(done.xmlStoragePath.startsWith("produccion/"));assert.equal(c.app.state.comprobantes.length,0);
  for(const type of ["xml","pdf"]){const r=await c.call(`/api/facturas/${f.id}/documento/${type}`,{method:"GET"});assert.equal(r.status,200);assert.deepEqual(Buffer.from(await r.arrayBuffer()),c.app.state.documents.get(done[`${type}StoragePath`]));}
});

test("datos fiscales, claves SAT, CSD y emisor pendientes bloquean el POST sin alterar el borrador",async t=>{
  const c=await context(t),f=await draft(c,{...datos,conceptos:[]}),row=c.app.state.rows[0];
  assert.equal((await c.call(`/api/facturas/${f.id}/timbrar`)).status,400);assert.equal(row.data.estatus,"BORRADOR");assert.equal(posts(c.app),0);
  for(const concept of row.data.conceptos)concept.claveProdServSat="01010101";
  row.data.cliente.rfc="XAXX010101000";assert.equal((await c.call(`/api/facturas/${f.id}/timbrar`)).status,400);row.data.cliente.rfc=cliente.rfc;
  c.app.state.fiscal.ambiente="PRUEBAS";assert.equal((await c.call(`/api/facturas/${f.id}/timbrar`)).status,409);c.app.state.fiscal.ambiente="PRODUCCION";
  c.app.state.failCsd=true;assert.equal((await c.call(`/api/facturas/${f.id}/timbrar`)).status,409);assert.equal(row.data.estatus,"BORRADOR");assert.equal(posts(c.app),0);
});

test("el servidor vuelve a consultar la compra y bloquea cambios/reembolsos/PPD y facturación manual",async t=>{
  const c=await context(t),f=await draft(c);
  c.app.state.sale.data.invoice_eligibility.status="review_required";
  assert.equal((await c.call(`/api/facturas/${f.id}/timbrar`)).status,409);assert.equal(posts(c.app),0);
  c.app.state.sale.data.invoice_eligibility.status="eligible";c.app.state.sale.data.items[0].description="Cambió la compra";
  assert.equal((await c.call(`/api/facturas/${f.id}/timbrar`)).status,409);assert.equal(posts(c.app),0);
  assert.equal((await c.call("/api/facturas",{data:{...datos,folioOrigen:"MANUAL-1"}})).status,409);
});

test("una respuesta incierta se recupera por GET tras reiniciar, sin emitir un segundo CFDI",async t=>{
  const c=await context(t),f=await draft(c);c.app.state.postFacturamaIncierto=true;
  assert.equal((await c.call(`/api/facturas/${f.id}/timbrar`)).status,502);assert.equal(c.app.state.rows[0].data.estatus,"REVISION_PRODUCCION");
  c.app.state.postFacturamaIncierto=false;await c.app.reiniciar();
  const r=await c.call(`/api/facturas/${f.id}/recuperar-produccion`);assert.equal(r.status,200);assert.equal((await r.json()).estatus,"TIMBRADA");assert.equal(posts(c.app),1);
  assert.equal((await c.call(`/api/facturas/${f.id}/reintentar-produccion`)).status,409);
});

test("el reenvío real requiere ausencia completa, conserva folio/fecha y solicitud JSONB, y verifica otra vez la compra",async t=>{
  const c=await context(t),f=await draft(c);c.app.state.failFacturamaSinEmitir=true;
  assert.equal((await c.call(`/api/facturas/${f.id}/timbrar`)).status,502);const original=structuredClone(c.app.state.rows[0].data.timbradoProduccion.solicitud);
  c.app.state.failFacturamaSinEmitir=false;c.app.state.sale.data.invoice_eligibility.status="review_required";
  assert.equal((await c.call(`/api/facturas/${f.id}/reintentar-produccion`)).status,409);assert.equal(posts(c.app),1);
  c.app.state.sale.data.invoice_eligibility.status="eligible";await c.app.reiniciar();
  const r=await c.call(`/api/facturas/${f.id}/reintentar-produccion`,{data:{solicitud:{Folio:"NO_USAR"}}});assert.equal(r.status,200);assert.equal(posts(c.app),2);
  const done=await r.json();assert.deepEqual(done.timbradoProduccion.solicitud,original);assert.deepEqual(c.app.state.comprobantesProduccion[0].payload,original);
});

test("consulta fallida o huella/ambiente alterados impiden reenviar",async t=>{
  const c=await context(t),f=await draft(c);c.app.state.failFacturamaSinEmitir=true;await c.call(`/api/facturas/${f.id}/timbrar`);c.app.state.failFacturamaSinEmitir=false;
  c.app.state.failFacturamaConsulta=true;assert.equal((await c.call(`/api/facturas/${f.id}/reintentar-produccion`)).status,502);assert.equal(posts(c.app),1);c.app.state.failFacturamaConsulta=false;
  const op=c.app.state.rows[0].data.timbradoProduccion;op.solicitud.Date="2000-01-01T00:00:00";
  assert.equal((await c.call(`/api/facturas/${f.id}/reintentar-produccion`)).status,409);assert.equal(posts(c.app),1);
});

test("fallos de documentos o identidad conservan ID/UUID y no habilitan una reemisión",async t=>{
  const c=await context(t);c.app.state.failPdf=true;const f=await issued(c);assert.equal(f.documentosPendientes,true);assert.ok(f.uuid);
  assert.equal((await c.call(`/api/facturas/${f.id}/timbrar`)).status,409);c.app.state.failPdf=false;
  assert.equal((await c.call(`/api/facturas/${f.id}/recuperar-produccion`)).status,200);assert.equal(posts(c.app),1);
  const p=c.app.state.comprobantesProduccion[0].payload,xml=Buffer.from(c.app.state.comprobantesProduccion[0].xml),r={uuid:f.uuid};
  assert.equal(verificarXmlProduccion(xml,p,r,f),true);assert.throws(()=>verificarXmlProduccion(Buffer.from(xml.toString().replace(cliente.rfc,"CCC010101CC1")),p,r,f));
});

test("cancelación real pendiente conserva el pedido; consultar confirma por GET, libera y entrega acuse sin otro DELETE",async t=>{
  const c=await context(t),f=await issued(c);c.app.state.cancelacionPendiente=true;
  const r=await c.call(`/api/facturas/${f.id}/cancelar`,{data:{motivo:"02"}});assert.equal(r.status,200);assert.equal((await r.json()).estatus,"CANCELACION_PRODUCCION");assert.equal(deletes(c.app),1);
  assert.equal((await c.call("/api/facturas",{data:datos})).status,409);
  const cancel=c.app.state.requests.find(r=>r.method==="DELETE");assert.deepEqual(cancel.query,{motive:"02"});
  c.app.state.comprobantesProduccion[0].Status="cancel";await c.app.reiniciar();
  const done=await(await c.call(`/api/facturas/${f.id}/consultar-cancelacion-produccion`)).json();assert.equal(done.estatus,"CANCELADA");assert.equal(deletes(c.app),1);
  assert.equal((await c.call(`/api/facturas/${f.id}/acuse-cancelacion`,{method:"GET"})).status,200);
  assert.equal((await c.call("/api/facturas",{data:datos})).status,201);
  assert.equal((await c.call(`/api/facturas/${f.id}/recuperar-produccion`)).status,200);assert.equal(c.app.state.rows[0].data.estatus,"CANCELADA");
});

test("producción no promueve borradores de pruebas; conserva recuperación, cancelación y acuses de Sandbox con sus propios accesos",async t=>{
  const c=await context(t);c.app.state.modo="facturama_sandbox";await c.app.reiniciar();
  const f=await draft(c);assert.equal(f.ambienteOperacion,"SANDBOX");
  c.app.state.modo="facturama_produccion";await c.app.reiniciar();
  assert.equal((await c.call(`/api/facturas/${f.id}/timbrar`)).status,409);assert.equal(posts(c.app),0);
  c.app.state.modo="facturama_sandbox";await c.app.reiniciar();assert.equal((await c.call(`/api/facturas/${f.id}/timbrar`)).status,200);
  c.app.state.modo="facturama_produccion";await c.app.reiniciar();
  assert.equal((await c.call(`/api/facturas/${f.id}/recuperar-sandbox`)).status,200);
  assert.equal((await c.call(`/api/facturas/${f.id}/cancelar`,{data:{motivo:"02"}})).status,200);
  assert.equal((await c.call(`/api/facturas/${f.id}/acuse-cancelacion`,{method:"GET"})).status,200);assert.equal(posts(c.app),0);assert.equal(deletes(c.app),0);
  const real=await issued(c);assert.equal(real.ambienteTimbrado,"PRODUCCION");
  const report=await(await c.call("/api/reportes",{method:"GET"})).json();assert.equal(report.totalFacturas,1);assert.equal(report.totalFacturado,1449);
  const all=await(await c.call("/api/reportes?ambiente=TODOS",{method:"GET"})).json();assert.equal(all.totalFacturas,2);
});

test("permisos de consulta no emiten, recuperan ni cancelan documentos productivos",async t=>{
  const c=await context(t),f=await draft(c);
  for(const action of ["timbrar","recuperar-produccion","reintentar-produccion","cancelar","consultar-cancelacion-produccion"])
    assert.equal((await c.call(`/api/facturas/${f.id}/${action}`,{token:"view-session",data:{motivo:"02"}})).status,403);
  assert.equal(posts(c.app),0);assert.equal(deletes(c.app),0);
});

test("una coincidencia ambigua o un cambio del emisor bloquea el reenvío real sin reemplazar la solicitud",async t=>{
  const c=await context(t),f=await draft(c);c.app.state.failFacturamaSinEmitir=true;
  await c.call(`/api/facturas/${f.id}/timbrar`);c.app.state.failFacturamaSinEmitir=false;
  const original=structuredClone(c.app.state.rows[0].data.timbradoProduccion.solicitud);
  c.app.state.resultadoFacturamaAmbiguo={Id:"OTRO",Folio:"OTRO",Serie:"NV"};
  assert.equal((await c.call(`/api/facturas/${f.id}/reintentar-produccion`)).status,409);assert.equal(posts(c.app),1);
  c.app.state.resultadoFacturamaAmbiguo=null;c.app.state.fiscal.razon_social="CAMBIO DE EMISOR";
  assert.equal((await c.call(`/api/facturas/${f.id}/reintentar-produccion`)).status,409);assert.equal(posts(c.app),1);
  assert.deepEqual(c.app.state.rows[0].data.timbradoProduccion.solicitud,original);
});

test("fallo de detalle después del POST conserva el ID para recuperar sin otra emisión",async t=>{
  const c=await context(t),f=await draft(c);c.app.state.failDetalleFacturama=true;
  assert.equal((await c.call(`/api/facturas/${f.id}/timbrar`)).status,502);
  const row=c.app.state.rows[0];assert.ok(row.data.timbradoProduccion.facturamaId);assert.equal(row.data.estatus,"TIMBRANDO_PRODUCCION");
  assert.equal((await c.call(`/api/facturas/${f.id}/reintentar-produccion`)).status,409);c.app.state.failDetalleFacturama=false;
  assert.equal((await c.call(`/api/facturas/${f.id}/recuperar-produccion`)).status,200);assert.equal(posts(c.app),1);
});

test("un 500 después de cancelar se resuelve por consulta; motivo 01 solo permite el UUID sustituto indicado",async t=>{
  const c=await context(t),f=await issued(c);
  assert.equal((await c.call(`/api/facturas/${f.id}/cancelar`,{data:{motivo:"01",uuidSustitucion:f.uuid}})).status,400);assert.equal(deletes(c.app),0);
  c.app.state.failCancelacionDespues=true;
  const uuidSustitucion="99999999-8888-4777-8666-555555555555";
  assert.equal((await c.call(`/api/facturas/${f.id}/cancelar`,{data:{motivo:"01",uuidSustitucion}})).status,502);
  assert.equal(c.app.state.rows[0].data.estatus,"CANCELACION_PRODUCCION");assert.equal(deletes(c.app),1);
  assert.deepEqual(c.app.state.requests.find(r=>r.method==="DELETE").query,{motive:"01",uuidReplacement:uuidSustitucion});
  c.app.state.failCancelacionDespues=false;await c.app.reiniciar();
  assert.equal((await c.call(`/api/facturas/${f.id}/consultar-cancelacion-produccion`)).status,200);assert.equal(c.app.state.rows[0].data.estatus,"CANCELADA");assert.equal(deletes(c.app),1);
});

test("dos colecciones Firebase: desglosa IVA con seis decimales, incluye envío y aplica la promoción histórica una vez",async()=>{
  for(const whatsapp of [true,false]){
    const raw=whatsapp?{referencia:"NV-123",estado:"ENTREGADO",estatusPago:"PAGADO",monto:232,productos:[{clave:"A",nombre:"Artículo",precio:145,cantidad:2,descuentoPorcentaje:20}]}:{folio:"BAZ-123",tipoOperacion:"BAZ",estado:"ENTREGADO",estatusPago:"PAGADO",total:290,costoEnvio:58,tipoDescuento:"GENERAL",descuentoGeneral:20,productos:[{clave:"A",nombre:"Artículo",costo:145,cantidad:2}]};
    const api=Object.create(FirebaseJsonService.prototype);api.buscarDocumento=async()=>({id:"FIREBASE-ID",...raw});
    const pedido=await(whatsapp?api.obtenerWhatsApp("NV-123"):api.obtenerSurtido("BAZ-123"));const actual=pedidoProduccion(pedido);
    const f={...crearFactura({...datos,conceptos:conceptosPedidoProduccion(pedido)}),pedido:{firebaseId:pedido.firebaseId,fuente:pedido.fuente}};
    assert.equal(f.total,raw.monto||raw.total);assert.equal(f.conceptos[0].precioUnitario,100);assert.equal(f.conceptos.length,whatsapp?1:2);assert.ok(pedidoCoincideProduccion(pedido,f));
    assert.throws(()=>pedidoProduccion({...pedido,estatusPago:"PENDIENTE"}));assert.throws(()=>pedidoProduccion({...pedido,saldoRegistrado:1}));assert.throws(()=>pedidoProduccion({...pedido,totalPedido:1}));assert.throws(()=>pedidoProduccion({...pedido,facturado:true,facturaId:"OTRA"},f));
  }
});

test("la reserva Firebase no sobrescribe otra factura y solo el propietario puede liberarla",async()=>{
  const api=Object.create(FirebaseJsonService.prototype),ref={},updates=[];let actual={facturado:true,facturaId:"OTRA"};
  api.firestore=()=>({collection:()=>({doc:()=>ref}),runTransaction:async cb=>cb({get:async()=>({exists:true,data:()=>actual}),update:(r,p)=>updates.push(p)})});
  const pedido={firebaseId:"ID",fuente:"FIRESTORE_SURTIDOS"},factura={id:"PROPIA",folioInterno:"NOV-FAC-1"};
  await assert.rejects(api.marcarFacturado(pedido,factura),/no corresponde/);assert.equal(updates.length,0);
  actual={facturado:false};await api.marcarFacturado(pedido,factura);assert.equal(updates[0].facturaId,"PROPIA");
  actual={facturado:true,facturaId:"OTRA"};await assert.rejects(api.desmarcarFacturado(pedido,"PROPIA"),/no corresponde/);
});

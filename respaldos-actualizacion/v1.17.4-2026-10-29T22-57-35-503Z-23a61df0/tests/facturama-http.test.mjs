import test from "node:test";
import assert from "node:assert/strict";
import { iniciarServidorVentaPrueba, barreraPrueba } from "./fixtures/ventaServidor.mjs";

const datos = { folioOrigen:"1842",origen:"MANUAL",formaPago:"03",metodoPago:"PUE",usoCfdi:"G03",cliente:{razonSocial:"CONSERVAR CLIENTE",rfc:"XAXX010101000",codigoPostal:"53490",regimenFiscal:"616"},conceptos:[{orderItemId:1,descripcion:"Ignorar navegador",cantidad:9,precioUnitario:0}] };
const client=app=>(url,{method="GET",data,token="admin-session"}={})=>fetch(app.baseUrl+url,{method,headers:{Cookie:`facturacion_access=${token}`,...(data?{"Content-Type":"application/json"}:{})},...(data?{body:JSON.stringify(data)}:{})});

test("dashboard Sandbox: timbra una compra, descarga originales tras reiniciar y bloquea cancelación MOCK",{timeout:25000},async t=>{
  const app=await iniciarServidorVentaPrueba({sandbox:true});t.after(()=>app.cerrar());const request=client(app);
  assert.equal((await (await request("/api/health")).json()).pac,"facturama_sandbox");
  const config=await(await request("/api/timbrado/configuracion")).json();assert.equal(config.sandbox,true);assert.doesNotMatch(JSON.stringify(config),/FAKE-|Basic/);
  const f=await(await request("/api/facturas",{method:"POST",data:datos})).json();
  const response=await request(`/api/facturas/${f.id}/timbrar`,{method:"POST"});assert.equal(response.status,200);const stamped=await response.json();
  assert.equal(stamped.estatus,"TIMBRADA_SANDBOX");assert.equal(stamped.documentosPendientes,false);assert.equal(stamped.total,1449);assert.equal(stamped.cliente.razonSocial,"CONSERVAR CLIENTE");
  assert.equal(stamped.timbradoSandbox.solicitud.Issuer.Rfc,"EKU9003173C9");assert.equal(stamped.timbradoSandbox.solicitud.Receiver.Rfc,"URE180429TM6");
  assert.equal(Object.hasOwn(app.state.comprobantes[0].payload,"OrderNumber"),false);
  assert.match(stamped.xmlStoragePath,/^sandbox\//);assert.match(stamped.pdfStoragePath,/^sandbox\//);
  await app.reiniciar();
  for(const type of ["xml","pdf"]){const r=await request(`/api/facturas/${f.id}/documento/${type}`);assert.equal(r.status,200);const bytes=Buffer.from(await r.arrayBuffer());assert.deepEqual(bytes,app.state.documents.get(stamped[`${type}StoragePath`]));}
  assert.equal((await request(`/api/facturas/${f.id}/timbrar`,{method:"POST"})).status,409);
  assert.equal((await request(`/api/facturas/${f.id}/cancelar`,{method:"POST",data:{motivo:"02"}})).status,409);
  assert.equal((await request(`/api/facturas/${f.id}`,{method:"DELETE"})).status,409);
  assert.equal((await request(`/api/facturas/${f.id}/recuperar-sandbox`,{method:"POST",token:"view-session"})).status,403);
  assert.equal(app.state.comprobantes.length,1);
  assert.doesNotMatch(JSON.stringify(stamped),/FAKE-SANDBOX-(USER|PASS)|Basic/);
  assert.ok(app.state.requests.filter(r=>r.pathname.startsWith("/fake-facturama/")).every(r=>r.method==="GET"||(r.method==="POST"&&r.pathname.endsWith("/api-lite/4/cfdis"))));
});

test("dashboard conserva emisión ante fallo PDF/Storage y recupera sin duplicar",{timeout:25000},async t=>{
  const app=await iniciarServidorVentaPrueba({sandbox:true});t.after(()=>app.cerrar());const request=client(app);
  const f=await(await request("/api/facturas",{method:"POST",data:datos})).json();
  app.state.failPdf=true;
  const first=await(await request(`/api/facturas/${f.id}/timbrar`,{method:"POST"})).json();assert.equal(first.estatus,"TIMBRADA_SANDBOX");assert.equal(first.documentosPendientes,true);
  app.state.failPdf=false;app.state.failUpload=true;
  const second=await(await request(`/api/facturas/${f.id}/recuperar-sandbox`,{method:"POST"})).json();assert.equal(second.documentosPendientes,true);
  app.state.failUpload=false;await app.reiniciar();
  const restored=await(await request(`/api/facturas/${f.id}/recuperar-sandbox`,{method:"POST"})).json();assert.equal(restored.documentosPendientes,false);assert.equal(restored.uuid,first.uuid);assert.equal(app.state.comprobantes.length,1);
});

test("dashboard recupera HTTP 503 después de emitir consultando el folio persistido",{timeout:25000},async t=>{
  const app=await iniciarServidorVentaPrueba({sandbox:true});t.after(()=>app.cerrar());const request=client(app);
  const f=await(await request("/api/facturas",{method:"POST",data:datos})).json();app.state.postFacturamaIncierto=true;
  const first=await request(`/api/facturas/${f.id}/timbrar`,{method:"POST"});assert.equal(first.status,502);assert.doesNotMatch(JSON.stringify(await first.json()),/RESPUESTA_PRIVADA/);
  assert.equal(app.state.rows[0].data.estatus,"REVISION_SANDBOX");
  await app.reiniciar();
  const recovered=await request(`/api/facturas/${f.id}/recuperar-sandbox`,{method:"POST"});assert.equal(recovered.status,200);assert.equal((await recovered.json()).documentosPendientes,false);assert.equal(app.state.comprobantes.length,1);
});

test("el timbrado sandbox bloquea doble clic, edición y eliminación durante el POST",{timeout:25000},async t=>{
  const app=await iniciarServidorVentaPrueba({sandbox:true});t.after(()=>app.cerrar());const request=client(app);
  const f=await(await request("/api/facturas",{method:"POST",data:datos})).json(),gate=barreraPrueba();app.state.beforeFacturama=gate.wait;t.after(()=>gate.release());
  const first=request(`/api/facturas/${f.id}/timbrar`,{method:"POST"});await gate.entered;
  try{for(const [suffix,method] of [["/timbrar","POST"],["","PUT"],["","DELETE"],["/recuperar-sandbox","POST"]])assert.equal((await request(`/api/facturas/${f.id}${suffix}`,{method,data:datos})).status,409);}
  finally{gate.release();}
  assert.equal((await first).status,200);assert.equal(app.state.comprobantes.length,1);
});

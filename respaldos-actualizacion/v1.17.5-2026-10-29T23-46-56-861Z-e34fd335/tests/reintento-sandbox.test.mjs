import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { iniciarServidorVentaPrueba, barreraPrueba } from "./fixtures/ventaServidor.mjs";
import { huellaSolicitudLegacy, restaurarFormatoLegacy } from "../backend/services/huellaSandbox.mjs";
import { SupabaseFacturaRepository } from "../backend/repositories/supabaseFacturaRepository.mjs";
import { FacturamaSandboxService } from "../backend/services/facturamaSandboxService.mjs";
import { TimbradoSandboxService } from "../backend/services/timbradoSandboxService.mjs";

const datos={folioOrigen:"1842",origen:"MANUAL",formaPago:"03",metodoPago:"PUE",usoCfdi:"G03",cliente:{razonSocial:"CONSERVAR CLIENTE",rfc:"XAXX010101000",codigoPostal:"53490",regimenFiscal:"616"}};
const client=app=>(url,{method="POST",data,token="admin-session"}={})=>fetch(app.baseUrl+url,{method,headers:{Cookie:`facturacion_access=${token}`,"Content-Type":"application/json"},...(data?{body:JSON.stringify(data)}:{})});
const posts=app=>app.state.requests.filter(r=>r.pathname==="/fake-facturama/api-lite/4/cfdis").length;
const gets=app=>app.state.requests.filter(r=>r.pathname==="/fake-facturama/cfdi").length;
async function pending(t,{emitida=false}={}){
  const app=await iniciarServidorVentaPrueba({sandbox:true});t.after(()=>app.cerrar());const request=client(app);
  const saved=await request("/api/facturas",{data:datos});assert.equal(saved.status,201);const f=await saved.json();
  app.state.failFacturamaSinEmitir=!emitida;app.state.postFacturamaIncierto=emitida;
  assert.equal((await request(`/api/facturas/${f.id}/timbrar`)).status,502);
  app.state.failFacturamaSinEmitir=false;app.state.postFacturamaIncierto=false;
  const row=app.state.rows[0],original=structuredClone(row.data.timbradoSandbox.solicitud);
  assert.equal(row.data.estatus,"REVISION_SANDBOX");
  return{app,request,f,row,original,url:`/api/facturas/${f.id}/reintentar-sandbox`};
}

test("reintenta una operación anterior tras reiniciar: conserva todos sus campos, folio y fecha, y descarga originales",{timeout:25000},async t=>{
  const c=await pending(t),{app,row,request,original}=c;
  const op=row.data.timbradoSandbox;op.huella=huellaSolicitudLegacy(restaurarFormatoLegacy(op.solicitud));delete op.huellaVersion;
  await app.reiniciar();
  const start=app.state.requests.length;
  const response=await request(c.url,{data:{solicitud:{Folio:"NO_USAR",Date:"2000-01-01T00:00:00"}}});
  assert.equal(response.status,200);const done=await response.json();
  assert.equal(done.estatus,"TIMBRADA_SANDBOX");assert.equal(done.documentosPendientes,false);
  assert.deepEqual(app.state.comprobantes[0].payload,original);assert.deepEqual(done.timbradoSandbox.solicitud,original);
  assert.equal(done.timbradoSandbox.huellaVersion,2);assert.equal(done.timbradoSandbox.reintentos,1);
  const calls=app.state.requests.slice(start),post=calls.findIndex(r=>r.pathname==="/fake-facturama/api-lite/4/cfdis");
  assert.ok(post>calls.findIndex(r=>r.pathname==="/fake-facturama/cfdi"));assert.equal(posts(app),2);
  assert.equal(app.state.comprobantes.length,1);assert.ok(app.state.auditoria.some(r=>r.accion==="REINTENTO_SANDBOX"));
  for(const type of ["xml","pdf"]){const r=await request(`/api/facturas/${c.f.id}/documento/${type}`,{method:"GET"});assert.equal(r.status,200);assert.deepEqual(Buffer.from(await r.arrayBuffer()),app.state.documents.get(done[`${type}StoragePath`]));}
  assert.equal((await request(c.url)).status,409);assert.equal(posts(app),2);
});

test("si ya se emitió, reintentar recupera el mismo UUID sin otro POST aunque el pedido ahora esté en revisión",{timeout:25000},async t=>{
  const c=await pending(t,{emitida:true});c.app.state.sale.data.invoice_eligibility.status="review_required";
  const r=await c.request(c.url);assert.equal(r.status,200);assert.equal((await r.json()).estatus,"TIMBRADA_SANDBOX");
  assert.equal(posts(c.app),1);assert.equal(c.app.state.comprobantes.length,1);
});

test("un fallo de consulta bloquea el POST y conserva la solicitud pendiente para un intento explícito posterior",{timeout:25000},async t=>{
  const c=await pending(t);c.app.state.failFacturamaConsulta=true;
  assert.equal((await c.request(c.url)).status,502);assert.equal(posts(c.app),1);
  assert.equal(c.row.data.estatus,"REVISION_SANDBOX");assert.deepEqual(c.row.data.timbradoSandbox.solicitud,c.original);
  c.app.state.failFacturamaConsulta=false;assert.equal((await c.request(c.url)).status,200);assert.equal(posts(c.app),2);
});

test("otro 500 conserva la operación y Consultar resultado sigue siendo GET-only",{timeout:25000},async t=>{
  const c=await pending(t);c.app.state.failFacturamaSinEmitir=true;
  assert.equal((await c.request(c.url)).status,502);assert.equal(posts(c.app),2);
  assert.equal(c.row.data.estatus,"REVISION_SANDBOX");assert.equal(c.row.data.timbradoSandbox.estado,"POR_CONFIRMAR");
  assert.deepEqual(c.row.data.timbradoSandbox.solicitud,c.original);assert.equal(c.row.data.timbradoSandbox.reintentos,1);
  await c.app.reiniciar();
  const r=await c.request(`/api/facturas/${c.f.id}/recuperar-sandbox`);assert.equal(r.status,409);assert.equal((await r.json()).codigo,"SANDBOX_RESULTADO_NO_CONFIRMADO");
  assert.equal(posts(c.app),2);
});

test("bloquea clic simultáneo, edición y eliminación mientras consulta antes del reenvío",{timeout:25000},async t=>{
  const c=await pending(t),gate=barreraPrueba();c.app.state.beforeFacturamaConsulta=gate.wait;t.after(()=>gate.release());
  const first=c.request(c.url);await gate.entered;
  try{for(const [suffix,method] of [["reintentar-sandbox","POST"],["recuperar-sandbox","POST"],["timbrar","POST"],["","PUT"],["","DELETE"]]){
    const r=await c.request(`/api/facturas/${c.f.id}${suffix?"/"+suffix:""}`,{method,data:datos});assert.equal(r.status,409);
  }}finally{gate.release();}
  assert.equal((await first).status,200);assert.equal(posts(c.app),2);assert.equal(c.app.state.comprobantes.length,1);
});

test("revisa la elegibilidad actual del pedido antes de reenviar y conserva el registro cuando cambió",{timeout:25000},async t=>{
  const c=await pending(t);c.app.state.sale.data.invoice_eligibility.status="review_required";
  const r=await c.request(c.url);assert.equal(r.status,409);assert.equal(posts(c.app),1);
  assert.equal(c.row.data.estatus,"REVISION_SANDBOX");assert.deepEqual(c.row.data.timbradoSandbox.solicitud,c.original);
});

test("permisos, huella alterada e identificador confirmado impiden reenvíos antes de consultar al proveedor",{timeout:25000},async t=>{
  const c=await pending(t),before=gets(c.app);
  assert.equal((await c.request(c.url,{token:"view-session"})).status,403);
  const op=c.row.data.timbradoSandbox;op.solicitud.Date="2000-01-01T00:00:00";
  const changed=await c.request(c.url);assert.equal(changed.status,409);assert.equal((await changed.json()).codigo,"SANDBOX_SOLICITUD_MODIFICADA");
  op.solicitud.Date=c.original.Date;op.facturamaId="ID-CONFIRMADO";
  const identified=await c.request(c.url);assert.equal(identified.status,409);assert.equal((await identified.json()).codigo,"SANDBOX_REINTENTO_NO_PERMITIDO");
  assert.equal(gets(c.app),before);assert.equal(posts(c.app),1);
});

test("una coincidencia que no se puede verificar no se interpreta como ausencia: no envía otro POST",{timeout:25000},async t=>{
  const c=await pending(t);c.app.state.resultadoFacturamaAmbiguo={Id:"AMBIGUO",Folio:c.original.Folio,Serie:"OTRA"};
  const r=await c.request(c.url);assert.equal(r.status,409);assert.equal((await r.json()).codigo,"SANDBOX_COINCIDENCIA_NO_VERIFICADA");
  assert.equal(posts(c.app),1);assert.equal(c.row.data.estatus,"REVISION_SANDBOX");assert.deepEqual(c.row.data.timbradoSandbox.solicitud,c.original);
});

test("dos servicios con repositorios Supabase independientes solo reclaman una vez la revisión JSONB",{timeout:25000},async t=>{
  const c=await pending(t),storage=await fs.mkdtemp(path.join(os.tmpdir(),"noventia-reintento-"));t.after(()=>fs.rm(storage,{recursive:true,force:true}));
  const repo=()=>new SupabaseFacturaRepository({url:c.app.fakeUrl,serviceRoleKey:"FAKE-SERVICE-KEY"});
  const a=repo(),b=repo(),[one,two]=await Promise.all([a.findById(c.f.id),b.findById(c.f.id)]);
  const pac=()=>new FacturamaSandboxService({username:"FAKE-SANDBOX-USER",password:"FAKE-SANDBOX-PASS",fetchImpl:async(url,options)=>{
    const u=new URL(url);assert.equal(u.origin,"https://apisandbox.facturama.mx");
    const r=await fetch(c.app.fakeUrl+"/fake-facturama"+u.pathname+u.search,options);return new Response(r.body,{status:r.status,headers:r.headers});
  }});
  const service=repository=>new TimbradoSandboxService({facturas:repository,pac:pac(),storageRoot:storage});
  const gate=barreraPrueba();c.app.state.beforeFacturamaConsulta=gate.wait;t.after(()=>gate.release());
  const first=service(a).reintentar(one);await gate.entered;
  try{await assert.rejects(service(b).reintentar(two),error=>error.code==="SANDBOX_FACTURA_ACTUALIZADA");}finally{gate.release();}
  const done=await first;assert.equal(done.estatus,"TIMBRADA_SANDBOX");assert.equal(done.documentosPendientes,false);
  assert.deepEqual(done.timbradoSandbox.solicitud,c.original);assert.equal(posts(c.app),2);assert.equal(c.app.state.comprobantes.length,1);
});

test("el modo MOCK rechaza la ruta de reenvío Sandbox",{timeout:25000},async t=>{
  const app=await iniciarServidorVentaPrueba();t.after(()=>app.cerrar());const request=client(app);
  const r=await request("/api/facturas/inexistente/reintentar-sandbox");assert.equal(r.status,409);assert.equal(posts(app),0);
});

test("si falla el PDF después de reenviar, conserva UUID/ID y la recuperación no emite otra vez",{timeout:25000},async t=>{
  const c=await pending(t);c.app.state.failPdf=true;
  const sent=await c.request(c.url);assert.equal(sent.status,200);const first=await sent.json();
  assert.equal(first.estatus,"TIMBRADA_SANDBOX");assert.equal(first.documentosPendientes,true);assert.ok(first.uuid);
  assert.equal((await c.request(c.url)).status,409);assert.equal(posts(c.app),2);
  c.app.state.failPdf=false;
  const recovered=await c.request(`/api/facturas/${c.f.id}/recuperar-sandbox`);assert.equal(recovered.status,200);const done=await recovered.json();
  assert.equal(done.uuid,first.uuid);assert.equal(done.documentosPendientes,false);assert.equal(posts(c.app),2);
});

test("una revisión concurrente durante el GET impide el POST posterior y no se sobrescribe al liberar",{timeout:25000},async t=>{
  const c=await pending(t),repo=new SupabaseFacturaRepository({url:c.app.fakeUrl,serviceRoleKey:"FAKE-SERVICE-KEY"});
  const gate=barreraPrueba();c.app.state.beforeFacturamaConsulta=gate.wait;t.after(()=>gate.release());
  const first=c.request(c.url);await gate.entered;
  const current=await repo.findById(c.f.id);
  const newer=await repo.compareAndUpdate(current,{notaRevision:"CONSERVAR_CAMBIO_CONCURRENTE"});assert.ok(newer);
  gate.release();const r=await first;assert.equal(r.status,409);assert.equal((await r.json()).codigo,"SANDBOX_FACTURA_ACTUALIZADA");
  assert.equal(posts(c.app),1);const after=await repo.findById(c.f.id);assert.equal(after.revision,newer.revision);assert.equal(after.notaRevision,"CONSERVAR_CAMBIO_CONCURRENTE");
});

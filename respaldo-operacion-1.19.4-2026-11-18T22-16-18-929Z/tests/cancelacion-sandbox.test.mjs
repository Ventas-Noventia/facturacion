import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { iniciarServidorVentaPrueba, barreraPrueba } from "./fixtures/ventaServidor.mjs";
import { FacturamaSandboxService } from "../backend/services/facturamaSandboxService.mjs";
import { CancelacionSandboxService } from "../backend/services/cancelacionSandboxService.mjs";
import { SupabaseFacturaRepository } from "../backend/repositories/supabaseFacturaRepository.mjs";
import { LocalFacturaRepository } from "../backend/repositories/localFacturaRepository.mjs";
import { FirebaseJsonService } from "../backend/services/firebaseJsonService.mjs";
import { ReportesService } from "../backend/services/reportesService.mjs";

const datos={folioOrigen:"1842",origen:"MANUAL",formaPago:"03",metodoPago:"PUE",usoCfdi:"G03",cliente:{razonSocial:"CONSERVAR CLIENTE",rfc:"XAXX010101000",codigoPostal:"53490",regimenFiscal:"616"}};
const client=app=>(url,{method="POST",data,token="admin-session"}={})=>fetch(app.baseUrl+url,{method,headers:{Cookie:`facturacion_access=${token}`,"Content-Type":"application/json"},...(data?{body:JSON.stringify(data)}:{})});
const deletes=app=>app.state.requests.filter(r=>r.method==="DELETE"&&r.pathname.startsWith("/fake-facturama/")).length;
const providerCalls=app=>app.state.requests.filter(r=>r.pathname.startsWith("/fake-facturama/")).length;
const repository=app=>new SupabaseFacturaRepository({url:app.fakeUrl,serviceRoleKey:"FAKE-SERVICE-KEY"});
const fakePac=app=>new FacturamaSandboxService({username:"FAKE-SANDBOX-USER",password:"FAKE-SANDBOX-PASS",fetchImpl:async(url,options)=>{
  const u=new URL(url);assert.equal(u.origin,"https://apisandbox.facturama.mx");const r=await fetch(app.fakeUrl+"/fake-facturama"+u.pathname+u.search,options);return new Response(r.body,{status:r.status,headers:r.headers});
}});
async function stamped(t){
  const app=await iniciarServidorVentaPrueba({sandbox:true});t.after(()=>app.cerrar());const request=client(app);
  const created=await request("/api/facturas",{data:datos});assert.equal(created.status,201);const f=await created.json();
  const issued=await request(`/api/facturas/${f.id}/timbrar`);assert.equal(issued.status,200);const original=await issued.json();
  return {app,request,f,original,row:app.state.rows[0],url:`/api/facturas/${f.id}/cancelar`,consult:`/api/facturas/${f.id}/consultar-cancelacion-sandbox`,ack:`/api/facturas/${f.id}/acuse-cancelacion`};
}

test("cancelación consulta antes y después del DELETE, conserva XML/PDF y descarga el acuse",{timeout:25000},async t=>{
  const c=await stamped(t),start=c.app.state.requests.length;
  const r=await c.request(c.url,{data:{motivo:"02",comentario:"Prueba de cancelación"}});assert.equal(r.status,200);const done=await r.json();
  assert.equal(done.estatus,"CANCELADA_SANDBOX");assert.equal(done.cancelacionSandbox.estado,"CONFIRMADA");assert.equal(done.uuid,c.original.uuid);assert.deepEqual(done.timbradoSandbox,c.original.timbradoSandbox);
  const calls=c.app.state.requests.slice(start).filter(r=>r.pathname.startsWith("/fake-facturama/"));assert.deepEqual(calls.map(r=>r.method),["GET","DELETE","GET"]);assert.deepEqual(calls[1].query,{motive:"02"});
  await c.app.reiniciar();
  for(const type of ["xml","pdf"]){const file=await c.request(`/api/facturas/${c.f.id}/documento/${type}`,{method:"GET"});assert.equal(file.status,200);assert.deepEqual(Buffer.from(await file.arrayBuffer()),c.app.state.documents.get(c.original[`${type}StoragePath`]));}
  const ack=await c.request(c.ack,{method:"GET"});assert.equal(ack.status,200);assert.match(Buffer.from(await ack.arrayBuffer()).toString(),/ACUSE ORIGINAL/);
  assert.equal((await c.request(c.url,{data:{motivo:"02"}})).status,409);assert.equal(deletes(c.app),1);
});

test("una cancelación pendiente mantiene el pedido bloqueado y consulta sin otro DELETE; después permite una nueva solicitud",{timeout:25000},async t=>{
  const c=await stamped(t);c.app.state.cancelacionPendiente=true;
  const r=await c.request(c.url,{data:{motivo:"02"}});assert.equal(r.status,200);assert.equal((await r.json()).estatus,"CANCELACION_SANDBOX");
  assert.equal((await c.request("/api/facturas",{data:datos})).status,409);assert.equal((await c.request(c.ack,{method:"GET"})).status,409);
  await c.app.reiniciar();assert.equal((await c.request(c.consult)).status,200);assert.equal(deletes(c.app),1);
  c.app.state.comprobantes[0].Status="cancel";
  const done=await c.request(c.consult);assert.equal(done.status,200);assert.equal((await done.json()).estatus,"CANCELADA_SANDBOX");assert.equal(deletes(c.app),1);
  const fresh=await c.request("/api/facturas",{data:datos});assert.equal(fresh.status,201);const next=await fresh.json();assert.notEqual(next.id,c.f.id);assert.notEqual(next.folioInterno,c.f.folioInterno);
  assert.equal((await c.request("/api/facturas",{data:datos})).status,409);assert.equal(c.row.data.uuid,c.original.uuid);
});

test("un 500 después de cancelar se recupera por GET tras reiniciar sin repetir DELETE",{timeout:25000},async t=>{
  const c=await stamped(t);c.app.state.failCancelacionDespues=true;
  assert.equal((await c.request(c.url,{data:{motivo:"03"}})).status,502);assert.equal(c.row.data.estatus,"CANCELACION_SANDBOX");
  const saved=structuredClone(c.row.data.cancelacionSandbox.solicitud);assert.equal((await c.request("/api/facturas",{data:datos})).status,409);
  await c.app.reiniciar();const r=await c.request(c.consult);assert.equal(r.status,200);assert.equal((await r.json()).estatus,"CANCELADA_SANDBOX");assert.deepEqual(c.row.data.cancelacionSandbox.solicitud,saved);assert.equal(deletes(c.app),1);
});

test("un 500 sin cancelación y un cuerpo exitoso no confirmado conservan la identidad activa",{timeout:25000},async t=>{
  for(const flag of ["failCancelacionAntes","cancelacionRespuestaSinConfirmar"]){
    const c=await stamped(t);c.app.state[flag]=true;const r=await c.request(c.url,{data:{motivo:"02"}});assert.equal(r.status,flag==="failCancelacionAntes"?502:200);
    const pending=await c.request(c.consult);assert.equal(pending.status,200);assert.equal((await pending.json()).estatus,"CANCELACION_SANDBOX");
    assert.equal((await c.request("/api/facturas",{data:datos})).status,409);assert.equal(deletes(c.app),1);
  }
});

test("permisos y motivos inválidos se rechazan antes de contactar al proveedor",{timeout:25000},async t=>{
  const c=await stamped(t),before=providerCalls(c.app);
  assert.equal((await c.request(c.url,{token:"view-session",data:{motivo:"02"}})).status,403);assert.equal((await c.request(c.consult,{token:"view-session"})).status,403);
  for(const data of [{motivo:""},{motivo:"99"},{motivo:"01",uuidSustitucion:"NO"},{motivo:"01",uuidSustitucion:c.original.uuid},{motivo:"02",uuidSustitucion:randomUUID()}])assert.equal((await c.request(c.url,{data})).status,400);
  assert.equal(providerCalls(c.app),before);assert.equal(c.row.data.estatus,"TIMBRADA_SANDBOX");assert.equal(c.row.data.cancelacionSandbox,undefined);
});

test("motivo 01 envía solo el UUID sustituto indicado; un rechazo permite corregir sin liberar el pedido",{timeout:25000},async t=>{
  const c=await stamped(t),uuid=randomUUID();c.app.state.rechazoCancelacion=true;
  assert.equal((await c.request(c.url,{data:{motivo:"01",uuidSustitucion:uuid}})).status,502);assert.equal(c.row.data.estatus,"TIMBRADA_SANDBOX");assert.equal(c.row.data.cancelacionSandbox.estado,"RECHAZADA");
  assert.equal((await c.request("/api/facturas",{data:datos})).status,409);
  c.app.state.rechazoCancelacion=false;assert.equal((await c.request(c.url,{data:{motivo:"01",uuidSustitucion:uuid}})).status,200);
  const calls=c.app.state.requests.filter(r=>r.method==="DELETE"&&r.pathname.startsWith("/fake-facturama/"));assert.ok(calls.every(r=>r.query.uuidReplacement===uuid.toUpperCase()));assert.equal(c.row.data.cancelacionSandbox.historial.length,1);
});

test("doble clic, reenvío y cambios concurrentes no producen dos cancelaciones",{timeout:25000},async t=>{
  const c=await stamped(t),gate=barreraPrueba();c.app.state.beforeCancelacion=gate.wait;t.after(()=>gate.release());
  const first=c.request(c.url,{data:{motivo:"02"}});await gate.entered;
  try{for(const url of [c.url,c.consult,`/api/facturas/${c.f.id}/reintentar-sandbox`])assert.equal((await c.request(url,{data:{motivo:"02"}})).status,409);}finally{gate.release();}
  assert.equal((await first).status,200);assert.equal(deletes(c.app),1);
});

test("identidad remota distinta impide DELETE y un fallo de acuse no revierte la cancelación",{timeout:25000},async t=>{
  const c=await stamped(t),remote=c.app.state.comprobantes[0];remote.Total++;
  const wrong=await c.request(c.url,{data:{motivo:"02"}});assert.equal(wrong.status,409);assert.equal(deletes(c.app),0);assert.equal(c.row.data.estatus,"TIMBRADA_SANDBOX");
  remote.Total--;assert.equal((await c.request(c.url,{data:{motivo:"02"}})).status,200);
  c.app.state.failAcuse=true;assert.equal((await c.request(c.ack,{method:"GET"})).status,502);assert.equal(c.row.data.estatus,"CANCELADA_SANDBOX");assert.equal(deletes(c.app),1);
  c.app.state.failAcuse=false;assert.equal((await c.request(c.ack,{method:"GET"})).status,200);assert.equal(deletes(c.app),1);
});

test("la recuperación de documentos de una factura cancelada no la devuelve a TIMBRADA",{timeout:25000},async t=>{
  const c=await stamped(t);assert.equal((await c.request(c.url,{data:{motivo:"02"}})).status,200);
  c.row.data.documentosPendientes=true;const r=await c.request(`/api/facturas/${c.f.id}/recuperar-sandbox`);assert.equal(r.status,200);const done=await r.json();assert.equal(done.estatus,"CANCELADA_SANDBOX");assert.equal(done.documentosPendientes,false);assert.equal(deletes(c.app),1);
});

test("dos repositorios Supabase independientes solo reclaman una cancelación",{timeout:25000},async t=>{
  const c=await stamped(t),a=repository(c.app),b=repository(c.app),[one,two]=await Promise.all([a.findById(c.f.id),b.findById(c.f.id)]),gate=barreraPrueba();
  c.app.state.beforeCancelacion=gate.wait;t.after(()=>gate.release());const svc=repo=>new CancelacionSandboxService({facturas:repo,pac:fakePac(c.app)});
  const first=svc(a).cancelar(one,{motivo:"02"});await gate.entered;
  try{await assert.rejects(svc(b).cancelar(two,{motivo:"02"}),e=>e.statusCode===409);}finally{gate.release();}
  assert.equal((await first).estatus,"CANCELADA_SANDBOX");assert.equal(deletes(c.app),1);
});

test("Firebase no se libera antes de confirmar y un fallo conserva el bloqueo sin deshacer la cancelación",{timeout:25000},async t=>{
  const c=await stamped(t),folder=await fs.mkdtemp(path.join(os.tmpdir(),"noventia-cancel-firebase-"));t.after(()=>fs.rm(folder,{recursive:true,force:true}));
  const repo=new LocalFacturaRepository({file:path.join(folder,"facturas.json")});const old=await repo.save({...c.original,pedido:{fuente:"FIRESTORE_SURTIDOS",firebaseId:"PEDIDO-1"},pedidoMarcadoFacturado:true});
  let fail=true,releases=0;const svc=new CancelacionSandboxService({facturas:repo,pac:fakePac(c.app),liberarPedido:async f=>{assert.equal(f.cancelacionSandbox.estado,"CONFIRMADA");assert.equal(c.app.state.comprobantes[0].Status,"cancel");releases++;if(fail)throw new Error("FALLO PRIVADO");}});
  const pending=await svc.cancelar(old,{motivo:"02"});assert.equal(pending.estatus,"CANCELACION_SANDBOX");assert.equal(pending.cancelacionSandbox.estado,"CONFIRMADA");assert.ok(pending.advertencia);assert.equal(releases,1);
  await assert.rejects(repo.save({...old,id:randomUUID(),estatus:"BORRADOR"}),e=>e.statusCode===409);
  fail=false;const done=await svc.consultar(await repo.findById(old.id));assert.equal(done.estatus,"CANCELADA_SANDBOX");assert.equal(done.pedidoLiberadoPorCancelacion,true);assert.equal(releases,2);assert.equal(deletes(c.app),1);
});

test("una solicitud de cancelación alterada se bloquea antes de consultar o descargar acuse",{timeout:25000},async t=>{
  const c=await stamped(t);assert.equal((await c.request(c.url,{data:{motivo:"02"}})).status,200);const before=providerCalls(c.app);
  c.row.data.cancelacionSandbox.solicitud.motivo="03";
  assert.equal((await c.request(c.consult)).status,409);assert.equal((await c.request(c.ack,{method:"GET"})).status,409);assert.equal(providerCalls(c.app),before);
});

test("el cliente restringe DELETE al comprobante, motivo y UUID correctos",async()=>{
  const calls=[];const api=new FacturamaSandboxService({username:"test",password:"secret",fetchImpl:async(url,options)=>{calls.push({url,options});return Response.json({Status:"canceled"})}});
  for(const endpoint of ["/api-lite/csds/EKU9003173C9","/api-lite/cfdis/ID?motive=01","/api-lite/cfdis/ID?motive=02&uuidReplacement=","/api-lite/cfdis/ID?motive=02&token=secret","/api-lite/cfdis/ID?motive=02#motive=03"])await assert.rejects(api.request(endpoint,{method:"DELETE"}));
  assert.equal(calls.length,0);await api.cancelar("ID",{motivo:"02"});assert.equal(calls.length,1);assert.equal(calls[0].options.method,"DELETE");assert.equal(new URL(calls[0].url).search,"?motive=02");assert.equal(calls[0].options.redirect,"error");
});

test("liberar Firebase comprueba en una transacción que la marca pertenece a la misma factura",async()=>{
  const api=Object.create(FirebaseJsonService.prototype),ref={},updates=[];let actual={facturado:true,facturaId:"OTRA"};
  api.firestore=()=>({collection:()=>({doc:()=>ref}),runTransaction:async callback=>callback({get:async value=>{assert.equal(value,ref);return{exists:true,data:()=>actual}},update:(value,patch)=>updates.push({value,patch})})});
  const pedido={fuente:"FIRESTORE_SURTIDOS",firebaseId:"PEDIDO-1"};
  await assert.rejects(api.desmarcarFacturado(pedido,"ORIGINAL"),/no corresponde/);assert.equal(updates.length,0);
  actual={facturado:true};await assert.rejects(api.desmarcarFacturado(pedido,"ORIGINAL"),/no corresponde/);assert.equal(updates.length,0);
  actual={facturado:true,facturaId:"ORIGINAL"};await api.desmarcarFacturado(pedido,"ORIGINAL");assert.equal(updates.length,1);assert.equal(updates[0].patch.facturado,false);
});

test("reportes cuentan la cancelación pendiente como vigente y la confirmada como cancelada",()=>{
  const service=new ReportesService(),f={estatus:"CANCELACION_SANDBOX",subtotal:100,impuestos:16,total:116,cancelacionSandbox:{estado:"PENDIENTE"}};
  assert.equal(service.construir([f]).timbradas,1);assert.equal(service.construir([f]).totalFacturado,116);
  f.cancelacionSandbox.estado="CONFIRMADA";const r=service.construir([f]);assert.equal(r.timbradas,0);assert.equal(r.canceladas,1);assert.equal(r.totalFacturado,0);
});


test("si falla la consulta posterior o el CFDI ya estaba cancelado, recuperar no envía otra cancelación",{timeout:25000},async t=>{
  const c=await stamped(t);c.app.state.beforeCancelacion=async()=>{c.app.state.failDetalleFacturama=true;};
  assert.equal((await c.request(c.url,{data:{motivo:"02"}})).status,502);assert.equal(c.row.data.estatus,"CANCELACION_SANDBOX");assert.equal(c.row.data.cancelacionSandbox.estado,"POR_CONFIRMAR");
  c.app.state.failDetalleFacturama=false;assert.equal((await c.request(c.consult)).status,200);assert.equal(c.row.data.estatus,"CANCELADA_SANDBOX");assert.equal(deletes(c.app),1);
  const other=await stamped(t);other.app.state.comprobantes[0].Status="cancel";
  assert.equal((await other.request(other.url,{data:{motivo:"02"}})).status,200);assert.equal(other.row.data.estatus,"CANCELADA_SANDBOX");assert.equal(deletes(other.app),0);
});

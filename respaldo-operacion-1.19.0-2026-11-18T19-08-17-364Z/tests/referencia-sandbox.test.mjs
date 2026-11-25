import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { randomUUID } from "node:crypto";
import { iniciarServidorVentaPrueba, barreraPrueba } from "./fixtures/ventaServidor.mjs";
import { huellaSolicitud, huellaSolicitudLegacy, restaurarFormatoLegacy } from "../backend/services/huellaSandbox.mjs";
import { FacturamaSandboxService, solicitudSandbox } from "../backend/services/facturamaSandboxService.mjs";
import { SupabaseFacturaRepository } from "../backend/repositories/supabaseFacturaRepository.mjs";
import { TimbradoSandboxService } from "../backend/services/timbradoSandboxService.mjs";

const datos={folioOrigen:"1842",origen:"MANUAL",formaPago:"03",metodoPago:"PUE",usoCfdi:"G03",cliente:{razonSocial:"CONSERVAR CLIENTE",rfc:"XAXX010101000",codigoPostal:"53490",regimenFiscal:"616"}};
const client=app=>(url,{method="POST",data,token="admin-session"}={})=>fetch(app.baseUrl+url,{method,headers:{Cookie:`facturacion_access=${token}`,"Content-Type":"application/json"},...(data?{body:JSON.stringify(data)}:{})});
const posts=app=>app.state.requests.filter(r=>r.pathname==="/fake-facturama/api-lite/4/cfdis").length;
const consultas=app=>app.state.requests.filter(r=>r.pathname.startsWith("/fake-facturama/")).length;
const repo=app=>new SupabaseFacturaRepository({url:app.fakeUrl,serviceRoleKey:"FAKE-SERVICE-KEY"});
const fakePac=app=>new FacturamaSandboxService({username:"FAKE-SANDBOX-USER",password:"FAKE-SANDBOX-PASS",fetchImpl:async(url,options)=>{
  const u=new URL(url);assert.equal(u.origin,"https://apisandbox.facturama.mx");
  const r=await fetch(app.fakeUrl+"/fake-facturama"+u.pathname+u.search,options);
  return new Response(r.body,{status:r.status,headers:r.headers});
}});

async function pending(t,{emitida=false,legacy=false}={}){
  const app=await iniciarServidorVentaPrueba({sandbox:true});t.after(()=>app.cerrar());const request=client(app);
  const response=await request("/api/facturas",{data:datos});assert.equal(response.status,201);const f=await response.json();
  const original=solicitudSandbox(f,new Date("2026-10-29T19:06:58Z"));original.OrderNumber=f.id;
  // Seed a real old-format uncertain operation through the local provider fake.
  app.state.failFacturamaSinEmitir=!emitida;app.state.postFacturamaIncierto=emitida;
  await assert.rejects(fakePac(app).crear(original));
  app.state.failFacturamaSinEmitir=false;app.state.postFacturamaIncierto=false;
  const row=app.state.rows.find(r=>r.id===f.id);
  row.data.estatus="REVISION_SANDBOX";row.data.revision=randomUUID();
  row.data.timbradoSandbox={version:1,estado:"POR_CONFIRMAR",solicitud:structuredClone(original),huella:legacy?huellaSolicitudLegacy(restaurarFormatoLegacy(original)):huellaSolicitud(original),creadaEn:"2026-10-29T19:06:58.000Z",...(legacy?{}:{huellaVersion:2})};
  return{app,request,f,row,original,url:`/api/facturas/${f.id}/corregir-referencia-sandbox`,retry:`/api/facturas/${f.id}/reintentar-sandbox`,recover:`/api/facturas/${f.id}/recuperar-sandbox`};
}

test("ajusta solo OrderNumber, respalda el envío anterior y conserva folio, fecha, conceptos e importes",{timeout:25000},async t=>{
  const c=await pending(t,{legacy:true}),before=structuredClone(c.row.data),start=c.app.state.requests.length;
  const expected=structuredClone(c.original);delete expected.OrderNumber;
  c.app.state.beforeFacturama=async()=>{
    const op=c.row.data.timbradoSandbox;
    assert.equal(op.estado,"REENVIANDO");assert.deepEqual(op.solicitud,expected);
    assert.deepEqual(op.ajusteReferencia.solicitudAnterior,c.original);assert.equal(op.ajusteReferencia.huellaAnterior,before.timbradoSandbox.huella);
  };
  const r=await c.request(c.url,{data:{solicitud:{Folio:"IGNORAR",Date:"2000-01-01T00:00:00",Items:[]}}});
  assert.equal(r.status,200);const done=await r.json();
  assert.equal(done.estatus,"TIMBRADA_SANDBOX");assert.equal(done.documentosPendientes,false);
  assert.deepEqual(done.timbradoSandbox.solicitud,expected);assert.deepEqual(c.app.state.comprobantes[0].payload,expected);
  assert.deepEqual(done.timbradoSandbox.ajusteReferencia.solicitudAnterior,c.original);assert.equal(done.timbradoSandbox.ajusteReferencia.huellaVersionAnterior,1);
  assert.equal(done.id,c.f.id);assert.equal(done.folioInterno,c.f.folioInterno);assert.equal(done.total,before.total);assert.deepEqual(done.cliente,before.cliente);
  assert.equal(done.timbradoSandbox.huella,huellaSolicitud(expected));assert.equal(done.timbradoSandbox.reintentos,1);
  const calls=c.app.state.requests.slice(start);assert.ok(calls.findIndex(r=>r.pathname==="/fake-facturama/api-lite/4/cfdis")>calls.findIndex(r=>r.pathname==="/fake-facturama/cfdi"));
  assert.ok(c.app.state.auditoria.some(r=>r.accion==="REINTENTO_SANDBOX"&&r.detalle.referenciaAuxiliarOmitida));
  await c.app.reiniciar();
  for(const type of ["xml","pdf"]){const file=await c.request(`/api/facturas/${c.f.id}/documento/${type}`,{method:"GET"});assert.equal(file.status,200);assert.deepEqual(Buffer.from(await file.arrayBuffer()),c.app.state.documents.get(done[`${type}StoragePath`]));}
  assert.equal((await c.request(c.url)).status,409);assert.equal((await c.request(c.retry)).status,409);assert.equal(posts(c.app),2);
});

test("si el envío anterior ya existe, recupera su UUID y solicitud original sin ajustar ni reenviar",{timeout:25000},async t=>{
  const c=await pending(t,{emitida:true});c.app.state.sale.data.invoice_eligibility.status="review_required";
  const r=await c.request(c.url);assert.equal(r.status,200);const done=await r.json();
  assert.equal(done.estatus,"TIMBRADA_SANDBOX");assert.deepEqual(done.timbradoSandbox.solicitud,c.original);
  assert.equal(done.timbradoSandbox.ajusteReferencia,undefined);assert.equal(posts(c.app),1);assert.equal(c.app.state.comprobantes.length,1);
});

test("una consulta fallida o una coincidencia ambigua impiden ajustar y reenviar",{timeout:25000},async t=>{
  const c=await pending(t);c.app.state.failFacturamaConsulta=true;
  assert.equal((await c.request(c.url)).status,502);assert.equal(posts(c.app),1);
  c.app.state.failFacturamaConsulta=false;c.app.state.resultadoFacturamaAmbiguo={Id:"AMBIGUO",Folio:c.original.Folio,Serie:"OTRA"};
  const r=await c.request(c.url);assert.equal(r.status,409);assert.equal((await r.json()).codigo,"SANDBOX_COINCIDENCIA_NO_VERIFICADA");
  assert.deepEqual(c.row.data.timbradoSandbox.solicitud,c.original);assert.equal(c.row.data.timbradoSandbox.ajusteReferencia,undefined);assert.equal(posts(c.app),1);
});

test("venta modificada o ya no facturable conserva la solicitud anterior sin aplicar el ajuste",{timeout:25000},async t=>{
  const c=await pending(t);c.app.state.sale.data.invoice_eligibility.status="review_required";
  assert.equal((await c.request(c.url)).status,409);assert.equal(posts(c.app),1);
  assert.deepEqual(c.row.data.timbradoSandbox.solicitud,c.original);assert.equal(c.row.data.timbradoSandbox.ajusteReferencia,undefined);
});

test("otro 500 conserva ambas solicitudes; tras reiniciar, consulta y reintenta solo el envío ajustado",{timeout:25000},async t=>{
  const c=await pending(t);c.app.state.failFacturamaSinEmitir=true;
  assert.equal((await c.request(c.url)).status,502);const operation=structuredClone(c.row.data.timbradoSandbox);
  assert.equal(operation.estado,"POR_CONFIRMAR");assert.ok(!Object.hasOwn(operation.solicitud,"OrderNumber"));assert.deepEqual(operation.ajusteReferencia.solicitudAnterior,c.original);
  c.app.state.failFacturamaSinEmitir=false;await c.app.reiniciar();
  const absent=await c.request(c.recover);assert.equal(absent.status,409);assert.equal((await absent.json()).codigo,"SANDBOX_RESULTADO_NO_CONFIRMADO");assert.equal(posts(c.app),2);
  assert.equal((await c.request(c.url)).status,409);assert.equal(posts(c.app),2);
  const r=await c.request(c.retry);assert.equal(r.status,200);const done=await r.json();
  assert.deepEqual(done.timbradoSandbox.solicitud,operation.solicitud);assert.deepEqual(done.timbradoSandbox.ajusteReferencia,operation.ajusteReferencia);
  assert.equal(posts(c.app),3);assert.equal(c.app.state.comprobantes.length,1);
});

test("permisos, solicitud alterada e ID confirmado bloquean el ajuste antes de consultar",{timeout:25000},async t=>{
  const c=await pending(t),before=consultas(c.app);
  assert.equal((await c.request(c.url,{token:"view-session"})).status,403);
  c.row.data.timbradoSandbox.solicitud.Date="2000-01-01T00:00:00";
  let r=await c.request(c.url);assert.equal(r.status,409);assert.equal((await r.json()).codigo,"SANDBOX_SOLICITUD_MODIFICADA");
  c.row.data.timbradoSandbox.solicitud.Date=c.original.Date;c.row.data.timbradoSandbox.facturamaId="IDENTIFICADOR-GUARDADO";
  r=await c.request(c.url);assert.equal(r.status,409);assert.equal((await r.json()).codigo,"SANDBOX_REINTENTO_NO_PERMITIDO");assert.equal(consultas(c.app),before);
});

test("respaldo alterado o cambios fiscales ajenos al ajuste bloquean recuperación y reintento",{timeout:25000},async t=>{
  const c=await pending(t);c.app.state.failFacturamaSinEmitir=true;assert.equal((await c.request(c.url)).status,502);
  c.app.state.failFacturamaSinEmitir=false;const saved=structuredClone(c.row.data.timbradoSandbox),before=consultas(c.app);
  for(const mutate of [op=>{op.ajusteReferencia.solicitudAnterior.Date="2000-01-01T00:00:00"},op=>{op.solicitud.Items[0].Quantity=999;op.huella=huellaSolicitud(op.solicitud)}]){
    c.row.data.timbradoSandbox=structuredClone(saved);mutate(c.row.data.timbradoSandbox);
    for(const url of [c.retry,c.recover]){const r=await c.request(url);assert.equal(r.status,409);assert.equal((await r.json()).codigo,"SANDBOX_SOLICITUD_MODIFICADA");}
  }
  assert.equal(consultas(c.app),before);
});

test("dos instancias independientes solo pueden preparar y enviar un ajuste",{timeout:25000},async t=>{
  const c=await pending(t),storage=await fs.mkdtemp(path.join(os.tmpdir(),"noventia-referencia-"));t.after(()=>fs.rm(storage,{recursive:true,force:true}));
  const a=repo(c.app),b=repo(c.app),[one,two]=await Promise.all([a.findById(c.f.id),b.findById(c.f.id)]);
  const service=repository=>new TimbradoSandboxService({facturas:repository,pac:fakePac(c.app),storageRoot:storage});
  const gate=barreraPrueba();c.app.state.beforeFacturamaConsulta=gate.wait;t.after(()=>gate.release());
  const first=service(a).reintentar(one,{omitirReferenciaPedido:true});await gate.entered;
  try{await assert.rejects(service(b).reintentar(two,{omitirReferenciaPedido:true}),error=>error.code==="SANDBOX_FACTURA_ACTUALIZADA");}finally{gate.release();}
  const done=await first;assert.equal(done.estatus,"TIMBRADA_SANDBOX");assert.equal(posts(c.app),2);assert.equal(c.app.state.comprobantes.length,1);assert.deepEqual(done.timbradoSandbox.ajusteReferencia.solicitudAnterior,c.original);
});

test("una revisión concurrente durante la consulta impide guardar el ajuste o emitir",{timeout:25000},async t=>{
  const c=await pending(t),repository=repo(c.app),gate=barreraPrueba();c.app.state.beforeFacturamaConsulta=gate.wait;t.after(()=>gate.release());
  const first=c.request(c.url);await gate.entered;
  const current=await repository.findById(c.f.id),newer=await repository.compareAndUpdate(current,{notaRevision:"CONSERVAR_REVISION"});assert.ok(newer);
  gate.release();const r=await first;assert.equal(r.status,409);const saved=await repository.findById(c.f.id);
  assert.equal(saved.revision,newer.revision);assert.equal(saved.notaRevision,"CONSERVAR_REVISION");assert.deepEqual(saved.timbradoSandbox.solicitud,c.original);assert.equal(saved.timbradoSandbox.ajusteReferencia,undefined);assert.equal(posts(c.app),1);
});

test("un PDF pendiente conserva el UUID y el respaldo; recuperar documentos no vuelve a emitir",{timeout:25000},async t=>{
  const c=await pending(t);c.app.state.failPdf=true;const first=await c.request(c.url);assert.equal(first.status,200);const saved=await first.json();
  assert.equal(saved.documentosPendientes,true);assert.ok(saved.uuid);assert.equal((await c.request(c.url)).status,409);
  c.app.state.failPdf=false;await c.app.reiniciar();const r=await c.request(c.recover);assert.equal(r.status,200);const done=await r.json();
  assert.equal(done.uuid,saved.uuid);assert.equal(done.documentosPendientes,false);assert.deepEqual(done.timbradoSandbox.ajusteReferencia.solicitudAnterior,c.original);assert.equal(posts(c.app),2);
});

test("la corrección se rechaza en MOCK y en solicitudes nuevas que ya omiten la referencia",{timeout:25000},async t=>{
  const mock=await iniciarServidorVentaPrueba();t.after(()=>mock.cerrar());assert.equal((await client(mock)("/api/facturas/no-existe/corregir-referencia-sandbox")).status,409);
  const c=await pending(t);delete c.row.data.timbradoSandbox.solicitud.OrderNumber;c.row.data.timbradoSandbox.huella=huellaSolicitud(c.row.data.timbradoSandbox.solicitud);const before=consultas(c.app);
  const r=await c.request(c.url);assert.equal(r.status,409);assert.equal((await r.json()).codigo,"SANDBOX_REFERENCIA_NO_APLICABLE");assert.equal(consultas(c.app),before);
});

import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { randomUUID } from "node:crypto";
import { FacturamaSandboxService, FacturamaError, solicitudSandbox, resultadoSandbox, verificarXmlSandbox, decodificarDocumento, EMISOR_SANDBOX, RECEPTOR_SANDBOX } from "../backend/services/facturamaSandboxService.mjs";
import { configuracionTimbrado } from "../backend/config/timbrado.mjs";
import { TimbradoSandboxService } from "../backend/services/timbradoSandboxService.mjs";
import { LocalFacturaRepository } from "../backend/repositories/localFacturaRepository.mjs";
import { SupabaseFacturaRepository } from "../backend/repositories/supabaseFacturaRepository.mjs";
import { crearFactura } from "../shared/domain/factura.mjs";
import { normalizarVentaEcommerce } from "../backend/services/ecommerceVentaService.mjs";
import { ventaEjemplo } from "./fixtures/ecommerce.mjs";
import { estadoFacturaPortal } from "../backend/services/portalFacturasService.mjs";

const fixedDate = new Date("2026-10-29T20:34:56Z");
function draft(conceptos = [{ descripcion: "Compra de prueba", cantidad: 2, precioUnitario: 100, descuento: 10, claveUnidad: "H87", unidad: "Pieza" }]) {
  return crearFactura({ folioOrigen: `ORD-${randomUUID()}`, origen: "ECOMMERCE", formaPago: "03", metodoPago: "PUE", usoCfdi: "G03",
    cliente: { razonSocial: "CONSERVAR CLIENTE", rfc: "XAXX010101000", codigoPostal: "53490", regimenFiscal: "616" }, conceptos });
}
const fiscalUuid = "11111111-2222-4333-8444-555555555555";
function remote(p) { return { Id: "FAKE-CFDI-1", Folio: p.Folio, Serie: p.Serie, Date: p.Date, Issuer: p.Issuer, OrderNumber: p.OrderNumber, TaxStamp: { Uuid: fiscalUuid, Date: p.Date } }; }
function xml(p, total = "220.40", uuid = fiscalUuid) { return Buffer.from(`<?xml version="1.0"?><cfdi:Comprobante xmlns:cfdi="http://www.sat.gob.mx/cfd/4" xmlns:tfd="http://www.sat.gob.mx/TimbreFiscalDigital" Version="4.0" Moneda="MXN" TipoDeComprobante="I" Folio="${p.Folio}" Serie="${p.Serie}" Fecha="${p.Date}" Total="${total}"><cfdi:Emisor Rfc="${p.Issuer.Rfc}"/><cfdi:Receptor Rfc="${p.Receiver.Rfc}"/><cfdi:Complemento><tfd:TimbreFiscalDigital UUID="${uuid}"/></cfdi:Complemento></cfdi:Comprobante>`); }
const fakePdf = Buffer.from("%PDF-1.4\nDOCUMENTO ORIGINAL DE PRUEBA\n%%EOF");

test("payload conserva precio, descuento e IVA; usa identidades públicas sin modificar el cliente", () => {
  const f = draft(), original = structuredClone(f), p = solicitudSandbox(f, fixedDate);
  assert.deepEqual(f, original); assert.deepEqual(p.Issuer, EMISOR_SANDBOX); assert.deepEqual(p.Receiver, RECEPTOR_SANDBOX);
  assert.equal(p.Items[0].Subtotal, 200); assert.equal(p.Items[0].Discount, 10); assert.equal(p.Items[0].Taxes[0].Base, 190); assert.equal(p.Items[0].Taxes[0].Total, 30.4); assert.equal(p.Items[0].Total, 220.4);
  assert.equal(p.Date, "2026-10-29T14:34:56"); assert.equal(p.Folio, f.id.replaceAll("-", "")); assert.equal(p.ExpeditionPlace, "42501");
  assert.doesNotMatch(JSON.stringify(p), /CONSERVAR CLIENTE|53490|XAXX010101000/);
});

test("la compra API conserva 1449.00 incluyendo IVA, cupón y envío con seis decimales", () => {
  const sale = normalizarVentaEcommerce(ventaEjemplo()), f = draft(sale.productos), p = solicitudSandbox(f, fixedDate);
  assert.equal(f.total, 1449); assert.equal(p.Items.length, 3);
  assert.equal(Number(p.Items.reduce((s,c)=>s+c.Total,0).toFixed(2)), 1449);
  assert.equal(p.Items[0].UnitPrice, Number(sale.productos[0].precioUnitario));
  assert.equal(p.Items[2].Description, "Envío del pedido");
  assert.ok(p.Items.every(c => c.Taxes[0].Rate === 0.16));
});

test("bloquea importes alterados, claves inválidas y combinaciones de pago incompatibles", () => {
  const f = draft();
  for (const patch of [{ total: 1 }, { moneda: "USD" }, { formaPago: "99" }, { metodoPago: "PPD" }]) assert.throws(() => solicitudSandbox({ ...f, ...patch }), FacturamaError);
  assert.throws(() => solicitudSandbox(draft([{ descripcion: "Producto", cantidad: 1, precioUnitario: 100, claveProdServSat: "NO", unidad: "Pieza", claveUnidad: "H87" }])), /claves SAT/);
  assert.equal(solicitudSandbox({...f,metodoPago:"PPD",formaPago:"99"}).PaymentMethod,"PPD");
});

test("sandbox fijo: rechaza producción, HTTP, credenciales en URL y opciones desconocidas", () => {
  for (const baseUrl of ["http://apisandbox.facturama.mx", "https://api.facturama.mx", "https://apisandbox.facturama.mx.evil.invalid", "https://u:p@apisandbox.facturama.mx", "https://apisandbox.facturama.mx/?a=b", "https://apisandbox.facturama.mx/v1"]) assert.throws(() => new FacturamaSandboxService({ username:"test",password:"secret",baseUrl }), FacturamaError);
  assert.throws(() => new FacturamaSandboxService({ username:"TU_USUARIO",password:"secret" }));
  assert.equal(configuracionTimbrado({}).provider,"mock");
  assert.throws(() => configuracionTimbrado({TIMBRADO_PROVIDER:"facturama_produccion"}));
});

test("Basic se envía solo al sandbox, sin redirecciones, tokens de ecommerce ni reintentos", async () => {
  const calls = [], p = solicitudSandbox(draft(),fixedDate);
  const svc = new FacturamaSandboxService({username:"user",password:"secret:#$=",fetchImpl:async(url,options)=>{calls.push({url,options});return Response.json(remote(p));}});
  await svc.crear(p);
  assert.equal(calls.length,1); assert.equal(calls[0].url,"https://apisandbox.facturama.mx/api-lite/4/cfdis");
  assert.equal(calls[0].options.redirect,"error"); assert.equal(calls[0].options.headers.Authorization,`Basic ${Buffer.from("user:secret:#$=").toString("base64")}`);
  assert.doesNotMatch(JSON.stringify(svc), /secret|Basic/);
  await assert.rejects(svc.request("/api-lite/csds",{method:"POST",body:{}}),/no permitida/);
  assert.equal(calls.length,1);
});

test("errores remotos, HTML, redirecciones y fallos de red no filtran respuestas ni credenciales", async () => {
  for(const response of [()=>new Response('{"Message":"CLAVE_PRIVADA"}',{status:401}),()=>new Response("CLAVE_PRIVADA",{status:503}),()=>new Response("<html>CLAVE_PRIVADA</html>"),()=>{throw new Error("CLAVE_PRIVADA")}]){
    let calls=0;const svc=new FacturamaSandboxService({username:"user",password:"SECRETO",fetchImpl:async()=>{calls++;return response()}});
    await assert.rejects(svc.crear({}),e=>e instanceof FacturamaError && !/CLAVE_PRIVADA|SECRETO/.test(e.message)); assert.equal(calls,1);
  }
  const svc=new FacturamaSandboxService({username:"user",password:"SECRETO",fetchImpl:async()=>({ok:true,redirected:true})});
  await assert.rejects(svc.crear({}),/redirigir/);
});

test("el tiempo de espera aborta también la lectura de la respuesta",async()=>{
  let aborted=false;
  const svc=new FacturamaSandboxService({username:"user",password:"secret",timeoutMs:10,fetchImpl:async(_,options)=>new Response(new ReadableStream({start(controller){options.signal.addEventListener("abort",()=>{aborted=true;controller.error(new Error("SECRETO"))})}}))});
  await assert.rejects(svc.consultar("FAKE-1"),FacturamaError);assert.equal(aborted,true);
});

test("documentos: exige Base64 íntegro, PDF y XML con UUID, folio, identidades y total coincidentes",()=>{
  const f=draft(),p=solicitudSandbox(f,fixedDate),r=resultadoSandbox(remote(p));
  assert.equal(verificarXmlSandbox(xml(p),p,r,f),true);
  for(const bytes of [xml(p,"220.41"),xml(p,"220.40",randomUUID()),Buffer.from(xml(p).toString().replace(p.Issuer.Rfc,"AAA010101AAA")),Buffer.from('<!DOCTYPE cfdi>'+xml(p).toString())])assert.throws(()=>verificarXmlSandbox(bytes,p,r,f),FacturamaError);
  assert.deepEqual(decodificarDocumento({ContentEncoding:"base64",Content:fakePdf.toString("base64"),ContentLength:fakePdf.length},"pdf"),fakePdf);
  for(const data of [{ContentEncoding:"base64",Content:"%%%%"},{ContentEncoding:"base64",Content:fakePdf.toString("base64"),ContentLength:1},{ContentEncoding:"base64",Content:Buffer.from("NO PDF").toString("base64")}])assert.throws(()=>decodificarDocumento(data,"pdf"));
});

async function context(t){
  const directory=await fs.mkdtemp(path.join(os.tmpdir(),"noventia-sandbox-"));t.after(()=>fs.rm(directory,{recursive:true,force:true}));
  const facturas=new LocalFacturaRepository({file:path.join(directory,"facturas.json")}), f=await facturas.save(draft());
  const state={posts:0,gets:0,documents:0,payload:null,failPost:false,reject:false,failDocs:false,unknown:false};
  const pac={async crear(p){state.posts++;state.payload=structuredClone(p);if(state.reject)throw new FacturamaError("Rechazo simulado",{rechazo:true});if(state.failPost)throw new FacturamaError("Fallo simulado");return remote(p)},async consultar(){state.gets++;return remote(state.payload)},async localizar(){state.gets++;return state.unknown?null:remote(state.payload)},async documento(_,tipo){state.documents++;if(state.failDocs)throw new Error("ALMACEN_PRIVADO");return tipo==="xml"?xml(state.payload):fakePdf}};
  const create=options=>new TimbradoSandboxService({facturas,pac,storageRoot:path.join(directory,"storage"),now:()=>fixedDate,...options});
  return {directory,facturas,f,state,pac,create};
}

test("emisión guarda UUID y ambos originales; dos instancias con el mismo borrador solo envían un POST",async t=>{
  const c=await context(t),results=await Promise.allSettled([c.create().timbrar(c.f),c.create().timbrar(c.f)]);
  assert.equal(results.filter(r=>r.status==="fulfilled").length,1);assert.equal(c.state.posts,1);
  const f=await c.facturas.findById(c.f.id);assert.equal(f.estatus,"TIMBRADA_SANDBOX");assert.equal(f.documentosPendientes,false);assert.equal(f.timbradoSandbox.facturamaId,"FAKE-CFDI-1");
  assert.deepEqual(await fs.readFile(path.join(c.directory,"storage",f.pdfRelativePath)),fakePdf);assert.deepEqual(await fs.readFile(path.join(c.directory,"storage",f.xmlRelativePath)),xml(c.state.payload));
  assert.equal(estadoFacturaPortal(f).prueba,true);assert.match(estadoFacturaPortal(f).mensaje,/sin validez fiscal/);
});

test("fallo de PDF guarda la emisión y recupera sus archivos sin un segundo POST",async t=>{
  const c=await context(t);c.state.failDocs=true;
  const first=await c.create().timbrar(c.f);assert.equal(first.estatus,"TIMBRADA_SANDBOX");assert.equal(first.documentosPendientes,true);assert.equal(first.uuid,fiscalUuid.toUpperCase());
  c.state.failDocs=false;
  const restored=await c.create().recuperar(await c.facturas.findById(c.f.id));assert.equal(restored.documentosPendientes,false);assert.equal(c.state.posts,1);assert.equal(c.state.gets,1);
});

test("fallo de Storage conserva UUID e ID y permite recuperación tras reiniciar",async t=>{
  const c=await context(t);let fail=true,calls=0;
  const documentStorage={async guardarArchivos(){calls++;if(fail)throw new Error("DETALLE_PRIVADO");return {xmlStoragePath:"sandbox/x.xml",pdfStoragePath:"sandbox/x.pdf"}}};
  const first=await c.create({documentStorage}).timbrar(c.f);assert.equal(first.documentosPendientes,true);assert.ok(first.uuid);
  fail=false;
  const f=await new TimbradoSandboxService({facturas:new LocalFacturaRepository({file:c.facturas.file}),pac:c.pac,storageRoot:path.join(c.directory,"storage"),documentStorage}).recuperar(await c.facturas.findById(c.f.id));
  assert.equal(f.documentosPendientes,false);assert.equal(f.documentStorage,"supabase");assert.equal(calls,2);assert.equal(c.state.posts,1);
});

test("POST incierto bloquea el borrador y recupera el resultado únicamente con GET",async t=>{
  const c=await context(t);c.state.failPost=true;
  await assert.rejects(c.create().timbrar(c.f),/Fallo simulado/);
  let f=await c.facturas.findById(c.f.id);assert.equal(f.estatus,"REVISION_SANDBOX");const payload=structuredClone(f.timbradoSandbox.solicitud);
  f=await c.create().recuperar(f);assert.equal(f.estatus,"TIMBRADA_SANDBOX");assert.deepEqual(f.timbradoSandbox.solicitud,payload);assert.equal(c.state.posts,1);assert.equal(c.state.gets,1);
  assert.equal(await c.facturas.compareAndUpdate(c.f,{estatus:"BORRADOR"}),null);assert.equal(await c.facturas.delete(c.f.id,c.f),false);
});

test("si guardar el resultado del POST falla, el estado ENVIADO permite recuperar tras reinicio",async t=>{
  const c=await context(t),original=c.facturas.compareAndUpdate.bind(c.facturas);let once=true;
  c.facturas.compareAndUpdate=async(expected,patch)=>{if(patch.timbradoSandbox?.facturamaId&&once){once=false;throw new Error("DB no disponible")}return original(expected,patch)};
  await assert.rejects(c.create().timbrar(c.f),/DB no disponible/);
  const saved=await c.facturas.findById(c.f.id);assert.equal(saved.timbradoSandbox.estado,"ENVIADO");
  const f=await c.create().recuperar(saved);assert.equal(f.documentosPendientes,false);assert.equal(c.state.posts,1);
});

test("sin coincidencia después de un POST incierto no emite ni permite borrar la operación",async t=>{
  const c=await context(t);c.state.failPost=true;c.state.unknown=true;
  await assert.rejects(c.create().timbrar(c.f));const f=await c.facturas.findById(c.f.id);
  await assert.rejects(c.create().recuperar(f),/todavía no confirma/);await assert.rejects(c.create().timbrar(f));assert.equal(c.state.posts,1);assert.equal((await c.facturas.findById(c.f.id)).estatus,"REVISION_SANDBOX");
});

test("rechazo definitivo permite corregir; una edición previa impide enviar un borrador obsoleto",async t=>{
  const c=await context(t);c.state.reject=true;
  await assert.rejects(c.create().timbrar(c.f),/Rechazo simulado/);const f=await c.facturas.findById(c.f.id);assert.equal(f.estatus,"BORRADOR");assert.equal(f.timbradoSandbox,null);
  await c.facturas.update(f.id,{usoCfdi:"G01"});await assert.rejects(c.create().timbrar(f),e=>e.statusCode===409);assert.equal(c.state.posts,1);
});

test("recuperación filtra folio y emisor y exige identidad, fecha y serie exactas",async()=>{
  const p=solicitudSandbox(draft(),fixedDate),calls=[];
  const svc=new FacturamaSandboxService({username:"user",password:"secret",fetchImpl:async(url)=>{
    calls.push(url);
    if(new URL(url).pathname==="/cfdi")return Response.json([{Id:"WRONG-1",Folio:"otro",Serie:p.Serie},{Id:"WRONG-2",Folio:p.Folio,Serie:"OTRA"},{Id:"MATCH-1",Folio:p.Folio,Serie:p.Serie}]);
    return Response.json({...remote(p),Id:"MATCH-1"});
  }});
  assert.equal((await svc.localizar(p)).Id,"MATCH-1");assert.equal(calls.length,2);
  const q=new URL(calls[0]).searchParams;assert.equal(q.get("folio"),p.Folio);assert.equal(q.get("rfcIssuer"),p.Issuer.Rfc);assert.equal(q.get("type"),"issuedLite");
  assert.ok(calls.every(url=>!url.includes("WRONG")));
  const wrong=new FacturamaSandboxService({username:"user",password:"secret",fetchImpl:async(url)=>Response.json(new URL(url).pathname==="/cfdi"?[{Id:"MATCH-1",Folio:p.Folio,Serie:p.Serie}]:{...remote(p),Date:"2000-01-01T00:00:00"})});
  assert.equal(await wrong.localizar(p),null);
});

test("Supabase compara revisión y estado en PATCH/DELETE y admite registros previos sin revisión",async()=>{
  const original=globalThis.fetch,calls=[],f={...draft(),folioInterno:"NOV-FAC-000001",numero:1};
  globalThis.fetch=async(url,options)=>{calls.push({url,options});return Response.json([])};
  try{
    const repo=new SupabaseFacturaRepository({url:"https://example.invalid",serviceRoleKey:"FAKE-KEY"});
    assert.equal(await repo.compareAndUpdate(f,{estatus:"TIMBRANDO_SANDBOX"}),null);
    let q=new URL(calls[0].url).searchParams;assert.equal(q.get("data->>revision"),"is.null");assert.equal(q.get("data->>estatus"),"eq.BORRADOR");assert.equal(q.get("id"),`eq.${f.id}`);
    const data=JSON.parse(calls[0].options.body).data;assert.ok(data.revision);assert.equal(data.numero,undefined);assert.equal(data.folioInterno,undefined);
    assert.equal(await repo.delete(f.id,{...f,revision:"previous-revision"}),false);
    q=new URL(calls[1].url).searchParams;assert.equal(q.get("data->>revision"),"eq.previous-revision");assert.equal(calls[1].options.headers.Prefer,"return=representation");
  }finally{globalThis.fetch=original}
});

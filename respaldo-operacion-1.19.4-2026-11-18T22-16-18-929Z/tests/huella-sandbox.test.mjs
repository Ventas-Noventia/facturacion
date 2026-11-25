import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { crearFactura } from "../shared/domain/factura.mjs";
import { solicitudSandbox, FacturamaError } from "../backend/services/facturamaSandboxService.mjs";
import { huellaSolicitud, huellaSolicitudLegacy, verificarHuellaSolicitud, restaurarFormatoLegacy } from "../backend/services/huellaSandbox.mjs";
import { LocalFacturaRepository } from "../backend/repositories/localFacturaRepository.mjs";
import { TimbradoSandboxService } from "../backend/services/timbradoSandboxService.mjs";
import { diagnosticoError } from "../backend/security/diagnosticoError.mjs";
import { iniciarServidorVentaPrueba } from "./fixtures/ventaServidor.mjs";

const time = new Date("2026-10-29T18:00:00Z");
const reorder = value => Array.isArray(value) ? value.map(reorder) : value && typeof value === "object"
  ? Object.fromEntries(Object.keys(value).sort((a,b) => a.length-b.length || a.localeCompare(b)).map(key => [key,reorder(value[key])])) : value;
const input = { folioOrigen: "ORD-PRUEBA", origen: "ECOMMERCE", cliente: { razonSocial: "CLIENTE DE PRUEBA", rfc: "XAXX010101000", codigoPostal: "53490", regimenFiscal: "616" }, usoCfdi: "G03", formaPago: "03", metodoPago: "PUE", conceptos: [{ descripcion: "Primer artículo", cantidad: 2, precioUnitario: 100, descuento: 10, claveUnidad: "H87", unidad: "Pieza" }, { descripcion: "Segundo artículo", cantidad: 1, precioUnitario: 50, unidad: "Pieza", claveUnidad: "H87" }] };
const make = () => { const f=crearFactura(input); return { f, payload:solicitudSandbox(f,time) }; };
const uuid="11111111-2222-4333-8444-555555555555";

test("reproduce el defecto anterior: cambiar el orden JSON conserva valores pero cambia el SHA anterior", () => {
  const {payload}=make(),restored=reorder(payload);
  assert.deepEqual(restored,payload);
  assert.notEqual(huellaSolicitudLegacy(restored),huellaSolicitudLegacy(payload));
  assert.equal(huellaSolicitud(restored),huellaSolicitud(payload));
  assert.equal(verificarHuellaSolicitud({solicitud:restored,huella:huellaSolicitud(payload),huellaVersion:2}),true);
});

test("huella canónica mantiene el orden de conceptos e impuestos como información significativa", () => {
  const {payload}=make(),hash=huellaSolicitud(payload);
  const changed=structuredClone(payload);changed.Items.reverse();assert.notEqual(huellaSolicitud(changed),hash);
  changed.Items.reverse();changed.Items[0].Taxes[0].Rate=0.08;assert.notEqual(huellaSolicitud(changed),hash);
  assert.equal(huellaSolicitud(structuredClone(payload)),hash);
});

test("restaura la huella anterior después de reordenar todos los objetos, con y sin Discount", () => {
  const {payload}=make(),hash=huellaSolicitudLegacy(payload),restored=reorder(payload);
  assert.equal(JSON.stringify(restaurarFormatoLegacy(restored)),JSON.stringify(payload));
  assert.equal(verificarHuellaSolicitud({solicitud:restored,huella:hash}),true);
  assert.equal(verificarHuellaSolicitud({solicitud:restored,huella:hash,huellaVersion:1}),true);
  assert.equal(verificarHuellaSolicitud({solicitud:payload,huella:hash}),true);
});

test("compatibilidad anterior rechaza cambios reales, claves adicionales y versiones desconocidas", () => {
  const {payload}=make(),hash=huellaSolicitudLegacy(payload);
  const mutations=[p=>{p.Date="2000-01-01T00:00:00"},p=>{p.Folio="OTRO"},p=>{p.Items[0].Quantity=3},p=>{p.Items[0].UnitPrice=1},p=>{p.Items[0].Taxes[0].Total=0},p=>{p.Items.reverse()},p=>{p.Issuer.Rfc="AAA010101AAA"},p=>{p.Receiver.Rfc="AAA010101AAA"},p=>{p.extra="ignorar"}];
  for(const mutation of mutations){const p=structuredClone(payload);mutation(p);assert.equal(verificarHuellaSolicitud({solicitud:reorder(p),huella:hash}),false);}
  assert.equal(verificarHuellaSolicitud({solicitud:payload,huella:hash,huellaVersion:99}),false);
  assert.equal(verificarHuellaSolicitud({solicitud:payload,huella:"no valida"}),false);
  assert.equal(verificarHuellaSolicitud(null),false);
});

async function scenario(t,{found=true,changed=false}={}){
  const directory=await fs.mkdtemp(path.join(os.tmpdir(),"noventia-huella-"));t.after(()=>fs.rm(directory,{recursive:true,force:true}));
  const {f,payload}=make(),state={posts:0,gets:0,docs:0};
  const operation={version:1,estado:"POR_CONFIRMAR",solicitud:payload,huella:huellaSolicitudLegacy(payload),creadaEn:time.toISOString()};
  const record=reorder({...f,estatus:"REVISION_SANDBOX",timbradoSandbox:operation});
  if(changed)record.timbradoSandbox.solicitud.Items[0].Quantity=999;
  const facturas=new LocalFacturaRepository({file:path.join(directory,"facturas.json")}),saved=await facturas.save(record);
  const remote={Id:"FAKE-JSONB-1",Folio:payload.Folio,Date:payload.Date,Serie:payload.Serie,Issuer:payload.Issuer,TaxStamp:{Uuid:uuid,Date:payload.Date}};
  const xml=Buffer.from(`<cfdi:Comprobante xmlns:cfdi="http://www.sat.gob.mx/cfd/4" xmlns:tfd="http://www.sat.gob.mx/TimbreFiscalDigital" Version="4.0" Moneda="MXN" TipoDeComprobante="I" Folio="${payload.Folio}" Serie="${payload.Serie}" Fecha="${payload.Date}" Total="${f.total.toFixed(2)}"><cfdi:Emisor Rfc="${payload.Issuer.Rfc}"/><cfdi:Receptor Rfc="${payload.Receiver.Rfc}"/><tfd:TimbreFiscalDigital UUID="${uuid}"/></cfdi:Comprobante>`);
  const pac={async crear(){state.posts++;assert.fail("Recuperar no debe crear comprobantes")},async localizar(p){state.gets++;assert.deepEqual(p,payload);return found?remote:null},async consultar(){state.gets++;return remote},async documento(_,type){state.docs++;return type==="xml"?xml:Buffer.from("%PDF-1.4\nPRUEBA\n%%EOF")}};
  const create=()=>new TimbradoSandboxService({facturas,pac,storageRoot:path.join(directory,"storage")});
  return {facturas,saved,payload,state,create};
}

test("recupera una operación 1.17.1 reordenada y conserva folio/fecha sin otro POST",async t=>{
  const c=await scenario(t),updated=await c.create().recuperar(c.saved);
  assert.equal(updated.estatus,"TIMBRADA_SANDBOX");assert.equal(updated.documentosPendientes,false);assert.equal(updated.uuid,uuid);
  assert.equal(c.state.posts,0);assert.equal(c.state.gets,1);assert.equal(c.state.docs,2);
  assert.deepEqual(updated.timbradoSandbox.solicitud,c.payload);assert.equal(updated.timbradoSandbox.huellaVersion,2);assert.equal(updated.timbradoSandbox.huella,huellaSolicitud(c.payload));
  const after=await c.create().recuperar(await c.facturas.findById(c.saved.id));assert.equal(after.uuid,uuid);assert.equal(c.state.posts,0);
});

test("si Facturama no lo encuentra, devuelve código específico y mantiene el envío anterior bloqueado",async t=>{
  const c=await scenario(t,{found:false});
  await assert.rejects(c.create().recuperar(c.saved),error=>{assert.equal(error.statusCode,409);assert.equal(error.code,"SANDBOX_RESULTADO_NO_CONFIRMADO");assert.equal(diagnosticoError(error).body.codigo,error.code);return true});
  assert.equal(c.state.posts,0);assert.equal(c.state.gets,1);assert.equal(c.state.docs,0);assert.deepEqual((await c.facturas.findById(c.saved.id)).timbradoSandbox,c.saved.timbradoSandbox);
});

test("una solicitud realmente modificada permanece bloqueada antes de consultar al proveedor",async t=>{
  const c=await scenario(t,{changed:true});
  await assert.rejects(c.create().recuperar(c.saved),error=>error.code==="SANDBOX_SOLICITUD_MODIFICADA");
  assert.equal(c.state.posts,0);assert.equal(c.state.gets,0);assert.equal(c.state.docs,0);
});

test("HTTP: recuperación de registro anterior tras error remoto, con almacenamiento jsonb",{timeout:20000},async t=>{
  const app=await iniciarServidorVentaPrueba({sandbox:true});t.after(()=>app.cerrar());
  const request=(url,data)=>fetch(app.baseUrl+url,{method:"POST",headers:{Cookie:"facturacion_access=admin-session","Content-Type":"application/json"},...(data?{body:JSON.stringify(data)}:{})});
  const created=await request("/api/facturas",{...input,folioOrigen:"1842"});assert.equal(created.status,201);const f=await created.json();
  app.state.postFacturamaIncierto=true;
  assert.equal((await request(`/api/facturas/${f.id}/timbrar`)).status,502);
  const row=app.state.rows[0],operation=row.data.timbradoSandbox;
  // Emulate a record sent by 1.17.0/1.17.1 before this correction was deployed.
  operation.huella=huellaSolicitudLegacy(restaurarFormatoLegacy(operation.solicitud));delete operation.huellaVersion;
  row.data=reorder(row.data);const original=structuredClone(row.data.timbradoSandbox.solicitud);
  await app.reiniciar();
  const recovered=await request(`/api/facturas/${f.id}/recuperar-sandbox`);assert.equal(recovered.status,200);const done=await recovered.json();
  assert.equal(done.estatus,"TIMBRADA_SANDBOX");assert.equal(done.documentosPendientes,false);assert.equal(done.timbradoSandbox.huellaVersion,2);
  assert.deepEqual(done.timbradoSandbox.solicitud,original);assert.equal(app.state.comprobantes.length,1);
  assert.equal(app.state.requests.filter(r=>r.pathname==="/fake-facturama/api-lite/4/cfdis").length,1);
});

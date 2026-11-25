import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import { MockTimbradoService } from "../backend/services/mockTimbradoService.mjs";

const base={
  id:"TEST-XML",
  folioOrigen:"TEST-XML",
  creadaEn:new Date().toISOString(),
  formaPago:"03",
  metodoPago:"PUE",
  subtotal:100,
  total:116,
  impuestos:16,
  tasaIva:.16,
  usoCfdi:"G03",
  cliente:{rfc:"XAXX010101000",razonSocial:"PUBLICO EN GENERAL",codigoPostal:"54700",regimenFiscal:"616"},
  conceptos:[{sku:"SKU1",descripcion:"Producto",cantidad:1,precioUnitario:100,claveUnidad:"H87",unidad:"Pieza",tasaIva:.16,calculo:{subtotal:100,impuesto:16}}]
};

test("XML mock incluye CFDI 4.0 e impuestos cuando hay IVA",async()=>{
  const svc=new MockTimbradoService();
  const r=await svc.timbrar(base);
  const file=path.join(new URL("../backend/storage/",import.meta.url).pathname,r.xmlRelativePath);
  const xml=await fs.readFile(file,"utf8");
  assert.match(xml,/Version="4.0"/);
  assert.match(xml,/<cfdi:Emisor/);
  assert.match(xml,/<cfdi:Receptor/);
  assert.match(xml,/<cfdi:Concepto/);
  assert.match(xml,/Impuesto="002"/);
});

test("XML mock omite nodo global de impuestos cuando IVA es cero",async()=>{
  const svc=new MockTimbradoService();
  const f={...base,folioOrigen:"TEST-XML-SIN-IVA",impuestos:0,total:100,tasaIva:0,conceptos:[{...base.conceptos[0],tasaIva:0,calculo:{subtotal:100,impuesto:0}}]};
  const r=await svc.timbrar(f);
  const file=path.join(new URL("../backend/storage/",import.meta.url).pathname,r.xmlRelativePath);
  const xml=await fs.readFile(file,"utf8");
  assert.doesNotMatch(xml,/TotalImpuestosTrasladados=/);
});

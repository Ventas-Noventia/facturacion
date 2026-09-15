import test from "node:test";
import assert from "node:assert/strict";
import { crearFactura } from "../shared/domain/factura.mjs";

const base = {
  origen:"WHATSAPP",
  folioOrigen:"WA-001",
  cliente:{
    razonSocial:"PUBLICO EN GENERAL",
    rfc:"XAXX010101000",
    codigoPostal:"54700",
    regimenFiscal:"616"
  },
  usoCfdi:"S01",
  formaPago:"03",
  metodoPago:"PUE",
  conceptos:[{
    descripcion:"Prueba",
    cantidad:1,
    precioUnitario:100,
    unidad:"Pieza",
    claveUnidad:"H87",
    tasaIva:.16
  }]
};

test("crea borrador con forma y método de pago",()=>{
  const f=crearFactura(base);
  assert.equal(f.total,116);
  assert.equal(f.formaPago,"03");
  assert.equal(f.metodoPago,"PUE");
  assert.equal(f.conceptos[0].unidad,"Pieza");
  assert.equal(f.conceptos[0].claveUnidad,"H87");
});

test("rechaza PPD con forma distinta de 99",()=>{
  assert.throws(
    ()=>crearFactura({...base,metodoPago:"PPD",formaPago:"03"}),
    /forma de pago debe ser 99/i
  );
});

test("acepta PPD con forma 99",()=>{
  const f=crearFactura({...base,metodoPago:"PPD",formaPago:"99"});
  assert.equal(f.metodoPago,"PPD");
  assert.equal(f.formaPago,"99");
});

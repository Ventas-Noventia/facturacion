import test from "node:test";
import assert from "node:assert/strict";
import { calcularConcepto, calcularTotales } from "../shared/domain/calculos.mjs";

test("calcula IVA y total",()=>{
  assert.deepEqual(
    calcularConcepto({cantidad:2,precioUnitario:100,tasaIva:.16}),
    {bruto:200,descuento:0,subtotal:200,impuesto:32,total:232}
  );
});

test("suma varios conceptos",()=>{
  const r=calcularTotales([
    {cantidad:1,precioUnitario:100,tasaIva:.16},
    {cantidad:2,precioUnitario:50,tasaIva:.16}
  ]);
  assert.equal(r.total,232);
});

test("rechaza cantidad cero",()=>{
  assert.throws(()=>calcularConcepto({cantidad:0,precioUnitario:100}),/cantidad/i);
});

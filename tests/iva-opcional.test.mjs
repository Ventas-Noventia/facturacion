import test from "node:test";
import assert from "node:assert/strict";
import { calcularTotales } from "../shared/domain/calculos.mjs";

test("factura con IVA 16%",()=>{
  const r=calcularTotales([{cantidad:1,precioUnitario:100,tasaIva:.16}]);
  assert.equal(r.subtotal,100);
  assert.equal(r.impuestos,16);
  assert.equal(r.total,116);
});

test("factura sin IVA",()=>{
  const r=calcularTotales([{cantidad:1,precioUnitario:100,tasaIva:0}]);
  assert.equal(r.subtotal,100);
  assert.equal(r.impuestos,0);
  assert.equal(r.total,100);
});

test("factura con IVA 8%",()=>{
  const r=calcularTotales([{cantidad:1,precioUnitario:100,tasaIva:.08}]);
  assert.equal(r.impuestos,8);
  assert.equal(r.total,108);
});

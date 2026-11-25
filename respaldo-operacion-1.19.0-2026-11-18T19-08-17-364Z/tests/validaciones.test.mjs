import test from "node:test";
import assert from "node:assert/strict";
import { validarRfcBasico, validarDatosFactura } from "../shared/domain/validaciones.mjs";

test("RFC genérico válido",()=>assert.equal(validarRfcBasico("XAXX010101000"),true));
test("RFC corto inválido",()=>assert.equal(validarRfcBasico("ABC123"),false));

test("detecta datos faltantes",()=>{
  const r=validarDatosFactura({cliente:{},conceptos:[]});
  assert.equal(r.valido,false);
  assert.ok(r.errores.length>=5);
});

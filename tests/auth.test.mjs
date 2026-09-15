import test from "node:test";
import assert from "node:assert/strict";
import { LocalAuthService } from "../backend/services/localAuthService.mjs";
const auth = new LocalAuthService();

test("ADMIN puede gestionar usuarios",()=>assert.equal(auth.can("ADMIN","usuarios:gestionar"),true));
test("FACTURACION puede timbrar",()=>assert.equal(auth.can("FACTURACION","facturas:timbrar"),true));
test("CONSULTA no puede timbrar",()=>assert.equal(auth.can("CONSULTA","facturas:timbrar"),false));
test("CONSULTA puede descargar",()=>assert.equal(auth.can("CONSULTA","facturas:descargar"),true));

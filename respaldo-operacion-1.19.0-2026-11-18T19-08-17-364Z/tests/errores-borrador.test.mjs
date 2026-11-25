import test from "node:test";
import assert from "node:assert/strict";
import { crearFactura, DatosFacturaError } from "../shared/domain/factura.mjs";
import { diagnosticoError } from "../backend/security/diagnosticoError.mjs";
import { SupabaseFacturaError } from "../backend/repositories/supabaseFacturaError.mjs";
import { SupabaseFacturaRepository } from "../backend/repositories/supabaseFacturaRepository.mjs";
import { iniciarServidorVentaPrueba } from "./fixtures/ventaServidor.mjs";

const draft = { folioOrigen: "1842", origen: "MANUAL", formaPago: "03", metodoPago: "PUE", usoCfdi: "G03", cliente: { razonSocial: "CLIENTE PRUEBA", rfc: "XAXX010101000", codigoPostal: "53490", regimenFiscal: "616" }, conceptos: [{ orderItemId: 1, descripcion: "Prueba", cantidad: 1, precioUnitario: 100, unidad: "Pieza", claveUnidad: "H87" }] };
const client = app => (data = draft) => fetch(app.baseUrl + "/api/facturas", { method: "POST", headers: { Cookie: "facturacion_access=admin-session", "Content-Type": "application/json" }, body: JSON.stringify(data) });
const validUuid = value => /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i.test(value);

test("validación del borrador produce 400 y mensajes útiles sin convertir entradas inválidas en 500", () => {
  const valid = { ...draft, folioOrigen: "INTERNO-PRUEBA" };
  for (const patch of [{ cliente: { ...draft.cliente, razonSocial: 123 } }, { cliente: { ...draft.cliente, codigoPostal: "" } }, { conceptos: [null] }, { conceptos: [] }, { conceptos: [{ ...draft.conceptos[0], cantidad: -1 }] }, { metodoPago: "PPD" }]) {
    assert.throws(() => crearFactura({ ...valid, ...patch }), error => error instanceof DatosFacturaError && error.statusCode === 400);
  }
  assert.equal(crearFactura(valid).total, 116);
});

test("diagnóstico inesperado muestra referencia y ubicación sin registrar mensaje, datos ni secretos", () => {
  const error = new Error("CLAVE_PRIVADA RFC_CLIENTE SQL_PRIVADO");
  error.requestBody = draft; error.authorization = "Bearer CLAVE_PRIVADA";
  error.stack = "Error: CLAVE_PRIVADA\n at save (file:///Users/privado/proyecto/backend/server.mjs:501:7)";
  const logs = [], diagnostic = diagnosticoError(error, "GUARDAR_BORRADOR", { log: (...args) => logs.push(args) });
  assert.equal(diagnostic.statusCode, 500); assert.equal(diagnostic.body.codigo, "ERROR_INTERNO"); assert.ok(validUuid(diagnostic.body.referencia));
  assert.match(diagnostic.body.error, /Referencia:/); assert.match(JSON.stringify(logs), /backend\/server.mjs/);
  assert.doesNotMatch(JSON.stringify({ logs, diagnostic }), /CLAVE_PRIVADA|RFC_CLIENTE|SQL_PRIVADO|Users\/privado|razonSocial/);
  assert.equal(diagnosticoError(new DatosFacturaError("Falta código postal"), "VALIDAR_BORRADOR", { log: () => assert.fail("No requiere bitácora de error interno") }).statusCode, 400);
});

test("errores de Supabase conservan código y columna permitida sin mensajes ni filas privadas", () => {
  for (const [code, pattern] of [["42703", /Falta una columna/], ["PGRST204", /Falta una columna/], ["42P01", /tabla/], ["42501", /rechazó el acceso/], ["23514", /validación de la base/]]) {
    const error = new SupabaseFacturaError({ code, status: 400, remoteMessage: 'column facturas.folio_origen is missing. CLAVE_PRIVADA RFC_CLIENTE' });
    assert.match(error.message, pattern); assert.match(error.message, new RegExp(code));
    if (["42703", "PGRST204"].includes(code)) assert.equal(error.column, "folio_origen");
    const logs = [], diagnostic = diagnosticoError(error, "GUARDAR_BORRADOR", { log: (...args) => logs.push(args) });
    assert.ok(validUuid(diagnostic.body.referencia)); assert.doesNotMatch(JSON.stringify({ error, logs, diagnostic }), /CLAVE_PRIVADA|RFC_CLIENTE/);
  }
});

test("repositorio clasifica errores HTTP, conexión, JSON inválido y respuesta de guardado vacía", async t => {
  const original = globalThis.fetch; t.after(() => { globalThis.fetch = original; });
  const repo = new SupabaseFacturaRepository({ url: "https://example.invalid", serviceRoleKey: "CLAVE_PRIVADA" });
  const cases = [
    [async () => Response.json({ code: "23514", message: "SQL_PRIVADO", details: "RFC_CLIENTE" }, { status: 400 }), /23514/],
    [async () => { throw new Error("CLAVE_PRIVADA"); }, /CONEXION/],
    [async () => new Response("<html>SQL_PRIVADO</html>"), /RESPUESTA_INVALIDA/],
    [async () => Response.json([]), /RESPUESTA_INVALIDA/]
  ];
  for (const [fetchImpl, message] of cases) {
    globalThis.fetch = fetchImpl;
    await assert.rejects(repo.save(crearFactura(draft)), error => { assert.ok(error instanceof SupabaseFacturaError); assert.match(error.message, message); assert.doesNotMatch(JSON.stringify(error), /CLAVE_PRIVADA|SQL_PRIVADO|RFC_CLIENTE/); return true; });
  }
});

test("HTTP: datos fiscales incompletos devuelven 400 antes del INSERT y sin emitir CFDI", { timeout: 15000 }, async t => {
  const app = await iniciarServidorVentaPrueba({ sandbox: true }); t.after(() => app.cerrar());
  const response = await client(app)({ ...draft, cliente: { ...draft.cliente, codigoPostal: "" } });
  assert.equal(response.status, 400); const data = await response.json(); assert.match(data.error, /Código postal inválido/); assert.equal(data.codigo, "DATOS_FACTURA_INVALIDOS");
  assert.equal(app.state.rows.length, 0); assert.equal(app.state.comprobantes.length, 0); assert.equal(app.errores(), "");
});

test("HTTP: columna faltante devuelve código y referencia; el servidor continúa respondiendo", { timeout: 15000 }, async t => {
  const app = await iniciarServidorVentaPrueba({ sandbox: true }); t.after(() => app.cerrar());
  app.state.facturasError = { method: "GET", status: 400, code: "42703", message: "column facturas.folio_origen does not exist SQL_PRIVADO", details: "CLAVE_PRIVADA RFC_CLIENTE" };
  const response = await client(app)(); assert.equal(response.status, 502); const data = await response.json();
  assert.match(data.error, /folio_origen/); assert.equal(data.codigo, "SUPABASE_42703"); assert.ok(validUuid(data.referencia));
  assert.doesNotMatch(JSON.stringify(data) + app.errores(), /SQL_PRIVADO|CLAVE_PRIVADA|RFC_CLIENTE/);
  const health = await (await fetch(app.baseUrl + "/api/health")).json(); assert.equal(health.ok, true); assert.equal(health.version, "1.19.0");
  app.state.facturasError = null;
  assert.equal((await client(app)()).status, 201); assert.equal(app.state.rows.length, 1); assert.equal(app.state.comprobantes.length, 0);
});

test("HTTP: restricción al guardar registra etapa y código sin exponer la fila rechazada", { timeout: 15000 }, async t => {
  const app = await iniciarServidorVentaPrueba({ sandbox: true }); t.after(() => app.cerrar());
  app.state.facturasError = { method: "POST", status: 400, code: "23514", message: "SQL_PRIVADO", details: "RFC_CLIENTE CLAVE_PRIVADA" };
  const response = await client(app)(); assert.equal(response.status, 502); const data = await response.json();
  assert.equal(data.codigo, "SUPABASE_23514"); assert.match(data.error, /validación de la base/); assert.ok(validUuid(data.referencia));
  await new Promise(resolve => setTimeout(resolve, 10));
  assert.match(app.errores(), /GUARDAR_BORRADOR/); assert.match(app.errores(), /23514/); assert.doesNotMatch(app.errores() + JSON.stringify(data), /SQL_PRIVADO|RFC_CLIENTE|CLAVE_PRIVADA/);
  assert.equal(app.state.rows.length, 0); assert.equal(app.state.comprobantes.length, 0);
});

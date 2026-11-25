import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { LocalFacturaRepository } from "../backend/repositories/localFacturaRepository.mjs";
import { SupabaseFacturaRepository } from "../backend/repositories/supabaseFacturaRepository.mjs";
import { MockTimbradoService } from "../backend/services/mockTimbradoService.mjs";
import { crearFactura } from "../shared/domain/factura.mjs";
import { normalizarVentaEcommerce } from "../backend/services/ecommerceVentaService.mjs";
import { ventaEjemplo } from "./fixtures/ecommerce.mjs";

async function temporary(t) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "noventia-facturas-"));
  t.after(() => fs.rm(dir, { recursive: true, force: true }));
  return dir;
}
const borrador = (id, folio, ecommerceId) => ({ id, folioOrigen: folio, estatus: "BORRADOR", creadaEn: "2026-10-28T18:00:00Z", ...(ecommerceId ? { pedido: { fuente: "ECOMMERCE_API", ecommerceId } } : {}) });

test("dos repositorios locales rechazan guardados simultaneos del mismo pedido sin perder datos", async t => {
  const file = path.join(await temporary(t), "data", "facturas.json");
  const a = new LocalFacturaRepository({ file }), b = new LocalFacturaRepository({ file });
  const results = await Promise.allSettled(Array.from({ length: 20 }, (_, i) => (i % 2 ? a : b).save(borrador(`id-${i}`, "ORD-PRUEBA", 1842))));
  assert.equal(results.filter(r => r.status === "fulfilled").length, 1);
  assert.ok(results.filter(r => r.status === "rejected").every(r => r.reason.statusCode === 409));
  const saved = await new LocalFacturaRepository({ file }).list();
  assert.equal(saved.length, 1); assert.equal(saved[0].folioInterno, "NOV-FAC-000001");
  await a.save(borrador("otro", "BAZ-002"));
  assert.equal((await b.list()).length, 2);
  assert.deepEqual((await fs.readdir(path.dirname(file))).sort(), ["facturas.json"]);
});

test("concurrentes de pedidos distintos conservan todos los folios y actualizaciones", async t => {
  const file = path.join(await temporary(t), "facturas.json");
  const a = new LocalFacturaRepository({ file }), b = new LocalFacturaRepository({ file });
  await Promise.all(Array.from({ length: 20 }, (_, i) => (i % 2 ? a : b).save(borrador(`id-${i}`, `NV-${i}`))));
  await Promise.all([a.update("id-0", { comentario: "conservar" }), b.delete("id-1"), a.save(borrador("nuevo", "ALM-NUEVO"))]);
  const rows = await b.list();
  assert.equal(rows.length, 20); assert.equal(new Set(rows.map(f => f.folioInterno)).size, 20);
  assert.equal((await a.findById("id-0")).comentario, "conservar");
  assert.equal(await a.findById("id-1"), null);
  assert.equal((await a.findById("nuevo")).numero, 21);
  assert.equal((await a.page({ q: "ALM-NUEVO" })).total, 1);
});

test("la identidad API y el folio normalizado bloquean duplicados; cancelar libera solo el pedido", async t => {
  const repo = new LocalFacturaRepository({ file: path.join(await temporary(t), "facturas.json") });
  const original = await repo.save(borrador("primera", "ORD-ORIGINAL", 1842));
  await assert.rejects(repo.save(borrador("por-id", "ORD-OTRO-FOLIO", "1842")), e => e.statusCode === 409);
  await assert.rejects(repo.save(borrador("por-folio", " ord-original ", 9999)), e => e.statusCode === 409);
  assert.equal((await repo.findByEcommerceId("1842")).id, original.id);
  await repo.update(original.id, { estatus: "CANCELADA_MOCK" });
  assert.equal(await repo.findByEcommerceId(1842), null);
  const replacement = await repo.save(borrador("reemplazo", "ORD-ORIGINAL", 1842));
  assert.notEqual(original.folioInterno, replacement.folioInterno);
  await assert.rejects(repo.update(original.id, { estatus: "BORRADOR" }), e => e.statusCode === 409);
  assert.equal((await repo.findById(original.id)).estatus, "CANCELADA_MOCK");
});

test("los errores 23505 de Supabase se convierten en conflicto entendible sin exponer detalles SQL", async t => {
  const original = globalThis.fetch; t.after(() => { globalThis.fetch = original; });
  globalThis.fetch = async () => new Response(JSON.stringify({ code: "23505", message: "duplicate key SECRETO_SQL", details: "datos internos" }), { status: 409 });
  const repo = new SupabaseFacturaRepository({ url: "https://supabase.example.invalid", serviceRoleKey: "FAKE-KEY" });
  await assert.rejects(repo.save(borrador("id", "ORD-PRUEBA", 1842)), error => {
    assert.equal(error.statusCode, 409); assert.equal(error.code, "FACTURA_DUPLICADA");
    assert.doesNotMatch(error.message, /SECRETO_SQL|datos internos/); return true;
  });
});

test("cada emision mock conserva sus propios documentos aunque se reutilice el pedido", async t => {
  const storageRoot = await temporary(t), service = new MockTimbradoService({ storageRoot });
  const pedido = normalizarVentaEcommerce(ventaEjemplo());
  const factura = crearFactura({ folioOrigen: pedido.folio, origen: "ECOMMERCE", formaPago: "03", metodoPago: "PUE", usoCfdi: "G03", cliente: { razonSocial: "CLIENTE DE PRUEBA", rfc: "XAXX010101000", codigoPostal: "53490", regimenFiscal: "616" }, conceptos: pedido.productos });
  const first = await service.timbrar({ ...factura, folioInterno: "NOV-FAC-000001" });
  const oldXml = await fs.readFile(path.join(storageRoot, first.xmlRelativePath));
  const oldPdf = await fs.readFile(path.join(storageRoot, first.pdfRelativePath));
  const second = await service.timbrar({ ...factura, id: "otra-factura", folioInterno: "NOV-FAC-000002" });
  const retry = await service.timbrar({ ...factura, folioInterno: "NOV-FAC-000001" });
  assert.equal(new Set([first.uuid, second.uuid, retry.uuid]).size, 3);
  assert.equal(new Set([first.xmlRelativePath, second.xmlRelativePath, retry.xmlRelativePath]).size, 3);
  assert.deepEqual(await fs.readFile(path.join(storageRoot, first.xmlRelativePath)), oldXml);
  assert.deepEqual(await fs.readFile(path.join(storageRoot, first.pdfRelativePath)), oldPdf);
  assert.match(oldXml.toString(), /Total="1449.00"/);
});

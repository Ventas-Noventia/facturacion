import test from "node:test";
import assert from "node:assert/strict";
import { EcommerceJsonService } from "../backend/services/ecommerceJsonService.mjs";
import { FirebaseJsonService } from "../backend/services/firebaseJsonService.mjs";
import { PedidosService } from "../backend/services/pedidosService.mjs";

const service = new PedidosService({
  ecommerceService: new EcommerceJsonService(),
  firebaseService: new FirebaseJsonService()
});

test("WEB usa e-commerce", async () => {
  const p = await service.obtenerPedido("WEB-000101");
  assert.equal(p.fuente, "ECOMMERCE_JSON");
  assert.equal(p.productos.length, 2);
});

test("WA usa Firebase y une productos", async () => {
  const p = await service.obtenerPedido("WA-000123");
  assert.equal(p.fuente, "FIREBASE_JSON");
  assert.equal(p.productos.length, 2);
  assert.equal(p.totalPedido, 900);
});

test("BAZ usa Firebase", async () => {
  const p = await service.obtenerPedido("BAZ-000045");
  assert.equal(p.productos[0].descripcion, "Organizador para hogar");
});

test("folio inexistente devuelve null", async () => {
  assert.equal(await service.obtenerPedido("XX-999"), null);
});

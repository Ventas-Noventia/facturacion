import test from "node:test";
import assert from "node:assert/strict";
import { FirebaseJsonService } from "../backend/services/firebaseJsonService.mjs";
import { PedidosService } from "../backend/services/pedidosService.mjs";
import { SupabaseFacturaRepository } from "../backend/repositories/supabaseFacturaRepository.mjs";

test("las dos colecciones Firebase y la API se consultan por sus folios", async () => {
  const reads = [], apiReads = [];
  const db = { collection(name) { return { where(field, operator, value) { return { limit() { return { async get() {
    reads.push({ name, field, operator, value });
    const data = name === "solicitudes_whatsapp"
      ? { referencia: "NV-123", cliente: "Prueba", monto: 116, montoApartado: 116, productos: [{ clave: "A", nombre: "Artículo", cantidad: 1, precio: 116 }] }
      : { folio: "BAZ-123", tipoOperacion: "BAZ", nombreCliente: "Prueba", total: 116, montoApartado: 116, productos: [{ clave: "B", nombre: "Artículo B", cantidad: 1, costo: 116 }] };
    return { empty: false, docs: [{ id: "documento-test", data: () => data }] };
  } }; } }; } }; } };
  const service = new PedidosService({ firebaseService: new FirebaseJsonService({ db }), ecommerceService: { async obtenerPedido(folio) { apiReads.push(folio); return { folio, fuente: "ECOMMERCE_API" }; } } });
  assert.equal((await service.obtenerPedido("NV-123")).fuente, "FIRESTORE_SOLICITUDES_WHATSAPP");
  assert.equal((await service.obtenerPedido("BAZ-123")).fuente, "FIRESTORE_SURTIDOS");
  assert.equal((await service.obtenerPedido("ORD-123")).fuente, "ECOMMERCE_API");
  assert.equal((await service.obtenerPedido("1842")).fuente, "ECOMMERCE_API");
  assert.deepEqual(reads.map(read => read.name), ["solicitudes_whatsapp", "surtidos"]);
  assert.deepEqual(apiReads, ["ORD-123", "1842"]);
});

test("Firebase no disponible no bloquea ORD; un fallo de la API no bloquea NV", async () => {
  const apiOk = new PedidosService({ firebaseService: { async obtenerPedido() { throw new Error("Firebase caído"); } }, ecommerceService: { async obtenerPedido(folio) { return { folio }; } } });
  assert.equal((await apiOk.obtenerPedido("ORD-123")).folio, "ORD-123");
  assert.equal((await apiOk.obtenerPedido("OTRO-FOLIO")).folio, "OTRO-FOLIO");
  const firebaseOk = new PedidosService({ firebaseService: { async obtenerPedido(folio) { return { folio }; } }, ecommerceService: { async obtenerPedido() { throw new Error("API caída"); } } });
  assert.equal((await firebaseOk.obtenerPedido("NV-123")).folio, "NV-123");
});

test("los pedidos de API no se marcan en Firebase", async () => {
  let writes = 0;
  const service = new PedidosService({ firebaseService: { async marcarFacturado() { writes++; }, async desmarcarFacturado() { writes++; } }, ecommerceService: {} });
  assert.equal(await service.marcarFacturado({ fuente: "ECOMMERCE_API" }, {}), null);
  assert.equal(await service.desmarcarFacturado({ fuente: "ECOMMERCE_API" }), null);
  assert.equal(writes, 0);
});

test("Supabase busca la identidad numérica y omite facturas canceladas", async () => {
  const repo = new SupabaseFacturaRepository({ url: "https://test.supabase.co", serviceRoleKey: "test-key" });
  repo.request = async value => {
    const url = new URL(value);
    assert.equal(url.searchParams.get("data->pedido->>ecommerceId"), "eq.1842");
    assert.equal(url.searchParams.get("data->pedido->>fuente"), "eq.ECOMMERCE_API");
    return [{ id: "cancelada", data: { estatus: "CANCELADA_MOCK" } }, { id: "activa", data: { estatus: "BORRADOR", pedido: { ecommerceId: 1842 } } }];
  };
  assert.equal((await repo.findByEcommerceId(1842)).id, "activa");
});

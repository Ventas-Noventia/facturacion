import test from "node:test";
import assert from "node:assert/strict";
import { iniciarServidorVentaPrueba, barreraPrueba } from "./fixtures/ventaServidor.mjs";

const datosFactura = { folioOrigen: "1842", origen: "MANUAL", formaPago: "03", metodoPago: "PUE", usoCfdi: "G03", cliente: { razonSocial: "CLIENTE DE PRUEBA", rfc: "XAXX010101000", codigoPostal: "53490", regimenFiscal: "616" }, conceptos: [{ orderItemId: 1, descripcion: "NO CONFIAR", cantidad: 999, precioUnitario: 0, claveUnidad: "H87", unidad: "Pieza" }] };
const client = app => (url, { token = "admin-session", method = "GET", data } = {}) => fetch(app.baseUrl + url, { method, headers: { Cookie: `facturacion_access=${token}`, ...(data ? { "Content-Type": "application/json" } : {}) }, ...(data ? { body: JSON.stringify(data) } : {}) });

test("compra completa: ID y folio, importes originales, guardado, documentos y reinicio", { timeout: 25000 }, async t => {
  const app = await iniciarServidorVentaPrueba(); t.after(() => app.cerrar()); const request = client(app);
  const byId = await request("/api/pedidos?folio=1842"), byFolio = await request("/api/pedidos?folio=ORD-20261008-K7Q2M");
  assert.equal(byId.status, 200); assert.deepEqual(await byId.json(), await byFolio.json());
  const savedResponse = await request("/api/facturas", { method: "POST", data: datosFactura });
  assert.equal(savedResponse.status, 201); const saved = await savedResponse.json();
  assert.equal(saved.origen, "ECOMMERCE"); assert.equal(saved.folioOrigen, "ORD-20261008-K7Q2M");
  assert.equal(saved.pedido.ecommerceId, 1842); assert.equal(saved.total, 1449); assert.equal(saved.subtotal, 1249.14); assert.equal(saved.impuestos, 199.86);
  assert.equal(saved.conceptos.length, 3); assert.equal(saved.conceptos[0].cantidad, 1); assert.notEqual(saved.conceptos[0].descripcion, "NO CONFIAR");
  assert.equal(saved.conceptos[0].descuentoCuponVenta, "100.00"); assert.equal(saved.conceptos[1].descuentoCuponVenta, "50.00"); assert.equal(saved.conceptos[2].totalVentaLinea, "99.00");
  assert.equal((await request(`/api/facturas/${saved.id}/documento/pdf`)).status, 404);
  const stamped = await request(`/api/facturas/${saved.id}/timbrar`, { method: "POST" }); assert.equal(stamped.status, 200);
  const factura = await stamped.json(); assert.equal(factura.estatus, "TIMBRADA_MOCK"); assert.match(factura.uuid, /^MOCK-/);
  for (const tipo of ["pdf", "xml"]) {
    const response = await request(`/api/facturas/${saved.id}/documento/${tipo}`); assert.equal(response.status, 200);
    assert.match(response.headers.get("content-disposition"), new RegExp(`${saved.folioInterno}\\.${tipo}`));
    const bytes = Buffer.from(await response.arrayBuffer()); assert.deepEqual(bytes, app.state.documents.get(factura[`${tipo}StoragePath`]));
    if (tipo === "pdf") assert.equal(bytes.subarray(0, 8).toString(), "%PDF-1.4");
    else { assert.match(bytes.toString(), /Total="1449.00"/); assert.match(bytes.toString(), /Descripcion="Envío del pedido"/); assert.match(bytes.toString(), new RegExp(factura.uuid)); }
  }
  await app.reiniciar();
  const loaded = await request(`/api/facturas/${saved.id}`); assert.equal(loaded.status, 200); assert.equal((await loaded.json()).uuid, factura.uuid);
  assert.equal((await request(`/api/facturas/${saved.id}/documento/pdf`)).status, 200);
  for (const folio of ["1842", "ORD-20261008-K7Q2M"]) {
    assert.equal((await request(`/api/pedidos?folio=${folio}`)).status, 409);
    assert.equal((await request("/api/facturas", { method: "POST", data: { ...datosFactura, folioOrigen: folio } })).status, 409);
  }
  assert.equal((await request(`/api/facturas/${saved.id}/timbrar`, { method: "POST" })).status, 409);
  assert.equal((await request("/api/facturas", { method: "POST", token: "view-session", data: datosFactura })).status, 403);
  assert.equal(app.state.rows.length, 1);
  const publicData = JSON.stringify(factura); assert.doesNotMatch(publicData, /FAKE-(TOKEN|PASSWORD|USERNAME|SERVICE-KEY)/);
  assert.ok(app.state.requests.filter(r => r.pathname.startsWith("/fake-ecommerce/")).every(r => r.method === "GET" || (r.method === "POST" && r.pathname.endsWith("/auth/token"))));
});

test("portal: dos solicitudes simultaneas devuelven una factura y un conflicto sin detalles SQL", { timeout: 20000 }, async t => {
  const app = await iniciarServidorVentaPrueba(); t.after(() => app.cerrar()); const request = client(app);
  let entered = 0, release; const both = new Promise(resolve => { release = resolve; });
  app.state.beforeSave = async () => { if (++entered === 2) release(); await both; };
  t.after(() => release());
  const results = await Promise.all(["1842", "ORD-20261008-K7Q2M"].map(folioOrigen => request("/api/portal/facturas", { method: "POST", token: "customer-session", data: { ...datosFactura, folioOrigen } })));
  assert.deepEqual(results.map(r => r.status).sort(), [201, 409]);
  const conflict = await results.find(r => r.status === 409).json(); assert.match(conflict.error, /factura activa/); assert.doesNotMatch(conflict.error, /DETALLE_SQL_PRIVADO/);
  assert.equal(app.state.rows.length, 1); assert.equal(app.state.rows[0].data.total, 1449); assert.equal(app.state.rows[0].data.portalClienteId, "customer");
});

test("una operacion de timbrado bloquea doble clic, edicion y eliminacion hasta terminar", { timeout: 20000 }, async t => {
  const app = await iniciarServidorVentaPrueba(); t.after(() => app.cerrar()); const request = client(app);
  const saved = await (await request("/api/facturas", { method: "POST", data: datosFactura })).json();
  const gate = barreraPrueba(); app.state.beforeUpload = gate.wait; t.after(() => gate.release());
  const first = request(`/api/facturas/${saved.id}/timbrar`, { method: "POST" }); await gate.entered;
  try {
    for (const [suffix, method] of [["/timbrar", "POST"], ["", "PUT"], ["", "DELETE"], ["/cancelar", "POST"]]) {
      const response = await request(`/api/facturas/${saved.id}${suffix}`, { method, data: datosFactura });
      assert.equal(response.status, 409); assert.match((await response.json()).error, /operación en curso/);
    }
  } finally { gate.release(); }
  assert.equal((await first).status, 200);
  assert.equal(app.state.auditoria.filter(a => a.accion === "TIMBRADO").length, 1);
});

test("fallo de almacenamiento libera el bloqueo y permite reintentar sin marcar emitida", { timeout: 20000 }, async t => {
  const app = await iniciarServidorVentaPrueba(); t.after(() => app.cerrar()); const request = client(app);
  const saved = await (await request("/api/facturas", { method: "POST", data: datosFactura })).json();
  app.state.failUpload = true;
  assert.equal((await request(`/api/facturas/${saved.id}/timbrar`, { method: "POST" })).status, 500);
  assert.equal(app.state.rows[0].data.estatus, "BORRADOR"); assert.equal(app.state.rows[0].data.uuid, undefined);
  app.state.failUpload = false;
  assert.equal((await request(`/api/facturas/${saved.id}/timbrar`, { method: "POST" })).status, 200);
});

test("cambio de productos o reembolso bloquea timbrado aunque el total permanezca igual", { timeout: 20000 }, async t => {
  const app = await iniciarServidorVentaPrueba(); t.after(() => app.cerrar()); const request = client(app);
  const saved = await (await request("/api/facturas", { method: "POST", data: datosFactura })).json();
  app.state.sale.data.items[0].description = "Un producto diferente";
  assert.equal((await request(`/api/facturas/${saved.id}/timbrar`, { method: "POST" })).status, 409);
  app.state.sale.data.items[0].description = "Producto histórico A";
  app.state.sale.data.payment.status = "partially_refunded"; app.state.sale.data.payment.confirmed_refunded_amount = "100.00";
  assert.equal((await request(`/api/facturas/${saved.id}/timbrar`, { method: "POST" })).status, 409);
  assert.equal(app.state.documents.size, 0); assert.equal(app.state.rows[0].data.estatus, "BORRADOR");
});

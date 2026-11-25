import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import { normalizarVentaEcommerce, validarVentaParaFacturar, conceptosActualesEcommerce, ventaCoincideConFactura } from "../backend/services/ecommerceVentaService.mjs";
import { calcularTotales } from "../shared/domain/calculos.mjs";
import { crearFactura } from "../shared/domain/factura.mjs";
import { MockTimbradoService } from "../backend/services/mockTimbradoService.mjs";
import { ventaEjemplo } from "./fixtures/ecommerce.mjs";

test("el ejemplo A conserva 1449.00, aplica el cupón una vez e incluye envío", () => {
  const raw = ventaEjemplo(), before = structuredClone(raw);
  const order = normalizarVentaEcommerce(raw), totals = calcularTotales(order.productos);
  assert.deepEqual(raw, before);
  assert.equal(order.productos[0].precioUnitarioOriginal, "1000.00");
  assert.equal(order.productos[0].descuentoCuponVenta, "100.00");
  assert.equal(order.productos[1].descuentoCuponVenta, "50.00");
  assert.equal(order.productos[2].clave, "ENVIO");
  assert.equal(order.productos[2].totalVentaLinea, "99.00");
  assert.equal(totals.subtotal, 1249.14); assert.equal(totals.impuestos, 199.86); assert.equal(totals.total, 1449);
  assert.equal(order.requiereRevision, false); assert.doesNotThrow(() => validarVentaParaFacturar(order));
  assert.equal(order.datosFiscales.codigoPostal, null);
});

test("el ejemplo B conserva la venta original y bloquea el reembolso parcial", () => {
  const raw = ventaEjemplo();
  raw.data.items = [{ ...raw.data.items[0], sku: null, description: null, unit_price: "800.00", subtotal: "800.00" }];
  raw.data.totals = { subtotal: "800.00", discount: "0.00", shipping: "0.00", total: "800.00", currency: "MXN" };
  raw.data.payment = { ...raw.data.payment, status: "partially_refunded", amount: "800.00", confirmed_refunded_amount: "200.00" };
  raw.data.invoice_eligibility = { status: "review_required", reasons: ["partial_refund", "item_snapshot_missing"] };
  const order = normalizarVentaEcommerce(raw);
  assert.equal(order.totalPedido, 800); assert.equal(order.totalPagado, 800); assert.equal(order.reembolsoConfirmado, 200);
  assert.equal("saldoPendiente" in order, false); assert.equal(order.productos[0].sku, "");
  assert.throws(() => validarVentaParaFacturar(order), error => error.statusCode === 409);
});

test("el ejemplo C mantiene discount null y no inventa un descuento", () => {
  const raw = ventaEjemplo(); raw.data.totals.discount = null; raw.data.totals.total = "1650.00"; raw.data.payment.amount = "1650.00";
  raw.data.invoice_eligibility = { status: "review_required", reasons: ["amount_mismatch"] };
  const order = normalizarVentaEcommerce(raw);
  assert.equal(order.descuentoPedido, null); assert.equal(order.totalPedido, 1650);
  assert.ok(order.motivosRevision.includes("amount_mismatch")); assert.throws(() => validarVentaParaFacturar(order));
});

test("un total inconsistente se revisa aunque el proveedor diga eligible", () => {
  const raw = ventaEjemplo(); raw.data.items[0].subtotal = "1001.00";
  const order = normalizarVentaEcommerce(raw);
  assert.equal(order.requiereRevision, true); assert.throws(() => validarVentaParaFacturar(order));
});

test("el cálculo no pierde centavos en importes pequeños, cantidades o cupones", () => {
  for (const [price, qty, coupon, shipping] of [[1,1,0,0],[4,1,0,0],[7,3,1,4],[33333,3,5555,9999],[100,10,1,0]]) {
    const fmt = cents => (cents / 100).toFixed(2), raw = ventaEjemplo();
    raw.data.items = [{ ...raw.data.items[0], unit_price: fmt(price), quantity: qty, subtotal: fmt(price * qty) }];
    const total = price * qty - coupon + shipping;
    raw.data.totals = { subtotal: fmt(price * qty), discount: fmt(coupon), shipping: fmt(shipping), total: fmt(total), currency: "MXN" };
    raw.data.payment.amount = fmt(total);
    const order = normalizarVentaEcommerce(raw);
    assert.equal(order.requiereRevision, false, JSON.stringify([price,qty,coupon,shipping]));
    assert.equal(Math.round(calcularTotales(order.productos).total * 100), total);
  }
});

test("el reparto del cupón conserva el centavo restante", () => {
  const raw = ventaEjemplo();
  raw.data.items = [1,2,3].map(id => ({ ...raw.data.items[0], order_item_id: id, unit_price: "0.01", subtotal: "0.01" }));
  raw.data.totals = { subtotal: "0.03", discount: "0.01", shipping: "0.00", total: "0.02", currency: "MXN" };
  raw.data.payment.amount = "0.02";
  const order = normalizarVentaEcommerce(raw);
  assert.deepEqual(order.productos.map(p => p.descuentoCuponVenta), ["0.01", "0.00", "0.00"]);
  assert.equal(calcularTotales(order.productos).total, 0.02);
});

test("los importes o cantidades del navegador no sustituyen la venta", () => {
  const order = normalizarVentaEcommerce(ventaEjemplo());
  const concepts = conceptosActualesEcommerce(order, [{ orderItemId: 1, cantidad: 999, precioUnitario: 0, unidad: "Pieza", claveUnidad: "H87", claveProdServSat: "TEST" }]);
  assert.equal(concepts[0].cantidad, 1); assert.equal(concepts[0].precioUnitario, order.productos[0].precioUnitario);
  assert.equal(concepts[0].claveProdServSat, "TEST"); assert.equal(calcularTotales(concepts).total, 1449);
});

test("no acepta otra moneda ni importes convertidos a float por el proveedor", () => {
  const raw = ventaEjemplo(); raw.data.order.currency = "USD"; assert.throws(() => normalizarVentaEcommerce(raw), /MXN/);
  const malformed = ventaEjemplo(); malformed.data.items[0].unit_price = 1000;
  assert.throws(() => normalizarVentaEcommerce(malformed), /importe inválido/);
});

test("un pago no confirmado se bloquea aunque la señal remota sea eligible", () => {
  const raw = ventaEjemplo(); raw.data.payment.status = "pending";
  assert.throws(() => validarVentaParaFacturar(normalizarVentaEcommerce(raw)), /pago no está confirmado/);
});

test("antes de timbrar se detecta un cambio de artículos aunque el total sea igual", () => {
  const order = normalizarVentaEcommerce(ventaEjemplo());
  const invoice = { total: 1449, pedido: { ecommerceId: order.ecommerceId, importesOrigen: { ...order.importesOrigen } }, conceptos: order.productos };
  assert.equal(ventaCoincideConFactura(order, invoice), true);
  const raw = ventaEjemplo(); raw.data.items[0].name = "Artículo distinto"; raw.data.items[0].description = "Artículo reemplazado";
  assert.equal(ventaCoincideConFactura(normalizarVentaEcommerce(raw), invoice), false);
  const reordered = { ...order, productos: [...order.productos].reverse(), importesOrigen: { currency: "MXN", total: "1449.00", shipping: "99.00", discount: "150.00", subtotal: "1500.00", nuevoCampo: true } };
  assert.equal(ventaCoincideConFactura(reordered, invoice), true);
});

test("borrador y XML mock conservan el total y las bases de seis decimales", async () => {
  const order = normalizarVentaEcommerce(ventaEjemplo());
  const factura = crearFactura({ folioOrigen: "TEST-ECOMMERCE", origen: "ECOMMERCE", formaPago: "03", metodoPago: "PUE", usoCfdi: "G03",
    cliente: { tipoPersona: "FISICA", razonSocial: "PRUEBA", rfc: "XAXX010101000", codigoPostal: "53490", regimenFiscal: "616" }, conceptos: order.productos });
  assert.equal(factura.total, 1449);
  const result = await new MockTimbradoService().timbrar(factura);
  const xml = await fs.readFile(new URL(`../backend/storage/${result.xmlRelativePath}`, import.meta.url), "utf8");
  assert.match(xml, /Total="1449.00"/); assert.match(xml, /Base="775.862069"/); assert.match(xml, /Importe="199.86"/);
});

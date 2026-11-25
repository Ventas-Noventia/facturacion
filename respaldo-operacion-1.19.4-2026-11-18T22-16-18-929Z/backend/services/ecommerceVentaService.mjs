import { descripcionProducto, detalleProducto, claveSatProducto } from "./productoFiscalService.mjs";
import { calcularTotales } from "../../shared/domain/calculos.mjs";

const REASONS = {
  order_cancelled: "Pedido cancelado", order_refunded: "Pedido reembolsado", payment_refunded: "Pago reembolsado",
  partial_refund: "Reembolso parcial", refund_in_progress: "Reembolso en proceso", refund_review: "Reembolso o disputa en revisión",
  multiple_captured_payments: "Más de un cobro registrado", post_sale_in_progress: "Devolución o postventa en curso",
  item_withdrawn: "Artículo retirado del surtido", amount_mismatch: "Los importes de la venta no cuadran",
  fiscal_data_incomplete: "Datos fiscales de la venta incompletos", item_snapshot_missing: "Datos históricos del artículo incompletos",
  order_items_missing: "La venta no tiene artículos", eligibility_missing: "Falta la señal de revisión de la venta",
  payment_unconfirmed: "El pago no está confirmado"
};
function cents(value, name) {
  if (typeof value !== "string" || !/^\d+\.\d{2}$/.test(value)) throw new Error(`La API devolvió un importe inválido en ${name}.`);
  const amount = BigInt(value.replace(".", ""));
  if (amount > BigInt(Number.MAX_SAFE_INTEGER)) throw new Error("El importe de la venta excede el rango soportado.");
  return amount;
}
const money = value => `${value / 100n}.${String(value % 100n).padStart(2, "0")}`;
const divide = (a, b) => (a + b / 2n) / b;
const decimal6 = value => `${value / 1000000n}.${String(value % 1000000n).padStart(6, "0")}`;
const number = value => Number(value) / 100;

// Source prices are historical. Fiscal concepts preserve the existing 16%
// rule by splitting tax inside the collected amount, never adding it again.
export function normalizarVentaEcommerce(payload) {
  const data = payload?.data;
  if (!data?.order || !data?.customer || !data?.totals || !data?.payment || !Array.isArray(data.items)) throw new Error("El detalle de la venta no coincide con el contrato de la API.");
  if (!Number.isSafeInteger(data.order.id) || data.order.id < 1 || typeof data.order.order_number !== "string" || !data.order.order_number.trim()) throw new Error("La API devolvió una identidad de pedido inválida.");
  if (data.order.currency !== "MXN" || data.totals.currency !== "MXN") throw new Error("La venta del e-commerce debe estar expresada en MXN.");
  const reasons = new Set(Array.isArray(data.invoice_eligibility?.reasons) ? data.invoice_eligibility.reasons : []);
  if (!["eligible", "review_required"].includes(data.invoice_eligibility?.status)) reasons.add("eligibility_missing");
  const subtotal = cents(data.totals.subtotal, "totals.subtotal"), shipping = cents(data.totals.shipping, "totals.shipping");
  const total = cents(data.totals.total, "totals.total"), paid = cents(data.payment.amount, "payment.amount");
  const refunded = cents(data.payment.confirmed_refunded_amount, "payment.confirmed_refunded_amount");
  const discount = data.totals.discount === null ? null : cents(data.totals.discount, "totals.discount");
  if (discount === null || discount > subtotal || subtotal - discount + shipping !== total || total !== paid) reasons.add("amount_mismatch");
  if (refunded > 0n || data.payment.status === "partially_refunded") reasons.add("partial_refund");
  if (data.payment.status === "refunded") reasons.add("payment_refunded");
  if (!["paid", "partially_refunded", "refunded"].includes(data.payment.status)) reasons.add("payment_unconfirmed");
  if (data.order.order_status === "cancelled") reasons.add("order_cancelled");
  if (data.order.order_status === "refunded") reasons.add("order_refunded");
  if (!data.items.length) reasons.add("order_items_missing");
  const lines = data.items.map((item, index) => {
    if (!Number.isSafeInteger(item.quantity) || item.quantity < 1) throw new Error("La API devolvió una cantidad de producto inválida.");
    const price = cents(item.unit_price, "items.unit_price"), amount = cents(item.subtotal, "items.subtotal");
    if (price * BigInt(item.quantity) !== amount) reasons.add("amount_mismatch");
    if (item.is_withdrawn) reasons.add("item_withdrawn");
    if (!item.sku && !descripcionProducto(item)) reasons.add("item_snapshot_missing");
    return { item, index, amount, coupon: 0n, remainder: 0n };
  });
  if (lines.reduce((sum, line) => sum + line.amount, 0n) !== subtotal) reasons.add("amount_mismatch");
  // Allocate only the order-level coupon, in exact cents. Item promotions are
  // already in unit_price and are never applied a second time.
  if (discount !== null && discount <= subtotal && subtotal > 0n && !reasons.has("amount_mismatch")) {
    for (const line of lines) { line.coupon = discount * line.amount / subtotal; line.remainder = discount * line.amount % subtotal; }
    let left = discount - lines.reduce((sum, line) => sum + line.coupon, 0n);
    for (const line of [...lines].sort((a, b) => a.remainder === b.remainder ? a.index - b.index : a.remainder > b.remainder ? -1 : 1)) {
      if (!left) break; line.coupon += 1n; left -= 1n;
    }
  }
  const products = lines.map(({ item, amount, coupon }) => ({
    orderItemId: item.order_item_id, clave: item.sku || "", sku: item.sku || "",
    descripcion: descripcionProducto(item), nombre: descripcionProducto(item), titulo: descripcionProducto(item), detalleProducto: detalleProducto(item),
    claveProdServSat: claveSatProducto(item), cantidad: item.quantity,
    precioUnitarioOriginal: item.unit_price, precioUnitarioVenta: item.unit_price, subtotalVenta: item.subtotal,
    descuentoCuponVenta: money(coupon), totalVentaLinea: money(amount - coupon),
    precioUnitario: decimal6(divide((amount - coupon) * 1000000n, 116n * BigInt(item.quantity))),
    unidad: "Pieza", claveUnidad: "H87", tasaIva: 0.16, precisionCalculo: 6
  }));
  if (shipping > 0n) products.push({
    orderItemId: `envio-${data.order.id}`, clave: "ENVIO", sku: "ENVIO", claveProdServSat: claveSatProducto({sku:"ENVIO"}), descripcion: "Envío del pedido", cantidad: 1,
    precioUnitarioOriginal: money(shipping), precioUnitarioVenta: money(shipping), subtotalVenta: money(shipping),
    descuentoCuponVenta: "0.00", totalVentaLinea: money(shipping),
    precioUnitario: decimal6(divide(shipping * 1000000n, 116n)),
    unidad: "Unidad de servicio", claveUnidad: "E48", tasaIva: 0.16, precisionCalculo: 6
  });
  if (products.length && !reasons.has("amount_mismatch") && Math.round(calcularTotales(products).total * 100) !== Number(total)) reasons.add("amount_mismatch");
  const review = data.invoice_eligibility?.status !== "eligible" || reasons.size > 0;
  return {
    folio: data.order.order_number, ecommerceId: data.order.id, fecha: data.order.placed_at, fechaPago: data.payment.paid_at,
    origen: "ECOMMERCE", fuente: "ECOMMERCE_API", moneda: "MXN",
    cliente: { nombre: data.customer.name || "", email: data.customer.email || "", telefono: "" },
    datosFiscales: { solicitada: Boolean(data.invoice?.required), rfc: data.invoice?.rfc || null, razonSocial: data.invoice?.legal_name || null,
      regimenFiscal: data.invoice?.tax_regime || null, codigoPostal: data.invoice?.postal_code || null, usoCfdi: data.invoice?.cfdi_use || null },
    estado: data.order.order_status, cancelado: data.order.order_status === "cancelled", facturado: false,
    estatusPago: data.payment.status === "paid" ? "PAGADO" : data.payment.status, metodoPagoTexto: data.payment.provider,
    totalPedido: number(total), totalPagado: number(paid), reembolsoConfirmado: number(refunded), costoEnvio: number(shipping),
    descuentoPedido: discount === null ? null : number(discount), importesOrigen: { ...data.totals },
    requiereRevision: review, motivosRevision: [...reasons],
    mensajeRevision: review ? "Esta venta requiere revisión antes de facturar: " + ([...reasons].map(reason => REASONS[reason] || "Situación pendiente de revisión").join("; ") || "Revisión indicada por el e-commerce") + "." : "",
    productos: products
  };
}

export function validarVentaParaFacturar(pedido) {
  if (pedido?.fuente !== "ECOMMERCE_API") return;
  if (pedido.requiereRevision || pedido.cancelado) {
    const error = new Error(pedido.mensajeRevision || "La venta requiere revisión antes de facturar.");
    error.statusCode = 409; throw error;
  }
  if (Math.round(calcularTotales(pedido.productos).total * 100) !== Math.round(pedido.totalPedido * 100)) {
    const error = new Error("El total de la factura no coincide con el importe original de la venta.");
    error.statusCode = 409; throw error;
  }
}

export function conceptosActualesEcommerce(pedido, overrides = []) {
  validarVentaParaFacturar(pedido);
  if (!Array.isArray(overrides)) overrides = [];
  return pedido.productos.map(producto => {
    const fiscal = overrides.find(item => String(item.orderItemId) === String(producto.orderItemId));
    return { ...producto, unidad: fiscal?.unidad || producto.unidad, claveUnidad: fiscal?.claveUnidad || producto.claveUnidad,
      ...(fiscal?.claveProdServSat ? { claveProdServSat: fiscal.claveProdServSat } : {}) };
  });
}

export function ventaCoincideConFactura(pedido, factura) {
  validarVentaParaFacturar(pedido);
  if (String(pedido.ecommerceId) !== String(factura.pedido?.ecommerceId) || pedido.totalPedido !== factura.total) return false;
  if (["subtotal", "discount", "shipping", "total", "currency"].some(key => pedido.importesOrigen[key] !== factura.pedido?.importesOrigen?.[key])) return false;
  const signature = concepts => concepts.map(item => ({
    id: String(item.orderItemId), sku: item.sku || item.clave || "", descripcion: item.descripcion, detalleProducto: item.detalleProducto || "",
    cantidad: Number(item.cantidad), precio: Number(item.precioUnitario).toFixed(6)
  })).sort((a,b) => a.id.localeCompare(b.id));
  return JSON.stringify(signature(pedido.productos)) === JSON.stringify(signature(factura.conceptos || []));
}

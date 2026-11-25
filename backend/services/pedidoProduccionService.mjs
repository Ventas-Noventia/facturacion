import { claveSatProducto } from "./productoFiscalService.mjs";
import { calcularTotales } from "../../shared/domain/calculos.mjs";
import { conceptosActualesEcommerce, validarVentaParaFacturar, ventaCoincideConFactura } from "./ecommerceVentaService.mjs";
import { errorProduccion } from "./produccionFiscal.mjs";

const centavos = value => Math.round(Number(value) * 100);
function fallo(message) { throw errorProduccion(message, "PRODUCCION_PEDIDO_NO_ELEGIBLE", 409); }

// montoApartado is a deposit, not a complete ledger. PAGADO is the source's
// settlement signal. An explicit outstanding balance contradicts that signal.
export function pedidoProduccion(pedido, factura = null) {
  if (!pedido || !["ECOMMERCE_API", "FIRESTORE_SURTIDOS", "FIRESTORE_SOLICITUDES_WHATSAPP"].includes(pedido.fuente)) fallo("Producción requiere una compra consultada por ID o folio desde el e-commerce o Firebase.");
  if (pedido.cancelado || /cancel|reembols|refund|devoluci/i.test(String(pedido.estado || ""))) fallo("La compra está cancelada, reembolsada o en devolución. Revísala en el origen.");
  if (pedido.estatusPago !== "PAGADO") fallo("Solo se pueden emitir compras totalmente pagadas. Confirma el pago en el sistema de origen.");
  if (pedido.facturado && (!factura || pedido.facturaId !== factura.id)) fallo("El pedido está marcado por otra factura o no identifica su propietario. Revisa su vínculo antes de emitir.");
  if (pedido.fuente === "ECOMMERCE_API") { validarVentaParaFacturar(pedido); return pedido; }
  if (pedido.saldoRegistrado != null && (!Number.isFinite(Number(pedido.saldoRegistrado)) || Number(pedido.saldoRegistrado) > 0)) fallo("El pedido conserva saldo pendiente en Firebase. Confirma su liquidación en el origen.");
  if (!(Number(pedido.totalPedido) > 0) || !Number.isFinite(Number(pedido.costoEnvio)) || Number(pedido.costoEnvio) < 0 || !Array.isArray(pedido.productos) || !pedido.productos.length) fallo("Revisa los importes históricos y los artículos de la compra.");
  const productos = pedido.productos.map((producto, index) => {
    const cantidad = Number(producto.cantidad), importe = Number(producto.importeVentaLinea);
    if (!(cantidad > 0) || !Number.isFinite(cantidad) || !Number.isFinite(importe) || importe < 0) fallo("La compra no conserva un precio histórico válido para cada artículo.");
    return { ...producto, orderItemId: `firebase-${index}`, sku: producto.clave || "", precisionCalculo: 6,
      precioUnitario: Number((importe / cantidad / 1.16).toFixed(6)), tasaIva: 0.16, descuento: 0, totalVentaLinea: importe };
  });
  if (Number(pedido.costoEnvio) > 0) productos.push({ orderItemId: "firebase-envio", clave: "ENVIO", sku: "ENVIO", claveProdServSat: claveSatProducto({sku:"ENVIO"}), descripcion: "Envío del pedido", cantidad: 1,
    precioUnitario: Number((Number(pedido.costoEnvio) / 1.16).toFixed(6)), totalVentaLinea: Number(pedido.costoEnvio), unidad: "Unidad de servicio", claveUnidad: "E48", tasaIva: 0.16, precisionCalculo: 6 });
  if (centavos(calcularTotales(productos).total) !== centavos(pedido.totalPedido)) fallo("Los artículos, descuentos y envío de Firebase no cuadran con el total cobrado. Corrige o revisa la compra en el origen; no se ajustarán importes automáticamente.");
  return { ...pedido, productos, moneda: "MXN" };
}
export function conceptosPedidoProduccion(pedido, overrides = [], factura = null) {
  const actual = pedidoProduccion(pedido, factura);
  if (actual.fuente === "ECOMMERCE_API") return conceptosActualesEcommerce(actual, overrides);
  return actual.productos.map(producto => {
    const fiscal = Array.isArray(overrides) ? overrides.find(c => String(c.orderItemId) === producto.orderItemId) : null;
    return { ...producto, claveUnidad: fiscal?.claveUnidad || producto.claveUnidad, unidad: fiscal?.unidad || producto.unidad,
      ...(fiscal?.claveProdServSat ? { claveProdServSat: fiscal.claveProdServSat } : {}) };
  });
}
export function pedidoCoincideProduccion(pedido, factura) {
  const actual = pedidoProduccion(pedido, factura);
  if (actual.fuente === "ECOMMERCE_API") return ventaCoincideConFactura(actual, factura);
  if (actual.fuente !== factura.pedido?.fuente || actual.firebaseId !== factura.pedido?.firebaseId || centavos(actual.totalPedido) !== centavos(factura.total)) return false;
  const firma = conceptos => conceptos.map(c => [String(c.orderItemId), c.sku || c.clave || "", c.descripcion, Number(c.cantidad), Number(c.precioUnitario).toFixed(6), Number(c.descuento || 0)]);
  return JSON.stringify(firma(actual.productos)) === JSON.stringify(firma(factura.conceptos || []));
}

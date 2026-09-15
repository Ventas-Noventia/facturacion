import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
const dir = path.dirname(fileURLToPath(import.meta.url));
const file = path.join(dir, "..", "data", "ecommerce-pedidos.json");

export class EcommerceJsonService {
  async obtenerPedido(folio) {
    const data = JSON.parse(await fs.readFile(file, "utf8"));
    const raw = data.find(x => String(x.orderId).toUpperCase() === String(folio).trim().toUpperCase());
    if (!raw) return null;

    return {
      folio: raw.orderId,
      fecha: raw.createdAt,
      origen: "ECOMMERCE",
      fuente: "ECOMMERCE_JSON",
      cliente: { nombre: raw.customer?.name || "", email: raw.customer?.email || "" },
      costoEnvio: Number(raw.shippingCost || 0),
      estado: raw.status,
      estatusPago: raw.status === "paid" ? "PAGADO" : "PENDIENTE",
      metodoPagoTexto: raw.payment?.method || "",
      totalPagado: Number(raw.payment?.paid || 0),
      productos: (raw.items || []).map(i => {
        const final = Number(i.unitPrice) * (1 - Number(i.discountPercent || 0)/100);
        return {
          clave: i.sku,
          descripcion: i.name,
          cantidad: Number(i.qty),
          precioUnitarioOriginal: Number(i.unitPrice),
          descuentoPorcentaje: Number(i.discountPercent || 0),
          precioUnitario: Number(final.toFixed(2)),
          subtotal: Number((final * Number(i.qty)).toFixed(2)),
          unidad: i.unit || "Pieza",
          claveUnidad: i.satUnitCode || "H87",
          tasaIva: 0.16
        };
      })
    };
  }
}

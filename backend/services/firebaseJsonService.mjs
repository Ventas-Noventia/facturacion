import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
const dir = path.dirname(fileURLToPath(import.meta.url));
const pedidosFile = path.join(dir, "..", "data", "firebase-pedidos.json");
const productosFile = path.join(dir, "..", "data", "firebase-productos.json");

export class FirebaseJsonService {
  async obtenerPedido(folio) {
    const key = String(folio).trim().toUpperCase();
    const pedidos = JSON.parse(await fs.readFile(pedidosFile, "utf8"));
    const productos = JSON.parse(await fs.readFile(productosFile, "utf8"));
    const p = pedidos.find(x => String(x["Folio"]).toUpperCase() === key);
    if (!p) return null;

    return {
      folio: p["Folio"],
      fecha: p["Fecha"],
      origen: p["Tipo de operación"] || "FIREBASE",
      fuente: "FIREBASE_JSON",
      cliente: { nombre: p["Cliente"] || "", email: "" },
      estado: p["Estado"] || "",
      estatusPago: p["Estatus de pago"] || "",
      metodoPagoTexto: p["Métodos de pago"] || "",
      costoEnvio: Number(p["Costo de envío"] || 0),
      totalPedido: Number(p["Total del pedido"] || 0),
      totalAjustado: Number(p["Total ajustado"] || 0),
      totalPagado: Number(p["Total pagado"] || 0),
      saldoPendiente: Number(p["Saldo pendiente"] || 0),
      numeroDevoluciones: Number(p["Número de devoluciones"] || 0),
      productos: productos.filter(x => String(x["Folio"]).toUpperCase() === key).map(x => ({
        clave: x["Clave"],
        descripcion: x["Producto"],
        cantidad: Number(x["Cantidad"] || 0),
        precioUnitarioOriginal: Number(x["Costo unitario original"] || 0),
        descuentoPorcentaje: Number(x["Descuento %"] || 0),
        precioUnitario: Number(x["Costo unitario con descuento"] || 0),
        subtotal: Number(x["Subtotal"] || 0),
        unidad: x["Unidad"] || "Pieza",
        claveUnidad: x["Clave unidad SAT"] || "H87",
        tasaIva: 0.16
      }))
    };
  }
}

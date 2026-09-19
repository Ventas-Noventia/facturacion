import { applicationDefault, getApps, initializeApp } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";

const APP_NAME = "facturacion-noventia";
const numero = valor => Number.isFinite(Number(valor)) ? Number(valor) : 0;

function fechaIso(valor) {
  if (!valor) return "";
  if (typeof valor.toDate === "function") return valor.toDate().toISOString();
  if (valor instanceof Date) return valor.toISOString();
  return String(valor);
}

function productoWhatsApp(item = {}) {
  const descuento = numero(item.descuentoPorcentaje);
  const precioOriginal = numero(item.precio);
  const precioFinal = precioOriginal * (1 - descuento / 100);
  return {
    clave: item.clave || item.idProducto || "",
    descripcion: item.nombre || "",
    cantidad: numero(item.cantidad),
    precioUnitarioOriginal: precioOriginal,
    descuentoPorcentaje: descuento,
    precioUnitario: Number(precioFinal.toFixed(2)),
    subtotal: Number((precioFinal * numero(item.cantidad)).toFixed(2)),
    unidad: "Pieza",
    claveUnidad: "H87",
    tasaIva: 0.16
  };
}

function productoSurtido(item = {}) {
  return {
    clave: item.clave || "",
    descripcion: item.nombre || "",
    cantidad: numero(item.cantidad),
    precioUnitarioOriginal: numero(item.costo),
    descuentoPorcentaje: 0,
    precioUnitario: numero(item.costo),
    subtotal: Number((numero(item.costo) * numero(item.cantidad)).toFixed(2)),
    unidad: "Pieza",
    claveUnidad: "H87",
    tasaIva: 0.16
  };
}

export class FirebaseJsonService {
  constructor({ projectId = process.env.FIREBASE_PROJECT_ID, db = null } = {}) {
    this.projectId = projectId;
    this.db = db;
  }

  firestore() {
    if (this.db) return this.db;
    if (!this.projectId) throw new Error("Falta FIREBASE_PROJECT_ID en el archivo .env");
    let app = getApps().find(item => item.name === APP_NAME);
    if (!app) {
      app = initializeApp({credential: applicationDefault(), projectId: this.projectId}, APP_NAME);
    }
    this.db = getFirestore(app);
    return this.db;
  }

  async buscarDocumento(coleccion, campo, valor) {
    const resultado = await this.firestore().collection(coleccion)
      .where(campo, "==", valor).limit(1).get();
    if (resultado.empty) return null;
    const documento = resultado.docs[0];
    return {id: documento.id, ...documento.data()};
  }

  async obtenerWhatsApp(referencia) {
    const pedido = await this.buscarDocumento("solicitudes_whatsapp", "referencia", referencia);
    if (!pedido) return null;
    return {
      firebaseId: pedido.id,
      folio: pedido.referencia,
      fecha: fechaIso(pedido.fechaCreacion),
      origen: "WHATSAPP",
      fuente: "FIRESTORE_SOLICITUDES_WHATSAPP",
      cliente: {nombre: pedido.cliente || "", email: "", telefono: pedido.telefono || ""},
      estado: pedido.estado || "",
      estatusPago: pedido.estatusPago || "",
      metodoPagoTexto: pedido.metodoPago || "",
      costoEnvio: 0,
      totalPedido: numero(pedido.monto),
      totalPagado: numero(pedido.montoApartado),
      saldoPendiente: Math.max(0, numero(pedido.monto) - numero(pedido.montoApartado)),
      productos: (pedido.productos || []).map(productoWhatsApp)
    };
  }

  async obtenerSurtido(folio) {
    const pedido = await this.buscarDocumento("surtidos", "folio", folio);
    if (!pedido) return null;
    const tipo = String(pedido.tipoOperacion || "").toUpperCase();
    return {
      firebaseId: pedido.id,
      folio: pedido.folio,
      fecha: pedido.fechaPedido || fechaIso(pedido.creadoEn),
      origen: tipo === "BAZ" ? "BAZAR" : tipo === "ALM" ? "ALMACEN" : tipo || "MANUAL",
      fuente: "FIRESTORE_SURTIDOS",
      cliente: {nombre: pedido.nombreCliente || "", email: ""},
      estado: pedido.estado || "",
      estatusPago: pedido.estatusPago || "",
      metodoPagoTexto: pedido.metodoPago || "",
      costoEnvio: numero(pedido.costoEnvio),
      totalPedido: numero(pedido.total),
      totalPagado: numero(pedido.montoApartado),
      saldoPendiente: Math.max(0, numero(pedido.total) - numero(pedido.montoApartado)),
      productos: (pedido.productos || []).map(productoSurtido)
    };
  }

  async obtenerPedido(folio) {
    const key = String(folio || "").trim().toUpperCase();
    if (!key) return null;
    if (key.startsWith("NV-")) return this.obtenerWhatsApp(key);
    if (key.startsWith("BAZ-") || key.startsWith("ALM-")) return this.obtenerSurtido(key);
    return (await this.obtenerWhatsApp(key)) || (await this.obtenerSurtido(key));
  }
}

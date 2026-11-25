import { descripcionProducto, claveSatProducto } from "./productoFiscalService.mjs";
import { applicationDefault, cert, getApps, initializeApp } from "firebase-admin/app";
import { FieldValue, getFirestore } from "firebase-admin/firestore";
import { existsSync, readFileSync } from "node:fs";

const APP_NAME = "facturacion-noventia";
const TASA_IVA = 0.16;
const numero = valor => Number.isFinite(Number(valor)) ? Number(valor) : 0;
const redondear = valor => Number(numero(valor).toFixed(2));
const precioSinIva = precioConIva => redondear(numero(precioConIva) / (1 + TASA_IVA));

function credencialFirebase(){
  const base64=String(process.env.FIREBASE_SERVICE_ACCOUNT_BASE64||"").trim();
  const json=String(process.env.FIREBASE_SERVICE_ACCOUNT_JSON||"").trim();
  if(base64){
    try{return cert(JSON.parse(Buffer.from(base64,"base64").toString("utf8")))}
    catch{throw new Error("FIREBASE_SERVICE_ACCOUNT_BASE64 no contiene una credencial válida")}
  }
  if(json){
    try{return cert(JSON.parse(json))}
    catch{throw new Error("FIREBASE_SERVICE_ACCOUNT_JSON no contiene un JSON válido")}
  }
  const ruta=String(process.env.GOOGLE_APPLICATION_CREDENTIALS||"").trim();
  if(ruta){
    if(!existsSync(ruta))throw new Error(`No se encontró la credencial de Firebase en ${ruta}. Corrige GOOGLE_APPLICATION_CREDENTIALS o usa FIREBASE_SERVICE_ACCOUNT_BASE64.`);
    try{return cert(JSON.parse(readFileSync(ruta,"utf8")))}
    catch{throw new Error("El archivo indicado en GOOGLE_APPLICATION_CREDENTIALS no contiene una credencial JSON válida")}
  }
  return applicationDefault();
}

function fechaIso(valor) {
  if (!valor) return "";
  if (typeof valor.toDate === "function") return valor.toDate().toISOString();
  if (valor instanceof Date) return valor.toISOString();
  return String(valor);
}

function productoWhatsApp(item = {}) {
  const descuento = numero(item.descuentoPorcentaje);
  const precioOriginal = numero(item.precio);
  const precioFinalConIva = precioOriginal * (1 - descuento / 100);
  const precioFinalSinIva = precioSinIva(precioFinalConIva);
  return {
    clave: item.clave || item.idProducto || "",
    descripcion: descripcionProducto(item),
    claveProdServSat: claveSatProducto(item),
    cantidad: numero(item.cantidad),
    precioUnitarioOriginal: precioOriginal,
    descuentoPorcentaje: descuento,
    precioUnitario: precioFinalSinIva,
    precioVentaConIva: redondear(precioFinalConIva),
    importeVentaLinea: redondear(precioFinalConIva * numero(item.cantidad)),
    subtotal: redondear(precioFinalSinIva * numero(item.cantidad)),
    unidad: "Pieza",
    claveUnidad: "H87",
    tasaIva: TASA_IVA
  };
}

function descuentoGeneralPedido(pedido = {}) {
  const porcentaje = numero(pedido.descuentoGeneral);
  if (porcentaje > 0) return porcentaje;
  const original = numero(pedido.subtotalProductosOriginal);
  const final = numero(pedido.subtotalProductos);
  if (original > 0 && final >= 0 && final < original) return (1 - final / original) * 100;
  return 0;
}

function productoSurtido(item = {}, pedido = {}) {
  const tipoDescuento = String(pedido.tipoDescuento || "NINGUNO").toUpperCase();
  const descuento = tipoDescuento === "GENERAL"
    ? descuentoGeneralPedido(pedido)
    : numero(item.descuentoPorcentaje);
  const precioOriginal = numero(item.costo);
  const precioFinalConIva = precioOriginal * (1 - descuento / 100);
  const precioFinalSinIva = precioSinIva(precioFinalConIva);
  return {
    clave: item.clave || "",
    descripcion: descripcionProducto(item),
    claveProdServSat: claveSatProducto(item),
    cantidad: numero(item.cantidad),
    precioUnitarioOriginal: precioOriginal,
    descuentoPorcentaje: redondear(descuento),
    precioUnitario: precioFinalSinIva,
    precioVentaConIva: redondear(precioFinalConIva),
    importeVentaLinea: redondear(precioFinalConIva * numero(item.cantidad)),
    subtotal: redondear(precioFinalSinIva * numero(item.cantidad)),
    unidad: "Pieza",
    claveUnidad: "H87",
    tasaIva: TASA_IVA
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
      app = initializeApp({credential:credencialFirebase(),projectId:this.projectId},APP_NAME);
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
      cancelado: Boolean(pedido.cancelado),
      facturado: Boolean(pedido.facturado),
      facturaFolioInterno: pedido.facturaFolioInterno || "",
      facturaId: pedido.facturaId || null,
      saldoRegistrado: pedido.saldoPendiente ?? null,
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
      cliente: {nombre: pedido.nombreCliente || "", email: pedido.clienteEmail || pedido.email || "", telefono: pedido.clienteTelefono || pedido.telefono || ""},
      estado: pedido.estado || "",
      cancelado: Boolean(pedido.cancelado),
      facturado: Boolean(pedido.facturado),
      facturaFolioInterno: pedido.facturaFolioInterno || "",
      facturaId: pedido.facturaId || null,
      saldoRegistrado: pedido.saldoPendiente ?? null,
      estatusPago: pedido.estatusPago || "",
      metodoPagoTexto: pedido.metodoPago || "",
      costoEnvio: numero(pedido.costoEnvio),
      totalPedido: numero(pedido.total),
      totalPagado: numero(pedido.montoApartado),
      saldoPendiente: Math.max(0, numero(pedido.total) - numero(pedido.montoApartado)),
      descuentoTipo: pedido.tipoDescuento || "NINGUNO",
      descuentoGeneral: numero(pedido.descuentoGeneral),
      descuentoTotal: numero(pedido.descuentoTotal),
      subtotalProductosOriginal: numero(pedido.subtotalProductosOriginal),
      subtotalProductos: numero(pedido.subtotalProductos),
      productos: (pedido.productos || []).map(item => productoSurtido(item, pedido))
    };
  }

  async obtenerPedido(folio) {
    const key = String(folio || "").trim().toUpperCase();
    if (!key) return null;
    if (key.startsWith("NV-")) return this.obtenerWhatsApp(key);
    if (key.startsWith("BAZ-") || key.startsWith("ALM-")) return this.obtenerSurtido(key);
    return (await this.obtenerWhatsApp(key)) || (await this.obtenerSurtido(key));
  }

  async marcarFacturado(pedido, factura) {
    if (!pedido?.firebaseId) throw new Error("El pedido no incluye su identificador de Firebase");
    const coleccion = pedido.fuente === "FIRESTORE_SOLICITUDES_WHATSAPP"
      ? "solicitudes_whatsapp"
      : pedido.fuente === "FIRESTORE_SURTIDOS" ? "surtidos" : null;
    if (!coleccion) return null;

    const ref = this.firestore().collection(coleccion).doc(pedido.firebaseId);
    await this.firestore().runTransaction(async transaction => {
      const snapshot = await transaction.get(ref);
      if (!snapshot.exists) throw new Error("El pedido ya no está disponible en Firebase.");
      const actual = snapshot.data();
      if ((actual.facturado === true || actual.facturaId) && actual.facturaId !== factura.id) throw new Error("La marca del pedido no corresponde a esta factura; requiere revisión.");
      transaction.update(ref, {
      facturado: true,
      estadoFacturacion: "FACTURADO",
      facturaId: factura.id,
      facturaFolioInterno: factura.folioInterno,
      facturadoEn: FieldValue.serverTimestamp()
      });
    });
    return {coleccion, firebaseId:pedido.firebaseId};
  }

  async desmarcarFacturado(pedido, facturaId = null) {
    if (!pedido?.firebaseId) throw new Error("El pedido no incluye su identificador de Firebase");
    const coleccion = pedido.fuente === "FIRESTORE_SOLICITUDES_WHATSAPP"
      ? "solicitudes_whatsapp"
      : pedido.fuente === "FIRESTORE_SURTIDOS" ? "surtidos" : null;
    if (!coleccion) return null;
    const ref = this.firestore().collection(coleccion).doc(pedido.firebaseId);
    const patch = {
      facturado: false,
      estadoFacturacion: FieldValue.delete(),
      facturaId: FieldValue.delete(),
      facturaFolioInterno: FieldValue.delete(),
      facturadoEn: FieldValue.delete()
    };
    if (facturaId) {
      await this.firestore().runTransaction(async transaction => {
        const snapshot = await transaction.get(ref);
        if (!snapshot.exists) throw new Error("El pedido ya no está disponible en Firebase.");
        const actual = snapshot.data();
        if ((actual.facturado === true || actual.facturaId) && actual.facturaId !== facturaId) throw new Error("La marca del pedido no corresponde a esta factura; requiere revisión.");
        transaction.update(ref, patch);
      });
    } else await ref.update(patch);
    return {coleccion, firebaseId:pedido.firebaseId};
  }
}

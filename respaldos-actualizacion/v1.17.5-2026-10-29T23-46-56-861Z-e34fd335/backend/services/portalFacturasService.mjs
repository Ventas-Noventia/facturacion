import fs from "node:fs/promises";
import path from "node:path";

export class PortalFacturaError extends Error {
  constructor(message = "Factura no encontrada", statusCode = 404) {
    super(message);
    this.statusCode = statusCode;
  }
}

export function estadoFacturaPortal(factura) {
  const estado = String(factura.estatus || "BORRADOR");
  const prueba = factura.ambienteTimbrado === "SANDBOX" || estado.includes("SANDBOX") || estado.includes("MOCK") || String(factura.uuid || "").startsWith("MOCK-");
  if (estado.startsWith("CANCELADA")) return {
    grupo: "CANCELADA", etiqueta: prueba ? "Cancelada · prueba" : "Cancelada", prueba,
    mensaje: "Este documento fue cancelado. Los archivos conservados corresponden a su emisión original."
  };
  if (estado === "CANCELACION_SANDBOX") return {
    grupo: "PENDIENTE", etiqueta: factura.cancelacionSandbox?.estado === "CONFIRMADA" ? "Cancelación confirmada · prueba" : "Cancelación en proceso · prueba", prueba,
    mensaje: "Se está revisando la cancelación. Los archivos conservados corresponden al comprobante original."
  };
  if (estado.startsWith("TIMBRADA")) return {
    grupo: "DISPONIBLE", etiqueta: prueba ? "Documento de prueba" : "Factura emitida", prueba,
    mensaje: prueba ? (factura.ambienteTimbrado === "SANDBOX" ? "Documento de Facturama Sandbox sin validez fiscal; utiliza emisor y receptor públicos de prueba." : "Documento de prueba sin valor fiscal. El timbrado fiscal sigue pendiente.")
      : "Consulta los datos de tu factura y descarga los documentos disponibles."
  };
  return { grupo: "PENDIENTE", etiqueta: "En revisión", prueba,
    mensaje: "Tu solicitud está registrada. Los documentos aparecerán aquí cuando estén disponibles." };
}

const string = value => String(value ?? "");
const numero = value => Number.isFinite(Number(value)) ? Number(value) : 0;

export function resumenFacturaPortal(factura) {
  return {
    id: string(factura.id), folioInterno: string(factura.folioInterno),
    folioOrigen: string(factura.folioOrigen), creadaEn: factura.creadaEn || null,
    estatus: string(factura.estatus || "BORRADOR"), estadoCliente: estadoFacturaPortal(factura),
    moneda: string(factura.moneda || "MXN"), total: numero(factura.total),
    documentos: {
      pdf: Boolean(factura.pdfStoragePath || factura.pdfRelativePath),
      xml: Boolean(factura.xmlStoragePath || factura.xmlRelativePath)
    }
  };
}

export function detalleFacturaPortal(factura) {
  const cliente = factura.cliente || {};
  return {
    ...resumenFacturaPortal(factura), subtotal: numero(factura.subtotal), impuestos: numero(factura.impuestos),
    usoCfdi: string(factura.usoCfdi), formaPago: string(factura.formaPago), metodoPago: string(factura.metodoPago),
    uuid: string(factura.uuid), fechaTimbrado: factura.fechaTimbrado || null,
    fechaCancelacion: factura.fechaCancelacion || null, motivoCancelacion: string(factura.motivoCancelacion),
    cliente: {
      tipoPersona: string(cliente.tipoPersona), razonSocial: string(cliente.razonSocial),
      rfc: string(cliente.rfc), codigoPostal: string(cliente.codigoPostal),
      regimenFiscal: string(cliente.regimenFiscal), email: string(cliente.email)
    },
    conceptos: (factura.conceptos || []).map(concepto => ({
      sku: string(concepto.sku || concepto.clave), descripcion: string(concepto.descripcion),
      cantidad: numero(concepto.cantidad), unidad: string(concepto.unidad || concepto.claveUnidad),
      precioUnitario: numero(concepto.precioUnitario),
      importe: concepto.calculo?.total == null ? null : numero(concepto.calculo.total)
    }))
  };
}

function dentro(root, file) {
  const relative = path.relative(root, file);
  return relative !== "" && !path.isAbsolute(relative) && relative !== ".." && !relative.startsWith(`..${path.sep}`);
}

function storagePathValido(value) {
  return typeof value === "string" && value.length > 0 && !/[\\?#\x00-\x1f]/.test(value)
    && value.split("/").every(part => part && part !== "." && part !== "..");
}

export class PortalFacturasService {
  constructor({ facturas, documentStorage = null, storageRoot }) {
    this.facturas = facturas;
    this.documentStorage = documentStorage;
    this.storageRoot = storageRoot;
  }

  async facturaPropia(clienteId, id) {
    if (!clienteId) throw new PortalFacturaError("Inicia sesión para continuar", 401);
    const factura = await this.facturas.findById(id);
    if (!factura || factura.portalClienteId !== clienteId) throw new PortalFacturaError();
    return factura;
  }

  async listar(clienteId) {
    if (!clienteId) throw new PortalFacturaError("Inicia sesión para continuar", 401);
    const rows = this.facturas.listByPortalClienteId
      ? await this.facturas.listByPortalClienteId(clienteId) : await this.facturas.list();
    return rows.filter(factura => factura.portalClienteId === clienteId)
      .sort((a, b) => string(b.creadaEn).localeCompare(string(a.creadaEn)))
      .map(resumenFacturaPortal);
  }

  async detalle(clienteId, id) {
    return detalleFacturaPortal(await this.facturaPropia(clienteId, id));
  }

  async documento(clienteId, id, tipo) {
    const factura = await this.facturaPropia(clienteId, id);
    if (tipo !== "pdf" && tipo !== "xml") throw new PortalFacturaError("Documento no disponible");
    const storagePath = factura[`${tipo}StoragePath`];
    const relativePath = factura[`${tipo}RelativePath`];
    let bytes, almacenamiento;
    if (storagePath && this.documentStorage) {
      if (!storagePathValido(storagePath)) throw new PortalFacturaError("Documento no disponible");
      try { bytes = await this.documentStorage.download(storagePath); }
      catch { throw new PortalFacturaError("No fue posible recuperar el documento. Intenta nuevamente más tarde.", 503); }
      almacenamiento = "supabase";
    } else if (typeof relativePath === "string" && relativePath) {
      try {
        const root = await fs.realpath(this.storageRoot);
        const candidate = path.resolve(root, relativePath);
        if (!dentro(root, candidate)) throw new PortalFacturaError("Documento no disponible");
        const file = await fs.realpath(candidate);
        if (!dentro(root, file)) throw new PortalFacturaError("Documento no disponible");
        bytes = await fs.readFile(file);
      } catch (error) {
        if (error instanceof PortalFacturaError) throw error;
        throw new PortalFacturaError("Documento no disponible");
      }
      almacenamiento = "local";
    } else throw new PortalFacturaError("Documento todavía no disponible");
    const nombre = string(factura.folioInterno || factura.id).replace(/[^a-zA-Z0-9_-]/g, "_").slice(0, 100) || "factura";
    return { bytes: Buffer.from(bytes), nombre: `${nombre}.${tipo}`, almacenamiento,
      contentType: tipo === "pdf" ? "application/pdf" : "application/xml; charset=utf-8",
      factura: resumenFacturaPortal(factura) };
  }
}

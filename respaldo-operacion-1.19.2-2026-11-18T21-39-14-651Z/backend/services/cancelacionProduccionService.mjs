import { FacturamaError, resultadoProduccion, validarCancelacionProduccion, huellaSolicitud } from "./facturamaProduccionService.mjs";
import { verificarOperacionProduccion } from "./timbradoProduccionService.mjs";

function fallo(message, code = "PRODUCCION_CANCELACION_CONFLICTO", statusCode = 409) {
  const error = new FacturamaError(message, { statusCode }); error.code = code; return error;
}
const status = remote => String(remote?.Status || "").trim().toLowerCase();
const cancelada = remote => ["cancel", "canceled", "cancelled"].includes(status(remote));

// Only a verified remote cancellation releases the order. Pending and uncertain
// operations retain the active unique key. Consultation never sends a DELETE.
export class CancelacionProduccionService {
  constructor({ facturas, pac, liberarPedido = async () => {}, now = () => new Date() }) {
    Object.assign(this, { facturas, pac, liberarPedido, now });
  }
  async cambiar(current, patch) {
    const updated = await this.facturas.compareAndUpdate(current, patch);
    if (!updated) throw fallo("La factura cambió durante la cancelación. Actualiza el historial.");
    return updated;
  }
  validarFactura(factura) {
    if (factura.pac !== "facturama_produccion" || factura.ambienteTimbrado !== "PRODUCCION" || !factura.uuid || !factura.timbradoProduccion?.facturamaId || factura.timbradoProduccion.solicitud?.Issuer?.Rfc !== this.pac.rfc || !verificarOperacionProduccion(factura.timbradoProduccion)) throw fallo("La factura no tiene un timbrado Produccion íntegro para cancelar.", "PRODUCCION_CANCELACION_NO_PERMITIDA");
  }
  validarOperacion(factura) {
    this.validarFactura(factura);
    const op = factura.cancelacionProduccion;
    if (!op?.solicitud || op.version !== 1 || op.huella !== huellaSolicitud(op.solicitud) || op.solicitud.idFacturama !== factura.timbradoProduccion.facturamaId || op.solicitud.uuid !== factura.uuid) throw fallo("La solicitud de cancelación no coincide con la operación guardada.", "PRODUCCION_CANCELACION_MODIFICADA");
  }
  verificarRemoto(factura, remote) {
    const p = factura.timbradoProduccion.solicitud;
    const r = resultadoProduccion(remote, factura.timbradoProduccion.facturamaId);
    if (r.uuid !== factura.uuid || String(remote.Folio) !== p.Folio || remote.Serie !== p.Serie || remote.Issuer?.Rfc !== p.Issuer.Rfc || remote.Receiver?.Rfc !== p.Receiver.Rfc || String(remote.Date).slice(0,19) !== p.Date || !Number.isFinite(Number(remote.Total)) || Math.round(Number(remote.Total)*100) !== Math.round(Number(factura.total)*100)) throw fallo("El comprobante consultado no coincide con la factura. Se conservó el registro sin liberar el pedido.", "PRODUCCION_CANCELACION_IDENTIDAD");
  }
  async cancelar(factura, input = {}) {
    this.validarFactura(factura);
    if (!this.pac.permitirEmision) throw fallo("Activa el proveedor productivo en el servidor antes de solicitar una cancelación.");
    if (factura.estatus !== "TIMBRADA" || (factura.cancelacionProduccion && !["NO_ENVIADA", "RECHAZADA"].includes(factura.cancelacionProduccion.estado))) throw fallo("Consulta la cancelación existente antes de enviar otra solicitud.");
    const motivo = validarCancelacionProduccion(input, factura.uuid);
    const solicitud = { idFacturama: factura.timbradoProduccion.facturamaId, uuid: factura.uuid, ...motivo };
    const { historial = [], ...anterior } = factura.cancelacionProduccion || {};
    const operation = { version: 1, estado: "CONSULTANDO", solicitud, huella: huellaSolicitud(solicitud), creadaEn: this.now().toISOString(), comentario: String(input.comentario || "").trim().slice(0,300), ...(factura.cancelacionProduccion ? { historial: [...historial, anterior] } : {}) };
    let current = await this.cambiar(factura, { estatus: "CANCELACION_PRODUCCION", cancelacionProduccion: operation });
    try {
      const before = await this.pac.consultar(solicitud.idFacturama);
      this.verificarRemoto(current, before);
      if (status(before) !== "active") return await this.evaluar(current, before);
      current = await this.cambiar(current, { cancelacionProduccion: { ...current.cancelacionProduccion, estado: "ENVIADO", enviadaEn: this.now().toISOString() } });
      const response = await this.pac.cancelar(solicitud.idFacturama, motivo);
      const responseStatus = status(response);
      current = await this.cambiar(current, { cancelacionProduccion: { ...current.cancelacionProduccion, estado: "RECIBIDA", respuestaStatus: ["active","pending","canceled","cancel"].includes(responseStatus) ? responseStatus : "desconocido" } });
      const remote = await this.pac.consultar(solicitud.idFacturama);
      this.verificarRemoto(current, remote);
      return await this.evaluar(current, remote);
    } catch (error) {
      const noEnviada = current.cancelacionProduccion.estado === "CONSULTANDO";
      const rechazada = error instanceof FacturamaError && error.rechazo && current.cancelacionProduccion.estado === "ENVIADO";
      await this.facturas.compareAndUpdate(current, { estatus: noEnviada || rechazada ? "TIMBRADA" : "CANCELACION_PRODUCCION", cancelacionProduccion: { ...current.cancelacionProduccion, estado: noEnviada ? "NO_ENVIADA" : rechazada ? "RECHAZADA" : "POR_CONFIRMAR" } });
      throw error;
    }
  }
  async consultar(factura) {
    this.validarOperacion(factura);
    if (!["CANCELACION_PRODUCCION", "CANCELADA", "TIMBRADA"].includes(factura.estatus)) throw fallo("El estado de la factura no permite consultar esta cancelación.");
    const current = await this.cambiar(factura, { cancelacionProduccion: { ...factura.cancelacionProduccion, consultadaEn: this.now().toISOString() } });
    if (current.cancelacionProduccion.estado === "CONFIRMADA") return this.confirmar(current);
    const remote = await this.pac.consultar(current.cancelacionProduccion.solicitud.idFacturama);
    this.verificarRemoto(current, remote);
    return this.evaluar(current, remote);
  }
  async evaluar(factura, remote) {
    if (cancelada(remote)) return this.confirmar(factura);
    const op = factura.cancelacionProduccion;
    const rechazada = status(remote) === "active" && ["active", undefined].includes(op.respuestaStatus) && ["RECHAZADA", "NO_ENVIADA", "RECIBIDA"].includes(op.estado);
    const current = await this.cambiar(factura, { estatus: rechazada ? "TIMBRADA" : "CANCELACION_PRODUCCION", cancelacionProduccion: { ...op, estado: rechazada ? "RECHAZADA" : "PENDIENTE", ultimoStatus: status(remote) || "desconocido" } });
    return { ...current, advertencia: rechazada ? "Facturama conserva vigente el comprobante. Revisa el motivo antes de solicitar otra cancelación." : "Facturama todavía no confirma la cancelación. El pedido sigue bloqueado; usa Consultar cancelación." };
  }
  async confirmar(factura) {
    if (factura.estatus === "CANCELADA") return factura;
    let current = factura;
    if (current.cancelacionProduccion.estado !== "CONFIRMADA") current = await this.cambiar(current, { cancelacionProduccion: { ...current.cancelacionProduccion, estado: "CONFIRMADA", confirmadaEn: this.now().toISOString() } });
    // Keep the active key until Firebase is released. A failed synchronization
    // cannot undo a confirmed remote cancellation or permit a duplicate draft.
    if (current.pedido?.firebaseId && !current.pedidoLiberadoPorCancelacion) {
      try { await this.liberarPedido(current); }
      catch { return { ...current, advertencia: "Facturama confirmó la cancelación. Falta liberar el pedido en Firebase; usa Consultar cancelación para continuar." }; }
    }
    const op = current.cancelacionProduccion;
    return this.cambiar(current, { estatus: "CANCELADA", motivoCancelacion: op.solicitud.motivo, uuidSustitucion: op.solicitud.uuidSustitucion, comentarioCancelacion: op.comentario, cancelacionConfirmadaEn: op.confirmadaEn,
      ...(current.pedido?.firebaseId ? { pedidoMarcadoFacturado: false, pedidoLiberadoPorCancelacion: true, errorSincronizacionPedido: null } : {}) });
  }
}

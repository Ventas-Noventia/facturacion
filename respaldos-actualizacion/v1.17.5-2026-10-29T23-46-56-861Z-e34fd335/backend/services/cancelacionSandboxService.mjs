import { FacturamaError, EMISOR_SANDBOX, resultadoSandbox, validarCancelacionSandbox, huellaSolicitud } from "./facturamaSandboxService.mjs";
import { verificarOperacionSandbox } from "./timbradoSandboxService.mjs";

function fallo(message, code = "SANDBOX_CANCELACION_CONFLICTO", statusCode = 409) {
  const error = new FacturamaError(message, { statusCode }); error.code = code; return error;
}
const status = remote => String(remote?.Status || "").trim().toLowerCase();
const cancelada = remote => ["cancel", "canceled", "cancelled"].includes(status(remote));

// Only a verified remote cancellation releases the order. Pending and uncertain
// operations retain the active unique key. Consultation never sends a DELETE.
export class CancelacionSandboxService {
  constructor({ facturas, pac, liberarPedido = async () => {}, now = () => new Date() }) {
    Object.assign(this, { facturas, pac, liberarPedido, now });
  }
  async cambiar(current, patch) {
    const updated = await this.facturas.compareAndUpdate(current, patch);
    if (!updated) throw fallo("La factura cambió durante la cancelación. Actualiza el historial.");
    return updated;
  }
  validarFactura(factura) {
    if (factura.pac !== "facturama_sandbox" || factura.ambienteTimbrado !== "SANDBOX" || !factura.uuid || !factura.timbradoSandbox?.facturamaId || factura.timbradoSandbox.solicitud?.Issuer?.Rfc !== EMISOR_SANDBOX.Rfc || !verificarOperacionSandbox(factura.timbradoSandbox)) throw fallo("La factura no tiene un timbrado Sandbox íntegro para cancelar.", "SANDBOX_CANCELACION_NO_PERMITIDA");
  }
  validarOperacion(factura) {
    this.validarFactura(factura);
    const op = factura.cancelacionSandbox;
    if (!op?.solicitud || op.version !== 1 || op.huella !== huellaSolicitud(op.solicitud) || op.solicitud.idFacturama !== factura.timbradoSandbox.facturamaId || op.solicitud.uuid !== factura.uuid) throw fallo("La solicitud de cancelación no coincide con la operación guardada.", "SANDBOX_CANCELACION_MODIFICADA");
  }
  verificarRemoto(factura, remote) {
    const p = factura.timbradoSandbox.solicitud;
    const r = resultadoSandbox(remote, factura.timbradoSandbox.facturamaId);
    if (r.uuid !== factura.uuid || String(remote.Folio) !== p.Folio || remote.Serie !== p.Serie || remote.Issuer?.Rfc !== p.Issuer.Rfc || remote.Receiver?.Rfc !== p.Receiver.Rfc || String(remote.Date).slice(0,19) !== p.Date || !Number.isFinite(Number(remote.Total)) || Math.round(Number(remote.Total)*100) !== Math.round(Number(factura.total)*100)) throw fallo("El comprobante consultado no coincide con la factura. Se conservó el registro sin liberar el pedido.", "SANDBOX_CANCELACION_IDENTIDAD");
  }
  async cancelar(factura, input = {}) {
    this.validarFactura(factura);
    if (factura.estatus !== "TIMBRADA_SANDBOX" || (factura.cancelacionSandbox && !["NO_ENVIADA", "RECHAZADA"].includes(factura.cancelacionSandbox.estado))) throw fallo("Consulta la cancelación existente antes de enviar otra solicitud.");
    const motivo = validarCancelacionSandbox(input, factura.uuid);
    const solicitud = { idFacturama: factura.timbradoSandbox.facturamaId, uuid: factura.uuid, ...motivo };
    const { historial = [], ...anterior } = factura.cancelacionSandbox || {};
    const operation = { version: 1, estado: "CONSULTANDO", solicitud, huella: huellaSolicitud(solicitud), creadaEn: this.now().toISOString(), comentario: String(input.comentario || "").trim().slice(0,300), ...(factura.cancelacionSandbox ? { historial: [...historial, anterior] } : {}) };
    let current = await this.cambiar(factura, { estatus: "CANCELACION_SANDBOX", cancelacionSandbox: operation });
    try {
      const before = await this.pac.consultar(solicitud.idFacturama);
      this.verificarRemoto(current, before);
      if (status(before) !== "active") return await this.evaluar(current, before);
      current = await this.cambiar(current, { cancelacionSandbox: { ...current.cancelacionSandbox, estado: "ENVIADO", enviadaEn: this.now().toISOString() } });
      const response = await this.pac.cancelar(solicitud.idFacturama, motivo);
      const responseStatus = status(response);
      current = await this.cambiar(current, { cancelacionSandbox: { ...current.cancelacionSandbox, estado: "RECIBIDA", respuestaStatus: ["active","pending","canceled","cancel"].includes(responseStatus) ? responseStatus : "desconocido" } });
      const remote = await this.pac.consultar(solicitud.idFacturama);
      this.verificarRemoto(current, remote);
      return await this.evaluar(current, remote);
    } catch (error) {
      const noEnviada = current.cancelacionSandbox.estado === "CONSULTANDO";
      const rechazada = error instanceof FacturamaError && error.rechazo && current.cancelacionSandbox.estado === "ENVIADO";
      await this.facturas.compareAndUpdate(current, { estatus: noEnviada || rechazada ? "TIMBRADA_SANDBOX" : "CANCELACION_SANDBOX", cancelacionSandbox: { ...current.cancelacionSandbox, estado: noEnviada ? "NO_ENVIADA" : rechazada ? "RECHAZADA" : "POR_CONFIRMAR" } });
      throw error;
    }
  }
  async consultar(factura) {
    this.validarOperacion(factura);
    if (!["CANCELACION_SANDBOX", "CANCELADA_SANDBOX", "TIMBRADA_SANDBOX"].includes(factura.estatus)) throw fallo("El estado de la factura no permite consultar esta cancelación.");
    const current = await this.cambiar(factura, { cancelacionSandbox: { ...factura.cancelacionSandbox, consultadaEn: this.now().toISOString() } });
    if (current.cancelacionSandbox.estado === "CONFIRMADA") return this.confirmar(current);
    const remote = await this.pac.consultar(current.cancelacionSandbox.solicitud.idFacturama);
    this.verificarRemoto(current, remote);
    return this.evaluar(current, remote);
  }
  async evaluar(factura, remote) {
    if (cancelada(remote)) return this.confirmar(factura);
    const op = factura.cancelacionSandbox;
    const rechazada = status(remote) === "active" && ["active", undefined].includes(op.respuestaStatus) && ["RECHAZADA", "NO_ENVIADA", "RECIBIDA"].includes(op.estado);
    const current = await this.cambiar(factura, { estatus: rechazada ? "TIMBRADA_SANDBOX" : "CANCELACION_SANDBOX", cancelacionSandbox: { ...op, estado: rechazada ? "RECHAZADA" : "PENDIENTE", ultimoStatus: status(remote) || "desconocido" } });
    return { ...current, advertencia: rechazada ? "Facturama conserva vigente el comprobante. Revisa el motivo antes de solicitar otra cancelación." : "Facturama todavía no confirma la cancelación. El pedido sigue bloqueado; usa Consultar cancelación." };
  }
  async confirmar(factura) {
    if (factura.estatus === "CANCELADA_SANDBOX") return factura;
    let current = factura;
    if (current.cancelacionSandbox.estado !== "CONFIRMADA") current = await this.cambiar(current, { cancelacionSandbox: { ...current.cancelacionSandbox, estado: "CONFIRMADA", confirmadaEn: this.now().toISOString() } });
    // Keep the active key until Firebase is released. A failed synchronization
    // cannot undo a confirmed remote cancellation or permit a duplicate draft.
    if (current.pedido?.firebaseId && !current.pedidoLiberadoPorCancelacion) {
      try { await this.liberarPedido(current); }
      catch { return { ...current, advertencia: "Facturama confirmó la cancelación. Falta liberar el pedido en Firebase; usa Consultar cancelación para continuar." }; }
    }
    const op = current.cancelacionSandbox;
    return this.cambiar(current, { estatus: "CANCELADA_SANDBOX", motivoCancelacion: op.solicitud.motivo, uuidSustitucion: op.solicitud.uuidSustitucion, comentarioCancelacion: op.comentario, cancelacionConfirmadaEn: op.confirmadaEn,
      ...(current.pedido?.firebaseId ? { pedidoMarcadoFacturado: false, pedidoLiberadoPorCancelacion: true, errorSincronizacionPedido: null } : {}) });
  }
}

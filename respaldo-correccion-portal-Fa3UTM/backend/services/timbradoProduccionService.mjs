import { validarEmisorProduccion } from "./produccionFiscal.mjs";
import fs from "node:fs/promises";
import path from "node:path";
import { FacturamaError, solicitudProduccion, huellaSolicitud, resultadoProduccion, idFacturamaValido, verificarXmlProduccion, verificarIdentidadProduccion } from "./facturamaProduccionService.mjs";
import { verificarHuellaSolicitud } from "./huellaSandbox.mjs";

function conflict(code = "PRODUCCION_FACTURA_ACTUALIZADA", message = "La factura cambió durante la consulta. Actualiza el historial y consulta otra vez el mismo registro.") {
  const error = new FacturamaError(message, { statusCode: 409 }); error.code = code; return error;
}

// A production operation never accepts a Sandbox compatibility rewrite.
export function verificarOperacionProduccion(operation) {
  return operation?.version === 1 && operation.huellaVersion === 2 && operation.ambiente === "PRODUCCION" && !Object.hasOwn(operation, "ajusteReferencia") && verificarHuellaSolicitud(operation);
}

// The request and its sending state are durable BEFORE calling the provider.
// Recovery is GET-only. An explicit retry first claims the pending record,
// searches the provider and, only when absent, sends the verified saved request.
// PDF/storage failures never trigger another POST. No migration is required.
export class TimbradoProduccionService {
  constructor({ facturas, pac, storageRoot, obtenerEmisor, documentStorage = null, now = () => new Date() }) {
    Object.assign(this, { facturas, pac, storageRoot, obtenerEmisor, documentStorage, now });
  }

  async cambiar(current, patch) {
    const updated = await this.facturas.compareAndUpdate(current, patch);
    if (!updated) throw conflict();
    return updated;
  }

  async timbrar(factura) {
    if (!this.pac.permitirEmision) throw conflict("PRODUCCION_DESHABILITADA", "Activa producción en el servidor antes de emitir una factura real.");
    if (factura.estatus !== "BORRADOR" || factura.timbradoProduccion || factura.timbradoSandbox || factura.ambienteOperacion !== "PRODUCCION") throw conflict();
    const emisor = await this.obtenerEmisor();
    validarEmisorProduccion(emisor, this.pac.rfc);
    const payload = solicitudProduccion(factura, emisor, this.now());
    await this.pac.verificarConexion();
    const operation = { version: 1, ambiente: "PRODUCCION", huellaVersion: 2, estado: "PREPARADO", solicitud: payload, huella: huellaSolicitud(payload), creadaEn: this.now().toISOString() };
    let current = await this.cambiar(factura, { estatus: "TIMBRANDO_PRODUCCION", timbradoProduccion: operation });
    current = await this.cambiar(current, { timbradoProduccion: { ...operation, estado: "ENVIADO" } });
    let remote;
    try { remote = await this.pac.crear(payload); }
    catch (error) {
      // Only a definite validation/auth rejection permits editing/re-emission.
      if (error instanceof FacturamaError && error.rechazo) {
        await this.cambiar(current, { estatus: "BORRADOR", timbradoProduccion: null });
      } else {
        await this.cambiar(current, { estatus: "REVISION_PRODUCCION", timbradoProduccion: { ...current.timbradoProduccion, estado: "POR_CONFIRMAR" } });
      }
      throw error;
    }
    // Preserve a returned ID before interpreting the UUID or downloading files.
    if (idFacturamaValido(remote?.Id)) current = await this.cambiar(current, { timbradoProduccion: { ...current.timbradoProduccion, facturamaId: remote.Id, estado: "RECIBIDO" } });
    return this.confirmar(current, remote);
  }

  async recuperar(factura) {
    const operation = factura.timbradoProduccion;
    if (!operation || operation.version !== 1 || !operation.solicitud) throw conflict("PRODUCCION_OPERACION_INCOMPLETA", "La factura no tiene una operación de producción completa para consultar. Conserva el registro para revisarlo.");
    if (operation.solicitud?.Issuer?.Rfc !== this.pac.rfc) throw conflict("PRODUCCION_RFC_NO_COINCIDE", "El RFC de la operación no coincide con la cuenta productiva configurada.");
    if (!verificarOperacionProduccion(operation)) throw conflict("PRODUCCION_SOLICITUD_MODIFICADA", "El contenido de la solicitud o su respaldo no coincide con la huella guardada. Conserva la operación para revisar su integridad.");
    if (!["TIMBRANDO_PRODUCCION", "REVISION_PRODUCCION", "TIMBRADA", "CANCELACION_PRODUCCION", "CANCELADA"].includes(factura.estatus)) throw conflict("PRODUCCION_ESTADO_NO_RECUPERABLE", "El estado actual de la factura no permite recuperar un timbrado de producción. Actualiza el historial.");
    // PREPARADO means no HTTP POST could have begun. It remains locked for
    // manual review instead of guessing after an interrupted database write.
    const remote = operation.facturamaId ? await this.pac.consultar(operation.facturamaId) : await this.pac.localizar(operation.solicitud);
    if (!remote) throw conflict("PRODUCCION_RESULTADO_NO_CONFIRMADO", "Facturama todavía no confirma este comprobante. Consulta el registro HTTP de la emisión en Facturama. La factura conserva su folio y fecha para revisar el resultado sin duplicarla.");
    let current = factura;
    if (!operation.facturamaId && idFacturamaValido(remote.Id)) current = await this.cambiar(current, { timbradoProduccion: { ...operation, facturamaId: remote.Id, estado: "RECIBIDO" } });
    return this.confirmar(current, remote);
  }

  async reintentar(factura, { antesDeReenviar = async () => {} } = {}) {
    if (!this.pac.permitirEmision) throw conflict("PRODUCCION_DESHABILITADA", "Activa producción en el servidor antes de reintentar una emisión real.");
    const operation = factura.timbradoProduccion;
    if (factura.estatus !== "REVISION_PRODUCCION" || factura.uuid || operation?.facturamaId) throw conflict("PRODUCCION_REINTENTO_NO_PERMITIDO", "Solo se puede reintentar una solicitud pendiente sin identificador confirmado. Usa Consultar resultado o Recuperar documentos.");
    if (!operation || operation.version !== 1 || !operation.solicitud) throw conflict("PRODUCCION_OPERACION_INCOMPLETA", "La factura no tiene una solicitud de producción completa para reintentar.");
    if (operation.solicitud?.Issuer?.Rfc !== this.pac.rfc) throw conflict("PRODUCCION_RFC_NO_COINCIDE", "El RFC de la operación no coincide con la cuenta productiva configurada.");
    if (!verificarOperacionProduccion(operation)) throw conflict("PRODUCCION_SOLICITUD_MODIFICADA", "La solicitud o su respaldo no coincide con la huella guardada. Conserva la operación para revisar su integridad.");
    if (operation.estado !== "POR_CONFIRMAR") throw conflict("PRODUCCION_REINTENTO_NO_PERMITIDO", "La operación requiere consultar su resultado antes de reintentar.");
    let current = await this.cambiar(factura, { estatus: "TIMBRANDO_PRODUCCION", timbradoProduccion: { ...operation, estado: "CONSULTANDO_REINTENTO" } });
    try {
      const remote = await this.pac.localizar(operation.solicitud, { exigirAusenciaCompleta: true });
      if (remote) {
        if (idFacturamaValido(remote.Id)) current = await this.cambiar(current, { timbradoProduccion: { ...current.timbradoProduccion, facturamaId: remote.Id, estado: "RECIBIDO" } });
        return await this.confirmar(current, remote);
      }
      await antesDeReenviar(current);
      const emisor = await this.obtenerEmisor();
      validarEmisorProduccion(emisor, this.pac.rfc);
      if (emisor.rfc !== operation.solicitud.Issuer.Rfc || emisor.razonSocial.trim() !== operation.solicitud.Issuer.Name || emisor.regimenFiscal !== operation.solicitud.Issuer.FiscalRegime || emisor.serie !== operation.solicitud.Serie || emisor.codigoPostal !== operation.solicitud.ExpeditionPlace) throw conflict("PRODUCCION_EMISOR_MODIFICADO", "La configuración del emisor cambió. Conserva la solicitud para revisión, sin cambiar su folio ni fecha.");
      await this.pac.verificarConexion();
      current = await this.cambiar(current, { timbradoProduccion: {
        ...current.timbradoProduccion, estado: "REENVIANDO",
        reintentos: Number(operation.reintentos || 0) + 1,
        ultimoReintentoEn: this.now().toISOString()
      } });
      const result = await this.pac.crear(current.timbradoProduccion.solicitud);
      if (idFacturamaValido(result?.Id)) current = await this.cambiar(current, { timbradoProduccion: { ...current.timbradoProduccion, facturamaId: result.Id, estado: "RECIBIDO" } });
      return await this.confirmar(current, result);
    } catch (error) {
      // A rejection of this retry cannot resolve an uncertain earlier POST.
      // Never clear the saved operation, UUID, ID, folio or original date.
      // Conditional restore also leaves a concurrent confirmation untouched.
      await this.facturas.compareAndUpdate(current, { estatus: "REVISION_PRODUCCION", timbradoProduccion: { ...current.timbradoProduccion, estado: "POR_CONFIRMAR" } });
      throw error;
    }
  }

  async confirmar(factura, remote) {
    if (!remote?.Issuer || !remote?.Receiver || remote.Total == null) remote = await this.pac.consultar(factura.timbradoProduccion.facturamaId);
    const result = resultadoProduccion(remote, factura.timbradoProduccion.facturamaId);
    verificarIdentidadProduccion(remote, factura.timbradoProduccion.solicitud, factura);
    if (factura.uuid && factura.uuid !== result.uuid) throw new FacturamaError("El UUID consultado no coincide con el guardado. Revisa el resultado en Facturama.");
    const estatus = ["CANCELACION_PRODUCCION", "CANCELADA"].includes(factura.estatus) ? factura.estatus : "TIMBRADA";
    let current = await this.cambiar(factura, { estatus, uuid: result.uuid, fechaTimbrado: result.fechaTimbrado, pac: "facturama_produccion", ambienteTimbrado: "PRODUCCION", documentosPendientes: true,
      timbradoProduccion: { ...factura.timbradoProduccion, huellaVersion: 2, huella: huellaSolicitud(factura.timbradoProduccion.solicitud), facturamaId: result.id, estado: "CONFIRMADO" } });
    try {
      const xml = await this.pac.documento(result.id, "xml");
      verificarXmlProduccion(xml, current.timbradoProduccion.solicitud, result, current);
      const pdf = await this.pac.documento(result.id, "pdf");
      const folder = path.join(this.storageRoot, "produccion", result.uuid), base = "comprobante";
      await fs.mkdir(folder, { recursive: true });
      const xmlFile = path.join(folder, `${base}.xml`), pdfFile = path.join(folder, `${base}.pdf`);
      await fs.writeFile(xmlFile, xml); await fs.writeFile(pdfFile, pdf);
      let storagePaths = {};
      if (this.documentStorage) storagePaths = await this.documentStorage.guardarArchivos({ factura: current, fechaTimbrado: result.fechaTimbrado, xmlFile, pdfFile });
      current = await this.cambiar(current, { ...storagePaths, xmlRelativePath: path.relative(this.storageRoot, xmlFile), pdfRelativePath: path.relative(this.storageRoot, pdfFile), documentStorage: this.documentStorage ? "supabase" : "local", documentosPendientes: false });
    } catch (error) {
      // UUID and remote ID were already saved. This is a recoverable document
      // failure, not a failed stamp. Do not reset it to BORRADOR.
      const detail = error instanceof FacturamaError ? ` ${error.message}` : "";
      return { ...current, advertencia: `Facturama confirmó la factura. Falta recuperar sus archivos; pulsa Recuperar documentos. No vuelvas a crear el borrador.${detail}` };
    }
    return current;
  }
}

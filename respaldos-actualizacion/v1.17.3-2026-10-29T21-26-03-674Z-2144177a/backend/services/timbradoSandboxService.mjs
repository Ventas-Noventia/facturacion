import fs from "node:fs/promises";
import path from "node:path";
import { FacturamaError, solicitudSandbox, huellaSolicitud, resultadoSandbox, idFacturamaValido, verificarXmlSandbox } from "./facturamaSandboxService.mjs";
import { verificarHuellaSolicitud } from "./huellaSandbox.mjs";

function conflict(code = "SANDBOX_FACTURA_ACTUALIZADA", message = "La factura cambió durante la consulta. Actualiza el historial y consulta otra vez el mismo registro.") {
  const error = new FacturamaError(message, { statusCode: 409 }); error.code = code; return error;
}

// The request and its sending state are durable BEFORE calling the provider.
// Recovery is GET-only. An explicit retry first claims the pending record,
// searches the provider and, only when absent, sends the verified saved request.
// PDF/storage failures never trigger another POST. No migration is required.
export class TimbradoSandboxService {
  constructor({ facturas, pac, storageRoot, documentStorage = null, now = () => new Date() }) {
    Object.assign(this, { facturas, pac, storageRoot, documentStorage, now });
  }

  async cambiar(current, patch) {
    const updated = await this.facturas.compareAndUpdate(current, patch);
    if (!updated) throw conflict();
    return updated;
  }

  async timbrar(factura) {
    if (factura.estatus !== "BORRADOR" || factura.timbradoSandbox) throw conflict();
    const payload = solicitudSandbox(factura, this.now());
    const operation = { version: 1, huellaVersion: 2, estado: "PREPARADO", solicitud: payload, huella: huellaSolicitud(payload), creadaEn: this.now().toISOString() };
    let current = await this.cambiar(factura, { estatus: "TIMBRANDO_SANDBOX", timbradoSandbox: operation });
    current = await this.cambiar(current, { timbradoSandbox: { ...operation, estado: "ENVIADO" } });
    let remote;
    try { remote = await this.pac.crear(payload); }
    catch (error) {
      // Only a definite validation/auth rejection permits editing/re-emission.
      if (error instanceof FacturamaError && error.rechazo) {
        await this.cambiar(current, { estatus: "BORRADOR", timbradoSandbox: null });
      } else {
        await this.cambiar(current, { estatus: "REVISION_SANDBOX", timbradoSandbox: { ...current.timbradoSandbox, estado: "POR_CONFIRMAR" } });
      }
      throw error;
    }
    // Preserve a returned ID before interpreting the UUID or downloading files.
    if (idFacturamaValido(remote?.Id)) current = await this.cambiar(current, { timbradoSandbox: { ...current.timbradoSandbox, facturamaId: remote.Id, estado: "RECIBIDO" } });
    return this.confirmar(current, remote);
  }

  async recuperar(factura) {
    const operation = factura.timbradoSandbox;
    if (!operation || operation.version !== 1 || !operation.solicitud) throw conflict("SANDBOX_OPERACION_INCOMPLETA", "La factura no tiene una operación Sandbox completa para consultar. Conserva el registro para revisarlo.");
    if (!verificarHuellaSolicitud(operation)) throw conflict("SANDBOX_SOLICITUD_MODIFICADA", "El contenido de la solicitud no coincide con la huella guardada. Conserva la operación para revisar su integridad.");
    if (!["TIMBRANDO_SANDBOX", "REVISION_SANDBOX", "TIMBRADA_SANDBOX"].includes(factura.estatus)) throw conflict("SANDBOX_ESTADO_NO_RECUPERABLE", "El estado actual de la factura no permite recuperar un timbrado Sandbox. Actualiza el historial.");
    // PREPARADO means no HTTP POST could have begun. It remains locked for
    // manual review instead of guessing after an interrupted database write.
    const remote = operation.facturamaId ? await this.pac.consultar(operation.facturamaId) : await this.pac.localizar(operation.solicitud);
    if (!remote) throw conflict("SANDBOX_RESULTADO_NO_CONFIRMADO", "Facturama todavía no confirma este comprobante. Consulta el registro HTTP de la emisión en Facturama. La factura conserva su folio y fecha para revisar el resultado sin duplicarla.");
    let current = factura;
    if (!operation.facturamaId && idFacturamaValido(remote.Id)) current = await this.cambiar(current, { timbradoSandbox: { ...operation, facturamaId: remote.Id, estado: "RECIBIDO" } });
    return this.confirmar(current, remote);
  }

  async reintentar(factura, { antesDeReenviar = async () => {} } = {}) {
    const operation = factura.timbradoSandbox;
    if (factura.estatus !== "REVISION_SANDBOX" || factura.uuid || operation?.facturamaId) throw conflict("SANDBOX_REINTENTO_NO_PERMITIDO", "Solo se puede reintentar una solicitud pendiente sin identificador confirmado. Usa Consultar resultado o Recuperar documentos.");
    if (!operation || operation.version !== 1 || !operation.solicitud) throw conflict("SANDBOX_OPERACION_INCOMPLETA", "La factura no tiene una solicitud Sandbox completa para reintentar.");
    if (!verificarHuellaSolicitud(operation)) throw conflict("SANDBOX_SOLICITUD_MODIFICADA", "La solicitud no coincide con la huella guardada. Conserva la operación para revisar su integridad.");
    if (operation.estado !== "POR_CONFIRMAR") throw conflict("SANDBOX_REINTENTO_NO_PERMITIDO", "La operación requiere consultar su resultado antes de reintentar.");
    let current = await this.cambiar(factura, { estatus: "TIMBRANDO_SANDBOX", timbradoSandbox: { ...operation, estado: "CONSULTANDO_REINTENTO" } });
    try {
      const remote = await this.pac.localizar(operation.solicitud, { exigirAusenciaCompleta: true });
      if (remote) {
        if (idFacturamaValido(remote.Id)) current = await this.cambiar(current, { timbradoSandbox: { ...current.timbradoSandbox, facturamaId: remote.Id, estado: "RECIBIDO" } });
        return await this.confirmar(current, remote);
      }
      await antesDeReenviar(current);
      // This second CAS prevents a stale consultation from sending after
      // another process confirmed or changed the operation during the GET.
      current = await this.cambiar(current, { timbradoSandbox: {
        ...current.timbradoSandbox, estado: "REENVIANDO", huellaVersion: 2,
        huella: huellaSolicitud(operation.solicitud),
        reintentos: Number(operation.reintentos || 0) + 1,
        ultimoReintentoEn: this.now().toISOString()
      } });
      const result = await this.pac.crear(current.timbradoSandbox.solicitud);
      if (idFacturamaValido(result?.Id)) current = await this.cambiar(current, { timbradoSandbox: { ...current.timbradoSandbox, facturamaId: result.Id, estado: "RECIBIDO" } });
      return await this.confirmar(current, result);
    } catch (error) {
      // A rejection of this retry cannot resolve an uncertain earlier POST.
      // Never clear the saved operation, UUID, ID, folio or original date.
      // Conditional restore also leaves a concurrent confirmation untouched.
      await this.facturas.compareAndUpdate(current, { estatus: "REVISION_SANDBOX", timbradoSandbox: { ...current.timbradoSandbox, estado: "POR_CONFIRMAR" } });
      throw error;
    }
  }

  async confirmar(factura, remote) {
    const result = resultadoSandbox(remote, factura.timbradoSandbox.facturamaId);
    if (factura.uuid && factura.uuid !== result.uuid) throw new FacturamaError("El UUID consultado no coincide con el guardado. Revisa el resultado en Facturama.");
    let current = await this.cambiar(factura, { estatus: "TIMBRADA_SANDBOX", uuid: result.uuid, fechaTimbrado: result.fechaTimbrado, pac: "facturama_sandbox", ambienteTimbrado: "SANDBOX", documentosPendientes: true,
      timbradoSandbox: { ...factura.timbradoSandbox, huellaVersion: 2, huella: huellaSolicitud(factura.timbradoSandbox.solicitud), facturamaId: result.id, estado: "CONFIRMADO" } });
    try {
      const xml = await this.pac.documento(result.id, "xml");
      verificarXmlSandbox(xml, current.timbradoSandbox.solicitud, result, current);
      const pdf = await this.pac.documento(result.id, "pdf");
      const folder = path.join(this.storageRoot, "sandbox", result.uuid), base = "comprobante";
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
      return { ...current, advertencia: `Facturama confirmó la factura de prueba. Falta recuperar sus archivos; pulsa Recuperar documentos. No vuelvas a crear el borrador.${detail}` };
    }
    return current;
  }
}

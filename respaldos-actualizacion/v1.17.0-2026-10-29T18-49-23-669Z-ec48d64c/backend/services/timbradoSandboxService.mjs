import fs from "node:fs/promises";
import path from "node:path";
import { FacturamaError, solicitudSandbox, huellaSolicitud, resultadoSandbox, idFacturamaValido, verificarXmlSandbox } from "./facturamaSandboxService.mjs";

const conflict = () => new FacturamaError("La factura cambió o tiene una operación en curso. Actualiza el historial.", { statusCode: 409 });

// The request and its sending state are durable BEFORE calling the provider.
// Once ENVIADO, recovery is GET-only, even after a process restart. PDF/storage
// failures never trigger another POST. No database migration is required.
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
    const operation = { version: 1, estado: "PREPARADO", solicitud: payload, huella: huellaSolicitud(payload), creadaEn: this.now().toISOString() };
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
    if (!operation || operation.version !== 1 || !operation.solicitud || operation.huella !== huellaSolicitud(operation.solicitud) || !["TIMBRANDO_SANDBOX", "REVISION_SANDBOX", "TIMBRADA_SANDBOX"].includes(factura.estatus)) throw conflict();
    // PREPARADO means no HTTP POST could have begun. It remains locked for
    // manual review instead of guessing after an interrupted database write.
    const remote = operation.facturamaId ? await this.pac.consultar(operation.facturamaId) : await this.pac.localizar(operation.solicitud);
    if (!remote) throw new FacturamaError("Facturama todavía no confirma este comprobante. Espera y pulsa Consultar resultado. La factura se mantiene bloqueada para evitar una emisión duplicada.", { statusCode: 409 });
    let current = factura;
    if (!operation.facturamaId && idFacturamaValido(remote.Id)) current = await this.cambiar(current, { timbradoSandbox: { ...operation, facturamaId: remote.Id, estado: "RECIBIDO" } });
    return this.confirmar(current, remote);
  }

  async confirmar(factura, remote) {
    const result = resultadoSandbox(remote, factura.timbradoSandbox.facturamaId);
    if (factura.uuid && factura.uuid !== result.uuid) throw new FacturamaError("El UUID consultado no coincide con el guardado. Revisa el resultado en Facturama.");
    let current = await this.cambiar(factura, { estatus: "TIMBRADA_SANDBOX", uuid: result.uuid, fechaTimbrado: result.fechaTimbrado, pac: "facturama_sandbox", ambienteTimbrado: "SANDBOX", documentosPendientes: true,
      timbradoSandbox: { ...factura.timbradoSandbox, facturamaId: result.id, estado: "CONFIRMADO" } });
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

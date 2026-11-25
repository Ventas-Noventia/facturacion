import { calcularTotales } from "../../shared/domain/calculos.mjs";
export { huellaSolicitud } from "./huellaSandbox.mjs";

export const FACTURAMA_SANDBOX_URL = "https://apisandbox.facturama.mx";
export const EMISOR_SANDBOX = Object.freeze({ Rfc: "EKU9003173C9", Name: "ESCUELA KEMPER URGATE", FiscalRegime: "601" });
export const RECEPTOR_SANDBOX = Object.freeze({ Rfc: "URE180429TM6", Name: "UNIVERSIDAD ROBOTICA ESPAÑOLA", FiscalRegime: "601", TaxZipCode: "86991", CfdiUse: "G03" });
const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;
const ID = /^[a-zA-Z0-9_-]{1,100}$/;

export class FacturamaError extends Error {
  constructor(message, { statusCode = 502, rechazo = false, httpStatus = 0 } = {}) {
    super(message); this.name = "FacturamaError"; this.statusCode = statusCode;
    this.rechazo = rechazo; this.httpStatus = httpStatus;
  }
}
const invalid = message => { throw new FacturamaError(message, { statusCode: 400 }); };
const cents = n => Math.round(Number(n) * 100);
const six = n => Number(Number(n).toFixed(6));

export function fechaMexico(now = new Date()) {
  const parts = Object.fromEntries(new Intl.DateTimeFormat("en-CA", { timeZone: "America/Mexico_City", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23" }).formatToParts(now).map(p => [p.type, p.value]));
  return `${parts.year}-${parts.month}-${parts.day}T${parts.hour}:${parts.minute}:${parts.second}`;
}

// Only public test identities are sent. The customer's saved fiscal profile and
// NOVENTIA's company configuration are never replaced with these fixtures.
export function solicitudSandbox(factura, now = new Date()) {
  if (!UUID.test(factura.id || "")) invalid("La factura no tiene un identificador válido.");
  if (factura.moneda !== "MXN") invalid("Esta prueba admite únicamente compras en MXN.");
  if (!["01", "02", "03", "04", "28", "99"].includes(factura.formaPago) || !["PUE", "PPD"].includes(factura.metodoPago)) invalid("Revisa la forma y el método de pago del borrador.");
  if ((factura.metodoPago === "PUE" && factura.formaPago === "99") || (factura.metodoPago === "PPD" && factura.formaPago !== "99")) invalid("Para PUE selecciona la forma de pago; para PPD utiliza 99 - Por definir.");
  const calculated = calcularTotales(factura.conceptos || []);
  if (!["subtotal", "impuestos", "total"].every(k => Number.isFinite(Number(factura[k])) && cents(factura[k]) === cents(calculated[k])) || Number(factura.total) <= 0) invalid("Los importes guardados no cuadran. Revisa el borrador antes de timbrar.");
  const items = calculated.detalles.map(c => {
    if (Number(c.tasaIva) !== 0.16) invalid("Esta integración de pruebas utiliza IVA del 16%.");
    const productCode = String(c.claveProdServSat || "01010101"), unitCode = String(c.claveUnidad || "H87");
    if (!/^\d{8}$/.test(productCode) || !/^[a-zA-Z0-9]{2,3}$/.test(unitCode)) invalid("Revisa las claves SAT del producto y de la unidad.");
    const description = String(c.descripcion || "").trim();
    if (!description || description.length > 1000 || /[\x00-\x08\x0b\x0c\x0e-\x1f]/.test(description)) invalid("Revisa la descripción del producto.");
    return { ProductCode: productCode, IdentificationNumber: String(c.sku || c.clave || "").slice(0, 100), Description: description,
      UnitCode: unitCode, Unit: String(c.unidad || "Pieza").slice(0, 20), UnitPrice: six(c.precioUnitario), Quantity: six(c.cantidad),
      Subtotal: c.calculo.bruto, ...(c.calculo.descuento > 0 ? { Discount: c.calculo.descuento } : {}), TaxObject: "02",
      Taxes: [{ Total: c.calculo.impuesto, Name: "IVA", Base: c.calculo.subtotal, Rate: 0.16, IsRetention: false }], Total: c.calculo.total };
  });
  return { NameId: "1", Currency: "MXN", CfdiType: "I", Serie: "NVSB", Folio: factura.id.replaceAll("-", ""), Date: fechaMexico(now),
    OrderNumber: factura.id, PaymentForm: factura.formaPago, PaymentMethod: factura.metodoPago, ExpeditionPlace: "42501", Exportation: "01",
    Observations: `PRUEBA SANDBOX SIN VALIDEZ FISCAL. Referencia interna: ${String(factura.folioInterno || factura.id).replace(/[^a-zA-Z0-9_-]/g, "").slice(0, 80)}. Emisor y receptor de pruebas.`,
    Issuer: { ...EMISOR_SANDBOX }, Receiver: { ...RECEPTOR_SANDBOX }, Items: items };
}

export const idFacturamaValido = value => typeof value === "string" && ID.test(value);

export function resultadoSandbox(data, expectedId = null) {
  if (!data || typeof data !== "object" || !idFacturamaValido(data.Id) || (expectedId && data.Id !== expectedId)) throw new FacturamaError("Facturama no devolvió un identificador de comprobante válido.");
  const stamp = data.TaxStamp || data.Complement?.TaxStamp;
  if (!UUID.test(stamp?.Uuid || "")) throw new FacturamaError("El comprobante aún no tiene un UUID confirmado. Consulta nuevamente su resultado.");
  const date = String(stamp.Date || "");
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})?$/.test(date)) throw new FacturamaError("Facturama no devolvió una fecha de timbrado válida.");
  const timestamp = /(?:Z|[+-]\d{2}:\d{2})$/.test(date) ? date : `${date}-06:00`;
  if (!Number.isFinite(Date.parse(timestamp))) throw new FacturamaError("La fecha de timbrado no es válida.");
  return { id: data.Id, uuid: stamp.Uuid.toUpperCase(), fechaTimbrado: timestamp };
}

export function decodificarDocumento(data, tipo) {
  if (!data || String(data.ContentEncoding).toLowerCase() !== "base64" || typeof data.Content !== "string") throw new FacturamaError(`Facturama no devolvió el ${tipo.toUpperCase()} esperado.`);
  const text = data.Content.replace(/\s/g, "");
  if (!text || text.length > 12 * 1024 * 1024 || text.length % 4 !== 0 || !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(text)) throw new FacturamaError("El documento recibido no tiene una codificación válida.");
  const bytes = Buffer.from(text, "base64");
  if (data.ContentLength != null && Number(data.ContentLength) !== bytes.length) throw new FacturamaError("El documento recibido está incompleto.");
  if (tipo === "pdf" && !bytes.subarray(0, 8).toString().startsWith("%PDF-")) throw new FacturamaError("Facturama no devolvió un PDF válido.");
  return bytes;
}

// Integrity check of the returned XML's critical identifiers and amounts. This
// does not substitute a SAT schema/signature validator. Original bytes survive.
export function verificarXmlSandbox(bytes, payload, resultado, factura) {
  const text = bytes.toString("utf8");
  if (/<!DOCTYPE|<!ENTITY/i.test(text) || !text.includes("http://www.sat.gob.mx/cfd/4") || !text.includes("http://www.sat.gob.mx/TimbreFiscalDigital")) throw new FacturamaError("El XML recibido no corresponde a un CFDI 4.0 timbrado.");
  function node(name) {
    const matches = [...text.matchAll(new RegExp(`<(?:(?:[A-Za-z_][\\w.-]*):)?${name}\\b([^<>]*?)/?>`, "g"))];
    if (matches.length !== 1) throw new FacturamaError(`El XML no contiene un nodo ${name} único.`);
    return Object.fromEntries([...matches[0][1].matchAll(/([A-Za-z_][\w:.-]*)\s*=\s*(?:"([^"]*)"|'([^']*)')/g)].map(m => [m[1], m[2] ?? m[3]]));
  }
  const invoice = node("Comprobante"), issuer = node("Emisor"), receiver = node("Receptor"), stamp = node("TimbreFiscalDigital");
  if (invoice.Version !== "4.0" || invoice.Moneda !== "MXN" || invoice.TipoDeComprobante !== "I" || invoice.Folio !== payload.Folio || invoice.Serie !== payload.Serie || invoice.Fecha !== payload.Date || issuer.Rfc !== EMISOR_SANDBOX.Rfc || receiver.Rfc !== RECEPTOR_SANDBOX.Rfc || String(stamp.UUID).toUpperCase() !== resultado.uuid || !/^\d+(?:\.\d{1,6})?$/.test(invoice.Total || "") || cents(invoice.Total) !== cents(factura.total)) throw new FacturamaError("El XML recibido no coincide con la operación guardada. Se conservó el identificador para revisar el resultado sin emitir otra factura.");
  return true;
}

export class FacturamaSandboxService {
  #authorization; #username; #fetch;
  constructor({ username, password, baseUrl = FACTURAMA_SANDBOX_URL, fetchImpl = globalThis.fetch, timeoutMs = 25000 } = {}) {
    let url; try { url = new URL(baseUrl); } catch { throw new FacturamaError("FACTURAMA_API_BASE_URL debe ser https://apisandbox.facturama.mx", { statusCode: 503 }); }
    if (url.origin !== FACTURAMA_SANDBOX_URL || url.pathname !== "/" || url.search || url.hash || url.username || url.password) throw new FacturamaError("Esta versión permite únicamente Facturama Sandbox: https://apisandbox.facturama.mx", { statusCode: 503 });
    if (process.env.NODE_TLS_REJECT_UNAUTHORIZED === "0") throw new FacturamaError("Activa la verificación TLS antes de conectar Facturama.", { statusCode: 503 });
    if (!String(username || "").trim() || !String(password || "") || /[:\r\n]/.test(username) || /[\r\n]/.test(password) || /^TU_/i.test(username) || /^TU_/i.test(password)) throw new FacturamaError("Configura FACTURAMA_USERNAME y FACTURAMA_PASSWORD con tus accesos de Sandbox.", { statusCode: 503 });
    this.#username = String(username); this.#authorization = `Basic ${Buffer.from(`${username}:${password}`, "utf8").toString("base64")}`;
    this.#fetch = fetchImpl; this.timeoutMs = timeoutMs;
  }

  async request(endpoint, { method = "GET", body } = {}) {
    const allowed = (method === "POST" && endpoint === "/api-lite/4/cfdis") || (method === "GET" && (/^\/api-lite\/cfdis\/[a-zA-Z0-9_-]{1,100}$/.test(endpoint) || /^\/cfdi\/(xml|pdf)\/issuedLite\/[a-zA-Z0-9_-]{1,100}$/.test(endpoint) || endpoint.startsWith("/cfdi?type=issuedLite&")));
    if (!allowed) throw new FacturamaError("Operación de Facturama no permitida.");
    const controller = new AbortController(), timer = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      const response = await this.#fetch(`${FACTURAMA_SANDBOX_URL}${endpoint}`, { method, redirect: "error", signal: controller.signal,
        headers: { Accept: "application/json", Authorization: this.#authorization, "User-Agent": this.#username, ...(body ? { "Content-Type": "application/json" } : {}) }, ...(body ? { body: JSON.stringify(body) } : {}) });
      if (response.redirected || (response.url && new URL(response.url).origin !== FACTURAMA_SANDBOX_URL)) throw new FacturamaError("Facturama intentó redirigir la conexión.");
      if (!response.ok) {
        await response.body?.cancel();
        const status = response.status;
        const message = status === 401 || status === 403 ? "Facturama rechazó tus accesos de Sandbox. Revisa FACTURAMA_USERNAME y FACTURAMA_PASSWORD."
          : status === 400 || status === 422 ? "Facturama rechazó los datos del comprobante. Revisa forma de pago, claves SAT y descripciones; consulta Http Logs de tu cuenta si persiste."
          : status === 429 ? "Facturama limitó las peticiones. Espera un momento antes de consultar el resultado."
          : `Facturama no pudo completar la operación (HTTP ${status}). Consulta el resultado antes de intentar otra emisión.`;
        throw new FacturamaError(message, { httpStatus: status, rechazo: [400, 401, 403, 404, 405, 422].includes(status) });
      }
      const reader = response.body?.getReader(); if (!reader) throw new FacturamaError("Facturama devolvió una respuesta vacía.");
      const chunks = []; let size = 0;
      while (true) { const { done, value } = await reader.read(); if (done) break; size += value.byteLength; if (size > 16 * 1024 * 1024) { await reader.cancel(); throw new FacturamaError("La respuesta de Facturama excede el tamaño permitido."); } chunks.push(Buffer.from(value)); }
      try { return JSON.parse(Buffer.concat(chunks).toString("utf8")); }
      catch { throw new FacturamaError("Facturama devolvió una respuesta no válida. Consulta el resultado sin emitir otra factura."); }
    } catch (error) {
      if (error instanceof FacturamaError) throw error;
      throw new FacturamaError("No se pudo completar la conexión con Facturama Sandbox. Consulta el resultado para comprobar si se emitió.");
    } finally { clearTimeout(timer); }
  }

  crear(payload) { return this.request("/api-lite/4/cfdis", { method: "POST", body: payload }); }
  consultar(id) { if (!idFacturamaValido(id)) throw new FacturamaError("Identificador de Facturama inválido."); return this.request(`/api-lite/cfdis/${id}`); }
  async documento(id, tipo) {
    if (!idFacturamaValido(id) || !["xml", "pdf"].includes(tipo)) throw new FacturamaError("Documento no permitido.");
    return decodificarDocumento(await this.request(`/cfdi/${tipo}/issuedLite/${id}`), tipo);
  }

  async localizar(payload) {
    const candidates = [];
    for (let page = 0; page < 5; page++) {
      const query = new URLSearchParams({ type: "issuedLite", folio: payload.Folio, rfcIssuer: EMISOR_SANDBOX.Rfc, page: String(page), status: "all" });
      const rows = await this.request(`/cfdi?${query}`);
      if (!Array.isArray(rows)) throw new FacturamaError("Facturama no devolvió una consulta de comprobantes válida.");
      for (const row of rows) {
        if (String(row.Folio) !== payload.Folio || row.Serie !== payload.Serie || (row.Issuer?.Rfc && row.Issuer.Rfc !== payload.Issuer.Rfc) || !idFacturamaValido(row.Id)) continue;
        const detail = await this.consultar(row.Id);
        if (String(detail.Folio) === payload.Folio && detail.Serie === payload.Serie && detail.Issuer?.Rfc === payload.Issuer.Rfc && String(detail.Date).slice(0, 19) === payload.Date && (!detail.OrderNumber || detail.OrderNumber === payload.OrderNumber)) candidates.push(detail);
      }
      if (rows.length < 10) {
        if (candidates.length > 1) throw new FacturamaError("Hay más de un comprobante para la operación. Revisa los identificadores en Http Logs de Facturama.");
        return candidates[0] || null;
      }
    }
    throw new FacturamaError("La consulta devolvió demasiadas coincidencias. Revisa el resultado en Http Logs de Facturama.");
  }
}

import { randomUUID } from "node:crypto";
import { normalizarVentaEcommerce } from "./ecommerceVentaService.mjs";

export class EcommerceApiError extends Error {
  constructor(message, { code = "ECOMMERCE_ERROR", requestId = "", retryAfter = 0 } = {}) {
    super(message);
    this.name = "EcommerceApiError";
    this.code = code;
    this.requestId = /^[a-zA-Z0-9-]{1,80}$/.test(requestId) ? requestId : "";
    this.retryAfter = retryAfter;
    this.statusCode = 503;
  }
}

const wait = ms => new Promise(resolve => setTimeout(resolve, ms));

// Credentials and tokens stay in this server-only object, never in order data.
export class EcommerceApiService {
  #base; #username; #password; #fetch; #now; #sleep; #timeout;
  #token = null; #tokenPending = null; #blockedUntil = 0;

  constructor({
    baseUrl = process.env.ECOMMERCE_API_BASE_URL || "",
    username = process.env.ECOMMERCE_API_USERNAME || "",
    password = process.env.ECOMMERCE_API_PASSWORD || "",
    fetchImpl = globalThis.fetch, now = Date.now, sleep = wait, timeoutMs = 12000
  } = {}) {
    this.#base = String(baseUrl).replace(/\/+$/, "");
    this.#username = String(username); this.#password = String(password);
    this.#fetch = fetchImpl; this.#now = now; this.#sleep = sleep; this.#timeout = timeoutMs;
  }

  #configuration() {
    let url;
    try { url = new URL(this.#base); }
    catch { throw new EcommerceApiError("Configura ECOMMERCE_API_BASE_URL en el servidor."); }
    if (url.protocol !== "https:" || url.username || url.password || url.search || url.hash) {
      throw new EcommerceApiError("La dirección de la API del e-commerce debe usar HTTPS y no contener credenciales ni parámetros.", { code: "HTTPS_REQUIRED" });
    }
    if (!this.#username.trim() || !this.#password) {
      throw new EcommerceApiError("Configura el usuario y la contraseña de la API del e-commerce en el servidor.");
    }
    return url;
  }

  #safeUrl(value) {
    const base = this.#configuration();
    const url = new URL(value, `${this.#base}/`);
    const orders = `${base.pathname.replace(/\/$/, "")}/orders`;
    const suffix = url.pathname.slice(orders.length);
    if (url.origin !== base.origin || url.username || url.password || url.hash ||
        !url.pathname.startsWith(orders) || !(suffix === "" || /^\/[1-9]\d*$/.test(suffix))) {
      throw new EcommerceApiError("La API devolvió una dirección de consulta no permitida.", { code: "INVALID_RESPONSE" });
    }
    return url;
  }

  async #request(url, options) {
    if (this.#blockedUntil > this.#now()) {
      const retryAfter = Math.ceil((this.#blockedUntil - this.#now()) / 1000);
      throw new EcommerceApiError(`El e-commerce solicita esperar ${retryAfter} segundos antes de volver a consultar.`, { code: "RATE_LIMITED", retryAfter });
    }
    for (let attempt = 0; attempt < 3; attempt++) {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), this.#timeout);
      let response, payload;
      try {
        response = await this.#fetch(String(url), {
          ...options, redirect: "error", signal: controller.signal,
          headers: { Accept: "application/json", "X-Request-Id": randomUUID(), ...options.headers }
        });
        const text = await response.text();
        try { payload = text ? JSON.parse(text) : null; } catch { payload = null; }
      } catch {
        throw new EcommerceApiError("No fue posible conectar con el e-commerce. Revisa su disponibilidad y la dirección HTTPS.", { code: "CONNECTION_FAILED" });
      } finally { clearTimeout(timer); }
      const requestId = payload?.request_id || response.headers.get("X-Request-Id") || "";
      if (response.ok) {
        if (!payload || typeof payload !== "object") throw new EcommerceApiError("El e-commerce no devolvió una respuesta JSON válida.", { code: "INVALID_RESPONSE", requestId });
        return { status: response.status, data: payload };
      }
      const retryAfter = /^\d+$/.test(response.headers.get("Retry-After") || "") ? Number(response.headers.get("Retry-After")) : 0;
      if (response.status === 429) this.#blockedUntil = this.#now() + Math.max(retryAfter, 1) * 1000;
      if ([429, 500, 503].includes(response.status) && attempt < 2) {
        const delay = Math.max(retryAfter * 1000, 300 * 2 ** attempt);
        // A long Retry-After is returned to the caller, never shortened.
        if (delay <= 3000) { await this.#sleep(delay); continue; }
      }
      if (response.status === 401 || response.status === 404) return { status: response.status, data: null };
      const messages = {
        403: payload?.error?.code === "HTTPS_REQUIRED" ? "El e-commerce exige una conexión HTTPS." : "La integración no tiene permiso para consultar ventas del e-commerce.",
        405: "La ruta o el método de la API del e-commerce no coincide con su documentación.",
        422: "El e-commerce rechazó los parámetros de la consulta.",
        429: `El e-commerce limitó las consultas. Vuelve a intentar en ${Math.max(retryAfter, 1)} segundos.`
      };
      throw new EcommerceApiError(messages[response.status] || "El servicio de e-commerce no está disponible en este momento.", {
        code: response.status === 429 ? "RATE_LIMITED" : "UPSTREAM_ERROR", requestId, retryAfter
      });
    }
  }

  async #accessToken() {
    if (this.#token && this.#token.expiresAt > this.#now()) return this.#token.value;
    if (this.#tokenPending) return this.#tokenPending;
    this.#configuration();
    this.#tokenPending = (async () => {
      const result = await this.#request(`${this.#base}/auth/token`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username: this.#username, password: this.#password })
      });
      if (result.status === 401) throw new EcommerceApiError("El e-commerce rechazó las credenciales de la integración.", { code: "AUTHENTICATION_FAILED" });
      const token = result.data?.access_token, seconds = Number(result.data?.expires_in);
      if (typeof token !== "string" || !token || /[\r\n]/.test(token) || String(result.data?.token_type).toLowerCase() !== "bearer" || !Number.isFinite(seconds) || seconds <= 0) {
        throw new EcommerceApiError("La respuesta del token del e-commerce no coincide con el contrato.", { code: "INVALID_RESPONSE" });
      }
      this.#token = { value: token, expiresAt: this.#now() + Math.max(1, Math.min(seconds, 3600) - 30) * 1000 };
      return token;
    })();
    try { return await this.#tokenPending; } finally { this.#tokenPending = null; }
  }

  async #get(url) {
    const target = this.#safeUrl(url);
    for (let attempt = 0; attempt < 2; attempt++) {
      const token = await this.#accessToken();
      const result = await this.#request(target, { method: "GET", headers: { Authorization: `Bearer ${token}` } });
      if (result.status === 404) return null;
      if (result.status !== 401) return result.data;
      if (this.#token?.value === token) this.#token = null;
    }
    throw new EcommerceApiError("El e-commerce no aceptó el token renovado. Revisa las credenciales o permisos de la integración.", { code: "AUTHENTICATION_FAILED" });
  }

  async obtenerPedido(folio) {
    const key = String(folio || "").trim();
    if (!key) return null;
    this.#configuration();
    let id;
    if (/^[1-9]\d*$/.test(key)) id = key;
    else {
      if (key.length > 30) return null;
      let next = `${this.#base}/orders?${new URLSearchParams({ order_number: key })}`;
      const visited = new Set();
      for (let page = 0; next && page < 10; page++) {
        if (visited.has(next)) throw new EcommerceApiError("La paginación del e-commerce se repitió.", { code: "INVALID_RESPONSE" });
        visited.add(next);
        const list = await this.#get(next);
        if (!list) return null;
        if (!Array.isArray(list.data)) throw new EcommerceApiError("El listado del e-commerce no tiene el formato esperado.", { code: "INVALID_RESPONSE" });
        const matches = list.data.filter(item => String(item.order_number).toUpperCase() === key.toUpperCase());
        if (matches.length > 1) throw new EcommerceApiError("El e-commerce devolvió más de una venta para el mismo folio.", { code: "INVALID_RESPONSE" });
        if (matches.length === 1) { id = matches[0].id; break; }
        next = list.links?.next || null;
      }
      if (!id && next) throw new EcommerceApiError("No se pudo completar la búsqueda del e-commerce.", { code: "INVALID_RESPONSE" });
      if (!id) return null;
    }
    if (!/^[1-9]\d*$/.test(String(id)) || !Number.isSafeInteger(Number(id))) throw new EcommerceApiError("El e-commerce devolvió un identificador de venta inválido.", { code: "INVALID_RESPONSE" });
    const detail = await this.#get(`${this.#base}/orders/${id}`);
    if (!detail) return null;
    if (String(detail.data?.order?.id) !== String(id) || (!/^[1-9]\d*$/.test(key) && String(detail.data?.order?.order_number).toUpperCase() !== key.toUpperCase())) {
      throw new EcommerceApiError("El detalle recibido no corresponde al pedido solicitado.", { code: "INVALID_RESPONSE" });
    }
    return normalizarVentaEcommerce(detail);
  }
}

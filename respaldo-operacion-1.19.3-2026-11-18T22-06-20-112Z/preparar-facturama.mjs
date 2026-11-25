// NOVENTIA: prepara exclusivamente Facturama Sandbox / API Multiemisor.
// Solo autentica y registra el CSD PUBLICO de pruebas EKU9003173C9.
// No emite CFDI, no modifica perfiles fiscales ni usa CSD de NOVENTIA.
import fs from "node:fs/promises";
import { realpathSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { X509Certificate, createPrivateKey, createPublicKey } from "node:crypto";

export const SANDBOX_URL = "https://apisandbox.facturama.mx";
export const RFC_PRUEBA = "EKU9003173C9";
// Datos publicos de prueba publicados por Facturama. No son claves de NOVENTIA.
// Fuente: https://facturama.elevio.help/es/articles/151-csd-de-pruebas-principal
const PUBLIC_TEST_CSD = {"Rfc":"EKU9003173C9","Certificate":"MIIFsDCCA5igAwIBAgIUMzAwMDEwMDAwMDA1MDAwMDM0MTYwDQYJKoZIhvcNAQELBQAwggErMQ8wDQYDVQQDDAZBQyBVQVQxLjAsBgNVBAoMJVNFUlZJQ0lPIERFIEFETUlOSVNUUkFDSU9OIFRSSUJVVEFSSUExGjAYBgNVBAsMEVNBVC1JRVMgQXV0aG9yaXR5MSgwJgYJKoZIhvcNAQkBFhlvc2Nhci5tYXJ0aW5lekBzYXQuZ29iLm14MR0wGwYDVQQJDBQzcmEgY2VycmFkYSBkZSBjYWxpejEOMAwGA1UEEQwFMDYzNzAxCzAJBgNVBAYTAk1YMRkwFwYDVQQIDBBDSVVEQUQgREUgTUVYSUNPMREwDwYDVQQHDAhDT1lPQUNBTjERMA8GA1UELRMIMi41LjQuNDUxJTAjBgkqhkiG9w0BCQITFnJlc3BvbnNhYmxlOiBBQ0RNQS1TQVQwHhcNMjMwNTE4MTE0MzUxWhcNMjcwNTE4MTE0MzUxWjCB1zEnMCUGA1UEAxMeRVNDVUVMQSBLRU1QRVIgVVJHQVRFIFNBIERFIENWMScwJQYDVQQpEx5FU0NVRUxBIEtFTVBFUiBVUkdBVEUgU0EgREUgQ1YxJzAlBgNVBAoTHkVTQ1VFTEEgS0VNUEVSIFVSR0FURSBTQSBERSBDVjElMCMGA1UELRMcRUtVOTAwMzE3M0M5IC8gVkFEQTgwMDkyN0RKMzEeMBwGA1UEBRMVIC8gVkFEQTgwMDkyN0hTUlNSTDA1MRMwEQYDVQQLEwpTdWN1cnNhbCAxMIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8AMIIBCgKCAQEAtmecO6n2GS0zL025gbHGQVxznPDICoXzR2uUngz4DqxVUC/w9cE6FxSiXm2ap8Gcjg7wmcZfm85EBaxCx/0J2u5CqnhzIoGCdhBPuhWQnIh5TLgj/X6uNquwZkKChbNe9aeFirU/JbyN7Egia9oKH9KZUsodiM/pWAH00PCtoKJ9OBcSHMq8Rqa3KKoBcfkg1ZrgueffwRLws9yOcRWLb02sDOPzGIm/jEFicVYt2Hw1qdRE5xmTZ7AGG0UHs+unkGjpCVeJ+BEBn0JPLWVvDKHZAQMj6s5Bku35+d/MyATkpOPsGT/VTnsouxekDfikJD1f7A1ZpJbqDpkJnss3vQIDAQABox0wGzAMBgNVHRMBAf8EAjAAMAsGA1UdDwQEAwIGwDANBgkqhkiG9w0BAQsFAAOCAgEAFaUgj5PqgvJigNMgtrdXZnbPfVBbukAbW4OGnUhNrA7SRAAfv2BSGk16PI0nBOr7qF2mItmBnjgEwk+DTv8Zr7w5qp7vleC6dIsZFNJoa6ZndrE/f7KO1CYruLXr5gwEkIyGfJ9NwyIagvHHMszzyHiSZIA850fWtbqtythpAliJ2jF35M5pNS+YTkRB+T6L/c6m00ymN3q9lT1rB03YywxrLreRSFZOSrbwWfg34EJbHfbFXpCSVYdJRfiVdvHnewN0r5fUlPtR9stQHyuqewzdkyb5jTTw02D2cUfL57vlPStBj7SEi3uOWvLrsiDnnCIxRMYJ2UA2ktDKHk+zWnsDmaeleSzonv2CHW42yXYPCvWi88oE1DJNYLNkIjua7MxAnkNZbScNw01A6zbLsZ3y8G6eEYnxSTRfwjd8EP4kdiHNJftm7Z4iRU7HOVh79/lRWB+gd171s3d/mI9kte3MRy6V8MMEMCAnMboGpaooYwgAmwclI2XZCczNWXfhaWe0ZS5PmytD/GDpXzkX0oEgY9K/uYo5V77NdZbGAjmyi8cE2B2ogvyaN2XfIInrZPgEffJ4AB7kFA2mwesdLOCh0BLD9itmCve3A1FGR4+stO2ANUoiI3w3Tv2yQSg4bjeDlJ08lXaaFCLW2peEXMXjQUk7fmpb5MNuOUTW6BE=","PrivateKey":"MIIFDjBABgkqhkiG9w0BBQ0wMzAbBgkqhkiG9w0BBQwwDgQIAgEAAoIBAQACAggAMBQGCCqGSIb3DQMHBAgwggS/AgEAMASCBMh4EHl7aNSCaMDA1VlRoXCZ5UUmqErAbucoZQObOaLUEm+I+QZ7Y8Giupo+F1XWkLvAsdk/uZlJcTfKLJyJbJwsQYbSpLOCLataZ4O5MVnnmMbfG//NKJn9kSMvJQZhSwAwoGLYDm1ESGezrvZabgFJnoQv8Si1nAhVGTk9FkFBesxRzq07dmZYwFCnFSX4xt2fDHs1PMpQbeq83aL/PzLCce3kxbYSB5kQlzGtUYayiYXcu0cVRu228VwBLCD+2wTDDoCmRXtPesgrLKUR4WWWb5N2AqAU1mNDC+UEYsENAerOFXWnmwrcTAu5qyZ7GsBMTpipW4Dbou2yqQ0lpA/aB06n1kz1aL6mNqGPaJ+OqoFuc8Ugdhadd+MmjHfFzoI20SZ3b2geCsUMNCsAd6oXMsZdWm8lzjqCGWHFeol0ik/xHMQvuQkkeCsQ28PBxdnUgf7ZGer+TN+2ZLd2kvTBOk6pIVgy5yC6cZ+o1Tloql9hYGa6rT3xcMbXlW+9e5jM2MWXZliVW3ZhaPjptJFDbIfWxJPjz4QvKyJk0zok4muv13Iiwj2bCyefUTRz6psqI4cGaYm9JpscKO2RCJN8UluYGbbWmYQU+Int6LtZj/lv8p6xnVjWxYI+rBPdtkpfFYRp+MJiXjgPw5B6UGuoruv7+vHjOLHOotRo+RdjZt7NqL9dAJnl1Qb2jfW6+d7NYQSI/bAwxO0sk4taQIT6Gsu/8kfZOPC2xk9rphGqCSS/4q3Os0MMjA1bcJLyoWLp13pqhK6bmiiHw0BBXH4fbEp4xjSbpPx4tHXzbdn8oDsHKZkWh3pPC2J/nVl0k/yF1KDVowVtMDXE47k6TGVcBoqe8PDXCG9+vjRpzIidqNo5qebaUZu6riWMWzldz8x3Z/jLWXuDiM7/Yscn0Z2GIlfoeyz+GwP2eTdOw9EUedHjEQuJY32bq8LICimJ4Ht+zMJKUyhwVQyAER8byzQBwTYmYP5U0wdsyIFitphw+/IH8+v08Ia1iBLPQAeAvRfTTIFLCs8foyUrj5Zv2B/wTYIZy6ioUM+qADeXyo45uBLLqkN90Rf6kiTqDld78NxwsfyR5MxtJLVDFkmf2IMMJHTqSfhbi+7QJaC11OOUJTD0v9wo0X/oO5GvZhe0ZaGHnm9zqTopALuFEAxcaQlc4R81wjC4wrIrqWnbcl2dxiBtD73KW+wcC9ymsLf4I8BEmiN25lx/OUc1IHNyXZJYSFkEfaxCEZWKcnbiyf5sqFSSlEqZLc4lUPJFAoP6s1FHVcyO0odWqdadhRZLZC9RCzQgPlMRtji/OXy5phh7diOBZv5UYp5nb+MZ2NAB/eFXm2JLguxjvEstuvTDmZDUb6Uqv++RdhO5gvKf/AcwU38ifaHQ9uvRuDocYwVxZS2nr9rOwZ8nAh+P2o4e0tEXjxFKQGhxXYkn75H3hhfnFYjik/2qunHBBZfcdG148MaNP6DjX33M238T9Zw/GyGx00JMogr2pdP4JAErv9a5yt4YR41KGf8guSOUbOXVARw6+ybh7+meb7w4BeTlj3aZkv8tVGdfIt3lrwVnlbzhLjeQY6PplKp3/a5Kr5yM0T4wJoKQQ6v3vSNmrhpbuAtKxpMILe8CQoo=","PrivateKeyPassword":"12345678a"};
const ACCOUNT_PATHS = ["/api/Account/UserInfo", "/account/UserInfo"];
const CSD_PATH = `/api-lite/csds/${RFC_PRUEBA}`;

export class FacturamaPreparacionError extends Error {
  constructor(message, code = "FACTURAMA_ERROR") { super(message); this.name = "FacturamaPreparacionError"; this.code = code; }
}
const fail = (message, code) => new FacturamaPreparacionError(message, code);

export function validarCsdPublico(csd = PUBLIC_TEST_CSD, now = Date.now()) {
  try {
    if (csd.Rfc !== RFC_PRUEBA || csd.PrivateKeyPassword !== "12345678a") throw new Error();
    for (const key of ["Certificate", "PrivateKey"]) {
      if (typeof csd[key] !== "string" || !/^[A-Za-z0-9+/]+={0,2}$/.test(csd[key]) || csd[key].length % 4 !== 0) throw new Error();
    }
    const cert = new X509Certificate(Buffer.from(csd.Certificate, "base64"));
    if (!cert.subject.includes(RFC_PRUEBA) || Date.parse(cert.validFrom) > now || Date.parse(cert.validTo) <= now) throw new Error();
    const privateKey = createPrivateKey({ key: Buffer.from(csd.PrivateKey, "base64"), format: "der", type: "pkcs8", passphrase: csd.PrivateKeyPassword });
    const certificateKey = cert.publicKey.export({ format: "der", type: "spki" });
    if (!certificateKey.equals(createPublicKey(privateKey).export({ format: "der", type: "spki" }))) throw new Error();
    return { rfc: RFC_PRUEBA, venceEn: new Date(cert.validTo).toISOString() };
  } catch {
    throw fail("El CSD publico de pruebas del paquete no es valido o ya vencio. Descarga una version actualizada; conserva los certificados de NOVENTIA.", "CSD_PUBLICO_INVALIDO");
  }
}

function registroCsd(payload) {
  if (payload == null || (Array.isArray(payload) && payload.length === 0)) return null;
  const row = Array.isArray(payload) ? payload.find(item => item?.Rfc === RFC_PRUEBA) : payload;
  if (!row || row.Rfc !== RFC_PRUEBA) throw fail("Facturama devolvio un registro de certificados que no corresponde al RFC de pruebas.", "RESPUESTA_INVALIDA");
  return row;
}

function vigenciaCsd(row, now) {
  let expiration;
  if (row.Certificate) {
    try {
      const certificate = new X509Certificate(Buffer.from(row.Certificate, "base64"));
      if (!certificate.subject.includes(RFC_PRUEBA) || Date.parse(certificate.validFrom) > now) return null;
      expiration = Date.parse(certificate.validTo);
    } catch { return null; }
  } else expiration = Date.parse(row.CsdExpirationDate || "");
  return Number.isFinite(expiration) && expiration > now ? new Date(expiration).toISOString() : null;
}

export class FacturamaSandboxPreparacion {
  #username; #authorization; #fetch; #timeout; #now;
  constructor({ username, password, baseUrl = SANDBOX_URL, fetchImpl = globalThis.fetch, timeoutMs = 12000, now = Date.now } = {}) {
    let url;
    try { url = new URL(baseUrl); } catch { throw fail("La direccion de Facturama Sandbox no es valida.", "SOLO_SANDBOX"); }
    if (url.href !== `${SANDBOX_URL}/`) throw fail(`Esta herramienta solo permite ${SANDBOX_URL}.`, "SOLO_SANDBOX");
    if (typeof username !== "string" || !username.trim() || /[:\r\n]/.test(username) || typeof password !== "string" || !password || /^[\s]*$/.test(password) || /[\r\n]/.test(password)) {
      throw fail("Configura FACTURAMA_USERNAME y FACTURAMA_PASSWORD con el usuario y la contrasena de tu cuenta sandbox.", "FALTAN_CREDENCIALES");
    }
    if (/^(tu_usuario|tu_usuario_sandbox|usuario_sandbox)$/i.test(username.trim()) || /^tu_contrase[nñ]a(?:_sandbox)?$/i.test(password)) {
      throw fail("Reemplaza los valores de ejemplo de FACTURAMA_USERNAME y FACTURAMA_PASSWORD por los de tu cuenta sandbox.", "FALTAN_CREDENCIALES");
    }
    this.#username = username.trim(); this.#authorization = `Basic ${Buffer.from(`${this.#username}:${password}`).toString("base64")}`;
    this.#fetch = fetchImpl; this.#timeout = timeoutMs; this.#now = now;
  }

  async #request(route, method = "GET", payload) {
    const allowed = (ACCOUNT_PATHS.includes(route) && method === "GET") ||
      (route === CSD_PATH && ["GET", "PUT"].includes(method)) || (route === "/api-lite/csds" && method === "POST");
    if (!allowed) throw fail("Operacion fuera del alcance de la preparacion de sandbox.", "RUTA_NO_PERMITIDA");
    const controller = new AbortController(), timer = setTimeout(() => controller.abort(), this.#timeout);
    let response, data = null;
    try {
      response = await this.#fetch(SANDBOX_URL + route, {
        method, redirect: "error", signal: controller.signal,
        headers: { Accept: "application/json", Authorization: this.#authorization, "User-Agent": this.#username, ...(payload ? { "Content-Type": "application/json" } : {}) },
        ...(payload ? { body: JSON.stringify(payload) } : {})
      });
      if (response.redirected || (response.url && new URL(response.url).origin !== SANDBOX_URL)) throw fail("Facturama devolvio una redireccion no permitida.", "REDIRECCION_NO_PERMITIDA");
      // Discard remote error bodies: they can contain credentials, keys or HTML.
      if (response.ok && response.status !== 204) {
        const parts = []; let size = 0;
        if (response.body) for await (const chunk of response.body) {
          size += chunk.length;
          if (size > 256 * 1024) { controller.abort(); throw fail("La respuesta de Facturama supera el limite permitido.", "RESPUESTA_INVALIDA"); }
          parts.push(chunk);
        }
        const text = Buffer.concat(parts).toString("utf8");
        try { data = text ? JSON.parse(text) : null; }
        catch { throw fail("Facturama no devolvio una respuesta JSON valida.", "RESPUESTA_INVALIDA"); }
      } else if (response.body) await response.body.cancel().catch(() => {});
    } catch (error) {
      if (error instanceof FacturamaPreparacionError) throw error;
      throw fail("No fue posible conectar con Facturama Sandbox. Revisa Internet y vuelve a ejecutar el comando para comprobar el estado.", "CONEXION_FALLIDA");
    } finally { clearTimeout(timer); }
    if (response.status === 401) throw fail("Facturama rechazo los accesos. Revisa FACTURAMA_USERNAME y FACTURAMA_PASSWORD: deben pertenecer a dev.facturama.mx.", "AUTENTICACION_RECHAZADA");
    if (response.status === 403) throw fail("Facturama no permite esta operacion en la cuenta. Revisa el acceso API de tu cuenta sandbox.", "ACCESO_RECHAZADO");
    if (response.status === 429) {
      const seconds = response.headers.get("Retry-After"), suffix = /^\d{1,5}$/.test(seconds || "") ? ` Espera ${seconds} segundos.` : " Espera antes de repetir el comando.";
      throw fail("Facturama limito temporalmente las consultas." + suffix, "LIMITE_TEMPORAL");
    }
    if (response.status >= 300 && response.status < 400) throw fail("Facturama devolvio una redireccion no permitida.", "REDIRECCION_NO_PERMITIDA");
    if (response.ok || (method === "GET" && response.status === 404) || (method === "POST" && response.status === 409)) return { status: response.status, data };
    throw fail(`Facturama no pudo completar la operacion (HTTP ${response.status}). Vuelve a comprobar el estado con el mismo comando.`, "RESPUESTA_RECHAZADA");
  }

  async #account() {
    for (const route of ACCOUNT_PATHS) {
      const response = await this.#request(route);
      if (response.status === 404) continue;
      const data = response.data;
      if (!data || Array.isArray(data) || typeof data.UserName !== "string" || !data.UserName || typeof data.Rfc !== "string" || !data.Rfc) {
        throw fail("La informacion de cuenta de Facturama no tiene el formato esperado.", "RESPUESTA_INVALIDA");
      }
      return;
    }
    throw fail("Facturama no encontro la ruta de informacion de cuenta. Revisa la documentacion actual de sandbox.", "CUENTA_NO_DISPONIBLE");
  }

  async #getCsd() {
    const result = await this.#request(CSD_PATH);
    return result.status === 404 ? null : registroCsd(result.data);
  }

  async preparar({ soloVerificar = false, actualizarCsdPrueba = false, onProgress = () => {} } = {}) {
    validarCsdPublico(PUBLIC_TEST_CSD, this.#now());
    await this.#account(); onProgress("Conexion sandbox verificada.");
    const existing = await this.#getCsd(), expiration = existing && vigenciaCsd(existing, this.#now());
    if (expiration) return { ambiente: "SANDBOX", rfcPrueba: RFC_PRUEBA, csd: "YA_REGISTRADO", venceEn: expiration, listo: true };
    if (soloVerificar) return { ambiente: "SANDBOX", rfcPrueba: RFC_PRUEBA, csd: existing ? "REQUIERE_ACTUALIZACION" : "PENDIENTE", listo: false };
    if (existing && !actualizarCsdPrueba) throw fail("El CSD de pruebas existente no esta vigente o requiere revision. Para reemplazar solo el de EKU9003173C9 ejecuta de nuevo con --actualizar-csd-prueba.", "CSD_PRUEBA_REQUIERE_REVISION");
    const update = Boolean(existing), action = update ? "PUT" : "POST";
    onProgress(update ? "Actualizando exclusivamente el CSD publico de pruebas..." : "Registrando el CSD publico de pruebas...");
    await this.#request(update ? CSD_PATH : "/api-lite/csds", action, PUBLIC_TEST_CSD);
    const confirmed = await this.#getCsd(), confirmedExpiry = confirmed && vigenciaCsd(confirmed, this.#now());
    if (!confirmedExpiry) throw fail("La carga fue solicitada, pero Facturama aun no confirma un CSD de prueba vigente. Repite el comando para comprobar el estado.", "CSD_NO_CONFIRMADO");
    return { ambiente: "SANDBOX", rfcPrueba: RFC_PRUEBA, csd: update ? "ACTUALIZADO" : "REGISTRADO", venceEn: confirmedExpiry, listo: true };
  }
}

export async function leerConfiguracion(directory = process.cwd(), environment = process.env) {
  if (environment.NODE_TLS_REJECT_UNAUTHORIZED === "0") throw fail("Activa la validacion HTTPS antes de ejecutar esta herramienta: NODE_TLS_REJECT_UNAUTHORIZED no debe ser 0.", "TLS_DESACTIVADO");
  let pkg;
  try { pkg = JSON.parse(await fs.readFile(path.join(directory, "package.json"), "utf8")); } catch {}
  if (pkg?.name !== "facturacion-dinamica-v1") throw fail("Ejecuta este comando desde tu proyecto de facturacion, en la carpeta donde esta package.json.", "CARPETA_INCORRECTA");
  const keys = ["FACTURAMA_USERNAME", "FACTURAMA_PASSWORD", "FACTURAMA_API_BASE_URL"], config = {};
  for (const key of keys) if (environment[key] !== undefined) config[key] = environment[key];
  let text = "";
  try { text = await fs.readFile(path.join(directory, ".env"), "utf8"); } catch (error) { if (error.code !== "ENOENT") throw fail("No fue posible leer el archivo .env de tu proyecto.", "ENV_NO_DISPONIBLE"); }
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim(); if (!line || line.startsWith("#")) continue;
    const equal = line.indexOf("="); if (equal < 1) continue;
    const key = line.slice(0, equal).trim(); if (!keys.includes(key) || config[key] !== undefined) continue;
    let value = line.slice(equal + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) value = value.slice(1, -1);
    config[key] = value;
  }
  return { username: config.FACTURAMA_USERNAME, password: config.FACTURAMA_PASSWORD, baseUrl: config.FACTURAMA_API_BASE_URL || SANDBOX_URL };
}

export async function main(args = process.argv.slice(2), { directory = process.cwd(), environment = process.env, log = console.log, fetchImpl = globalThis.fetch } = {}) {
  if (args.includes("--help")) {
    log("Uso: node preparar-facturama.mjs [--solo-verificar] [--actualizar-csd-prueba]");
    log("Configura FACTURAMA_USERNAME y FACTURAMA_PASSWORD en el .env existente de tu proyecto.");
    log("Solo conecta a sandbox y registra EKU9003173C9; no emite facturas."); return 0;
  }
  if (args.some(arg => !["--solo-verificar", "--actualizar-csd-prueba"].includes(arg))) throw fail("Opcion desconocida. Usa node preparar-facturama.mjs --help.", "ARGUMENTO_INVALIDO");
  const config = await leerConfiguracion(directory, environment);
  const service = new FacturamaSandboxPreparacion({ ...config, fetchImpl });
  log("Preparando Facturama Sandbox / API Multiemisor...");
  const result = await service.preparar({ soloVerificar: args.includes("--solo-verificar"), actualizarCsdPrueba: args.includes("--actualizar-csd-prueba"), onProgress: log });
  if (!result.listo) { log(`Conexion correcta. El CSD de pruebas ${RFC_PRUEBA} esta pendiente o requiere revision.`); return 2; }
  log(`CSD de prueba listo para ${result.rfcPrueba}.`);
  log(`Vigencia confirmada: ${result.venceEn.slice(0, 10)}.`);
  log("Preparacion terminada. El siguiente paso es integrar el timbrado del dashboard.");
  log("No se emitieron CFDI ni se modificaron datos fiscales de NOVENTIA.");
  return 0;
}

let entry = false;
try { entry = Boolean(process.argv[1]) && realpathSync(process.argv[1]) === fileURLToPath(import.meta.url); } catch {}
if (entry) {
  try { process.exitCode = await main(); }
  catch (error) { console.error(`No se pudo preparar Facturama: ${error instanceof FacturamaPreparacionError ? error.message : "Ocurrio un error inesperado. Revisa la configuracion y vuelve a comprobar el estado."}`); process.exitCode = 1; }
}

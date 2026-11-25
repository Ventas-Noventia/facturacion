import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { FacturamaSandboxPreparacion, FacturamaPreparacionError, validarCsdPublico, leerConfiguracion, main, SANDBOX_URL, RFC_PRUEBA } from "./preparar-facturama.mjs";

const now = () => Date.parse("2026-10-29T18:00:00Z");
const credentials = { username: "sandbox-demo", password: "FAKE-password#2026" };
const valid = () => ({ Rfc: RFC_PRUEBA, CsdExpirationDate: "2027-05-18T11:43:51Z", PrivateKey: "NO_MOSTRAR", PrivateKeyPassword: "NO_MOSTRAR" });
const response = (data, status = 200, headers = {}) => new Response(status === 204 ? null : JSON.stringify(data), { status, headers: { "Content-Type": "application/json", ...headers } });
function api({ record = null, account404 = false, postConflict = false, errorStatus = 0 } = {}) {
  const state = { requests: [], record };
  state.fetch = async (url, options) => {
    const target = new URL(url); state.requests.push({ url, ...options });
    assert.equal(target.origin, SANDBOX_URL); assert.equal(target.search, ""); assert.equal(options.redirect, "error");
    assert.equal(options.headers.Authorization, `Basic ${Buffer.from(`${credentials.username}:${credentials.password}`).toString("base64")}`);
    assert.equal(options.headers["User-Agent"], credentials.username);
    if (errorStatus) return response({ message: `${credentials.password} PRIVATE_KEY_SECRETO` }, errorStatus);
    if (target.pathname === "/api/Account/UserInfo" && account404) return response({}, 404);
    if (["/api/Account/UserInfo", "/account/UserInfo"].includes(target.pathname)) return response({ UserName: credentials.username, Rfc: "AAA010101AAA", Email: "no-mostrar@example.invalid" });
    if (target.pathname === `/api-lite/csds/${RFC_PRUEBA}` && options.method === "GET") return state.record ? response(state.record) : response({}, 404);
    if (target.pathname === "/api-lite/csds" && options.method === "POST") {
      const body = JSON.parse(options.body); assert.equal(body.Rfc, RFC_PRUEBA); assert.equal(body.PrivateKeyPassword, "12345678a");
      validarCsdPublico(body, now()); state.record = valid(); return response(null, postConflict ? 409 : 204);
    }
    if (target.pathname === `/api-lite/csds/${RFC_PRUEBA}` && options.method === "PUT") { assert.equal(JSON.parse(options.body).Rfc, RFC_PRUEBA); state.record = valid(); return response(null, 204); }
    throw new Error("Ruta de prueba inesperada");
  };
  return state;
}
const service = state => new FacturamaSandboxPreparacion({ ...credentials, fetchImpl: state.fetch, now });
async function project(t, env = "") {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "noventia-facturama-")); t.after(() => fs.rm(dir, { recursive: true, force: true }));
  await fs.writeFile(path.join(dir, "package.json"), '{"name":"facturacion-dinamica-v1","version":"1.16.4"}');
  await fs.writeFile(path.join(dir, ".env"), env); return dir;
}

test("el CSD publico corresponde al RFC de pruebas, coincide con su llave y sigue vigente", () => {
  const result = validarCsdPublico(undefined, now()); assert.equal(result.rfc, RFC_PRUEBA); assert.match(result.venceEn, /^2027-05-18/);
  assert.throws(() => validarCsdPublico({ Rfc: "NOVENTIA" }, now()), error => error.code === "CSD_PUBLICO_INVALIDO");
  assert.throws(() => validarCsdPublico(undefined, Date.parse("2028-01-01")), error => error.code === "CSD_PUBLICO_INVALIDO");
});

test("credenciales vacias o de ejemplo fallan antes de cualquier consulta", () => {
  for (const values of [{}, { username: "a", password: "" }, { username: "a:b", password: "secret" }, { username: "a\r\n", password: "secret" }, { username: "tu_usuario_sandbox", password: "ejemplo" }]) assert.throws(() => new FacturamaSandboxPreparacion(values), error => error.code === "FALTAN_CREDENCIALES");
});

test("rechaza produccion, HTTP, servidores ajenos y URLs con credenciales o parametros", () => {
  for (const baseUrl of ["https://api.facturama.mx", "http://apisandbox.facturama.mx", "https://apisandbox.facturama.mx.evil.invalid", "https://user:password@apisandbox.facturama.mx", `${SANDBOX_URL}/Client`, `${SANDBOX_URL}?x=1`, `${SANDBOX_URL}#foo`]) assert.throws(() => new FacturamaSandboxPreparacion({ ...credentials, baseUrl }), error => error.code === "SOLO_SANDBOX");
});

test("autentica la cuenta de empresa y registra solo el emisor publico de pruebas", async () => {
  const state = api(), output = [], result = await service(state).preparar({ onProgress: line => output.push(line) });
  assert.equal(result.listo, true); assert.equal(result.csd, "REGISTRADO"); assert.equal(result.rfcPrueba, RFC_PRUEBA);
  assert.deepEqual(state.requests.map(r => [r.method, new URL(r.url).pathname]), [["GET", "/api/Account/UserInfo"], ["GET", `/api-lite/csds/${RFC_PRUEBA}`], ["POST", "/api-lite/csds"], ["GET", `/api-lite/csds/${RFC_PRUEBA}`]]);
  assert.ok(state.requests.every(r => !/cfdi|taxentity|profile|cancel/i.test(r.url)));
  assert.doesNotMatch(JSON.stringify(result) + output.join("\n"), /FAKE-password|NO_MOSTRAR|no-mostrar@|Certificate|PrivateKey/);
});

test("un CSD vigente no se vuelve a cargar al repetir el comando", async () => {
  const state = api({ record: valid() });
  for (let i = 0; i < 2; i++) assert.equal((await service(state).preparar()).csd, "YA_REGISTRADO");
  assert.ok(state.requests.every(r => r.method === "GET"));
});

test("si otra solicitud registro el CSD, un conflicto se confirma con GET", async () => {
  const state = api({ postConflict: true }); assert.equal((await service(state).preparar()).listo, true);
  assert.equal(state.requests.filter(r => r.method === "POST").length, 1);
});

test("la verificacion sola nunca registra ni actualiza certificados", async () => {
  for (const record of [null, { ...valid(), CsdExpirationDate: "2024-01-01" }]) {
    const state = api({ record }), result = await service(state).preparar({ soloVerificar: true, actualizarCsdPrueba: true });
    assert.equal(result.listo, false); assert.ok(state.requests.every(r => r.method === "GET"));
  }
});

test("un CSD vencido requiere la opcion explicita de actualizar y solo usa EKU", async () => {
  const state = api({ record: { ...valid(), CsdExpirationDate: "2024-01-01" } });
  await assert.rejects(service(state).preparar(), error => error.code === "CSD_PRUEBA_REQUIERE_REVISION");
  assert.ok(state.requests.every(r => r.method === "GET"));
  const result = await service(state).preparar({ actualizarCsdPrueba: true }); assert.equal(result.csd, "ACTUALIZADO");
  assert.equal(state.requests.filter(r => r.method === "PUT").length, 1);
});

test("el fallback de informacion de cuenta solo ocurre ante 404", async () => {
  const state = api({ record: valid(), account404: true }); assert.equal((await service(state).preparar()).listo, true);
  assert.deepEqual(state.requests.slice(0, 2).map(r => new URL(r.url).pathname), ["/api/Account/UserInfo", "/account/UserInfo"]);
});

test("401 y 403 se detienen sin reintentos ni contenido remoto sensible", async () => {
  for (const errorStatus of [401, 403]) {
    const state = api({ errorStatus });
    await assert.rejects(service(state).preparar(), error => { assert.ok(error instanceof FacturamaPreparacionError); assert.doesNotMatch(error.message, /FAKE-password|PRIVATE_KEY_SECRETO/); return true; });
    assert.equal(state.requests.length, 1);
  }
});

test("limite temporal y error 503 no se convierten en reintentos de escritura", async () => {
  for (const errorStatus of [429, 503]) {
    const state = api({ errorStatus }); await assert.rejects(service(state).preparar()); assert.equal(state.requests.length, 1);
  }
});

test("un error de red o cuerpo interrumpido se muestra sin secretos", async () => {
  for (const fetchImpl of [async () => { throw new Error(credentials.password); }, async () => new Response(new ReadableStream({ start(controller) { controller.error(new Error(credentials.password)); } }))]) {
    const current = new FacturamaSandboxPreparacion({ ...credentials, fetchImpl, now });
    await assert.rejects(current.preparar(), error => error.code === "CONEXION_FALLIDA" && !error.message.includes(credentials.password));
  }
});

test("el timeout aborta una peticion que no responde", async () => {
  let calls = 0;
  const current = new FacturamaSandboxPreparacion({ ...credentials, now, timeoutMs: 5, fetchImpl: async (_, options) => { calls++; return new Promise((_, reject) => options.signal.addEventListener("abort", () => reject(new Error("timeout")), { once: true })); } });
  await assert.rejects(current.preparar(), error => error.code === "CONEXION_FALLIDA"); assert.equal(calls, 1);
});

test("respuestas invalidas o redirecciones no provocan una carga de CSD", async () => {
  for (const fetchImpl of [async () => new Response("<html>no es JSON</html>"), async () => response([]), async () => response({}), async () => new Response(null, { status: 302, headers: { Location: "https://evil.invalid" } }), async () => new Response('"' + "a".repeat(260 * 1024) + '"')]) {
    let calls = 0;
    const current = new FacturamaSandboxPreparacion({ ...credentials, now, fetchImpl: async (...args) => { calls++; return fetchImpl(...args); } });
    await assert.rejects(current.preparar(), error => ["RESPUESTA_INVALIDA", "REDIRECCION_NO_PERMITIDA"].includes(error.code)); assert.equal(calls, 1);
  }
});

test("un registro de otro RFC no se acepta ni modifica", async () => {
  const state = api({ record: { ...valid(), Rfc: "AAA010101AAA" } });
  await assert.rejects(service(state).preparar(), error => error.code === "RESPUESTA_INVALIDA"); assert.ok(state.requests.every(r => r.method === "GET"));
});

test("leer .env conserva bytes y no incorpora variables de otras integraciones", async t => {
  const original = 'ECOMMERCE_API_PASSWORD="NO-MODIFICAR"\nSUPABASE_SERVICE_ROLE_KEY="NO-LEER"\nFACTURAMA_USERNAME="sandbox-demo"\nFACTURAMA_PASSWORD="clave#con$dolares=1"\n';
  const dir = await project(t, original), config = await leerConfiguracion(dir, {});
  assert.equal(config.username, "sandbox-demo"); assert.equal(config.password, "clave#con$dolares=1"); assert.equal(Object.hasOwn(config, "SUPABASE_SERVICE_ROLE_KEY"), false);
  assert.equal(await fs.readFile(path.join(dir, ".env"), "utf8"), original);
  assert.equal((await leerConfiguracion(dir, { FACTURAMA_USERNAME: "desde-entorno" })).username, "desde-entorno");
});

test("TLS desactivado o una carpeta incorrecta se rechazan antes de autenticar", async t => {
  const dir = await project(t);
  await assert.rejects(leerConfiguracion(dir, { NODE_TLS_REJECT_UNAUTHORIZED: "0" }), error => error.code === "TLS_DESACTIVADO");
  await assert.rejects(leerConfiguracion(path.join(dir, "no-existe"), {}), error => error.code === "CARPETA_INCORRECTA");
});

test("main usa el .env del proyecto y muestra un resultado util sin datos privados", async t => {
  const env = `FACTURAMA_USERNAME="${credentials.username}"\nFACTURAMA_PASSWORD="${credentials.password}"\nECOMMERCE_API_PASSWORD="NO-TOCAR"\n`;
  const dir = await project(t, env), output = [], state = api();
  const code = await main([], { directory: dir, environment: {}, log: line => output.push(line), fetchImpl: state.fetch });
  assert.equal(code, 0); assert.match(output.join("\n"), /Conexion sandbox verificada/); assert.match(output.join("\n"), /CSD de prueba listo para EKU9003173C9/);
  assert.doesNotMatch(output.join("\n"), /FAKE-password|NO_MOSTRAR|NO-TOCAR|no-mostrar@/);
  assert.equal(await fs.readFile(path.join(dir, ".env"), "utf8"), env);
});

test("el archivo se puede ejecutar directamente con Node desde una carpeta de proyecto", async t => {
  const dir = await project(t), file = path.join(dir, "preparar-facturama.mjs");
  await fs.copyFile(fileURLToPath(new URL("./preparar-facturama.mjs", import.meta.url)), file);
  let result = spawnSync(process.execPath, [file, "--help"], { cwd: dir, encoding: "utf8" });
  assert.equal(result.status, 0); assert.match(result.stdout, /Uso: node preparar-facturama/);
  const env = { ...process.env, FACTURAMA_USERNAME: "", FACTURAMA_PASSWORD: "" };
  result = spawnSync(process.execPath, [file], { cwd: dir, env, encoding: "utf8" });
  assert.equal(result.status, 1); assert.match(result.stderr, /Configura FACTURAMA_USERNAME y FACTURAMA_PASSWORD/); assert.doesNotMatch(result.stderr, /at file:|TypeError/);
});

import test from "node:test";
import assert from "node:assert/strict";
import { EcommerceApiService } from "../backend/services/ecommerceApiService.mjs";
import { ventaEjemplo, jsonResponse, testConfig, tokenResponse } from "./fixtures/ecommerce.mjs";

test("el token usa JSON; el folio busca un listado y luego el detalle por ID", async () => {
  const calls = [];
  const client = new EcommerceApiService({ ...testConfig, fetchImpl: async (value, options) => {
    const url = new URL(value); calls.push({ url, options });
    assert.equal(options.redirect, "error");
    if (url.pathname.endsWith("/auth/token")) {
      assert.equal(options.method, "POST");
      assert.deepEqual(JSON.parse(options.body), { username: "test-user", password: "test-password" });
      return tokenResponse("token-test");
    }
    assert.equal(options.method, "GET"); assert.equal(options.headers.Authorization, "Bearer token-test");
    if (url.pathname.endsWith("/orders")) {
      assert.equal(url.searchParams.get("order_number"), "ord-20261008-k7q2m");
      assert.equal(url.searchParams.has("requires_invoice"), false);
      return jsonResponse({ data: [{ id: 1842, order_number: "ORD-20261008-K7Q2M" }], links: { next: null } });
    }
    assert.equal(url.pathname, "/api/v1/invoicing/orders/1842");
    return jsonResponse(ventaEjemplo());
  } });
  const order = await client.obtenerPedido("ord-20261008-k7q2m");
  assert.equal(order.fuente, "ECOMMERCE_API"); assert.equal(order.ecommerceId, 1842); assert.equal(order.totalPedido, 1449);
  assert.equal(calls.length, 3);
  assert.equal(JSON.stringify(order).includes("token-test"), false);
  assert.equal(JSON.stringify(client).includes("test-password"), false);
});

test("las consultas simultáneas comparten un token; se renueva antes de una hora", async () => {
  let now = 1000000, tokens = 0;
  const client = new EcommerceApiService({ ...testConfig, now: () => now, fetchImpl: async value => {
    if (value.endsWith("/auth/token")) { tokens++; await Promise.resolve(); return tokenResponse(`token-${tokens}`); }
    return jsonResponse(ventaEjemplo());
  } });
  await Promise.all([client.obtenerPedido("1842"), client.obtenerPedido("1842"), client.obtenerPedido("1842")]);
  assert.equal(tokens, 1);
  now += 3569000; await client.obtenerPedido("1842"); assert.equal(tokens, 1);
  now += 1001; await client.obtenerPedido("1842"); assert.equal(tokens, 2);
});

test("un 401 al consultar renueva una vez el token", async () => {
  let tokens = 0, gets = 0;
  const client = new EcommerceApiService({ ...testConfig, fetchImpl: async (value, options) => {
    if (value.endsWith("/auth/token")) return tokenResponse(`token-${++tokens}`);
    gets++;
    return options.headers.Authorization === "Bearer token-1" ? jsonResponse({}, 401) : jsonResponse(ventaEjemplo());
  } });
  assert.equal((await client.obtenerPedido("1842")).ecommerceId, 1842);
  assert.equal(tokens, 2); assert.equal(gets, 2);
});

test("dos 401 de ventas detienen la renovación; un 401 de login no se repite", async () => {
  let tokens = 0;
  const client = new EcommerceApiService({ ...testConfig, fetchImpl: async value => value.endsWith("/auth/token") ? tokenResponse(`token-${++tokens}`) : jsonResponse({}, 401) });
  await assert.rejects(() => client.obtenerPedido("1842"), /token renovado/); assert.equal(tokens, 2);
  let calls = 0;
  const rejected = new EcommerceApiService({ ...testConfig, fetchImpl: async () => { calls++; return jsonResponse({ error: { message: "test-password" } }, 401); } });
  await assert.rejects(() => rejected.obtenerPedido("1842"), error => !error.message.includes("test-password") && /credenciales/.test(error.message));
  assert.equal(calls, 1);
});

test("HTTP rechaza credenciales antes de cualquier llamada", async () => {
  let calls = 0;
  const client = new EcommerceApiService({ ...testConfig, baseUrl: "http://api.example.com/api/v1/invoicing", fetchImpl: async () => { calls++; } });
  await assert.rejects(() => client.obtenerPedido("1842"), error => error.code === "HTTPS_REQUIRED");
  assert.equal(calls, 0);
});

test("una paginación hacia otro origen nunca recibe el Bearer", async () => {
  const urls = [];
  const client = new EcommerceApiService({ ...testConfig, fetchImpl: async value => {
    urls.push(value);
    return value.endsWith("/auth/token") ? tokenResponse("secret-token") : jsonResponse({ data: [], links: { next: "https://otro.example.com/orders?page=2" } });
  } });
  await assert.rejects(() => client.obtenerPedido("ORD-NO-EXISTE"), /dirección de consulta no permitida/);
  assert.equal(urls.length, 2); assert.ok(urls.every(url => new URL(url).origin === "https://api.example.com"));
});

test("un 404 o un listado vacío devuelve null", async () => {
  for (const response of [() => jsonResponse({}, 404), () => jsonResponse({ data: [], links: { next: null } })]) {
    const client = new EcommerceApiService({ ...testConfig, fetchImpl: async value => value.endsWith("/auth/token") ? tokenResponse("token") : response() });
    assert.equal(await client.obtenerPedido("ORD-NO-EXISTE"), null);
  }
});

test("un detalle de otra venta no se acepta", async () => {
  const other = ventaEjemplo(); other.data.order.id = 999;
  const client = new EcommerceApiService({ ...testConfig, fetchImpl: async value => value.endsWith("/auth/token") ? tokenResponse("token") : jsonResponse(other) });
  await assert.rejects(() => client.obtenerPedido("1842"), /no corresponde/);
});

test("503 usa espera creciente y un Retry-After largo no se acorta", async () => {
  let tries = 0; const delays = [];
  const client = new EcommerceApiService({ ...testConfig, sleep: async ms => { delays.push(ms); }, fetchImpl: async value => {
    if (value.endsWith("/auth/token")) return tokenResponse("token");
    return ++tries === 1 ? jsonResponse({}, 503) : jsonResponse(ventaEjemplo());
  } });
  await client.obtenerPedido("1842"); assert.deepEqual(delays, [300]); assert.equal(tries, 2);
  let calls = 0;
  const limited = new EcommerceApiService({ ...testConfig, fetchImpl: async value => {
    calls++; return value.endsWith("/auth/token") ? tokenResponse("token") : jsonResponse({}, 429, { "Retry-After": "60" });
  } });
  await assert.rejects(() => limited.obtenerPedido("1842"), error => error.retryAfter === 60);
  await assert.rejects(() => limited.obtenerPedido("1842"), error => error.code === "RATE_LIMITED");
  assert.equal(calls, 2);
});

test("403 no se reintenta ni expone el cuerpo remoto", async () => {
  let gets = 0;
  const client = new EcommerceApiService({ ...testConfig, fetchImpl: async value => {
    if (value.endsWith("/auth/token")) return tokenResponse("private-token");
    gets++; return jsonResponse({ error: { message: "private-token test-password" }, request_id: "request-test" }, 403);
  } });
  await assert.rejects(() => client.obtenerPedido("1842"), error => /permiso/.test(error.message) && !/private-token|test-password/.test(error.message) && error.requestId === "request-test");
  assert.equal(gets, 1);
});

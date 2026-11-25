import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const html=fs.readFileSync(new URL("../public/index.html",import.meta.url),"utf8");
const loginHtml=fs.readFileSync(new URL("../public/login.html",import.meta.url),"utf8");
const loginJs=fs.readFileSync(new URL("../public/login.js",import.meta.url),"utf8");
const app=fs.readFileSync(new URL("../public/app.js",import.meta.url),"utf8");
const server=fs.readFileSync(new URL("../backend/server.mjs",import.meta.url),"utf8");

test("incluye login simple y cierre de sesión",()=>{
  assert.doesNotMatch(html,/id="loginForm"/);
  assert.match(loginHtml,/id="loginForm"/);
  assert.match(loginHtml,/id="loginEmail"/);
  assert.match(loginHtml,/id="loginPassword"/);
  assert.match(html,/id="btnCerrarSesion"/);
  assert.doesNotMatch(html,/Rol de prueba/);
});

test("login y dashboard se redirigen según la sesión",()=>{
  assert.match(loginJs,/window\.location\.replace\("\/"\)/);
  assert.match(app,/window\.location\.replace\("\/login\.html"\)/);
});

test("el navegador no administra service_role ni el rol",()=>{
  assert.doesNotMatch(app,/SERVICE_ROLE/);
  assert.doesNotMatch(app,/X-User-Role/);
  assert.match(loginJs,/\/api\/auth\/login/);
});

test("el backend usa cookies HttpOnly y perfiles",()=>{
  assert.match(server,/HttpOnly; SameSite=Strict/);
  assert.match(server,/usuarios\.findById\(user\.id\)/);
  assert.match(server,/SUPABASE_PUBLISHABLE_KEY/);
});

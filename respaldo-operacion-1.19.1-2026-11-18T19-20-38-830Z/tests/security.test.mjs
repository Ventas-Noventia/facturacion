import test from "node:test";
import assert from "node:assert/strict";
import {Readable} from "node:stream";
import {applySecurityHeaders,readJsonBody,loginRateStatus,recordLoginFailure,clearLoginFailures} from "../backend/security/httpSecurity.mjs";

test("agrega encabezados de seguridad sin exponer información",()=>{
  const headers={};
  applySecurityHeaders({setHeader:(key,value)=>headers[key]=value});
  assert.equal(headers["X-Content-Type-Options"],"nosniff");
  assert.equal(headers["X-Frame-Options"],"DENY");
  assert.match(headers["Content-Security-Policy"],/frame-ancestors 'none'/);
});

test("acepta JSON válido y rechaza cuerpos mayores al límite",async()=>{
  assert.deepEqual(await readJsonBody(Readable.from([Buffer.from('{"ok":true}')])),{ok:true});
  await assert.rejects(()=>readJsonBody(Readable.from([Buffer.from("12345")]),4),error=>error.statusCode===413);
});

test("bloquea temporalmente después de cinco fallos de acceso",()=>{
  const req={socket:{remoteAddress:"127.0.0.99"},headers:{}};
  const first=loginRateStatus(req,"prueba@noventia.mx");
  for(let i=0;i<5;i++)recordLoginFailure(first.key);
  const blocked=loginRateStatus(req,"prueba@noventia.mx");
  assert.equal(blocked.allowed,false);
  assert.ok(blocked.retryAfter>0);
  clearLoginFailures(first.key);
});

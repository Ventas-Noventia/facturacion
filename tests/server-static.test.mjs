import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

test("servidor maneja favicon sin cerrar proceso",()=>{
  const src=fs.readFileSync(new URL("../backend/server.mjs",import.meta.url),"utf8");
  assert.match(src,/u\.pathname === "\/favicon\.ico"/);
  assert.match(src,/res\.writeHead\(204\)/);
});

test("serveFile maneja ENOENT como 404",()=>{
  const src=fs.readFileSync(new URL("../backend/server.mjs",import.meta.url),"utf8");
  assert.match(src,/if \(e\.code === "ENOENT"\)/);
  assert.match(src,/res\.writeHead\(404/);
});

import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

test("incluye plantilla imprimible",()=>{
  const html=fs.readFileSync(new URL("../public/index.html",import.meta.url),"utf8");
  assert.match(html,/id="facturaPrint"/);
  assert.match(html,/id="btnImprimirFactura"/);
  assert.match(html,/Representación impresa de un CFDI/);
});

test("incluye vista previa desde historial",()=>{
  const js=fs.readFileSync(new URL("../public/app.js",import.meta.url),"utf8");
  assert.match(js,/window\.verFactura/);
  assert.match(js,/Vista previa/);
  assert.match(js,/window\.print/);
});

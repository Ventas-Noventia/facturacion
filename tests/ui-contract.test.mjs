import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

test("conserva menú lateral y campos de pago",()=>{
  const html=fs.readFileSync(new URL("../public/index.html",import.meta.url),"utf8");
  assert.match(html,/class="shell"/);
  assert.match(html,/<aside>/);
  assert.match(html,/id="formaPago"/);
  assert.match(html,/id="metodoPago"/);
  assert.match(html,/id="rolActual"/);
});

test("app envía forma y método de pago",()=>{
  const js=fs.readFileSync(new URL("../public/app.js",import.meta.url),"utf8");
  assert.match(js,/formaPago/);
  assert.match(js,/metodoPago/);
  assert.match(js,/function api/);
});

test("confirma la factura y limpia el formulario después del guardado",()=>{
  const html=fs.readFileSync(new URL("../public/index.html",import.meta.url),"utf8");
  const app=fs.readFileSync(new URL("../public/app.js",import.meta.url),"utf8");
  assert.match(html,/id="exitoModal"/);
  assert.match(html,/id="exitoFolio"/);
  assert.match(app,/limpiarFormularioFactura\(\)/);
  assert.match(app,/mostrarExitoFactura\(d\)/);
  assert.match(app,/submit\.disabled=true/);
});

test("autocompleta el cliente fiscal con una llamada válida desde el módulo",()=>{
  const app=fs.readFileSync(new URL("../public/app.js",import.meta.url),"utf8");
  assert.match(app,/window\.usarCliente\(d\[0\]\)/);
  assert.match(app,/data-cliente-id/);
  assert.match(app,/openView\("nueva"\)/);
});

test("inicia sin producto y bloquea conceptos guardados",()=>{
  const app=fs.readFileSync(new URL("../public/app.js",import.meta.url),"utf8");
  assert.doesNotMatch(app,/descripcion:"Producto de prueba"/);
  assert.match(app,/Sin productos agregados/);
  assert.match(app,/c\._editing\?"Guardar":"Editar"/);
  assert.match(app,/>Eliminar<\/button>/);
  assert.match(app,/Agrega al menos un producto/);
  assert.match(app,/const c = conceptos\[i\]/);
});

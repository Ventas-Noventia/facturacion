import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
import { calcularTotales } from "../shared/domain/calculos.mjs";
import { tituloProducto, claveSatProducto } from "../shared/domain/productoFiscal.mjs";
import { leerCsvFiscal, escribirCsvFiscal, validarLoteFiscal } from "../shared/domain/catalogoFiscal.mjs";

// Execute the real frontend with a small DOM double. Only automatic boot and
// the browser's absolute module import are replaced; rendering is unchanged.
const source=fs.readFileSync(new URL("../public/app.js",import.meta.url),"utf8")
  .replace(/^import .*;$/gm, "")
  .replace(/^iniciar\(\);$/m,"");
const canceled={id:"cancelada-1",folioInterno:"NOV-FAC-000018",folioOrigen:"1842",estatus:"CANCELADA_SANDBOX",origen:"ECOMMERCE",creadaEn:"2026-10-29T19:00:00Z",total:236.8,cliente:{razonSocial:"Cliente de prueba"},timbradoSandbox:{estado:"CONFIRMADO"},cancelacionSandbox:{estado:"CONFIRMADA"},xmlRelativePath:"sandbox/comprobante.xml",pdfRelativePath:"sandbox/comprobante.pdf"};

function browser(permissions,rows=[canceled]){
  const elements=new Map(),calls=[];
  function element(key){
    if(!elements.has(key))elements.set(key,{innerHTML:"",textContent:"",value:"",hidden:false,disabled:false,style:{},dataset:{},classList:{add(){},remove(){},toggle(){},contains(){return false}},addEventListener(){},setAttribute(){},removeAttribute(){},focus(){},reset(){},scrollIntoView(){},querySelectorAll(){return[]}});
    return elements.get(key);
  }
  const context={console,calcularTotales,tituloProducto,claveSatProducto,leerCsvFiscal,escribirCsvFiscal,validarLoteFiscal,URLSearchParams,setTimeout,clearTimeout,alert(){},localStorage:{getItem(){return"2026-10-06"},setItem(){}},addEventListener(){},scrollTo(){},location:{replace(){assert.fail("El historial no debe redirigir al login")}},session:{profile:{rol:"ADMIN",nombre:"Prueba"},permissions},
    document:{getElementById:element,querySelector:element,querySelectorAll(){return[]},addEventListener(){},body:element("body")},
    async fetch(url,options={}){
      calls.push({url,options});
      if(url==="/api/session")return{ok:true,status:200,async json(){return context.session}};
      if(/^\/api\/facturas\/[^/]+$/.test(url))return{ok:true,status:200,async json(){return structuredClone(rows.find(f=>f.id===url.split("/").at(-1)))}};
      assert.ok(url.startsWith("/api/facturas?"),url);
      return{ok:true,status:200,async json(){return{items:structuredClone(rows),total:rows.length,page:1,pageSize:25}}};
    }};
  context.window=context;vm.createContext(context);vm.runInContext(source,context,{filename:"public/app.js"});
  return{context,element,calls,run:code=>vm.runInContext(code,context)};
}

test("abrir historial después de cancelar muestra la fila completa y sus documentos sin ReferenceError",async()=>{
  const b=browser(["facturas:crear","facturas:ver","facturas:cancelar"]);
  await b.run('aplicarPermisos(session); openView("historial")');
  const html=b.element("historialTabla").innerHTML;
  for(const text of ["NOV-FAC-000018","Cancelada · prueba","Volver a cargar pedido","Acuse PDF",">XML<",">PDF<"])assert.ok(html.includes(text),text);
  assert.equal(b.element("globalLoader").hidden,true);
});

test("el usuario de consulta puede ver canceladas y documentos sin habilitar una nueva solicitud",async()=>{
  const b=browser(["facturas:ver","facturas:descargar"]);
  await b.run('aplicarPermisos(session); openView("historial")');
  const html=b.element("historialTabla").innerHTML;assert.ok(html.includes("Cancelada · prueba"));assert.ok(!html.includes("Volver a cargar pedido"));
  const before=b.calls.length;await b.run('window.volverCargarPedido("cancelada-1")');assert.equal(b.calls.length,before);
});

test("actualizar los permisos de sesión retira el botón al recargar las facturas canceladas",async()=>{
  const b=browser(["facturas:crear","facturas:ver"]);
  await b.run('aplicarPermisos(session); cargarHistorial()');assert.ok(b.element("historialTabla").innerHTML.includes("Volver a cargar pedido"));
  b.context.session.permissions=["facturas:ver"];
  await b.run('refreshPermissions().then(()=>cargarHistorial())');assert.ok(!b.element("historialTabla").innerHTML.includes("Volver a cargar pedido"));
});

test("una cancelación pendiente conserva su consulta y no ofrece cargar otra solicitud",async()=>{
  const row={...canceled,estatus:"CANCELACION_SANDBOX",cancelacionSandbox:{estado:"PENDIENTE"}};
  const b=browser(["facturas:crear","facturas:cancelar"],[row]);
  await b.run('aplicarPermisos(session); timbradoConfiguracion={sandbox:true}; cargarHistorial()');
  const html=b.element("historialTabla").innerHTML;assert.ok(html.includes("Consultar cancelación"));assert.ok(!html.includes("Volver a cargar pedido"));
});

test("el historial de producción muestra acciones reales y conserva los documentos cancelados",async()=>{
  const rows=[{...canceled,id:"real",estatus:"CANCELADA",ambienteTimbrado:"PRODUCCION",timbradoSandbox:undefined,cancelacionSandbox:undefined,timbradoProduccion:{estado:"CONFIRMADO"},cancelacionProduccion:{estado:"CONFIRMADA"}},
    {...canceled,id:"pendiente",estatus:"REVISION_PRODUCCION",timbradoSandbox:undefined,cancelacionSandbox:undefined,timbradoProduccion:{estado:"POR_CONFIRMAR"}}];
  const b=browser(["facturas:crear","facturas:ver","facturas:timbrar","facturas:cancelar"],rows);
  await b.run('aplicarPermisos(session);timbradoConfiguracion={produccion:true,produccionDisponible:true,sandboxDisponible:true};cargarHistorial()');
  const html=b.element("historialTabla").innerHTML;
  for(const text of ["Cancelada · Producción","Volver a cargar pedido","Consultar resultado real","Revisar y reintentar envío real","Acuse PDF"])assert.ok(html.includes(text),text);
});

test("la vista previa real usa el emisor de la operación y descarga el PDF original en lugar de imprimir un simulador",async()=>{
  const row={...canceled,id:"real-1",estatus:"TIMBRADA",ambienteTimbrado:"PRODUCCION",timbradoSandbox:undefined,cancelacionSandbox:undefined,
    timbradoProduccion:{solicitud:{Serie:"NV",ExpeditionPlace:"53490",Issuer:{Name:"NOVENTIA SINTETICO",Rfc:"AAA010101AAA",FiscalRegime:"601"}}}};
  const b=browser(["facturas:ver","facturas:descargar"],[row]),downloads=[];
  b.context.descargar=async(id,type)=>downloads.push([id,type]);b.context.print=()=>assert.fail("Un CFDI real descarga su PDF original");
  await b.run('window.verFactura("real-1")');
  assert.match(b.element("pvEmisor").textContent,/NOVENTIA SINTETICO/);assert.equal(b.element("pvSerie").textContent,"NV");assert.equal(b.element("pvFiscal").hidden,true);
  assert.equal(b.element("btnImprimirFactura").textContent,"Descargar PDF original");await b.element("btnImprimirFactura").onclick();assert.deepEqual(downloads,[["real-1","pdf"]]);
});

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {ProductoFiscalRepository} from '../backend/repositories/productoFiscalRepository.mjs';
import {leerCsvFiscal,escribirCsvFiscal,validarLoteFiscal} from '../shared/domain/catalogoFiscal.mjs';
import {completarPedidoFiscal} from '../backend/services/catalogoFiscalService.mjs';
import {CorreoFacturaService,validarEnvio} from '../backend/services/correoFacturaService.mjs';
import {logoFactura} from '../backend/services/logoFacturaService.mjs';
import {iniciarServidorVentaPrueba,barreraPrueba} from './fixtures/ventaServidor.mjs';
const product={sku:'SKU-1',titulo:'Molinillo de café TIMEMORE',claveProdServSat:'52141529',claveUnidad:'H87',unidad:'Pieza'};
const call=(app,url,{method='GET',data,token='admin-session'}={})=>fetch(app.baseUrl+url,{method,headers:{Cookie:'facturacion_access='+token,'Content-Type':'application/json'},...(data?{body:JSON.stringify(data)}:{})});

test('CSV admite Excel, acentos y comillas; valida lote completo y rechaza duplicados',()=>{
 const rows=[{...product,titulo:'Molinillo, café "TIMEMORE"'}];assert.deepEqual(validarLoteFiscal(leerCsvFiscal(escribirCsvFiscal(rows))),rows);
 assert.equal(leerCsvFiscal('sku;titulo;claveProdServSat;claveUnidad;unidad\r\nA;Café;52141529;H87;Pieza')[0].titulo,'Café');
 assert.throws(()=>validarLoteFiscal([product,{...product,sku:' sku-1 '}]));
 assert.throws(()=>validarLoteFiscal([product,{...product,sku:'B',claveProdServSat:'abc'}]));
 assert.throws(()=>leerCsvFiscal('sku,titulo\nA,B'));
});
test('catálogo persiste tras reinicio, no pierde escrituras concurrentes y no cambia importes',async t=>{
 const dir=await fs.mkdtemp(path.join(os.tmpdir(),'catalogo-nv-'));t.after(()=>fs.rm(dir,{recursive:true,force:true}));const file=path.join(dir,'catalogo.json'),a=new ProductoFiscalRepository({file}),b=new ProductoFiscalRepository({file});
 await Promise.all([a.guardarLote([product]),b.guardarLote([{...product,sku:'SKU-2'}])]);assert.equal((await new ProductoFiscalRepository({file}).listar()).length,2);
 await assert.rejects(a.guardarLote([product,{...product,sku:'B',claveProdServSat:'X'}]));assert.equal((await a.listar()).length,2);
 const pedido={productos:[{sku:'SKU-1',descripcion:'Caracteristicas',precioUnitario:100,cantidad:2}],totalPedido:232};const enriched=await completarPedidoFiscal(pedido,a);
 assert.equal(enriched.productos[0].descripcion,product.titulo);assert.equal(enriched.productos[0].claveProdServSat,'52141529');assert.equal(enriched.productos[0].precioUnitario,100);assert.equal(enriched.totalPedido,232);
});
test('HTTP: admin guarda clasificación, consulta no escribe y pedido usa el catálogo después de reiniciar',async t=>{
 const app=await iniciarServidorVentaPrueba();t.after(()=>app.cerrar());
 assert.equal((await call(app,'/api/productos-fiscales',{method:'POST',data:{items:[product]},token:'view-session'})).status,403);
 assert.equal((await call(app,'/api/productos-fiscales',{method:'POST',data:{items:[product]}})).status,200);
 const r=await call(app,'/api/pedidos?folio=1842');assert.equal(r.status,200);const d=await r.json();assert.equal(d.productos[0].descripcion,product.titulo);assert.equal(d.productos[0].claveProdServSat,'52141529');assert.equal(d.totalPedido,1449);
 const draft=await call(app,'/api/facturas',{method:'POST',data:{folioOrigen:'1842',origen:'ECOMMERCE',formaPago:'03',metodoPago:'PUE',usoCfdi:'G03',cliente:{razonSocial:'Cliente de prueba',rfc:'XAXX010101000',codigoPostal:'53490',regimenFiscal:'616'},conceptos:d.productos}});assert.equal(draft.status,201);const saved=await draft.json();assert.equal(saved.conceptos[0].descripcion,product.titulo);assert.equal(saved.conceptos[0].claveProdServSat,'52141529');assert.equal(saved.total,1449);
 // Remove only the synthetic draft so lookup after restart is allowed.
 app.state.rows=[];
 await app.reiniciar();const again=await (await call(app,'/api/pedidos?folio=1842')).json();assert.equal(again.productos[0].descripcion,product.titulo);
 assert.equal((await call(app,'/api/preparacion',{token:'view-session'})).status,403);
 const prep=await (await call(app,'/api/preparacion')).json();assert.equal(prep.catalogo.total,1);assert.equal(prep.emisionActivada,false);
});
const factura={id:'factura-email',estatus:'TIMBRADA_SANDBOX',uuid:'11111111-1111-4111-8111-111111111111',folioInterno:'NV-1',timbradoSandbox:{facturamaId:'FAKE-ID'},cliente:{email:'prueba@example.invalid'}};
test('correo: HTTP 200 sin success no es éxito, separa ambientes, bloquea borradores y destinatarios múltiples',async()=>{
 const env={FACTURAMA_EMAIL_ENABLED:'true',FACTURAMA_USERNAME:'test',FACTURAMA_PASSWORD:'password'};const calls=[];
 const service=new CorreoFacturaService({environment:env,fetchImpl:async(u,o)=>{calls.push([u,o]);return Response.json({success:false})}});
 await assert.rejects(service.enviar(factura,'prueba@example.invalid'),/no confirmó/);
 assert.equal(new URL(calls[0][0]).origin,'https://apisandbox.facturama.mx');assert.equal(calls[0][1].redirect,'error');
 assert.throws(()=>validarEnvio({...factura,estatus:'BORRADOR'},'prueba@example.invalid'));
 assert.throws(()=>validarEnvio(factura,'a@example.com,b@example.com'));
 const ok=new CorreoFacturaService({environment:env,fetchImpl:async()=>Response.json({success:true})});assert.equal((await ok.enviar(factura,'prueba@example.invalid')).estado,'ACEPTADO_PROVEEDOR');
});
test('HTTP: envío manual conserva resultado y bitácora; bloquea doble clic y consulta; no emite CFDI',async t=>{
 const app=await iniciarServidorVentaPrueba({email:true});t.after(()=>app.cerrar());app.state.rows.push({id:factura.id,numero:1,folio_interno:'NV-1',creada_en:new Date().toISOString(),data:structuredClone(factura)});
 assert.equal((await call(app,`/api/facturas/${factura.id}/correo`,{method:'POST',token:'view-session',data:{}})).status,403);
 const gate=barreraPrueba();app.state.emailBarrier=gate;
 const first=call(app,`/api/facturas/${factura.id}/correo`,{method:'POST',data:{}});await gate.entered;
 assert.equal((await call(app,`/api/facturas/${factura.id}/correo`,{method:'POST',data:{}})).status,409);gate.release();assert.equal((await first).status,200);app.state.emailBarrier=null;
 assert.equal(app.state.rows[0].data.correoEnvio.estado,'ACEPTADO_PROVEEDOR');assert.ok(app.state.auditoria.some(r=>r.accion==='CORREO_ACEPTADO_PROVEEDOR'));
 assert.equal((await call(app,`/api/facturas/${factura.id}/correo`,{method:'POST',data:{}})).status,409);
 assert.equal(app.state.requests.filter(r=>r.pathname.endsWith('/api-lite/4/cfdis')).length,0);
});
test('logo opcional no cambia PDF por defecto y rechaza URL local o no HTTPS',()=>{
 assert.deepEqual(logoFactura({}),{});assert.deepEqual(logoFactura({FACTURAMA_LOGO_URL:'https://noventia.com.mx/logo.png'}),{LogoUrl:'https://noventia.com.mx/logo.png'});
 for(const url of ['http://example.com/logo.png','https://127.0.0.1/logo.png','https://u:p@example.com/logo.png'])assert.throws(()=>logoFactura({FACTURAMA_LOGO_URL:url}));
});

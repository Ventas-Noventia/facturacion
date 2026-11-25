import test from 'node:test';
import assert from 'node:assert/strict';
import {mensajeUsoRegimen} from '../shared/domain/validaciones.mjs';
import {solicitudProduccion} from '../backend/services/facturamaProduccionService.mjs';
import {iniciarServidorVentaPrueba} from './fixtures/ventaServidor.mjs';
test('616/G03 se identifica y no altera el régimen de un receptor',()=>{
 assert.match(mensajeUsoRegimen('616','G03'),/selecciona S01/);assert.equal(mensajeUsoRegimen('616','S01'),'');assert.equal(mensajeUsoRegimen('601','G03'),'');
});
test('borrador anterior con 616/G03 se bloquea antes de preparar el envío productivo',()=>{
 const emisor={razonSocial:'EMISOR REAL SINTETICO',rfc:'AAA010101AAA',codigoPostal:'53490',regimenFiscal:'601',serie:'NV',ambiente:'PRODUCCION',exportacion:'01',versionCfdi:'4.0'};
 assert.throws(()=>solicitudProduccion({cliente:{regimenFiscal:'616'},usoCfdi:'G03'},emisor),/616.*no admite G03/);
});
test('HTTP: guardar 616/G03 devuelve 400 antes de crear registro o emitir',async t=>{
 const app=await iniciarServidorVentaPrueba({produccion:true});t.after(()=>app.cerrar());
 const input={folioOrigen:'1842',origen:'ECOMMERCE',formaPago:'03',metodoPago:'PUE',usoCfdi:'G03',cliente:{tipoPersona:'FISICA',razonSocial:'RECEPTOR REAL',rfc:'BBB010101BB1',codigoPostal:'53490',regimenFiscal:'616'},conceptos:[{orderItemId:1,claveProdServSat:'53121601'}]};
 const r=await fetch(app.baseUrl+'/api/facturas',{method:'POST',headers:{Cookie:'facturacion_access=admin-session','Content-Type':'application/json'},body:JSON.stringify(input)});
 assert.equal(r.status,400);assert.match((await r.json()).error,/616/);assert.equal(app.state.rows.length,0);assert.equal(app.state.comprobantesProduccion.length,0);
});

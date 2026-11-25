import test from 'node:test';
import assert from 'node:assert/strict';
import {ProductoFiscalRepository} from '../backend/repositories/productoFiscalRepository.mjs';
import {diagnosticoError} from '../backend/security/diagnosticoError.mjs';
const fake=(data,status)=>new ProductoFiscalRepository({url:'https://example.invalid',serviceRoleKey:'SECRETO_NUNCA_IMPRIMIR',fetchImpl:async()=>Response.json(data,{status})});
test('tabla ausente conserva el código y propone SQL 013 sin exponer datos',async()=>{
 for(const code of ['PGRST205','42P01']){
 const repo=fake({code,message:'SECRETO PRIVADO'},404);
 await assert.rejects(repo.guardarLote([{sku:'A',titulo:'Bolsa',claveProdServSat:'53121601'}]),e=>{
 assert.equal(e.migracionPendiente,true);assert.equal(e.dbCode,code);assert.match(e.message,/013_productos_fiscales/);
 const logs=[];const diagnostic=diagnosticoError(e,'SOLICITUD',{log:(...v)=>logs.push(v)});assert.match(diagnostic.body.codigo,/SUPABASE_CATALOGO/);assert.doesNotMatch(JSON.stringify({diagnostic,logs}),/SECRETO|PRIVADO/);return true;});}
});
test('distingue permisos, columna y restricción sin devolver filas ni mensajes remotos',async()=>{
 for(const [code,status,pattern] of [['42501',403,/SERVICE_ROLE/],['PGRST204',400,/titulo/],['23514',400,/8 dígitos/],['42P10',400,/clave única/]]){
 await assert.rejects(fake({code,message:'titulo SECRETO PRIVADO'},status).listar(),e=>{assert.match(e.message,pattern);assert.doesNotMatch(e.message,/SECRETO|PRIVADO/);return true;});}
});
test('respuesta vacía de escritura es válida; JSON inválido o lectura no array se diagnostican',async()=>{
 const repo=new ProductoFiscalRepository({url:'https://example.invalid',fetchImpl:async()=>new Response(null,{status:201})});
 assert.equal((await repo.guardarLote([{sku:'A',titulo:'Bolsa',claveProdServSat:'53121601'}])).length,1);
 await assert.rejects(fake({},200).listar(),/no válida/);
 const bad=new ProductoFiscalRepository({url:'https://example.invalid',fetchImpl:async()=>new Response('<html>SECRETO</html>',{status:502})});await assert.rejects(bad.listar(),/no válida/);
 const network=new ProductoFiscalRepository({url:'https://example.invalid',fetchImpl:async()=>{throw Error('SECRETO')}});await assert.rejects(network.listar(),/conectar/);
});

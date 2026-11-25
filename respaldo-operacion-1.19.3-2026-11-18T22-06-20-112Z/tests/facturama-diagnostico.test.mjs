import test from 'node:test';
import assert from 'node:assert/strict';
import {FacturamaProduccionService} from '../backend/services/facturamaProduccionService.mjs';
import {leerRechazoFacturama,mensajeSeguroFacturama} from '../backend/services/diagnosticoFacturamaService.mjs';
const opts={username:'USUARIO_PRIVADO',password:'PASSWORD_PRIVADO',rfc:'AAA010101AAA',permitirEmision:true};
test('rechazo 400 muestra operación y campos; oculta accesos y valores del comprobante',async()=>{
 const api=new FacturamaProduccionService({...opts,fetchImpl:async()=>Response.json({Message:'CFDI40145: datos inválidos USUARIO_PRIVADO PASSWORD_PRIVADO',ModelState:{'Receiver.Name':['No corresponde CLIENTE PRIVADO BBB010101BB1'],'Items[0].ProductCode':['Clave inválida'],'CAMPO_PRIVADO':['SECRETO_INTERNO']}},{status:400})});
 await assert.rejects(api.crear({Issuer:{Rfc:opts.rfc},Receiver:{Name:'CLIENTE PRIVADO',Rfc:'BBB010101BB1'}}),e=>{
 assert.match(e.message,/CREAR_CFDI/);assert.match(e.message,/CFDI40145/);assert.match(e.message,/Receiver.Name/);assert.match(e.message,/Items\[0\].ProductCode/);assert.equal(e.rechazo,true);assert.equal(e.code,'PRODUCCION_RECHAZO_DATOS');assert.doesNotMatch(e.message,/USUARIO_PRIVADO|PASSWORD_PRIVADO|CLIENTE PRIVADO|BBB010101BB1|SECRETO_INTERNO/);return true;});
});
test('rechazo de verificación se diferencia del POST de timbrado y no hace otra petición',async()=>{
 let calls=0;const api=new FacturamaProduccionService({...opts,fetchImpl:async()=>{calls++;return Response.json({Message:'Solicitud inválida'},{status:422});}});
 await assert.rejects(api.verificarConexion(),e=>{assert.equal(e.faseFacturama,'VERIFICAR_CUENTA');assert.equal(e.httpStatus,422);return true;});assert.equal(calls,1);
});
test('HTML, respuestas excesivas y campos arbitrarios no se presentan como detalle',async()=>{
 assert.deepEqual(await leerRechazoFacturama(new Response('<html>SECRETO</html>',{status:400})),{mensaje:'',campos:[]});
 assert.deepEqual(await leerRechazoFacturama(new Response('X'.repeat(70000),{status:400})),{mensaje:'',campos:[]});
 assert.equal(mensajeSeguroFacturama('RFC BBB010101BB1 y correo prueba@example.com'), 'RFC [RFC] y correo [correo]');
});

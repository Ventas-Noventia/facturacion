import test from 'node:test';
import assert from 'node:assert/strict';
import {CorreoFacturaService,ambienteCorreo} from '../backend/services/correoFacturaService.mjs';
const f={estatus:'TIMBRADA',uuid:'11111111-1111-4111-8111-111111111111',timbradoProduccion:{facturamaId:'FAKE-ID'}};
const env={FACTURAMA_EMAIL_ENABLED:'true',FACTURAMA_PRODUCTION_USERNAME:'noventia@example.invalid',FACTURAMA_PRODUCTION_PASSWORD:'r$n:simulada'};
test('CFDI real reutiliza los accesos productivos y nunca requiere Sandbox',async()=>{
 const calls=[];const s=new CorreoFacturaService({environment:env,fetchImpl:async(u,o)=>{calls.push([u,o]);return Response.json({success:true})}});
 assert.equal((await s.enviar(f,'prueba@example.invalid')).estado,'ACEPTADO_PROVEEDOR');assert.equal(new URL(calls[0][0]).origin,'https://api.facturama.mx');assert.equal(calls[0][1].headers.Authorization,'Basic '+Buffer.from(env.FACTURAMA_PRODUCTION_USERNAME+':'+env.FACTURAMA_PRODUCTION_PASSWORD).toString('base64'));
});
test('distingue variables ausentes y formato inválido sin divulgar credenciales ni llamar al proveedor',async()=>{
 for(const [changes,pattern] of [[{FACTURAMA_PRODUCTION_USERNAME:''},/no cargó FACTURAMA_PRODUCTION_USERNAME/],[{FACTURAMA_PRODUCTION_PASSWORD:''},/no cargó FACTURAMA_PRODUCTION_PASSWORD/],[{FACTURAMA_PRODUCTION_USERNAME:'SECRETO:oculto'},/USERNAME contiene/],[{FACTURAMA_PRODUCTION_PASSWORD:'SECRETO\noculto'},/PASSWORD contiene/]]){
 let calls=0;const s=new CorreoFacturaService({environment:{...env,...changes},fetchImpl:async()=>{calls++;throw Error('No debería llamar')}});
 await assert.rejects(s.enviar(f,'prueba@example.invalid'),e=>{assert.match(e.message,pattern);assert.doesNotMatch(e.message,/SECRETO|oculto/);return true;});assert.equal(calls,0);
 }
});
test('estado real con operación Sandbox no cambia de ambiente ni sugiere cambiar contraseña',()=>{
 const mixed={...f,timbradoProduccion:null,timbradoSandbox:{facturamaId:'SANDBOX-ID'}};
 assert.throws(()=>ambienteCorreo(mixed),/dice CFDI real.*timbradoSandbox/);
 assert.throws(()=>ambienteCorreo({...f,timbradoSandbox:{facturamaId:'SANDBOX-ID'}}),/Producción y Sandbox/);
 assert.equal(ambienteCorreo({...mixed,estatus:'TIMBRADA_SANDBOX'}),'SANDBOX');
});

const UUID=/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;
export const emailValido=v=>typeof v==='string'&&v.length<=254&&/^[^\s@,;<>]+@[^\s@,;<>]+\.[^\s@,;<>]+$/.test(v);
const fallo=(message,statusCode=400)=>Object.assign(new Error(message),{statusCode});
export function validarEnvio(factura,email){
 if(!emailValido(email))throw fallo('Captura un solo correo válido.');
 if(!factura||!['TIMBRADA','TIMBRADA_SANDBOX'].includes(factura.estatus)||!UUID.test(factura.uuid||'')||factura.cancelacionProduccion||factura.cancelacionSandbox)throw fallo('Solo se envían facturas timbradas, sin cancelación en curso.',409);
 const op=factura.timbradoProduccion||factura.timbradoSandbox;
 if(!/^[a-zA-Z0-9_-]{1,100}$/.test(op?.facturamaId||''))throw fallo('La factura no tiene un identificador confirmado de Facturama.',409);
 return op.facturamaId;
}
export class CorreoFacturaService{
 constructor({environment=process.env,fetchImpl=globalThis.fetch}={}){this.env=environment;this.fetch=fetchImpl;}
 async enviar(factura,email){
 const id=validarEnvio(factura,email);
 if(this.env.FACTURAMA_EMAIL_ENABLED!=='true')throw fallo('Activa FACTURAMA_EMAIL_ENABLED=true en el servidor para habilitar el botón de envío.',503);
 const prod=Boolean(factura.timbradoProduccion);
 const username=this.env[prod?'FACTURAMA_PRODUCTION_USERNAME':'FACTURAMA_USERNAME'],password=this.env[prod?'FACTURAMA_PRODUCTION_PASSWORD':'FACTURAMA_PASSWORD'];
 if(!username||!password||/[\r\n:]/.test(username)||/[\r\n]/.test(password))throw fallo('Faltan accesos del ambiente correspondiente para enviar el correo.',503);
 const params=new URLSearchParams({CfdiType:'issuedLite',CfdiId:id,Email:email,Subject:`${prod?'':'PRUEBA SIN VALIDEZ FISCAL · '}Factura Noventia ${String(factura.folioInterno||'').slice(0,100)}`,Comments:prod?'Adjuntamos los documentos de tu factura. Gracias por comprar en Noventia.':'Factura de prueba de Noventia, sin validez fiscal.'});
 const url=new URL('/Cfdi',prod?'https://api.facturama.mx':'https://apisandbox.facturama.mx');url.search=params;
 let response;
 try{response=await this.fetch(url.href,{method:'POST',redirect:'error',signal:AbortSignal.timeout(25000),headers:{Accept:'application/json',Authorization:'Basic '+Buffer.from(username+':'+password).toString('base64')}});}catch{throw fallo('El resultado del envío no pudo confirmarse. Verifica antes de reenviar.',502);}
 if(!response.ok){await response.body?.cancel();throw fallo(`Facturama no confirmó el correo (HTTP ${response.status}).`,502);}
 let data;try{const raw=await response.text();if(raw.length>100000)throw new Error();data=JSON.parse(raw);}catch{throw fallo('Respuesta de correo no válida; el resultado queda por confirmar.',502);}
 if(data?.success!==true)throw fallo('Facturama no confirmó el envío del correo. Revisa el destinatario y consulta el servicio.',502);
 return {estado:'ACEPTADO_PROVEEDOR',destinatario:email,fecha:new Date().toISOString(),nota:'Aceptado por Facturama; no confirma recepción ni lectura.'};
 }
}

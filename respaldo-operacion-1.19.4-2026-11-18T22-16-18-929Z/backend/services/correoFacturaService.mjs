const UUID=/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;
export const emailValido=v=>typeof v==='string'&&v.length<=254&&/^[^\s@,;<>]+@[^\s@,;<>]+\.[^\s@,;<>]+$/.test(v);
const fallo=(message,statusCode=400)=>Object.assign(new Error(message),{statusCode});
export function ambienteCorreo(factura){
 const prod=Boolean(factura?.timbradoProduccion?.facturamaId),sandbox=Boolean(factura?.timbradoSandbox?.facturamaId);
 if(prod&&sandbox)throw fallo('La factura tiene identificadores de Producción y Sandbox. Revisa su registro antes de enviar; no se elegirá un ambiente automáticamente.',409);
 if(prod&&factura.estatus==='TIMBRADA')return 'PRODUCCION';
 if(sandbox&&factura.estatus==='TIMBRADA_SANDBOX')return 'SANDBOX';
 if(sandbox&&factura.estatus==='TIMBRADA')throw fallo('El registro dice CFDI real, pero su identificador pertenece a timbradoSandbox. No es un problema de contraseña: revisa el ambiente de esta factura antes de enviarla.',409);
 if(prod&&factura.estatus==='TIMBRADA_SANDBOX')throw fallo('El registro dice Sandbox, pero contiene un identificador de producción. Revisa el ambiente de esta factura.',409);
 throw fallo('La factura no tiene un identificador confirmado del ambiente correspondiente de Facturama.',409);
}
export function validarEnvio(factura,email){
 if(!emailValido(email))throw fallo('Captura un solo correo válido.');
 if(!factura||!['TIMBRADA','TIMBRADA_SANDBOX'].includes(factura.estatus)||!UUID.test(factura.uuid||'')||factura.cancelacionProduccion||factura.cancelacionSandbox)throw fallo('Solo se envían facturas timbradas, sin cancelación en curso.',409);
 const ambiente=ambienteCorreo(factura),op=ambiente==='PRODUCCION'?factura.timbradoProduccion:factura.timbradoSandbox;
 if(!/^[a-zA-Z0-9_-]{1,100}$/.test(op?.facturamaId||''))throw fallo('La factura no tiene un identificador confirmado de Facturama.',409);
 return op.facturamaId;
}
export class CorreoFacturaService{
 constructor({environment=process.env,fetchImpl=globalThis.fetch}={}){this.env=environment;this.fetch=fetchImpl;}
 preparar(factura,email){
  const id=validarEnvio(factura,email),ambiente=ambienteCorreo(factura);
  if(this.env.FACTURAMA_EMAIL_ENABLED!=='true')throw fallo('Activa FACTURAMA_EMAIL_ENABLED=true en el servidor para habilitar el botón de envío.',503);
  const prod=ambiente==='PRODUCCION',userKey=prod?'FACTURAMA_PRODUCTION_USERNAME':'FACTURAMA_USERNAME',passKey=prod?'FACTURAMA_PRODUCTION_PASSWORD':'FACTURAMA_PASSWORD';
  const username=this.env[userKey],password=this.env[passKey];
  const missing=[!String(username||'').trim()?userKey:null,!password?passKey:null].filter(Boolean);
  if(missing.length)throw fallo(`Correo de ${ambiente}: este proceso del servidor no cargó ${missing.join(' y ')}. El envío no se ha intentado.`,503);
  if(/[\r\n:]/.test(username))throw fallo(`Correo de ${ambiente}: ${userKey} contiene dos puntos o saltos de línea. Revisa el formato del valor; no lo compartas. El envío no se ha intentado.`,503);
  if(/[\r\n]/.test(password))throw fallo(`Correo de ${ambiente}: ${passKey} contiene saltos de línea. Revisa el formato del valor; no lo compartas. El envío no se ha intentado.`,503);
  return {id,prod,username,password};
 }
 async enviar(factura,email){
 const {id,prod,username,password}=this.preparar(factura,email);
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

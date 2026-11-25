export function faseFacturama(endpoint,method){
 if(endpoint==='/SuscriptionPlan')return 'VERIFICAR_CUENTA';
 if(endpoint.startsWith('/api-lite/csds/'))return 'VERIFICAR_CSD';
 if(endpoint==='/api-lite/4/cfdis'&&method==='POST')return 'CREAR_CFDI';
 if(method==='DELETE')return 'CANCELAR_CFDI';
 return 'CONSULTAR_FACTURAMA';
}
const parts=new Set(['model','cfdi','cfdiToCreate','NameId','LogoUrl','Date','Serie','Folio','Currency','CfdiType','PaymentForm','PaymentMethod','ExpeditionPlace','Exportation','Issuer','Receiver','Name','Rfc','FiscalRegime','TaxZipCode','CfdiUse','Items','ProductCode','IdentificationNumber','Description','Unit','UnitCode','UnitPrice','Quantity','Subtotal','Discount','TaxObject','Taxes','Total','Base','Rate','IsRetention']);
function campoSeguro(key){if(typeof key!=='string'||key.length>160)return '';const keys=key.replace(/\[\d{1,4}\]/g,'').split('.');return keys.length&&keys.every(k=>parts.has(k))?key:'';}
export function mensajeSeguroFacturama(value,secrets=[]){
 if(typeof value!=='string')return '';
 let s=value.slice(0,4000);
 for(const secret of secrets.filter(v=>typeof v==='string'&&v.length>=3).sort((a,b)=>b.length-a.length))s=s.split(secret).join('[dato]');
 return s.replace(/(?:Basic|Bearer)\s+\S+/gi,'[acceso]')
 .replace(/[A-ZÑ&]{3,4}\d{6}[A-Z0-9]{3}/gi,'[RFC]')
 .replace(/[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}/gi,'[UUID]')
 .replace(/[^\s@]+@[^\s@]+\.[^\s@]+/g,'[correo]')
 .replace(/[A-Za-z0-9+/=_-]{80,}/g,'[contenido]')
 .replace(/"[^"\r\n]*"|'[^'\r\n]*'/g,'[valor]')
 .replace(/[\x00-\x1f<>]/g,' ').replace(/\s+/g,' ').trim().slice(0,700);
}
export async function leerRechazoFacturama(response,secrets=[]){
 const reader=response.body?.getReader();if(!reader)return {mensaje:'',campos:[]};let size=0;const chunks=[];
 try{while(true){const {done,value}=await reader.read();if(done)break;size+=value.byteLength;if(size>65536){await reader.cancel();return {mensaje:'',campos:[]};}chunks.push(Buffer.from(value));}
 const data=JSON.parse(Buffer.concat(chunks).toString('utf8'));
 const campos=[];const errors=[];
 if(data?.ModelState&&typeof data.ModelState==='object')for(const [key,values]of Object.entries(data.ModelState).slice(0,20)){
  const field=campoSeguro(key);if(!field)continue;campos.push(field);
  const items=Array.isArray(values)?values:[values];for(const v of items.slice(0,2)){const message=mensajeSeguroFacturama(v,secrets);if(message)errors.push(field+': '+message);}
 }
 const mensaje=[mensajeSeguroFacturama(data?.Message||data?.message,secrets),...errors].filter(Boolean).join(' · ').slice(0,1600);
 return {mensaje,campos};
 }catch{return {mensaje:'',campos:[]};}
}
export function datosPrivadosSolicitud(payload){
 const secrets=[];
 function scan(v,key=''){if(Array.isArray(v)){v.forEach(x=>scan(x,key));return;}if(v&&typeof v==='object'){for(const [k,x]of Object.entries(v))scan(x,k);return;}if(typeof v==='string'&&['Name','Rfc','TaxZipCode','Description','IdentificationNumber','Email','Certificate','PrivateKey','PrivateKeyPassword'].includes(key)&&v.length>=4)secrets.push(v);}
 scan(payload);return secrets;
}

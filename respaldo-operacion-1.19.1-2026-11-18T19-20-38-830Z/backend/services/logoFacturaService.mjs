// LogoUrl is supported by the Multiemisor API; optional, PDF-only.
export function logoFactura(environment=process.env){
 const value=String(environment.FACTURAMA_LOGO_URL||'').trim();if(!value)return {};
 let u;try{u=new URL(value)}catch{throw Object.assign(new Error('FACTURAMA_LOGO_URL debe ser una URL HTTPS pública PNG o JPG.'),{statusCode:400})}
 if(u.protocol!=='https:'||u.username||u.password||u.hash||u.search||! /\.(png|jpg|jpeg)$/i.test(u.pathname)||!u.hostname.includes('.')||/^(localhost|127\.|10\.|192\.168\.|169\.254\.|172\.(1[6-9]|2\d|3[01])\.)/i.test(u.hostname)||u.hostname.startsWith('[')||value.length>2048)throw Object.assign(new Error('Usa una URL HTTPS pública de logo PNG o JPG, sin parámetros ni credenciales.'),{statusCode:400});
 return {LogoUrl:value};
}

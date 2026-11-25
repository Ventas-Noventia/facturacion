const PDF = require('./node_modules/pdfkit/js/pdfkit.standalone.js');
const {XMLParser}=require('fast-xml-parser');
const QR=require('qrcode');
const {NumerosALetras}=require('numero-a-letras');
const logo=require('./logo-impresion.png');
const lista=x=>x==null?[]:Array.isArray(x)?x:[x];
const dinero=v=>Number(v).toLocaleString('es-MX',{style:'currency',currency:'MXN'});
const forma={'01':'Efectivo','02':'Cheque nominativo','03':'Transferencia electrónica','04':'Tarjeta de crédito','28':'Tarjeta de débito','99':'Por definir'};
const metodo={PUE:'Pago en una sola exhibición',PPD:'Pago en parcialidades o diferido'};
function codigo(c,d){return d[c]?c+' · '+d[c]:c;}
async function disenar(xml,original,referencia,uuidEsperado){
  if(/<!DOCTYPE/i.test(xml.toString()))return original;
  const c=new XMLParser({ignoreAttributes:false,attributeNamePrefix:'',removeNSPrefix:true,parseAttributeValue:false,processEntities:true}).parse(xml.toString()).Comprobante;
  const t=c?.Complemento?.TimbreFiscalDigital;
  if(uuidEsperado && String(t?.UUID).toLowerCase()!==String(uuidEsperado).toLowerCase())return original;
  if(c?.Version!=='4.0'||c.Moneda!=='MXN'||c.TipoDeComprobante!=='I'||!t?.SelloSAT||!t.SelloCFD||!c.Sello||!t.UUID||!t.NoCertificadoSAT||!t.FechaTimbrado||!t.RfcProvCertif)return original;
  if(Object.keys(c.Complemento).some(k=>k!=='TimbreFiscalDigital')||c.CfdiRelacionados||c.InformacionGlobal||c.Emisor.FacAtrAdquirente||c.Receptor.ResidenciaFiscal)return original;
  const items=lista(c.Conceptos?.Concepto);
  if(!items.length||items.some(i=>i.ComplementoConcepto||i.CuentaPredial||i.InformacionAduanera||i.Parte||i.ACuentaTerceros))return original;
  const url=new URL('https://verificacfdi.facturaelectronica.sat.gob.mx/default.aspx');
  for(const [k,v] of Object.entries({id:t.UUID,re:c.Emisor.Rfc,rr:c.Receptor.Rfc,tt:c.Total,fe:c.Sello.slice(-8)}))url.searchParams.set(k,v);
  const qr=await QR.toBuffer(url.href,{width:480,margin:4,errorCorrectionLevel:'M'});
  const doc=new PDF({size:'LETTER',margin:0,bufferPages:true,info:{Title:'Factura '+t.UUID,Author:'Noventia'}});
  const chunks=[];const result=new Promise((resolve,reject)=>{doc.on('data',v=>chunks.push(v));doc.on('end',()=>resolve(Buffer.concat(chunks)));doc.on('error',reject);});
  const ink='#123b49',teal='#087b82',muted='#4c636b',light='#edf7f6',left=36,right=576,w=540;
  let y=36;
  function estilo(size,bold=false,color=ink){doc.font(bold?'Helvetica-Bold':'Helvetica').fontSize(size).fillColor(color);}
  function txt(s,x,top,width,size=9,bold=false,color=ink,align='left'){
    estilo(size,bold,color);doc.text(String(s??''),x,top,{width,align,lineGap:1});return doc.y;
  }
  function alto(s,width,size=9,bold=false){estilo(size,bold);return doc.heightOfString(String(s??''),{width,lineGap:1});}
  function regla(){doc.moveTo(left,y).lineTo(right,y).strokeColor('#d7e4e4').lineWidth(.6).stroke();}
  function espacio(n){if(y+n>744){doc.addPage();txt('NOVENTIA   /   FACTURA',left,25,350,9,true,teal);y=46;return true;}return false;}
  function bloque(etiqueta,s){const lines=String(s).match(/.{1,138}/gs)||[];espacio(Math.min(680,18+lines.reduce((h,l)=>h+alto(l,w,7),0)));y=txt(etiqueta,left,y,w,8,true,teal)+3;
    for(const line of lines){const h=alto(line,w,7);espacio(h+2);y=txt(line,left,y,w,7);}y+=4;}
  doc.image(Buffer.from(logo),left,y,{fit:[160,47]});txt('FACTURA',340,y,236,24,true,ink,'right');
  txt([c.Serie,c.Folio].filter(Boolean).join(' · '),300,y+30,276,9,false,muted,'right');y=88;
  const parts=[[c.Emisor,'EMISOR','Expedición '+c.LugarExpedicion], [c.Receptor,'RECEPTOR','C.P. '+c.Receptor.DomicilioFiscalReceptor+'   ·   Uso CFDI '+c.Receptor.UsoCFDI]];
  const cardHeight=Math.max(...parts.map(([p])=>alto(p.Nombre,239,12,true)))+65;
  for(const [i,[p,heading,last]] of parts.entries()){
    const x=left+i*275;doc.roundedRect(x,y,265,cardHeight,5).fill(light);txt(heading,x+12,y+10,239,8,true,teal);
    let top=txt(p.Nombre,x+12,y+25,239,12,true)+4;
    txt([p.Rfc,'Régimen fiscal '+(p.RegimenFiscal||p.RegimenFiscalReceptor),last].join('\n'),x+12,top,239,8);
  }
  y+=cardHeight+9;
  y=txt('Folio fiscal   '+t.UUID,left,y,w,9,true)+3;
  y=txt('Emisión   '+c.Fecha+'     ·     Certificado del emisor   '+c.NoCertificado,left,y,w,8,false,muted)+3;
  y=txt('Tipo de comprobante   I · Ingreso     ·     Exportación   '+c.Exportacion,left,y,w,8,false,muted)+12;
  function cabecera(){doc.rect(left,y,w,22).fill(light);
    for(const [label,x,width,align] of [['Concepto',left+7,270,'left'],['Cantidad',310,55,'right'],['Precio unitario',369,100,'right'],['Importe',473,96,'right']])txt(label,x,y+6,width,9,true,ink,align);
    y+=25;}
  cabecera();
  for(const i of items){
    const ancho=260, det=[i.ClaveProdServ+' · '+i.ClaveUnidad+(i.Unidad?' · '+i.Unidad:''),i.NoIdentificacion?'Identificación: '+i.NoIdentificacion:'','Objeto de impuesto: '+i.ObjetoImp,i.Descuento?'Descuento: '+dinero(i.Descuento):''];
    for(const [grupo,signo] of [[i.Impuestos?.Traslados?.Traslado,'Traslado'],[i.Impuestos?.Retenciones?.Retencion,'Retención']])for(const tax of lista(grupo))det.push([signo,tax.Impuesto,'Base '+tax.Base,tax.TipoFactor,tax.TasaOCuota,tax.Importe].filter(Boolean).join(' · '));
    const detail=det.filter(Boolean).join('\n');
    const h=alto(i.Descripcion,ancho,10,true)+alto(detail,ancho,8)+18;
    if(h>670)return original;
    if(espacio(h))cabecera();
    txt(i.Cantidad,310,y,55,9,false,ink,'right');txt(dinero(i.ValorUnitario),369,y,100,9,false,ink,'right');txt(dinero(i.Importe),473,y,96,9,true,ink,'right');
    y=txt(i.Descripcion,left+7,y,ancho,10,true)+3;y=txt(detail,left+7,y,ancho,8,false,muted)+6;regla();y+=5;
  }
  const totales=[['Subtotal',c.SubTotal],['Descuento',c.Descuento],...lista(c.Impuestos?.Traslados?.Traslado).map(t=>[(t.Impuesto==='002'?'IVA':'Impuesto '+t.Impuesto)+' '+(t.TipoFactor==='Tasa'?Number((Number(t.TasaOCuota)*100).toFixed(4))+'%':t.TipoFactor),t.Importe]),...lista(c.Impuestos?.Retenciones?.Retencion).map(t=>['Retención '+t.Impuesto,t.Importe])].filter(r=>r[1]!=null);
  espacio(90+16*totales.length);y+=6;const begin=y;
  for(const [k,v] of totales){txt(k,365,y,105,9);txt(dinero(v),465,y,105,9,false,ink,'right');y+=16;}
  doc.roundedRect(355,y-2,221,27,4).fill(light);txt('Total MXN',365,y+5,90,11,true);txt(dinero(c.Total),445,y+4,125,13,true,teal,'right');
  const palabras=txt(NumerosALetras(Number(c.Total)).toUpperCase(),left,begin,290,9,true);y=Math.max(y+34,palabras+8);
  y=txt('Forma de pago   '+codigo(c.FormaPago,forma)+'     ·     Método   '+codigo(c.MetodoPago,metodo),left,y,w,9)+5;
  if(referencia)y=txt('Referencia interna   '+referencia,left,y,w,8,false,muted)+4;
  y+=10;espacio(102);regla();y+=6;doc.image(qr,left,y,{width:78});
  txt('CERTIFICACIÓN',133,y+10,430,9,true,teal);
  txt('Fecha y hora: '+t.FechaTimbrado+'\nCertificado SAT: '+t.NoCertificadoSAT+'\nRFC del PAC: '+t.RfcProvCertif,133,y+28,430,9);y+=83;
  bloque('Cadena original del complemento de certificación digital del SAT','||'+[t.Version,t.UUID,t.FechaTimbrado,t.RfcProvCertif,t.Leyenda,t.SelloCFD,t.NoCertificadoSAT].filter(v=>v!=null&&v!=='').join('|')+'||');
  bloque('Sello digital del CFDI',t.SelloCFD);bloque('Sello digital del SAT',t.SelloSAT);
  const pages=doc.bufferedPageRange().count;for(let n=0;n<pages;n++){doc.switchToPage(n);txt('Este documento es una representación impresa de un CFDI.',left,761,435,8,false,muted);txt((n+1)+' / '+pages,490,761,86,8,false,muted,'right');}
  doc.file(original,{name:'Factura-original.pdf',type:'application/pdf'});doc.end();return result;
}
module.exports={disenar};

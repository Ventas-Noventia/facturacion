import { readFileSync } from "node:fs";
import { inflateSync, deflateSync } from "node:zlib";

const WIDTH = 612, HEIGHT = 792, LEFT = 40, RIGHT = 572;
const COLORS = { navy: "0f4c81", teal: "00b8c4", orange: "ff6b4a", ink: "203145", muted: "637386", pale: "f3f6f9", border: "dce4ec", white: "ffffff" };
const FONT_WIDTHS = {"regular":[556,556,556,556,556,556,556,556,556,556,556,556,556,556,556,556,556,556,556,556,556,556,556,556,556,556,556,556,556,556,556,556,278,278,355,556,556,889,667,191,333,333,389,584,278,333,278,278,556,556,556,556,556,556,556,556,556,556,278,278,584,584,584,556,1015,667,667,722,722,667,611,778,722,278,500,667,556,833,722,778,667,778,722,667,611,722,667,944,667,667,611,278,278,278,469,556,333,556,556,500,556,556,278,556,556,222,222,500,222,833,556,556,556,556,333,500,278,556,500,722,500,500,500,334,260,334,584,350,556,350,222,556,333,1000,556,556,333,1000,667,333,1000,350,611,350,350,222,222,333,333,350,556,1000,333,1000,500,333,944,350,500,667,278,333,556,556,556,556,260,556,333,737,370,556,584,333,737,333,400,584,333,333,333,556,537,278,333,333,365,556,834,834,834,611,667,667,667,667,667,667,1000,722,667,667,667,667,278,278,278,278,722,722,778,778,778,778,778,584,778,722,722,722,722,667,667,611,556,556,556,556,556,556,889,500,556,556,556,556,278,278,278,278,556,556,556,556,556,556,556,584,611,556,556,556,556,500,556,500],"bold":[556,556,556,556,556,556,556,556,556,556,556,556,556,556,556,556,556,556,556,556,556,556,556,556,556,556,556,556,556,556,556,556,278,333,474,556,556,889,722,238,333,333,389,584,278,333,278,278,556,556,556,556,556,556,556,556,556,556,333,333,584,584,584,611,975,722,722,722,722,667,611,778,722,278,556,722,611,833,722,778,667,778,722,667,611,722,667,944,667,667,611,333,278,333,584,556,333,556,611,556,611,556,333,611,611,278,278,556,278,889,611,611,611,611,389,556,333,611,556,778,556,556,500,389,280,389,584,350,556,350,278,556,500,1000,556,556,333,1000,667,333,1000,350,611,350,350,278,278,500,500,350,556,1000,333,1000,556,333,944,350,500,667,278,333,556,556,556,556,280,556,333,737,370,556,584,333,737,333,400,584,333,333,333,611,556,278,333,333,365,556,834,834,834,611,722,722,722,722,722,722,1000,722,667,667,667,667,278,278,278,278,722,722,778,778,778,778,778,584,778,722,722,722,722,667,667,611,556,556,556,556,556,556,889,556,556,556,556,556,278,278,278,278,611,611,611,611,611,611,611,584,611,611,611,611,611,556,611,556]};
const euro = new Map([[0x20ac,128],[0x2018,39],[0x2019,39],[0x201c,34],[0x201d,34],[0x2013,45],[0x2014,45],[0x2026,46],[0xa0,32]]);
const currency = new Intl.NumberFormat("es-MX", { style: "currency", currency: "MXN", minimumFractionDigits: 2 });
const money = value => currency.format(Number(value || 0));
const clean = value => [...String(value ?? "")].map(char => {
  const code = char.codePointAt(0);
  if (euro.has(code)) return String.fromCharCode(euro.get(code));
  if (char === "\n") return char;
  return code >= 32 && code <= 255 ? char : code < 32 ? " " : "?";
}).join("");
const literal = value => clean(value).replaceAll("\\", "\\\\").replaceAll("(", "\\(").replaceAll(")", "\\)");
const rgb = hex => [0,2,4].map(i => (parseInt(hex.slice(i,i+2),16)/255).toFixed(4)).join(" ");
const measure = (value,size=9,bold=false) => [...clean(value)].reduce((n,c)=>n+(FONT_WIDTHS[bold?"bold":"regular"][c.charCodeAt(0)]||556),0)*size/1000;

function wrap(value, width, size=9, bold=false) {
  const result=[];
  for (const paragraph of clean(value).split("\n")) {
    let line="";
    for (const word of paragraph.trim().split(/\s+/)) {
      if (!word) continue;
      if (measure(line?`${line} ${word}`:word,size,bold)<=width) { line=line?`${line} ${word}`:word; continue; }
      if (line) { result.push(line);line=""; }
      let part="";
      for (const char of word) {
        if (part && measure(part+char,size,bold)>width) {result.push(part);part="";}
        part+=char;
      }
      line=part;
    }
    result.push(line);
  }
  return result.length?result:[""];
}

class Pdf {
  constructor() {this.objects=[null,null];this.pages=[];this.font=this.add("<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>");this.bold=this.add("<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>");}
  add(value) {this.objects.push(Buffer.isBuffer(value)?value:Buffer.from(value,"latin1"));return this.objects.length;}
  stream(bytes,properties="") {return Buffer.concat([Buffer.from(`<< ${properties} /Length ${bytes.length} >>\nstream\n`,"ascii"),bytes,Buffer.from("\nendstream","ascii")]);}
  image(image) {
    if (!image) return null;
    const mask=image.alpha?this.add(this.stream(deflateSync(image.alpha),`/Type /XObject /Subtype /Image /Width ${image.width} /Height ${image.height} /ColorSpace /DeviceGray /BitsPerComponent 8 /Filter /FlateDecode`)):null;
    return this.add(this.stream(deflateSync(image.rgb),`/Type /XObject /Subtype /Image /Width ${image.width} /Height ${image.height} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /FlateDecode ${mask?`/SMask ${mask} 0 R`:""}`));
  }
  finish(pages,imageId) {
    for (const page of pages) {
      const content=this.add(this.stream(Buffer.from(page.commands.join("\n"),"latin1")));
      this.pages.push(this.add(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${WIDTH} ${HEIGHT}] /Resources << /Font << /F1 ${this.font} 0 R /F2 ${this.bold} 0 R >> ${imageId?`/XObject << /Logo ${imageId} 0 R >>`:""} >> /Contents ${content} 0 R >>`));
    }
    this.objects[0]=Buffer.from("<< /Type /Catalog /Pages 2 0 R >>");
    this.objects[1]=Buffer.from(`<< /Type /Pages /Count ${this.pages.length} /Kids [${this.pages.map(id=>`${id} 0 R`).join(" ")}] >>`);
    const chunks=[Buffer.from("%PDF-1.4\n%\xe2\xe3\xcf\xd3\n","latin1")],offsets=[0];let length=chunks[0].length;
    this.objects.forEach((object,index)=>{const chunk=Buffer.concat([Buffer.from(`${index+1} 0 obj\n`),object,Buffer.from("\nendobj\n")]);offsets.push(length);chunks.push(chunk);length+=chunk.length;});
    const xref=`xref\n0 ${offsets.length}\n0000000000 65535 f \n${offsets.slice(1).map(offset=>`${String(offset).padStart(10,"0")} 00000 n \n`).join("")}trailer\n<< /Size ${offsets.length} /Root 1 0 R >>\nstartxref\n${length}\n%%EOF\n`;
    chunks.push(Buffer.from(xref));return Buffer.concat(chunks);
  }
}

let cachedLogo;
function logo() {
  if (cachedLogo!==undefined) return cachedLogo;
  try {
    const png=readFileSync(new URL("../../public/img/logo2.png",import.meta.url));
    if (!png.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10]))) throw new Error("PNG");
    let width,height,channels;const blocks=[];
    for(let p=8;p+12<=png.length;){const len=png.readUInt32BE(p),type=png.toString("ascii",p+4,p+8),data=png.subarray(p+8,p+8+len);if(p+12+len>png.length)throw new Error("PNG");
      if(type==="IHDR"){width=data.readUInt32BE(0);height=data.readUInt32BE(4);channels=data[9]===6?4:data[9]===2?3:0;if(data[8]!==8||data[12]!==0||!channels||width*height>16000000)throw new Error("PNG");}
      if(type==="IDAT")blocks.push(data);p+=len+12;if(type==="IEND")break;
    }
    if(!width||!height||!channels)throw new Error("PNG");
    const stride=width*channels,raw=inflateSync(Buffer.concat(blocks),{maxOutputLength:(stride+1)*height});
    if(raw.length!==(stride+1)*height)throw new Error("PNG");
    const pixels=Buffer.alloc(stride*height);
    const paeth=(a,b,c)=>{const p=a+b-c,pa=Math.abs(p-a),pb=Math.abs(p-b),pc=Math.abs(p-c);return pa<=pb&&pa<=pc?a:pb<=pc?b:c;};
    for(let y=0;y<height;y++){const filter=raw[y*(stride+1)];if(filter>4)throw new Error("PNG");
      for(let x=0;x<stride;x++){const a=x>=channels?pixels[y*stride+x-channels]:0,b=y?pixels[(y-1)*stride+x]:0,c=y&&x>=channels?pixels[(y-1)*stride+x-channels]:0;
        const prediction=filter===0?0:filter===1?a:filter===2?b:filter===3?Math.floor((a+b)/2):paeth(a,b,c);
        pixels[y*stride+x]=(raw[y*(stride+1)+x+1]+prediction)&255;}
    }
    // Embed at print resolution. Alpha is retained in a separate PDF mask.
    const outWidth=Math.min(width,800),outHeight=Math.max(1,Math.round(height*outWidth/width));
    const colors=Buffer.alloc(outWidth*outHeight*3),alpha=channels===4?Buffer.alloc(outWidth*outHeight):null;
    for(let y=0;y<outHeight;y++)for(let x=0;x<outWidth;x++){const src=(Math.floor(y*height/outHeight)*width+Math.floor(x*width/outWidth))*channels,dst=y*outWidth+x;
      colors[dst*3]=pixels[src];colors[dst*3+1]=pixels[src+1];colors[dst*3+2]=pixels[src+2];if(alpha)alpha[dst]=pixels[src+3];}
    cachedLogo={width:outWidth,height:outHeight,rgb:colors,alpha};
  }catch{cachedLogo=null;}
  return cachedLogo;
}

class Page {
  constructor(){this.commands=[];}
  text(value,x,top,size=9,bold=false,color=COLORS.ink){this.commands.push(`${rgb(color)} rg`,"BT",`/${bold?"F2":"F1"} ${size} Tf`,`${x.toFixed(2)} ${(HEIGHT-top-size).toFixed(2)} Td`,`(${literal(value)}) Tj`,"ET");}
  right(value,right,top,size=9,bold=false,color=COLORS.ink,maxWidth=150){while(size>6&&measure(value,size,bold)>maxWidth)size-=.25;this.text(value,right-measure(value,size,bold),top,size,bold,color);}
  rect(x,top,w,h,fill=COLORS.pale){this.commands.push(`${rgb(fill)} rg`,`${x} ${HEIGHT-top-h} ${w} ${h} re f`);}
  line(x1,top1,x2,top2,color=COLORS.border,width=.5){this.commands.push(`${rgb(color)} RG`,`${width} w`,`${x1} ${HEIGHT-top1} m`,`${x2} ${HEIGHT-top2} l S`);}
  paragraph(value,x,top,width,size=9,bold=false,color=COLORS.ink,lineHeight=size+3){const lines=wrap(value,width,size,bold);for(let i=0;i<lines.length;i++)this.text(lines[i],x,top+i*lineHeight,size,bold,color);return top+lines.length*lineHeight;}
  logo(image,x,top,w,h){if(!image)return;const scale=Math.max(w/image.width,h/image.height),iw=image.width*scale,ih=image.height*scale;this.commands.push("q",`${x} ${HEIGHT-top-h} ${w} ${h} re W n`,`${iw.toFixed(2)} 0 0 ${ih.toFixed(2)} ${(x+(w-iw)/2).toFixed(2)} ${(HEIGHT-top-h+(h-ih)/2).toFixed(2)} cm`,"/Logo Do","Q");}
}

function date(value){if(!value)return "Pendiente";const d=new Date(value);return Number.isNaN(d.getTime())?"Pendiente":d.toLocaleString("es-MX",{timeZone:"America/Mexico_City",day:"2-digit",month:"2-digit",year:"numeric",hour:"2-digit",minute:"2-digit",hour12:false});}
const PAYMENT={"01":"Efectivo","02":"Cheque nominativo","03":"Transferencia","04":"Tarjeta de crédito","28":"Tarjeta de débito","99":"Por definir"};

export function crearPdfFactura({factura={},emisor={},uuid="",fechaTimbrado=""}={}) {
  const doc=new Pdf(),image=logo(),imageId=doc.image(image),pages=[];
  const folio=factura.folioInterno||(factura.numero?`${emisor.serie||"F"}-${factura.numero}`:"BORRADOR");
  const header=(compact=false)=>{
    const page=new Page();pages.push(page);page.rect(0,0,WIDTH,5,COLORS.navy);
    if(image)page.logo(image,LEFT,19,180,69);else page.text(emisor.nombreComercial||"NOVENTIA",LEFT,34,24,true,COLORS.navy);
    page.right("FACTURA",RIGHT,23,22,true,COLORS.navy);page.right(folio,RIGHT,52,11,true);
    page.right("DOCUMENTO DE PRUEBA",RIGHT,71,7.5,true,COLORS.orange);
    if(compact){page.line(LEFT,102,RIGHT,102);return{page,y:119};}
    let issuer=page.paragraph(emisor.razonSocial||"EMISOR DE PRUEBA",LEFT,108,318,10.5,true);
    issuer=page.paragraph(`RFC: ${emisor.rfc||"Pendiente"}   |   Régimen: ${emisor.regimenFiscal||"Pendiente"}`,LEFT,issuer+6,320,8,false,COLORS.muted);
    issuer=page.paragraph(`Lugar de expedición: ${emisor.codigoPostal||"Pendiente"}`,LEFT,issuer+3,320,8,false,COLORS.muted);
    const contact=[emisor.correo,emisor.telefono,emisor.sitioWeb].filter(Boolean).join("  |  ");
    if(contact)issuer=page.paragraph(contact,LEFT,issuer+4,320,7.5,false,COLORS.muted);
    page.text("FECHA DE EMISIÓN",389,111,6.7,true,COLORS.muted);page.text(date(fechaTimbrado||factura.creadaEn),389,124,8);
    page.text("FORMA / MÉTODO DE PAGO",389,145,6.7,true,COLORS.muted);
    page.paragraph(`${factura.formaPago||"-"} ${PAYMENT[factura.formaPago]||""} / ${factura.metodoPago||"-"}`,389,158,183,8);
    page.text(`Moneda: ${factura.moneda||"MXN"}`,389,183,8,false,COLORS.muted);
    const top=Math.max(208,issuer+18),client=factura.cliente||{};
    const clientLines=wrap(client.razonSocial||"Receptor pendiente",300,10,true);
    const emailLines=wrap(client.email||"",300,8);
    const clientHeight=Math.max(105,52+clientLines.length*13+emailLines.length*11);
    page.rect(LEFT,top,RIGHT-LEFT,clientHeight);page.rect(LEFT,top,3,clientHeight,COLORS.teal);
    page.text("RECEPTOR",LEFT+13,top+12,7,true,COLORS.navy);
    let pos=page.paragraph(client.razonSocial||"Receptor pendiente",LEFT+13,top+29,300,10,true);
    page.text(`RFC: ${client.rfc||"Pendiente"}`,LEFT+13,pos+5,8);pos+=18;
    if(client.email)page.paragraph(client.email,LEFT+13,pos+2,300,8,false,COLORS.muted);
    page.text(`CP fiscal: ${client.codigoPostal||"Pendiente"}`,389,top+30,8);
    page.text(`Régimen fiscal: ${client.regimenFiscal||"Pendiente"}`,389,top+48,8);
    page.text(`Uso CFDI: ${factura.usoCfdi||"Pendiente"}`,389,top+66,8);
    return{page,y:top+clientHeight+18};
  };
  const table=(page,y)=>{page.rect(LEFT,y,RIGHT-LEFT,23,COLORS.navy);page.text("CANT.",LEFT+7,y+7,7,true,COLORS.white);page.text("DESCRIPCIÓN",90,y+7,7,true,COLORS.white);page.text("UNIDAD",326,y+7,7,true,COLORS.white);page.right("P. UNITARIO",478,y+7,7,true,COLORS.white);page.right("IMPORTE",RIGHT-8,y+7,7,true,COLORS.white);return y+23;};
  let state=header(),page=state.page,y=table(page,state.y);
  const concepts=Array.isArray(factura.conceptos)?factura.conceptos:[];
  for(let index=0;index<concepts.length;index++) {
    const item=concepts[index],desc=wrap(item.descripcion||"Producto",224,8.5),sku=wrap(item.sku||item.clave||"Sin SKU",224,6.8);
    const content=[...desc.map(value=>({value,size:8.5,height:11,muted:false})),...sku.map(value=>({value,size:6.8,height:9,muted:true}))];
    let offset=0;
    while(offset<content.length){
      if(y+40>686){state=header(true);page=state.page;y=table(page,state.y);}
      let height=14,count=0;
      while(offset+count<content.length&&y+height+content[offset+count].height<=686){height+=content[offset+count].height;count++;}
      if(!count){state=header(true);page=state.page;y=table(page,state.y);continue;}
      const part=content.slice(offset,offset+count),rowHeight=Math.max(40,height);
      if(index%2===1)page.rect(LEFT,y,RIGHT-LEFT,rowHeight,"fafbfd");
      let pos=y+8;for(const line of part){page.text(line.value,90,pos,line.size,false,line.muted?COLORS.muted:COLORS.ink);pos+=line.height;}
      if(offset===0){page.right(String(Number(item.cantidad||0)),80,y+9,8,false,COLORS.ink,32);page.text(item.claveUnidad||"H87",326,y+9,7.5,false,COLORS.muted);page.right(money(item.precioUnitario),478,y+9,8,false,COLORS.ink,85);page.right(money(item.calculo?.subtotal??Number(item.cantidad||0)*Number(item.precioUnitario||0)),RIGHT-8,y+9,8,true,COLORS.ink,85);}
      page.line(LEFT,y+rowHeight,RIGHT,y+rowHeight);y+=rowHeight;offset+=part.length;
      if(offset<content.length){state=header(true);page=state.page;y=table(page,state.y);}
    }
  }
  if(!concepts.length){page.text("Sin conceptos",LEFT+8,y+14,9,false,COLORS.muted);y+=44;}
  if(y+170>710){state=header(true);page=state.page;y=state.y;page.text("RESUMEN DE LA FACTURA",LEFT,y,10,true,COLORS.navy);y+=29;}
  const summary=y+20;
  page.text("INFORMACIÓN DEL DOCUMENTO",LEFT,summary+2,7,true,COLORS.navy);
  let note=summary+20;
  if(Number(factura.pedido?.descuentoPedido)>0){page.text(`Cupón de la compra: ${money(factura.pedido.descuentoPedido)}`,LEFT,note,8,true);note+=14;page.text("Ya reflejado en los precios de los productos.",LEFT,note,7.5,false,COLORS.muted);note+=22;}
  page.text("Timbre fiscal: pendiente",LEFT,note,8);note+=16;
  page.text("QR fiscal disponible después del timbrado real.",LEFT,note,7.5,false,COLORS.muted);note+=17;
  if(uuid)page.paragraph(`Identificador de prueba: ${uuid}`,LEFT,note,300,7,false,COLORS.muted);
  page.line(374,summary-3,RIGHT,summary-3,COLORS.navy,1);
  page.text("Subtotal",384,summary+12,9);page.right(money(factura.subtotal),RIGHT-8,summary+12,9,false,COLORS.ink,106);
  page.text("IVA",384,summary+34,9);page.right(money(factura.impuestos),RIGHT-8,summary+34,9,false,COLORS.ink,106);
  page.rect(374,summary+58,198,34,COLORS.navy);page.text("TOTAL",384,summary+69,10,true,COLORS.white);page.right(money(factura.total),RIGHT-8,summary+67,13,true,COLORS.white,125);
  for(let i=0;i<pages.length;i++){
    const p=pages[i];p.line(LEFT,733,RIGHT,733);p.text("DOCUMENTO DE PRUEBA - SIN VALOR FISCAL",LEFT,745,7.5,true,COLORS.orange);
    p.right(`Página ${i+1} de ${pages.length}`,RIGHT,745,7.5,false,COLORS.muted);
    p.text("No es un CFDI timbrado. Su emisión fiscal requiere un PAC autorizado.",LEFT,761,7,false,COLORS.muted);
  }
  return doc.finish(pages,imageId);
}

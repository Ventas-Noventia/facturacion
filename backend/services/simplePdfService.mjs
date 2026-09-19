function ascii(value){
  return String(value??"").normalize("NFD").replace(/[\u0300-\u036f]/g,"").replace(/[^\x20-\x7E]/g,"?");
}

function pdfText(value){
  return ascii(value).replace(/\\/g,"\\\\").replace(/\(/g,"\\(").replace(/\)/g,"\\)");
}

export function crearPdfSimulado(lineas=[]){
  const commands=["BT","/F1 12 Tf","60 760 Td","18 TL"];
  for(const line of lineas)commands.push(`(${pdfText(line)}) Tj`,`T*`);
  commands.push("ET");
  const stream=commands.join("\n");
  const objects=[
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>",
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
    `<< /Length ${Buffer.byteLength(stream,"ascii")} >>\nstream\n${stream}\nendstream`
  ];
  let pdf="%PDF-1.4\n%1234\n";
  const offsets=[0];
  objects.forEach((object,index)=>{
    offsets.push(Buffer.byteLength(pdf,"ascii"));
    pdf+=`${index+1} 0 obj\n${object}\nendobj\n`;
  });
  const xref=Buffer.byteLength(pdf,"ascii");
  pdf+=`xref\n0 ${objects.length+1}\n0000000000 65535 f \n`;
  for(const offset of offsets.slice(1))pdf+=`${String(offset).padStart(10,"0")} 00000 n \n`;
  pdf+=`trailer\n<< /Size ${objects.length+1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(pdf,"ascii");
}

const money=value=>`$${Number(value||0).toFixed(2)} MXN`;
const clip=(value,length)=>ascii(value||"").slice(0,length);

export function crearPdfFactura({factura={},emisor={},uuid="",fechaTimbrado=""}={}){
  const commands=[];
  const text=(value,x,y,size=9,bold=false,white=false)=>commands.push(white?"1 g":"0 g","BT",`/${bold?"F2":"F1"} ${size} Tf`,`${x} ${y} Td`,`(${pdfText(value)}) Tj`,"ET","0 g");
  const line=(x1,y1,x2,y2,width=.6)=>commands.push(`${width} w`,`${x1} ${y1} m`,`${x2} ${y2} l S`);
  const box=(x,y,w,h,gray=.95)=>commands.push(`${gray} g`,`${x} ${y} ${w} ${h} re f`,`0 g`);

  box(38,735,536,35,.12);
  text(emisor.nombreComercial||"NOVENTIA",52,751,17,true,true);
  text("COMPROBANTE DE PRUEBA - SIN VALOR FISCAL",303,752,8,true,true);
  text(`Folio: ${factura.folioInterno||factura.folioOrigen||"-"}`,402,740,8,false,true);

  text(emisor.razonSocial||"EMISOR DE PRUEBA",42,716,11,true);
  text(`RFC: ${emisor.rfc||"-"}   Regimen: ${emisor.regimenFiscal||"-"}`,42,703,8);
  text(`Lugar de expedicion: ${emisor.codigoPostal||"-"}`,42,691,8);
  const contacto=[emisor.correo,emisor.telefono,emisor.sitioWeb].filter(Boolean).join("  |  ");
  if(contacto)text(clip(contacto,92),42,679,7);

  box(38,622,536,42,.94);
  text("RECEPTOR",46,650,9,true);
  text(clip(factura.cliente?.razonSocial||"-",58),46,637,9,true);
  text(`RFC: ${factura.cliente?.rfc||"-"}   CP: ${factura.cliente?.codigoPostal||"-"}`,330,649,8);
  text(`Regimen: ${factura.cliente?.regimenFiscal||"-"}   Uso CFDI: ${factura.usoCfdi||"-"}`,330,635,8);

  text(`Fecha: ${fechaTimbrado?new Date(fechaTimbrado).toLocaleString("es-MX",{timeZone:"America/Mexico_City"}):"-"}`,42,606,8);
  text(`Forma de pago: ${factura.formaPago||"-"}`,260,606,8);
  text(`Metodo: ${factura.metodoPago||"-"}`,442,606,8);

  box(38,579,536,20,.18);
  text("Clave / Descripcion",45,586,8,true,true);text("Cant.",355,586,8,true,true);text("P. unitario",405,586,8,true,true);text("Importe",512,586,8,true,true);
  let y=564;
  for(const concepto of (factura.conceptos||[]).slice(0,18)){
    const cantidad=Number(concepto.cantidad||0);
    const unitario=Number(concepto.precioUnitario||0);
    const importe=Number(concepto.calculo?.subtotal??cantidad*unitario);
    text(clip(`${concepto.sku||concepto.clave||"S/C"} - ${concepto.descripcion||"Producto"}`,55),45,y,8);
    text(String(cantidad),360,y,8);text(money(unitario),405,y,8);text(money(importe),505,y,8);
    line(42,y-7,570,y-7,.25);y-=22;
  }
  if((factura.conceptos||[]).length>18)text(`+ ${(factura.conceptos||[]).length-18} concepto(s) adicionales en el XML`,45,y,8,true);

  const totalsY=Math.max(y-90,145);
  line(365,totalsY+61,570,totalsY+61,.8);
  text("Subtotal",405,totalsY+45,9);text(money(factura.subtotal),500,totalsY+45,9);
  text("IVA",405,totalsY+28,9);text(money(factura.impuestos),500,totalsY+28,9);
  box(395,totalsY-1,175,21,.15);text("TOTAL",405,totalsY+6,10,true,true);text(money(factura.total),488,totalsY+6,10,true,true);

  text(`UUID de prueba: ${uuid||"PENDIENTE"}`,42,92,8,true);
  text(`Pedido de origen: ${factura.folioOrigen||"-"}   Moneda: ${factura.moneda||"MXN"}`,42,78,8);
  line(38,65,574,65,.6);
  text("Este documento fue generado en ambiente de pruebas. No es un CFDI y no tiene validez ante el SAT.",68,47,8,true);

  const stream=commands.join("\n");
  const objects=[
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 4 0 R /F2 5 0 R >> >> /Contents 6 0 R >>",
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold >>",
    `<< /Length ${Buffer.byteLength(stream,"ascii")} >>\nstream\n${stream}\nendstream`
  ];
  let pdf="%PDF-1.4\n%1234\n";const offsets=[0];
  objects.forEach((object,index)=>{offsets.push(Buffer.byteLength(pdf,"ascii"));pdf+=`${index+1} 0 obj\n${object}\nendobj\n`});
  const xref=Buffer.byteLength(pdf,"ascii");
  pdf+=`xref\n0 ${objects.length+1}\n0000000000 65535 f \n`;
  for(const offset of offsets.slice(1))pdf+=`${String(offset).padStart(10,"0")} 00000 n \n`;
  pdf+=`trailer\n<< /Size ${objects.length+1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(pdf,"ascii");
}

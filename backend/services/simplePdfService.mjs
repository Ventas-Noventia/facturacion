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

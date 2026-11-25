export const normalizarSku = v => String(v ?? "").trim().toUpperCase();
export function validarProductoFiscal(input = {}) {
  const sku=normalizarSku(input.sku), titulo=String(input.titulo || "").trim(), claveProdServSat=String(input.claveProdServSat || "").trim();
  const claveUnidad=String(input.claveUnidad || "H87").trim(), unidad=String(input.unidad || "Pieza").trim();
  if(!sku || sku.length>100 || /[\x00-\x1f]/.test(sku)) throw new Error("SKU obligatorio, de hasta 100 caracteres.");
  if(!titulo || titulo.length>1000) throw new Error("Título obligatorio, de hasta 1000 caracteres.");
  if(!/^\d{8}$/.test(claveProdServSat)) throw new Error("La clave SAT debe tener 8 dígitos.");
  if(!/^[A-Za-z0-9]{2,3}$/.test(claveUnidad) || !unidad || unidad.length>100) throw new Error("Revisa la unidad SAT y su descripción.");
  return {sku,titulo,claveProdServSat,claveUnidad,unidad};
}
export function validarLoteFiscal(rows) {
  if(!Array.isArray(rows) || !rows.length || rows.length>500) throw new Error("Importa de 1 a 500 productos por lote.");
  const found=new Set();return rows.map((r,i)=>{let item;try{item=validarProductoFiscal(r)}catch(e){throw new Error(`Fila ${i+2}: ${e.message}`)}if(found.has(item.sku))throw new Error(`SKU repetido en el archivo: ${item.sku}`);found.add(item.sku);return item;});
}
// Excel-compatible CSV: comma or semicolon, quoted cells, UTF-8 BOM, CRLF.
export function leerCsvFiscal(text) {
  text=String(text).replace(/^\uFEFF/, "");
  const head=text.split(/\r?\n/)[0]||"", sep=head.includes(';')?';':',';
  const rows=[];let row=[],cell='',quote=false;
  for(let i=0;i<text.length;i++){const c=text[i];if(c==='"'){if(quote&&text[i+1]==='"'){cell+='"';i++;}else if(!quote&&cell!=='')throw new Error("Comillas inválidas en CSV.");else quote=!quote;}
    else if(c===sep&&!quote){row.push(cell);cell='';}
    else if((c==='\n'||c==='\r')&&!quote){if(c==='\r'&&text[i+1]==='\n')i++;row.push(cell);if(row.some(v=>v.trim()))rows.push(row);row=[];cell='';}else cell+=c;}
  if(quote)throw new Error("Faltan comillas de cierre en CSV.");row.push(cell);if(row.some(v=>v.trim()))rows.push(row);
  const headers=(rows.shift()||[]).map(v=>v.trim());
  const required=['sku','titulo','claveProdServSat','claveUnidad','unidad'];
  if(required.some(k=>!headers.includes(k)))throw new Error("Usa la plantilla CSV con columnas sku, titulo, claveProdServSat, claveUnidad y unidad.");
  return rows.map(r=>Object.fromEntries(headers.map((h,i)=>[h,r[i]||''])));
}
export function escribirCsvFiscal(rows) {
 const keys=['sku','titulo','claveProdServSat','claveUnidad','unidad'];
 const cell=v=>'"'+String(v??'').replace(/^[=+@-]/,"'$&").replaceAll('"','""')+'"';
 return '\uFEFF'+[keys.join(','),...rows.map(r=>keys.map(k=>cell(r[k])).join(','))].join('\r\n');
}

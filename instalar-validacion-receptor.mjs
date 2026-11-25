import fs from 'node:fs/promises';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
const catalogo = "import {regimenesTicket} from './regimenes-ticket.mjs';\n\nconst gastos = new Set(['601','603','606','612','620','621','622','623','624','625','626']);\nconst deducciones = new Set(['605','606','607','608','611','612','614','615','625']);\n\nexport function usoCompatible(regimen, uso) {\n  if (!regimenesTicket.some(([clave]) => clave === regimen)) return false;\n  if (uso === 'S01') return true;\n  if (/^(G0[1-3]|I0[1-8])$/.test(uso)) return gastos.has(regimen);\n  return /^D(0[1-9]|10)$/.test(uso) && deducciones.has(regimen);\n}\n\nexport function revisarReceptor(cliente, uso) {\n  const {tipoPersona, regimenFiscal, rfc} = cliente || {};\n  const clave = String(rfc || '').trim().toUpperCase();\n  const tipo = tipoPersona || (clave.length === 12 ? 'MORAL' : 'FISICA');\n  if (!['FISICA','MORAL'].includes(tipo) ||\n      !(tipo === 'FISICA' ? /^[A-ZÑ&]{4}\\d{6}[A-Z0-9]{3}$/ : /^[A-ZÑ&]{3}\\d{6}[A-Z0-9]{3}$/).test(clave))\n    return 'Revisa el RFC y el tipo de persona del receptor.';\n  if (!regimenesTicket.some(([codigo,,tipos]) => codigo === regimenFiscal && tipos.includes(tipo)))\n    return 'Selecciona el régimen de la constancia que corresponda al tipo de persona del receptor.';\n  if (!uso) return 'Selecciona el uso de CFDI que indicó el receptor.';\n  if (!usoCompatible(regimenFiscal, uso)) return 'El régimen '+regimenFiscal+' no admite '+uso+'. Revisa el uso de CFDI con el receptor.';\n  return '';\n}\n\nexport function filtrarUsos(regimen, select) {\n  const anterior = select.value;\n  if (!Array.from(select.options).some(op => op.value === '')) select.add(new Option('Selecciona el uso de CFDI',''),0);\n  for (const opcion of select.options) {\n    const excluir = Boolean(opcion.value && !usoCompatible(regimen,opcion.value));\n    opcion.disabled = excluir;\n    opcion.hidden = excluir;\n  }\n  select.required = true;\n  select.value = usoCompatible(regimen,anterior) ? anterior : '';\n}\n";
const server='backend/server.mjs', app='public/app.js', portal='public/autofactura.js', index='public/index.html', ticket='public/autofactura.html', reglas='public/compatibilidad-receptor.mjs';
const archivos=new Map();
for(const nombre of [server,app,portal,index,ticket]) archivos.set(nombre,await fs.readFile(nombre,'utf8'));
const marca='// Validación receptor Noventia v1';
if(archivos.get(server).includes(marca)){console.log('Validación fiscal ya instalada.');process.exit(0);}
await fs.access('public/regimenes-ticket.mjs');
function cambiar(nombre,ancla,nuevo){
  const s=archivos.get(nombre);
  if(s.split(ancla).length!==2)throw Error('La versión de '+nombre+' difiere de la esperada. No se modificó el proyecto.');
  archivos.set(nombre,s.replace(ancla,()=>nuevo));
}
function delimitar(nombre,inicio,fin,nuevo){
  const s=archivos.get(nombre),a=s.indexOf(inicio),b=s.indexOf(fin,a);
  if(a<0||b<=a)throw Error('No se encontró la sección esperada en '+nombre);
  cambiar(nombre,s.slice(a,b),nuevo+'\n\n');
}
archivos.set(reglas,catalogo);
archivos.set(server,marca+'\nimport { revisarReceptor } from "../public/compatibilidad-receptor.mjs";\n'+archivos.get(server));
const validar=(cliente,uso)=>'const problemaFiscal=revisarReceptor('+cliente+','+uso+'); if(problemaFiscal)throw new DatosFacturaError(problemaFiscal);';
cambiar(server,'const persona=perfil.tipoPersona;',validar('perfil','perfil.usoCfdi')+'\n      const persona=perfil.tipoPersona;');
const antigua='if(timbradoConfig.produccion){const incompatibilidad=mensajeUsoRegimen(input.cliente?.regimenFiscal,input.usoCfdi);if(incompatibilidad)throw new DatosFacturaError(incompatibilidad);}';
if(archivos.get(server).split(antigua).length!==3)throw Error('Versión incompatible en alta o edición de facturas.');
archivos.set(server,archivos.get(server).replaceAll(antigua,validar('input.cliente','input.usoCfdi')));
cambiar(server,'async function emitirFactura(req,factura) {','async function emitirFactura(req,factura) {\n  '+validar('factura.cliente','factura.usoCfdi'));
cambiar(server,'const required = ["tipoPersona","razonSocial","rfc","codigoPostal","regimenFiscal","usoCfdi"];',validar('i','i.usoCfdi')+'\n      const required = ["tipoPersona","razonSocial","rfc","codigoPostal","regimenFiscal","usoCfdi"];');
const imp='import {filtrarUsos, revisarReceptor} from "./compatibilidad-receptor.mjs";\n';
archivos.set(portal,imp+archivos.get(portal));
cambiar(portal,'}\ntipos();$("tipo").onchange=tipos;', '  filtrarUsos($("regimen").value,$("uso"));\n}\n$("regimen").onchange=()=>filtrarUsos($("regimen").value,$("uso"));\ntipos();$("tipo").onchange=tipos;');
cambiar(portal,'  ocupado=true;$("emitir").disabled=true;', '  const problema=revisarReceptor(datos.receptor,datos.receptor.usoCfdi);\n  if(problema){$("estadoFactura").textContent=problema;return;}\n  ocupado=true;$("emitir").disabled=true;');
archivos.set(app,imp+archivos.get(app));
delimitar(app,'function opcionesRegimen(select,tipo,preferido){','function sincronizarUsoFiscal(){',`function opcionesRegimen(select,tipo,preferido){
  const permitidos=REGIMENES_FISCALES.filter(([, ,tipos])=>tipos.includes(tipo));
  select.replaceChildren(new Option('Selecciona el régimen de la constancia',''),...permitidos.map(([clave,nombre])=>new Option(clave+' - '+nombre,clave)));
  select.required=true;
  select.value=permitidos.some(([clave])=>clave===preferido)?preferido:'';
}`);
delimitar(app,'function sincronizarUsoFiscal(){','let loaderDepth=',`function sincronizarUsoFiscal(){
  for (const [reg,uso,ayuda] of [['regimen','uso','usoRegimenAviso'],['cfRegimen','cfUso','cfUsoAviso']]) {
    filtrarUsos($(reg).value,$(uso));
    const aviso=$(ayuda);
    if(aviso){aviso.hidden=Boolean($(uso).value);aviso.textContent='Confirma con el receptor el uso de CFDI para este régimen.';}
  }
}`);
cambiar(app,'  const formaPago = $("formaPago").value;',`  const problema = revisarReceptor({tipoPersona:$("tipoPersona").value,rfc:$("rfc").value,regimenFiscal:$("regimen").value},$("uso").value);
  if(problema){$("mensaje").textContent=problema;submit.disabled=false;submit.textContent=borradorEditandoId?"Guardar cambios":"Guardar factura";return;}
  const formaPago = $("formaPago").value;`);
cambiar(app,'    e.target.reset();\n    await cargarClientes();','    e.target.reset();\n    opcionesRegimen($("cfRegimen"),$("cfTipoPersona").value);sincronizarUsoFiscal();\n    await cargarClientes();');
cambiar(app,'    const r=await api("/api/clientes-fiscales",{method:"POST"', '    const problema=revisarReceptor(p,p.usoCfdi);if(problema)throw Error(problema);\n    const r=await api("/api/clientes-fiscales",{method:"POST"');
for(const [nombre,src] of [[index,'app.js'],[ticket,'/autofactura.js']]){
  const previo=archivos.get(nombre).match(new RegExp('src="'+src.replace('.','\\.')+'(?:\\?[^"]*)?"'));
  if(!previo)throw Error('Falta el script en '+nombre);
  cambiar(nombre,previo[0],'src="'+src+'?v=receptor-v1"');
}
for(const id of ['uso','cfUso']){
  cambiar(index,'<select id="'+id+'">','<select required id="'+id+'"><option value="">Selecciona el uso de CFDI</option><option value="G01">G01 - Adquisición de mercancías</option>');
}
const backup=await fs.mkdtemp('respaldo-validacion-receptor-');
const temps=[],aplicados=[];
try{
  for(const [nombre,contenido] of archivos){
    const copia=path.join(backup,nombre);await fs.mkdir(path.dirname(copia),{recursive:true});
    try{await fs.copyFile(nombre,copia);}catch(e){if(e.code!=='ENOENT')throw e;}
    const tmp=nombre+'.nuevo-'+process.pid+path.extname(nombre);
    await fs.writeFile(tmp,contenido,{flag:'wx'});temps.push([nombre,tmp]);
    if(/\.m?js$/.test(nombre)&&spawnSync(process.execPath,['--check',tmp],{stdio:'inherit'}).status!==0)throw Error('Revisa '+nombre);
  }
  for(const [nombre,tmp] of temps){await fs.rename(tmp,nombre);aplicados.push(nombre);}
}catch(e){
  for(const nombre of aplicados.reverse()){try{await fs.copyFile(path.join(backup,nombre),nombre);}catch(err){if(err.code==='ENOENT')await fs.rm(nombre,{force:true});else throw err;}}
  throw e;
}finally{for(const [,tmp] of temps)await fs.rm(tmp,{force:true});}
console.log('Validación fiscal instalada. Respaldo: '+backup);

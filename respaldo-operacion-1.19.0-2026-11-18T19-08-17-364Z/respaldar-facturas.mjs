import fs from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';
import {loadEnv} from './backend/config/loadEnv.mjs';
import {LocalFacturaRepository} from './backend/repositories/localFacturaRepository.mjs';
import {ProductoFiscalRepository} from './backend/repositories/productoFiscalRepository.mjs';
import {SupabaseDocumentStorageService} from './backend/services/supabaseDocumentStorageService.mjs';
loadEnv();
const root=path.dirname(fileURLToPath(import.meta.url));
const out=path.resolve(process.argv[2]||path.join(root,'respaldos-operacion','respaldo-'+new Date().toISOString().replace(/[:.]/g,'-')));
await fs.mkdir(out,{recursive:false,mode:0o700}).catch(async e=>{if(e.code!=='ENOENT')throw e;await fs.mkdir(path.dirname(out),{recursive:true});await fs.mkdir(out,{mode:0o700});});
const env=process.env,url=env.SUPABASE_URL,key=env.SUPABASE_SERVICE_ROLE_KEY;
const remote=Boolean(url&&key),entries=[],errores=[];
async function save(name,bytes){const target=path.join(out,name);await fs.mkdir(path.dirname(target),{recursive:true});await fs.writeFile(target,bytes,{mode:0o600});entries.push({archivo:name,bytes:bytes.length,sha256:createHash('sha256').update(bytes).digest('hex')});}
let facturas;
if(remote){
 const rows=[];for(let offset=0;;offset+=500){const r=await fetch(url.replace(/\/$/,'')+'/rest/v1/facturas?select=*&order=id&limit=500&offset='+offset,{headers:{apikey:key,Authorization:'Bearer '+key},signal:AbortSignal.timeout(20000)});if(!r.ok)throw new Error('No fue posible exportar facturas de Supabase.');const page=await r.json();rows.push(...page);if(page.length<500)break;}
 await save('facturas-supabase.json',Buffer.from(JSON.stringify(rows,null,2)));facturas=rows.map(r=>({...r.data,id:r.id}));
}else{facturas=await new LocalFacturaRepository().list();await save('facturas-local.json',Buffer.from(JSON.stringify(facturas,null,2)));}
try{const catalogo=await new ProductoFiscalRepository({url:remote?url:'',serviceRoleKey:key}).listar();await save('productos-fiscales.json',Buffer.from(JSON.stringify(catalogo,null,2)));}catch{errores.push('No fue posible exportar catálogo fiscal.');}
const storage=remote?new SupabaseDocumentStorageService({url,serviceRoleKey:key,bucket:env.SUPABASE_DOCUMENT_BUCKET||'documentos-fiscales'}):null;
for(const f of facturas){
 const id=String(f.id||'').replace(/[^a-zA-Z0-9_-]/g,'_');
 for(const tipo of ['xml','pdf']){
  const storagePath=f[tipo+'StoragePath'],relative=f[tipo+'RelativePath'];
  if(!storagePath&&!relative){if(String(f.estatus||'').startsWith('TIMBRADA'))errores.push(`${id}: falta referencia ${tipo}`);continue;}
  try{let bytes;if(storage&&storagePath){bytes=await storage.download(storagePath)}else{const base=await fs.realpath(path.join(root,'backend/storage'));const source=await fs.realpath(path.resolve(base,relative));if(!source.startsWith(base+path.sep))throw new Error();bytes=await fs.readFile(source);}await save(`documentos/${id}.${tipo}`,Buffer.from(bytes));}
  catch{errores.push(`${id}: no fue posible respaldar ${tipo}`);}
 }
}
await fs.writeFile(path.join(out,'manifest.json'),JSON.stringify({fecha:new Date().toISOString(),modo:remote?'supabase':'local',facturas:facturas.length,completo:errores.length===0,alcance:'Respaldo operativo de registros de facturas, catálogo, XML y PDF. No incluye Auth, bitácora, certificados, acuses ni una copia integral de la base de datos. Detén escrituras mientras se ejecuta.',archivos:entries,errores},null,2),{mode:0o600});
console.log(`Respaldo operativo: ${out}. Facturas: ${facturas.length}. Incidencias: ${errores.length}.`);
if(errores.length)process.exitCode=1;

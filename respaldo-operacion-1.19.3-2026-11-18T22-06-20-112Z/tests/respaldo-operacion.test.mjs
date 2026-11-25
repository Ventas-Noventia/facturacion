import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {execFileSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';
const project=fileURLToPath(new URL('../',import.meta.url));
test('respaldo local conserva documentos y hashes; informa faltantes y no copia secretos',async t=>{
 const temp=await fs.mkdtemp(path.join(os.tmpdir(),'backup-nv-'));t.after(()=>fs.rm(temp,{recursive:true,force:true}));
 await fs.cp(path.join(project,'backend'),path.join(temp,'backend'),{recursive:true,filter:s=>!['data','storage'].includes(path.basename(s))});
 await fs.cp(path.join(project,'shared'),path.join(temp,'shared'),{recursive:true});
 await fs.copyFile(path.join(project,'respaldar-facturas.mjs'),path.join(temp,'respaldar-facturas.mjs'));
 await fs.mkdir(path.join(temp,'backend/data'),{recursive:true});await fs.mkdir(path.join(temp,'backend/storage'),{recursive:true});
 await fs.writeFile(path.join(temp,'.env'),'SECRETO_DE_PRUEBA=no_copiar\n');
 await fs.writeFile(path.join(temp,'backend/data/facturas.json'),JSON.stringify([{id:'FACTURA-1',estatus:'TIMBRADA',xmlRelativePath:'prueba.xml',pdfRelativePath:'prueba.pdf'}]));
 await fs.writeFile(path.join(temp,'backend/storage/prueba.xml'),'<xml/>');await fs.writeFile(path.join(temp,'backend/storage/prueba.pdf'),'%PDF-1.4');
 const run=out=>execFileSync(process.execPath,[path.join(temp,'respaldar-facturas.mjs'),out],{cwd:temp,env:{...process.env,SUPABASE_URL:'',SUPABASE_SERVICE_ROLE_KEY:''},encoding:'utf8',stdio:'pipe'});
 const out=path.join(temp,'backup');run(out);const m=JSON.parse(await fs.readFile(path.join(out,'manifest.json'),'utf8'));assert.equal(m.completo,true);assert.equal(m.facturas,1);
 for(const entry of m.archivos){const bytes=await fs.readFile(path.join(out,entry.archivo));assert.equal(createHash('sha256').update(bytes).digest('hex'),entry.sha256);}
 assert.ok(!m.archivos.some(e=>e.archivo.includes('.env')));
 await fs.rm(path.join(temp,'backend/storage/prueba.pdf'));const incomplete=path.join(temp,'incompleto');assert.throws(()=>run(incomplete));assert.equal(JSON.parse(await fs.readFile(path.join(incomplete,'manifest.json'),'utf8')).completo,false);
});

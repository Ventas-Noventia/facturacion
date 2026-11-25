import fs from 'node:fs/promises';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
import {fileURLToPath} from 'node:url';
import {normalizarSku,validarLoteFiscal} from '../../shared/domain/catalogoFiscal.mjs';
const queues=new Map();
const defaultFile=fileURLToPath(new URL('../data/productos-fiscales.json',import.meta.url));
const fromRow=r=>({sku:r.sku,titulo:r.titulo,claveProdServSat:r.clave_prod_serv_sat,claveUnidad:r.clave_unidad,unidad:r.unidad,actualizadoEn:r.actualizado_en});
export class ProductoFiscalRepository {
 constructor({url='',serviceRoleKey='',file=defaultFile,fetchImpl=globalThis.fetch}={}){this.base=url?url.replace(/\/$/,'')+'/rest/v1/productos_fiscales':'';this.key=serviceRoleKey;this.file=path.resolve(file);this.fetch=fetchImpl;}
 async request(query='',options={}){const r=await this.fetch(this.base+query,{...options,headers:{apikey:this.key,Authorization:`Bearer ${this.key}`,'Content-Type':'application/json',...options.headers},signal:AbortSignal.timeout(15000)});const raw=await r.text();const d=raw?JSON.parse(raw):null;if(!r.ok){const e=new Error(['42P01','PGRST205'].includes(d?.code)?'Ejecuta supabase/013_productos_fiscales.sql para habilitar el catálogo.':'No fue posible consultar o guardar el catálogo fiscal.');e.statusCode=503;e.migracionPendiente=['42P01','PGRST205'].includes(d?.code);throw e;}return d;}
 async localRead(){try{return JSON.parse(await fs.readFile(this.file,'utf8'))}catch(e){if(e.code==='ENOENT')return [];throw e;}}
 async listar(){if(this.base){const result=[];for(let offset=0;;offset+=500){const page=await this.request(`?select=*&order=sku&limit=500&offset=${offset}`);result.push(...page.map(fromRow));if(page.length<500)break;if(result.length>100000)throw new Error('Catálogo excede el límite de esta versión.');}return result;}await queues.get(this.file)?.catch(()=>{});return this.localRead();}
 async buscarSkus(skus){const keys=[...new Set(skus.map(normalizarSku).filter(Boolean))];if(!keys.length)return [];if(!this.base)return (await this.listar()).filter(r=>keys.includes(r.sku));const rows=[];for(let i=0;i<keys.length;i+=40){const filter=keys.slice(i,i+40).map(k=>'"'+k.replaceAll('\\','\\\\').replaceAll('"','\\"')+'"').join(',');rows.push(...(await this.request('?select=*&sku=in.('+encodeURIComponent(filter)+')')).map(fromRow));}return rows;}
 async guardarLote(input){const rows=validarLoteFiscal(input).map(r=>({...r,actualizadoEn:new Date().toISOString()}));if(this.base){await this.request('?on_conflict=sku',{method:'POST',headers:{Prefer:'resolution=merge-duplicates,return=minimal'},body:JSON.stringify(rows.map(r=>({sku:r.sku,titulo:r.titulo,clave_prod_serv_sat:r.claveProdServSat,clave_unidad:r.claveUnidad,unidad:r.unidad,actualizado_en:r.actualizadoEn})))});return rows;}
 const prev=queues.get(this.file)||Promise.resolve();const job=prev.catch(()=>{}).then(async()=>{const all=await this.localRead();const map=new Map(all.map(r=>[r.sku,r]));for(const r of rows)map.set(r.sku,r);await fs.mkdir(path.dirname(this.file),{recursive:true});const tmp=this.file+'.'+randomUUID()+'.tmp';try{await fs.writeFile(tmp,JSON.stringify([...map.values()],null,2));await fs.rename(tmp,this.file);}finally{await fs.rm(tmp,{force:true})}return rows;});queues.set(this.file,job);try{return await job}finally{if(queues.get(this.file)===job)queues.delete(this.file)}}
}

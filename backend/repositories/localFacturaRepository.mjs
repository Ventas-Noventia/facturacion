import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
const dir=path.dirname(fileURLToPath(import.meta.url));
const file=path.join(dir,"..","data","facturas.json");
async function ensure(){try{await fs.access(file)}catch{await fs.writeFile(file,"[]","utf8")}}
export class LocalFacturaRepository{async list(){await ensure();return JSON.parse(await fs.readFile(file,"utf8"))}async save(f){const d=await this.list();const max=d.reduce((n,x)=>Math.max(n,Number(x.numero)||0),0);const factura={...f,numero:max+1,folioInterno:`NOV-FAC-${String(max+1).padStart(6,"0")}`};d.unshift(factura);await fs.writeFile(file,JSON.stringify(d,null,2),"utf8");return factura}async findById(id){return (await this.list()).find(x=>x.id===id)||null}async update(id,patch){const d=await this.list();const i=d.findIndex(x=>x.id===id);if(i<0)return null;d[i]={...d[i],...patch};await fs.writeFile(file,JSON.stringify(d,null,2),"utf8");return d[i]}}

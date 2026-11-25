import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
const dir=path.dirname(fileURLToPath(import.meta.url));
const file=path.join(dir,"..","data","usuarios.json");
async function ensure(){try{await fs.access(file)}catch{await fs.writeFile(file,JSON.stringify([{id:"USR-001",nombre:"Administrador",email:"admin@local.test",rol:"ADMIN",activo:true}],null,2),"utf8")}}
export class LocalUsuarioRepository{async list(){await ensure();return JSON.parse(await fs.readFile(file,"utf8"))}async save(usuario){const data=await this.list();data.push(usuario);await fs.writeFile(file,JSON.stringify(data,null,2),"utf8");return usuario}}

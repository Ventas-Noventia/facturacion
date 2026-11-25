import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { SupabaseDocumentStorageService } from "../backend/services/supabaseDocumentStorageService.mjs";

test("sube XML y PDF a rutas privadas organizadas",async()=>{
  const dir=await fs.mkdtemp(path.join(os.tmpdir(),"facturacion-storage-"));
  const xml=path.join(dir,"a.xml"),pdf=path.join(dir,"a.pdf");
  await fs.writeFile(xml,"<xml/>");await fs.writeFile(pdf,"PDF");
  const original=global.fetch,calls=[];
  global.fetch=async(url,options)=>{calls.push({url,options});return new Response("{}",{status:200})};
  try{
    const svc=new SupabaseDocumentStorageService({url:"https://example.supabase.co",serviceRoleKey:"secret"});
    const result=await svc.guardarArchivos({factura:{id:"1",folioInterno:"NOV-FAC-000001",cliente:{rfc:"XAXX010101000"}},fechaTimbrado:"2026-09-08T12:00:00Z",xmlFile:xml,pdfFile:pdf});
    assert.equal(result.xmlStoragePath,"2026/09/XAXX010101000/NOV-FAC-000001.xml");
    assert.equal(calls.length,2);
    assert.ok(calls.every(c=>c.options.headers.Authorization==="Bearer secret"));
  }finally{global.fetch=original;await fs.rm(dir,{recursive:true,force:true})}
});

test("descarga bytes desde el bucket privado",async()=>{
  const original=global.fetch;
  global.fetch=async()=>new Response("contenido",{status:200});
  try{
    const svc=new SupabaseDocumentStorageService({url:"https://example.supabase.co",serviceRoleKey:"secret"});
    const bytes=await svc.download("2026/09/RFC/factura.xml");
    assert.equal(bytes.toString(),"contenido");
  }finally{global.fetch=original}
});

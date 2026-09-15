import test from "node:test";
import assert from "node:assert/strict";
import { SupabaseClienteFiscalRepository } from "../backend/repositories/supabaseClienteFiscalRepository.mjs";

test("mapea y guarda un cliente fiscal en Supabase",async()=>{
  const original=global.fetch;
  global.fetch=async(url,options)=>{
    assert.match(url,/\/rest\/v1\/clientes_fiscales/);
    assert.equal(options.method,"POST");
    const body=JSON.parse(options.body);
    assert.equal(body.rfc,"LOPM900101AB1");
    return new Response(JSON.stringify([{id:"1",...body,creado_en:"2026-01-01",actualizado_en:"2026-01-01"}]),{status:201});
  };
  try{
    const repo=new SupabaseClienteFiscalRepository({url:"https://example.supabase.co",serviceRoleKey:"secret"});
    const result=await repo.save({tipoPersona:"FISICA",razonSocial:"Maria Lopez",rfc:"lopm900101ab1",codigoPostal:"54720",regimenFiscal:"612",usoCfdi:"G03",email:"MARIA@EXAMPLE.COM"});
    assert.equal(result.razonSocial,"MARIA LOPEZ");
    assert.equal(result.email,"maria@example.com");
  }finally{global.fetch=original}
});

test("convierte el RFC duplicado en un mensaje entendible",async()=>{
  const original=global.fetch;
  global.fetch=async()=>new Response(JSON.stringify({code:"23505",message:"duplicate key"}),{status:409});
  try{
    const repo=new SupabaseClienteFiscalRepository({url:"https://example.supabase.co",serviceRoleKey:"secret"});
    await assert.rejects(()=>repo.save({rfc:"LOPM900101AB1"}),/Ya existe un cliente fiscal/);
  }finally{global.fetch=original}
});

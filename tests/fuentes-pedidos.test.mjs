import test from "node:test";
import {fileURLToPath} from "node:url";
import assert from "node:assert/strict";
import { EcommerceJsonService } from "../backend/services/ecommerceJsonService.mjs";
import { PedidosService } from "../backend/services/pedidosService.mjs";

const firebaseMock={
  async obtenerPedido(folio){
    if(folio==="WA-000123")return{folio,fuente:"FIRESTORE_SOLICITUDES_WHATSAPP",productos:[{descripcion:"Producto WA"}]};
    if(folio==="BAZ-000045")return{folio,fuente:"FIRESTORE_SURTIDOS",productos:[{descripcion:"Organizador para hogar"}]};
    return null;
  }
};
const service=new PedidosService({ecommerceService:new EcommerceJsonService({filePath:fileURLToPath(new URL("./fixtures/ecommerce-pedidos.json",import.meta.url))}),firebaseService:firebaseMock});

test("WEB usa e-commerce",async()=>{const p=await service.obtenerPedido("WEB-000101");assert.equal(p.fuente,"ECOMMERCE_JSON");assert.ok(p.productos.length>0)});
test("WA usa Firebase",async()=>{const p=await service.obtenerPedido("WA-000123");assert.equal(p.fuente,"FIRESTORE_SOLICITUDES_WHATSAPP")});
test("BAZ usa Firebase",async()=>{const p=await service.obtenerPedido("BAZ-000045");assert.equal(p.productos[0].descripcion,"Organizador para hogar")});
test("folio inexistente devuelve null",async()=>assert.equal(await service.obtenerPedido("XX-999"),null));

import test from "node:test";
import assert from "node:assert/strict";
import { crearPdfFactura } from "../backend/services/simplePdfService.mjs";
const base={folioInterno:"NOV-FAC-000123",folioOrigen:"PEDIDO-PRIVADO-123",moneda:"MXN",creadaEn:"2026-10-26T16:00:00Z",formaPago:"03",metodoPago:"PUE",usoCfdi:"G03",cliente:{razonSocial:"María Pérez",rfc:"XAXX010101000",codigoPostal:"53490",regimenFiscal:"616"},subtotal:100,impuestos:16,total:116};
const item=(i=1)=>({sku:`PRODUCTO-${i}`,descripcion:`Descripción del artículo número ${i}`,cantidad:1,precioUnitario:100,unidad:"Pieza",claveUnidad:"H87",calculo:{subtotal:100,impuesto:16}});
test("el PDF muestra todos los productos, continúa páginas y conserva el total",()=>{
 const pdf=crearPdfFactura({factura:{...base,conceptos:Array.from({length:35},(_,i)=>item(i+1))}}).toString("latin1");
 assert.match(pdf,/PRODUCTO-35/);assert.match(pdf,/\/Type \/Pages \/Count [2-9]/);assert.match(pdf,/NOV-FAC-000123/);assert.match(pdf,/\$116\.00/);
});
test("el pedido queda interno y el PDF conserva los acentos y el logo",()=>{
 const pdf=crearPdfFactura({factura:{...base,conceptos:[item()]}}).toString("latin1");
 assert.doesNotMatch(pdf,/PEDIDO-PRIVADO-123/);assert.match(pdf,/María Pérez/);assert.match(pdf,/Descripción/);assert.match(pdf,/\/Subtype \/Image/);assert.match(pdf,/SIN VALOR FISCAL/);
});
test("una descripción y un SKU largos continúan sin descartarse ni bloquear el generador",()=>{
 const product={...item(),descripcion:'Detalle largo '.repeat(500)+'FIN-DESCRIPCION',sku:'IDENTIFICADOR'.repeat(350)+'FIN-SKU'};
 const pdf=crearPdfFactura({factura:{...base,conceptos:[product]}}).toString("latin1");
 assert.match(pdf,/FIN-DESCRIPCION/);assert.match(pdf,/FIN-SKU/);assert.ok(pdf.length>1000);
});
test("el cupón se informa como aplicado y el folio de compra no se usa como folio fiscal",()=>{
 const pdf=crearPdfFactura({factura:{...base,folioInterno:undefined,conceptos:[item()],pedido:{descuentoPedido:150}}}).toString("latin1");
 assert.match(pdf,/BORRADOR/);assert.match(pdf,/Cupón de la compra: \$150\.00/);assert.match(pdf,/Ya reflejado/);assert.doesNotMatch(pdf,/PEDIDO-PRIVADO-123/);
});

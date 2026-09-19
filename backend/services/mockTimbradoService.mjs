import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { crearPdfFactura } from "./simplePdfService.mjs";

const dir=path.dirname(fileURLToPath(import.meta.url));
const root=path.join(dir,"..","storage");

const safe=v=>String(v||"SIN_FOLIO").replace(/[^a-zA-Z0-9_-]+/g,"_");
const money=v=>Number(v||0).toFixed(2);
const esc=v=>String(v??"")
  .replaceAll("&","&amp;")
  .replaceAll('"',"&quot;")
  .replaceAll("<","&lt;")
  .replaceAll(">","&gt;");

function conceptoXml(c){
  const cantidad=Number(c.cantidad||0);
  const valorUnitario=Number(c.precioUnitario||0);
  const importe=Number(c.calculo?.subtotal ?? cantidad*valorUnitario);
  const tasa=Number(c.tasaIva||0);
  const impuesto=Number(c.calculo?.impuesto||0);
  const claveProdServ=esc(c.claveProdServSat || "01010101");
  const objetoImp=tasa>0 ? "02" : "01";

  const impuestos=tasa>0 ? `
      <cfdi:Impuestos>
        <cfdi:Traslados>
          <cfdi:Traslado Base="${money(importe)}" Impuesto="002" TipoFactor="Tasa" TasaOCuota="${tasa.toFixed(6)}" Importe="${money(impuesto)}"/>
        </cfdi:Traslados>
      </cfdi:Impuestos>` : "";

  return `    <cfdi:Concepto ClaveProdServ="${claveProdServ}" NoIdentificacion="${esc(c.sku||c.clave||"")}" Cantidad="${cantidad}" ClaveUnidad="${esc(c.claveUnidad||"H87")}" Unidad="${esc(c.unidad||"Pieza")}" Descripcion="${esc(c.descripcion||"Producto")}" ValorUnitario="${money(valorUnitario)}" Importe="${money(importe)}" ObjetoImp="${objetoImp}">
${impuestos}
    </cfdi:Concepto>`;
}

function construirXml(f, uuid, fechaTimbrado){
  const emisor=f.emisor||{};
  const conceptos=(f.conceptos||[]).map(conceptoXml).join("\n");
  const tieneIva=Number(f.impuestos||0)>0;
  const tasa=Number(f.tasaIva ?? f.conceptos?.[0]?.tasaIva ?? 0);

  const impuestos=tieneIva ? `
  <cfdi:Impuestos TotalImpuestosTrasladados="${money(f.impuestos)}">
    <cfdi:Traslados>
      <cfdi:Traslado Base="${money(f.subtotal)}" Impuesto="002" TipoFactor="Tasa" TasaOCuota="${tasa.toFixed(6)}" Importe="${money(f.impuestos)}"/>
    </cfdi:Traslados>
  </cfdi:Impuestos>` : "";

  return `<?xml version="1.0" encoding="UTF-8"?>
<cfdi:Comprobante
  xmlns:cfdi="http://www.sat.gob.mx/cfd/4"
  xmlns:tfd="http://www.sat.gob.mx/TimbreFiscalDigital"
  Version="4.0"
  Serie="${esc(emisor.serie||"F")}"
  Folio="${esc(f.folioOrigen||f.id)}"
  Fecha="${esc(f.creadaEn)}"
  FormaPago="${esc(f.formaPago)}"
  SubTotal="${money(f.subtotal)}"
  Moneda="MXN"
  Total="${money(f.total)}"
  TipoDeComprobante="I"
  Exportacion="${esc(emisor.exportacion||"01")}"
  MetodoPago="${esc(f.metodoPago)}"
  LugarExpedicion="${esc(emisor.codigoPostal||"54700")}">
  <cfdi:Emisor Rfc="${esc(emisor.rfc||"AAA010101AAA")}" Nombre="${esc(emisor.razonSocial||"EMPRESA DE PRUEBA SA DE CV")}" RegimenFiscal="${esc(emisor.regimenFiscal||"601")}"/>
  <cfdi:Receptor
    Rfc="${esc(f.cliente?.rfc)}"
    Nombre="${esc(f.cliente?.razonSocial)}"
    DomicilioFiscalReceptor="${esc(f.cliente?.codigoPostal)}"
    RegimenFiscalReceptor="${esc(f.cliente?.regimenFiscal)}"
    UsoCFDI="${esc(f.usoCfdi)}"/>
  <cfdi:Conceptos>
${conceptos}
  </cfdi:Conceptos>${impuestos}
  <cfdi:Complemento>
    <tfd:TimbreFiscalDigital
      Version="1.1"
      UUID="${esc(uuid)}"
      FechaTimbrado="${esc(fechaTimbrado)}"
      RfcProvCertif="AAA010101AAA"
      SelloCFD="SELLO_MOCK"
      NoCertificadoSAT="00001000000000000000"
      SelloSAT="SELLO_SAT_MOCK"/>
  </cfdi:Complemento>
</cfdi:Comprobante>`;
}

export class MockTimbradoService{
  async timbrar(f){
    const n=new Date();
    const folder=path.join(root,String(n.getFullYear()),String(n.getMonth()+1).padStart(2,"0"));
    await fs.mkdir(folder,{recursive:true});

    const folio=safe(f.folioOrigen||f.id);
    const uuid=`MOCK-${Date.now()}`;
    const xml=path.join(folder,`${folio}.xml`);
    const pdf=path.join(folder,`${folio}.pdf`);

    await fs.writeFile(xml,construirXml(f,uuid,n.toISOString()),"utf8");
    await fs.writeFile(pdf,crearPdfFactura({factura:f,emisor:f.emisor||{},uuid,fechaTimbrado:n.toISOString()}));

    return{
      facturaId:f.id,
      uuid,
      estatus:"TIMBRADA_MOCK",
      fechaTimbrado:n.toISOString(),
      xmlRelativePath:path.relative(root,xml),
      pdfRelativePath:path.relative(root,pdf)
    };
  }
}

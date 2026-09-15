import fs from "node:fs/promises";
import path from "node:path";

const safe=value=>String(value||"SIN_DATO").replace(/[^a-zA-Z0-9_-]+/g,"_");

export class SupabaseDocumentStorageService{
  constructor({url,serviceRoleKey,bucket="documentos-fiscales"}){
    this.base=`${String(url).replace(/\/$/,"")}/storage/v1/object`;
    this.key=serviceRoleKey;
    this.bucket=bucket;
  }

  headers(extra={}){
    return{apikey:this.key,Authorization:`Bearer ${this.key}`,...extra};
  }

  async upload(storagePath,bytes,contentType){
    const encoded=storagePath.split("/").map(encodeURIComponent).join("/");
    const response=await fetch(`${this.base}/${this.bucket}/${encoded}`,{
      method:"POST",
      headers:this.headers({"Content-Type":contentType,"x-upsert":"true"}),
      body:bytes
    });
    if(!response.ok){
      const data=await response.json().catch(()=>({}));
      throw new Error(data.message||data.error||"No fue posible guardar el documento en Supabase Storage");
    }
    return storagePath;
  }

  async guardarArchivos({factura,fechaTimbrado,xmlFile,pdfFile}){
    const fecha=new Date(fechaTimbrado);
    const folder=[String(fecha.getUTCFullYear()),String(fecha.getUTCMonth()+1).padStart(2,"0"),safe(factura.cliente?.rfc)].join("/");
    const baseName=safe(factura.folioInterno||factura.folioOrigen||factura.id);
    const xmlStoragePath=`${folder}/${baseName}.xml`;
    const pdfStoragePath=`${folder}/${baseName}.pdf`;
    const [xml,pdf]=await Promise.all([fs.readFile(xmlFile),fs.readFile(pdfFile)]);
    await this.upload(xmlStoragePath,xml,"application/xml");
    await this.upload(pdfStoragePath,pdf,"application/pdf");
    return{xmlStoragePath,pdfStoragePath};
  }

  async download(storagePath){
    const encoded=storagePath.split("/").map(encodeURIComponent).join("/");
    const response=await fetch(`${this.base}/${this.bucket}/${encoded}`,{headers:this.headers()});
    if(!response.ok)throw new Error("Documento no disponible en Supabase Storage");
    return Buffer.from(await response.arrayBuffer());
  }
}

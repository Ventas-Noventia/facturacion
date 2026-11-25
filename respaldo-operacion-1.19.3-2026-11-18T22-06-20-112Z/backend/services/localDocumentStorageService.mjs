import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const dir = path.dirname(fileURLToPath(import.meta.url));
const base = path.join(dir, "..", "storage");

function safeName(value) {
  return String(value || "sin-cliente").replace(/[^a-zA-Z0-9-_]/g, "_").slice(0, 60);
}

export class LocalDocumentStorageService {
  async guardarTimbrado({ factura, timbre }) {
    const fecha = new Date(timbre.fechaTimbrado);
    const folder = path.join(base, String(fecha.getFullYear()), String(fecha.getMonth() + 1).padStart(2, "0"), safeName(factura.cliente.rfc));
    await fs.mkdir(folder, { recursive: true });

    const baseName = safeName(factura.folioOrigen || factura.id);
    const xmlPath = path.join(folder, `${baseName}.xml`);
    const pdfPath = path.join(folder, `${baseName}.pdf`);

    const xml = `<?xml version="1.0" encoding="UTF-8"?>\n<cfdiMock uuid="${timbre.uuid}" total="${factura.total}" rfc="${factura.cliente.rfc}" />\n`;
    const pdfText = [
      "FACTURA DE PRUEBA - NO FISCAL",
      `UUID: ${timbre.uuid}`,
      `Cliente: ${factura.cliente.razonSocial}`,
      `RFC: ${factura.cliente.rfc}`,
      `Total: ${factura.total}`,
      `Forma de pago: ${factura.formaPago}`,
      `Método de pago: ${factura.metodoPago}`
    ].join("\n");

    await fs.writeFile(xmlPath, xml, "utf8");
    await fs.writeFile(pdfPath, pdfText, "utf8");

    return { xmlPath, pdfPath };
  }
}

import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const dir = path.dirname(fileURLToPath(import.meta.url));
const outbox = path.join(dir, "..", "data", "correo-salida.json");

async function ensure() {
  try { await fs.access(outbox); }
  catch { await fs.writeFile(outbox, "[]", "utf8"); }
}

export class MockEmailService {
  async enviarFactura({ destinatario, factura, documentos }) {
    if (!destinatario) return { enviado: false, motivo: "SIN_CORREO" };
    await ensure();
    const data = JSON.parse(await fs.readFile(outbox, "utf8"));
    const mensaje = {
      id: `MAIL-${Date.now()}`,
      para: destinatario,
      asunto: `Factura ${factura.folioOrigen || factura.id}`,
      facturaId: factura.id,
      adjuntos: [documentos.xmlPath, documentos.pdfPath],
      estatus: "SIMULADO",
      fecha: new Date().toISOString()
    };
    data.unshift(mensaje);
    await fs.writeFile(outbox, JSON.stringify(data, null, 2), "utf8");
    return { enviado: true, ...mensaje };
  }
}

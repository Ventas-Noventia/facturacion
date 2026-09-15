import fs from "node:fs/promises";
import path from "node:path";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";

const dir = path.dirname(fileURLToPath(import.meta.url));
const file = path.join(dir, "..", "data", "clientes-fiscales.json");

async function ensure() {
  try { await fs.access(file); }
  catch {
    await fs.writeFile(file, JSON.stringify([
      {
        id:"CLI-001",
        tipoPersona:"FISICA",
        razonSocial:"MARIA LOPEZ",
        rfc:"LOPM900101AB1",
        codigoPostal:"54720",
        regimenFiscal:"612",
        usoCfdi:"G03",
        email:"maria@example.com",
        activo:true
      }
    ], null, 2), "utf8");
  }
}

export class LocalClienteFiscalRepository {
  async list() {
    await ensure();
    return JSON.parse(await fs.readFile(file, "utf8"));
  }

  async search(q="") {
    const query = String(q).trim().toLowerCase();
    const data = await this.list();
    if (!query) return data;
    return data.filter(c =>
      `${c.razonSocial} ${c.rfc} ${c.email}`.toLowerCase().includes(query)
    );
  }

  async save(input) {
    const data = await this.list();
    const rfc = String(input.rfc || "").trim().toUpperCase();
    const idx = data.findIndex(c => String(c.rfc).toUpperCase() === rfc);
    const record = {
      id: idx >= 0 ? data[idx].id : crypto.randomUUID(),
      tipoPersona: input.tipoPersona,
      razonSocial: String(input.razonSocial || "").trim(),
      rfc,
      codigoPostal: String(input.codigoPostal || "").trim(),
      regimenFiscal: String(input.regimenFiscal || "").trim(),
      usoCfdi: String(input.usoCfdi || "").trim(),
      email: String(input.email || "").trim().toLowerCase(),
      activo: true
    };
    if (idx >= 0) data[idx] = record; else data.push(record);
    await fs.writeFile(file, JSON.stringify(data, null, 2), "utf8");
    return record;
  }
}

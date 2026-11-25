import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const dir = path.dirname(fileURLToPath(import.meta.url));
const file = path.join(dir, "..", "data", "clientes.json");

async function ensure() {
  try { await fs.access(file); }
  catch {
    const seed = [
      { id: "CLI-001", razonSocial: "PUBLICO EN GENERAL", rfc: "XAXX010101000", codigoPostal: "54700", regimenFiscal: "616", email: "" },
      { id: "CLI-002", razonSocial: "CLIENTE DEMO SA DE CV", rfc: "CDE010101ABC", codigoPostal: "06000", regimenFiscal: "601", email: "cliente.demo@example.com" }
    ];
    await fs.writeFile(file, JSON.stringify(seed, null, 2), "utf8");
  }
}

export class LocalClienteRepository {
  async list(query = "") {
    await ensure();
    const data = JSON.parse(await fs.readFile(file, "utf8"));
    const q = String(query).trim().toLowerCase();
    if (!q) return data;
    return data.filter(c => [c.razonSocial, c.rfc, c.email].some(v => String(v || "").toLowerCase().includes(q)));
  }

  async save(cliente) {
    await ensure();
    const data = JSON.parse(await fs.readFile(file, "utf8"));
    const existingIndex = data.findIndex(c => c.rfc === cliente.rfc);
    const record = { id: existingIndex >= 0 ? data[existingIndex].id : `CLI-${String(data.length + 1).padStart(3, "0")}`, ...cliente };
    if (existingIndex >= 0) data[existingIndex] = record; else data.push(record);
    await fs.writeFile(file, JSON.stringify(data, null, 2), "utf8");
    return record;
  }
}

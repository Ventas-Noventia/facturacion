import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { randomUUID } from "node:crypto";
import { FacturaDuplicadaError } from "./facturaDuplicadaError.mjs";

const dir = path.dirname(fileURLToPath(import.meta.url));
const defaultFile = path.join(dir, "..", "data", "facturas.json");
// Repository instances using the same file share a mutation queue in this process.
const mutations = new Map();
const active = factura => !String(factura.estatus || "").startsWith("CANCELADA");
const folioKey = folio => String(folio || "").trim().toUpperCase();
const ecommerceKey = factura => factura.pedido?.fuente === "ECOMMERCE_API" && factura.pedido.ecommerceId != null
  ? String(factura.pedido.ecommerceId) : "";

function assertUnique(rows, factura, ignoredId = null) {
  if (!active(factura)) return;
  const folio = folioKey(factura.folioOrigen), ecommerceId = ecommerceKey(factura);
  if (rows.some(row => row.id !== ignoredId && active(row) && (
    (folio && folioKey(row.folioOrigen) === folio) ||
    (ecommerceId && ecommerceKey(row) === ecommerceId)
  ))) throw new FacturaDuplicadaError();
}

export class LocalFacturaRepository {
  constructor({ file = defaultFile } = {}) { this.file = path.resolve(file); }

  async read() {
    try { return JSON.parse(await fs.readFile(this.file, "utf8")); }
    catch (error) { if (error.code === "ENOENT") return []; throw error; }
  }

  async write(rows) {
    await fs.mkdir(path.dirname(this.file), { recursive: true });
    const temporary = `${this.file}.${randomUUID()}.tmp`;
    try {
      await fs.writeFile(temporary, JSON.stringify(rows, null, 2), { encoding: "utf8", flag: "wx" });
      await fs.rename(temporary, this.file);
    } finally { await fs.rm(temporary, { force: true }); }
  }

  async mutate(operation) {
    const previous = mutations.get(this.file) || Promise.resolve();
    const current = previous.catch(() => {}).then(operation);
    mutations.set(this.file, current);
    try { return await current; }
    finally { if (mutations.get(this.file) === current) mutations.delete(this.file); }
  }

  async list() {
    await mutations.get(this.file)?.catch(() => {});
    return this.read();
  }

  async page({ q = "", desde = "", hasta = "", origen = "", estatus = "", sync = "", page = 1, pageSize = 25 } = {}) {
    const texto = String(q).toLowerCase();
    const estadoSync = f => !f.pedido?.firebaseId ? "NO_APLICA" : f.pedidoLiberadoPorCancelacion ? "LIBERADO" : f.pedidoMarcadoFacturado === true ? "SINCRONIZADO" : f.pedidoMarcadoFacturado === false || f.errorSincronizacionPedido ? "ERROR" : "PENDIENTE";
    const datos = (await this.list()).filter(f => {
      const fecha = String(f.creadaEn || "").slice(0, 10);
      const contenido = `${f.folioInterno} ${f.folioOrigen} ${f.cliente?.razonSocial} ${f.cliente?.rfc} ${f.uuid}`.toLowerCase();
      return (!texto || contenido.includes(texto)) && (!desde || fecha >= desde) && (!hasta || fecha <= hasta) && (!origen || (f.origen || "MANUAL") === origen) && (!estatus || f.estatus === estatus) && (!sync || estadoSync(f) === sync);
    });
    const limite = Math.min(Math.max(Number(pageSize) || 25, 1), 5000), pagina = Math.max(Number(page) || 1, 1);
    return { items: datos.slice((pagina - 1) * limite, pagina * limite), total: datos.length, page: pagina, pageSize: limite };
  }

  async save(input) {
    return this.mutate(async () => {
      const rows = await this.read();
      if (rows.some(row => row.id === input.id)) throw new FacturaDuplicadaError();
      assertUnique(rows, input);
      const numero = rows.reduce((n, row) => Math.max(n, Number(row.numero) || 0), 0) + 1;
      const factura = { ...input, numero, folioInterno: `NOV-FAC-${String(numero).padStart(6, "0")}` };
      rows.unshift(factura);
      await this.write(rows);
      return factura;
    });
  }

  async findById(id) { return (await this.list()).find(f => f.id === id) || null; }
  async findByFolioOrigen(folio) {
    const key = folioKey(folio);
    return key ? (await this.list()).find(f => active(f) && folioKey(f.folioOrigen) === key) || null : null;
  }
  async findByEcommerceId(id) {
    return (await this.list()).find(f => active(f) && ecommerceKey(f) === String(id)) || null;
  }

  async update(id, patch) {
    return this.mutate(async () => {
      const rows = await this.read(), index = rows.findIndex(f => f.id === id);
      if (index < 0) return null;
      const factura = { ...rows[index], ...patch };
      assertUnique(rows, factura, id);
      rows[index] = factura;
      await this.write(rows);
      return factura;
    });
  }

  async delete(id) {
    return this.mutate(async () => {
      const rows = await this.read(), remaining = rows.filter(f => f.id !== id);
      if (remaining.length === rows.length) return false;
      await this.write(remaining);
      return true;
    });
  }
}

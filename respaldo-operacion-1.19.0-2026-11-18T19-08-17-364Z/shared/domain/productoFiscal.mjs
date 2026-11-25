const texto = values => values.find(v => typeof v === "string" && v.trim())?.trim() || "";
const fuentes = item => [item, item.product, item.product_listing, item.productListing, item.producto].filter(v => v && typeof v === "object");
export function tituloProducto(item = {}) {
  const sources = fuentes(item);
  return texto(sources.flatMap(v => [v.title, v.titulo, v.product_title, v.productTitle, v.nombre, v.name]))
    || texto(sources.flatMap(v => [v.description, v.descripcion]));
}
export function detalleProducto(item = {}) {
  return texto(fuentes(item).flatMap(v => [v.description, v.descripcion]));
}
export function claveSatProducto(item = {}) {
  const explicit = fuentes(item).flatMap(v => [v.claveProdServSat, v.satProductCode, v.sat_product_code, v.clave_sat, v.claveSat, v.clave_prod_serv, v.claveProdServ, v.ClaveProdServ])
    .map(v => String(v ?? "").trim()).find(v => /^\d{8}$/.test(v));
  if (explicit) return explicit;
  const sku = String(item.sku || item.clave || "").trim().toUpperCase();
  if (sku === "ENVIO") return "78102200";
  const title = tituloProducto(item).normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
  // Conservative match: only a generic rug title, never a related accessory.
  if (/^alfombra(?:s)?(?:\s|$)/.test(title) && !/yoga|automovil|coche|auto |bano|entrada|oriental|lana|algodon|sintetic|trenzad|palma|nudos/.test(title)) return "52101502";
  return "";
}

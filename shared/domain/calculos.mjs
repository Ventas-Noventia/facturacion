const SCALE = 1000000n;
const roundedDivide = (a, b) => (a + b / 2n) / b;
function micros(value) {
  const text = typeof value === "number" && Number.isFinite(value) ? value.toFixed(6) : String(value).trim();
  const match = /^(\d+)(?:\.(\d{1,6}))?$/.exec(text);
  if (!match) throw new Error("Importe decimal inválido");
  return BigInt(match[1]) * SCALE + BigInt((match[2] || "").padEnd(6, "0"));
}
function amount(value, decimals = 2) {
  const units = roundedDivide(value, 10n ** BigInt(6 - decimals));
  if (units > BigInt(Number.MAX_SAFE_INTEGER)) throw new Error("El importe excede el rango soportado");
  return Number(units) / 10 ** decimals;
}

export function redondear(v) {
  return Math.round((Number(v) + Number.EPSILON) * 100) / 100;
}

export function calcularConcepto({ cantidad, precioUnitario, descuento = 0, tasaIva = 0.16, precisionCalculo = 2 }) {
  const c = Number(cantidad);
  const p = Number(precioUnitario);
  const d = Number(descuento);
  const iva = Number(tasaIva);

  if (!Number.isFinite(c) || c <= 0) throw new Error("La cantidad debe ser mayor a 0");
  if (!Number.isFinite(p) || p < 0) throw new Error("Precio unitario inválido");
  if (!Number.isFinite(d) || d < 0) throw new Error("Descuento inválido");

  if (!Number.isFinite(iva) || iva < 0) throw new Error("Tasa de IVA inválida");
  const precision = precisionCalculo === 6 ? 6 : 2;
  const step = precision === 6 ? 1n : 10000n;
  const round = value => roundedDivide(value, step) * step;
  const bruto = round(roundedDivide(micros(cantidad) * micros(precioUnitario), SCALE));
  const descuentoAplicado = micros(descuento) > bruto ? bruto : round(micros(descuento));
  const subtotal = bruto - descuentoAplicado;
  const impuesto = round(roundedDivide(subtotal * micros(tasaIva), SCALE));
  return { bruto: amount(bruto, precision), descuento: amount(descuentoAplicado, precision),
    subtotal: amount(subtotal, precision), impuesto: amount(impuesto, precision), total: amount(subtotal + impuesto, precision) };
}

export function calcularTotales(conceptos) {
  if (!Array.isArray(conceptos) || conceptos.length === 0) {
    throw new Error("Debe existir al menos un concepto");
  }

  const detalles = conceptos.map(c => ({ ...c, calculo: calcularConcepto(c) }));
  let base = 0n, tax = 0n;
  for (const item of detalles) { base += micros(item.calculo.subtotal); tax += micros(item.calculo.impuesto); }
  const subtotal = amount(base), impuestos = amount(tax);
  const total = Number(roundedDivide(base, 10000n) + roundedDivide(tax, 10000n)) / 100;
  return { detalles, subtotal, impuestos, total };
}

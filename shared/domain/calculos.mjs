export function redondear(v) {
  return Math.round((Number(v) + Number.EPSILON) * 100) / 100;
}

export function calcularConcepto({ cantidad, precioUnitario, descuento = 0, tasaIva = 0.16 }) {
  const c = Number(cantidad);
  const p = Number(precioUnitario);
  const d = Number(descuento);
  const iva = Number(tasaIva);

  if (!Number.isFinite(c) || c <= 0) throw new Error("La cantidad debe ser mayor a 0");
  if (!Number.isFinite(p) || p < 0) throw new Error("Precio unitario inválido");
  if (!Number.isFinite(d) || d < 0) throw new Error("Descuento inválido");

  const bruto = redondear(c * p);
  const descuentoAplicado = redondear(Math.min(d, bruto));
  const subtotal = redondear(bruto - descuentoAplicado);
  const impuesto = redondear(subtotal * iva);
  const total = redondear(subtotal + impuesto);

  return { bruto, descuento: descuentoAplicado, subtotal, impuesto, total };
}

export function calcularTotales(conceptos) {
  if (!Array.isArray(conceptos) || conceptos.length === 0) {
    throw new Error("Debe existir al menos un concepto");
  }

  const detalles = conceptos.map(c => ({ ...c, calculo: calcularConcepto(c) }));
  const resumen = detalles.reduce((acc, item) => {
    acc.subtotal = redondear(acc.subtotal + item.calculo.subtotal);
    acc.impuestos = redondear(acc.impuestos + item.calculo.impuesto);
    acc.total = redondear(acc.total + item.calculo.total);
    return acc;
  }, { subtotal: 0, impuestos: 0, total: 0 });

  return { detalles, ...resumen };
}

import crypto from "node:crypto";
import { calcularTotales } from "./calculos.mjs";
import { validarDatosFactura } from "./validaciones.mjs";

const FORMAS_PAGO = new Set(["01","02","03","04","28","99"]);
const METODOS_PAGO = new Set(["PUE","PPD"]);

export function crearFactura(input) {
  const validacion = validarDatosFactura(input);
  if (!validacion.valido) throw new Error(validacion.errores.join(". "));
  if (!FORMAS_PAGO.has(input.formaPago)) throw new Error("Forma de pago no soportada en esta versión");
  if (!METODOS_PAGO.has(input.metodoPago)) throw new Error("Método de pago inválido");

  const t = calcularTotales(input.conceptos);

  return {
    id: crypto.randomUUID(),
    folioOrigen: String(input.folioOrigen || "").trim(),
    origen: input.origen || "MANUAL",
    cliente: {
      razonSocial: input.cliente.razonSocial.trim(),
      rfc: input.cliente.rfc.trim().toUpperCase(),
      codigoPostal: String(input.cliente.codigoPostal),
      regimenFiscal: input.cliente.regimenFiscal,
      email: String(input.cliente.email || "").trim()
    },
    usoCfdi: input.usoCfdi,
    formaPago: input.formaPago,
    metodoPago: input.metodoPago,
    aplicarIva: Boolean(input.aplicarIva ?? t.impuestos > 0),
    tasaIva: Number(input.tasaIva ?? input.conceptos?.[0]?.tasaIva ?? 0),
    moneda: "MXN",
    conceptos: t.detalles,
    subtotal: t.subtotal,
    impuestos: t.impuestos,
    total: t.total,
    estatus: "BORRADOR",
    creadaEn: new Date().toISOString()
  };
}

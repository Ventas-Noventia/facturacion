import crypto from "node:crypto";
import { calcularTotales } from "./calculos.mjs";
import { validarDatosFactura } from "./validaciones.mjs";

const FORMAS_PAGO = new Set(["01","02","03","04","28","99"]);
const METODOS_PAGO = new Set(["PUE","PPD"]);

export class DatosFacturaError extends Error {
  constructor(message) { super(message); this.name = "DatosFacturaError"; this.code = "DATOS_FACTURA_INVALIDOS"; this.statusCode = 400; }
}

export function crearFactura(input) {
  const validacion = validarDatosFactura(input);
  if (!validacion.valido) throw new DatosFacturaError(validacion.errores.join(". "));
  if (!FORMAS_PAGO.has(input.formaPago)) throw new DatosFacturaError("Forma de pago no soportada en esta versión");
  if (!METODOS_PAGO.has(input.metodoPago)) throw new DatosFacturaError("Método de pago inválido");

  const conceptos = input.conceptos.map(concepto=>({...concepto,tasaIva:0.16}));
  let t;
  try { t = calcularTotales(conceptos); }
  catch (error) {
    const known = new Set(["La cantidad debe ser mayor a 0", "Precio unitario inválido", "Descuento inválido", "Tasa de IVA inválida", "Importe decimal inválido", "El importe excede el rango soportado"]);
    throw new DatosFacturaError(known.has(error.message) ? error.message : "Revisa las cantidades y los importes de los conceptos");
  }

  return {
    id: crypto.randomUUID(),
    folioOrigen: String(input.folioOrigen || "").trim(),
    origen: input.origen || "MANUAL",
    cliente: {
      tipoPersona: input.cliente.tipoPersona || "FISICA",
      razonSocial: input.cliente.razonSocial.trim(),
      rfc: input.cliente.rfc.trim().toUpperCase(),
      codigoPostal: String(input.cliente.codigoPostal),
      regimenFiscal: input.cliente.regimenFiscal,
      email: String(input.cliente.email || "").trim()
    },
    usoCfdi: input.usoCfdi,
    formaPago: input.formaPago,
    metodoPago: input.metodoPago,
    aplicarIva: true,
    tasaIva: 0.16,
    moneda: "MXN",
    conceptos: t.detalles,
    subtotal: t.subtotal,
    impuestos: t.impuestos,
    total: t.total,
    estatus: "BORRADOR",
    creadaEn: new Date().toISOString()
  };
}

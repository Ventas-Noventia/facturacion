export function validarRfcBasico(rfc) {
  return /^[A-ZÑ&]{3,4}\d{6}[A-Z0-9]{3}$/.test(String(rfc || "").trim().toUpperCase());
}

const FORMAS_PAGO = new Set(["01","02","03","04","28","99"]);
const METODOS_PAGO = new Set(["PUE","PPD"]);
const TIPOS_PERSONA = new Set(["FISICA","MORAL"]);

export function validarDatosFactura(input) {
  const errores = [];
  const cliente = input?.cliente || {};

  if (!TIPOS_PERSONA.has(cliente.tipoPersona || "FISICA")) errores.push("Tipo de persona inválido");
  if (typeof cliente.razonSocial !== "string" || !cliente.razonSocial.trim()) errores.push("Falta nombre o razón social");
  if (!validarRfcBasico(cliente.rfc)) errores.push("RFC inválido");
  if (!/^\d{5}$/.test(String(cliente.codigoPostal || ""))) errores.push("Código postal inválido");
  if (!cliente.regimenFiscal) errores.push("Falta régimen fiscal");
  if (!input?.usoCfdi) errores.push("Falta uso CFDI");
  if (input?.aplicarIva === false || Number(input?.tasaIva ?? 0.16) !== 0.16) errores.push("La tasa de IVA permitida es 16%");

  if (!METODOS_PAGO.has(input?.metodoPago)) errores.push("Método de pago inválido");
  if (!FORMAS_PAGO.has(input?.formaPago)) errores.push("Forma de pago inválida");
  if (input?.metodoPago === "PPD" && input?.formaPago !== "99") {
    errores.push("Para PPD la forma de pago debe ser 99 - Por definir");
  }
  if (input?.metodoPago === "PUE" && input?.formaPago === "99") {
    errores.push("Para PUE debe seleccionarse la forma de pago real");
  }

  if (!Array.isArray(input?.conceptos) || input.conceptos.length === 0) {
    errores.push("Faltan conceptos");
  } else {
    input.conceptos.forEach((c, i) => {
      if (!c || typeof c !== "object" || Array.isArray(c)) { errores.push(`Concepto ${i+1} inválido`); return; }
      if (!String(c.descripcion || "").trim()) errores.push(`Falta descripción en concepto ${i+1}`);
      if (!String(c.unidad || "").trim()) errores.push(`Falta unidad en concepto ${i+1}`);
      if (!String(c.claveUnidad || "").trim()) errores.push(`Falta clave de unidad SAT en concepto ${i+1}`);
    });
  }

  return { valido: errores.length === 0, errores };
}

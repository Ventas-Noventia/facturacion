import { FacturamaError } from "./facturamaSandboxService.mjs";

const RFC = /^[A-ZÑ&]{3,4}\d{6}[A-Z0-9]{3}$/;
const NO_PRODUCTIVOS = new Set(["EKU9003173C9", "URE180429TM6", "XAXX010101000", "XEXX010101000"]);
export const rfcProductivo = rfc => RFC.test(String(rfc || "")) && !NO_PRODUCTIVOS.has(rfc);
export function errorProduccion(message, code = "PRODUCCION_DATOS_INVALIDOS", statusCode = 400) {
  const error = new FacturamaError(message, { statusCode }); error.code = code; return error;
}
export function validarEmisorProduccion(emisor, rfc) {
  if (!emisor || emisor.ambiente !== "PRODUCCION") throw errorProduccion("Guarda la configuración fiscal del emisor con ambiente Producción.", "PRODUCCION_EMISOR_PENDIENTE", 409);
  if (!rfcProductivo(emisor.rfc) || emisor.rfc !== rfc) throw errorProduccion("El RFC del emisor debe coincidir con FACTURAMA_PRODUCTION_RFC.");
  if (!String(emisor.razonSocial || "").trim() || !/^\d{3}$/.test(emisor.regimenFiscal || "") || !/^\d{5}$/.test(emisor.codigoPostal || "")) throw errorProduccion("Completa razón social exacta, régimen y código postal del emisor según su constancia fiscal.");
  if (!/^[A-Z0-9]{1,10}$/.test(emisor.serie || "") || emisor.serie === "NVSB") throw errorProduccion("Configura una serie propia de NOVENTIA de 1 a 10 letras o números, distinta de NVSB.");
  if (emisor.exportacion !== "01" || emisor.versionCfdi !== "4.0") throw errorProduccion("Esta integración utiliza CFDI 4.0, compras nacionales y exportación 01.");
  return emisor;
}

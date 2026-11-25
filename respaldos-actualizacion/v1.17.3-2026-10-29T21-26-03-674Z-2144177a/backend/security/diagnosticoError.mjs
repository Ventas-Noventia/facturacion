import { randomUUID } from "node:crypto";

export function diagnosticoError(error, etapa = "SOLICITUD", { log = console.error } = {}) {
  const statusCode = Number.isInteger(error?.statusCode) && error.statusCode >= 400 && error.statusCode <= 599 ? error.statusCode : 500;
  const code = /^(?:DATOS_FACTURA_INVALIDOS|FACTURA_DUPLICADA|SUPABASE_[0-9A-Z_]+|SANDBOX_[A-Z_]+)$/.test(String(error?.code || "")) ? error.code : "ERROR_INTERNO";
  const body = { error: error?.statusCode ? String(error.message) : "Ocurrió un error interno", codigo: code };
  if (statusCode >= 500 || error?.referencia) {
    body.referencia = randomUUID();
    body.error += ` Referencia: ${body.referencia}`;
    const match = String(error?.stack || "").match(/\/(backend|shared)\/([A-Za-z0-9_./-]+):(\d+):(\d+)/);
    log("Error de facturación:", JSON.stringify({ referencia: body.referencia, etapa: /^[A-Z_]{1,60}$/.test(etapa) ? etapa : "SOLICITUD", codigo: code,
      tipo: /^[A-Za-z]{1,60}$/.test(String(error?.name)) ? error.name : "Error",
      ...(match ? { archivo: `${match[1]}/${match[2]}`, linea: Number(match[3]) } : {}),
      ...(error?.dbCode && /^[0-9A-Z_]{1,12}$/.test(error.dbCode) ? { codigoSupabase: error.dbCode } : {}) }));
  }
  return { statusCode, body };
}

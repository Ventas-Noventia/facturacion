const safeCode = value => /^(?:[0-9A-Z]{5}|PGRST[0-9X]{3})$/.test(String(value || "")) ? String(value) : "SIN_CODIGO";
const COLUMNS = ["folio_origen", "folio_interno", "creada_en", "numero", "data", "id"];

// Remote messages/details can contain an entire failed invoice or credentials.
// Keep only the documented error code and a column from our own fixed schema.
export class SupabaseFacturaError extends Error {
  constructor({ code, status = 0, remoteMessage = "", network = false, invalidResponse = false } = {}) {
    const dbCode = safeCode(code);
    const column = ["42703", "PGRST204"].includes(dbCode)
      ? COLUMNS.find(name => new RegExp(`\\b${name}\\b`).test(String(remoteMessage))) : null;
    let message;
    if (network) message = "No se pudo confirmar la operación con Supabase. Revisa el Historial antes de volver a guardar.";
    else if (invalidResponse) message = "Supabase devolvió una respuesta no válida. Revisa el Historial antes de volver a guardar.";
    else if (["42703", "PGRST204"].includes(dbCode)) message = `Falta una columna de facturas en Supabase${column ? `: ${column}` : ""}. Revisa las migraciones de esta base.`;
    else if (["42P01", "PGRST205"].includes(dbCode)) message = "La tabla de facturas no está disponible en Supabase. Revisa el proyecto y su esquema.";
    else if (["42501", "PGRST301", "PGRST302", "PGRST303"].includes(dbCode) || [401, 403].includes(status)) message = "Supabase rechazó el acceso del servidor a las facturas. Revisa SUPABASE_URL y SUPABASE_SERVICE_ROLE_KEY.";
    else if (["23502", "23503", "23514", "22P02", "22007", "P0001"].includes(dbCode)) message = "Supabase rechazó el registro de la factura por una validación de la base de datos.";
    else message = "Supabase no pudo completar la operación de facturas. Revisa el código de diagnóstico.";
    const label = network ? "CONEXION" : invalidResponse ? "RESPUESTA_INVALIDA" : dbCode !== "SIN_CODIGO" ? dbCode : `HTTP_${Number(status) || 0}`;
    super(`${message} Código: ${label}.`);
    this.name = "SupabaseFacturaError";
    this.code = `SUPABASE_${label}`;
    this.statusCode = network ? 503 : 502;
    this.dbCode = dbCode;
    this.remoteStatus = Number(status) || 0;
    this.column = column || null;
    this.referencia = true;
  }
}

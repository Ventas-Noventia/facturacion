import { FacturamaSandboxService } from "../services/facturamaSandboxService.mjs";
import { FacturamaProduccionService } from "../services/facturamaProduccionService.mjs";

export function clienteFacturamaProduccion(environment = process.env, { permitirEmision = false } = {}) {
  return new FacturamaProduccionService({ username: environment.FACTURAMA_PRODUCTION_USERNAME, password: environment.FACTURAMA_PRODUCTION_PASSWORD,
    rfc: String(environment.FACTURAMA_PRODUCTION_RFC || "").trim().toUpperCase(), permitirEmision,
    baseUrl: environment.FACTURAMA_PRODUCTION_API_BASE_URL || "https://api.facturama.mx" });
}

export function configuracionTimbrado(environment = process.env) {
  const provider = String(environment.TIMBRADO_PROVIDER || "mock").trim();
  if (!["mock", "facturama_sandbox", "facturama_produccion"].includes(provider)) throw new Error("TIMBRADO_PROVIDER debe ser mock, facturama_sandbox o facturama_produccion.");
  const produccion = provider === "facturama_produccion", sandbox = provider === "facturama_sandbox";
  if (produccion && environment.FACTURAMA_PRODUCTION_ENABLED !== "true") throw new Error("Para activar producción configura FACTURAMA_PRODUCTION_ENABLED=true y revisa primero el emisor fiscal.");
  const clienteSandbox = sandbox || (produccion && environment.FACTURAMA_USERNAME && environment.FACTURAMA_PASSWORD)
    ? new FacturamaSandboxService({ username: environment.FACTURAMA_USERNAME, password: environment.FACTURAMA_PASSWORD, baseUrl: environment.FACTURAMA_API_BASE_URL || "https://apisandbox.facturama.mx" }) : null;
  const clienteProduccion = produccion || (environment.FACTURAMA_PRODUCTION_USERNAME && environment.FACTURAMA_PRODUCTION_PASSWORD && environment.FACTURAMA_PRODUCTION_RFC)
    ? clienteFacturamaProduccion(environment, { permitirEmision: produccion }) : null;
  return { provider, sandbox, produccion, clienteSandbox, clienteProduccion, cliente: produccion ? clienteProduccion : sandbox ? clienteSandbox : null,
    etiqueta: produccion ? "Facturama Producción · CFDI con validez fiscal" : sandbox ? "Facturama Sandbox · Sin validez fiscal" : "Simulación local" };
}

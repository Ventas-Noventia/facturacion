import { FacturamaSandboxService } from "../services/facturamaSandboxService.mjs";

export function configuracionTimbrado(environment = process.env) {
  const provider = String(environment.TIMBRADO_PROVIDER || "mock").trim();
  if (!["mock", "facturama_sandbox"].includes(provider)) throw new Error("TIMBRADO_PROVIDER debe ser mock o facturama_sandbox. Esta actualización todavía no habilita producción fiscal.");
  if (provider === "mock") return { provider, sandbox: false, etiqueta: "Simulación local", cliente: null };
  const cliente = new FacturamaSandboxService({ username: environment.FACTURAMA_USERNAME, password: environment.FACTURAMA_PASSWORD, baseUrl: environment.FACTURAMA_API_BASE_URL || "https://apisandbox.facturama.mx" });
  return { provider, sandbox: true, etiqueta: "Facturama Sandbox · Sin validez fiscal", cliente };
}

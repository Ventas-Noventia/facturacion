export class FacturaDuplicadaError extends Error {
  constructor() {
    super("Este pedido ya tiene una factura activa. Revisa el historial antes de volver a guardarlo.");
    this.name = "FacturaDuplicadaError";
    this.code = "FACTURA_DUPLICADA";
    this.statusCode = 409;
  }
}

export class PedidosService {
  constructor({ ecommerceService, firebaseService }) {
    this.ecommerceService = ecommerceService;
    this.firebaseService = firebaseService;
  }

  async obtenerPedido(folio) {
    const key = String(folio || "").trim().toUpperCase();
    if (!key) return null;

    if (key.startsWith("ORD-") || key.startsWith("WEB-") || /^[1-9]\d*$/.test(key)) return this.ecommerceService.obtenerPedido(key);
    if (key.startsWith("NV-") || key.startsWith("WA-") || key.startsWith("BAZ-") || key.startsWith("ALM-")) {
      return this.firebaseService.obtenerPedido(key);
    }

    const results = await Promise.allSettled([
      this.firebaseService.obtenerPedido(key), this.ecommerceService.obtenerPedido(key)
    ]);
    const found = results.find(result => result.status === "fulfilled" && result.value);
    if (found) return found.value;
    const failure = results.find(result => result.status === "rejected");
    if (failure) throw failure.reason;
    return null;
  }

  async marcarFacturado(pedido, factura) {
    if (!String(pedido?.fuente || "").startsWith("FIRESTORE_")) return null;
    return this.firebaseService.marcarFacturado(pedido, factura);
  }


  async desmarcarFacturado(pedido) {
    if (!String(pedido?.fuente || "").startsWith("FIRESTORE_")) return null;
    return this.firebaseService.desmarcarFacturado(pedido);
  }
}

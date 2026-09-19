export class PedidosService {
  constructor({ ecommerceService, firebaseService }) {
    this.ecommerceService = ecommerceService;
    this.firebaseService = firebaseService;
  }

  async obtenerPedido(folio) {
    const key = String(folio || "").trim().toUpperCase();
    if (!key) return null;

    if (key.startsWith("WEB-")) return this.ecommerceService.obtenerPedido(key);
    if (key.startsWith("WA-") || key.startsWith("BAZ-") || key.startsWith("ALM-")) {
      return this.firebaseService.obtenerPedido(key);
    }

    return (await this.firebaseService.obtenerPedido(key))
      || (await this.ecommerceService.obtenerPedido(key));
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

const permissions = {
  ADMIN: [
    "facturas:crear","facturas:timbrar","facturas:cancelar","facturas:ver","facturas:descargar",
    "catalogo:gestionar","facturas:enviar","usuarios:gestionar","clientes:gestionar","reportes:ver","auditoria:ver","config:ver","config:gestionar"
  ],
  FACTURACION: [
    "facturas:crear","facturas:timbrar","facturas:ver","facturas:descargar",
    "facturas:enviar","clientes:gestionar","reportes:ver"
  ],
  CONSULTA: [
    "facturas:ver","facturas:descargar","reportes:ver"
  ]
};

export class LocalAuthService {
  permissionsFor(role) {
    return permissions[String(role || "").toUpperCase()] || [];
  }
  can(role, permission) {
    return this.permissionsFor(role).includes(permission);
  }
}

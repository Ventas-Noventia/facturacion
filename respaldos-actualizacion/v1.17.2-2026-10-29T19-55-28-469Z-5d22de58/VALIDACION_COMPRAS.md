# Validación de una compra — v1.16.4

Usa primero el servidor local y un pedido de prueba que todavía no tenga factura
activa. Los archivos emitidos en esta versión son simulados, sin valor fiscal.
Conserva las variables de la API que ya funcionan.

## 1. Completar la protección de Supabase

Sigue el apartado de Supabase de `INSTRUCCIONES.txt`: primero la consulta de
revisión y después la migración 012. Si aparecen duplicados, revisa las facturas
antes de aplicar el índice. Esta entrega no modifica tu base de datos remota.

## 2. Comparar la venta

1. Abre `http://localhost:3000/login.html` con tu cuenta interna.
2. En Nueva factura busca el pedido por su ID numérico. Anota su folio completo.
3. Comprueba productos y cantidades contra la compra original. Verifica que el
   descuento del cupón se aplica una sola vez y el envío aparece como concepto.
4. Compara el total final: debe coincidir con la compra. El IVA del 16% se desglosa
   dentro del importe cobrado; no vuelve a sumarse encima del precio de venta.
5. Antes de guardar, busca también el folio completo: debe cargar la misma compra.

## 3. Guardar y descargar

1. Completa los datos fiscales y de pago. Guarda un solo borrador.
2. Abre Historial y verifica folio interno, pedido y total. Actualiza la página:
   debe continuar visible.
3. Ejecuta Timbrar en el ambiente actual de pruebas. La factura debe quedar como
   `TIMBRADA_MOCK`; el UUID comienza por `MOCK-`.
4. Descarga PDF y XML. Abre ambos y revisa receptor, conceptos y total. El PDF
   muestra que es un documento de prueba. Conserva los archivos de esta compra.
5. Reinicia el servidor y vuelve a descargar: deben ser los documentos guardados.
6. Para comprobar el portal, crea la solicitud desde una cuenta de cliente y
   revísala desde esa misma cuenta después del timbrado interno. Las facturas
   internas anteriores no se asignan automáticamente a una cuenta del portal.

## 4. Una factura activa por compra

- Busca otra vez tanto el ID como el folio del pedido: debe indicar que ya tiene
  factura y mostrar el folio interno cuando está disponible.
- Guardar de nuevo el mismo pedido debe devolver un conflicto, sin crear otra
  factura. El ID de la venta también protege si cambia el folio remoto.
- Un doble clic o una edición/eliminación mientras se timbra queda bloqueado
  dentro del mismo proceso de la aplicación.
- Si se cancela una factura de prueba, sus documentos originales se conservan.
  La política de los índices permite un reemplazo después de la cancelación.
  Esto no implementa la cancelación fiscal real ante un proveedor.

## 5. Criterio para continuar

Antes del siguiente paso, confirma: importes correctos, factura persistente,
PDF/XML disponibles y duplicado rechazado. Las pruebas automáticas comprueban
estos flujos con servicios simulados; esta revisión manual confirma tus cuentas,
la API y la base de datos configuradas.

## Siguiente etapa: proveedor de timbrado

No hace falta contratar uno para ejecutar esta validación. Al elegirlo,
integraremos primero su ambiente de pruebas y después el manejo seguro de sus
credenciales y certificados. Quedan pendientes el XML firmado original, UUID y
QR reales, cancelaciones con acuse y conciliación tras fallos de red. Antes de
emitir en producción también habrá que coordinar el timbrado entre instancias
para que un reintento no genere dos comprobantes fiscales.

Los borradores y documentos mock existentes conservan su identificación de
prueba. No se convierten automáticamente en facturas fiscales reales.

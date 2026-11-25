# Facturama Sandbox · actualización 1.17.6

## Corrección del historial

Esta versión corrige ReferenceError: can is not defined al mostrar una factura cancelada. Reutiliza el permiso de creación cargado en la sesión y protege también la acción Volver a cargar pedido. Después de actualizar, recarga y revisa el estado que ya guarda la factura; no es necesario solicitar otra cancelación para corregir la pantalla.

## Instalar

1. Detén el servidor con Ctrl+C.
2. Copia `instalar-noventia-v1.17.6.mjs` junto a `package.json` en tu proyecto.
3. Ejecuta `node ./instalar-noventia-v1.17.6.mjs .` y después `npm start`.
4. Confirma `v1.17.6 · facturama_sandbox` y recarga con Cmd+Shift+R.

Conserva tu .env y credenciales. El instalador respalda el código anterior y conserva datos, documentos y node_modules. No ejecuta SQL, no instala dependencias y no emite comprobantes. El paquete es acumulativo desde 1.15.2.

## Continuar una solicitud pendiente

En Historial, ubica la misma factura original. Si contiene la referencia auxiliar anterior, pulsa **Reintentar sin referencia auxiliar**. La prueba completa de la cuenta confirmó el timbrado al omitir `OrderNumber`; añadir ese campo con el UUID interno había reproducido HTTP 500.

- Requiere permisos de timbrado y estado REVISION_SANDBOX / POR_CONFIRMAR, sin UUID ni ID de Facturama confirmado.
- Verifica la solicitud y reclama su revisión antes de consultar Facturama. Si ya existe un comprobante verificable, recupera su UUID y archivos conservando la solicitud anterior y sin un POST nuevo.
- Si la consulta filtrada no tiene ningún resultado, verifica la elegibilidad y los importes actuales de la venta.
- Antes del POST, guarda la solicitud anterior completa y su huella en `timbradoSandbox.ajusteReferencia`, junto con la solicitud que omite únicamente `OrderNumber`. Conserva folio, fecha, serie, conceptos, importes y observaciones. El vínculo del pedido en el dashboard se conserva.
- Un fallo de consulta, coincidencia ambigua, solicitud o respaldo alterados, cambio de venta o conflicto de revisión impide el reenvío. Se verifica que las solicitudes difieran solo en esa referencia opcional no fiscal.
- Un nuevo error conserva ambas solicitudes para consultar el resultado. Si requiere otro reenvío explícito, **Reintentar envío original** utiliza exactamente la solicitud ajustada guardada.
- Un ID o UUID recibido se conserva y bloquea posteriores reenvíos; sus archivos se recuperan por consulta.

**Consultar resultado** y **Recuperar documentos** siguen siendo consultas GET al proveedor. El UUID del diagnóstico independiente no se asigna a la factura original. No crees otro borrador del mismo pedido.

Si un servidor se interrumpió mientras enviaba y el registro sigue TIMBRANDO_SANDBOX, consulta el resultado: el reenvío no libera una operación que podría seguir en curso en otra instancia.

## Una compra nueva

Busca un pedido disponible por ID o folio exacto, guarda el borrador y pulsa **Timbrar en Sandbox**. Las nuevas solicitudes omiten la referencia auxiliar `OrderNumber` y mantienen la referencia interna en las observaciones. Debe obtener un UUID y estado **Facturama · prueba**. Descarga XML y PDF: se conservan los archivos originales de Facturama. Si hay archivos pendientes, usa **Recuperar documentos**.

Las ventas se consultan individualmente; no se importan en bloque. Se mantienen sus importes históricos, descuentos y envío, con IVA del 16% desglosado dentro del importe cobrado. PUE requiere una forma de pago distinta de 99; PPD utiliza 99.

## Cancelar un comprobante de prueba

1. En Historial, selecciona **Cancelar en Sandbox** en una factura timbrada. La petición usa el motivo indicado; 01 requiere un UUID válido de otro comprobante sustituto ya emitido. Los demás motivos omiten completamente uuidReplacement.
2. El servidor guarda la solicitud, verifica la identidad remota y consulta primero el estado. Si ya está cancelada, recupera ese resultado. Si está vigente, envía una sola petición de cancelación y consulta después el estado remoto.
3. Una respuesta pendiente, desconocida, un error HTTP o un timeout mantiene el pedido bloqueado en CANCELACION_SANDBOX. Usa **Consultar cancelación**: esta operación es GET al proveedor y no repite el DELETE.
4. Solo después de verificar el estado cancelado se completa CANCELADA_SANDBOX. Para Firebase se libera primero la marca de esa misma factura en una transacción. Si falla, se conserva la confirmación y el pedido permanece bloqueado hasta completar la liberación con **Consultar cancelación**.
5. Descarga **Acuse PDF**. Los XML/PDF del comprobante original se conservan. Si la descarga del acuse falla, puede repetirse sin cancelar ni emitir otra vez.
6. **Volver a cargar pedido** vuelve a consultar la fuente y permite preparar una nueva solicitud si está disponible y es elegible. No genera una factura ni sustituye automáticamente un CFDI existente.

Un rechazo definitivo de la solicitud conserva vigente el comprobante y permite corregir el motivo. Una cancelación incierta que sigue vigente después de consultar requiere revisión; no se da por cancelada ni se libera el pedido. Las consultas comprueban la huella de la solicitud y su ID/UUID. El acuse requiere permisos de descarga; cancelar y consultar la cancelación requieren permiso de cancelación.

### Supabase: índice de pedidos activos

La nueva solicitud de un pedido cancelado requiere la migración ya existente `supabase/012_facturas_pedido_activo.sql`. Si tu base todavía conserva el índice anterior que bloquea también facturas canceladas, aplica ese archivo desde SQL Editor; no repitas schema.sql. La migración no elimina facturas: crea los índices de pedidos activos antes de retirar el índice anterior y se revierte si encuentra duplicados activos. El instalador no ejecuta SQL.

## Identidades y alcance

El dashboard utiliza emisor público EKU9003173C9 / ESCUELA KEMPER URGATE / 601 / CP 42501 y receptor URE180429TM6 / UNIVERSIDAD ROBOTICA ESPAÑOLA / 601 / CP 86991 / G03. Estos documentos de Sandbox no tienen validez fiscal. Los perfiles guardados de NOVENTIA y del cliente se conservan.

El cliente Sandbox solo admite https://apisandbox.facturama.mx y rechaza el host productivo. La activación independiente de producción se documenta en FACTURAMA_PRODUCCION.md. Las credenciales y los CSD de API Multiemisor son independientes de la configuración de sellos del portal web. Los documentos de Multiemisor se consultan por API/dashboard.

La activación de producción con CSD reales está disponible en v1.18.0 siguiendo FACTURAMA_PRODUCCION.md. La creación automática de CFDI sustitutos relacionados sigue pendiente. No se aplica la cancelación MOCK a documentos Sandbox ni se convierten documentos MOCK anteriores.

## Verificación

`npm test` usa API y almacenamiento simulados y no contacta cuentas reales. Incluye ajuste exclusivo de la referencia con respaldo antes del POST, recuperación del original si ya existe, conservación de solicitud antigua tras escrituras JSONB, consulta previa, concurrencia entre repositorios Supabase independientes, revisión antes del POST, permisos, fallos del proveedor y recuperación de archivos sin reemisión.

Documentación oficial:
- https://facturama.mx/docs/es/api-lite/cancelar-cfdi
- https://facturama.mx/docs/api-reference/endpoint/api-lite/post-api-lite4cfdis
- https://facturama.mx/docs/es/api-lite/crear-cfdi
- https://facturama.mx/docs/es/api-lite/consultar-cfdi
- https://facturama.mx/docs/es/cfdi40/idempotencia
- https://facturama.mx/docs/es/api-lite/cargar-csds

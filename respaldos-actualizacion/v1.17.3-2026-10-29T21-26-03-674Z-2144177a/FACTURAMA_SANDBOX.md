# Facturama Sandbox · actualización 1.17.3

## Instalar

1. Detén el servidor con Ctrl+C.
2. Copia `instalar-noventia-v1.17.3.mjs` junto a `package.json` en tu proyecto.
3. Ejecuta `node ./instalar-noventia-v1.17.3.mjs .` y después `npm start`.
4. Confirma `v1.17.3 · facturama_sandbox` y recarga con Cmd+Shift+R.

Conserva tu .env y credenciales. El instalador respalda el código anterior y conserva datos, documentos y node_modules. No ejecuta SQL, no instala dependencias y no emite comprobantes. El paquete es acumulativo desde 1.15.2.

## Continuar una solicitud pendiente

En Historial, ubica la factura original pendiente y pulsa **Reintentar envío original**. No crees otro borrador de ese mismo pedido.

- El botón requiere permisos de timbrado y estado REVISION_SANDBOX / POR_CONFIRMAR, sin UUID ni ID de Facturama confirmado.
- Primero reclama la revisión del registro y consulta el folio en Facturama. Si existe un comprobante verificable, recupera su UUID y archivos sin POST de emisión.
- Si la consulta filtrada no tiene ningún resultado, comprueba que la venta del e-commerce siga siendo facturable y que sus importes coincidan.
- Reenvía una vez la solicitud íntegra guardada, sin regenerar folio, fecha ni conceptos. Comprueba otra vez la revisión antes del POST.
- Un fallo de consulta, coincidencia ambigua, solicitud alterada, cambio de venta o conflicto de revisión impide el reenvío.
- Un nuevo error conserva la operación pendiente. Un ID o UUID recibido se conserva y bloquea posteriores reenvíos; sus archivos se recuperan por consulta.

Si vuelve a aparecer HTTP 500, revisa el POST en HTTP Logs de Facturama y conserva el registro. La actualización no asegura que el fallo remoto haya desaparecido ni cambia sus datos para intentar adivinar la causa.

**Consultar resultado** y **Recuperar documentos** siguen siendo consultas GET al proveedor; no reemiten. Si el servidor se interrumpió mientras enviaba y el registro sigue TIMBRANDO_SANDBOX, consulta el resultado: el reenvío no libera una operación que podría seguir en curso en otra instancia.

## Una compra nueva

Busca un pedido disponible por ID o folio exacto, guarda el borrador y pulsa **Timbrar en Sandbox**. Debe obtener un UUID y estado **Facturama · prueba**. Descarga XML y PDF: se conservan los archivos originales de Facturama. Si hay archivos pendientes, usa **Recuperar documentos**.

Las ventas se consultan individualmente; no se importan en bloque. Se mantienen sus importes históricos, descuentos y envío, con IVA del 16% desglosado dentro del importe cobrado. PUE requiere una forma de pago distinta de 99; PPD utiliza 99.

## Identidades y alcance

El dashboard utiliza emisor público EKU9003173C9 / ESCUELA KEMPER URGATE / 601 / CP 42501 y receptor URE180429TM6 / UNIVERSIDAD ROBOTICA ESPAÑOLA / 601 / CP 86991 / G03. Estos documentos de Sandbox no tienen validez fiscal. Los perfiles guardados de NOVENTIA y del cliente se conservan.

Solo admite https://apisandbox.facturama.mx y rechaza producción. Las credenciales y los CSD de API Multiemisor son independientes de la configuración de sellos del portal web. Los documentos de Multiemisor se consultan por API/dashboard.

La cancelación de Facturama y la activación de producción con los CSD reales quedan pendientes. No se aplica la cancelación MOCK a documentos Sandbox ni se convierten documentos MOCK anteriores.

## Verificación

`npm test` usa API y almacenamiento simulados y no contacta cuentas reales. Incluye conservación de solicitud antigua tras escrituras JSONB, consulta previa, concurrencia entre repositorios Supabase independientes, revisión antes del POST, permisos, fallos del proveedor y recuperación de archivos sin reemisión.

Documentación oficial:
- https://facturama.mx/docs/es/api-lite/crear-cfdi
- https://facturama.mx/docs/es/api-lite/consultar-cfdi
- https://facturama.mx/docs/es/cfdi40/idempotencia
- https://facturama.mx/docs/es/api-lite/cargar-csds

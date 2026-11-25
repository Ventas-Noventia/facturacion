# Facturama Sandbox · actualización 1.17.4

## Instalar

1. Detén el servidor con Ctrl+C.
2. Copia `instalar-noventia-v1.17.4.mjs` junto a `package.json` en tu proyecto.
3. Ejecuta `node ./instalar-noventia-v1.17.4.mjs .` y después `npm start`.
4. Confirma `v1.17.4 · facturama_sandbox` y recarga con Cmd+Shift+R.

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

## Identidades y alcance

El dashboard utiliza emisor público EKU9003173C9 / ESCUELA KEMPER URGATE / 601 / CP 42501 y receptor URE180429TM6 / UNIVERSIDAD ROBOTICA ESPAÑOLA / 601 / CP 86991 / G03. Estos documentos de Sandbox no tienen validez fiscal. Los perfiles guardados de NOVENTIA y del cliente se conservan.

Solo admite https://apisandbox.facturama.mx y rechaza producción. Las credenciales y los CSD de API Multiemisor son independientes de la configuración de sellos del portal web. Los documentos de Multiemisor se consultan por API/dashboard.

La cancelación de Facturama y la activación de producción con los CSD reales quedan pendientes. No se aplica la cancelación MOCK a documentos Sandbox ni se convierten documentos MOCK anteriores.

## Verificación

`npm test` usa API y almacenamiento simulados y no contacta cuentas reales. Incluye ajuste exclusivo de la referencia con respaldo antes del POST, recuperación del original si ya existe, conservación de solicitud antigua tras escrituras JSONB, consulta previa, concurrencia entre repositorios Supabase independientes, revisión antes del POST, permisos, fallos del proveedor y recuperación de archivos sin reemisión.

Documentación oficial:
- https://facturama.mx/docs/api-reference/endpoint/api-lite/post-api-lite4cfdis
- https://facturama.mx/docs/es/api-lite/crear-cfdi
- https://facturama.mx/docs/es/api-lite/consultar-cfdi
- https://facturama.mx/docs/es/cfdi40/idempotencia
- https://facturama.mx/docs/es/api-lite/cargar-csds

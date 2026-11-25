# Facturama Sandbox · actualización 1.17.1

Requiere el acceso Sandbox y el CSD público EKU9003173C9 que ya se verificaron con `preparar-facturama.mjs`. Esta actualización conecta el botón del dashboard a API Multiemisor v4 de Facturama.

## Instalar en tu proyecto existente

1. Detén `npm start` con Ctrl+C.
2. Copia el NUEVO `instalar.mjs` junto al `package.json` de tu proyecto. Sustituye el instalador anterior si existe.
3. En una Terminal abierta en esa carpeta ejecuta `node ./instalar.mjs .`.
4. Conserva tu `.env` y las variables `FACTURAMA_USERNAME` y `FACTURAMA_PASSWORD` ya verificadas. Agrega o actualiza una sola línea: `TIMBRADO_PROVIDER=facturama_sandbox`.
5. Ejecuta `npm start` y recarga el dashboard.

No hay dependencias nuevas. El instalador hace un respaldo y no modifica `.env`, credenciales de Firebase, datos, documentos ni `node_modules`. No ejecuta SQL. Si ya instalaste las migraciones hasta 012, no las repitas para esta actualización. El ZIP es acumulativo desde la versión 1.15.2.

## Primera compra de prueba

1. Debe aparecer el aviso **Facturama Sandbox · Sin validez fiscal**.
2. Busca un pedido que todavía no tenga factura activa. Crea y guarda su borrador con la forma de pago correspondiente. Los pedidos de la API siguen consultándose por ID o folio exacto; no se importan ventas en bloque.
3. En **Historial**, pulsa **Timbrar en Sandbox** sobre el borrador.
4. Espera el estado **Facturama · prueba** (`TIMBRADA_SANDBOX`) y un UUID sin el prefijo MOCK.
5. Descarga XML y PDF. Son los documentos originales recibidos de Facturama; el sistema no reconstruye el XML ni reemplaza el PDF con uno simulado.

Si el pedido ya tiene un documento `TIMBRADA_MOCK`, ese documento se conserva como histórico: la prueba nueva requiere otro pedido disponible. Los documentos anteriores no se convierten automáticamente.

## Identidades de prueba

El XML y el PDF de esta fase usan emisor **EKU9003173C9 / ESCUELA KEMPER URGATE / régimen 601 / CP 42501** y receptor **URE180429TM6 / UNIVERSIDAD ROBOTICA ESPAÑOLA / régimen 601 / CP 86991 / uso G03**. La información fiscal original del cliente y la configuración de NOVENTIA permanecen guardadas en la aplicación. El aviso del dashboard y de la vista previa explica la diferencia.

Se conservan los conceptos y los importes del pedido, incluidos el cupón y el envío. El IVA del 16% se desglosa dentro del importe de la venta; no se añade otra vez. Para PUE se requiere una forma de pago distinta de 99; para PPD se utiliza 99.

## Recuperación de una operación

- **Documentos pendientes:** Facturama ya confirmó el UUID. Pulsa **Recuperar documentos**. Se vuelven a consultar los archivos del mismo identificador; no se emite un CFDI nuevo.
- **Resultado por confirmar / Consultando Sandbox:** pulsa **Consultar resultado**. El servidor busca únicamente el folio de esa operación y comprueba emisor, serie y fecha. Una operación enviada no vuelve a emitir mediante POST, incluso después de reiniciar.
- **Sin coincidencias todavía:** espera y consulta de nuevo. El registro permanece bloqueado para impedir duplicados. Si el proveedor nunca confirma el resultado, se necesita revisar esa operación en Http Logs; esta versión no adivina que haya fallado ni crea otra automáticamente.
- **Rechazo de datos o accesos:** el borrador vuelve a quedar editable. El mensaje no expone credenciales ni respuestas completas del proveedor. Los detalles de validación pueden revisarse en Http Logs de Facturama.

Guarda el UUID, el folio interno y el identificador de Facturama si necesitas revisar un caso. No compartas la contraseña, la cabecera Authorization ni los datos privados de otros clientes.

## Alcance de esta versión

Solo permite `https://apisandbox.facturama.mx`; rechaza la URL de producción. `TIMBRADO_PROVIDER=mock` mantiene el comportamiento simulado anterior. En Sandbox las facturas Multiemisor no aparecen en el portal web de Facturama: se consultan y descargan desde este dashboard/API.

La cancelación de Facturama queda pendiente para una siguiente etapa. El servidor impide aplicar la cancelación MOCK a un comprobante Sandbox. La producción con el RFC y los CSD reales de NOVENTIA también queda pendiente.

Las solicitudes y sus estados se guardan en la columna JSON existente de Supabase. Las escrituras comparan estado y revisión para que dos procesos no envíen simultáneamente el mismo borrador. El repositorio JSON local conserva su uso de desarrollo con un solo proceso.

## Verificación del paquete

`npm test` prueba las reglas de importes, permisos, documentos, concurrencia y recuperación con servicios simulados. No utiliza tus credenciales ni contacta cuentas reales. La primera emisión con tu cuenta se comprueba siguiendo los pasos del dashboard anteriores.

Documentación oficial consultada:

- https://facturama.mx/docs/es/api-lite/crear-cfdi
- https://facturama.mx/docs/es/api-lite/consultar-cfdi
- https://facturama.mx/docs/es/cfdi40/idempotencia
- https://facturama.mx/docs/es/catalogos/csds-pruebas
- https://facturama.mx/docs/es/guias/autenticacion


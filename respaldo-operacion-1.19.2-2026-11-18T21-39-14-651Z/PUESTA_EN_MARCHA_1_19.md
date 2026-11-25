# Corrección 1.19.2 · Diagnóstico del correo

El envío de un CFDI real usa exclusivamente sus credenciales de producción. Se separaron los errores de variables ausentes, formato inválido y metadatos de ambientes incompatibles. La comprobación se hace antes de escribir ENVIANDO; una validación local fallida no se registra como envío incierto.

Instala actualizar-operacion-1.19.2.mjs sobre la raíz de tu proyecto, reinicia el servidor y comprueba que arranca como v1.19.2. No requiere otro SQL ni cambios de credenciales. Reintenta el correo de la misma factura existente. Si se detiene, comparte solo el mensaje nuevo que indique ambiente y nombre de variable, nunca su valor. No se reemite ni se cambia el ambiente de facturas guardadas.

# Corrección 1.19.2 · Error al recordar SAT

Los errores del catálogo ahora conservan el código seguro de Supabase y distinguen tabla ausente, columnas incompatibles, permisos, restricciones y conexión. No se puede determinar cuál fue el rechazo previo solo a partir de ERROR_INTERNO.

Si no has ejecutado SQL 013: abre Supabase, entra al proyecto configurado en tu servidor, SQL Editor → New query, pega el contenido de supabase/013_productos_fiscales.sql y pulsa Run. Luego vuelve a pulsar Recordar SAT por SKU. La tabla se crea sin modificar pedidos ni facturas.

Si ya lo ejecutaste y persiste: instala esta corrección y comparte únicamente el nuevo código SUPABASE_CATALOGO_... que aparezca. No compartas .env ni credenciales.

# Noventia · Operación de facturación 1.19.2

## Instalar esta actualización

1. Detén el servidor actual. Guarda tu respaldo habitual.
2. Copia `actualizar-operacion-1.19.2.mjs` a la raíz de tu proyecto actual, donde están `package.json` y `backend/server.mjs`.
3. Ejecuta `node actualizar-operacion-1.19.2.mjs`. Crea un respaldo de los archivos de código que sustituye. No modifica `.env`, credenciales, `backend/data`, `backend/storage` ni dependencias. No ejecuta migraciones ni emite ni envía nada.
4. Si usas Supabase (como la configuración actual), ejecuta **una vez** `supabase/013_productos_fiscales.sql` en su SQL Editor. El instalador deja ese archivo dentro de tu proyecto. Crea la tabla y sus permisos; no modifica facturas ni pedidos. Si no se ha aplicado, el catálogo muestra un aviso y la búsqueda conserva el comportamiento anterior.
5. Inicia con `npm start` y recarga con **Cmd+Shift+R** o **Ctrl+Shift+R**. `/api/health` debe indicar `1.19.2`.

No ejecutes después los instaladores antiguos. Si sustituyes el proyecto completo, conserva tu configuración, credenciales y datos propios; no uses los datos de ejemplo del paquete como reemplazo de tus datos.

## Productos y claves SAT

- Un administrador abre **Productos y claves SAT**, captura SKU, título, clave SAT y unidad, y guarda.
- El catálogo de Supabase es compartido y persistente. En modo local se usa `backend/data/productos-fiscales.json`, que requiere disco persistente.
- Los pedidos siguientes cargan los datos por SKU en todas las fuentes: API, WhatsApp y almacén. No cambia precios, cantidades, descuentos, existencias ni total.
- La clasificación guardada por el administrador tiene prioridad sobre la sugerencia de la API. Los borradores y comprobantes ya existentes no se reescriben. Vuelve a buscar el pedido para actualizar sus datos; si ya hay un borrador, revísalo antes de reemplazarlo y nunca dupliques una factura timbrada.
- En **Nueva factura**, guarda los cambios del concepto y pulsa **Recordar SAT por SKU**. Si el API solo entrega características, registra el título correcto en el catálogo: no se puede recuperar un campo que el proveedor no envía.
- Administración puede editar e importar; consulta y facturación pueden leer. El servidor aplica los permisos aunque se manipule la interfaz.
- La validación comprueba formato, no que la clave exista/vigente ni que corresponda al producto. Revisa la clasificación con el catálogo oficial o tu responsable fiscal.

### Carga masiva desde Excel

Descarga **Plantilla CSV**, llena las columnas `sku,titulo,claveProdServSat,claveUnidad,unidad` y guarda como **CSV UTF-8** desde Excel. Mantén SKU como texto para conservar ceros iniciales. Se aceptan comas o punto y coma y campos entre comillas. Los archivos `.xlsx` no se importan directamente en esta versión.

Carga el archivo: el sistema valida todo el lote, rechaza SKU repetidos y muestra hasta 10 filas como vista previa. **Guardar lote revisado** actualiza los SKU existentes y agrega los nuevos. Máximo 500 filas y 1 MB por archivo; divide catálogos mayores. Exportar CSV descarga el catálogo completo y permite conservar una copia antes de actualizar.

## Correo XML y PDF

Se implementó el servicio nativo de Facturama Multiemisor. No necesita SMTP ni Gmail. Sigue deshabilitado por defecto.

Para habilitar el botón de envío, añade a tu entorno:

```dotenv
FACTURAMA_EMAIL_ENABLED=true
```

Conserva los accesos existentes de Facturama para el ambiente correspondiente y reinicia. Esta variable habilita envíos **manuales**, no envíos automáticos al timbrar.

Desde Historial, **Enviar XML y PDF** muestra el destinatario y pide confirmación. Solo admite comprobantes timbrados con UUID e ID confirmado, sin cancelación en curso; los borradores y MOCK se rechazan. Una factura Sandbox sigue enviándose por Sandbox y se identifica como prueba. Nunca uses correos de clientes reales durante las pruebas.

Facturama manda el mensaje desde su servicio; el remitente y diseño no se personalizan desde este desarrollo. No se usa la plantilla promocional de Noventia ni se agrega publicidad al CFDI.

Se guarda el último resultado y cada intento queda en bitácora:

- **ACEPTADO_PROVEEDOR**: Facturama respondió `success: true`; no confirma entrega, lectura ni bandeja de entrada.
- **POR_CONFIRMAR**: respuesta fallida, negativa o incierta. Revisa antes de reenviar.
- **ENVIANDO**: una operación ya tomó el envío; otro clic se bloquea. Si el servidor se interrumpió, espera al menos dos minutos, verifica el proveedor y confirma expresamente el reenvío. Un reenvío puede duplicar el correo.

No se reenviará automáticamente tras un error. El envío no crea otro CFDI ni altera XML, UUID o importes.

Referencia oficial: https://facturama.elevio.help/en/articles/137-sending-an-invoice-created-in-multi-issuer-api-via-email

## Logo opcional

La API Multiemisor acepta `LogoUrl` para la representación PDF. Se dejó preparado mediante una variable opcional:

```dotenv
FACTURAMA_LOGO_URL=https://tu-dominio.com/logo-noventia.png
```

Usa una imagen PNG/JPG pública por HTTPS, sin parámetros ni autenticación. No se configuró una URL inventada ni se publicó tu logo. Si dejas la variable vacía, se conserva el PDF normal de Facturama. Antes de usarlo en producción comprueba un PDF Sandbox. La URL se incorpora solo al preparar una emisión nueva; los reintentos conservan exactamente la solicitud original guardada. No se reemiten facturas anteriores para cambiar su logo.

Referencia oficial: https://facturama.mx/docs/es/api-lite/crear-cfdi

## Preparación y prueba final

En **Configuración → Revisar pendientes** puedes revisar disponibilidad del catálogo, ambiente, habilitación del correo, tipo de almacenamiento y operaciones/documentos pendientes. El contador consulta hasta 500 registros; no sustituye una conciliación completa ni garantiza que el bucket esté respaldado.

El botón existente **Verificar cuenta, CSD y emisor de producción** consulta los accesos, folios y CSD sin emitir. Mantén producción desactivada hasta terminar las pruebas. No se cambiaron tus variables de ambiente ni se contactaron tus cuentas reales en esta entrega.

Prueba con una compra conocida:

1. Busca ID y folio; confirma título, clave SAT, cantidades y total contra el origen.
2. Guarda la clasificación por SKU y busca otro pedido con ese SKU. Debe reutilizarse, también después de reiniciar.
3. Guarda un borrador Sandbox, timbra y descarga PDF/XML. Comprueba descuento y envío una sola vez e IVA dentro del importe cobrado.
4. Habilita correo, usa tu propia dirección de prueba y verifica ambos adjuntos. Revisa la bitácora y el estado.
5. Verifica que otra solicitud para la misma compra esté bloqueada y conserva una prueba de cancelación/recuperación en Sandbox.
6. Confirma cuenta, CSD, emisor, folios y almacenamiento productivos. La emisión real consume un folio y requiere la confirmación existente del dashboard.

## Respaldo operativo y recuperación

Con la aplicación sin escrituras, ejecuta desde tu proyecto:

```sh
node respaldar-facturas.mjs
```

Genera una carpeta nueva bajo `respaldos-operacion`, con registros de facturas, catálogo, XML/PDF y un manifiesto con hashes SHA-256. No incluye `.env`, contraseñas ni CSD. Es información privada de clientes: conserva la carpeta fuera de una ruta pública y copia el respaldo a un destino protegido externo.

**Es un respaldo operativo, no una copia integral de Supabase.** No incluye Auth, bitácora, acuses ni todos los catálogos. Conserva además un respaldo de la base de datos y del bucket desde tus herramientas de administración. Se informa cualquier documento faltante o descarga fallida y el proceso termina con código 1 si hay incidencias; revisa `manifest.json`.

Para recuperar, prueba primero en una copia aislada: comprueba los hashes, importa el catálogo mediante su CSV y recupera registros/documentos con ayuda del administrador de la base de datos, respetando IDs, UUID y reservas de pedidos. No uses la restauración como motivo para volver a timbrar. Este paquete no ejecuta restauraciones ni sobrescribe tu base remota.

## Alcance pendiente por configuración o una etapa posterior

- Aplicar SQL 013 y clasificar el catálogo real.
- Validar los campos del API privado con una compra real; no se tuvo una respuesta privada actual para inspeccionarla.
- Probar envío y logo con tus cuentas, confirmar CSD/folios, revisar bucket y realizar una recuperación controlada.
- Factura global, PPD/complementos, notas de crédito y emisión automática de sustitutos continúan fuera del alcance. La operación actual está diseñada para factura individual, MXN, IVA 16% y pago completo PUE.

Las pruebas de esta entrega usan servicios simulados; no emitieron CFDI reales ni enviaron correos externos. La interfaz se comprobó con pruebas funcionales del código; no fue posible ejecutar la revisión visual en Chromium dentro de este entorno.

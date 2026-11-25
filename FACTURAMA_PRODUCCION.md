# NOVENTIA · Facturama Producción · v1.18.0

Esta actualización conecta el dashboard con la API Multiemisor productiva de Facturama. La instalación no activa emisiones ni usa folios. Conserva el flujo Sandbox de las versiones anteriores, su historial y sus archivos. No convierte facturas de prueba en facturas fiscales.

## 1. Instalar en tu proyecto existente

Detén el servidor que usa el puerto 3000 con Ctrl+C. Descomprime el paquete descargado. Desde tu proyecto ejecuta el instalador incluido (también puedes descargarlo por separado):

```sh
cd "/Users/papu/Documents/Noventia/DashboardFacturacion/facturacion-dinamica-v1.11.1"
node ~/Downloads/actualizacion-acumulada-noventia-v1.18.0/instalar-noventia-v1.18.0.mjs .
npm start
```

Si descargaste solamente el instalador, usa `node ~/Downloads/instalar-noventia-v1.18.0.mjs .`. Puedes arrastrar el archivo descargado a la terminal después de escribir `node ` y agregar ` .` al final. El destino es tu proyecto existente, la carpeta que contiene package.json y backend/server.mjs, no la carpeta del paquete.

El instalador es acumulativo desde 1.15.2. Respalda los archivos reemplazados en respaldos-actualizacion y conserva .env, credenciales, backend/data, backend/storage y node_modules. No ejecuta SQL ni instala dependencias. El proyecto sigue usando la misma carpeta aunque se llame v1.11.1. Node mínimo: 22.18.0. `npm start` activa los certificados del sistema con `--use-system-ca`; se conserva la verificación HTTPS. El módulo TLS se precarga para evitar el problema de inicialización de Node 22.18.0 al inspeccionar el CSD.

Si aparece EADDRINUSE, detén el servidor anterior antes de iniciar el nuevo. Recarga el navegador con Cmd+Shift+R. /api/health debe indicar version 1.18.0 y el PAC que ya tenías configurado; todavía puede ser facturama_sandbox.

## 2. Verificar sin emitir

Conserva las variables que ya usaste para registrar el CSD:

```dotenv
FACTURAMA_PRODUCTION_USERNAME=TU_USUARIO_PRODUCTIVO
FACTURAMA_PRODUCTION_PASSWORD="TU_PASSWORD_PRODUCTIVO"
FACTURAMA_PRODUCTION_RFC=TU_RFC_REAL
```

No compartas estas claves ni tu .env. No dupliques definiciones: el cargador existente utiliza la primera definición y respeta las variables exportadas por la terminal. En Render se configuran también en Environment del servicio; tu .env local no cambia Render.

Mantén por ahora `TIMBRADO_PROVIDER=facturama_sandbox` y `FACTURAMA_PRODUCTION_ENABLED=false`. Conserva FACTURAMA_USERNAME/PASSWORD de Sandbox para gestionar pruebas archivadas. El host productivo es fijo https://api.facturama.mx; FACTURAMA_API_BASE_URL sigue perteneciendo a Sandbox. El dashboard no necesita acceso a tu .key, su contraseña ni sus rutas. No vuelvas a registrar el sello que ya fue confirmado.

En **Configuración fiscal**, guarda el nombre o razón social exacta, RFC del CSD registrado, régimen fiscal y CP de expedición según la constancia fiscal de NOVENTIA. Configura CFDI 4.0, exportación 01 y una serie propia (por ejemplo NV, de 1 a 10 letras mayúsculas/números, distinta de NVSB). Selecciona **Producción** en ese formulario y guarda. Esto prepara el emisor; no cambia el modo del servidor ni emite nada.

Pulsa **Verificar cuenta, CSD y emisor de producción** con una cuenta administradora. La consulta comprueba plan API con folios y vigencia, certificado público registrado con RFC/usos de CSD/vigencia, y coincidencia del emisor guardado. Solo hace GET a Facturama; no registra certificados ni emite CFDI. No muestra certificados, contraseñas ni llaves. Corrige cualquier pendiente antes de activar.

## 3. Activar la emisión real

Una vez verificado el punto anterior, cambia las definiciones existentes en tu .env (o en Environment de Render):

```dotenv
TIMBRADO_PROVIDER=facturama_produccion
FACTURAMA_PRODUCTION_ENABLED=true
```

Reinicia el servidor. /api/health debe mostrar `"version":"1.18.0"` y `"pac":"facturama_produccion"`. El aviso del dashboard indicará **Producción · Emite CFDI reales**. Repite la verificación de cuenta y emisor: debe mostrar emisión real habilitada. Cambiar únicamente el selector fiscal o únicamente una variable no activa producción.

## 4. Emitir una compra real

Busca una compra pagada por ID o folio exacto del e-commerce, NV/WA en solicitudes_whatsapp o BAZ/ALM en surtidos. El dashboard consulta las tres fuentes individualmente. Revisa el nombre fiscal exacto, RFC, régimen, CP y uso CFDI del cliente según su constancia. Selecciona la forma de pago con la que realmente se liquidó la compra y PUE.

En cada concepto pulsa Editar, captura la clave de producto/servicio SAT que corresponda (8 dígitos, también en envío), revisa su unidad SAT y guarda el concepto. No se asigna 01010101 automáticamente en producción. Esa clave solo se enviará si el operador la captura expresamente y corresponde a su clasificación; Facturama/SAT realiza la validación fiscal final. Conserva precios, cantidades y descuentos del pedido; el servidor ignora cambios económicos enviados por el navegador.

Guarda un **borrador nuevo de Producción** y, desde Historial, pulsa **Emitir CFDI real**. La confirmación muestra pedido, RFC y total antes del envío. La emisión consume un folio y tiene validez fiscal. Confirma el UUID y descarga XML/PDF originales del proveedor.

Alcance de esta etapa: CFDI de ingreso individual de una compra nacional en MXN, IVA 16% y pago completo PUE a un receptor con RFC propio. No incluye factura global/RFC genéricos, exportaciones, PPD/complementos de pago ni emisión automática de sustitutos relacionados. La cancelación motivo 01 requiere un UUID sustituto de otro comprobante ya emitido; el dashboard no crea ese CFDI relacionado automáticamente.

Los importes históricos ya incluyen IVA: se desglosa dentro del total cobrado, no se suma otra vez. En la API se aplica una sola vez el cupón del pedido; las promociones del artículo ya vienen en unit_price. Firebase utiliza el precio histórico de la línea después de su promoción y agrega el envío cuando corresponde. El estado PAGADO indica liquidación; montoApartado es solo el apartado y no se interpreta como registro completo de todos los pagos. Un saldoPendiente explícito positivo o importes inconsistentes bloquean la emisión y requieren revisión en el origen. Nunca se cambia el estado de pago desde facturación.

Antes de emitir o reenviar se vuelve a leer la compra, se exige que siga pagada/elegible y se comparan identidad, conceptos e importes con el borrador. La reserva de Firebase comprueba en una transacción quién posee la marca. La unicidad de compra activa se conserva en todos los ambientes.

## 5. Resultados inciertos y cancelación

Un HTTP 500 o timeout no prueba que no se emitió. Conserva el registro y utiliza **Consultar resultado real**. Es una consulta GET. La solicitud original, su huella, folio, serie y fecha quedan guardados antes del POST. Nunca borres ni reinicies una operación incierta.

**Revisar y reintentar envío real** solo está disponible sin ID/UUID confirmado y después de una respuesta incierta. Reclama la revisión mediante escritura condicional; exige una consulta completa sin coincidencias, revisa nuevamente compra, emisor y CSD y reenvía exactamente la solicitud guardada. Un fallo de consulta, coincidencia ambigua, modificación de la solicitud, cambio de compra/emisor o conflicto de revisión impide el POST. Si ya existe, recupera el mismo resultado. No hay reintentos POST automáticos. Una operación interrumpida mientras enviaba se consulta; no se libera por suponer que no llegó.

Un fallo al descargar o guardar PDF/XML conserva el ID y UUID confirmados. Usa **Recuperar documentos reales**; no emitas otra factura ni uses los UUID de diagnósticos independientes. El XML se comprueba contra los identificadores y total guardados; esta comprobación no sustituye la validación completa de esquema, cadena y firmas del SAT.

**Cancelar CFDI real** guarda motivo y UUID sustituto si corresponde, verifica el comprobante y envía una sola cancelación. Los motivos 02/03/04 no envían uuidReplacement. Una cancelación pendiente o incierta conserva el pedido bloqueado; **Consultar cancelación real** solo consulta. Solo la cancelación remota verificada libera la compra. Si falla la liberación de Firebase, queda pendiente hasta completarla por consulta y nunca sobrescribe la marca de otra factura. El **Acuse PDF** y los archivos originales se conservan. La aceptación en producción puede tardar.

La migración supabase/012_facturas_pedido_activo.sql ya usada para volver a facturar después de cancelar sigue siendo necesaria; esta versión no agrega SQL. No repitas schema.sql. Una factura Sandbox activa también bloquea otra solicitud de la misma compra: cancélala y confirma su liberación antes de crear un borrador real. Un borrador de pruebas se elimina desde el dashboard y se vuelve a preparar; no se convierte ni se edita su ambiente.

El historial permite consultar documentos anteriores con el proveedor de su ambiente original. Los reportes en producción muestran por defecto solo registros de Producción; el selector Ambiente permite revisar pruebas o todos. No sumes pruebas como ingresos fiscales reales.

## Verificación del código

`npm test` ejecuta pruebas con APIs y almacenamiento simulados. La suite cubre credenciales/ambientes separados, datos fiscales y claves SAT, importes históricos, CSD, pedido vigente, reserva y liberación Firebase, escritura condicional, recuperación sin duplicación, reenvío inmutable, permisos, cancelaciones, documentos y reportes. No contacta cuentas reales ni emite CFDI reales. La primera emisión real se realiza de forma explícita desde el dashboard después de instalar y configurar.

Documentación oficial:
- https://facturama.mx/docs/es/api-lite/crear-cfdi
- https://facturama.mx/docs/es/api-lite/consultar-cfdi
- https://facturama.mx/docs/es/api-lite/cancelar-cfdi

# Integración de las tres fuentes de venta

La búsqueda de pedidos usa `surtidos` y `solicitudes_whatsapp` de Firebase y la
API del e-commerce. `NV-`, `WA-`, `BAZ-` y `ALM-` consultan Firebase; `ORD-`,
`WEB-` e identificadores numéricos consultan el e-commerce. Para otros formatos
se consultan ambas fuentes sin que un error oculte un resultado válido de la otra.

## Configuración del servidor

Agrega las cuatro variables de `.env.ecommerce.example` a Render o al `.env`
local del backend. El inicio de la aplicación y las consultas Firebase no
dependen de que el e-commerce esté configurado. Para consultar la API sí hacen
falta su URL base HTTPS, usuario y contraseña. No se guardan en Supabase ni se
envían al navegador. El token vive solamente en memoria del servidor.

La documentación facilitada se encuentra en:
http://movier.8ijle1ujzl-xmz4q7op162o.p.temp-site.link/developers/api/facturacion

Conserva la dirección HTTPS y las credenciales que ya funcionan en tu servidor.
No agregues credenciales ni parámetros de búsqueda a la URL base. El cliente
mantiene la validación TLS y no permite enviar la contraseña por HTTP.

Para completar la protección de duplicados entre servidores, revisa primero
`supabase/revisar_duplicados_pedidos.sql` y aplica después
`supabase/012_facturas_pedido_activo.sql`. Esta última incluye la protección por
ID de la versión 008 y sustituye el índice antiguo de folio por uno de facturas
activas. No repitas las migraciones antiguas ni `schema.sql`. Ninguno de estos
scripts ha sido ejecutado contra tu base de datos por esta actualización.

## Contrato implementado

- `POST {base}/auth/token`: JSON con `username` y `password`.
- Respuesta: `access_token`, `token_type: Bearer`, `expires_in: 3600`.
- `GET {base}/orders?order_number=...`: busca el folio completo sin limitarlo
  a los últimos 30 días y sin filtrar ventas que no solicitaron factura.
- `GET {base}/orders/{id}`: carga el detalle por el ID del listado.
- `Authorization: Bearer ...` y `Accept: application/json` en cada consulta.

Se reutiliza el token, se renueva 30 segundos antes de vencer y se permite una
renovación ante 401 de una consulta. Las consultas simultáneas comparten la
petición del token. Se reintentan de forma limitada 429, 500 y 503, respetando
`Retry-After`; una espera larga se devuelve al operador sin crear un bucle.
No se siguen redirecciones, ni enlaces de paginación hacia otro servidor.

## Importes y revisión

Se conservan los precios históricos, los totales originales, el descuento del
pedido y el ID de la venta. El precio de un artículo ya contiene sus promociones.
Únicamente el cupón de `totals.discount` se reparte entre artículos para preparar
los conceptos; ese reparto pertenece al facturador, no a la respuesta de la API.
El envío se agrega como concepto separado. No se restan reembolsos para inventar
un saldo facturable.

Esta entrega conserva la regla existente del proyecto: IVA 16% desglosado dentro
del importe final cobrado. Se usan enteros para centavos y cálculos decimales de
seis posiciones para evitar que el ejemplo de $1,449.00 cambie por redondeos.
Las claves SAT no proceden de la API: las unidades siguen los valores de captura
del facturador y requieren revisión fiscal. No se inventa una clave de producto
del SAT a partir del SKU.

Una venta `review_required`, con reembolso, artículo retirado, ausencia de datos
históricos o importes inconsistentes se puede consultar, pero no se factura
automáticamente. El backend vuelve a consultar y validar el detalle antes de
guardar, editar o timbrar el borrador. Los importes históricos no se sustituyen
con valores del navegador. También se comprueba que el borrador conserve el
importe de la venta al timbrarlo.

El e-commerce tiene solo consultas: el facturador no intenta marcar pedidos
allí. Los flujos existentes de marcado en Firebase se conservan.

## Comprobación

Ejecuta `npm test`. Las pruebas usan respuestas simuladas del contrato público,
incluidos sus escenarios A, B y C. No usan credenciales ni ventas reales.
Después de configurar HTTPS y credenciales, busca un folio real `ORD-...` en el
facturador y compara el total, cupón, envío y productos con la venta de origen.

El timbrado del proyecto sigue siendo MOCK. Esta integración de ventas no
habilita un PAC real ni convierte los documentos de prueba en CFDI timbrados.

## Prueba en Postman

Importa los dos JSON de `postman/` y selecciona el entorno NOVENTIA. Configura
`base_url` con la URL HTTPS confirmada, `api_username`, `api_password` y un
`order_number` real. Ejecuta las tres peticiones en orden. La primera guarda
el token y su vencimiento en el entorno; la segunda guarda `order_id` y la
tercera obtiene el detalle. Un listado vacío borra el ID anterior. Cuando
venza el token, repite la primera petición. No exportes ni compartas un entorno
que contenga contraseñas o tokens reales.

# Actualización 1.17.3 · reintento de una solicitud Sandbox pendiente

En Historial, **Reintentar envío original** permite continuar una solicitud que quedó `REVISION_SANDBOX` / `POR_CONFIRMAR` después de un error remoto. Requiere permisos de timbrado, una solicitud íntegra y ningún UUID ni identificador de Facturama confirmado.

El servidor reclama el registro mediante revisión y estado, consulta primero el folio en Facturama y recupera un comprobante existente. Solo reenvía cuando la consulta filtrada devuelve una ausencia completa; cualquier coincidencia no verificable o fallo de consulta bloquea el POST. Antes del reenvío comprueba la elegibilidad y los importes actuales del pedido de la API. El POST usa exactamente los campos guardados, incluidos folio y fecha. Se verifica también la huella de solicitudes anteriores.

El reintento es explícito: Consultar resultado y Recuperar documentos siguen siendo consultas. Un fallo posterior conserva la operación y su identidad; un UUID o ID recibido impide nuevos reenvíos. Las escrituras condicionales impiden que dos instancias reclamen la misma revisión o que una consulta obsoleta reenvíe después de un cambio concurrente. La base JSON local conserva su alcance de desarrollo con un proceso.

Instala `instalar-noventia-v1.17.3.mjs` desde tu proyecto con `node ./instalar-noventia-v1.17.3.mjs .`, inicia con `npm start` y recarga el navegador. Conserva tu .env y configuración Sandbox. No requiere SQL ni dependencias nuevas. Este cambio habilita un reintento conservando el registro; no determina la causa del HTTP 500 original de Facturama.

# Corrección 1.17.2 · recuperación de timbrado en Supabase

Se corrigió un conflicto falso al recuperar operaciones de Facturama Sandbox. PostgreSQL almacena `data` como `jsonb` y puede reordenar las claves de los objetos; el sistema anterior calculaba la huella según ese orden. La recuperación confundía el cambio de orden con un cambio de contenido.

La nueva huella es independiente del orden de claves y mantiene significativo el contenido de cada campo y el orden de los conceptos. Las solicitudes enviadas por las versiones 1.17.0 y 1.17.1 se verifican reconstruyendo el formato anterior: no se omite la verificación ni se sustituyen huellas de solicitudes realmente modificadas.

Después de instalar, usa **Historial → Consultar resultado** en el registro existente. Se conservan su folio, fecha y solicitud. La recuperación utiliza consultas; no vuelve a enviar una emisión. Si el proveedor no confirma un comprobante, el código `SANDBOX_RESULTADO_NO_CONFIRMADO` permite distinguir ese caso de un conflicto de integridad o de actualización concurrente. El HTTP 500 original de Facturama requiere comprobar su resultado y, si sigue pendiente, revisar HTTP Logs de la cuenta.

Se verificó la compatibilidad con escrituras y lecturas JSONB reales en PostgreSQL 18.6 mediante PGlite 0.5.13 en un entorno aislado de pruebas. Esa herramienta no es una dependencia del proyecto y no utiliza tu base ni tus credenciales.

La instalación conserva `.env`, credenciales, datos y documentos. Esta actualización no requiere SQL nuevo ni dependencias adicionales.

# Corrección 1.17.2 · errores al guardar borradores

Se corrigió el manejo de validaciones que antes devolvían HTTP 500 y se agregó diagnóstico seguro del guardado en Supabase. Un dato incompleto muestra ahora un mensaje de validación (HTTP 400). Un fallo de base de datos muestra un código y una referencia, sin exponer filas, credenciales ni respuestas SQL privadas. La causa del caso observado en tu servidor debe identificarse con el nuevo mensaje; el estado 500 por sí solo no la determina.

El instalador conserva `.env`, credenciales, datos y documentos. No necesita SQL nuevo ni dependencias adicionales. Mantén activa tu configuración actual de Facturama Sandbox.

# Actualización 1.17.2 · Facturama Sandbox

El dashboard puede emitir comprobantes de prueba con Facturama Multiemisor v4 y recuperar sus documentos originales. La preparación de la cuenta y el CSD de pruebas debe haber concluido primero.

Lee [FACTURAMA_SANDBOX.md](FACTURAMA_SANDBOX.md) para instalar, activar `TIMBRADO_PROVIDER=facturama_sandbox` y probar una compra. El modo predeterminado sigue siendo `mock`. La actualización conserva datos y credenciales y no necesita SQL nuevo ni nuevas dependencias.

# Facturación dinámica V1.16.4

Valida el flujo de una compra: consulta por ID o folio, importes históricos,
guardado, timbrado de prueba y descarga privada de PDF/XML. Se agregan pruebas
HTTP con API y Supabase simulados; no necesitan credenciales reales.

Corrige el guardado local simultáneo, los mensajes de conflicto de Supabase y
la validación de pedidos numéricos al crear la factura. Un doble clic no inicia
dos operaciones sobre la misma factura dentro del mismo proceso del servidor.
Cada intento mock guarda archivos locales propios para conservar documentos
anteriores, incluso cuando un pedido tiene una factura cancelada.

La protección entre instancias se completa con los índices de Supabase en
`supabase/012_facturas_pedido_activo.sql`, previa revisión de duplicados. Este
paquete no ha ejecutado SQL en tu proyecto. Consulta `INSTRUCCIONES.txt` y
`VALIDACION_COMPRAS.md`; no vuelvas a ejecutar todo `schema.sql`.

Se conserva el portal v1.16.3: historial, detalle y descargas de documentos
propios, con estados claros y funcionamiento en celular. La solicitud del
cliente guarda un borrador para revisión.

El timbrado sigue siendo simulado. No se ha elegido ni conectado un proveedor
real. No se han configurado certificados ni correo real. El IVA permanece en
16% y las dos fuentes Firebase no cambian. Conserva la configuración de la API
que ya te funciona.

## PDF v1.16.2
La versión 1.16.2 mejora el PDF: logotipo existente, nombres y descripciones con
acentos, todos los productos en varias páginas, encabezados y numeración. El
folio del pedido se conserva internamente y no se imprime. Los totales se toman
de la factura guardada. Continúa siendo un documento de prueba sin timbre fiscal.

Para aplicar únicamente esta mejora, consulta `INSTRUCCIONES.txt`.

La integración del e-commerce con API real y las dos fuentes Firebase se
describe en [INTEGRACION_API.md](INTEGRACION_API.md). Ahí están las variables
de Render, la migración de Supabase y la comprobación de importes.

Incluye menú lateral con Nueva factura, Historial, Usuarios, Reportes y Configuración.

- Historial con búsqueda, timbrado mock y descarga XML/PDF simulados.
- Usuarios con Supabase Auth y perfiles ADMIN, FACTURACION y CONSULTA.
- Reportes de total, timbradas, borradores, monto y origen.
- Configuración fiscal del emisor como dato único.

Ejecutar: `npm test` y `npm start`.


## V1.9 — IVA opcional + XML CFDI mock

- Control para aplicar o no IVA.
- Tasa seleccionable: 16%, 8% o 0% para pruebas.
- Los totales se recalculan según la tasa elegida.
- La vista previa muestra si la factura lleva IVA.
- El XML mock ahora usa una estructura similar a CFDI 4.0:
  - Comprobante
  - Emisor
  - Receptor
  - Conceptos
  - Impuestos cuando aplican
  - TimbreFiscalDigital simulado
- Cuando la factura no lleva IVA, el XML no agrega traslados de IVA.

**Importante:** este XML sigue siendo de prueba y no es válido fiscalmente hasta conectarlo con catálogos SAT completos, CSD y PAC real.

## V1.10 — Supabase y confirmación de factura

1. Ejecuta `supabase/schema.sql` en el SQL Editor de tu proyecto Supabase.
2. Copia `.env.example` como `.env` y configura `SUPABASE_URL` y
   `SUPABASE_SERVICE_ROLE_KEY` únicamente en el servidor.
3. Inicia el backend con esas variables disponibles en el entorno.

Cuando ambas variables existen, las facturas se guardan en Supabase. Si no están
configuradas, el proyecto conserva el repositorio JSON local para desarrollo.
Cada factura recibe un folio consecutivo `NOV-FAC-000001`. Tras guardarse, el
formulario se limpia y aparece un modal de confirmación. Ante cualquier error,
los datos capturados permanecen en pantalla para que el usuario pueda reintentar.

## V1.11 — Clientes fiscales en Supabase

Ejecuta `supabase/002_clientes_fiscales.sql` una sola vez en el SQL Editor.
Cuando Supabase está configurado, el alta, listado, búsqueda y autocompletado de
clientes fiscales utilizan la tabla `clientes_fiscales`. El RFC es único: un
duplicado se rechaza con un mensaje visible y la captura se conserva para poder
corregirla. La tabla mantiene RLS sin políticas públicas y se accede únicamente
desde el backend.

### V1.11.1

Corrige el autocompletado desde “Buscar fiscal” y el botón “Usar”. Al elegir un
cliente desde el listado, el sistema vuelve a Nueva factura, completa sus datos
fiscales y muestra una confirmación visible.

## V1.12 — Inicio de sesión real

Agrega `SUPABASE_PUBLISHABLE_KEY` al archivo `.env`. El dashboard utiliza
Supabase Auth mediante el backend, guarda la sesión en cookies `HttpOnly` con
`SameSite=Strict`, renueva la sesión y obtiene el rol desde `profiles`. El
selector de rol de prueba fue eliminado. El menú muestra el nombre y rol reales
y permite cerrar la sesión. Los usuarios sin perfil activo quedan bloqueados.

### V1.12.1

Separa completamente el acceso en `public/login.html` y `public/login.js`.
`index.html` contiene únicamente el dashboard. Sin sesión, el dashboard redirige
al login; con una sesión activa, el login redirige al dashboard.

## V1.13 — Documentos fiscales privados

Ejecuta `supabase/003_storage_documentos.sql` una vez. El timbrado mock sube XML
y PDF al bucket privado `documentos-fiscales`. Las rutas se guardan con la
factura y las descargas pasan por el backend autenticado; no existen enlaces
públicos. Los documentos antiguos conservan su descarga local como respaldo.

### V1.13.1

Corrige la generación del PDF simulado: ahora produce un archivo PDF válido
que puede abrirse en navegadores y lectores, en lugar de texto plano con
extensión `.pdf`.

## V1.14 — Base fiscal desacoplada del PAC

Ejecuta `supabase/004_configuracion_fiscal.sql`. El administrador puede guardar
RFC, razón social, régimen, código postal de expedición, serie, exportación y
ambiente. El timbrado mock ya consume esta configuración. La tabla excluye por
diseño certificados, llaves y contraseñas; esos datos se incorporarán como
secretos del servidor al conectar el PAC.

## V1.15 — Conceptos bloqueados

El formulario inicia sin productos de prueba. Los pedidos cargan conceptos
bloqueados. Un concepto manual se captura en modo edición y debe guardarse antes
de emitir la factura; después solo cambia mediante “Editar” o se retira mediante
“Eliminar”. No se permite guardar una factura vacía ni con ediciones pendientes.

### V1.15.1

Corrige la referencia del concepto dentro de los eventos Guardar y Editar.
# facturacion
# facturacion
# facturacion
# facturacion

# Facturación dinámica V1.10

Incluye menú lateral con Nueva factura, Historial, Usuarios, Reportes y Configuración.

- Historial con búsqueda, timbrado mock y descarga XML/PDF simulados.
- Usuarios locales de prueba con roles ADMIN, FACTURACION y CONSULTA.
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

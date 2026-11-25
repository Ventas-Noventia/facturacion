# Actualizar el portal de facturación de Noventia

## Instalación sobre la versión 1.19.4

1. Detén el servidor y descomprime el ZIP. Copia actualizar-portal-1.20.0.mjs a la carpeta de tu instalación actual, junto a package.json.
2. Desde esa carpeta ejecuta `node actualizar-portal-1.20.0.mjs`. El instalador comprueba los archivos que va a modificar y guarda un respaldo. Conserva tu configuración local y tus documentos.
3. En Supabase ejecuta supabase/011_portal_clientes.sql si aún no existe la tabla portal_clientes. Después ejecuta supabase/014_perfil_portal.sql. Activa la confirmación del correo en Supabase Auth antes de abrir el registro al público para que la cuenta acredite el correo de la compra.
4. Reinicia con `npm start`. El portal de clientes está en /portal-login.html y el acceso del personal en /login.html. Los clientes que ya tenían sesión abierta deben volver a ingresar.

## Operación

El cliente guarda su nombre, teléfono y datos fiscales en Mis datos. Al buscar una compra ve los datos del receptor precargados, selecciona la forma de pago de esa compra y confirma la emisión. Los pedidos sin correo verificable se atienden desde el panel interno. Si el proveedor requiere revisión, el sistema conserva el folio para que el personal consulte la operación.

Mi historial muestra los comprobantes vinculados al identificador de la cuenta externa. Una coincidencia de RFC o nombre por sí sola no vincula facturas emitidas anteriormente por el personal. El cliente puede consultar el estado y descargar los documentos disponibles. El envío de correo corresponde al personal con el permiso existente.

El portal utiliza el proveedor de timbrado configurado en tu instalación. En modo de producción el botón Generar factura solicita un CFDI real. Para una prueba usa una instalación de prueba con su proveedor mock o sandbox.

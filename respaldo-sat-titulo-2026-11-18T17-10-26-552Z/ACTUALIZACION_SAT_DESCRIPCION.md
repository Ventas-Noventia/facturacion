CORRECCIÓN SAT Y TÍTULO — 18 NOVIEMBRE 2026

INSTALACIÓN RECOMENDADA (sobre tu proyecto actual)
1. Detén el servidor.
2. Copia corregir-sat-titulo-20261118.mjs a la raíz de tu proyecto, donde está package.json.
3. Desde esa carpeta ejecuta: node corregir-sat-titulo-20261118.mjs
4. Reinicia con npm start y recarga el navegador con Cmd+Shift+R (Mac) o Ctrl+Shift+R (Windows).
El instalador respalda los archivos que sustituye; no modifica .env, credenciales, pedidos ni facturas almacenadas. No ejecutes después los instaladores antiguos.

CAMBIOS
El título tiene prioridad: title, titulo, product_title, productTitle, nombre y name. También acepta esos campos dentro de product, product_listing, productListing o producto. La descripción solo se usa si no hay título/nombre. Si el API realmente no envía título en ningún campo, se requiere que el proveedor lo incorpore: no se inventa un título a partir de las características.

Conserva las claves SAT explícitas del API y reconoce más nombres de campo. Autocompleta 52101502 solo para títulos genéricos que comienzan con Alfombra/Alfombras, excluyendo tipos especializados y accesorios. El envío ENVIO usa 78102200 (mensajería/paquetería); revisa esta clasificación si cambias el tipo de entrega. Las claves recibidas expresamente tienen prioridad. Otros productos sin clave requieren selección manual antes de emitir; no se les asigna la clave de alfombra.

La misma lógica se aplica al consultar y al preparar los conceptos en el servidor. Se conserva la descripción original como detalle para verificar cambios antes de emitir. Precios, descuentos, cantidades e IVA no se cambian.

Prueba buscando un pedido nuevo. Los borradores previos no cambian automáticamente: vuelve a crear los que aún no se han emitido para cargar los nuevos datos. No vuelvas a facturar un comprobante ya timbrado.

VALIDACIÓN
Pruebas locales de API, títulos, SAT, cálculos, servidor y emisión con servicios simulados. No se hizo una consulta al API privado de Noventia ni una emisión real.

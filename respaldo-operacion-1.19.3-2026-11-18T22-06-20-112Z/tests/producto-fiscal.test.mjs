import test from 'node:test';
import assert from 'node:assert/strict';
import { descripcionProducto, claveSatProducto } from '../backend/services/productoFiscalService.mjs';
import { normalizarVentaEcommerce, conceptosActualesEcommerce } from '../backend/services/ecommerceVentaService.mjs';
import { ventaEjemplo } from './fixtures/ecommerce.mjs';
import { calcularTotales } from '../shared/domain/calculos.mjs';

test('API sin name conserva description y clave SAT hasta los conceptos del CFDI', () => {
  const raw = ventaEjemplo();
  delete raw.data.items[0].name;
  raw.data.items[0].description = 'Alfombra gris 120 x 180 cm';
  raw.data.items[0].sat_product_code = '52101502';
  const pedido = normalizarVentaEcommerce(raw);
  assert.equal(pedido.productos[0].descripcion, raw.data.items[0].description);
  assert.equal(pedido.productos[0].nombre, raw.data.items[0].description);
  assert.equal(conceptosActualesEcommerce(pedido)[0].claveProdServSat, '52101502');
  const conceptos = conceptosActualesEcommerce(pedido, [{orderItemId: 'envio-1842', claveProdServSat: '78102200'}]);
  assert.equal(conceptos[2].claveProdServSat, '78102200');
  assert.equal(conceptos[2].claveUnidad, 'E48');
  assert.equal(calcularTotales(conceptos).total, 1449);
});
test('descripción en español, campos vacíos y respaldo de nombre no pierden el texto', () => {
  assert.equal(descripcionProducto({description:'  ',descripcion:'Alfombra',name:'Otro'}), 'Otro');
  assert.equal(descripcionProducto({nombre:'Bocina'}), 'Bocina');
  assert.equal(descripcionProducto({}), '');
  assert.equal(claveSatProducto({satProductCode:'52101502'}), '52101502');
  assert.equal(claveSatProducto({satProductCode:'invalida'}), '');
  assert.equal(claveSatProducto({description:'alfombra'}), '52101502');
});

test('título tiene prioridad sobre descripción y nombre, incluidos productos anidados', () => {
  assert.equal(descripcionProducto({title:'Alfombra gris',name:'Nombre antiguo',description:'Descripción extensa'}), 'Alfombra gris');
  assert.equal(descripcionProducto({description:'Detalles',product:{title:'Cafetera eléctrica'}}), 'Cafetera eléctrica');
  assert.equal(descripcionProducto({titulo:'Bocina',descripcion:'Características'}), 'Bocina');
  assert.equal(claveSatProducto({title:'Alfombra gris'}), '52101502');
  assert.equal(claveSatProducto({title:'Alfombra de yoga'}), '');
  assert.equal(claveSatProducto({title:'Limpiador para alfombras'}), '');
  assert.equal(claveSatProducto({sku:'ENVIO'}), '78102200');
  assert.equal(claveSatProducto({sku:'ENVIO',clave_sat:'78102205'}), '78102205');
});
test('la búsqueda real normaliza el título y autocompleta alfombra y envío sin cambiar totales', () => {
  const raw = ventaEjemplo();
  raw.data.items[0].title='Alfombra gris';
  raw.data.items[0].description='Descripción extensa del producto';
  const pedido=normalizarVentaEcommerce(raw);
  assert.equal(pedido.productos[0].descripcion,'Alfombra gris');
  assert.equal(pedido.productos[0].detalleProducto,'Descripción extensa del producto');
  assert.equal(pedido.productos[0].claveProdServSat,'52101502');
  assert.equal(conceptosActualesEcommerce(pedido)[2].claveProdServSat,'78102200');
  assert.equal(calcularTotales(pedido.productos).total,1449);
});

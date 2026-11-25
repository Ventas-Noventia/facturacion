import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { PortalFacturasService, estadoFacturaPortal, detalleFacturaPortal } from '../backend/services/portalFacturasService.mjs';
import { SupabaseFacturaRepository } from '../backend/repositories/supabaseFacturaRepository.mjs';

const factura = (extra = {}) => ({ id: 'propia', folioInterno: 'NOV-FAC-000001', folioOrigen: 'BAZ-PRUEBA', portalClienteId: 'cliente-a', estatus: 'TIMBRADA_MOCK', uuid: 'MOCK-123', creadaEn: '2026-10-27T16:00:00Z', subtotal: 100, impuestos: 16, total: 116, moneda: 'MXN', cliente: { razonSocial: 'CLIENTE DE PRUEBA', rfc: 'XAXX010101000', codigoPostal: '53490', regimenFiscal: '616', email: 'cliente@example.invalid' }, conceptos: [{ descripcion: 'Producto con acentos: lámpara', cantidad: 1, precioUnitario: 100, calculo: { total: 116 } }], pdfStoragePath: '2026/10/cliente/factura.pdf', xmlStoragePath: '2026/10/cliente/factura.xml', errorSincronizacionPedido: 'DIAGNOSTICO_INTERNO', canceladaPor: { email: 'admin@example.invalid' }, ...extra });
function servicio(rows, storage = { download: async () => Buffer.from('archivo') }, root = os.tmpdir()) {
  return new PortalFacturasService({ facturas: { findById: async id => rows.find(f => f.id === id) || null, listByPortalClienteId: async () => rows }, documentStorage: storage, storageRoot: root });
}

test('el historial muestra solo facturas propias y omite rutas y datos internos', async () => {
  const rows = [factura(), factura({ id: 'ajena', portalClienteId: 'cliente-b' }), factura({ id: 'reciente', creadaEn: '2026-10-28T16:00:00Z' })];
  const lista = await servicio(rows).listar('cliente-a');
  assert.deepEqual(lista.map(f => f.id), ['reciente', 'propia']);
  const text = JSON.stringify(lista);
  for (const dato of ['pdfStoragePath', 'DIAGNOSTICO_INTERNO', 'canceladaPor', 'portalClienteId', 'admin@example.invalid']) assert.ok(!text.includes(dato));
  assert.deepEqual(lista[0].documentos, { pdf: true, xml: true });
});

test('el detalle conserva importes guardados y datos fiscales sin exponer información administrativa', () => {
  const detalle = detalleFacturaPortal(factura({ total: 116.01 }));
  assert.equal(detalle.total, 116.01); assert.equal(detalle.conceptos[0].importe, 116);
  assert.equal(detalle.cliente.rfc, 'XAXX010101000'); assert.match(detalle.conceptos[0].descripcion, /lámpara/);
  assert.equal(detalle.pdfStoragePath, undefined); assert.equal(detalle.errorSincronizacionPedido, undefined);
});

test('otra cuenta recibe el mismo 404 que una factura inexistente y no accede al almacenamiento', async () => {
  let downloads = 0;
  const app = servicio([factura()], { download: async () => { downloads++; return Buffer.from('secreto'); } });
  for (const id of ['propia', 'inexistente']) {
    await assert.rejects(() => app.detalle('cliente-b', id), error => error.statusCode === 404 && error.message === 'Factura no encontrada');
    await assert.rejects(() => app.documento('cliente-b', id, 'pdf'), error => error.statusCode === 404);
  }
  assert.equal(downloads, 0);
  await assert.rejects(() => app.listar(''), error => error.statusCode === 401);
});

test('se descargan los bytes originales del PDF/XML privado con nombre del folio de factura', async () => {
  const llamadas = [], bytes = Buffer.from([0, 1, 2, 255]);
  const app = servicio([factura()], { download: async ruta => { llamadas.push(ruta); return bytes; } });
  for (const tipo of ['pdf', 'xml']) {
    const documento = await app.documento('cliente-a', 'propia', tipo);
    assert.deepEqual(documento.bytes, bytes); assert.equal(documento.nombre, `NOV-FAC-000001.${tipo}`);
    assert.equal(documento.almacenamiento, 'supabase');
  }
  assert.deepEqual(llamadas, ['2026/10/cliente/factura.pdf', '2026/10/cliente/factura.xml']);
});

test('borradores, pruebas y cancelaciones tienen mensajes distintos y conservan sus evidencias', async () => {
  assert.equal(estadoFacturaPortal(factura({ estatus: 'BORRADOR', uuid: '' })).etiqueta, 'En revisión');
  assert.equal(estadoFacturaPortal(factura()).prueba, true);
  assert.match(estadoFacturaPortal(factura()).mensaje, /sin valor fiscal/);
  const cancelada = factura({ estatus: 'CANCELADA_MOCK' });
  assert.equal(estadoFacturaPortal(cancelada).grupo, 'CANCELADA');
  assert.match(estadoFacturaPortal(cancelada).mensaje, /emisión original/);
  assert.equal((await servicio([cancelada]).documento('cliente-a', 'propia', 'pdf')).nombre, 'NOV-FAC-000001.pdf');
  const borrador = factura({ estatus: 'BORRADOR', uuid: '', pdfStoragePath: null, xmlStoragePath: null });
  await assert.rejects(() => servicio([borrador]).documento('cliente-a', 'propia', 'pdf'), error => error.statusCode === 404);
});

test('rutas malformadas y errores de Storage no revelan rutas privadas ni detalles remotos', async () => {
  let llamadas = 0;
  for (const ruta of ['../otro.pdf', '/otro.pdf', 'a/../otro.pdf', 'a//otro.pdf', 'a\\otro.pdf', 'a/otro.pdf?token=privado']) {
    const app = servicio([factura({ pdfStoragePath: ruta })], { download: async () => { llamadas++; } });
    await assert.rejects(() => app.documento('cliente-a', 'propia', 'pdf'), error => error.statusCode === 404);
  }
  assert.equal(llamadas, 0);
  const app = servicio([factura()], { download: async () => { throw new Error('PRIVATE_SERVICE_KEY y ruta privada'); } });
  await assert.rejects(() => app.documento('cliente-a', 'propia', 'pdf'), error => error.statusCode === 503 && !error.message.includes('PRIVATE_SERVICE_KEY'));
});

test('los documentos locales respetan la carpeta de almacenamiento incluso con enlaces simbólicos', async t => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'portal-documentos-'));
  t.after(() => fs.rm(dir, { recursive: true, force: true }));
  const root = path.join(dir, 'storage'); await fs.mkdir(root);
  await fs.writeFile(path.join(root, 'factura.pdf'), 'PDF LOCAL');
  await fs.writeFile(path.join(dir, 'privado.pdf'), 'NO MOSTRAR');
  await fs.symlink(path.join(dir, 'privado.pdf'), path.join(root, 'enlace.pdf'));
  for (const relativePath of ['../privado.pdf', path.join(dir, 'privado.pdf'), 'enlace.pdf']) {
    const app = servicio([factura({ pdfStoragePath: null, pdfRelativePath: relativePath })], null, root);
    await assert.rejects(() => app.documento('cliente-a', 'propia', 'pdf'), error => error.statusCode === 404);
  }
  const documento = await servicio([factura({ pdfStoragePath: null, pdfRelativePath: 'factura.pdf' })], null, root).documento('cliente-a', 'propia', 'pdf');
  assert.equal(documento.bytes.toString(), 'PDF LOCAL'); assert.equal(documento.almacenamiento, 'local');
});

test('la consulta Supabase filtra por el cliente del portal sin necesitar SQL nuevo', async () => {
  const original = global.fetch;
  global.fetch = async value => {
    const url = new URL(value);
    assert.equal(url.searchParams.get('data->>portalClienteId'), 'eq.cliente-a');
    assert.equal(url.searchParams.get('order'), 'creada_en.desc');
    return new Response(JSON.stringify([{ id: 'propia', folio_interno: 'NOV-FAC-000001', data: factura() }]), { status: 200 });
  };
  try {
    const repo = new SupabaseFacturaRepository({ url: 'https://example.invalid', serviceRoleKey: 'fake-test-key' });
    assert.equal((await repo.listByPortalClienteId('cliente-a'))[0].id, 'propia');
  } finally { global.fetch = original; }
});

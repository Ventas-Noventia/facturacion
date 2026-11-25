import test from 'node:test';
import assert from 'node:assert/strict';
import { iniciarServidorPortalPrueba } from './fixtures/portalServidor.mjs';

test('portal HTTP: sesión, historial propio, detalle y descargas privadas', { timeout: 20000 }, async t => {
  const app = await iniciarServidorPortalPrueba(); t.after(() => app.cerrar());
  const get = (url, token = 'session-a') => fetch(app.baseUrl + url, { headers: token ? { Cookie: `facturacion_access=${token}` } : {} });
  assert.equal((await get('/api/portal/facturas', '')).status, 401);
  const history = await get('/api/portal/facturas'); assert.equal(history.status, 200); assert.equal(history.headers.get('cache-control'), 'no-store');
  const rows = await history.json(); assert.deepEqual(rows.map(f => f.id), ['propia', 'pendiente', 'cancelada']);
  assert.ok(app.requests.some(r => r.query['data->>portalClienteId'] === 'eq.cliente-a'));
  assert.equal(JSON.stringify(rows).includes('StoragePath'), false);
  const detalle = await get('/api/portal/facturas/propia'); assert.equal(detalle.status, 200);
  const data = await detalle.json(); assert.equal(data.total, 116); assert.equal(data.estadoCliente.prueba, true); assert.equal(data.conceptos[0].descripcion, 'Organizador para el hogar');
  assert.equal(JSON.stringify(data).includes('DIAGNOSTICO_PRIVADO'), false);
  for (const tipo of ['pdf', 'xml']) {
    const response = await get(`/api/portal/facturas/propia/documento/${tipo}`);
    assert.equal(response.status, 200); assert.equal(response.headers.get('cache-control'), 'no-store');
    assert.match(response.headers.get('content-disposition'), new RegExp(`NOV-FAC-000003\\.${tipo}`));
    assert.deepEqual(Buffer.from(await response.arrayBuffer()), app[tipo]);
  }
  assert.equal(app.auditoria.length, 2);
  assert.ok(app.auditoria.every(a => a.accion === 'DESCARGA_DOCUMENTO' && a.detalle.canal === 'PORTAL'));
  const downloads = app.docs.length;
  for (const ruta of ['/api/portal/facturas/ajena', '/api/portal/facturas/ajena/documento/pdf', '/api/portal/facturas/no-existe/documento/xml', '/api/portal/facturas/pendiente/documento/pdf']) assert.equal((await get(ruta)).status, 404);
  assert.equal(app.docs.length, downloads);
  assert.equal((await get('/api/portal/facturas/propia/documento/pdf', 'session-b')).status, 404);
  assert.equal((await get('/api/portal/facturas/propia/documento/pdf', '')).status, 401);
  assert.equal(app.docs.length, downloads);
  const cancelada = await get('/api/portal/facturas/cancelada/documento/pdf'); assert.equal(cancelada.status, 200);
  assert.ok(app.requests.every(r => !r.pathname.startsWith('/api/v1/invoicing')));
});

import http from 'node:http';
import net from 'node:net';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { fileURLToPath } from 'node:url';
import { crearPdfFactura } from '../../backend/services/simplePdfService.mjs';

const datos = { cliente: { tipoPersona: 'FISICA', razonSocial: 'CLIENTE DE PRUEBA', rfc: 'XAXX010101000', codigoPostal: '53490', regimenFiscal: '616', email: 'cliente@example.invalid' }, subtotal: 100, impuestos: 16, total: 116, moneda: 'MXN', formaPago: '03', metodoPago: 'PUE', usoCfdi: 'G03', conceptos: [{ sku: 'HOG-001', descripcion: 'Organizador para el hogar', cantidad: 1, precioUnitario: 100, calculo: { subtotal: 100, impuesto: 16, total: 116 } }] };
export const facturasPortalPrueba = [
  { ...datos, id: 'propia', numero: 3, folioInterno: 'NOV-FAC-000003', folioOrigen: 'BAZ-EJEMPLO-003', creadaEn: '2026-10-27T18:00:00Z', portalClienteId: 'cliente-a', estatus: 'TIMBRADA_MOCK', uuid: 'MOCK-PRUEBA-003', pdfStoragePath: '2026/10/PRUEBA/NOV-FAC-000003.pdf', xmlStoragePath: '2026/10/PRUEBA/NOV-FAC-000003.xml', errorSincronizacionPedido: 'DIAGNOSTICO_PRIVADO' },
  { ...datos, id: 'pendiente', numero: 2, folioInterno: 'NOV-FAC-000002', folioOrigen: 'NV-EJEMPLO-002', creadaEn: '2026-10-26T18:00:00Z', portalClienteId: 'cliente-a', estatus: 'BORRADOR' },
  { ...datos, id: 'cancelada', numero: 1, folioInterno: 'NOV-FAC-000001', folioOrigen: 'ALM-EJEMPLO-001', creadaEn: '2026-10-25T18:00:00Z', portalClienteId: 'cliente-a', estatus: 'CANCELADA_MOCK', uuid: 'MOCK-PRUEBA-001', fechaCancelacion: '2026-10-26T18:00:00Z', motivoCancelacion: '02', pdfStoragePath: '2026/10/PRUEBA/NOV-FAC-000001.pdf' },
  { ...datos, id: 'ajena', numero: 4, folioInterno: 'NOV-FAC-000004', folioOrigen: 'BAZ-AJENA-004', creadaEn: '2026-10-27T19:00:00Z', portalClienteId: 'cliente-b', estatus: 'TIMBRADA_MOCK', pdfStoragePath: '2026/10/AJENA/factura.pdf' }
];

export async function iniciarServidorPortalPrueba() {
  const requests = [], docs = [], auditoria = [];
  const pdf = crearPdfFactura({ factura: facturasPortalPrueba[0], emisor: { razonSocial: 'NOVENTIA · EMISOR DE PRUEBA', rfc: 'AAA010101AAA', codigoPostal: '53490', regimenFiscal: '601' }, uuid: 'MOCK-PRUEBA-003', fechaTimbrado: '2026-10-27T18:00:00Z' });
  const xml = Buffer.from('<?xml version="1.0" encoding="UTF-8"?><facturaPrueba folio="NOV-FAC-000003" total="116.00"/>');
  const fake = http.createServer(async (req, res) => {
    const url = new URL(req.url, 'http://localhost'); requests.push({ pathname: url.pathname, query: Object.fromEntries(url.searchParams), method: req.method });
    const json = (status, data) => { res.writeHead(status, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(data)); };
    if (url.pathname === '/auth/v1/user') {
      const token = String(req.headers.authorization || '').replace('Bearer ', '');
      if (!['session-a', 'session-b'].includes(token)) return json(401, { message: 'Sesión de prueba inválida' });
      return json(200, { id: token === 'session-a' ? 'cliente-a' : 'cliente-b', email: 'cliente@example.invalid' });
    }
    if (url.pathname === '/rest/v1/portal_clientes') {
      const userId = String(url.searchParams.get('user_id')).replace('eq.', '');
      return json(200, [{ user_id: userId, nombre: 'Cliente de prueba', email: 'cliente@example.invalid', telefono: '5555555555', tipo_persona: 'FISICA', razon_social: 'CLIENTE DE PRUEBA', rfc: 'XAXX010101000', codigo_postal: '53490', regimen_fiscal: '616', uso_cfdi: 'G03', aviso_version: '2026-10-06', aviso_aceptado_en: '2026-10-26T18:00:00Z', activo: true }]);
    }
    if (url.pathname === '/rest/v1/facturas') {
      let seleccion = facturasPortalPrueba;
      if (url.searchParams.has('id')) seleccion = seleccion.filter(f => `eq.${f.id}` === url.searchParams.get('id'));
      if (url.searchParams.has('data->>portalClienteId')) seleccion = seleccion.filter(f => `eq.${f.portalClienteId}` === url.searchParams.get('data->>portalClienteId'));
      return json(200, seleccion.map(f => ({ id: f.id, numero: f.numero, folio_interno: f.folioInterno, creada_en: f.creadaEn, data: f })));
    }
    if (url.pathname.startsWith('/storage/v1/object/documentos-fiscales/')) {
      docs.push(url.pathname); const isPdf = url.pathname.endsWith('.pdf');
      res.writeHead(200, { 'Content-Type': isPdf ? 'application/pdf' : 'application/xml' }); return res.end(isPdf ? pdf : xml);
    }
    if (req.method === 'POST' && url.pathname.startsWith('/rest/v1/')) {
      let text = ''; for await (const chunk of req) text += chunk;
      const record = JSON.parse(text || '{}'); auditoria.push(record); return json(201, [record]);
    }
    return json(404, { error: 'Ruta de prueba no encontrada' });
  });
  fake.listen(0, '127.0.0.1'); await once(fake, 'listening');
  const fakeUrl = `http://127.0.0.1:${fake.address().port}`;
  const socket = net.createServer(); socket.listen(0, '127.0.0.1'); await once(socket, 'listening');
  const port = socket.address().port; await new Promise(resolve => socket.close(resolve));
  const env = { ...process.env, PORT: String(port), APP_ENV: 'test', SUPABASE_URL: fakeUrl, SUPABASE_SERVICE_ROLE_KEY: 'fake-service-key', SUPABASE_PUBLISHABLE_KEY: 'fake-public-key', SUPABASE_DOCUMENT_BUCKET: 'documentos-fiscales', FIREBASE_PROJECT_ID: 'fake-project', GOOGLE_APPLICATION_CREDENTIALS: '', FIREBASE_SERVICE_ACCOUNT_JSON: '', FIREBASE_SERVICE_ACCOUNT_BASE64: '', ECOMMERCE_API_BASE_URL: '', ECOMMERCE_API_USERNAME: '', ECOMMERCE_API_PASSWORD: '' };
  const child = spawn(process.execPath, ['backend/server.mjs'], { cwd: fileURLToPath(new URL('../../', import.meta.url)), env, stdio: ['ignore', 'pipe', 'pipe'] });
  let logs = ''; child.stderr.on('data', chunk => { logs += chunk; });
  const timeout = setTimeout(() => child.kill(), 12000);
  try {
    await Promise.race([new Promise(resolve => child.stdout.on('data', chunk => { if (String(chunk).includes('Facturación:')) resolve(); })), new Promise((_, reject) => child.once('exit', code => reject(new Error(`Servidor terminó: ${code} ${logs.slice(-500)}`))))]);
  } catch (error) { fake.closeAllConnections(); await new Promise(resolve => fake.close(resolve)); throw error; }
  finally { clearTimeout(timeout); }
  return { baseUrl: `http://127.0.0.1:${port}`, requests, docs, auditoria, pdf, xml, async cerrar() {
    if (child.exitCode === null && child.signalCode === null) { child.kill(); await once(child, 'exit'); }
    fake.closeAllConnections(); await new Promise(resolve => fake.close(resolve));
  } };
}

import fs from 'node:fs/promises';
import path from 'node:path';
import { randomInt, randomUUID } from 'node:crypto';
import { pathToFileURL, fileURLToPath } from 'node:url';

const DEFAULT_ID = 'ad33cae4-655e-4e70-821c-6430445b058a';
const TEST_ISSUER = 'EKU9003173C9', TEST_RECEIVER = 'URE180429TM6';
const UUID = /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i;
const clone = value => JSON.parse(JSON.stringify(value));
const confirmed = result => result?.estado === 'CONFIRMADO';
const failed = result => result?.estado === 'ERROR_HTTP' && result.etapa === 'EMISION';
const stop = (message, code = 'DIAGNOSTICO_DETENIDO') => Object.assign(new Error(message), { code });

async function readOptional(file) {
  try { return JSON.parse(await fs.readFile(file, 'utf8')); }
  catch (error) { if (error.code === 'ENOENT') return null; throw error; }
}
async function writeAtomic(file, data) {
  const temp = `${file}.${randomUUID()}.tmp`;
  try { await fs.writeFile(temp, JSON.stringify(data, null, 2), { flag: 'wx' }); await fs.rename(temp, file); }
  finally { await fs.rm(temp, { force: true }); }
}
function publicRequest(p) {
  return p?.Issuer?.Rfc === TEST_ISSUER && p?.Receiver?.Rfc === TEST_RECEIVER && p.Currency === 'MXN' && p.CfdiType === 'I' && Array.isArray(p.Items) && p.Items.length > 0;
}

// Every diagnostic is a NEW independent Sandbox operation. The original
// invoice and its Folio/Date are never changed, reissued, or written to the DB.
export function initialCases(original, baseline) {
  return [
    { key: '01-control', label: 'Control mínimo con la configuración del servidor', request: clone(baseline), alpha: false },
    { key: '02-generales', label: 'Datos generales del pedido y concepto mínimo', request: { ...clone(original), Items: clone(baseline.Items) }, alpha: /[^0-9]/.test(original.Folio) },
    { key: '03-conceptos', label: 'Conceptos del pedido y datos generales mínimos', request: { ...clone(baseline), Items: clone(original.Items) }, alpha: false }
  ];
}
export function extraCases(original, baseline, results) {
  const general = results.find(r => r.caso === '02-generales'), items = results.find(r => r.caso === '03-conceptos');
  if (confirmed(general) && confirmed(items)) return [
    { key: '04-completa', label: 'Solicitud completa en una operación de diagnóstico nueva', request: clone(original), alpha: /[^0-9]/.test(original.Folio) }
  ];
  if (failed(general) && confirmed(items)) return [
    { key: '04-folio', label: 'Solo formato de folio alfanumérico', request: clone(baseline), alpha: true },
    { key: '05-serie', label: 'Solo serie del pedido', request: { ...clone(baseline), ...(original.Serie != null ? { Serie: original.Serie } : {}) }, alpha: false }
  ];
  if (confirmed(general) && failed(items)) {
    const item2 = original.Items.find(item => item.IdentificationNumber === 'ENVIO') || original.Items[1];
    return [
      { key: '04-producto', label: 'Solo primer concepto del pedido', request: { ...clone(baseline), Items: [clone(original.Items[0])] }, alpha: false },
      ...(item2 ? [{ key: '05-envio', label: 'Solo envío o segundo concepto', request: { ...clone(baseline), Items: [clone(item2)] }, alpha: false }] : [])
    ];
  }
  return [];
}

function summary(record) {
  return { caso: record.caso, prueba: record.prueba, folio: record.solicitud.Folio, estado: record.estado, etapa: record.fase,
    ...(record.http ? { HTTP: record.http } : {}), ...(record.Id ? { Id: record.Id } : {}),
    ...(record.httpEmision ? { ultimoHTTPEmision: record.httpEmision } : {}),
    ...(record.UUID ? { UUID: record.UUID } : {}), ...(record.codigo ? { codigo: record.codigo } : {}) };
}

export async function runCase({ file, record, pac, hash, parseResult, allowPost }) {
  if (!publicRequest(record.solicitud) || record.huella !== hash(record.solicitud)) throw stop('Una solicitud de diagnóstico fue modificada. Se detuvo sin emitir.', 'SOLICITUD_MODIFICADA');
  record.fase = 'CONSULTA'; delete record.http; delete record.codigo;
  try {
    let remote;
    if (record.Id) remote = await pac.consultar(record.Id);
    else {
      const q = new URLSearchParams({ type: 'issuedLite', folio: record.solicitud.Folio, rfcIssuer: TEST_ISSUER, status: 'all', page: '0' });
      const rows = await pac.request('/cfdi?' + q);
      if (!Array.isArray(rows)) throw stop('La consulta no devolvió una lista válida.', 'CONSULTA_INVALIDA');
      if (rows.length) {
        // Even a partially matching row blocks a new emission. Do not guess.
        record.estado = 'COINCIDENCIA_POR_REVISAR'; await writeAtomic(file, record); return summary(record);
      }
      if (!allowPost || record.estado !== 'PREPARADO') {
        record.estado = 'SIN_RESULTADO_CONFIRMADO'; await writeAtomic(file, record); return summary(record);
      }
      record.estado = 'ENVIADO'; record.fase = 'EMISION'; await writeAtomic(file, record);
      remote = await pac.crear(record.solicitud);
      if (typeof remote?.Id === 'string' && /^[a-zA-Z0-9_-]{1,100}$/.test(remote.Id)) { record.Id = remote.Id; await writeAtomic(file, record); }
    }
    record.fase = 'VALIDACION';
    const result = parseResult(remote, record.Id || null);
    record.Id = result.id; record.UUID = result.uuid; record.estado = 'CONFIRMADO';
    delete record.http; delete record.codigo;
  } catch (error) {
    const http = Number(error.httpStatus) || 0;
    record.estado = http ? 'ERROR_HTTP' : 'POR_REVISAR';
    if (http) record.http = http;
    if (http && record.fase === 'EMISION') record.httpEmision = http;
    record.codigo = typeof error.code === 'string' && /^[A-Z_0-9]{1,60}$/.test(error.code) ? error.code : 'CONSULTAR_HTTP_LOGS';
  }
  await writeAtomic(file, record); return summary(record);
}

export async function runComparison({ folder, facturaId, original, baseline, pac, hash, parseResult, fechaMexico, emit = false, log = console.log }) {
  if (!publicRequest(original) || !publicRequest(baseline)) throw stop('La herramienta requiere las identidades públicas de prueba y moneda MXN.');
  const sessionFile = path.join(folder, 'sesion.json');
  if (!emit && !(await readOptional(sessionFile))) return { modo: 'SOLO_LECTURA', factura: facturaId, pruebasDisponibles: initialCases(original, baseline).map(c => c.label) };
  await fs.mkdir(folder, { recursive: true });
  const lock = path.join(folder, 'diagnostico.lock');
  let handle;
  try { handle = await fs.open(lock, 'wx'); }
  catch (error) { if (error.code === 'EEXIST') throw stop('Hay otro diagnóstico en curso o uno se interrumpió. Se detuvo sin emitir.', 'DIAGNOSTICO_OCUPADO'); throw error; }
  try {
    let session = await readOptional(sessionFile);
    const results = [];
    if (session) {
      if (session.version !== 1 || session.facturaId !== facturaId || session.original !== hash(original) || session.baseline !== hash(baseline)) throw stop('Los datos del pedido o del control cambiaron. Conserva el diagnóstico para revisión.', 'DATOS_MODIFICADOS');
      // Once a session exists, ALL subsequent runs are read-only at the PAC.
      for (const saved of session.casos) {
        if (!/^[a-z0-9-]+$/.test(saved.key)) throw stop('Referencia de diagnóstico inválida.');
        const file = path.join(folder, saved.key + '.json'), record = await readOptional(file);
        if (!record) { results.push({ caso: saved.key, estado: 'ARCHIVO_PENDIENTE' }); continue; }
        const result = await runCase({ file, record, pac, hash, parseResult, allowPost: false }); results.push(result); log(JSON.stringify(result));
      }
      return { modo: 'SOLO_LECTURA', factura: facturaId, resultados: results };
    }
    session = { version: 1, facturaId, original: hash(original), baseline: hash(baseline), casos: [] };
    await fs.writeFile(sessionFile, JSON.stringify(session, null, 2), { flag: 'wx' });
    const used = new Set([String(original.Folio), String(baseline.Folio)]);
    async function execute(c) {
      if (session.casos.length >= 5) throw stop('Se alcanzó el máximo de cinco pruebas.');
      let folio;
      for (let i = 0; i < 20; i++) { folio = c.alpha ? 'd' + randomUUID().replaceAll('-', '').slice(1) : String(randomInt(10000000, 100000000)); if (!used.has(folio)) break; }
      if (used.has(folio)) throw stop('No se pudo reservar un folio de diagnóstico.');
      used.add(folio);
      const solicitud = { ...clone(c.request), Folio: folio, Date: fechaMexico() };
      if (solicitud.Folio === original.Folio) throw stop('El folio de diagnóstico coincide con el pedido.');
      const record = { caso: c.key, prueba: c.label, estado: 'PREPARADO', solicitud, huella: hash(solicitud) };
      const file = path.join(folder, c.key + '.json');
      await fs.writeFile(file, JSON.stringify(record, null, 2), { flag: 'wx' });
      session.casos.push({ key: c.key }); await writeAtomic(sessionFile, session);
      const result = await runCase({ file, record, pac, hash, parseResult, allowPost: true }); results.push(result); log(JSON.stringify(result)); return result;
    }
    const cases = initialCases(original, baseline);
    const control = await execute(cases[0]);
    if (!confirmed(control)) return { modo: 'PRUEBAS_SANDBOX', factura: facturaId, resultados: results, observacion: 'El control mínimo no se confirmó. No se ejecutaron más emisiones.' };
    const general = await execute(cases[1]);
    if (general.etapa === 'CONSULTA' && !confirmed(general)) return { modo: 'PRUEBAS_SANDBOX', factura: facturaId, resultados: results, observacion: 'Falló la consulta previa. No se ejecutaron más pruebas.' };
    const items = await execute(cases[2]);
    if (items.etapa === 'CONSULTA' && !confirmed(items)) return { modo: 'PRUEBAS_SANDBOX', factura: facturaId, resultados: results, observacion: 'Falló la consulta previa. No se ejecutaron más pruebas.' };
    for (const c of extraCases(original, baseline, results)) await execute(c);
    return { modo: 'PRUEBAS_SANDBOX', factura: facturaId, resultados: results,
      observacion: 'Los resultados delimitan grupos; un HTTP 500 no demuestra por sí solo qué campo falla. La factura original se conserva.' };
  } finally { await handle.close(); await fs.rm(lock, { force: true }); }
}

export async function main(args = process.argv.slice(2), { project = process.cwd(), runtime = null, log = console.log } = {}) {
  if (args.includes('--help')) { log('Uso: node diagnosticar-facturama.mjs [--probar] [UUID_FACTURA]\nSin --probar consulta. Con --probar crea hasta cinco comprobantes independientes de Sandbox una sola vez. Las siguientes ejecuciones solo consultan.'); return; }
  const id = args.find(a => UUID.test(a)) || DEFAULT_ID;
  if (args.some(a => a !== '--probar' && !UUID.test(a)) || args.filter(a => UUID.test(a)).length > 1) throw stop('Argumentos inválidos. Usa --help.');
  const pkg = await readOptional(path.join(project, 'package.json'));
  if (pkg?.name !== 'facturacion-dinamica-v1') throw stop('Ejecuta el comando desde tu proyecto, donde está package.json.');
  if (!runtime) {
    const get = p => import(pathToFileURL(path.join(project, p)).href);
    const { loadEnv } = await get('backend/config/loadEnv.mjs'); loadEnv(path.join(project, '.env'));
    if (process.env.TIMBRADO_PROVIDER !== 'facturama_sandbox') throw stop('Esta herramienta requiere TIMBRADO_PROVIDER=facturama_sandbox.');
    const [{ FacturamaSandboxService, resultadoSandbox, fechaMexico }, { SupabaseFacturaRepository }, { LocalFacturaRepository }, hashes] = await Promise.all([
      get('backend/services/facturamaSandboxService.mjs'), get('backend/repositories/supabaseFacturaRepository.mjs'),
      get('backend/repositories/localFacturaRepository.mjs'), get('backend/services/huellaSandbox.mjs')
    ]);
    const facturas = process.env.SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY
      ? new SupabaseFacturaRepository({ url: process.env.SUPABASE_URL, serviceRoleKey: process.env.SUPABASE_SERVICE_ROLE_KEY })
      : new LocalFacturaRepository({ file: path.join(project, 'backend/data/facturas.json') });
    runtime = { facturas, pac: new FacturamaSandboxService({ username: process.env.FACTURAMA_USERNAME, password: process.env.FACTURAMA_PASSWORD, baseUrl: process.env.FACTURAMA_API_BASE_URL || 'https://apisandbox.facturama.mx' }),
      hash: hashes.huellaSolicitud, verify: hashes.verificarHuellaSolicitud, parseResult: resultadoSandbox, fechaMexico };
  }
  const factura = await runtime.facturas.findById(id);
  if (!factura || !runtime.verify(factura.timbradoSandbox)) throw stop('No se encontró una solicitud original íntegra para esa factura.', 'SOLICITUD_ORIGINAL_NO_DISPONIBLE');
  if (factura.uuid || factura.timbradoSandbox.facturamaId) { log(JSON.stringify({ estado: 'CONSULTAR_RESULTADO_EN_DASHBOARD', factura: id })); return; }
  if (factura.estatus !== 'REVISION_SANDBOX' || factura.timbradoSandbox.estado !== 'POR_CONFIRMAR') throw stop('La factura no está pendiente de revisión o tiene otra operación en curso.', 'OPERACION_EN_CURSO');
  const original = factura.timbradoSandbox.solicitud;
  const found = await runtime.pac.localizar(original, { exigirAusenciaCompleta: true });
  if (found) { log(JSON.stringify({ estado: 'ORIGINAL_ENCONTRADO', Id: found.Id, UUID: found.TaxStamp?.Uuid || found.Complement?.TaxStamp?.Uuid, siguiente: 'Pulsa Consultar resultado en Historial.' })); return; }
  const baseline = await readOptional(path.join(project, 'diagnostico-facturama-sandbox.json'));
  if (!baseline) throw stop('Falta diagnostico-facturama-sandbox.json, guardado por la prueba mínima que funcionó.');
  const result = await runComparison({ folder: path.join(project, 'backend/data/diagnostico-facturama', id), facturaId: id,
    original, baseline, pac: runtime.pac, hash: runtime.hash, parseResult: runtime.parseResult, fechaMexico: runtime.fechaMexico,
    emit: args.includes('--probar'), log });
  log(JSON.stringify({ modo: result.modo, factura: result.factura, observacion: result.observacion || 'Solo consulta; no se reenviaron pruebas.' }));
  return result;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch(error => { console.error(JSON.stringify({ estado: 'DETENIDO', codigo: error.code || 'REVISAR_CONFIGURACION', mensaje: error.message })); process.exitCode = 1; });
}

// Inicializa TLS antes de X509Certificate.toLegacyObject(): evita la carga
// circular de node:tls observada con Node.js 22.18.0 al validar el CSD.
import 'node:tls';
// NOVENTIA - Preparación del CSD de producción. Node.js 22 o posterior.
// Sin argumentos: consulta. --validar-archivos: comprobación local, sin red.
// --registrar-csd: registra solo cuando el GET previo devuelve 404.
// Nunca emite, cancela ni modifica CFDI, ni reemplaza CSD existentes.
// No modifica .env, datos, documentos ni la configuración del dashboard.
// La comprobación local no sustituye la validación de cadena/revocación del SAT.
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { X509Certificate, createPrivateKey } from 'node:crypto';

export const API_PRODUCCION = 'https://api.facturama.mx';
const PATRON_RFC = /^[A-ZÑ&]{3,4}\d{6}[A-Z0-9]{3}$/;
const RFC_NO_PRODUCTIVOS = new Set([
  'EKU9003173C9', 'URE180429TM6', 'XAXX010101000', 'XEXX010101000'
]);
const CAMPOS = [
  'FACTURAMA_PRODUCTION_USERNAME', 'FACTURAMA_PRODUCTION_PASSWORD',
  'FACTURAMA_PRODUCTION_RFC', 'FACTURAMA_PRODUCTION_API_BASE_URL',
  'FACTURAMA_CSD_CER_PATH', 'FACTURAMA_CSD_KEY_PATH',
  'FACTURAMA_CSD_PASSWORD', 'NODE_TLS_REJECT_UNAUTHORIZED'
];
const LIMITE_BYTES = 256 * 1024;

export class PreparacionError extends Error {
  constructor(codigo, mensaje, http) {
    super(mensaje);
    this.name = 'PreparacionError'; this.codigo = codigo;
    if (http !== undefined) this.http = http;
  }
}
const fallo = (codigo, mensaje, http) => new PreparacionError(codigo, mensaje, http);
const normalizarRfc = valor => String(valor || '').trim().toUpperCase();
const fechaResumen = valor => typeof valor === 'string' && valor.length <= 64 &&
  Number.isFinite(Date.parse(valor)) ? valor : null;
const foliosResumen = valor =>
  ((typeof valor === 'string' && /^\d{1,12}$/.test(valor)) ||
   (typeof valor === 'number' && Number.isSafeInteger(valor) && valor >= 0)) ? valor : null;

// Misma interpretación de valores y comillas que backend/config/loadEnv.mjs.
// Se rechazan duplicados y exportaciones contradictorias, sin imprimir valores.
export async function leerConfiguracion(directory = process.cwd(), environment = process.env) {
  let contenido = '';
  try { contenido = await fs.readFile(path.join(directory, '.env'), 'utf8'); }
  catch (error) {
    if (error.code !== 'ENOENT') throw fallo('ENV_ILEGIBLE', 'No se pudo leer el .env de tu proyecto.');
  }
  const archivo = {};
  for (const raw of contenido.split(/\r?\n/)) {
    const linea = raw.trim();
    if (!linea || linea.startsWith('#')) continue;
    const igual = linea.indexOf('=');
    if (igual < 1) continue;
    const campo = linea.slice(0, igual).trim();
    if (!CAMPOS.includes(campo)) continue;
    if (Object.hasOwn(archivo, campo)) {
      throw fallo('ENV_DUPLICADO', `${campo} está repetida en .env. Conserva una sola línea.`);
    }
    let valor = linea.slice(igual + 1).trim();
    if ((valor.startsWith('"') && valor.endsWith('"')) ||
        (valor.startsWith("'") && valor.endsWith("'"))) valor = valor.slice(1, -1);
    archivo[campo] = valor;
  }
  const config = {};
  for (const campo of CAMPOS) {
    if (environment[campo] !== undefined && archivo[campo] !== undefined &&
        environment[campo] !== archivo[campo]) {
      throw fallo('ENV_CONTRADICTORIO', `${campo} tiene valores diferentes en la Terminal y en .env. Unifica la configuración.`);
    }
    config[campo] = environment[campo] ?? archivo[campo];
  }
  if (config.NODE_TLS_REJECT_UNAUTHORIZED === '0') {
    throw fallo('TLS_DESACTIVADO', 'Activa la verificación HTTPS: NODE_TLS_REJECT_UNAUTHORIZED no debe ser 0.');
  }
  if (config.FACTURAMA_PRODUCTION_API_BASE_URL) {
    let url;
    try { url = new URL(config.FACTURAMA_PRODUCTION_API_BASE_URL); } catch {}
    if (url?.href !== API_PRODUCCION + '/') {
      throw fallo('URL_NO_PERMITIDA', 'La preparación productiva solo admite https://api.facturama.mx.');
    }
  }
  const rfc = normalizarRfc(config.FACTURAMA_PRODUCTION_RFC);
  if (!PATRON_RFC.test(rfc) || RFC_NO_PRODUCTIVOS.has(rfc)) {
    throw fallo('RFC_INVALIDO', 'Configura FACTURAMA_PRODUCTION_RFC con el RFC real del emisor.');
  }
  return { ...config, FACTURAMA_PRODUCTION_RFC: rfc, directory };
}

// Lector DER limitado a los niveles necesarios para la extensión Key Usage.
function elementosDer(buffer, inicio = 0, limite = buffer.length) {
  const elementos = [];
  for (let offset = inicio; offset < limite;) {
    if (offset + 2 > limite) throw new Error('DER');
    const tag = buffer[offset++];
    if ((tag & 31) === 31) throw new Error('DER');
    let largo = buffer[offset++];
    if (largo & 128) {
      const cantidad = largo & 127;
      if (!cantidad || cantidad > 4 || offset + cantidad > limite) throw new Error('DER');
      largo = 0;
      for (let i = 0; i < cantidad; i++) largo = largo * 256 + buffer[offset++];
    }
    const fin = offset + largo;
    if (fin > limite || fin < offset) throw new Error('DER');
    elementos.push({ tag, inicio: offset, fin });
    offset = fin;
  }
  return elementos;
}
function hijos(buffer, elemento) { return elementosDer(buffer, elemento.inicio, elemento.fin); }

export function tieneUsoCsd(der) {
  try {
    const raiz = elementosDer(der);
    if (raiz.length !== 1 || raiz[0].tag !== 0x30) return false;
    const certificado = hijos(der, raiz[0]);
    if (certificado[0]?.tag !== 0x30) return false;
    const extensiones = hijos(der, certificado[0]).filter(x => x.tag === 0xa3);
    if (extensiones.length !== 1) return false;
    const secuencia = hijos(der, extensiones[0]);
    if (secuencia.length !== 1 || secuencia[0].tag !== 0x30) return false;
    const usos = [];
    for (const extension of hijos(der, secuencia[0])) {
      if (extension.tag !== 0x30) return false;
      const partes = hijos(der, extension);
      const oid = partes[0];
      if (oid?.tag !== 0x06 ||
          !der.subarray(oid.inicio, oid.fin).equals(Buffer.from([0x55, 0x1d, 0x0f]))) continue;
      const valor = partes.at(-1);
      if (valor?.tag !== 0x04) return false;
      const bits = hijos(der, valor);
      if (bits.length !== 1 || bits[0].tag !== 0x03) return false;
      usos.push(der.subarray(bits[0].inicio, bits[0].fin));
    }
    // CSD: Digital Signature + Non Repudiation (c0).
    // Se rechazan usos de cifrado/acuerdo de claves propios de e.firma/FIEL.
    return usos.length === 1 && usos[0].length === 2 &&
      usos[0][0] === 6 && usos[0][1] === 0xc0;
  } catch { return false; }
}

export function rfcDelCertificado(certificado) {
  const sujeto = certificado.toLegacyObject().subject || {};
  const nombres = ['x500UniqueIdentifier', 'uniqueIdentifier', '2.5.4.45', 'OID.2.5.4.45'];
  const valores = nombres.flatMap(nombre => sujeto[nombre] === undefined
    ? [] : Array.isArray(sujeto[nombre]) ? sujeto[nombre] : [sujeto[nombre]]);
  if (valores.length !== 1 || typeof valores[0] !== 'string') return null;
  // El RFC posterior a '/' puede pertenecer al representante, no al emisor.
  const titular = normalizarRfc(valores[0].split('/')[0]);
  return PATRON_RFC.test(titular) ? titular : null;
}

export function validarCertificado(cer, rfc, ahora = Date.now()) {
  let certificado;
  try { certificado = new X509Certificate(cer); }
  catch { throw fallo('CER_INVALIDO', 'El archivo .cer no es un certificado X.509 válido.'); }
  if (certificado.ca || !tieneUsoCsd(certificado.raw)) {
    throw fallo('NO_ES_CSD', 'El certificado no tiene los usos de un CSD. Selecciona tus sellos digitales; no uses la e.firma/FIEL.');
  }
  if (rfcDelCertificado(certificado) !== rfc) {
    throw fallo('RFC_NO_COINCIDE', 'El RFC titular del .cer no coincide con FACTURAMA_PRODUCTION_RFC.');
  }
  const desde = Date.parse(certificado.validFrom), hasta = Date.parse(certificado.validTo);
  if (!Number.isFinite(desde) || !Number.isFinite(hasta) || desde > ahora || hasta <= ahora) {
    throw fallo('CSD_FUERA_DE_VIGENCIA', 'El certificado aún no está vigente o ya venció. Revisa el CSD y la fecha de tu equipo.');
  }
  return certificado;
}

function rutaArchivo(valor, directory) {
  if (typeof valor !== 'string' || !valor.trim()) return null;
  const expandida = valor.startsWith('~/') ? path.join(os.homedir(), valor.slice(2)) : valor;
  return path.resolve(directory, expandida);
}
async function leerArchivoLimitado(ruta, extension) {
  if (!ruta || !ruta.toLowerCase().endsWith(extension)) {
    throw fallo('RUTA_CSD_INVALIDA', 'Configura FACTURAMA_CSD_CER_PATH y FACTURAMA_CSD_KEY_PATH con las rutas de tus archivos .cer y .key.');
  }
  try {
    const info = await fs.stat(ruta);
    if (!info.isFile() || info.size < 1 || info.size > LIMITE_BYTES) throw new Error();
    const datos = await fs.readFile(ruta);
    if (datos.length > LIMITE_BYTES) throw new Error();
    return datos;
  } catch { throw fallo('ARCHIVO_CSD_ILEGIBLE', 'No se pudo leer uno de los archivos del CSD. Revisa las rutas y los permisos.'); }
}

export async function validarArchivos(config, ahora = Date.now()) {
  const password = config.FACTURAMA_CSD_PASSWORD;
  if (typeof password !== 'string' || !password || /^TU_PASSWORD|^CONTRASEÑA_DEL_CSD$/i.test(password)) {
    throw fallo('FALTA_PASSWORD_CSD', 'Configura FACTURAMA_CSD_PASSWORD con la contraseña de la llave del CSD.');
  }
  const cer = await leerArchivoLimitado(rutaArchivo(config.FACTURAMA_CSD_CER_PATH, config.directory), '.cer');
  const key = await leerArchivoLimitado(rutaArchivo(config.FACTURAMA_CSD_KEY_PATH, config.directory), '.key');
  try {
    const certificado = validarCertificado(cer, config.FACTURAMA_PRODUCTION_RFC, ahora);
    let llave;
    try { llave = createPrivateKey({ key, format: 'der', type: 'pkcs8', passphrase: password }); }
    catch { throw fallo('KEY_O_PASSWORD_INVALIDO', 'No se pudo abrir la llave .key. Revisa la contraseña del CSD y que el archivo sea PKCS#8 DER.'); }
    if (!certificado.checkPrivateKey(llave)) {
      throw fallo('CER_KEY_NO_COINCIDEN', 'El .cer y la llave .key no pertenecen al mismo par de sellos.');
    }
    return { certificado, key, password };
  } catch (error) { key.fill(0); throw error; }
}

function cliente(config, fetchImpl, timeoutMs) {
  const usuario = config.FACTURAMA_PRODUCTION_USERNAME;
  const password = config.FACTURAMA_PRODUCTION_PASSWORD;
  if (typeof usuario !== 'string' || !usuario.trim() || /[:\r\n]/.test(usuario) ||
      typeof password !== 'string' || !password || /[\r\n]/.test(password) ||
      /^(TU_|USUARIO_DE_)/i.test(usuario) || /^(TU_|CONTRASEÑA_DE_)/i.test(password)) {
    throw fallo('FALTAN_CREDENCIALES', 'Configura FACTURAMA_PRODUCTION_USERNAME y FACTURAMA_PRODUCTION_PASSWORD con los accesos de producción.');
  }
  const authorization = 'Basic ' + Buffer.from(`${usuario}:${password}`).toString('base64');
  const rutaCsd = '/api-lite/csds/' + encodeURIComponent(config.FACTURAMA_PRODUCTION_RFC);
  return async (ruta, metodo = 'GET', cuerpo) => {
    const permitido = (metodo === 'GET' && [rutaCsd, '/SuscriptionPlan'].includes(ruta)) ||
      (metodo === 'POST' && ruta === '/api-lite/csds' && cuerpo?.Rfc === config.FACTURAMA_PRODUCTION_RFC);
    if (!permitido) throw fallo('OPERACION_NO_PERMITIDA', 'Esta herramienta solo consulta y registra el CSD del RFC configurado.');
    const controlador = new AbortController();
    const temporizador = setTimeout(() => controlador.abort(), timeoutMs);
    try {
      const respuesta = await fetchImpl(API_PRODUCCION + ruta, {
        method: metodo, redirect: 'error', signal: controlador.signal,
        headers: {
          Accept: 'application/json', Authorization: authorization, 'User-Agent': usuario,
          ...(cuerpo ? { 'Content-Type': 'application/json' } : {})
        },
        ...(cuerpo ? { body: JSON.stringify(cuerpo) } : {})
      });
      if (respuesta.redirected || (respuesta.url && new URL(respuesta.url).origin !== API_PRODUCCION)) {
        await respuesta.body?.cancel().catch(() => {});
        throw fallo('REDIRECCION_RECHAZADA', 'La API devolvió una redirección no permitida.');
      }
      let datos = null;
      // Nunca se imprimen cuerpos de error ni la respuesta del POST: podrían contener llaves.
      if (metodo === 'GET' && respuesta.ok) {
        const trozos = []; let total = 0;
        if (respuesta.body) for await (const trozo of respuesta.body) {
          total += trozo.length;
          if (total > LIMITE_BYTES) { controlador.abort(); throw fallo('RESPUESTA_INVALIDA', 'La respuesta de la API supera el tamaño permitido.'); }
          trozos.push(trozo);
        }
        try { datos = JSON.parse(Buffer.concat(trozos).toString('utf8')); }
        catch { throw fallo('RESPUESTA_INVALIDA', 'La API no devolvió un registro JSON válido.'); }
      } else await respuesta.body?.cancel().catch(() => {});
      return { http: respuesta.status, datos };
    } catch (error) {
      if (error instanceof PreparacionError) throw error;
      throw fallo('CONEXION_FALLIDA', 'No se pudo completar la conexión HTTPS con Facturama. Consulta el estado antes de repetir un registro.');
    } finally { clearTimeout(temporizador); }
  };
}

function exigirHttp(respuesta, consulta) {
  if (respuesta.http === 200) return;
  const mensajes = {
    401: 'Facturama rechazó las credenciales productivas.',
    403: 'La cuenta no permite esta operación. Revisa el acceso API.',
    429: 'Facturama limitó temporalmente las peticiones. Espera antes de consultar otra vez.'
  };
  throw fallo('API_RECHAZADA', mensajes[respuesta.http] || `No se pudo completar la consulta de ${consulta}.`, respuesta.http);
}

function registroRemoto(respuesta, rfc, ahora) {
  exigirHttp(respuesta, 'CSD');
  const datos = respuesta.datos;
  const registro = Array.isArray(datos)
    ? datos.length === 1 && datos[0]
    : datos;
  if (!registro || normalizarRfc(registro.Rfc) !== rfc) {
    throw fallo('RESPUESTA_INVALIDA', 'La API no confirmó un registro único del RFC solicitado.');
  }
  let certificado = null;
  if (typeof registro.Certificate === 'string' && registro.Certificate.trim()) {
    try { certificado = validarCertificado(Buffer.from(registro.Certificate, 'base64'), rfc, ahora); }
    catch (error) { throw error instanceof PreparacionError ? error : fallo('RESPUESTA_INVALIDA', 'No se pudo verificar el certificado público devuelto por la API.'); }
  }
  return {
    certificado,
    resumen: {
      consulta: 'CSD', HTTP: 200, rfcCoincide: true,
      vencimiento: certificado ? new Date(certificado.validTo).toISOString() : fechaResumen(registro.CsdExpirationDate),
      certificadoPublicoVerificado: Boolean(certificado)
    }
  };
}

export async function main(args = process.argv.slice(2), {
  directory = process.cwd(), environment = process.env, fetchImpl = globalThis.fetch,
  log = console.log, ahora = Date.now(), timeoutMs = 20000
} = {}) {
  if (args.length === 1 && args[0] === '--help') {
    log('Uso: node preparar-facturama-produccion.mjs [--validar-archivos | --registrar-csd]');
    log('Ejecuta desde la carpeta de tu proyecto. Lee su .env; no lo modifica.');
    log('Sin argumentos solo consulta cuenta y CSD. Nunca emite CFDI ni reemplaza certificados.');
    return 0;
  }
  if (args.length > 1 || args.some(x => !['--validar-archivos', '--registrar-csd'].includes(x))) {
    throw fallo('ARGUMENTO_INVALIDO', 'Usa --help, --validar-archivos o --registrar-csd.');
  }
  const config = await leerConfiguracion(directory, environment);
  let archivos;
  try {
    if (args.length) archivos = await validarArchivos(config, ahora);
    if (args[0] === '--validar-archivos') {
      log(JSON.stringify({
        consulta: 'Archivos CSD', estado: 'VALIDADOS_LOCALMENTE',
        rfcCoincide: true, llaveCoincide: true, usoCsd: true,
        vencimiento: new Date(archivos.certificado.validTo).toISOString(),
        peticionesRealizadas: 0, cfdiEmitidos: 0
      }));
      return 0;
    }
    const solicitar = cliente(config, fetchImpl, timeoutMs);
    const cuenta = await solicitar('/SuscriptionPlan');
    exigirHttp(cuenta, 'cuenta');
    if (!cuenta.datos || Array.isArray(cuenta.datos) || typeof cuenta.datos.Plan !== 'string') {
      throw fallo('RESPUESTA_INVALIDA', 'La API no confirmó el plan de la cuenta.');
    }
    log(JSON.stringify({
      consulta: 'Cuenta', HTTP: 200, plan: cuenta.datos.Plan,
      folios: foliosResumen(cuenta.datos.CurrentFolios), vencimiento: fechaResumen(cuenta.datos.ExpirationDate)
    }));
    const rutaCsd = '/api-lite/csds/' + encodeURIComponent(config.FACTURAMA_PRODUCTION_RFC);
    const consulta = await solicitar(rutaCsd);
    if (consulta.http !== 404) {
      const remoto = registroRemoto(consulta, config.FACTURAMA_PRODUCTION_RFC, ahora);
      if (archivos && (!remoto.certificado || !remoto.certificado.raw.equals(archivos.certificado.raw))) {
        throw fallo('CSD_EXISTENTE_NO_REEMPLAZADO', 'Ya existe un registro del RFC y no se confirmó que sea el mismo certificado. No se reemplazó.');
      }
      log(JSON.stringify({ ...remoto.resumen, estado: 'YA_REGISTRADO', seModifico: false, cfdiEmitidos: 0 }));
      return 0;
    }
    if (!archivos) {
      log(JSON.stringify({ consulta: 'CSD', HTTP: 404, estado: 'PENDIENTE_REGISTRO', cfdiEmitidos: 0 }));
      return 2;
    }
    // No se reenvía automáticamente el POST, incluso si responde 500 o se interrumpe.
    let httpRegistro = null;
    try {
      const registro = await solicitar('/api-lite/csds', 'POST', {
        Rfc: config.FACTURAMA_PRODUCTION_RFC,
        Certificate: archivos.certificado.raw.toString('base64'),
        PrivateKey: archivos.key.toString('base64'), PrivateKeyPassword: archivos.password
      });
      httpRegistro = registro.http;
    } catch (error) {
      if (!(error instanceof PreparacionError)) throw error;
    }
    try {
      const confirmado = registroRemoto(await solicitar(rutaCsd), config.FACTURAMA_PRODUCTION_RFC, ahora);
      if (!confirmado.certificado || !confirmado.certificado.raw.equals(archivos.certificado.raw)) throw new Error();
      log(JSON.stringify({
        ...confirmado.resumen, estado: 'REGISTRO_CONFIRMADO', HTTPRegistro: httpRegistro,
        certificadoCoincideConArchivo: true, cfdiEmitidos: 0
      }));
      return 0;
    } catch {
      throw fallo('CSD_NO_CONFIRMADO', 'Se intentó registrar el CSD, pero aún no se confirmó el mismo certificado. Ejecuta este archivo SIN argumentos para consultar; no vuelvas a registrar todavía.', httpRegistro ?? undefined);
    }
  } finally { archivos?.key.fill(0); }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try { process.exitCode = await main(); }
  catch (error) {
    const seguro = error instanceof PreparacionError;
    console.error(JSON.stringify({
      ok: false, codigo: seguro ? error.codigo : 'ERROR_PREPARACION',
      error: seguro ? error.message : 'No se pudo completar la preparación. No compartas contraseñas ni archivos privados.',
      ...(seguro && error.http !== undefined ? { HTTP: error.http } : {}), cfdiEmitidos: 0
    }));
    process.exitCode = 1;
  }
}

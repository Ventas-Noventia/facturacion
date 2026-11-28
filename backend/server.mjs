// Validación receptor Noventia v1
import { revisarReceptor } from "../public/compatibilidad-receptor.mjs";
// Portal de autofacturación por ticket Noventia
import {randomBytes, createHash} from "node:crypto";
import {regimenesTicket} from "../public/regimenes-ticket.mjs";
import noventiaPdf from './services/noventia-pdf.cjs';
const { disenar } = noventiaPdf;
import { mensajeUsoRegimen } from "../shared/domain/validaciones.mjs";
import { ProductoFiscalRepository } from "./repositories/productoFiscalRepository.mjs";
import { validarLoteFiscal } from "../shared/domain/catalogoFiscal.mjs";
import { CorreoFacturaService, validarEnvio } from "./services/correoFacturaService.mjs";
import http from "node:http";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { LocalFacturaRepository } from "./repositories/localFacturaRepository.mjs";
import { SupabaseFacturaRepository } from "./repositories/supabaseFacturaRepository.mjs";
import { LocalUsuarioRepository } from "./repositories/localUsuarioRepository.mjs";
import { LocalClienteFiscalRepository } from "./repositories/localClienteFiscalRepository.mjs";
import { SupabaseClienteFiscalRepository } from "./repositories/supabaseClienteFiscalRepository.mjs";
import { SupabaseProfileRepository } from "./repositories/supabaseProfileRepository.mjs";
import { SupabasePortalClienteRepository } from "./repositories/supabasePortalClienteRepository.mjs";
import { SupabaseConfiguracionFiscalRepository } from "./repositories/supabaseConfiguracionFiscalRepository.mjs";
import { SupabaseAuditoriaRepository } from "./repositories/supabaseAuditoriaRepository.mjs";
import { LocalAuditoriaRepository } from "./repositories/localAuditoriaRepository.mjs";
import { MockTimbradoService } from "./services/mockTimbradoService.mjs";
import { MockCancelacionService } from "./services/mockCancelacionService.mjs";
import { CancelacionSandboxService } from "./services/cancelacionSandboxService.mjs";
import { EcommerceJsonService } from "./services/ecommerceJsonService.mjs";
import { EcommerceApiService } from "./services/ecommerceApiService.mjs";
import { PortalFacturasService, resumenFacturaPortal } from "./services/portalFacturasService.mjs";
import { conceptosActualesEcommerce, validarVentaParaFacturar, ventaCoincideConFactura } from "./services/ecommerceVentaService.mjs";
import { FirebaseJsonService } from "./services/firebaseJsonService.mjs";
import { PedidosService } from "./services/pedidosService.mjs";
import { ReportesService } from "./services/reportesService.mjs";
import { LocalAuthService } from "./services/localAuthService.mjs";
import { SupabaseAuthService } from "./services/supabaseAuthService.mjs";
import { SupabaseDocumentStorageService } from "./services/supabaseDocumentStorageService.mjs";
import { crearFactura, DatosFacturaError } from "../shared/domain/factura.mjs";
import { clienteFacturamaProduccion, configuracionTimbrado } from "./config/timbrado.mjs";
import { TimbradoSandboxService } from "./services/timbradoSandboxService.mjs";
import { TimbradoProduccionService } from "./services/timbradoProduccionService.mjs";
import { CancelacionProduccionService } from "./services/cancelacionProduccionService.mjs";
import { pedidoProduccion, conceptosPedidoProduccion, pedidoCoincideProduccion } from "./services/pedidoProduccionService.mjs";
import { errorProduccion, validarEmisorProduccion } from "./services/produccionFiscal.mjs";
import { loadEnv } from "./config/loadEnv.mjs";
import {applySecurityHeaders,readJsonBody,loginRateStatus,recordLoginFailure,clearLoginFailures,trustedMutationOrigin,validateProductionEnvironment} from "./security/httpSecurity.mjs";
import { diagnosticoError } from "./security/diagnosticoError.mjs";

loadEnv();
validateProductionEnvironment();

const dir = path.dirname(fileURLToPath(import.meta.url));
const publicDir = path.join(dir, "..", "public");
const storageRoot = path.join(dir, "storage");
const port = Number(process.env.PORT || 3000);

const supabaseConfigured = Boolean(process.env.SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY);
const authConfigured = Boolean(supabaseConfigured && process.env.SUPABASE_PUBLISHABLE_KEY);
const facturas = supabaseConfigured
  ? new SupabaseFacturaRepository({
      url: process.env.SUPABASE_URL,
      serviceRoleKey: process.env.SUPABASE_SERVICE_ROLE_KEY
    })
  : new LocalFacturaRepository();
const usuarios = supabaseConfigured
  ? new SupabaseProfileRepository({url:process.env.SUPABASE_URL,serviceRoleKey:process.env.SUPABASE_SERVICE_ROLE_KEY})
  : new LocalUsuarioRepository();
const clientes = supabaseConfigured
  ? new SupabaseClienteFiscalRepository({
      url:process.env.SUPABASE_URL,
      serviceRoleKey:process.env.SUPABASE_SERVICE_ROLE_KEY
    })
  : new LocalClienteFiscalRepository();
const timbradoConfig = configuracionTimbrado();
const pac = new MockTimbradoService();
const cancelador = new MockCancelacionService();
const reportes = new ReportesService();
const auth = new LocalAuthService();
const supabaseAuth = authConfigured
  ? new SupabaseAuthService({url:process.env.SUPABASE_URL,publishableKey:process.env.SUPABASE_PUBLISHABLE_KEY})
  : null;
const documentStorage = supabaseConfigured
  ? new SupabaseDocumentStorageService({
      url:process.env.SUPABASE_URL,
      serviceRoleKey:process.env.SUPABASE_SERVICE_ROLE_KEY,
      bucket:process.env.SUPABASE_DOCUMENT_BUCKET||"documentos-fiscales"
    })
  : null;
const configuracionFiscal=supabaseConfigured?new SupabaseConfiguracionFiscalRepository({url:process.env.SUPABASE_URL,serviceRoleKey:process.env.SUPABASE_SERVICE_ROLE_KEY}):null;
const auditoria=supabaseConfigured?new SupabaseAuditoriaRepository({url:process.env.SUPABASE_URL,serviceRoleKey:process.env.SUPABASE_SERVICE_ROLE_KEY}):new LocalAuditoriaRepository();
const portalClientes=supabaseConfigured?new SupabasePortalClienteRepository({url:process.env.SUPABASE_URL,serviceRoleKey:process.env.SUPABASE_SERVICE_ROLE_KEY}):null;
const portalFacturas=new PortalFacturasService({facturas,documentStorage,storageRoot});
const timbradoSandbox = timbradoConfig.clienteSandbox ? new TimbradoSandboxService({facturas,pac:timbradoConfig.clienteSandbox,storageRoot,documentStorage}) : null;
const timbradoProduccion = timbradoConfig.clienteProduccion ? new TimbradoProduccionService({facturas,pac:timbradoConfig.clienteProduccion,storageRoot,documentStorage,obtenerEmisor:()=>configuracionFiscal?.get()}) : null;
const ambienteBorrador = timbradoConfig.produccion ? "PRODUCCION" : timbradoConfig.sandbox ? "SANDBOX" : "MOCK";
const operacionesFactura=new Set();
const catalogoFiscal = new ProductoFiscalRepository({url:supabaseConfigured?process.env.SUPABASE_URL:"",serviceRoleKey:process.env.SUPABASE_SERVICE_ROLE_KEY});
const correoFacturas=new CorreoFacturaService();
const pedidos = new PedidosService({
  catalogoFiscal,
  ecommerceService: process.env.ECOMMERCE_SOURCE === "json" ? new EcommerceJsonService() : new EcommerceApiService(),
  firebaseService: new FirebaseJsonService({projectId:process.env.FIREBASE_PROJECT_ID})
});
const liberarPedido = factura=>pedidos.desmarcarFacturado(factura.pedido,factura.id);
const cancelacionSandbox = timbradoConfig.clienteSandbox ? new CancelacionSandboxService({facturas,pac:timbradoConfig.clienteSandbox,liberarPedido}) : null;
const cancelacionProduccion = timbradoConfig.clienteProduccion ? new CancelacionProduccionService({facturas,pac:timbradoConfig.clienteProduccion,liberarPedido}) : null;

async function verificarCompraProduccion(factura) {
  const referencia = factura.pedido?.fuente === "ECOMMERCE_API" ? String(factura.pedido.ecommerceId) : factura.folioOrigen;
  const actual = await pedidos.obtenerPedido(referencia);
  if (!pedidoCoincideProduccion(actual, factura)) throw errorProduccion("La compra cambió desde el borrador. Revisa el pedido y sus importes antes de emitir.", "PRODUCCION_VENTA_MODIFICADA", 409);
}


const mime = {
  ".html":"text/html; charset=utf-8",
  ".css":"text/css; charset=utf-8",
  ".js":"application/javascript; charset=utf-8",
  ".mjs":"application/javascript; charset=utf-8",
  ".xml":"application/xml; charset=utf-8",
  ".pdf":"application/pdf"
};

function send(res, status, body) {
  res.setHeader("Cache-Control","no-store");
  res.writeHead(status, {"Content-Type":"application/json; charset=utf-8"});
  res.end(JSON.stringify(body));
}

function errorFuente(res, error) {
  if (error.retryAfter > 0) res.setHeader("Retry-After", String(error.retryAfter));
  return send(res, 503, { error: `No fue posible consultar el pedido: ${error.message}`,
    ...(error.requestId ? { requestId: error.requestId } : {}) });
}

async function facturaExistentePedido(pedido) {
  if (pedido.fuente === "ECOMMERCE_API") {
    const byId = facturas.findByEcommerceId
      ? await facturas.findByEcommerceId(pedido.ecommerceId)
      : (await facturas.list()).find(f => f.pedido?.fuente === "ECOMMERCE_API" &&
          String(f.pedido.ecommerceId) === String(pedido.ecommerceId) && !String(f.estatus || "").startsWith("CANCELADA"));
    if (byId) return byId;
  }
  return facturas.findByFolioOrigen(pedido.folio);
}

function referenciaPedido(pedido) {
  return pedido.fuente === "ECOMMERCE_API"
    ? { ecommerceId: pedido.ecommerceId, fuente: pedido.fuente, estadoOriginal: pedido.estado,
        importesOrigen: pedido.importesOrigen, descuentoPedido: pedido.descuentoPedido,
        reembolsoConfirmado: pedido.reembolsoConfirmado }
    : { firebaseId: pedido.firebaseId, fuente: pedido.fuente, estadoOriginal: pedido.estado };
}

async function body(req) {
  return readJsonBody(req);
}

function cookies(req){
  return Object.fromEntries(String(req.headers.cookie||"").split(";").map(x=>x.trim()).filter(Boolean).map(x=>{
    const i=x.indexOf("=");return[decodeURIComponent(x.slice(0,i)),decodeURIComponent(x.slice(i+1))];
  }));
}

function authCookies(res,session,prefix="facturacion"){
  const secure=process.env.APP_ENV==="production"?"; Secure":"";
  res.setHeader("Set-Cookie",[
    `${prefix}_access=${encodeURIComponent(session.access_token)}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${Number(session.expires_in||3600)}${secure}`,
    `${prefix}_refresh=${encodeURIComponent(session.refresh_token)}; HttpOnly; SameSite=Strict; Path=/; Max-Age=2592000${secure}`
  ]);
}

function clearAuthCookies(res,prefix="facturacion"){
  res.setHeader("Set-Cookie",[
    `${prefix}_access=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0`,
    `${prefix}_refresh=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0`
  ]);
}

async function authenticate(req,res){
  if(!supabaseAuth){send(res,503,{error:"Supabase Auth no está configurado"});return null}
  const current=cookies(req);
  let user;
  try{user=await supabaseAuth.getUser(current.facturacion_access)}
  catch{
    if(!current.facturacion_refresh){send(res,401,{error:"Inicia sesión para continuar"});return null}
    try{
      const refreshed=await supabaseAuth.refresh(current.facturacion_refresh);
      authCookies(res,refreshed);
      user=refreshed.user;
    }catch{clearAuthCookies(res);send(res,401,{error:"Tu sesión terminó. Inicia sesión nuevamente"});return null}
  }
  const profile=await usuarios.findById(user.id);
  if(!profile||!profile.activo){clearAuthCookies(res);send(res,403,{error:"Tu usuario no tiene un perfil activo"});return null}
  return{user,profile};
}

async function allow(req, res, permission) {
  const session=await authenticate(req,res);
  if(!session)return false;
  if (!auth.can(session.profile.rol, permission)) {
    send(res, 403, {error:"No tienes permiso para realizar esta acción", role:session.profile.rol, permission});
    return false;
  }
  req.session=session;
  return true;
}

async function authenticatePortal(req,res){
  res.setHeader("Cache-Control","no-store");
  if(!supabaseAuth||!portalClientes){send(res,503,{error:"El portal de clientes no está configurado"});return null}
  const current=cookies(req);
  let user;
  try{user=await supabaseAuth.getUser(current.portal_access)}
  catch{
    if(!current.portal_refresh){send(res,401,{error:"Inicia sesión para continuar"});return null}
    try{const refreshed=await supabaseAuth.refresh(current.portal_refresh);authCookies(res,refreshed,"portal");user=refreshed.user}
    catch{clearAuthCookies(res,"portal");send(res,401,{error:"Tu sesión terminó. Inicia sesión nuevamente"});return null}
  }
  const cliente=await portalClientes.findById(user.id);
  if(!cliente||!cliente.activo){clearAuthCookies(res,"portal");send(res,403,{error:"No existe un perfil de cliente activo"});return null}
  return{user,cliente};
}

function datoComparable(valor){return String(valor||"").trim().toLowerCase()}
function pedidoPerteneceACliente(pedido,user){
  const email=datoComparable(user.email);
  return Boolean(user.email_confirmed_at && email && email===datoComparable(pedido?.cliente?.email));
}

async function registrarAuditoria(req,factura,accion,detalle={}){
  try{
    await auditoria.save({facturaId:factura?.id,folioInterno:factura?.folioInterno,folioOrigen:factura?.folioOrigen,accion,usuarioId:req.session?.user?.id,usuarioNombre:req.session?.profile?.nombre,usuarioEmail:req.session?.user?.email,detalle});
  }catch(error){console.error("Bitácora:",error.message)}
}

async function serveFile(res, filePath, downloadName) {
  try {
    const data = await fs.readFile(filePath);
    const headers = {"Content-Type": mime[path.extname(filePath)] || "application/octet-stream"};
    if (downloadName) headers["Content-Disposition"] = `attachment; filename="${downloadName}"`;
    res.writeHead(200, headers);
    res.end(data);
    return true;
  } catch (e) {
    if (e.code === "ENOENT") {
      res.writeHead(404, {"Content-Type":"text/plain; charset=utf-8"});
      res.end("Not found");
      return false;
    }
    throw e;
  }
}

async function pdfParaDescarga(factura, leerXml, original) {
  if (factura.ambienteTimbrado !== "PRODUCCION" || factura.estatus !== "TIMBRADA" || !factura.uuid) return original;
  try {
    const xml = await leerXml();
    return await disenar(xml, original, factura.folioInterno, factura.uuid);
  } catch {
    console.warn("Se entrega el PDF del proveedor para el folio", factura.folioInterno);
    return original;
  }
}

function serveBytes(res,bytes,contentType,downloadName){
  res.writeHead(200,{
    "Content-Type":contentType,
    "Content-Disposition":`attachment; filename="${downloadName}"`,
    "Content-Length":bytes.length
  });
  res.end(bytes);
}

async function respuestaTicket(req,res,factura){
  try{
    const emitida=await emitirFactura(req,factura);
    return send(res,201,resumenFacturaPortal(emitida));
  }catch(error){
    const {body:diag}=diagnosticoError(error,"EMITIR_PORTAL");
    const mensaje=motivoReceptorTicket(error);
    let editable=false;
    if(mensaje && error.borradorRechazado?.id===factura.id){
      const guardada=await facturas.compareAndUpdate(error.borradorRechazado,{avisoCorreccion:mensaje});
      editable=Boolean(guardada);
    }
    await registrarAuditoria(req,factura,"REVISION_PORTAL",{codigo:diag.codigo,referencia:diag.referencia,corregible:editable,motivo:editable?mensaje:undefined});
    return send(res,202,{id:factura.id,folioInterno:factura.folioInterno,requiereRevision:true,corregible:editable,mensaje:editable?mensaje:undefined});
  }
}

function motivoReceptorTicket(error){
  if(error.code!=="PRODUCCION_RECHAZO_DATOS" || error.faseFacturama!=="CREAR_CFDI" || !error.rechazo || ![400,422].includes(error.httpStatus))return "";
  const detalle=(error.camposFacturama||[]).join(" ")+" "+String(error.message).split("Detalle:").slice(1).join(" ");
  if(/Receiver\.Name|nombre del receptor|nombre.*asociado al rfc/i.test(detalle))return "Revisa el nombre completo y el RFC tal como aparecen en tu constancia fiscal.";
  if(/Receiver\.(?:CfdiUse|FiscalRegime)|uso\s*cfdi|r[eé]gimen fiscal del receptor/i.test(detalle))return "Revisa el régimen fiscal y el uso de CFDI del receptor.";
  if(/Receiver\.TaxZipCode|domicilio fiscal del receptor|c[oó]digo postal.*receptor/i.test(detalle))return "Revisa el código postal del domicilio fiscal del receptor.";
  if(/Receiver\.Rfc|RFC del receptor/i.test(detalle))return "Verifica el RFC del receptor en su constancia fiscal.";
  return "";
}

async function emitirFactura(req,factura) {
  const problemaFiscal=revisarReceptor(factura.cliente,factura.usoCfdi); if(problemaFiscal)throw new DatosFacturaError(problemaFiscal);
  if(timbradoConfig.produccion){
    if(factura.ambienteOperacion!=="PRODUCCION")throw errorProduccion("Este borrador es de pruebas o anterior a producción. Elimínalo si sigue en borrador y crea uno nuevo desde la compra.","PRODUCCION_BORRADOR_OTRO_AMBIENTE",409);
    await verificarCompraProduccion(factura);
    const updated=await timbradoProduccion.timbrar(factura);
    await registrarAuditoria(req,updated,"TIMBRADO",{estatus:updated.estatus,uuid:updated.uuid,pac:"facturama_produccion",facturamaId:updated.timbradoProduccion?.facturamaId});
    return updated;
  }
  if(factura.ambienteOperacion==="PRODUCCION")throw errorProduccion("Activa el proveedor productivo para emitir este borrador.","PRODUCCION_BORRADOR_OTRO_AMBIENTE",409);
  if(factura.pedido?.fuente==="ECOMMERCE_API"){
    let actual;
    try { actual=await pedidos.obtenerPedido(String(factura.pedido.ecommerceId)); }
    catch(error) {
      error.statusCode=503;
      error.consultaFuente=true;
      throw error;
    }
    if(!actual)throw Object.assign(new Error("La venta del e-commerce ya no está disponible"),{statusCode:404});
    validarVentaParaFacturar(actual);
    if(!ventaCoincideConFactura(actual,factura))
      throw Object.assign(new Error("La venta cambió desde que se guardó el borrador. Actualízalo antes de timbrar"),{statusCode:409});
  }
  if(timbradoConfig.sandbox){
    const updated=await timbradoSandbox.timbrar(factura);
    await registrarAuditoria(req,updated,"TIMBRADO",{estatus:updated.estatus,uuid:updated.uuid,pac:"facturama_sandbox",facturamaId:updated.timbradoSandbox?.facturamaId});
    return updated;
  }
  const emisor=await configuracionFiscal?.get();
  const result = await pac.timbrar({...factura,emisor:emisor||undefined});
  let storagePaths={};
  if(documentStorage){
    storagePaths=await documentStorage.guardarArchivos({
      factura,
      fechaTimbrado:result.fechaTimbrado,
      xmlFile:path.join(storageRoot,result.xmlRelativePath),
      pdfFile:path.join(storageRoot,result.pdfRelativePath)
    });
  }
  const updated = await facturas.update(factura.id,{
    estatus:result.estatus,
    uuid:result.uuid,
    fechaTimbrado:result.fechaTimbrado,
    xmlRelativePath:result.xmlRelativePath,
    pdfRelativePath:result.pdfRelativePath,
    ...storagePaths,
    documentStorage:documentStorage?"supabase":"local"
  });
  await registrarAuditoria(req,updated,"TIMBRADO",{estatus:updated.estatus,uuid:updated.uuid,pac:"mock"});
  return updated;
}

http.createServer(async (req, res) => {
  let operacionFacturaId=null;
  let etapaError="SOLICITUD";
  function reservarOperacion(id){
    if(operacionesFactura.has(id)){
      const error=new Error("Esta factura tiene una operación en curso. Espera a que termine y actualiza el historial.");
      error.statusCode=409;throw error;
    }
    operacionesFactura.add(id);operacionFacturaId=id;
  }
  try {
    applySecurityHeaders(res,{production:process.env.APP_ENV==="production"});
    const u = new URL(req.url, `http://${req.headers.host}`);

    if(["POST","PUT","PATCH","DELETE"].includes(req.method)&&!trustedMutationOrigin(req))
      return send(res,403,{error:"Origen de solicitud no autorizado"});

    if (req.method === "GET" && u.pathname === "/favicon.ico") {
      res.writeHead(204);
      return res.end();
    }


    if (req.method === "GET" && u.pathname === "/api/health")
      return send(res, 200, {ok:true, version:"1.20.0", mode:supabaseConfigured?"supabase":"local", auth:authConfigured?"supabase":"missing", pac:timbradoConfig.provider});

    if (req.method === "GET" && u.pathname === "/api/timbrado/configuracion") {
      if (!(await allow(req,res,"facturas:ver"))) return;
      return send(res,200,{provider:timbradoConfig.provider,sandbox:timbradoConfig.sandbox,produccion:timbradoConfig.produccion,sandboxDisponible:Boolean(timbradoSandbox),produccionDisponible:Boolean(timbradoProduccion),etiqueta:timbradoConfig.etiqueta});
    }

    if (req.method === "GET" && u.pathname === "/api/timbrado/produccion/estado") {
      if (!(await allow(req,res,"config:gestionar"))) return;
      const pendientes = []; let verificacion = null;
      try {
        const cliente = timbradoConfig.clienteProduccion || clienteFacturamaProduccion();
        verificacion = await cliente.verificarConexion();
        try { validarEmisorProduccion(await configuracionFiscal?.get(), cliente.rfc); }
        catch (error) { pendientes.push(error.message); }
      } catch (error) { pendientes.push(error.statusCode ? error.message : "No fue posible verificar la configuración productiva."); }
      return send(res,200,{ok:pendientes.length===0,provider:timbradoConfig.provider,emisionHabilitada:timbradoConfig.produccion&&pendientes.length===0,
        ...verificacion,pendientes,cfdiEmitidos:0});
    }

    if (req.method === "POST" && u.pathname === "/api/auth/login") {
      if(!supabaseAuth)return send(res,503,{error:"Falta configurar SUPABASE_PUBLISHABLE_KEY"});
      const input=await body(req);
      if(!input.email||!input.password)return send(res,400,{error:"Correo y contraseña son obligatorios"});
      const rate=loginRateStatus(req,input.email);
      if(!rate.allowed){res.setHeader("Retry-After",String(rate.retryAfter));return send(res,429,{error:"Demasiados intentos. Espera unos minutos antes de volver a intentarlo"})}
      let session;
      try{session=await supabaseAuth.login(String(input.email).trim().toLowerCase(),String(input.password))}
      catch{recordLoginFailure(rate.key);return send(res,401,{error:"Correo o contraseña incorrectos"})}
      const profile=await usuarios.findById(session.user.id);
      if(!profile||!profile.activo)return send(res,403,{error:"Tu usuario no tiene un perfil activo"});
      clearLoginFailures(rate.key);
      authCookies(res,session);
      return send(res,200,{user:{id:session.user.id,email:session.user.email},profile,permissions:auth.permissionsFor(profile.rol)});
    }

    if (req.method === "POST" && u.pathname === "/api/auth/logout") {
      clearAuthCookies(res);
      return send(res,200,{ok:true});
    }

    if(req.method==="POST"&&u.pathname==="/api/portal/logout"){
      clearAuthCookies(res,"portal");
      return send(res,200,{ok:true});
    }

    if(req.method==="GET" && u.pathname==="/portal.html"){res.setHeader("Cache-Control","no-store");return serveFile(res,path.join(publicDir,"autofactura.html"));}
    if(req.method==="GET" && ["/portal-login.html","/portal-registro.html"].includes(u.pathname)){
      res.writeHead(302,{Location:"/portal.html","Cache-Control":"no-store"});return res.end();
    }
    if(req.method==="GET" && u.pathname==="/api/ticket/config"){
      const email=String(process.env.FACTURACION_CONTACTO_EMAIL||"factura.noventia@gmail.com").trim();
      const whatsapp=String(process.env.FACTURACION_CONTACTO_WHATSAPP||"").replace(/[^0-9]/g,"");
      return send(res,200,{email:/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)?email:"",
        whatsapp:/^\d{10,15}$/.test(whatsapp)?whatsapp:""});
    }
    if(req.method==="GET" && /^\/api\/ticket\/documentos\/[a-f\d-]{36}\/(pdf|xml)$/.test(u.pathname)){
      const [, , , ,id,tipo]=u.pathname.split("/");
      res.setHeader("Cache-Control","private, no-store");
      const token=cookies(req)["ticket_"+id];
      if(!/^[a-f0-9]{64}$/.test(token||""))return send(res,403,{error:"El acceso a esta descarga terminó. Contacta a Noventia con tu folio."});
      const propietario="ticket:"+createHash("sha256").update(token).digest("hex");
      const factura=await portalFacturas.facturaPropia(propietario,id);
      if(!factura.descargaHasta || Date.parse(factura.descargaHasta)<=Date.now())return send(res,403,{error:"El acceso a esta descarga terminó."});
      const documento=await portalFacturas.documento(propietario,id,tipo);
      let bytes=documento.bytes;
      if(tipo==="pdf" && typeof pdfParaDescarga==="function"){
        bytes=await pdfParaDescarga(factura,async()=>(await portalFacturas.documento(propietario,id,"xml")).bytes,bytes);
      }
      await registrarAuditoria(req,factura,"DESCARGA_DOCUMENTO",{tipo,canal:"AUTOFACTURACION"});
      return serveBytes(res,bytes,documento.contentType,documento.nombre);
    }
    const correccion=req.method==="POST" && u.pathname.match(/^\/api\/ticket\/documentos\/([a-f\d-]{36})\/(datos-correccion|corregir)$/);
    if(correccion){
      res.setHeader("Cache-Control","private, no-store");
      const [,id,accion]=correccion;
      const token=cookies(req)["ticket_"+id];
      if(!/^[a-f0-9]{64}$/.test(token||""))return send(res,403,{error:"Abre la solicitud desde el navegador donde la generaste."});
      const propietario="ticket:"+createHash("sha256").update(token).digest("hex");
      if(accion==="corregir")reservarOperacion(id);
      const f=await portalFacturas.facturaPropia(propietario,id);
      if(!(Date.parse(f.descargaHasta)>Date.now()))return send(res,403,{error:"La sesión terminó. Contacta a Noventia con tu folio."});
      if(f.estatus!=="BORRADOR" || f.uuid || f.timbradoProduccion || f.timbradoSandbox || !f.avisoCorreccion || f.canal!=="TICKET" || f.ambienteOperacion!=="PRODUCCION" || !timbradoConfig.produccion)
        return send(res,409,{error:"Este folio ya no admite una corrección. Consulta su estado con Noventia."});
      if(accion==="datos-correccion")return send(res,200,{revision:f.revision,cliente:f.cliente,usoCfdi:f.usoCfdi,formaPago:f.formaPago,mensaje:f.avisoCorreccion});
      const datos=await readJsonBody(req,12000), p=datos.receptor||{};
      if(datos.revision!==f.revision || datos.acepta!==true)return send(res,409,{error:"Vuelve a abrir la corrección y confirma los datos actualizados."});
      const cliente={...f.cliente,tipoPersona:p.tipoPersona,rfc:String(p.rfc||"").trim().toUpperCase(),razonSocial:String(p.razonSocial||"").trim(),codigoPostal:p.codigoPostal,regimenFiscal:p.regimenFiscal};
      const error=revisarReceptor(cliente,p.usoCfdi);
      if(error || !["FISICA","MORAL"].includes(cliente.tipoPersona) || !["G01","G03","S01"].includes(p.usoCfdi) || !cliente.razonSocial || cliente.razonSocial.length>254 || !/^\d{5}$/.test(cliente.codigoPostal))
        return send(res,400,{error:error||"Verifica nombre, código postal, tipo de persona y uso de CFDI."});
      const actual=await facturas.compareAndUpdate(f,{cliente,usoCfdi:p.usoCfdi,avisoCorreccion:null});
      if(!actual)return send(res,409,{error:"El folio cambió. Vuelve a consultar su estado."});
      req.session={user:{email:f.cliente.email},profile:{nombre:cliente.razonSocial}};
      await registrarAuditoria(req,actual,"CORRECCION_PORTAL",{campos:[...Object.keys(cliente).filter(k=>cliente[k]!==f.cliente[k]),...(f.usoCfdi!==p.usoCfdi?["usoCfdi"]:[])]});
      return await respuestaTicket(req,res,actual);
    }
    if(req.method==="POST" && ["/api/ticket/buscar","/api/ticket/emitir"].includes(u.pathname)){
      const input=await readJsonBody(req,12000);
      const rate=loginRateStatus(req,"autofacturacion");
      if(!rate.allowed){res.setHeader("Retry-After",String(rate.retryAfter));return send(res,429,{error:"Espera unos minutos antes de intentar otra búsqueda."});}
      const folio=String(input?.folio||"").trim(), contacto=String(input?.contacto||"").trim().toLowerCase();
      const total=String(input?.monto||"");
      const rechazar=()=>{recordLoginFailure(rate.key);return send(res,400,{error:"Revisa el folio, el monto y el correo o teléfono que diste al comprar."});};
      if(!folio || folio.length>65 || !contacto || contacto.length>254 || !/^\d{1,10}(\.\d{1,2})?$/.test(total) || Number(total)<=0)return rechazar();
      let pedido;
      try{pedido=await pedidos.obtenerPedido(folio);}catch{return send(res,503,{error:"No se pudo consultar la compra. Vuelve a intentarlo en unos minutos."});}
      if(!pedido)return rechazar();
      const email=String(pedido.cliente?.email||"").trim().toLowerCase();
      const telMX=v=>{const digits=String(v||"").replace(/[\s()+.-]/g,"");return /^(?:52)?\d{10}$/.test(digits)?digits.slice(-10):"";};
      const tel=telMX(pedido.cliente?.telefono);
      const coincide=contacto.includes("@") ? Boolean(email && contacto===email) : Boolean(tel && tel===telMX(contacto));
      if(!coincide || Math.round(Number(total)*100)!==Math.round(Number(pedido.totalPedido)*100))return rechazar();
      if(pedido.cancelado || pedido.facturado || await facturaExistentePedido(pedido))return send(res,409,{error:"Esta compra ya tiene una solicitud o no está disponible para facturar. Contacta a Noventia con el folio."});
      validarVentaParaFacturar(pedido);
      if(timbradoConfig.produccion)pedidoProduccion(pedido);
      if(u.pathname.endsWith("/buscar"))return send(res,200,{folio:pedido.folio,total:pedido.totalPedido});
      const perfil=input.receptor||{};
      if(input.acepta!==true)return send(res,400,{error:"Confirma tus datos y acepta el aviso de privacidad."});
      if(!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(perfil.email||"")))return send(res,400,{error:"Ingresa un correo de contacto válido."});
      const problemaFiscal=revisarReceptor(perfil,perfil.usoCfdi); if(problemaFiscal)throw new DatosFacturaError(problemaFiscal);
      const persona=perfil.tipoPersona;
      if(String(perfil.rfc||"").trim().length!==(persona==="MORAL"?12:13))return send(res,400,{error:"El RFC no coincide con el tipo de persona."});
      if(!regimenesTicket.some(([clave,,tipos])=>clave===perfil.regimenFiscal && tipos.includes(persona)))return send(res,400,{error:"Revisa el régimen y tipo de persona."});
      if(!["G01","G03","S01"].includes(perfil.usoCfdi))return send(res,400,{error:"Selecciona un uso de CFDI disponible."});
      if(input.metodoPago!=="PUE")return send(res,400,{error:"El portal admite compras pagadas en una sola exhibición."});
      const token=randomBytes(32).toString("hex");
      const propietario="ticket:"+createHash("sha256").update(token).digest("hex");
      if(timbradoConfig.produccion){
        if(input.metodoPago!=="PUE")throw new DatosFacturaError("Esta compra requiere pago en una sola exhibición.");
        const errorUso=mensajeUsoRegimen(perfil.regimenFiscal,perfil.usoCfdi);
        if(errorUso)throw new DatosFacturaError(errorUso);
      }
      const factura={...crearFactura({formaPago:input.formaPago,metodoPago:input.metodoPago,origen:pedido.origen,folioOrigen:pedido.folio,cliente:{tipoPersona:perfil.tipoPersona,razonSocial:perfil.razonSocial||perfil.nombre,rfc:perfil.rfc,codigoPostal:perfil.codigoPostal,regimenFiscal:perfil.regimenFiscal,email:perfil.email},usoCfdi:perfil.usoCfdi,aplicarIva:true,tasaIva:0.16,conceptos:timbradoConfig.produccion?conceptosPedidoProduccion(pedido):((pedido.productos||[]).map(p=>({...p,tasaIva:0.16})))}),ambienteOperacion:ambienteBorrador,portalClienteId:propietario,descargaHasta:new Date(Date.now()+3600000).toISOString(),canal:"TICKET",avisoAceptadoEn:new Date().toISOString(),pedido:referenciaPedido(pedido)};
      reservarOperacion(factura.id);
      let guardada=await facturas.save(factura);
      res.setHeader("Set-Cookie",`ticket_${factura.id}=${token}; HttpOnly; SameSite=Strict; Path=/api/ticket/documentos/${factura.id}; Max-Age=3600${process.env.APP_ENV==="production"?"; Secure":""}`);
      try{const sincronizacion=await pedidos.marcarFacturado(pedido,guardada);if(sincronizacion)guardada=await facturas.update(guardada.id,{pedidoMarcadoFacturado:true,sincronizacionPedido:sincronizacion})}
      catch(error){guardada=await facturas.update(guardada.id,{pedidoMarcadoFacturado:false,errorSincronizacionPedido:error.message});guardada.advertencia="La factura se guardó, pero no fue posible marcar el pedido en Firebase."}
      req.session={user:{email:perfil.email},profile:{nombre:perfil.razonSocial}};
      await registrarAuditoria(req,guardada,"CREACION_PORTAL",{total:guardada.total});
      return await respuestaTicket(req,res,guardada);
    }

    if(u.pathname.startsWith("/api/portal/"))return send(res,410,{error:"La autofacturación está disponible en /portal.html."});

    if (req.method === "GET" && u.pathname === "/api/session") {
      const session=await authenticate(req,res);
      if(!session)return;
      return send(res, 200, {
        user:{id:session.user.id,email:session.user.email},
        profile:session.profile,
        role:session.profile.rol,
        permissions:auth.permissionsFor(session.profile.rol)
      });
    }

    if(req.method==="GET"&&u.pathname==="/api/configuracion-fiscal"){
      if (!(await allow(req,res,"config:ver"))) return;
      return send(res,200,await configuracionFiscal?.get()||null);
    }

    if(req.method==="PUT"&&u.pathname==="/api/configuracion-fiscal"){
      if (!(await allow(req,res,"config:gestionar"))) return;
      const input=await body(req);
      const required=["razonSocial","rfc","regimenFiscal","codigoPostal","serie"];
      const missing=required.find(key=>!String(input[key]||"").trim());
      if(missing)return send(res,400,{error:`Falta ${missing}`});
      if(!/^[A-ZÑ&]{3,4}\d{6}[A-Z0-9]{3}$/.test(String(input.rfc).trim().toUpperCase()))return send(res,400,{error:"El RFC del emisor no tiene un formato válido"});
      if(!/^\d{5}$/.test(String(input.codigoPostal)))return send(res,400,{error:"El código postal debe contener 5 números"});
      if(input.correo&&!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(input.correo).trim()))return send(res,400,{error:"El correo del emisor no tiene un formato válido"});
      if(!configuracionFiscal)return send(res,503,{error:"Configura Supabase para guardar el emisor fiscal."});
      return send(res,200,await configuracionFiscal.save({...input,pacProveedor:input.ambiente==="PRODUCCION"?"FACTURAMA":input.pacProveedor}));
    }


    if (req.method === "GET" && /^\/api\/facturas\/[^/]+$/.test(u.pathname)) {
      if (!(await allow(req,res,"facturas:ver"))) return;
      const id = u.pathname.split("/")[3];
      const factura = await facturas.findById(id);
      if (!factura) return send(res,404,{error:"Factura no encontrada"});
      return send(res,200,factura);
    }

    if (req.method === "GET" && u.pathname === "/api/facturas") {
      if (!(await allow(req,res,"facturas:ver"))) return;
      if(u.searchParams.has("page")||u.searchParams.get("exportar")==="1"){
        const exportar=u.searchParams.get("exportar")==="1";
        return send(res,200,await facturas.page({q:u.searchParams.get("q")||"",desde:u.searchParams.get("desde")||"",hasta:u.searchParams.get("hasta")||"",origen:u.searchParams.get("origen")||"",estatus:u.searchParams.get("estatus")||"",sync:u.searchParams.get("sync")||"",page:exportar?1:u.searchParams.get("page")||1,pageSize:exportar?5000:u.searchParams.get("pageSize")||25}));
      }
      return send(res, 200, await facturas.list());
    }

    if (req.method === "GET" && u.pathname === "/api/reportes") {
      if (!(await allow(req,res,"reportes:ver"))) return;
      const filtros={desde:u.searchParams.get("desde")||"",hasta:u.searchParams.get("hasta")||"",origen:u.searchParams.get("origen")||"",estatus:u.searchParams.get("estatus")||"",ambiente:u.searchParams.get("ambiente")||(timbradoConfig.produccion?"PRODUCCION":"TODOS")};
      return send(res, 200, reportes.construir(await facturas.list(),filtros));
    }

    if (req.method === "GET" && u.pathname === "/api/auditoria/resumen") {
      if (!(await allow(req,res,"auditoria:ver"))) return;
      return send(res,200,await auditoria.resumen({q:u.searchParams.get("q")||"",accion:u.searchParams.get("accion")||"",desde:u.searchParams.get("desde")||"",hasta:u.searchParams.get("hasta")||"",page:u.searchParams.get("page")||1,pageSize:u.searchParams.get("pageSize")||25}));
    }

    if (req.method === "GET" && /^\/api\/auditoria\/factura\/[^/]+$/.test(u.pathname)) {
      if (!(await allow(req,res,"auditoria:ver"))) return;
      return send(res,200,await auditoria.timeline(decodeURIComponent(u.pathname.split("/")[4])));
    }

    if (req.method === "GET" && u.pathname === "/api/usuarios") {
      if (!(await allow(req,res,"usuarios:gestionar"))) return;
      return send(res, 200, await usuarios.list());
    }

    if (req.method === "POST" && u.pathname === "/api/usuarios") {
      if (!(await allow(req,res,"usuarios:gestionar"))) return;
      return send(res, 501, {error:"Los usuarios nuevos se agregan desde Supabase Authentication"});
    }

    if (req.method === "GET" && u.pathname === "/api/clientes-fiscales") {
      if (!(await allow(req,res,"facturas:ver"))) return;
      return send(res, 200, await clientes.search(u.searchParams.get("q") || ""));
    }

    if (req.method === "POST" && u.pathname === "/api/clientes-fiscales") {
      if (!(await allow(req,res,"clientes:gestionar"))) return;
      const i = await body(req);
      const problemaFiscal=revisarReceptor(i,i.usoCfdi); if(problemaFiscal)throw new DatosFacturaError(problemaFiscal);
      const required = ["tipoPersona","razonSocial","rfc","codigoPostal","regimenFiscal","usoCfdi"];
      const missing = required.find(k => !i[k]);
      if (missing) return send(res, 400, {error:`Falta ${missing}`});
      if (!/^\d{5}$/.test(String(i.codigoPostal)))
        return send(res, 400, {error:"El código postal fiscal debe contener 5 números"});
      if (!/^[A-ZÑ&]{3,4}\d{6}[A-Z0-9]{3}$/.test(String(i.rfc).trim().toUpperCase()))
        return send(res, 400, {error:"El RFC no tiene un formato válido"});
      return send(res, 201, await clientes.save(i));
    }

    if(req.method==="GET"&&u.pathname==="/api/productos-fiscales"){
      if(!(await allow(req,res,"facturas:ver")))return;
      const q=String(u.searchParams.get("q")||"").toLowerCase();
      const all=await catalogoFiscal.listar();
      const rows=all.filter(r=>!q||`${r.sku} ${r.titulo} ${r.claveProdServSat}`.toLowerCase().includes(q));
      const page=Math.max(1,Number(u.searchParams.get("page"))||1);
      return send(res,200,{items:rows.slice((page-1)*50,page*50),total:rows.length,page,pageSize:50});
    }
    if(req.method==="POST"&&u.pathname==="/api/productos-fiscales"){
      if(!(await allow(req,res,"catalogo:gestionar")))return;
      const input=await body(req);let rows;
      try{rows=validarLoteFiscal(input.items)}catch(e){return send(res,400,{error:e.message})}
      const saved=await catalogoFiscal.guardarLote(rows);
      await registrarAuditoria(req,null,"CATALOGO_FISCAL_GUARDADO",{cantidad:saved.length,skus:saved.map(r=>r.sku)});
      return send(res,200,{items:saved,total:saved.length});
    }
    if(req.method==="GET"&&u.pathname==="/api/preparacion"){
      if(!(await allow(req,res,"config:gestionar")))return;
      let catalogo;try{catalogo={ok:true,total:(await catalogoFiscal.listar()).length}}catch(e){catalogo={ok:false,mensaje:e.message}}
      const recientes=(await facturas.list()).slice(0,500);
      return send(res,200,{catalogo,almacenamiento:supabaseConfigured?"Supabase: verificar políticas, bucket y respaldo en su panel":"Archivos locales: requiere disco persistente y respaldo externo",correoHabilitado:process.env.FACTURAMA_EMAIL_ENABLED==="true",pac:timbradoConfig.provider,emisionActivada:timbradoConfig.produccion,pendientesDocumentos:recientes.filter(f=>f.documentosPendientes).length,operacionesPorConfirmar:recientes.filter(f=>/REVISION/.test(f.estatus||"")).length,alcanceConteo:"Hasta 500 registros consultados; no es una conciliación fiscal completa.",cuentaCsd:"Usa Verificar cuenta, CSD y emisor: esta pantalla no acredita su vigencia.",logo:process.env.FACTURAMA_LOGO_URL?"URL configurada; falta verificar PDF de prueba":"Opcional: sin URL de logo",alcance:"CFDI individual, MXN, IVA 16%, PUE. Global, PPD y sustitución automática pendientes."});
    }
    if(req.method==="POST"&&/^\/api\/facturas\/[^/]+\/correo$/.test(u.pathname)){
      if(!(await allow(req,res,"facturas:enviar")))return;
      const id=decodeURIComponent(u.pathname.split("/")[3]);reservarOperacion(id);
      const factura=await facturas.findById(id);if(!factura)return send(res,404,{error:"Factura no encontrada"});
      const input=await body(req), email=String(input.email||factura.cliente?.email||"").trim();
      const personalizada = factura.estatus === "TIMBRADA";
      if (personalizada) validarEnvio(factura,email); else correoFacturas.preparar(factura,email);
      if(process.env.FACTURAMA_EMAIL_ENABLED!=="true")return send(res,503,{error:"Envío deshabilitado. Configura FACTURAMA_EMAIL_ENABLED=true."});
      if(factura.correoEnvio?.estado==="ENVIANDO" && !(input.reenviar===true && Date.now()-Date.parse(factura.correoEnvio.fecha)>120000))return send(res,409,{error:"Existe un envío en curso o interrumpido. Verifica con el proveedor de correo antes de volver a intentarlo."});
      if(factura.correoEnvio && input.reenviar!==true)return send(res,409,{error:"Ya existe un intento de envío. Revisa el estado y confirma expresamente el reenvío."});
      const enviarPersonalizado = personalizada ? await prepararCorreoNoventia(factura,email) : null;
      const locked=await facturas.compareAndUpdate(factura,{correoEnvio:{estado:"ENVIANDO",destinatario:email,fecha:new Date().toISOString()}});
      if(!locked)return send(res,409,{error:"La factura cambió; actualiza el historial."});
      let envio;
      try{envio=enviarPersonalizado ? await enviarPersonalizado() : await correoFacturas.enviar(locked,email)}catch(e){const resultado={estado:"POR_CONFIRMAR",destinatario:email,fecha:new Date().toISOString(),nota:e.message};await facturas.compareAndUpdate(locked,{correoEnvio:resultado});await registrarAuditoria(req,factura,"CORREO_NO_CONFIRMADO",resultado);return send(res,e.statusCode||502,{error:e.message,correoEnvio:resultado});}
      const updated=await facturas.compareAndUpdate(locked,{correoEnvio:envio});
      await registrarAuditoria(req,factura,"CORREO_ACEPTADO_PROVEEDOR",envio);
      if(!updated)return send(res,409,{error:"El proveedor de correo aceptó el envío, pero el registro cambió; revisa la bitácora antes de reenviar."});
      return send(res,200,{correoEnvio:envio});
    }

    if (req.method === "GET" && u.pathname === "/api/pedidos") {
      if (!(await allow(req,res,"facturas:ver"))) return;
      const folio = u.searchParams.get("folio");
      if (!folio) return send(res,400,{error:"Falta folio"});
      let pedido;
      try{pedido=await pedidos.obtenerPedido(folio)}
      catch(error){return errorFuente(res,error)}
      if (!pedido) return send(res,404,{error:"Pedido no encontrado"});
      const existente=await facturaExistentePedido(pedido);
      if(existente)return send(res,409,{error:`El pedido ya fue facturado con el folio ${existente.folioInterno||existente.id}`,pedidoFolio:pedido.folio,facturaId:existente.id,folioInterno:existente.folioInterno});
      if(pedido.facturado)return send(res,409,{error:`El pedido ya está marcado como facturado${pedido.facturaFolioInterno?` con el folio ${pedido.facturaFolioInterno}`:""}`,pedidoFolio:pedido.folio,folioInterno:pedido.facturaFolioInterno||null});
      return send(res,200,timbradoConfig.produccion?pedidoProduccion(pedido):pedido);
    }

    if (req.method === "POST" && u.pathname === "/api/facturas") {
      etapaError="AUTORIZAR_BORRADOR";
      if (!(await allow(req,res,"facturas:crear"))) return;
      etapaError="LEER_BORRADOR";
      let input=await body(req);
      if(!input||typeof input!=="object"||Array.isArray(input))throw new DatosFacturaError("El borrador debe enviarse como un objeto JSON válido");
      etapaError="BUSCAR_FACTURA_EXISTENTE";
      const folio=String(input.folioOrigen||"").trim();
      const existente=folio?await facturas.findByFolioOrigen(folio):null;
      if(existente)return send(res,409,{error:`El pedido ya fue facturado con el folio ${existente.folioInterno||existente.id}`,facturaId:existente.id,folioInterno:existente.folioInterno});

      let pedidoFirebase=null;
      etapaError="CONSULTAR_PEDIDO";
      const pedidoExterno=/^(NV|WA|BAZ|ALM|ORD|WEB)-/i.test(folio)||/^[1-9]\d*$/.test(folio)||input.origen==="ECOMMERCE";
      try{pedidoFirebase=pedidoExterno?await pedidos.obtenerPedido(folio):null}
      catch(error){return errorFuente(res,error)}
      if(pedidoExterno&&!pedidoFirebase)return send(res,404,{error:"El pedido de origen ya no existe"});
      if(pedidoFirebase?.cancelado)return send(res,409,{error:"No se puede facturar un pedido cancelado"});
      if(pedidoFirebase?.facturado)return send(res,409,{error:`El pedido ya está marcado como facturado${pedidoFirebase.facturaFolioInterno?` con el folio ${pedidoFirebase.facturaFolioInterno}`:""}`});
      if(pedidoFirebase?.fuente==="ECOMMERCE_API"){
        const duplicada=await facturaExistentePedido(pedidoFirebase);if(duplicada)return send(res,409,{error:"Este pedido ya fue facturado"});
        input={...input,folioOrigen:pedidoFirebase.folio,origen:pedidoFirebase.origen,conceptos:conceptosActualesEcommerce(pedidoFirebase,input.conceptos)};
      }

      if(timbradoConfig.produccion){
        input={...input,folioOrigen:pedidoFirebase?.folio,origen:pedidoFirebase?.origen,conceptos:conceptosPedidoProduccion(pedidoFirebase,input.conceptos)};
        if(input.metodoPago!=="PUE")throw errorProduccion("Producción admite compras totalmente pagadas con PUE; PPD está pendiente.");
      }

      const problemaFiscal=revisarReceptor(input.cliente,input.usoCfdi); if(problemaFiscal)throw new DatosFacturaError(problemaFiscal);
      etapaError="VALIDAR_BORRADOR";
      const factura = {
        ...crearFactura(input),
        ambienteOperacion:ambienteBorrador,
        pedido:pedidoFirebase?referenciaPedido(pedidoFirebase):undefined
      };
      let guardada;
      try{
        etapaError="GUARDAR_BORRADOR";
        guardada=await facturas.save(factura);
      }catch(error){
        if(/duplicate|unique|ya fue facturado/i.test(error.message))return send(res,409,{error:"Este pedido ya fue facturado"});
        throw error;
      }

      if(pedidoFirebase&&String(pedidoFirebase.fuente||"").startsWith("FIRESTORE_")){
        etapaError="SINCRONIZAR_BORRADOR_FIREBASE";
        try{
          const sincronizacion=await pedidos.marcarFacturado(pedidoFirebase,guardada);
          guardada=await facturas.update(guardada.id,{pedidoMarcadoFacturado:true,sincronizacionPedido:sincronizacion});
        }catch(error){
          guardada=await facturas.update(guardada.id,{pedidoMarcadoFacturado:false,errorSincronizacionPedido:error.message});
          guardada.advertencia="La factura se guardó, pero no fue posible marcar el pedido en Firebase.";
        }
      }
      await registrarAuditoria(req,guardada,"CREACION",{estatus:guardada.estatus,origen:guardada.origen,total:guardada.total,sincronizadoFirebase:guardada.pedidoMarcadoFacturado??null});
      return send(res,201,guardada);
    }

    if (req.method === "PUT" && /^\/api\/facturas\/[^/]+$/.test(u.pathname)) {
      if (!(await allow(req,res,"facturas:crear"))) return;
      const id=u.pathname.split("/")[3];
      reservarOperacion(id);
      const existente=await facturas.findById(id);
      if(!existente)return send(res,404,{error:"Factura no encontrada"});
      if(existente.estatus!=="BORRADOR")return send(res,409,{error:"Solo se pueden modificar facturas en estado BORRADOR"});
      if((timbradoConfig.produccion&&existente.ambienteOperacion!=="PRODUCCION")||(!timbradoConfig.produccion&&existente.ambienteOperacion==="PRODUCCION"))return send(res,409,{error:"Este borrador pertenece a otro ambiente. Crea uno nuevo después de liberar el pedido; no se convierten pruebas a producción."});
      let input=await body(req);
      if(String(input.folioOrigen||"").trim()!==String(existente.folioOrigen||"").trim()||String(input.origen||"")!==String(existente.origen||""))
        return send(res,400,{error:"El pedido y el origen no pueden modificarse durante la edición"});
      let referenciaActual=existente.pedido;
      if(existente.pedido?.fuente==="ECOMMERCE_API"){
        let actual;try{actual=await pedidos.obtenerPedido(String(existente.pedido.ecommerceId))}catch(error){return errorFuente(res,error)}
        if(!actual)return send(res,404,{error:"La venta del e-commerce ya no está disponible"});
        input={...input,conceptos:conceptosActualesEcommerce(actual,input.conceptos)};
        referenciaActual=referenciaPedido(actual);
      }
      if(timbradoConfig.produccion){
        const actual=await pedidos.obtenerPedido(existente.pedido?.fuente==="ECOMMERCE_API"?String(existente.pedido.ecommerceId):existente.folioOrigen);
        input={...input,conceptos:conceptosPedidoProduccion(actual,input.conceptos,existente)};
        referenciaActual=referenciaPedido(actual);
      }
      const problemaFiscal=revisarReceptor(input.cliente,input.usoCfdi); if(problemaFiscal)throw new DatosFacturaError(problemaFiscal);
      const validada=crearFactura(input);
      const actualizada=await facturas.compareAndUpdate(existente,{
        origen:existente.origen,folioOrigen:existente.folioOrigen,cliente:validada.cliente,usoCfdi:validada.usoCfdi,
        formaPago:validada.formaPago,metodoPago:validada.metodoPago,aplicarIva:validada.aplicarIva,tasaIva:validada.tasaIva,
        moneda:validada.moneda,conceptos:validada.conceptos,subtotal:validada.subtotal,impuestos:validada.impuestos,total:validada.total,
        pedido:referenciaActual,
        editadaEn:new Date().toISOString(),editadaPor:{id:req.session.user.id,nombre:req.session.profile.nombre,email:req.session.user.email}
      });
      if(!actualizada)return send(res,409,{error:"La factura cambió durante la edición. Actualiza el historial."});
      await registrarAuditoria(req,actualizada,"EDICION",{totalAnterior:existente.total,totalNuevo:actualizada.total,clienteAnterior:existente.cliente?.razonSocial,clienteNuevo:actualizada.cliente?.razonSocial});
      return send(res,200,actualizada);
    }

    if (req.method === "DELETE" && /^\/api\/facturas\/[^/]+$/.test(u.pathname)) {
      if (!(await allow(req,res,"facturas:crear"))) return;
      const id=u.pathname.split("/")[3];
      reservarOperacion(id);
      const existente=await facturas.findById(id);
      if(!existente)return send(res,404,{error:"Factura no encontrada"});
      if(existente.estatus!=="BORRADOR")return send(res,409,{error:"Solo se pueden eliminar facturas en estado BORRADOR"});
      if(existente.pedidoMarcadoFacturado===true&&existente.pedido?.firebaseId){
        try{await pedidos.desmarcarFacturado(existente.pedido,existente.id)}
        catch(error){return send(res,502,{error:`No se eliminó la factura porque no fue posible liberar el pedido en Firebase: ${error.message}`})}
      }
      if(!(await facturas.delete(id,existente)))return send(res,409,{error:"La factura cambió durante la operación. Actualiza el historial."});
      await registrarAuditoria(req,existente,"ELIMINACION",{estatus:existente.estatus,total:existente.total,pedidoLiberadoFirebase:existente.pedidoMarcadoFacturado===true});
      return send(res,200,{ok:true,id});
    }

    if (req.method === "POST" && /^\/api\/facturas\/[^/]+\/reintentar-sincronizacion$/.test(u.pathname)) {
      if (!(await allow(req,res,"facturas:crear"))) return;
      const id=u.pathname.split("/")[3];
      reservarOperacion(id);
      const factura=await facturas.findById(id);
      if(!factura)return send(res,404,{error:"Factura no encontrada"});
      if(!factura.pedido?.firebaseId||!factura.pedido?.fuente)
        return send(res,400,{error:"Esta factura no está vinculada con un pedido de Firebase"});
      if(factura.cancelacionSandbox||factura.cancelacionProduccion||String(factura.estatus||"").startsWith("CANCELADA"))return send(res,409,{error:"Esta factura tiene una cancelación. Usa Consultar cancelación para liberar su pedido."});
      try{
        const sincronizacion=await pedidos.marcarFacturado(factura.pedido,factura);
        const actualizada=await facturas.update(id,{pedidoMarcadoFacturado:true,sincronizacionPedido:sincronizacion,errorSincronizacionPedido:null});
        await registrarAuditoria(req,actualizada,"SINCRONIZACION_FIREBASE",{resultado:"EXITOSA",...sincronizacion});
        return send(res,200,actualizada);
      }catch(error){
        await facturas.update(id,{pedidoMarcadoFacturado:false,errorSincronizacionPedido:error.message});
        await registrarAuditoria(req,factura,"SINCRONIZACION_FIREBASE",{resultado:"ERROR",error:error.message});
        return send(res,502,{error:`No fue posible sincronizar el pedido con Firebase: ${error.message}`});
      }
    }

    if (req.method === "POST" && /^\/api\/facturas\/[^/]+\/timbrar$/.test(u.pathname)) {
      if (!(await allow(req,res,"facturas:timbrar"))) return;
      const id = u.pathname.split("/")[3];
      reservarOperacion(id);
      const factura = await facturas.findById(id);
      if (!factura) return send(res,404,{error:"Factura no encontrada"});
      if(factura.estatus!=="BORRADOR")return send(res,409,{error:"Solo se pueden timbrar facturas en estado BORRADOR"});
      try { return send(res,200,await emitirFactura(req,factura)); }
      catch(error) {
        if(error.consultaFuente)return errorFuente(res,error);
        throw error;
      }
    }

    if (req.method === "POST" && /^\/api\/facturas\/[^/]+\/(recuperar-produccion|reintentar-produccion)$/.test(u.pathname)) {
      if (!(await allow(req,res,"facturas:timbrar"))) return;
      if(!timbradoProduccion)return send(res,409,{error:"Configura los accesos productivos del servidor para consultar este comprobante."});
      const id=u.pathname.split("/")[3];reservarOperacion(id);
      const factura=await facturas.findById(id);if(!factura)return send(res,404,{error:"Factura no encontrada"});
      const retry=u.pathname.endsWith("/reintentar-produccion");
      if(retry&&!timbradoConfig.produccion)return send(res,409,{error:"Activa el proveedor productivo antes de reintentar una emisión real."});
      const updated=retry?await timbradoProduccion.reintentar(factura,{antesDeReenviar:()=>verificarCompraProduccion(factura)}):await timbradoProduccion.recuperar(factura);
      await registrarAuditoria(req,updated,retry?"REINTENTO_PRODUCCION":"RECUPERACION_PRODUCCION",{uuid:updated.uuid,facturamaId:updated.timbradoProduccion?.facturamaId,documentosPendientes:updated.documentosPendientes});
      return send(res,200,updated);
    }

    if (req.method === "POST" && /^\/api\/facturas\/[^/]+\/consultar-cancelacion-produccion$/.test(u.pathname)) {
      if (!(await allow(req,res,"facturas:cancelar"))) return;
      if(!cancelacionProduccion)return send(res,409,{error:"Configura los accesos productivos para consultar esta cancelación."});
      const id=u.pathname.split("/")[3];reservarOperacion(id);
      const factura=await facturas.findById(id);if(!factura)return send(res,404,{error:"Factura no encontrada"});
      const updated=await cancelacionProduccion.consultar(factura);
      await registrarAuditoria(req,updated,"CONSULTA_CANCELACION_PRODUCCION",{estatus:updated.estatus,estado:updated.cancelacionProduccion?.estado});
      return send(res,200,updated);
    }

    if (req.method === "POST" && /^\/api\/facturas\/[^/]+\/recuperar-sandbox$/.test(u.pathname)) {
      if (!(await allow(req,res,"facturas:timbrar"))) return;
      if(!timbradoSandbox)return send(res,409,{error:"Activa Facturama Sandbox en el servidor para consultar este resultado."});
      const id=u.pathname.split("/")[3];
      reservarOperacion(id);
      const factura=await facturas.findById(id);
      if(!factura)return send(res,404,{error:"Factura no encontrada"});
      const updated=await timbradoSandbox.recuperar(factura);
      await registrarAuditoria(req,updated,"RECUPERACION_SANDBOX",{uuid:updated.uuid,facturamaId:updated.timbradoSandbox?.facturamaId,documentosPendientes:updated.documentosPendientes});
      return send(res,200,updated);
    }

    if (req.method === "POST" && /^\/api\/facturas\/[^/]+\/(reintentar-sandbox|corregir-referencia-sandbox)$/.test(u.pathname)) {
      if (!(await allow(req,res,"facturas:timbrar"))) return;
      if(!timbradoSandbox)return send(res,409,{error:"Activa Facturama Sandbox para reintentar esta solicitud."});
      const id=u.pathname.split("/")[3];
      reservarOperacion(id);
      const factura=await facturas.findById(id);
      if(!factura)return send(res,404,{error:"Factura no encontrada"});
      const omitirReferenciaPedido=u.pathname.endsWith("/corregir-referencia-sandbox");
      const updated=await timbradoSandbox.reintentar(factura,{omitirReferenciaPedido,antesDeReenviar:async()=>{
        if(factura.pedido?.fuente!=="ECOMMERCE_API")return;
        let actual;
        try{actual=await pedidos.obtenerPedido(String(factura.pedido.ecommerceId))}
        catch(error){const failure=new Error(`No fue posible verificar la venta antes de reintentar: ${error.message}`);failure.statusCode=503;throw failure;}
        if(!actual){const failure=new Error("La venta del e-commerce ya no está disponible. Se conservó la solicitud pendiente.");failure.statusCode=404;throw failure;}
        validarVentaParaFacturar(actual);
        if(!ventaCoincideConFactura(actual,factura)){
          const failure=new Error("La venta cambió desde la solicitud original. Se conservó la operación para revisión.");
          failure.statusCode=409;failure.code="SANDBOX_VENTA_MODIFICADA";throw failure;
        }
      }});
      await registrarAuditoria(req,updated,"REINTENTO_SANDBOX",{uuid:updated.uuid,facturamaId:updated.timbradoSandbox?.facturamaId,reintentos:updated.timbradoSandbox?.reintentos||0,referenciaAuxiliarOmitida:Boolean(updated.timbradoSandbox?.ajusteReferencia)});
      return send(res,200,updated);
    }

    if (req.method === "POST" && /^\/api\/facturas\/[^/]+\/consultar-cancelacion-sandbox$/.test(u.pathname)) {
      if (!(await allow(req,res,"facturas:cancelar"))) return;
      if(!cancelacionSandbox)return send(res,409,{error:"Activa Facturama Sandbox para consultar esta cancelación."});
      const id=u.pathname.split("/")[3];reservarOperacion(id);
      const factura=await facturas.findById(id);if(!factura)return send(res,404,{error:"Factura no encontrada"});
      const updated=await cancelacionSandbox.consultar(factura);
      await registrarAuditoria(req,updated,"CONSULTA_CANCELACION_SANDBOX",{estatus:updated.estatus,estado:updated.cancelacionSandbox?.estado});
      return send(res,200,updated);
    }

    if (req.method === "GET" && /^\/api\/facturas\/[^/]+\/acuse-cancelacion$/.test(u.pathname)) {
      if (!(await allow(req,res,"facturas:descargar"))) return;
      const factura=await facturas.findById(u.pathname.split("/")[3]);if(!factura)return send(res,404,{error:"Factura no encontrada"});
      const real=factura.ambienteTimbrado==="PRODUCCION", servicio=real?cancelacionProduccion:cancelacionSandbox, cliente=real?timbradoConfig.clienteProduccion:timbradoConfig.clienteSandbox;
      if(!servicio||!cliente)return send(res,409,{error:"Configura el proveedor del ambiente original de esta factura para descargar su acuse."});
      servicio.validarOperacion(factura);
      const operacion=real?factura.cancelacionProduccion:factura.cancelacionSandbox;
      if(operacion.estado!=="CONFIRMADA")return send(res,409,{error:"La cancelación todavía no está confirmada."});
      const bytes=await cliente.acuse(real?factura.timbradoProduccion.facturamaId:factura.timbradoSandbox.facturamaId);
      await registrarAuditoria(req,factura,"DESCARGA_DOCUMENTO",{tipo:"ACUSE_CANCELACION",ambiente:real?"PRODUCCION":"SANDBOX"});
      return serveBytes(res,bytes,mime[".pdf"],`${factura.folioInterno||factura.id}-acuse-cancelacion.pdf`);
    }

    if (req.method === "POST" && /^\/api\/facturas\/[^/]+\/cancelar$/.test(u.pathname)) {
      if (!(await allow(req,res,"facturas:cancelar"))) return;
      const id=u.pathname.split("/")[3];
      reservarOperacion(id);
      const factura=await facturas.findById(id);
      if(!factura)return send(res,404,{error:"Factura no encontrada"});
      const input=await body(req);
      if(factura.timbradoProduccion||factura.ambienteTimbrado==="PRODUCCION"){
        if(!cancelacionProduccion||!timbradoConfig.produccion)return send(res,409,{error:"Activa el proveedor productivo para solicitar esta cancelación real."});
        const updated=await cancelacionProduccion.cancelar(factura,input);
        await registrarAuditoria(req,updated,"CANCELACION",{estatus:updated.estatus,motivo:updated.cancelacionProduccion?.solicitud.motivo,estado:updated.cancelacionProduccion?.estado,ambiente:"PRODUCCION"});
        return send(res,200,updated);
      }
      if(factura.timbradoSandbox||factura.ambienteTimbrado==="SANDBOX"){
        if(!cancelacionSandbox)return send(res,409,{error:"Activa Facturama Sandbox para cancelar este comprobante."});
        const updated=await cancelacionSandbox.cancelar(factura,input);
        await registrarAuditoria(req,updated,"CANCELACION",{estatus:updated.estatus,motivo:updated.cancelacionSandbox?.solicitud.motivo,estado:updated.cancelacionSandbox?.estado,ambiente:"SANDBOX"});
        return send(res,200,updated);
      }
      if(!String(factura.estatus||"").startsWith("TIMBRADA"))return send(res,409,{error:"Solo se pueden cancelar facturas timbradas"});
      const resultado=cancelador.cancelar(factura,input);
      let cancelada=await facturas.update(id,{...resultado,comentarioCancelacion:String(input.comentario||"").trim(),canceladaPor:{id:req.session.user.id,nombre:req.session.profile.nombre,email:req.session.user.email},pedidoMarcadoFacturado:factura.pedido?.firebaseId?false:factura.pedidoMarcadoFacturado,pedidoLiberadoPorCancelacion:Boolean(factura.pedido?.firebaseId)});
      if(factura.pedidoMarcadoFacturado===true&&factura.pedido?.firebaseId){
        try{await pedidos.desmarcarFacturado(factura.pedido,factura.id)}
        catch(error){
          await facturas.update(id,{estatus:factura.estatus,motivoCancelacion:null,uuidSustitucion:null,fechaCancelacion:null,acuseCancelacion:null,comentarioCancelacion:null,canceladaPor:null,pedidoMarcadoFacturado:factura.pedidoMarcadoFacturado,pedidoLiberadoPorCancelacion:null});
          return send(res,502,{error:`La cancelación se revirtió porque no fue posible liberar el pedido en Firebase: ${error.message}`});
        }
      }
      cancelada=await facturas.findById(id);
      await registrarAuditoria(req,cancelada,"CANCELACION",{motivo:resultado.motivoCancelacion,uuidSustitucion:resultado.uuidSustitucion,acuse:resultado.acuseCancelacion,pedidoLiberadoFirebase:Boolean(factura.pedidoMarcadoFacturado)});
      return send(res,200,cancelada);
    }

    if (req.method === "GET" && /^\/api\/facturas\/[^/]+\/documento\/(xml|pdf)$/.test(u.pathname)) {
      if (!(await allow(req,res,"facturas:descargar"))) return;
      const parts = u.pathname.split("/");
      const id = parts[3], tipo = parts[5];
      const factura = await facturas.findById(id);
      if (!factura) return send(res,404,{error:"Factura no encontrada"});
      const rel = tipo === "xml" ? factura.xmlRelativePath : factura.pdfRelativePath;
      const storagePath=tipo==="xml"?factura.xmlStoragePath:factura.pdfStoragePath;
      if(storagePath&&documentStorage){
        const bytes=await documentStorage.download(storagePath);
        await registrarAuditoria(req,factura,"DESCARGA_DOCUMENTO",{tipo,almacenamiento:"supabase"});
        const salida=tipo==="pdf" ? await pdfParaDescarga(factura,()=>documentStorage.download(factura.xmlStoragePath),bytes) : bytes;
        return serveBytes(res,salida,mime[`.${tipo}`],`${factura.folioInterno||factura.folioOrigen||factura.id}.${tipo}`);
      }
      if (!rel) return send(res,404,{error:"Documento no disponible"});
      await registrarAuditoria(req,factura,"DESCARGA_DOCUMENTO",{tipo,almacenamiento:"local"});
      if(tipo==="pdf" && factura.ambienteTimbrado==="PRODUCCION" && factura.estatus==="TIMBRADA"){
        const original=await fs.readFile(path.join(storageRoot,rel));
        const pdf=await pdfParaDescarga(factura,()=>fs.readFile(path.join(storageRoot,factura.xmlRelativePath)),original);
        return serveBytes(res,pdf,mime[".pdf"],`${factura.folioOrigen || factura.id}.pdf`);
      }
      return serveFile(res, path.join(storageRoot,rel), `${factura.folioOrigen || factura.id}.${tipo}`);
    }

    if(req.method==="GET"&&u.pathname==="/shared/domain/catalogoFiscal.mjs")
      return serveFile(res,path.join(dir,"..","shared","domain","catalogoFiscal.mjs"));

    if(req.method==="GET"&&u.pathname==="/shared/domain/productoFiscal.mjs")
      return serveFile(res,path.join(dir,"..","shared","domain","productoFiscal.mjs"));

    if(req.method==="GET"&&u.pathname==="/shared/domain/calculos.mjs")
      return serveFile(res,path.join(dir,"..","shared","domain","calculos.mjs"));

    const rel = u.pathname === "/" ? "index.html" : u.pathname.slice(1);
    const safe = path.normalize(rel).replace(/^\.\.(\/|\\|$)/, "");
    return serveFile(res, path.join(publicDir,safe));
  } catch (e) {
    if (e.code === "ENOENT") { res.writeHead(404); res.end("Not found"); }
    else { const diagnostic=diagnosticoError(e,etapaError); send(res,diagnostic.statusCode,diagnostic.body); }
  }
  finally { if(operacionFacturaId!==null)operacionesFactura.delete(operacionFacturaId); }
}).listen(port,()=>console.log(`Facturación: http://localhost:${port} · v1.20.0 · ${timbradoConfig.provider}`));

// Envío SMTP del PDF personalizado de Noventia
async function prepararCorreoNoventia(factura, email) {
  validarEnvio(factura, email);
  const archivoGmail = process.env.NOVENTIA_GMAIL_AUTH_FILE;
  const { SMTP_HOST: host, SMTP_USER: user, SMTP_PASS: pass } = process.env;
  const port = Number(process.env.SMTP_PORT || 465);
  if (!archivoGmail && (!host || !user || !pass || ![465, 587].includes(port))) {
    throw Object.assign(new Error('Configura SMTP_HOST, SMTP_PORT (465 o 587), SMTP_USER y SMTP_PASS para enviar desde Noventia.'), { statusCode: 503 });
  }
  const { default: nodemailer } = await import('nodemailer');
  async function leer(tipo) {
    const remoto = factura[tipo + 'StoragePath'];
    if (remoto && documentStorage) return Buffer.from(await documentStorage.download(remoto));
    const relativo = factura[tipo + 'RelativePath'];
    if (!relativo) throw new Error('Documento pendiente');
    const ruta = path.resolve(storageRoot, relativo);
    if (!ruta.startsWith(path.resolve(storageRoot) + path.sep)) throw new Error('Ruta de documento inválida');
    return fs.readFile(ruta);
  }
  let xml, pdf;
  try {
    const [original, timbrado] = await Promise.all([leer('pdf'), leer('xml')]);
    xml = timbrado;
    pdf = await disenar(xml, original, factura.folioInterno, factura.uuid);
    if (!Buffer.isBuffer(pdf) || pdf.equals(original) || pdf.subarray(0, 5).toString() !== '%PDF-') throw new Error('Diseño no disponible');
  } catch {
    throw Object.assign(new Error('No se pudo preparar el PDF Noventia y el XML de este folio. Revisa los documentos timbrados. El correo sigue sin enviarse.'), { statusCode: 409 });
  }
  const folio = String(factura.folioInterno || factura.uuid).replace(/[^a-zA-Z0-9_-]/g, '_');
  const transport = archivoGmail
    ? await (await import('./services/gmail-api.mjs')).transporteGmail(nodemailer, archivoGmail)
    : nodemailer.createTransport({
    host, port, secure: port === 465, requireTLS: true, auth: { user, pass },
    connectionTimeout: 15000, socketTimeout: 30000, disableFileAccess: true, disableUrlAccess: true
  });
  return async () => {
    const resultado = await transport.sendMail({
      from: { name: 'Noventia', address: archivoGmail ? 'factura.noventia@gmail.com' : process.env.SMTP_FROM || user }, to: { address: email, name: '' },
      subject: 'Factura Noventia ' + folio,
      text: 'Adjuntamos el PDF y el XML timbrado de tu factura ' + folio + '. Gracias por comprar en Noventia.',
      attachments: [
        { filename: folio + '.pdf', content: pdf, contentType: 'application/pdf' },
        { filename: folio + '.xml', content: xml, contentType: 'application/xml' }
      ]
    });
    if (!resultado.accepted?.length) throw new Error('El servidor de correo no confirmó el envío.');
    return { estado: 'ACEPTADO_PROVEEDOR', destinatario: email, fecha: new Date().toISOString(), nota: 'PDF Noventia y XML aceptados por el servidor de correo.', messageId: resultado.messageId };
  };
}

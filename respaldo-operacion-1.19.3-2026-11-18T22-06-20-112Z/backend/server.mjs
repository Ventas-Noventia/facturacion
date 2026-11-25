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
import { PortalFacturasService } from "./services/portalFacturasService.mjs";
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

function authCookies(res,session){
  const secure=process.env.APP_ENV==="production"?"; Secure":"";
  res.setHeader("Set-Cookie",[
    `facturacion_access=${encodeURIComponent(session.access_token)}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${Number(session.expires_in||3600)}${secure}`,
    `facturacion_refresh=${encodeURIComponent(session.refresh_token)}; HttpOnly; SameSite=Strict; Path=/; Max-Age=2592000${secure}`
  ]);
}

function clearAuthCookies(res){
  res.setHeader("Set-Cookie",[
    "facturacion_access=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0",
    "facturacion_refresh=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0"
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
  try{user=await supabaseAuth.getUser(current.facturacion_access)}
  catch{
    if(!current.facturacion_refresh){send(res,401,{error:"Inicia sesión para continuar"});return null}
    try{const refreshed=await supabaseAuth.refresh(current.facturacion_refresh);authCookies(res,refreshed);user=refreshed.user}
    catch{clearAuthCookies(res);send(res,401,{error:"Tu sesión terminó. Inicia sesión nuevamente"});return null}
  }
  const cliente=await portalClientes.findById(user.id);
  if(!cliente||!cliente.activo){clearAuthCookies(res);send(res,403,{error:"No existe un perfil de cliente activo"});return null}
  return{user,cliente};
}

function datoComparable(valor){return String(valor||"").trim().toLowerCase()}
function telefonoComparable(valor){return String(valor||"").replace(/\D/g,"").slice(-10)}
function pedidoPerteneceACliente(pedido,cliente){
  const emailPedido=datoComparable(pedido?.cliente?.email),emailCliente=datoComparable(cliente?.email);
  const telPedido=telefonoComparable(pedido?.cliente?.telefono),telCliente=telefonoComparable(cliente?.telefono);
  return Boolean((emailPedido&&emailCliente&&emailPedido===emailCliente)||(telPedido&&telCliente&&telPedido===telCliente));
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

function serveBytes(res,bytes,contentType,downloadName){
  res.writeHead(200,{
    "Content-Type":contentType,
    "Content-Disposition":`attachment; filename="${downloadName}"`,
    "Content-Length":bytes.length
  });
  res.end(bytes);
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
      return send(res, 200, {ok:true, version:"1.19.3", mode:supabaseConfigured?"supabase":"local", auth:authConfigured?"supabase":"missing", pac:timbradoConfig.provider});

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

    if(req.method==="POST"&&u.pathname==="/api/portal/registro"){
      if(!supabaseAuth||!portalClientes)return send(res,503,{error:"El registro de clientes no está configurado"});
      const input=await body(req);
      if(input.aceptaPrivacidad!==true)return send(res,400,{error:"Debes aceptar el aviso de privacidad y las cookies esenciales"});
      if(!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(input.email||"")))return send(res,400,{error:"Ingresa un correo válido"});
      if(String(input.password||"").length<8)return send(res,400,{error:"La contraseña debe tener al menos 8 caracteres"});
      if(!String(input.nombre||"").trim())return send(res,400,{error:"Ingresa tu nombre"});
      let registro;
      try{registro=await supabaseAuth.signup(String(input.email).trim().toLowerCase(),String(input.password),{nombre:String(input.nombre).trim(),tipo:"CLIENTE"})}
      catch(error){return send(res,error.status===422?409:400,{error:error.message})}
      if(!registro?.user?.id)return send(res,400,{error:"No fue posible crear la cuenta"});
      await portalClientes.save(registro.user.id,{...input,avisoVersion:"2026-10-06",avisoAceptadoEn:new Date().toISOString()});
      if(registro.access_token)authCookies(res,registro);
      return send(res,201,{ok:true,requiereConfirmacion:!registro.access_token});
    }

    if(req.method==="POST"&&u.pathname==="/api/portal/login"){
      if(!supabaseAuth)return send(res,503,{error:"El acceso de clientes no está configurado"});
      const input=await body(req);
      let session;
      try{session=await supabaseAuth.login(String(input.email||"").trim().toLowerCase(),String(input.password||""))}
      catch{return send(res,401,{error:"Correo o contraseña incorrectos"})}
      const cliente=await portalClientes?.findById(session.user.id);
      if(!cliente||!cliente.activo)return send(res,403,{error:"Esta cuenta no tiene acceso al portal de clientes"});
      authCookies(res,session);
      return send(res,200,{user:{id:session.user.id,email:session.user.email},cliente});
    }

    if(req.method==="GET"&&u.pathname==="/api/portal/session"){
      const session=await authenticatePortal(req,res);if(!session)return;
      return send(res,200,{user:{id:session.user.id,email:session.user.email},cliente:session.cliente});
    }

    if(req.method==="PUT"&&u.pathname==="/api/portal/perfil"){
      const session=await authenticatePortal(req,res);if(!session)return;
      const input=await body(req);
      if(!/^[A-ZÑ&]{3,4}\d{6}[A-Z0-9]{3}$/.test(String(input.rfc||"").trim().toUpperCase()))return send(res,400,{error:"El RFC no tiene un formato válido"});
      if(!/^\d{5}$/.test(String(input.codigoPostal||"")))return send(res,400,{error:"El código postal debe contener 5 números"});
      const perfil=await portalClientes.save(session.user.id,{...session.cliente,...input,email:session.user.email,avisoVersion:session.cliente.avisoVersion,avisoAceptadoEn:session.cliente.avisoAceptadoEn});
      return send(res,200,perfil);
    }

    if(req.method==="GET"&&u.pathname==="/api/portal/pedidos"){
      const session=await authenticatePortal(req,res);if(!session)return;
      const folio=u.searchParams.get("folio");if(!folio)return send(res,400,{error:"Ingresa el folio del pedido"});
      let pedido;try{pedido=await pedidos.obtenerPedido(folio)}catch(error){return errorFuente(res,error)}if(!pedido)return send(res,404,{error:"Pedido no encontrado"});
      if(!pedidoPerteneceACliente(pedido,session.cliente))return send(res,403,{error:"Los datos de tu cuenta no coinciden con el correo o teléfono del pedido"});
      const existente=await facturaExistentePedido(pedido);
      if(existente)return send(res,409,{error:`Este pedido ya fue facturado con el folio ${existente.folioInterno||existente.id}`});
      if(pedido.facturado)return send(res,409,{error:"Este pedido ya está marcado como facturado"});
      return send(res,200,timbradoConfig.produccion?pedidoProduccion(pedido):pedido);
    }

    if(req.method==="GET"&&u.pathname==="/api/portal/facturas"){
      const session=await authenticatePortal(req,res);if(!session)return;
      return send(res,200,await portalFacturas.listar(session.user.id));
    }

    if(req.method==="GET"&&/^\/api\/portal\/facturas\/[^/]+\/documento\/(xml|pdf)$/.test(u.pathname)){
      const session=await authenticatePortal(req,res);if(!session)return;
      const parts=u.pathname.split("/"),tipo=parts[6];
      const documento=await portalFacturas.documento(session.user.id,decodeURIComponent(parts[4]),tipo);
      await registrarAuditoria({session:{user:session.user,profile:{nombre:session.cliente.nombre}}},documento.factura,"DESCARGA_DOCUMENTO",{tipo,almacenamiento:documento.almacenamiento,canal:"PORTAL"});
      return serveBytes(res,documento.bytes,documento.contentType,documento.nombre);
    }

    if(req.method==="GET"&&/^\/api\/portal\/facturas\/[^/]+$/.test(u.pathname)){
      const session=await authenticatePortal(req,res);if(!session)return;
      return send(res,200,await portalFacturas.detalle(session.user.id,decodeURIComponent(u.pathname.split("/")[4])));
    }

    if(req.method==="POST"&&u.pathname==="/api/portal/facturas"){
      const session=await authenticatePortal(req,res);if(!session)return;
      const input=await body(req),folio=String(input.folioOrigen||"").trim();
      const perfil=session.cliente;
      if(!perfil.rfc||!perfil.codigoPostal||!perfil.regimenFiscal)return send(res,400,{error:"Completa y guarda primero tus datos fiscales"});
      const existente=await facturas.findByFolioOrigen(folio);if(existente)return send(res,409,{error:"Este pedido ya fue facturado"});
      let pedido;try{pedido=await pedidos.obtenerPedido(folio)}catch(error){return errorFuente(res,error)}if(!pedido)return send(res,404,{error:"Pedido no encontrado"});
      if(!pedidoPerteneceACliente(pedido,perfil))return send(res,403,{error:"El pedido no pertenece a tu cuenta"});
      if(pedido.cancelado)return send(res,409,{error:"No se puede facturar un pedido cancelado"});
      if(pedido.facturado)return send(res,409,{error:"Este pedido ya está marcado como facturado"});
      const duplicada=await facturaExistentePedido(pedido);if(duplicada)return send(res,409,{error:"Este pedido ya fue facturado"});
      validarVentaParaFacturar(pedido);
      const factura={...crearFactura({...input,origen:pedido.origen,folioOrigen:pedido.folio,cliente:{tipoPersona:perfil.tipoPersona,razonSocial:perfil.razonSocial||perfil.nombre,rfc:perfil.rfc,codigoPostal:perfil.codigoPostal,regimenFiscal:perfil.regimenFiscal,email:perfil.email},usoCfdi:perfil.usoCfdi,aplicarIva:true,tasaIva:0.16,conceptos:timbradoConfig.produccion?conceptosPedidoProduccion(pedido):((pedido.productos||[]).map(p=>({...p,tasaIva:0.16})))}),ambienteOperacion:ambienteBorrador,portalClienteId:session.user.id,portalEmail:session.user.email,pedido:referenciaPedido(pedido)};
      let guardada=await facturas.save(factura);
      try{const sincronizacion=await pedidos.marcarFacturado(pedido,guardada);if(sincronizacion)guardada=await facturas.update(guardada.id,{pedidoMarcadoFacturado:true,sincronizacionPedido:sincronizacion})}
      catch(error){guardada=await facturas.update(guardada.id,{pedidoMarcadoFacturado:false,errorSincronizacionPedido:error.message});guardada.advertencia="La factura se guardó, pero no fue posible marcar el pedido en Firebase."}
      await registrarAuditoria({session:{user:session.user,profile:{nombre:perfil.nombre}}},guardada,"CREACION_PORTAL",{clientePortal:session.user.email,total:guardada.total});
      return send(res,201,guardada);
    }

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
      correoFacturas.preparar(factura,email);
      if(process.env.FACTURAMA_EMAIL_ENABLED!=="true")return send(res,503,{error:"Envío deshabilitado. Configura FACTURAMA_EMAIL_ENABLED=true."});
      if(factura.correoEnvio?.estado==="ENVIANDO" && !(input.reenviar===true && Date.now()-Date.parse(factura.correoEnvio.fecha)>120000))return send(res,409,{error:"Existe un envío en curso o interrumpido. Verifica en Facturama antes de volver a intentarlo."});
      if(factura.correoEnvio && input.reenviar!==true)return send(res,409,{error:"Ya existe un intento de envío. Revisa el estado y confirma expresamente el reenvío."});
      const locked=await facturas.compareAndUpdate(factura,{correoEnvio:{estado:"ENVIANDO",destinatario:email,fecha:new Date().toISOString()}});
      if(!locked)return send(res,409,{error:"La factura cambió; actualiza el historial."});
      let envio;
      try{envio=await correoFacturas.enviar(locked,email)}catch(e){const resultado={estado:"POR_CONFIRMAR",destinatario:email,fecha:new Date().toISOString(),nota:e.message};await facturas.compareAndUpdate(locked,{correoEnvio:resultado});await registrarAuditoria(req,factura,"CORREO_NO_CONFIRMADO",resultado);return send(res,e.statusCode||502,{error:e.message,correoEnvio:resultado});}
      const updated=await facturas.compareAndUpdate(locked,{correoEnvio:envio});
      await registrarAuditoria(req,factura,"CORREO_ACEPTADO_PROVEEDOR",envio);
      if(!updated)return send(res,409,{error:"Facturama aceptó el envío, pero el registro cambió; revisa la bitácora antes de reenviar."});
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
      if(timbradoConfig.produccion){
        if(factura.ambienteOperacion!=="PRODUCCION")throw errorProduccion("Este borrador es de pruebas o anterior a producción. Elimínalo si sigue en borrador y crea uno nuevo desde la compra.","PRODUCCION_BORRADOR_OTRO_AMBIENTE",409);
        await verificarCompraProduccion(factura);
        const updated=await timbradoProduccion.timbrar(factura);
        await registrarAuditoria(req,updated,"TIMBRADO",{estatus:updated.estatus,uuid:updated.uuid,pac:"facturama_produccion",facturamaId:updated.timbradoProduccion?.facturamaId});
        return send(res,200,updated);
      }
      if(factura.ambienteOperacion==="PRODUCCION")throw errorProduccion("Activa el proveedor productivo para emitir este borrador.","PRODUCCION_BORRADOR_OTRO_AMBIENTE",409);
      if(factura.pedido?.fuente==="ECOMMERCE_API"){
        let actual;try{actual=await pedidos.obtenerPedido(String(factura.pedido.ecommerceId))}catch(error){return errorFuente(res,error)}
        if(!actual)return send(res,404,{error:"La venta del e-commerce ya no está disponible"});
        validarVentaParaFacturar(actual);
        if(!ventaCoincideConFactura(actual,factura))
          return send(res,409,{error:"La venta cambió desde que se guardó el borrador. Actualízalo antes de timbrar"});
      }
      if(timbradoConfig.sandbox){
        const updated=await timbradoSandbox.timbrar(factura);
        await registrarAuditoria(req,updated,"TIMBRADO",{estatus:updated.estatus,uuid:updated.uuid,pac:"facturama_sandbox",facturamaId:updated.timbradoSandbox?.facturamaId});
        return send(res,200,updated);
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
      const updated = await facturas.update(id,{
        estatus:result.estatus,
        uuid:result.uuid,
        fechaTimbrado:result.fechaTimbrado,
        xmlRelativePath:result.xmlRelativePath,
        pdfRelativePath:result.pdfRelativePath,
        ...storagePaths,
        documentStorage:documentStorage?"supabase":"local"
      });
      await registrarAuditoria(req,updated,"TIMBRADO",{estatus:updated.estatus,uuid:updated.uuid,pac:"mock"});
      return send(res,200,updated);
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
        return serveBytes(res,bytes,mime[`.${tipo}`],`${factura.folioInterno||factura.folioOrigen||factura.id}.${tipo}`);
      }
      if (!rel) return send(res,404,{error:"Documento no disponible"});
      await registrarAuditoria(req,factura,"DESCARGA_DOCUMENTO",{tipo,almacenamiento:"local"});
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
}).listen(port,()=>console.log(`Facturación: http://localhost:${port} · v1.19.3 · ${timbradoConfig.provider}`));

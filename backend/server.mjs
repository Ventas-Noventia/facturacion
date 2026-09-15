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
import { SupabaseConfiguracionFiscalRepository } from "./repositories/supabaseConfiguracionFiscalRepository.mjs";
import { MockTimbradoService } from "./services/mockTimbradoService.mjs";
import { EcommerceJsonService } from "./services/ecommerceJsonService.mjs";
import { FirebaseJsonService } from "./services/firebaseJsonService.mjs";
import { PedidosService } from "./services/pedidosService.mjs";
import { ReportesService } from "./services/reportesService.mjs";
import { LocalAuthService } from "./services/localAuthService.mjs";
import { SupabaseAuthService } from "./services/supabaseAuthService.mjs";
import { SupabaseDocumentStorageService } from "./services/supabaseDocumentStorageService.mjs";
import { crearFactura } from "../shared/domain/factura.mjs";
import { loadEnv } from "./config/loadEnv.mjs";

loadEnv();

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
const pac = new MockTimbradoService();
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
const pedidos = new PedidosService({
  ecommerceService: new EcommerceJsonService(),
  firebaseService: new FirebaseJsonService()
});

const mime = {
  ".html":"text/html; charset=utf-8",
  ".css":"text/css; charset=utf-8",
  ".js":"application/javascript; charset=utf-8",
  ".xml":"application/xml; charset=utf-8",
  ".pdf":"application/pdf"
};

function send(res, status, body) {
  res.writeHead(status, {"Content-Type":"application/json; charset=utf-8"});
  res.end(JSON.stringify(body));
}

async function body(req) {
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  return JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}");
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
  try {
    const u = new URL(req.url, `http://${req.headers.host}`);

    if (req.method === "GET" && u.pathname === "/favicon.ico") {
      res.writeHead(204);
      return res.end();
    }


    if (req.method === "GET" && u.pathname === "/api/health")
      return send(res, 200, {ok:true, mode:supabaseConfigured?"supabase":"local", auth:authConfigured?"supabase":"missing", pac:"mock"});

    if (req.method === "POST" && u.pathname === "/api/auth/login") {
      if(!supabaseAuth)return send(res,503,{error:"Falta configurar SUPABASE_PUBLISHABLE_KEY"});
      const input=await body(req);
      if(!input.email||!input.password)return send(res,400,{error:"Correo y contraseña son obligatorios"});
      let session;
      try{session=await supabaseAuth.login(String(input.email).trim().toLowerCase(),String(input.password))}
      catch{return send(res,401,{error:"Correo o contraseña incorrectos"})}
      const profile=await usuarios.findById(session.user.id);
      if(!profile||!profile.activo)return send(res,403,{error:"Tu usuario no tiene un perfil activo"});
      authCookies(res,session);
      return send(res,200,{user:{id:session.user.id,email:session.user.email},profile,permissions:auth.permissionsFor(profile.rol)});
    }

    if (req.method === "POST" && u.pathname === "/api/auth/logout") {
      clearAuthCookies(res);
      return send(res,200,{ok:true});
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
      return send(res,200,await configuracionFiscal.save(input));
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
      return send(res, 200, await facturas.list());
    }

    if (req.method === "GET" && u.pathname === "/api/reportes") {
      if (!(await allow(req,res,"reportes:ver"))) return;
      return send(res, 200, reportes.construir(await facturas.list()));
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

    if (req.method === "GET" && u.pathname === "/api/pedidos") {
      const folio = u.searchParams.get("folio");
      if (!folio) return send(res,400,{error:"Falta folio"});
      const pedido = await pedidos.obtenerPedido(folio);
      if (!pedido) return send(res,404,{error:"Pedido no encontrado"});
      return send(res,200,pedido);
    }

    if (req.method === "POST" && u.pathname === "/api/facturas") {
      if (!(await allow(req,res,"facturas:crear"))) return;
      const factura = crearFactura(await body(req));
      return send(res,201,await facturas.save(factura));
    }

    if (req.method === "POST" && /^\/api\/facturas\/[^/]+\/timbrar$/.test(u.pathname)) {
      if (!(await allow(req,res,"facturas:timbrar"))) return;
      const id = u.pathname.split("/")[3];
      const factura = await facturas.findById(id);
      if (!factura) return send(res,404,{error:"Factura no encontrada"});
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
      return send(res,200,updated);
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
        return serveBytes(res,bytes,mime[`.${tipo}`],`${factura.folioInterno||factura.folioOrigen||factura.id}.${tipo}`);
      }
      if (!rel) return send(res,404,{error:"Documento no disponible"});
      return serveFile(res, path.join(storageRoot,rel), `${factura.folioOrigen || factura.id}.${tipo}`);
    }

    const rel = u.pathname === "/" ? "index.html" : u.pathname.slice(1);
    const safe = path.normalize(rel).replace(/^\.\.(\/|\\|$)/, "");
    return serveFile(res, path.join(publicDir,safe));
  } catch (e) {
    if (e.code === "ENOENT") { res.writeHead(404); res.end("Not found"); }
    else send(res,400,{error:e.message});
  }
}).listen(port,()=>console.log(`Facturación: http://localhost:${port}`));

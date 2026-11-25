import http from "node:http";
import net from "node:net";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { execFileSync, spawn } from "node:child_process";
import { once } from "node:events";
import { fileURLToPath, pathToFileURL } from "node:url";
import { ventaEjemplo } from "./ecommerce.mjs";

// This entry point runs only in the test child. It permits requests to the
// local fake Supabase and redirects one fictional HTTPS e-commerce host to it.
// It cannot contact real APIs or weaken production certificate verification.
if (process.argv[2] === "--child") {
  const realFetch = globalThis.fetch, fake = new URL(process.env.NOVENTIA_TEST_FAKE_URL);
  globalThis.fetch = (value, options) => {
    const url = new URL(value);
    if (url.origin === "https://ecommerce.example.invalid") {
      return realFetch(`${fake.origin}/fake-ecommerce${url.pathname}${url.search}`, options);
    }
    if (url.origin === "https://api.facturama.mx") {
      return realFetch(`${fake.origin}/fake-facturama-produccion${url.pathname}${url.search}`, options).then(response => new Response(response.body, {status:response.status,headers:response.headers}));
    }
    if (url.origin === "https://apisandbox.facturama.mx") {
      return realFetch(`${fake.origin}/fake-facturama${url.pathname}${url.search}`, options).then(response => new Response(response.body, {status:response.status,headers:response.headers}));
    }
    if (url.origin === fake.origin) return realFetch(value, options);
    throw new Error("La prueba bloqueo una conexion externa");
  };
  await import(pathToFileURL(process.env.NOVENTIA_TEST_SERVER_PATH).href);
}

async function freePort() {
  const server = net.createServer(); server.listen(0, "127.0.0.1"); await once(server, "listening");
  const port = server.address().port; await new Promise(resolve => server.close(resolve)); return port;
}

export function barreraPrueba() {
  let release, signal;
  const released = new Promise(resolve => { release = resolve; });
  const entered = new Promise(resolve => { signal = resolve; });
  return { entered, release, async wait() { signal(); await released; } };
}

export async function iniciarServidorVentaPrueba({ sandbox = false, produccion = false, conProduccion = produccion, email = false } = {}) {
  const project = fileURLToPath(new URL("../../", import.meta.url));
  const temporary = await fs.mkdtemp(path.join(os.tmpdir(), "noventia-venta-http-"));
  const app = path.join(temporary, "app"); await fs.mkdir(app);
  for (const folder of ["backend", "shared"]) await fs.cp(path.join(project, folder), path.join(app, folder), {
    recursive: true, filter: source => ![path.join(project, "backend/data"), path.join(project, "backend/storage")].includes(source)
  });
  await fs.copyFile(path.join(project,"preparar-facturama-produccion.mjs"),path.join(app,"preparar-facturama-produccion.mjs"));
  await fs.mkdir(path.join(app, "public/img"), { recursive: true });
  await fs.copyFile(path.join(project, "public/img/logo2.png"), path.join(app, "public/img/logo2.png"));
  await fs.symlink(path.join(project, "node_modules"), path.join(app, "node_modules"), "dir");
  const state = { sale: ventaEjemplo(), rows: [], documents: new Map(), requests: [], auditoria: [], beforeSave: null, beforeUpload: null, failUpload: false, comprobantes: [], failPdf: false, postFacturamaIncierto: false, beforeFacturama: null, facturasError: null };
  state.modo=produccion?"facturama_produccion":sandbox?"facturama_sandbox":"mock";
  state.comprobantesProduccion=[];
  state.fiscal={id:"principal",razon_social:"EMISOR REAL SINTETICO",rfc:"AAA010101AAA",codigo_postal:"53490",regimen_fiscal:"601",serie:"NV",ambiente:produccion?"PRODUCCION":"PRUEBAS",exportacion:"01",version_cfdi:"4.0",pac_proveedor:produccion?"FACTURAMA":"PENDIENTE"};
  if(conProduccion){
    const key=path.join(temporary,"test.pem"),cer=path.join(temporary,"test.cer");
    execFileSync("openssl",["req","-new","-x509","-newkey","rsa:2048","-nodes","-keyout",key,"-outform","DER","-out",cer,"-days","30","-subj","/C=MX/O=DATOS FICTICIOS/CN=SOLO PRUEBAS/x500UniqueIdentifier=AAA010101AAA","-addext","basicConstraints=critical,CA:FALSE","-addext","keyUsage=critical,digitalSignature,nonRepudiation"],{stdio:"ignore"});
    state.testCsd=(await fs.readFile(cer)).toString("base64");
    await fs.rm(key);await fs.rm(cer);
  }
  const fake = http.createServer(async (req, res) => {
    const url = new URL(req.url, "http://localhost");
    const json = (status, data) => { res.writeHead(status, { "Content-Type": "application/json" }); res.end(JSON.stringify(data)); };
    try {
      const chunks = []; for await (const chunk of req) chunks.push(chunk);
      const bytes = Buffer.concat(chunks);
      state.requests.push({ method: req.method, pathname: url.pathname, query: Object.fromEntries(url.searchParams), authorization: req.headers.authorization || "" });
      if (url.pathname === "/auth/v1/user") {
        const users = { "Bearer admin-session": { id: "admin", email: "admin@example.invalid" }, "Bearer customer-session": { id: "customer", email: "prueba@example.com" }, "Bearer view-session": { id: "viewer", email: "viewer@example.invalid" } };
        const user = users[req.headers.authorization]; return json(user ? 200 : 401, user || { error: "Sin sesion" });
      }
      if(url.pathname==="/fake-facturama/Cfdi"||url.pathname==="/fake-facturama-produccion/Cfdi"){
        if(state.emailBarrier)await state.emailBarrier.wait();
        return json(200,{success:state.emailSuccess!==false,msj:"Resultado de prueba"});
      }
      if (url.pathname === "/rest/v1/profiles") {
        const id = url.searchParams.get("id")?.replace(/^eq\./, "");
        return json(200, ["admin", "viewer"].includes(id) ? [{ id, nombre: "Prueba", email: `${id}@example.invalid`, rol: id === "admin" ? "ADMIN" : "CONSULTA", activo: true }] : []);
      }
      if (url.pathname === "/rest/v1/portal_clientes") return json(200, [{ user_id: "customer", nombre: "Cliente de prueba", email: "prueba@example.com", telefono: "", razon_social: "CLIENTE DE PRUEBA", tipo_persona: "FISICA", rfc: "XAXX010101000", codigo_postal: "53490", regimen_fiscal: "616", uso_cfdi: "G03", activo: true }]);
      if(url.pathname==="/rest/v1/productos_fiscales"){
        state.catalogo ||= [];
        if(req.method==="POST"){const input=JSON.parse(bytes);const map=new Map(state.catalogo.map(r=>[r.sku,r]));for(const r of input)map.set(r.sku,r);state.catalogo=[...map.values()];return json(200,[]);}
        let rows=state.catalogo;const filter=url.searchParams.get('sku');if(filter){const keys=JSON.parse('['+filter.slice(4,-1)+']');rows=rows.filter(r=>keys.includes(r.sku));}
        const offset=Number(url.searchParams.get('offset')||0),limit=Number(url.searchParams.get('limit')||500);return json(200,rows.slice(offset,offset+limit));
      }
      if (url.pathname === "/rest/v1/configuracion_fiscal") { if(req.method==="POST")state.fiscal=JSON.parse(bytes); return json(200,[state.fiscal]); }
      if (url.pathname === "/fake-ecommerce/api/v1/invoicing/auth/token") {
        assertTest(req.method === "POST", "Token requiere POST");
        assertTest(JSON.parse(bytes).username === "FAKE-USERNAME", "Usuario de prueba esperado");
        assertTest(JSON.parse(bytes).password === "FAKE-PASSWORD", "Password de prueba esperado");
        return json(200, { access_token: "FAKE-TOKEN", token_type: "Bearer", expires_in: 3600 });
      }
      if (url.pathname.startsWith("/fake-ecommerce/")) {
        assertTest(req.method === "GET", "Solo se permiten lecturas del e-commerce");
        assertTest(req.headers.authorization === "Bearer FAKE-TOKEN", "Bearer esperado");
        const sale = state.sale.data;
        if (url.pathname === `/fake-ecommerce/api/v1/invoicing/orders/${sale.order.id}`) return json(200, state.sale);
        if (url.pathname === "/fake-ecommerce/api/v1/invoicing/orders") return json(200, { data: url.searchParams.get("order_number")?.toUpperCase() === sale.order.order_number.toUpperCase() ? [{ id: sale.order.id, order_number: sale.order.order_number }] : [], links: { next: null } });
        return json(404, { error: "Pedido de prueba inexistente" });
      }
      if (url.pathname.startsWith("/fake-facturama/") || url.pathname.startsWith("/fake-facturama-produccion/")) {
        const real=url.pathname.startsWith("/fake-facturama-produccion/"), prefix=real?"/fake-facturama-produccion":"/fake-facturama", records=real?state.comprobantesProduccion:state.comprobantes;
        assertTest(req.headers.authorization === `Basic ${Buffer.from(real?"FAKE-PROD-USER:FAKE-PROD-PASS":"FAKE-SANDBOX-USER:FAKE-SANDBOX-PASS").toString("base64")}`, "Facturama requiere Basic separado del token ecommerce");
        const endpoint = url.pathname.slice(prefix.length);
        if(real && endpoint==="/SuscriptionPlan" && req.method==="GET")return json(state.failCuenta?401:200,{Plan:"API",CurrentFolios:100,ExpirationDate:"2099-10-29T00:00:00",PrivateKeyPassword:"SECRETO_NO_MOSTRAR"});
        if(real && endpoint==="/api-lite/csds/AAA010101AAA" && req.method==="GET")return json(state.failCsd?404:200,{Rfc:"AAA010101AAA",Certificate:state.testCsd,PrivateKey:"NO_MOSTRAR"});
        if (endpoint === "/api-lite/4/cfdis" && req.method === "POST") {
          if (state.beforeFacturama) await state.beforeFacturama();
          if (state.failFacturamaSinEmitir) return json(500,{Message:"FALLO_SIMULADO_SIN_COMPROBANTE"});
          const p = JSON.parse(bytes), id = `${real?"PROD":"FAKE"}-CFDI-${records.length+1}`;
          const total = Number(p.Items.reduce((s,c)=>s+c.Total,0).toFixed(2));
          const record = { Id:id,Status:"active",Folio:p.Folio,Serie:p.Serie,Date:p.Date,OrderNumber:p.OrderNumber,Issuer:p.Issuer,Receiver:p.Receiver,Total:total,
            TaxStamp:{Uuid:"11111111-2222-4333-8444-555555555555",Date:p.Date}, payload:p };
          record.xml = `<?xml version="1.0"?><cfdi:Comprobante xmlns:cfdi="http://www.sat.gob.mx/cfd/4" xmlns:tfd="http://www.sat.gob.mx/TimbreFiscalDigital" Version="4.0" Moneda="MXN" TipoDeComprobante="I" Folio="${p.Folio}" Serie="${p.Serie}" Fecha="${p.Date}" Total="${total.toFixed(2)}"><cfdi:Emisor Rfc="${p.Issuer.Rfc}"/><cfdi:Receptor Rfc="${p.Receiver.Rfc}"/><cfdi:Complemento><tfd:TimbreFiscalDigital UUID="${record.TaxStamp.Uuid}"/></cfdi:Complemento></cfdi:Comprobante>`;
          records.push(record);
          if(state.postFacturamaIncierto)return json(503,{Message:"RESPUESTA_PRIVADA_NO_MOSTRAR"});
          return json(201,{Id:id,XmlBase64:Buffer.from(record.xml).toString("base64"),TaxStamp:record.TaxStamp});
        }
        if(endpoint === "/cfdi" && req.method === "GET"){
          if(state.beforeFacturamaConsulta)await state.beforeFacturamaConsulta();
          if(state.failFacturamaConsulta)return json(503,{});
          if(state.resultadoFacturamaAmbiguo)return json(200,[state.resultadoFacturamaAmbiguo]);
          return json(200,records.filter(c=>c.Folio===url.searchParams.get("folio")).map(({xml,payload,...c})=>c));
        }
        const record=records.find(c=>c.Id===endpoint.split("/").at(-1));
        if(!record)return json(404,{});
        if(endpoint.startsWith("/api-lite/cfdis/") && req.method === "DELETE"){
          if(state.beforeCancelacion)await state.beforeCancelacion();
          if(state.failCancelacionAntes)return json(500,{});
          if(state.rechazoCancelacion)return json(400,{});
          record.Status=state.cancelacionPendiente?"pending":"cancel";
          if(state.failCancelacionDespues)return json(500,{});
          if(state.cancelacionRespuestaSinConfirmar){record.Status="active";return json(200,{Status:"canceled"})}
          return json(200,{Status:record.Status==="cancel"?"canceled":"pending",Uuid:record.TaxStamp.Uuid});
        }
        if(endpoint.startsWith("/acuse/pdf/issuedLite/") && req.method === "GET"){
          if(state.failAcuse)return json(503,{});
          const bytes=Buffer.from("%PDF-1.4\nACUSE ORIGINAL SANDBOX\n%%EOF");
          return json(200,{ContentEncoding:"base64",Content:bytes.toString("base64"),ContentLength:bytes.length});
        }
        if(endpoint.startsWith("/api-lite/cfdis/") && req.method === "GET"){
          if(state.failDetalleFacturama)return json(503,{});
          const {xml,payload,...detail}=record;return json(200,detail);
        }
        if(/^\/cfdi\/(pdf|xml)\/issuedLite\//.test(endpoint) && req.method === "GET"){
          const tipo=endpoint.split("/")[2];
          if(tipo==="pdf"&&state.failPdf)return json(503,{});
          const content=Buffer.from(tipo==="xml"?record.xml:"%PDF-1.4\nARCHIVO_ORIGINAL_SANDBOX_DE_PRUEBA\n%%EOF");
          return json(200,{ContentEncoding:"base64",ContentType:tipo,ContentLength:content.length,Content:content.toString("base64")});
        }
        return json(405,{});
      }
      if (url.pathname === "/rest/v1/facturas") {
        if(state.facturasError && (!state.facturasError.method || state.facturasError.method===req.method)){
          const {status=400,method,...data}=state.facturasError;return json(status,data);
        }
        let selected = state.rows;
        for (const [key, value] of url.searchParams) {
          const field = { id: row => row.id, folio_origen: row => row.data.folioOrigen, "data->pedido->>ecommerceId": row => row.data.pedido?.ecommerceId, "data->pedido->>fuente": row => row.data.pedido?.fuente, "data->>portalClienteId": row => row.data.portalClienteId, "data->>estatus": row => row.data.estatus, "data->>revision": row => row.data.revision }[key];
          if (field) selected = selected.filter(row => value === "is.null" ? field(row) == null : `eq.${field(row)}` === value);
        }
        if (req.method === "GET") return json(200, selected);
        if (req.method === "POST") {
          if (state.beforeSave) await state.beforeSave();
          const input = JSON.parse(bytes), data = jsonb(input.data);
          const active = f => !String(f.estatus || "").startsWith("CANCELADA");
          const key = f => String(f.folioOrigen || "").trim().toUpperCase();
          const apiId = f => f.pedido?.fuente === "ECOMMERCE_API" ? String(f.pedido.ecommerceId) : "";
          if (state.rows.some(row => row.id === input.id || (active(row.data) && active(data) && ((key(data) && key(row.data) === key(data)) || (apiId(data) && apiId(row.data) === apiId(data)))))) return json(409, { code: "23505", message: "DETALLE_SQL_PRIVADO" });
          const numero = state.rows.reduce((n, row) => Math.max(n, row.numero), 0) + 1;
          const row = { id: input.id, data, numero, folio_interno: `NOV-FAC-${String(numero).padStart(6, "0")}`, creada_en: data.creadaEn };
          state.rows.push(row); return json(201, [row]);
        }
        if (req.method === "PATCH") { const input = JSON.parse(bytes); for (const row of selected) row.data = jsonb(input.data); return json(200, selected); }
        if (req.method === "DELETE") { state.rows = state.rows.filter(row => !selected.includes(row)); return json(200, []); }
      }
      if (url.pathname === "/rest/v1/auditoria_facturas" && req.method === "POST") {
        const record = JSON.parse(bytes); state.auditoria.push(record); return json(201, [record]);
      }
      if (url.pathname.startsWith("/storage/v1/object/documentos-fiscales/")) {
        const key = decodeURIComponent(url.pathname.replace("/storage/v1/object/documentos-fiscales/", ""));
        if (req.method === "POST") {
          if (state.beforeUpload) await state.beforeUpload();
          if (state.failUpload) return json(503, { message: "Fallo de almacenamiento simulado" });
          state.documents.set(key, bytes); return json(200, { Key: key });
        }
        if (!state.documents.has(key)) return json(404, { error: "No existe" });
        res.writeHead(200, { "Content-Type": key.endsWith(".pdf") ? "application/pdf" : "application/xml" }); return res.end(state.documents.get(key));
      }
      return json(404, { error: "Ruta de prueba inexistente" });
    } catch (error) { return json(500, { error: error.message }); }
  });
  fake.listen(0, "127.0.0.1"); await once(fake, "listening");
  const fakeUrl = `http://127.0.0.1:${fake.address().port}`, port = await freePort();
  let child,logs="";
  async function start() {
    const env = { ...process.env, FACTURAMA_EMAIL_ENABLED:email?"true":"false", FACTURAMA_LOGO_URL:"", PORT: String(port), APP_ENV: "test", TIMBRADO_PROVIDER:state.modo, FACTURAMA_PRODUCTION_ENABLED:produccion?"true":"false", FACTURAMA_PRODUCTION_USERNAME:conProduccion?"FAKE-PROD-USER":"",FACTURAMA_PRODUCTION_PASSWORD:conProduccion?"FAKE-PROD-PASS":"",FACTURAMA_PRODUCTION_RFC:conProduccion?"AAA010101AAA":"", FACTURAMA_USERNAME:"FAKE-SANDBOX-USER", FACTURAMA_PASSWORD:"FAKE-SANDBOX-PASS", FACTURAMA_API_BASE_URL:"https://apisandbox.facturama.mx", SUPABASE_URL: fakeUrl, SUPABASE_SERVICE_ROLE_KEY: "FAKE-SERVICE-KEY", SUPABASE_PUBLISHABLE_KEY: "FAKE-PUBLIC-KEY", SUPABASE_DOCUMENT_BUCKET: "documentos-fiscales", ECOMMERCE_SOURCE: "api", ECOMMERCE_API_BASE_URL: "https://ecommerce.example.invalid/api/v1/invoicing", ECOMMERCE_API_USERNAME: "FAKE-USERNAME", ECOMMERCE_API_PASSWORD: "FAKE-PASSWORD", FIREBASE_PROJECT_ID: "FAKE-PROJECT", GOOGLE_APPLICATION_CREDENTIALS: "", FIREBASE_SERVICE_ACCOUNT_JSON: "", FIREBASE_SERVICE_ACCOUNT_BASE64: "", NOVENTIA_TEST_FAKE_URL: fakeUrl, NOVENTIA_TEST_SERVER_PATH: path.join(app, "backend/server.mjs") };
    child = spawn(process.execPath, [fileURLToPath(import.meta.url), "--child"], { cwd: app, env, stdio: ["ignore", "pipe", "pipe"] });
    logs = ""; child.stderr.on("data", chunk => { logs += chunk; });
    const timeout = setTimeout(() => child.kill(), 12000);
    try {
      await Promise.race([new Promise(resolve => child.stdout.on("data", chunk => { if (String(chunk).includes("Facturación:")) resolve(); })), new Promise((_, reject) => child.once("exit", code => reject(new Error(`Servidor de prueba termino: ${code} ${logs.slice(-500)}`))))]);
    } finally { clearTimeout(timeout); }
  }
  async function stop() { if (child && child.exitCode === null && child.signalCode === null) { child.kill(); await once(child, "exit"); } }
  try { await start(); }
  catch (error) { fake.closeAllConnections(); await new Promise(resolve => fake.close(resolve)); await fs.rm(temporary, { recursive: true, force: true }); throw error; }
  return { baseUrl: `http://127.0.0.1:${port}`, fakeUrl, state, errores:()=>logs, async reiniciar() { await stop(); await start(); }, async cerrar() {
    await stop(); fake.closeAllConnections(); await new Promise(resolve => fake.close(resolve)); await fs.rm(temporary, { recursive: true, force: true });
  } };
}

// Model the key-order loss of PostgreSQL jsonb for every saved document.
function jsonb(value) {
  if(Array.isArray(value))return value.map(jsonb);
  if(value&&typeof value==="object")return Object.fromEntries(Object.keys(value).sort((a,b)=>a.length-b.length||a.localeCompare(b)).map(key=>[key,jsonb(value[key])]));
  return value;
}

function assertTest(condition, message) { if (!condition) throw new Error(message); }

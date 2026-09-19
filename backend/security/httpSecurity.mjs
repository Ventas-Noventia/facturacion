const MAX_BODY_BYTES=1024*1024;
const LOGIN_WINDOW_MS=15*60*1000;
const LOGIN_MAX_ATTEMPTS=5;
const loginAttempts=new Map();

export function applySecurityHeaders(res,{production=false}={}){
  res.setHeader("X-Content-Type-Options","nosniff");
  res.setHeader("X-Frame-Options","DENY");
  res.setHeader("Referrer-Policy","no-referrer");
  res.setHeader("Permissions-Policy","camera=(), microphone=(), geolocation=()");
  res.setHeader("Cross-Origin-Opener-Policy","same-origin");
  res.setHeader("Content-Security-Policy",[
    "default-src 'self'",
    "base-uri 'self'",
    "frame-ancestors 'none'",
    "form-action 'self'",
    "object-src 'none'",
    "img-src 'self' data:",
    "style-src 'self' 'unsafe-inline' https://kit.fontawesome.com",
    "script-src 'self' https://kit.fontawesome.com",
    "script-src-attr 'unsafe-inline'",
    "font-src 'self' https://ka-f.fontawesome.com",
    "connect-src 'self' https://ka-f.fontawesome.com",
  ].join("; "));
  if(production)res.setHeader("Strict-Transport-Security","max-age=31536000; includeSubDomains");
}

export async function readJsonBody(req,maxBytes=MAX_BODY_BYTES){
  const chunks=[];let size=0;
  for await(const chunk of req){
    size+=chunk.length;
    if(size>maxBytes){
      const error=new Error("La solicitud excede el límite permitido");
      error.statusCode=413;
      throw error;
    }
    chunks.push(chunk);
  }
  const raw=Buffer.concat(chunks).toString("utf8");
  try{return JSON.parse(raw||"{}")}
  catch{
    const error=new Error("El contenido JSON no es válido");
    error.statusCode=400;
    throw error;
  }
}

function clientIp(req){
  if(process.env.TRUST_PROXY==="1")return String(req.headers["x-forwarded-for"]||"").split(",")[0].trim()||req.socket.remoteAddress||"unknown";
  return req.socket.remoteAddress||"unknown";
}

function loginKey(req,email=""){
  return `${clientIp(req)}:${String(email).trim().toLowerCase()}`;
}

export function loginRateStatus(req,email=""){
  const key=loginKey(req,email),now=Date.now();
  const state=loginAttempts.get(key);
  if(!state||state.resetAt<=now){loginAttempts.delete(key);return{allowed:true,key}}
  if(state.count<LOGIN_MAX_ATTEMPTS)return{allowed:true,key};
  return{allowed:false,key,retryAfter:Math.max(1,Math.ceil((state.resetAt-now)/1000))};
}

export function recordLoginFailure(key){
  const now=Date.now(),state=loginAttempts.get(key);
  if(!state||state.resetAt<=now)loginAttempts.set(key,{count:1,resetAt:now+LOGIN_WINDOW_MS});
  else state.count+=1;
}

export function clearLoginFailures(key){loginAttempts.delete(key)}

export function trustedMutationOrigin(req){
  if(process.env.APP_ENV!=="production")return true;
  const origin=String(req.headers.origin||"").replace(/\/$/,"");
  if(!origin)return true;
  const configured=String(process.env.APP_ORIGIN||"").replace(/\/$/,"");
  return Boolean(configured&&origin===configured);
}

export function validateProductionEnvironment(){
  if(process.env.APP_ENV!=="production")return;
  const required=["APP_ORIGIN","SUPABASE_URL","SUPABASE_SERVICE_ROLE_KEY","SUPABASE_PUBLISHABLE_KEY","FIREBASE_PROJECT_ID","GOOGLE_APPLICATION_CREDENTIALS"];
  const missing=required.filter(key=>!String(process.env[key]||"").trim());
  if(missing.length)throw new Error(`Configuración de producción incompleta: ${missing.join(", ")}`);
  if(!String(process.env.APP_ORIGIN).startsWith("https://"))throw new Error("APP_ORIGIN debe utilizar HTTPS en producción");
}

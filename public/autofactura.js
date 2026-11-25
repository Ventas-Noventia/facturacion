import {filtrarUsos, revisarReceptor} from "./compatibilidad-receptor.mjs";
import {regimenesTicket} from "./regimenes-ticket.mjs";
const $=id=>document.getElementById(id);
const compra=()=>({folio:$("folio").value.trim(),monto:$("monto").value,contacto:$("contacto").value.trim()});
let validada=false,ocupado=false;
async function api(ruta,datos){
  const response=await fetch("/api/ticket/"+ruta,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify(datos),cache:"no-store"});
  const json=await response.json();if(!response.ok)throw new Error(json.error||"No fue posible completar la operación.");
  return json;
}
function tipos(){
  const tipo=$("tipo").value;
  $("nombreLabel").firstChild.textContent=tipo==="MORAL"?"Razón social":"Nombre completo";
  $("rfc").pattern=tipo==="MORAL"?"[A-ZÑ&]{3}[0-9]{6}[A-Z0-9]{3}":"[A-ZÑ&]{4}[0-9]{6}[A-Z0-9]{3}";
  $("regimen").replaceChildren(new Option("Selecciona tu régimen",""),...regimenesTicket.filter(row=>row[2].includes(tipo)).map(([clave,nombre])=>new Option(clave+" · "+nombre,clave)));
  filtrarUsos($("regimen").value,$("uso"));
}
$("regimen").onchange=()=>filtrarUsos($("regimen").value,$("uso"));
tipos();$("tipo").onchange=tipos;
$("rfc").oninput=()=>{$("rfc").value=$("rfc").value.toUpperCase().trim();};
$("ticket").oninput=()=>{validada=false;$("campos").disabled=true;$("estadoTicket").textContent="";};
$("ticket").onsubmit=async event=>{
  event.preventDefault();if(ocupado)return;
  const datos=compra();ocupado=true;$("buscar").disabled=true;$("estadoTicket").textContent="Consultando tu compra…";$("campos").disabled=true;validada=false;
  try{
    const data=await api("buscar",datos);
    if(JSON.stringify(datos)!==JSON.stringify(compra()))return;
    validada=true;$("campos").disabled=false;$("estadoTicket").textContent="Ticket validado · "+data.folio+" · "+new Intl.NumberFormat("es-MX",{style:"currency",currency:"MXN"}).format(data.total);
    if(datos.contacto.includes("@")&&!$("email").value)$("email").value=datos.contacto;
    $("rfc").focus();
  }catch(error){$("estadoTicket").textContent=error.message;}finally{ocupado=false;$("buscar").disabled=false;}
};
let correccionActiva=null;
async function abrirCorreccion(data,boton){
  boton.disabled=true;
  try{
    const ruta="documentos/"+encodeURIComponent(data.id)+"/";
    const detalle=await api(ruta+"datos-correccion",{});
    const p=detalle.cliente;
    $("tipo").value=p.tipoPersona;tipos();
    $("rfc").value=p.rfc;$("nombre").value=p.razonSocial;$("cp").value=p.codigoPostal;
    $("regimen").value=p.regimenFiscal;filtrarUsos(p.regimenFiscal,$("uso"));$("uso").value=detalle.usoCfdi;
    $("email").value=p.email;$("email").readOnly=true;
    $("forma").value=detalle.formaPago;$("forma").disabled=true;$("acepta").checked=false;
    correccionActiva={ruta,revision:detalle.revision,folio:data.folioInterno};
    validada=true;$("campos").disabled=false;$("resultado").hidden=true;$("factura").hidden=false;
    $("estadoFactura").textContent=data.folioInterno+" · "+detalle.mensaje;
    $("emitir").textContent="Guardar y volver a emitir";$("nombre").focus();
  }catch(error){$("ayudaResultado").textContent=error.message;}finally{boton.disabled=false;}
}

function resultado(data){
  correccionActiva=null;
  $("ticket").hidden=true;$("factura").hidden=true;$("resultado").hidden=false;
  $("titulo").textContent=data.requiereRevision?"Emisión pendiente de revisión":data.estadoCliente?.etiqueta||"Factura registrada";
  $("ref").textContent="Folio de seguimiento: "+(data.folioInterno||data.id);
  $("archivos").replaceChildren();
  if(data.corregible){
    $("titulo").textContent="Corrige tus datos fiscales";
    const boton=document.createElement("button");boton.type="button";boton.textContent="Corregir datos fiscales";
    boton.onclick=()=>abrirCorreccion(data,boton);$("archivos").append(boton);
  }
  for(const tipo of ["pdf","xml"])if(data.documentos?.[tipo]){
    const a=document.createElement("a");a.href="/api/ticket/documentos/"+encodeURIComponent(data.id)+"/"+tipo;a.textContent="Descargar "+tipo.toUpperCase();a.download="";$("archivos").append(a);
  }
  $("ayudaResultado").textContent=data.corregible?data.mensaje:data.requiereRevision?"Conserva tu folio y comunícate con Noventia para revisar la emisión.":data.documentos?.pdf&&data.documentos?.xml?"Guarda ambos archivos. La descarga está disponible durante una hora en este navegador.":"Conserva tu folio. Si falta algún archivo, solicítalo a atención de Noventia.";
}
$("factura").onsubmit=async event=>{
  event.preventDefault();if(!validada||ocupado)return;
  const datos={...compra(),acepta:$("acepta").checked,formaPago:$("forma").value,metodoPago:"PUE",receptor:{rfc:$("rfc").value,tipoPersona:$("tipo").value,razonSocial:$("nombre").value.trim(),regimenFiscal:$("regimen").value,usoCfdi:$("uso").value,email:$("email").value.trim(),codigoPostal:$("cp").value}};
  const problema=revisarReceptor(datos.receptor,datos.receptor.usoCfdi);
  if(problema){$("estadoFactura").textContent=problema;return;}
  ocupado=true;$("emitir").disabled=true;$("buscar").disabled=true;$("estadoFactura").textContent="Generando tu factura…";
  try{
    const data=correccionActiva ? await api(correccionActiva.ruta+"corregir",{acepta:datos.acepta,receptor:datos.receptor,revision:correccionActiva.revision}) : await api("emitir",datos);resultado(data);
    try{sessionStorage.setItem("facturaReciente",JSON.stringify({data,vence:Date.now()+3600000}));}catch{}
  }catch(error){$("estadoFactura").textContent=error.message+" Si la emisión se interrumpió, consulta a Noventia con tu folio.";}
  finally{ocupado=false;$("emitir").disabled=false;$("buscar").disabled=false;}
};
$("otra").onclick=()=>{try{sessionStorage.removeItem("facturaReciente");}catch{}location.reload();};
try{const previa=JSON.parse(sessionStorage.getItem("facturaReciente"));if(previa?.vence>Date.now())resultado(previa.data);}catch{}
fetch("/api/ticket/config").then(r=>r.json()).then(c=>{
  if(c.email){$("correo").textContent=c.email;$("correo").href="mailto:"+c.email;}
  if(c.whatsapp){$("wa").href="https://wa.me/"+c.whatsapp;$("wa").hidden=false;}
}).catch(()=>{});

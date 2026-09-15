
const $ = id => document.getElementById(id);
const mxn = new Intl.NumberFormat("es-MX",{style:"currency",currency:"MXN"});
let conceptos = [];
let historial = [];
let clientesFiscales = [];
let ultimaFacturaCreada = null;

async function api(url, options={}) {
  const response=await fetch(url,options);
  if(response.status===401) enviarAlLogin();
  return response;
}

function enviarAlLogin(){
  window.location.replace("/login.html");
}

function mostrarDashboard(session){
  $("appShell").hidden=false;
  $("usuarioActual").textContent=session.profile.nombre;
  $("rolActual").textContent=session.profile.rol;
}

function openView(name) {
  document.querySelectorAll(".nav,.view").forEach(x=>x.classList.remove("active"));
  const nav = document.querySelector(`.nav[data-v="${name}"]`);
  if (nav) nav.classList.add("active");
  const view = $(name);
  if (view) view.classList.add("active");

  if (name==="historial") cargarHistorial();
  if (name==="usuarios") cargarUsuarios();
  if (name==="reportes") cargarReportes();
  if (name==="clientes") cargarClientes();
  if (name==="config") cargarConfiguracionFiscal();
}

document.querySelectorAll(".nav").forEach(b=>b.onclick=()=>openView(b.dataset.v));

async function refreshPermissions() {
  const r = await api("/api/session");
  if(!r.ok)return null;
  const session = await r.json();
  const can = p => session.permissions.includes(p);

  const nueva = document.querySelector('.nav[data-v="nueva"]');
  const usuarios = document.querySelector('.nav[data-v="usuarios"]');
  const config = document.querySelector('.nav[data-v="config"]');

  nueva.style.display = can("facturas:crear") ? "" : "none";
  usuarios.style.display = can("usuarios:gestionar") ? "" : "none";
  config.style.display = can("config:ver") ? "" : "none";

  if (!can("facturas:crear") && $("nueva").classList.contains("active")) openView("historial");
  mostrarDashboard(session);
  return session;
}

$("btnCerrarSesion").onclick=async()=>{
  await api("/api/auth/logout",{method:"POST"});
  enviarAlLogin();
};

function aplicarPermisos(session){
  const can=p=>session.permissions.includes(p);
  document.querySelector('.nav[data-v="nueva"]').style.display=can("facturas:crear")?"":"none";
  document.querySelector('.nav[data-v="usuarios"]').style.display=can("usuarios:gestionar")?"":"none";
  document.querySelector('.nav[data-v="config"]').style.display=can("config:ver")?"":"none";
}

function nuevo(d={}) {
  return {
    sku:d.clave||d.sku||"",
    descripcion:d.descripcion||"",
    cantidad:Number(d.cantidad||1),
    precioUnitario:Number(d.precioUnitario||0),
    unidad:d.unidad||"Pieza",
    claveUnidad:d.claveUnidad||"H87",
    tasaIva:Number(d.tasaIva ?? (($("aplicarIva")?.checked ?? true) ? Number($("tasaIva")?.value || .16) : 0)),
    _editing:Boolean(d._editing)
  };
}

function render() {
  if (!conceptos.length) {
    $("conceptos").innerHTML='<div class="empty-concepts"><strong>Sin productos agregados</strong><span>Carga un pedido o agrega un producto manualmente.</span></div>';
    totales();
    return;
  }
  $("conceptos").innerHTML = conceptos.map((c,i)=>`
    <div class="concept ${c._editing?"is-editing":"is-locked"}" data-i="${i}">
      <input class="sku" value="${c.sku}" placeholder="SKU" ${c._editing?"":"disabled"}>
      <input class="desc" value="${c.descripcion}" placeholder="Descripción" ${c._editing?"":"disabled"}>
      <input class="cant" placeholder="cantidad" type="number" min="1" value="${c.cantidad}" ${c._editing?"":"disabled"}>
      <input class="precio" type="number" min="0" step=".01" value="${c.precioUnitario}" ${c._editing?"":"disabled"}>
      <select class="unidad" ${c._editing?"":"disabled"}>
        <option value="H87|Pieza" ${c.claveUnidad==="H87"?"selected":""}>H87 - Pieza</option>
        <option value="EA|Elemento" ${c.claveUnidad==="EA"?"selected":""}>EA - Elemento</option>
        <option value="E48|Unidad de servicio" ${c.claveUnidad==="E48"?"selected":""}>E48 - Unidad servicio</option>
      </select>
      <div class="concept-actions">
      <button type="button" class="ghost edit">
        ${c._editing
          ? '<i class="fa-solid fa-floppy-disk"></i>'
          : '<i class="fa-solid fa-pen-to-square"></i>'}
      </button>        
      <button type="button" class="danger rm"><i class="fa-solid fa-trash-can"></i></button>
      </div>
    </div>`).join("");

  document.querySelectorAll(".concept").forEach(row=>{
    const i = Number(row.dataset.i);
    const c = conceptos[i];
    row.querySelector(".sku").oninput=e=>conceptos[i].sku=e.target.value;
    row.querySelector(".desc").oninput=e=>conceptos[i].descripcion=e.target.value;
    row.querySelector(".cant").oninput=e=>{conceptos[i].cantidad=Number(e.target.value);totales()};
    row.querySelector(".precio").oninput=e=>{conceptos[i].precioUnitario=Number(e.target.value);totales()};
    row.querySelector(".unidad").onchange=e=>{
      [conceptos[i].claveUnidad,conceptos[i].unidad]=e.target.value.split("|");
    };
    row.querySelector(".edit").onclick=()=>{
      if(c._editing){
        if(!c.descripcion.trim())return $("mensaje").textContent="La descripción del producto es obligatoria.";
        if(!(Number(c.cantidad)>0))return $("mensaje").textContent="La cantidad debe ser mayor a cero.";
        if(Number(c.precioUnitario)<0)return $("mensaje").textContent="El precio no puede ser negativo.";
        $("mensaje").textContent="Producto agregado correctamente.";
      }
      conceptos[i]._editing=!c._editing;
      render();
    };
    row.querySelector(".rm").onclick=()=>{conceptos.splice(i,1);$("mensaje").textContent="Producto eliminado.";render()};
  });
  totales();
}

function totales() {
  const subtotal = conceptos.reduce((a,c)=>{
    return a + (Number(c.cantidad)||0) * (Number(c.precioUnitario)||0);
  },0);

  const iva = conceptos.reduce((a,c)=>{
    const base=(Number(c.cantidad)||0)*(Number(c.precioUnitario)||0);
    return a + base * (Number(c.tasaIva)||0);
  },0);

  $("totales").innerHTML=`
    <div class="stat"><small>Subtotal</small><strong>${mxn.format(subtotal)}</strong></div>
    <div class="stat"><small>IVA</small><strong>${mxn.format(iva)}</strong></div>
    <div class="stat"><small>Total</small><strong>${mxn.format(subtotal+iva)}</strong></div>`;
}

$("add").onclick=()=>{
  if(conceptos.some(c=>c._editing))return $("mensaje").textContent="Guarda el producto que estás editando antes de agregar otro.";
  conceptos.push(nuevo({_editing:true}));render();
  document.querySelector(".concept:last-child .sku")?.focus();
};

$("metodoPago").onchange=()=>{
  if ($("metodoPago").value==="PPD") {
    $("formaPago").value="99";
    $("formaPago").disabled=true;
  } else {
    $("formaPago").disabled=false;
    if ($("formaPago").value==="99") $("formaPago").value="03";
  }
};


function aplicarConfiguracionIva(){
  const activo=$("aplicarIva").checked;
  $("tasaIva").disabled=!activo;
  const tasa=activo?Number($("tasaIva").value):0;
  conceptos=conceptos.map(c=>({...c,tasaIva:tasa}));
  totales();
}
$("aplicarIva").onchange=aplicarConfiguracionIva;
$("tasaIva").onchange=aplicarConfiguracionIva;


$("btnBuscarPedido").onclick=async()=>{
  const f=$("buscarFolio").value.trim();
  if(!f) return;
  const r=await api(`/api/pedidos?folio=${encodeURIComponent(f)}`);
  const d=await r.json();
  if(!r.ok) return $("mensaje").textContent=d.error;

  $("origen").value=["WHATSAPP","ALMACEN","BAZAR","ECOMMERCE"].includes(d.origen)?d.origen:"MANUAL";
  $("folio").value=d.folio;
  $("razon").value=d.cliente?.nombre||"PUBLICO EN GENERAL";
  $("email").value=d.cliente?.email||"";
  conceptos=(d.productos||[]).map(nuevo);
  aplicarConfiguracionIva();
  render();
  $("mensaje").textContent=`Pedido ${d.folio} cargado desde ${d.fuente}.`;
};

$("form").onsubmit=async e=>{
  e.preventDefault();

  if(!conceptos.length)return $("mensaje").textContent="Agrega al menos un producto antes de guardar la factura.";
  if(conceptos.some(c=>c._editing))return $("mensaje").textContent="Guarda los cambios del producto antes de guardar la factura.";

  const submit=$('btnGuardarFactura');
  submit.disabled=true;
  submit.textContent="Guardando factura…";
  $("mensaje").textContent="";

  const formaPago = $("formaPago").value;
  const metodoPago = $("metodoPago").value;

  const payload = {
    origen:$("origen").value,
    folioOrigen:$("folio").value,
    cliente:{
      razonSocial:$("razon").value,
      rfc:$("rfc").value,
      codigoPostal:$("cp").value,
      regimenFiscal:$("regimen").value,
      email:$("email").value
    },
    usoCfdi:$("uso").value,
    formaPago,
    metodoPago,
    aplicarIva:$("aplicarIva").checked,
    tasaIva:$("aplicarIva").checked?Number($("tasaIva").value):0,
    conceptos
  };

  try {
    const r=await api("/api/facturas",{
      method:"POST",
      headers:{"Content-Type":"application/json"},
      body:JSON.stringify(payload)
    });
    const d=await r.json();
    if(!r.ok) throw new Error(d.error || "No fue posible guardar la factura");
    ultimaFacturaCreada=d;
    limpiarFormularioFactura();
    mostrarExitoFactura(d);
  } catch(error) {
    $("mensaje").textContent=error.message;
  } finally {
    submit.disabled=false;
    submit.textContent="Guardar borrador";
  }
};

function limpiarFormularioFactura(){
  $("form").reset();
  $("buscarFolio").value="";
  $("origen").value="WHATSAPP";
  $("razon").value="PUBLICO EN GENERAL";
  $("rfc").value="XAXX010101000";
  $("cp").value="54700";
  $("regimen").value="616";
  $("uso").value="S01";
  $("formaPago").disabled=false;
  $("formaPago").value="03";
  $("metodoPago").value="PUE";
  $("aplicarIva").checked=true;
  $("tasaIva").disabled=false;
  $("tasaIva").value="0.16";
  conceptos=[];
  render();
  $("mensaje").textContent="";
}

function mostrarExitoFactura(factura){
  $("exitoFolio").textContent=factura.folioInterno || factura.folioOrigen || factura.id;
  $("exitoCliente").textContent=factura.cliente?.razonSocial || "—";
  $("exitoTotal").textContent=mxn.format(factura.total || 0);
  $("exitoModal").hidden=false;
  $("btnNuevaFactura").focus();
}

function cerrarExitoFactura(){
  $("exitoModal").hidden=true;
}

$("btnNuevaFactura").onclick=()=>{
  cerrarExitoFactura();
  $("buscarFolio").focus();
};
$("exitoBackdrop").onclick=cerrarExitoFactura;
$("btnVerFacturaCreada").onclick=async()=>{
  if(!ultimaFacturaCreada) return;
  cerrarExitoFactura();
  await window.verFactura(ultimaFacturaCreada.id);
};

async function cargarHistorial() {
  const r=await api("/api/facturas");
  const d=await r.json();
  historial = Array.isArray(d) ? d : [];
  pintarHistorial(historial);
}

function pintarHistorial(data) {
  $("historialTabla").innerHTML=data.length?`
    <table>
      <thead><tr><th>Folio</th><th>Cliente</th><th>Total</th><th>Estado</th><th>UUID</th><th>Acciones</th></tr></thead>
      <tbody>${data.map(f=>`
        <tr>
          <td>${f.folioInterno||f.folioOrigen||"-"}</td>
          <td>${f.cliente?.razonSocial||"-"}</td>
          <td>${mxn.format(f.total||0)}</td>
          <td><span class="tag">${f.estatus}</span></td>
          <td>${f.uuid||"-"}</td>
          <td><div class="mini">
            <button class="btn-history" onclick="verFactura(\'${f.id}\')"><i class="fa-solid fa-eye"></i></button>\n            ${f.estatus==="BORRADOR"?`<button onclick="timbrar(\'${f.id}\')">Timbrar mock</button>`:""}
            ${f.xmlRelativePath?`<button class="btn-history" onclick="descargar('${f.id}','xml')">XML</button>`:""}
            ${f.pdfRelativePath?`<button class="btn-history" onclick="descargar('${f.id}','pdf')">PDF</button>`:""}
          </div></td>
        </tr>`).join("")}</tbody>
    </table>`:"<p>Sin facturas.</p>";
}

window.timbrar=async id=>{
  const r=await api(`/api/facturas/${id}/timbrar`,{method:"POST"});
  const d=await r.json();
  if(!r.ok) return alert(d.error);
  cargarHistorial();
};

window.descargar=async(id,tipo)=>{
  const r=await api(`/api/facturas/${id}/documento/${tipo}`);
  if(!r.ok){const d=await r.json();return alert(d.error)}
  const blob=await r.blob();
  const url=URL.createObjectURL(blob);
  const a=document.createElement("a");
  a.href=url;a.download=`factura-${id}.${tipo}`;
  document.body.appendChild(a);a.click();a.remove();
  URL.revokeObjectURL(url);
};

$("buscarHistorial").oninput=e=>{
  const q=e.target.value.toLowerCase();
  pintarHistorial(historial.filter(f=>`${f.folioOrigen} ${f.cliente?.razonSocial} ${f.cliente?.rfc}`.toLowerCase().includes(q)));
};

async function cargarUsuarios() {
  const r=await api("/api/usuarios");
  const d=await r.json();
  if(!r.ok){$("usuariosLista").innerHTML=`<p>${d.error}</p>`;return}
  $("usuariosLista").innerHTML=d.map(u=>`
    <div class="row"><div><strong>${u.nombre}</strong><br><small>${u.email}</small></div><span class="tag">${u.rol}</span></div>`).join("");
}

async function cargarReportes(){
  const r=await api("/api/reportes");
  const d=await r.json();
  if(!r.ok){$("reporteCards").innerHTML=`<div class="card">${d.error}</div>`;return}
  $("reporteCards").innerHTML=[
    ["Total",d.totalFacturas],["Timbradas",d.timbradas],["Borradores",d.borradores],["Monto",mxn.format(d.totalFacturado)]
  ].map(x=>`<div class="stat"><small>${x[0]}</small><strong>${x[1]}</strong></div>`).join("");
  $("reporteOrigen").innerHTML=Object.entries(d.porOrigen||{}).map(([k,v])=>`
    <div class="row"><span>${k}</span><strong>${v}</strong></div>`).join("")||"Sin datos";
}

async function cargarConfiguracionFiscal(){
  const response=await api("/api/configuracion-fiscal");
  if(!response.ok)return;
  const c=await response.json();
  if(!c)return;
  $("cfgRazon").value=c.razonSocial||"";$("cfgRfc").value=c.rfc||"";$("cfgRegimen").value=c.regimenFiscal||"";$("cfgCp").value=c.codigoPostal||"";$("cfgSerie").value=c.serie||"F";$("cfgExportacion").value=c.exportacion||"01";$("cfgAmbiente").value=c.ambiente||"PRUEBAS";$("cfgPac").value=c.pacProveedor||"PENDIENTE";
}

$("configFiscalForm").onsubmit=async event=>{
  event.preventDefault();const button=$("btnGuardarConfig");button.disabled=true;button.textContent="Guardando…";$("configMensaje").textContent="";
  const payload={razonSocial:$("cfgRazon").value,rfc:$("cfgRfc").value,regimenFiscal:$("cfgRegimen").value,codigoPostal:$("cfgCp").value,serie:$("cfgSerie").value,exportacion:$("cfgExportacion").value,ambiente:$("cfgAmbiente").value,pacProveedor:$("cfgPac").value};
  try{const response=await api("/api/configuracion-fiscal",{method:"PUT",headers:{"Content-Type":"application/json"},body:JSON.stringify(payload)});const data=await response.json();if(!response.ok)throw new Error(data.error||"No fue posible guardar");$("configMensaje").textContent="Configuración fiscal guardada correctamente."}catch(error){$("configMensaje").textContent=error.message}finally{button.disabled=false;button.textContent="Guardar configuración"}
};

async function cargarClientes(q=""){
  const r=await api(`/api/clientes-fiscales?q=${encodeURIComponent(q)}`);
  const d=await r.json();
  if(!r.ok){$("clientesLista").innerHTML=`<p>${d.error}</p>`;return}
  clientesFiscales=Array.isArray(d)?d:[];
  $("clientesLista").innerHTML=clientesFiscales.length?clientesFiscales.map(c=>`
    <div class="row">
      <div><strong>${c.razonSocial}</strong><br><small>${c.rfc} · ${c.regimenFiscal} · ${c.codigoPostal}</small></div>
      <button class="ghost usar-cliente" type="button" data-cliente-id="${c.id}">Usar</button>
    </div>`).join(""):"<p>Sin clientes.</p>";
  document.querySelectorAll(".usar-cliente").forEach(b=>{
    b.onclick=()=>{
      const cliente=clientesFiscales.find(c=>String(c.id)===b.dataset.clienteId);
      if(cliente) window.usarCliente(cliente,true);
    };
  });
}

$("btnBuscarClienteFiscal").onclick=()=>cargarClientes($("buscarClienteFiscal").value);

window.usarCliente=(cliente,navegar=false)=>{
  const c=typeof cliente==="string"?JSON.parse(cliente):cliente;
  $("razon").value=c.razonSocial;
  $("rfc").value=c.rfc;
  $("cp").value=c.codigoPostal;
  $("regimen").value=c.regimenFiscal;
  $("uso").value=c.usoCfdi;
  $("email").value=c.email||"";
  if(navegar){
    openView("nueva");
    $("mensaje").textContent=`Datos fiscales de ${c.rfc} cargados correctamente.`;
    $("folio").focus();
  }
};

$("buscarFiscalFactura").onclick=async()=>{
  const q=$("rfc").value || $("razon").value;
  const r=await api(`/api/clientes-fiscales?q=${encodeURIComponent(q)}`);
  const d=await r.json();
  if(r.ok && d.length){
    window.usarCliente(d[0]);
    $("mensaje").textContent="Datos fiscales cargados.";
  } else {
    $("mensaje").textContent="No se encontró cliente fiscal.";
  }
};

$("clienteFiscalForm").onsubmit=async e=>{
  e.preventDefault();
  const boton=e.submitter;
  boton.disabled=true;
  boton.textContent="Guardando…";
  $("clienteFiscalMensaje").textContent="";
  const p={
    tipoPersona:$("cfTipoPersona").value,
    razonSocial:$("cfRazon").value,
    rfc:$("cfRfc").value,
    codigoPostal:$("cfCp").value,
    regimenFiscal:$("cfRegimen").value,
    usoCfdi:$("cfUso").value,
    email:$("cfEmail").value
  };
  try{
    const r=await api("/api/clientes-fiscales",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify(p)});
    const d=await r.json();
    if(!r.ok) throw new Error(d.error||"No fue posible guardar el cliente fiscal");
    $("clienteFiscalMensaje").textContent=`Cliente ${d.rfc} guardado correctamente.`;
    e.target.reset();
    await cargarClientes();
  }catch(error){
    $("clienteFiscalMensaje").textContent=error.message;
  }finally{
    boton.disabled=false;
    boton.textContent="Guardar cliente";
  }
};

async function iniciar(){
  render();
  try{
    const session=await refreshPermissions();
    if(session){
      aplicarPermisos(session);
      openView(session.profile.rol==="CONSULTA"?"historial":"nueva");
    }else enviarAlLogin();
  }catch{enviarAlLogin()}
}

iniciar();


const FORMAS_PAGO_LABEL = {
  "01":"01 - Efectivo",
  "03":"03 - Transferencia electrónica de fondos",
  "04":"04 - Tarjeta de crédito",
  "28":"28 - Tarjeta de débito",
  "99":"99 - Por definir"
};
const METODOS_PAGO_LABEL = {
  "PUE":"PUE - Pago en una sola exhibición",
  "PPD":"PPD - Pago en parcialidades o diferido"
};
let facturaPreviewActual=null;

window.verFactura=async id=>{
  const r=await api(`/api/facturas/${id}`);
  const f=await r.json();
  if(!r.ok)return alert(f.error);
  facturaPreviewActual=f;

  $("pvFolio").textContent=f.folioInterno||f.folioOrigen||f.id;
  $("pvFecha").textContent=new Date(f.creadaEn||Date.now()).toLocaleString("es-MX");
  $("pvUuid").textContent=f.uuid||"PENDIENTE";
  $("pvRazon").textContent=f.cliente?.razonSocial||"-";
  $("pvRfc").textContent=f.cliente?.rfc||"-";
  $("pvCp").textContent=f.cliente?.codigoPostal||"-";
  $("pvRegimen").textContent=f.cliente?.regimenFiscal||"-";
  $("pvUso").textContent=f.usoCfdi||"-";
  $("pvEmail").textContent=f.cliente?.email||"-";
  $("pvFormaPago").textContent=FORMAS_PAGO_LABEL[f.formaPago]||f.formaPago||"-";
  $("pvMetodoPago").textContent=METODOS_PAGO_LABEL[f.metodoPago]||f.metodoPago||"-";
  $("pvOrigen").textContent=f.origen||"-";
  $("pvIvaEstado").textContent=(Number(f.impuestos||0)>0)?`Sí · ${Math.round(Number(f.tasaIva||f.conceptos?.[0]?.tasaIva||0)*100)}%`:"No aplica";
  $("pvSubtotal").textContent=mxn.format(f.subtotal||0);
  $("pvIva").textContent=mxn.format(f.impuestos||0);
  $("pvTotal").textContent=mxn.format(f.total||0);
  $("pvFechaTimbrado").textContent=f.fechaTimbrado?new Date(f.fechaTimbrado).toLocaleString("es-MX"):"PENDIENTE";

  $("pvConceptos").innerHTML=(f.conceptos||[]).map(c=>{
    const importe=Number(c.cantidad||0)*Number(c.precioUnitario||0);
    return `<tr>
      <td>${c.cantidad??"-"}</td>
      <td>${c.sku||c.clave||"-"}</td>
      <td>${c.descripcion||"-"}</td>
      <td>${c.claveUnidad||""} ${c.unidad||""}</td>
      <td>${mxn.format(c.precioUnitario||0)}</td>
      <td>${mxn.format(importe)}</td>
    </tr>`;
  }).join("");

  $("facturaModal").hidden=false;
};

function cerrarFacturaPreview(){
  $("facturaModal").hidden=true;
  facturaPreviewActual=null;
}

window.viewMenu = function () {

  const menu = document.querySelector(".nav-item");

  if (menu.classList.contains("hidden")) {
    menu.classList.remove("hidden");
  } else {
    menu.classList.add("hidden");
  }
};

$("btnCerrarFactura").onclick=cerrarFacturaPreview;
$("facturaBackdrop").onclick=cerrarFacturaPreview;
$("btnImprimirFactura").onclick=()=>window.print();
$("btnXmlPreview").onclick=async()=>{
  if(!facturaPreviewActual)return;
  if(!facturaPreviewActual.xmlRelativePath){
    alert("Todavía no hay XML. Primero realiza el timbrado mock.");
    return;
  }
  await descargar(facturaPreviewActual.id,"xml");
};

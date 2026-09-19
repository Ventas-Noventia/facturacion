
const $ = id => document.getElementById(id);
const mxn = new Intl.NumberFormat("es-MX",{style:"currency",currency:"MXN"});
let conceptos = [];
let historial = [];
let clientesFiscales = [];
let ultimaFacturaCreada = null;
let reporteActual = null;
let borradorEditandoId = null;
let borradorAEliminar = null;
let puedeGestionarBorradores = false;
let puedeCancelarFacturas = false;
let auditoriaPagina = 1;
let facturaACancelar = null;
let historialPagina = 1;
let historialTotal = 0;
let historialBusquedaTimer = null;

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
  if (name==="auditoria") cargarAuditoria();
  if (name==="clientes") cargarClientes();
  if (name==="config") cargarConfiguracionFiscal();
  cerrarMenuMovil();
}

document.querySelectorAll(".nav").forEach(b=>b.onclick=()=>openView(b.dataset.v));

async function refreshPermissions() {
  const r = await api("/api/session");
  if(!r.ok)return null;
  const session = await r.json();
  const can = p => session.permissions.includes(p);
  puedeGestionarBorradores=can("facturas:crear");
  puedeCancelarFacturas=can("facturas:cancelar");

  const nueva = document.querySelector('.nav[data-v="nueva"]');
  const usuarios = document.querySelector('.nav[data-v="usuarios"]');
  const config = document.querySelector('.nav[data-v="config"]');
  const auditoriaNav = document.querySelector('.nav[data-v="auditoria"]');

  nueva.style.display = can("facturas:crear") ? "" : "none";
  usuarios.style.display = can("usuarios:gestionar") ? "" : "none";
  config.style.display = can("config:ver") ? "" : "none";
  auditoriaNav.style.display = can("auditoria:ver") ? "" : "none";

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
  puedeGestionarBorradores=can("facturas:crear");
  puedeCancelarFacturas=can("facturas:cancelar");
  document.querySelector('.nav[data-v="nueva"]').style.display=can("facturas:crear")?"":"none";
  document.querySelector('.nav[data-v="usuarios"]').style.display=can("usuarios:gestionar")?"":"none";
  document.querySelector('.nav[data-v="config"]').style.display=can("config:ver")?"":"none";
  document.querySelector('.nav[data-v="auditoria"]').style.display=can("auditoria:ver")?"":"none";
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
        ${c._editing?"Guardar":"Editar"}
      </button>        
      <button type="button" class="danger rm">Eliminar</button>
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

let facturaDuplicadaActual=null;

function cerrarPedidoFacturado(){
  $("pedidoFacturadoModal").hidden=true;
  facturaDuplicadaActual=null;
  $("buscarFolio").focus();
}

function mostrarPedidoFacturado(datos,folioBuscado){
  facturaDuplicadaActual=datos.facturaId||null;
  $("pedidoFacturadoOrigen").textContent=datos.pedidoFolio||folioBuscado||"—";
  $("pedidoFacturadoFolio").textContent=datos.folioInterno||"Registrada previamente";
  $("btnVerPedidoFacturado").textContent=facturaDuplicadaActual?"Ver factura":"Ir al historial";
  $("pedidoFacturadoModal").hidden=false;
  $("btnCerrarPedidoFacturado").focus();
}

$("btnCerrarPedidoFacturado").onclick=cerrarPedidoFacturado;
$("pedidoFacturadoBackdrop").onclick=cerrarPedidoFacturado;
$("btnVerPedidoFacturado").onclick=async()=>{
  const facturaId=facturaDuplicadaActual;
  cerrarPedidoFacturado();
  if(facturaId)await window.verFactura(facturaId);
  else openView("historial");
};

$("btnBuscarPedido").onclick=async()=>{
  const f=$("buscarFolio").value.trim();
  if(!f) return;
  const r=await api(`/api/pedidos?folio=${encodeURIComponent(f)}`);
  const d=await r.json();
  if(r.status===409){mostrarPedidoFacturado(d,f);return}
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
    const fueEdicion=Boolean(borradorEditandoId);
    const endpoint=fueEdicion?`/api/facturas/${borradorEditandoId}`:"/api/facturas";
    const r=await api(endpoint,{
      method:fueEdicion?"PUT":"POST",
      headers:{"Content-Type":"application/json"},
      body:JSON.stringify(payload)
    });
    const d=await r.json();
    if(r.status===409&&!fueEdicion){mostrarPedidoFacturado(d,payload.folioOrigen);return}
    if(!r.ok) throw new Error(d.error || "No fue posible guardar la factura");
    ultimaFacturaCreada=d;
    limpiarFormularioFactura();
    mostrarExitoFactura(d);
    if(fueEdicion)$("exitoTitulo").textContent="Borrador actualizado correctamente";
  } catch(error) {
    $("mensaje").textContent=error.message;
  } finally {
    submit.disabled=false;
    submit.textContent=borradorEditandoId?"Guardar cambios":"Guardar borrador";
  }
};

function limpiarFormularioFactura(){
  borradorEditandoId=null;
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
  $("origen").disabled=false;
  $("folio").disabled=false;
  $("buscarFolio").disabled=false;
  $("btnBuscarPedido").disabled=false;
  $("edicionBorradorAviso").hidden=true;
  $("btnGuardarFactura").textContent="Guardar borrador";
  conceptos=[];
  render();
  $("mensaje").textContent="";
}

function mostrarExitoFactura(factura,fueEdicion=false){
  $("exitoTitulo").textContent=fueEdicion?"Borrador actualizado correctamente":"Factura generada exitosamente";
  $("exitoFolio").textContent=factura.folioInterno || factura.folioOrigen || factura.id;
  $("exitoCliente").textContent=factura.cliente?.razonSocial || "—";
  $("exitoTotal").textContent=mxn.format(factura.total || 0);
  let advertencia=$("exitoAdvertencia");
  if(!advertencia){
    advertencia=document.createElement("p");
    advertencia.id="exitoAdvertencia";
    advertencia.style.color="#a05a00";
    advertencia.style.fontWeight="700";
    document.querySelector(".success-actions")?.before(advertencia);
  }
  advertencia.textContent=factura.advertencia||"";
  advertencia.hidden=!factura.advertencia;
  $("exitoModal").hidden=false;
  $("btnNuevaFactura").focus();
}

$("btnCancelarEdicion").onclick=()=>{
  limpiarFormularioFactura();
  $("mensaje").textContent="Edición cancelada.";
};

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

function parametrosHistorial(){
  const parametros=new URLSearchParams();
  const filtros={q:$("buscarHistorial").value.trim(),desde:$("historialDesde").value,hasta:$("historialHasta").value,origen:$("historialOrigen").value,estatus:$("historialEstatus").value,sync:$("historialSync").value};
  Object.entries(filtros).forEach(([clave,valor])=>{if(valor)parametros.set(clave,valor)});
  return parametros;
}

async function cargarHistorial(pagina=historialPagina) {
  historialPagina=Math.max(1,pagina);
  const parametros=parametrosHistorial();parametros.set("page",String(historialPagina));parametros.set("pageSize","25");
  const r=await api(`/api/facturas?${parametros}`);
  const d=await r.json();
  if(!r.ok){$("historialTabla").innerHTML=`<p>${d.error||"No fue posible cargar el historial"}</p>`;return}
  if(!d.items.length&&historialPagina>1)return cargarHistorial(historialPagina-1);
  historial=Array.isArray(d.items)?d.items:[];historialTotal=Number(d.total||0);
  pintarHistorial(historial,d);
}

function pintarHistorial(data,paginacion={total:historialTotal,page:historialPagina,pageSize:25}) {
  const paginas=Math.max(1,Math.ceil(paginacion.total/paginacion.pageSize));
  $("historialResumen").textContent=`${paginacion.total} factura${paginacion.total===1?"":"s"} · Página ${paginacion.page} de ${paginas}`;
  $("historialTabla").innerHTML=data.length?`
    <table>
      <thead><tr><th>Factura</th><th>Pedido</th><th>Origen</th><th>Cliente</th><th>Fecha</th><th>Total</th><th>Estado</th><th>Firebase</th><th>Acciones</th></tr></thead>
      <tbody>${data.map(f=>`
        <tr>
          <td><strong>${f.folioInterno||"-"}</strong></td>
          <td>${f.folioOrigen||"-"}</td>
          <td><span class="tag origin-tag">${nombreOrigen(f.origen)}</span></td>
          <td>${f.cliente?.razonSocial||"-"}</td>
          <td>${fechaHistorial(f.creadaEn)}${f.editadaEn?`<small class="draft-edited" title="${f.editadaPor?.email||""}">Editada ${fechaHoraHistorial(f.editadaEn)} por ${f.editadaPor?.nombre||"usuario"}</small>`:""}</td>
          <td>${mxn.format(f.total||0)}</td>
          <td><span class="tag">${f.estatus}</span></td>
          <td>${estadoSincronizacionHtml(f)}</td>
          <td><div class="mini">
            <button class="btn-history" title="Vista previa" aria-label="Vista previa" onclick="verFactura(\'${f.id}\')"><i class="fa-solid fa-eye"></i></button>\n            ${f.estatus==="BORRADOR"?`<button onclick="timbrar(\'${f.id}\')">Timbrar mock</button>`:""}
            ${f.estatus==="BORRADOR"&&puedeGestionarBorradores?`<button class="btn-history edit-draft" onclick="editarBorrador('${f.id}')" title="Editar borrador"><i class="fa-solid fa-pen-to-square"></i></button><button class="btn-history delete-draft" onclick="solicitarEliminarBorrador('${f.id}')" title="Eliminar borrador"><i class="fa-solid fa-trash-can"></i></button>`:""}
            ${String(f.estatus||"").startsWith("TIMBRADA")&&puedeCancelarFacturas?`<button class="cancel-invoice" onclick="solicitarCancelarFactura('${f.id}')"><i class="fa-solid fa-ban"></i> Cancelar</button>`:""}
            ${f.xmlRelativePath?`<button class="btn-history" onclick="descargar('${f.id}','xml')">XML</button>`:""}
            ${f.pdfRelativePath?`<button class="btn-history" onclick="descargar('${f.id}','pdf')">PDF</button>`:""}
            ${estadoSincronizacion(f)==="ERROR"?`<button class="retry-sync" onclick="reintentarSincronizacion('${f.id}',this)"><i class="fa-solid fa-rotate"></i> Reintentar</button>`:""}
          </div></td>
        </tr>`).join("")}</tbody>
    </table>`:"<p>Sin facturas que coincidan con los filtros.</p>";
  $("historialPaginacion").innerHTML=paginacion.total?`<button type="button" class="ghost" ${paginacion.page<=1?"disabled":""} onclick="cambiarPaginaHistorial(${paginacion.page-1})"><i class="fa-solid fa-chevron-left"></i> Anterior</button><span>Página ${paginacion.page} de ${paginas}</span><button type="button" class="ghost" ${paginacion.page>=paginas?"disabled":""} onclick="cambiarPaginaHistorial(${paginacion.page+1})">Siguiente <i class="fa-solid fa-chevron-right"></i></button>`:"";
}
window.cambiarPaginaHistorial=pagina=>cargarHistorial(pagina);

window.editarBorrador=async id=>{
  const r=await api(`/api/facturas/${id}`);
  const f=await r.json();
  if(!r.ok)return alert(f.error);
  if(f.estatus!=="BORRADOR")return alert("Esta factura ya no puede modificarse porque no es un borrador.");
  borradorEditandoId=f.id;
  $("origen").value=f.origen||"MANUAL";
  $("folio").value=f.folioOrigen||"";
  $("razon").value=f.cliente?.razonSocial||"";
  $("rfc").value=f.cliente?.rfc||"";
  $("cp").value=f.cliente?.codigoPostal||"";
  $("regimen").value=f.cliente?.regimenFiscal||"616";
  $("uso").value=f.usoCfdi||"S01";
  $("email").value=f.cliente?.email||"";
  $("formaPago").value=f.formaPago||"03";
  $("metodoPago").value=f.metodoPago||"PUE";
  $("formaPago").disabled=f.metodoPago==="PPD";
  $("aplicarIva").checked=Boolean(f.aplicarIva??Number(f.impuestos)>0);
  $("tasaIva").value=String(f.tasaIva??f.conceptos?.[0]?.tasaIva??0.16);
  $("tasaIva").disabled=!$("aplicarIva").checked;
  conceptos=(f.conceptos||[]).map(c=>nuevo({...c,_editing:false}));
  $("origen").disabled=true;
  $("folio").disabled=true;
  $("buscarFolio").disabled=true;
  $("btnBuscarPedido").disabled=true;
  $("edicionBorradorFolio").textContent=f.folioInterno||f.id;
  $("edicionBorradorAviso").hidden=false;
  $("btnGuardarFactura").textContent="Guardar cambios";
  $("mensaje").textContent="Puedes modificar los datos fiscales, pago y productos del borrador.";
  render();
  openView("nueva");
  window.scrollTo({top:0,behavior:"smooth"});
};

window.solicitarEliminarBorrador=id=>{
  const factura=historial.find(item=>item.id===id);
  if(!factura)return;
  borradorAEliminar=factura;
  $("eliminarBorradorFolio").textContent=factura.folioInterno||factura.folioOrigen||factura.id;
  $("eliminarBorradorModal").hidden=false;
  $("btnCancelarEliminarBorrador").focus();
};

function cerrarEliminarBorrador(){
  $("eliminarBorradorModal").hidden=true;
  borradorAEliminar=null;
}

$("btnCancelarEliminarBorrador").onclick=cerrarEliminarBorrador;
$("eliminarBorradorBackdrop").onclick=cerrarEliminarBorrador;
$("btnConfirmarEliminarBorrador").onclick=async()=>{
  if(!borradorAEliminar)return;
  const boton=$("btnConfirmarEliminarBorrador");
  const id=borradorAEliminar.id;
  boton.disabled=true;boton.textContent="Eliminando…";
  try{
    const r=await api(`/api/facturas/${id}`,{method:"DELETE"});
    const d=await r.json();
    if(!r.ok)throw new Error(d.error||"No fue posible eliminar el borrador");
    cerrarEliminarBorrador();
    await cargarHistorial();
  }catch(error){alert(error.message)}
  finally{boton.disabled=false;boton.textContent="Sí, eliminar"}
};

window.solicitarCancelarFactura=id=>{
  const factura=historial.find(item=>item.id===id);
  if(!factura)return;
  facturaACancelar=factura;
  $("cancelarFacturaFolio").textContent=factura.folioInterno||factura.id;
  $("cancelarFacturaForm").reset();
  $("cancelarUuidGrupo").hidden=true;
  $("cancelarFacturaMensaje").textContent="";
  $("cancelarFacturaModal").hidden=false;
  $("cancelarFacturaMotivo").focus();
};
function cerrarCancelarFactura(){$("cancelarFacturaModal").hidden=true;facturaACancelar=null}
$("btnCerrarCancelarFactura").onclick=cerrarCancelarFactura;
$("cancelarFacturaBackdrop").onclick=cerrarCancelarFactura;
$("cancelarFacturaMotivo").onchange=()=>{
  const requiere=$("cancelarFacturaMotivo").value==="01";
  $("cancelarUuidGrupo").hidden=!requiere;
  $("cancelarUuidSustitucion").required=requiere;
  if(!requiere)$("cancelarUuidSustitucion").value="";
};
$("cancelarFacturaForm").onsubmit=async evento=>{
  evento.preventDefault();if(!facturaACancelar)return;
  const boton=$("btnConfirmarCancelarFactura");boton.disabled=true;boton.textContent="Cancelando…";$("cancelarFacturaMensaje").textContent="";
  try{
    const r=await api(`/api/facturas/${facturaACancelar.id}/cancelar`,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({motivo:$("cancelarFacturaMotivo").value,uuidSustitucion:$("cancelarUuidSustitucion").value,comentario:$("cancelarFacturaComentario").value})});
    const d=await r.json();if(!r.ok)throw new Error(d.error||"No fue posible cancelar la factura");
    cerrarCancelarFactura();await cargarHistorial();
  }catch(error){$("cancelarFacturaMensaje").textContent=error.message}
  finally{boton.disabled=false;boton.textContent="Confirmar cancelación"}
};

function nombreOrigen(origen){
  return ({WHATSAPP:"WhatsApp",ALMACEN:"Almacén",BAZAR:"Bazar",ECOMMERCE:"E-commerce",MANUAL:"Manual"})[origen]||origen||"Manual";
}

function fechaHistorial(valor){
  if(!valor)return "-";
  const fecha=new Date(valor);
  return Number.isNaN(fecha.getTime())?"-":fecha.toLocaleDateString("es-MX");
}

function fechaHoraHistorial(valor){
  const fecha=new Date(valor);
  return Number.isNaN(fecha.getTime())?"-":fecha.toLocaleString("es-MX",{dateStyle:"short",timeStyle:"short"});
}

function estadoSincronizacion(factura){
  if(!factura.pedido?.firebaseId)return "NO_APLICA";
  if(factura.pedidoLiberadoPorCancelacion)return "LIBERADO";
  if(factura.pedidoMarcadoFacturado===true)return "SINCRONIZADO";
  if(factura.pedidoMarcadoFacturado===false||factura.errorSincronizacionPedido)return "ERROR";
  return "PENDIENTE";
}

function estadoSincronizacionHtml(factura){
  const estado=estadoSincronizacion(factura);
  const datos={SINCRONIZADO:["Sincronizado","sync-ok"],LIBERADO:["Liberado","sync-released"],ERROR:["Error","sync-error"],PENDIENTE:["Pendiente","sync-pending"],NO_APLICA:["No aplica","sync-na"]}[estado];
  const detalle=estado==="ERROR"&&factura.errorSincronizacionPedido?` title="${String(factura.errorSincronizacionPedido).replace(/"/g,"&quot;")}"`:"";
  return `<span class="sync-badge ${datos[1]}"${detalle}>${datos[0]}</span>`;
}

function aplicarFiltrosHistorial(){
  cargarHistorial(1);
}

window.reintentarSincronizacion=async(id,boton)=>{
  boton.disabled=true;
  const texto=boton.innerHTML;
  boton.textContent="Sincronizando…";
  try{
    const r=await api(`/api/facturas/${id}/reintentar-sincronizacion`,{method:"POST"});
    const d=await r.json();
    if(!r.ok)throw new Error(d.error||"No fue posible sincronizar el pedido");
    await cargarHistorial();
  }catch(error){
    alert(error.message);
    boton.disabled=false;
    boton.innerHTML=texto;
  }
};

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

["buscarHistorial","historialDesde","historialHasta","historialOrigen","historialEstatus","historialSync"].forEach(id=>{
  $(id).addEventListener(id==="buscarHistorial"?"input":"change",()=>{
    if(id!=="buscarHistorial")return aplicarFiltrosHistorial();
    clearTimeout(historialBusquedaTimer);historialBusquedaTimer=setTimeout(aplicarFiltrosHistorial,350);
  });
});

$("limpiarFiltrosHistorial").onclick=()=>{
  ["buscarHistorial","historialDesde","historialHasta","historialOrigen","historialEstatus","historialSync"].forEach(id=>$(id).value="");
  cargarHistorial(1);
};

$("exportarHistorial").onclick=async()=>{
  const boton=$("exportarHistorial");boton.disabled=true;const texto=boton.innerHTML;boton.textContent="Preparando…";
  try{
    const parametros=parametrosHistorial();parametros.set("exportar","1");
    const r=await api(`/api/facturas?${parametros}`),d=await r.json();
    if(!r.ok)throw new Error(d.error||"No fue posible exportar el historial");
    if(!d.items?.length)throw new Error("No hay facturas para exportar con los filtros seleccionados");
    const encabezados=["Fecha","Factura","Pedido","Origen","Cliente","RFC","Total","Estado","Firebase","UUID"];
    const filas=d.items.map(f=>[f.creadaEn,f.folioInterno,f.folioOrigen,nombreOrigen(f.origen),f.cliente?.razonSocial,f.cliente?.rfc,f.total,f.estatus,estadoSincronizacion(f),f.uuid]);
    const contenido="\uFEFF"+[encabezados,...filas].map(fila=>fila.map(valorCsv).join(",")).join("\r\n");
    const url=URL.createObjectURL(new Blob([contenido],{type:"text/csv;charset=utf-8"})),enlace=document.createElement("a");
    enlace.href=url;enlace.download=`historial-facturas-${new Date().toISOString().slice(0,10)}.csv`;document.body.appendChild(enlace);enlace.click();enlace.remove();URL.revokeObjectURL(url);
  }catch(error){alert(error.message)}finally{boton.disabled=false;boton.innerHTML=texto}
};

async function cargarUsuarios() {
  const r=await api("/api/usuarios");
  const d=await r.json();
  if(!r.ok){$("usuariosLista").innerHTML=`<p>${d.error}</p>`;return}
  $("usuariosLista").innerHTML=d.map(u=>`
    <div class="row"><div><strong>${u.nombre}</strong><br><small>${u.email}</small></div><span class="tag">${u.rol}</span></div>`).join("");
}

async function cargarReportes(){
  const parametros=new URLSearchParams();
  const filtros={desde:$("reporteDesde").value,hasta:$("reporteHasta").value,origen:$("reporteFiltroOrigen").value,estatus:$("reporteFiltroEstatus").value};
  Object.entries(filtros).forEach(([clave,valor])=>{if(valor)parametros.set(clave,valor)});
  const r=await api(`/api/reportes${parametros.size?`?${parametros}`:""}`);
  const d=await r.json();
  if(!r.ok){$("reporteCards").innerHTML=`<div class="card">${d.error}</div>`;return}
  reporteActual=d;
  $("reporteCards").innerHTML=[
    ["Facturas",d.totalFacturas],["Timbradas",d.timbradas],["Subtotal timbrado",mxn.format(d.subtotalFacturado)],["IVA timbrado",mxn.format(d.ivaFacturado)],["Total timbrado",mxn.format(d.totalFacturado)]
  ].map(x=>`<div class="stat"><small>${x[0]}</small><strong>${x[1]}</strong></div>`).join("");
  pintarAgrupacionReporte("reporteOrigen",d.resumenPorOrigen||{});
  pintarAgrupacionReporte("reporteEstatus",d.porEstatus||{});
  $("reporteDetalle").innerHTML=(d.detalle||[]).length?`<table><thead><tr><th>Fecha</th><th>Factura</th><th>Pedido</th><th>Origen</th><th>Cliente</th><th>RFC</th><th>Estado</th><th>Subtotal</th><th>IVA</th><th>Total</th></tr></thead><tbody>${d.detalle.map(f=>`<tr><td>${fechaHistorial(f.fecha)}</td><td>${f.factura||"-"}</td><td>${f.pedido||"-"}</td><td>${nombreOrigen(f.origen)}</td><td>${f.cliente||"-"}</td><td>${f.rfc||"-"}</td><td><span class="tag">${f.estatus||"-"}</span></td><td>${mxn.format(f.subtotal)}</td><td>${mxn.format(f.iva)}</td><td><strong>${mxn.format(f.total)}</strong></td></tr>`).join("")}</tbody></table>`:"<p>Sin facturas para el periodo seleccionado.</p>";
  $("reportePeriodo").textContent=descripcionPeriodoReporte(filtros,d.totalFacturas);
}

function pintarAgrupacionReporte(id,datos){
  const entradas=Object.entries(datos);
  const maximo=Math.max(1,...entradas.map(([,v])=>v.cantidad));
  $(id).innerHTML=entradas.map(([nombre,valor])=>`<div class="report-group"><div class="report-group-head"><span>${nombreOrigen(nombre)}</span><strong>${valor.cantidad} · ${mxn.format(valor.total)}</strong></div><div class="report-bar"><span style="width:${Math.round(valor.cantidad/maximo*100)}%"></span></div></div>`).join("")||"<p>Sin datos.</p>";
}

function descripcionPeriodoReporte(filtros,total){
  const periodo=filtros.desde&&filtros.hasta?`${filtros.desde} al ${filtros.hasta}`:filtros.desde?`Desde ${filtros.desde}`:filtros.hasta?`Hasta ${filtros.hasta}`:"Todo el historial";
  return `${periodo} · ${total} registro${total===1?"":"s"}`;
}

function valorCsv(valor){
  return `"${String(valor??"").replace(/"/g,'""')}"`;
}

function exportarReporteCsv(){
  if(!reporteActual?.detalle?.length)return alert("No hay registros para exportar con los filtros seleccionados.");
  const encabezados=["Fecha","Factura","Pedido","Origen","Cliente","RFC","Estado","Subtotal","IVA","Total","UUID"];
  const filas=reporteActual.detalle.map(f=>[f.fecha,f.factura,f.pedido,nombreOrigen(f.origen),f.cliente,f.rfc,f.estatus,f.subtotal,f.iva,f.total,f.uuid]);
  const contenido="\uFEFF"+[encabezados,...filas].map(fila=>fila.map(valorCsv).join(",")).join("\r\n");
  const url=URL.createObjectURL(new Blob([contenido],{type:"text/csv;charset=utf-8"}));
  const enlace=document.createElement("a");
  enlace.href=url;enlace.download=`reporte-facturas-${new Date().toISOString().slice(0,10)}.csv`;
  document.body.appendChild(enlace);enlace.click();enlace.remove();URL.revokeObjectURL(url);
}

$("btnAplicarReporte").onclick=cargarReportes;
$("btnLimpiarReporte").onclick=()=>{
  ["reporteDesde","reporteHasta","reporteFiltroOrigen","reporteFiltroEstatus"].forEach(id=>$(id).value="");
  cargarReportes();
};
$("btnExportarReporte").onclick=exportarReporteCsv;

const ACCIONES_AUDITORIA={CREACION:"Creación",EDICION:"Edición",TIMBRADO:"Timbrado",CANCELACION:"Cancelación",ELIMINACION:"Eliminación",DESCARGA_DOCUMENTO:"Descarga",SINCRONIZACION_FIREBASE:"Sincronización Firebase"};
const seguro=valor=>String(valor??"").replace(/[&<>"']/g,caracter=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#039;"})[caracter]);

async function cargarAuditoria(pagina=1){
  auditoriaPagina=Math.max(1,pagina);
  const parametros=new URLSearchParams({page:String(auditoriaPagina),pageSize:"25"});
  const filtros={q:$("buscarAuditoria").value.trim(),accion:$("auditoriaAccion").value,desde:$("auditoriaDesde").value,hasta:$("auditoriaHasta").value};
  Object.entries(filtros).forEach(([clave,valor])=>{if(valor)parametros.set(clave,valor)});
  const r=await api(`/api/auditoria/resumen?${parametros}`);
  const datos=await r.json();
  if(!r.ok){$("auditoriaTabla").innerHTML=`<p>${seguro(datos.error)}</p>`;return}
  const paginas=Math.max(1,Math.ceil(datos.total/datos.pageSize));
  $("auditoriaResumen").textContent=`${datos.total} factura${datos.total===1?"":"s"} · Página ${datos.page} de ${paginas}`;
  $("auditoriaTabla").innerHTML=datos.items.length?`<table><thead><tr><th>Factura</th><th>Pedido</th><th>Movimientos</th><th>Último movimiento</th><th>Última actividad</th><th>Usuario</th><th></th></tr></thead><tbody>${datos.items.map(item=>`<tr><td><strong>${seguro(item.folio_interno||"-")}</strong></td><td>${seguro(item.folio_origen||"-")}</td><td><span class="movement-count">${item.total_movimientos}</span></td><td><span class="audit-action audit-${String(item.ultima_accion||"").toLowerCase()}">${seguro(ACCIONES_AUDITORIA[item.ultima_accion]||item.ultima_accion)}</span></td><td>${seguro(fechaHoraHistorial(item.ultima_fecha))}</td><td>${seguro(item.ultimo_usuario||"-")}</td><td><button type="button" onclick="abrirTimelineAuditoria('${seguro(item.factura_id)}')">Ver línea de tiempo</button></td></tr>`).join("")}</tbody></table>`:"<p>No se encontraron facturas con esos filtros.</p>";
  $("auditoriaPaginacion").innerHTML=datos.total?`<button type="button" class="ghost" ${datos.page<=1?"disabled":""} onclick="cargarPaginaAuditoria(${datos.page-1})"><i class="fa-solid fa-chevron-left"></i> Anterior</button><span>Página ${datos.page} de ${paginas}</span><button type="button" class="ghost" ${datos.page>=paginas?"disabled":""} onclick="cargarPaginaAuditoria(${datos.page+1})">Siguiente <i class="fa-solid fa-chevron-right"></i></button>`:"";
}

window.cargarPaginaAuditoria=pagina=>cargarAuditoria(pagina);
window.abrirTimelineAuditoria=async facturaId=>{
  const r=await api(`/api/auditoria/factura/${encodeURIComponent(facturaId)}`),datos=await r.json();
  if(!r.ok)return alert(datos.error);
  const referencia=datos[0]||{};
  $("auditoriaTimelineTitulo").textContent=referencia.folio_interno||"Factura eliminada";
  $("auditoriaTimelinePedido").textContent=referencia.folio_origen?`Pedido ${referencia.folio_origen}`:"Sin pedido relacionado";
  $("auditoriaTimeline").innerHTML=datos.length?datos.map(item=>`<article class="timeline-event"><div class="timeline-marker audit-${String(item.accion||"").toLowerCase()}"><i class="fa-solid ${iconoAuditoria(item.accion)}"></i></div><div class="timeline-content"><div class="timeline-heading"><strong>${seguro(ACCIONES_AUDITORIA[item.accion]||item.accion)}</strong><time>${seguro(fechaHoraHistorial(item.creada_en))}</time></div><p>${seguro(item.usuario_nombre||"Usuario")}<small>${seguro(item.usuario_email||"")}</small></p><details><summary>Detalles técnicos</summary><pre>${seguro(JSON.stringify(item.detalle||{},null,2))}</pre></details></div></article>`).join(""):"<p>Esta factura no tiene movimientos registrados.</p>";
  $("auditoriaTimelineModal").hidden=false;
};
function iconoAuditoria(accion){return({CREACION:"fa-plus",EDICION:"fa-pen",TIMBRADO:"fa-stamp",CANCELACION:"fa-ban",ELIMINACION:"fa-trash-can",DESCARGA_DOCUMENTO:"fa-download",SINCRONIZACION_FIREBASE:"fa-rotate"})[accion]||"fa-circle"}
function cerrarTimelineAuditoria(){$("auditoriaTimelineModal").hidden=true}
$("btnCerrarAuditoriaTimeline").onclick=cerrarTimelineAuditoria;
$("auditoriaTimelineBackdrop").onclick=cerrarTimelineAuditoria;
$("btnBuscarAuditoria").onclick=()=>cargarAuditoria(1);
$("buscarAuditoria").addEventListener("keydown",evento=>{if(evento.key==="Enter")cargarAuditoria(1)});
$("btnLimpiarAuditoria").onclick=()=>{["buscarAuditoria","auditoriaAccion","auditoriaDesde","auditoriaHasta"].forEach(id=>$(id).value="");cargarAuditoria(1)};

async function cargarConfiguracionFiscal(){
  const response=await api("/api/configuracion-fiscal");
  if(!response.ok)return;
  const c=await response.json();
  if(!c)return;
  $("cfgRazon").value=c.razonSocial||"";$("cfgNombreComercial").value=c.nombreComercial||"";$("cfgRfc").value=c.rfc||"";$("cfgRegimen").value=c.regimenFiscal||"601";$("cfgCp").value=c.codigoPostal||"";$("cfgSerie").value=c.serie||"F";$("cfgCorreo").value=c.correo||"";$("cfgTelefono").value=c.telefono||"";$("cfgSitioWeb").value=c.sitioWeb||"";$("cfgExportacion").value=c.exportacion||"01";$("cfgAmbiente").value=c.ambiente||"PRUEBAS";$("cfgPac").value=c.pacProveedor||"PENDIENTE";
}

$("configFiscalForm").onsubmit=async event=>{
  event.preventDefault();const button=$("btnGuardarConfig");button.disabled=true;button.textContent="Guardando…";$("configMensaje").textContent="";
  const payload={razonSocial:$("cfgRazon").value,nombreComercial:$("cfgNombreComercial").value,rfc:$("cfgRfc").value,regimenFiscal:$("cfgRegimen").value,codigoPostal:$("cfgCp").value,serie:$("cfgSerie").value,correo:$("cfgCorreo").value,telefono:$("cfgTelefono").value,sitioWeb:$("cfgSitioWeb").value,exportacion:$("cfgExportacion").value,ambiente:$("cfgAmbiente").value,pacProveedor:$("cfgPac").value};
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
  const cancelada=String(f.estatus||"").startsWith("CANCELADA");
  $("pvCancelada").hidden=!cancelada;
  $("pvCanceladaDetalle").textContent=cancelada?`Motivo ${f.motivoCancelacion||"-"} · ${fechaHoraHistorial(f.fechaCancelacion)}`:"";

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

const menuPrincipal = document.querySelector("aside");
const botonMenu = $("btnView");
const fondoMenu = $("menuBackdrop");

function establecerMenuMovil(abierto) {
  if (!menuPrincipal || !botonMenu || !fondoMenu) return;
  menuPrincipal.classList.toggle("is-open", abierto);
  botonMenu.classList.toggle("is-open", abierto);
  botonMenu.setAttribute("aria-expanded", String(abierto));
  botonMenu.setAttribute("aria-label", abierto ? "Cerrar menú" : "Abrir menú");
  fondoMenu.hidden = !abierto;
  document.body.classList.toggle("menu-open", abierto);
}

function cerrarMenuMovil() {
  establecerMenuMovil(false);
}

botonMenu?.addEventListener("click", () => {
  establecerMenuMovil(!menuPrincipal.classList.contains("is-open"));
});
fondoMenu?.addEventListener("click", cerrarMenuMovil);
document.addEventListener("keydown", event => {
  if (event.key === "Escape") cerrarMenuMovil();
});
window.addEventListener("resize", () => {
  if (window.innerWidth > 1050) cerrarMenuMovil();
});

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

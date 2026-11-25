const $ = id => document.getElementById(id);
const escapeHtml = value => String(value ?? "").replaceAll("&", "&amp;").replaceAll('"', "&quot;").replaceAll("'", "&#39;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");
const mxn = new Intl.NumberFormat("es-MX", { style: "currency", currency: "MXN" });
const fecha = value => value && Number.isFinite(Date.parse(value)) ? new Intl.DateTimeFormat("es-MX", { dateStyle: "medium", timeZone: "America/Mexico_City" }).format(new Date(value)) : "—";
let sesion = null, pedido = null, historial = [], detalleActual = null, pagina = 1, cargas = 0, cargandoHistorial = false;
const PAGE_SIZE = 20;
const REGIMENES=[["601","General de Ley Personas Morales",["MORAL"]],["603","Personas Morales con Fines no Lucrativos",["MORAL"]],["605","Sueldos y Salarios e Ingresos Asimilados a Salarios",["FISICA"]],["606","Arrendamiento",["FISICA"]],["607","Enajenación o Adquisición de Bienes",["FISICA"]],["608","Demás ingresos",["FISICA"]],["610","Residentes en el Extranjero sin Establecimiento Permanente",["FISICA","MORAL"]],["611","Ingresos por Dividendos",["FISICA"]],["612","Actividades Empresariales y Profesionales",["FISICA"]],["614","Ingresos por intereses",["FISICA"]],["615","Obtención de premios",["FISICA"]],["616","Sin obligaciones fiscales",["FISICA"]],["620","Sociedades Cooperativas de Producción",["MORAL"]],["621","Incorporación Fiscal",["FISICA"]],["622","Actividades Agrícolas, Ganaderas, Silvícolas y Pesqueras",["MORAL"]],["623","Opcional para Grupos de Sociedades",["MORAL"]],["624","Coordinados",["MORAL"]],["625","Actividades Empresariales vía Plataformas Tecnológicas",["FISICA"]],["626","Régimen Simplificado de Confianza",["FISICA","MORAL"]]];

function regimenes(tipo, valor) {
  const lista = REGIMENES.filter(x => x[2].includes(tipo));
  $("portalRegimen").innerHTML = lista.map(x => `<option value="${x[0]}">${x[0]} - ${x[1]}</option>`).join("");
  $("portalRegimen").value = lista.some(x => x[0] === valor) ? valor : tipo === "MORAL" ? "601" : "616";
}
function carga(texto) { cargas++; $("portalLoaderText").textContent = texto; $("portalLoader").hidden = false; }
function finCarga() { cargas = Math.max(0, cargas - 1); $("portalLoader").hidden = cargas === 0; }
function errorGlobal(mensaje) { $("portalEstado").textContent = mensaje || ""; $("portalEstado").hidden = !mensaje; }
function mensajeError(error, fallback) { return ["TypeError", "AbortError"].includes(error?.name) ? fallback : error?.message || fallback; }
async function json(response) {
  try { return await response.json(); } catch { return { error: "El servidor devolvió una respuesta inesperada. Intenta nuevamente." }; }
}
async function api(url, options = {}) {
  const r = await fetch(url, { cache: "no-store", ...options });
  const data = await json(r);
  if (r.status === 401) { location.replace("/portal-login.html"); throw new Error("Tu sesión terminó. Inicia sesión nuevamente."); }
  return { r, data };
}
function abrir(id) {
  document.querySelectorAll(".portal-tab,.portal-section").forEach(x => x.classList.remove("active"));
  document.querySelectorAll(".portal-tab").forEach(x => x.removeAttribute("aria-current"));
  const tab = document.querySelector(`[data-section="${id}"]`);
  tab?.classList.add("active"); tab?.setAttribute("aria-current", "page");
  $(id).classList.add("active");
  if (id === "portalHistorial") cargarHistorial();
}
document.querySelectorAll(".portal-tab").forEach(button => button.onclick = () => abrir(button.dataset.section));
function llenarPerfil(c) {
  $("portalNombre").textContent = c.nombre || c.razonSocial || "Cliente";
  $("portalTipo").value = c.tipoPersona || "FISICA"; regimenes($("portalTipo").value, c.regimenFiscal);
  for (const [id, value] of Object.entries({ portalContacto: c.nombre, portalRazon: c.razonSocial || c.nombre, portalRfc: c.rfc, portalCp: c.codigoPostal, portalUso: c.usoCfdi || "G03", portalPerfilEmail: c.email, portalTelefono: c.telefono })) $(id).value = value || "";
}
function mostrarReceptor(c) {
  const campos = {"Nombre o razón social": c.razonSocial || c.nombre, RFC: c.rfc,
    "Código postal fiscal": c.codigoPostal, "Régimen fiscal": c.regimenFiscal,
    "Uso CFDI": c.usoCfdi, Correo: c.email};
  $("portalResumenFiscal").innerHTML = Object.entries(campos).map(([label,value]) =>
    `<div><dt>${label}</dt><dd>${escapeHtml(value || "Por completar")}</dd></div>`).join("");
}
$("portalEditarDatos").onclick = () => abrir("portalPerfil");
async function iniciar() {
  carga("Preparando tu portal…");
  try {
    const { r, data } = await api("/api/portal/session");
    if (!r.ok) throw new Error(data.error || "No fue posible cargar tu cuenta.");
    sesion = data; if(data.soloPue) $("portalMetodo").querySelector('[value="PPD"]').remove(); llenarPerfil(data.cliente); $("portalBuscar").disabled = false;
  } catch (error) { errorGlobal(mensajeError(error, "No fue posible conectar con el servidor. Recarga la página para intentar nuevamente.")); }
  finally { finCarga(); }
}
$("portalTipo").onchange = () => regimenes($("portalTipo").value);
$("portalPerfilForm").onsubmit = async event => {
  event.preventDefault(); const button = $("portalGuardarPerfil"); if (button.disabled) return;
  button.disabled = true; carga("Guardando datos fiscales…"); $("portalPerfilMensaje").textContent = "";
  try {
    const payload = { nombre: $("portalContacto").value, tipoPersona: $("portalTipo").value, razonSocial: $("portalRazon").value, rfc: $("portalRfc").value, codigoPostal: $("portalCp").value, regimenFiscal: $("portalRegimen").value, usoCfdi: $("portalUso").value, telefono: $("portalTelefono").value };
    const { r, data } = await api("/api/portal/perfil", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) });
    if (!r.ok) throw new Error(data.error || "No fue posible guardar tus datos fiscales.");
    sesion.cliente = data; llenarPerfil(data); mostrarReceptor(data); $("portalPerfilMensaje").textContent = "Datos fiscales guardados correctamente.";
  } catch (error) { $("portalPerfilMensaje").textContent = mensajeError(error, "No fue posible conectar con el servidor. Tus datos siguen en el formulario."); }
  finally { button.disabled = false; finCarga(); }
};

$("portalBuscar").onclick = async () => {
  const folio = $("portalFolio").value.trim(); if (!folio || $("portalBuscar").disabled) return;
  pedido = null; $("portalFacturaMensaje").textContent = ""; $("portalPedido").hidden = true;
  $("portalBuscar").disabled = true; carga("Buscando y validando tu pedido…");
  try {
    const { r, data } = await api(`/api/portal/pedidos?folio=${encodeURIComponent(folio)}`);
    if (!r.ok) throw new Error(data.error || "No fue posible consultar el pedido.");
    $("portalMetodo").value = "PUE"; $("portalMetodo").onchange(); $("portalForma").value = "";
    pedido = data; mostrarReceptor(sesion.cliente); $("portalPedidoFolio").textContent = data.folio; $("portalPedidoCliente").textContent = data.cliente?.nombre || "—";
    $("portalPedidoTotal").textContent = mxn.format(data.totalPedido || 0);
    $("portalProductos").innerHTML = (data.productos || []).map(p => `<div><span>${Number(p.cantidad)} × ${escapeHtml(p.descripcion)}</span><strong>${mxn.format(p.totalVentaLinea !== undefined ? Number(p.totalVentaLinea) : Number(p.precioUnitario || 0) * Number(p.cantidad || 0) * 1.16)}</strong></div>`).join("");
    $("portalGenerar").disabled = Boolean(data.requiereRevision);
    $("portalFacturaMensaje").textContent = data.mensajeRevision || "";
    $("portalPedido").hidden = false; $("portalPedido").scrollIntoView({ behavior: "smooth", block: "start" });
  } catch (error) { $("portalFacturaMensaje").textContent = mensajeError(error, "No fue posible consultar el pedido. Vuelve a intentarlo."); }
  finally { $("portalBuscar").disabled = false; finCarga(); }
};
$("portalFolio").addEventListener("keydown", event => { if (event.key === "Enter") { event.preventDefault(); $("portalBuscar").click(); } });
$("portalMetodo").onchange = () => {
  if ($("portalMetodo").value === "PPD") $("portalForma").innerHTML = '<option value="99">99 - Por definir</option>';
  else if ($("portalForma").value === "99") $("portalForma").innerHTML = '<option value="">Selecciona la forma de pago</option><option value="01">01 - Efectivo</option><option value="03">03 - Transferencia</option><option value="04">04 - Tarjeta de crédito</option><option value="28">28 - Tarjeta de débito</option>';
};
$("portalGenerar").onclick = async () => {
  const button = $("portalGenerar"); if (!pedido || button.disabled) return;
  if (!$("portalForma").value) {
    $("portalFacturaMensaje").textContent = "Selecciona la forma de pago de esta compra.";
    $("portalForma").focus(); return;
  }
  button.disabled = true; carga("Generando tu factura…"); $("portalFacturaMensaje").textContent = "";
  try {
    const payload = { folioOrigen: pedido.folio, formaPago: $("portalForma").value, metodoPago: $("portalMetodo").value };
    const { r, data } = await api("/api/portal/facturas", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) });
    if (!r.ok) throw new Error(data.error || "No fue posible registrar la solicitud.");
    pedido = null; $("portalPedido").hidden = true; $("portalFolio").value = "";
    $("portalExitoTitulo").textContent = data.requiereRevision ? "Emisión pendiente de revisión" : data.estadoCliente.etiqueta;
    $("portalResultadoMensaje").textContent = data.requiereRevision
      ? "Conservamos tu folio. Comunícate con Noventia para revisar la emisión. Puedes consultar su estado en Mi historial."
      : data.estadoCliente.mensaje;
    $("portalExitoFolio").textContent = data.folioInterno || data.id; $("portalExito").showModal();
  } catch (error) { $("portalFacturaMensaje").textContent = mensajeError(error, "No fue posible conectar con el servidor. Revisa Mi historial antes de intentar nuevamente."); }
  finally { button.disabled = false; finCarga(); }
};

function estado(factura) { return factura.estadoCliente || { grupo: "PENDIENTE", etiqueta: "En revisión", mensaje: "Consulta el estado de esta solicitud.", prueba: false }; }
function badge(factura) {
  const actual = estado(factura), grupo = ["PENDIENTE", "DISPONIBLE", "CANCELADA"].includes(actual.grupo) ? actual.grupo : "PENDIENTE";
  return `<span class="portal-badge portal-status-${grupo}">${escapeHtml(actual.etiqueta)}</span>`;
}
function botonesDocumentos(factura, contexto = "historial") {
  return ["pdf", "xml"].map(tipo => `<button type="button" class="ghost" data-descargar="${tipo}" data-factura="${escapeHtml(factura.id)}" data-contexto="${contexto}" ${factura.documentos?.[tipo] ? "" : 'disabled title="Documento todavía no disponible"'}>Descargar ${tipo.toUpperCase()}</button>`).join("");
}
function renderHistorial() {
  const query = $("portalHistorialBuscar").value.trim().toLocaleLowerCase("es-MX"), filtro = $("portalHistorialEstado").value;
  const coincidencias = historial.filter(f => (!query || `${f.folioInterno} ${f.folioOrigen}`.toLocaleLowerCase("es-MX").includes(query)) && (!filtro || estado(f).grupo === filtro));
  const paginas = Math.max(1, Math.ceil(coincidencias.length / PAGE_SIZE)); pagina = Math.min(pagina, paginas);
  $("portalCountTotal").textContent = historial.length;
  $("portalCountPendientes").textContent = historial.filter(f => estado(f).grupo === "PENDIENTE").length;
  $("portalCountDocumentos").textContent = historial.filter(f => f.documentos?.pdf || f.documentos?.xml).length;
  $("portalPaginacion").hidden = coincidencias.length <= PAGE_SIZE;
  $("portalPagina").textContent = `Página ${pagina} de ${paginas}`; $("portalAnterior").disabled = pagina <= 1; $("portalSiguiente").disabled = pagina >= paginas;
  if (!coincidencias.length) {
    $("portalHistorialLista").innerHTML = `<div class="portal-empty"><strong>${historial.length ? "No encontramos coincidencias" : "Tu historial empieza aquí"}</strong><p>${historial.length ? "Prueba con otro folio o limpia los filtros." : "Cuando envíes una solicitud, podrás consultar aquí su estado y sus documentos."}</p></div>`; return;
  }
  $("portalHistorialLista").innerHTML = coincidencias.slice((pagina - 1) * PAGE_SIZE, pagina * PAGE_SIZE).map(f => `
    <article class="portal-history-item">
      <div><small>${escapeHtml(fecha(f.creadaEn))}</small><strong class="portal-history-folio">${escapeHtml(f.folioInterno || f.id)}</strong><span class="portal-history-reference">Pedido ${escapeHtml(f.folioOrigen || "—")}</span></div>
      <div>${badge(f)}<strong class="portal-history-total">${mxn.format(f.total || 0)}</strong></div>
      <div class="portal-card-actions"><button type="button" data-detalle="${escapeHtml(f.id)}">Ver detalle</button>${botonesDocumentos(f)}${f.documentos?.pdf || f.documentos?.xml ? "" : '<span class="portal-document-hint">Documentos pendientes</span>'}</div>
    </article>`).join("");
}
async function cargarHistorial() {
  if (cargandoHistorial) return;
  cargandoHistorial = true; $("portalRecargarHistorial").disabled = true;
  carga("Cargando tu historial…"); $("portalHistorialMensaje").textContent = "";
  try {
    const { r, data } = await api("/api/portal/facturas");
    if (!r.ok || !Array.isArray(data)) throw new Error(data.error || "No fue posible cargar tu historial.");
    historial = data; renderHistorial();
  } catch (error) { $("portalHistorialMensaje").textContent = mensajeError(error, "No fue posible conectar con el servidor. Presiona Actualizar para intentar nuevamente."); }
  finally { cargandoHistorial = false; $("portalRecargarHistorial").disabled = false; finCarga(); }
}
$("portalRecargarHistorial").onclick = cargarHistorial;
for (const id of ["portalHistorialBuscar", "portalHistorialEstado"]) $(id).addEventListener(id.endsWith("Buscar") ? "input" : "change", () => { pagina = 1; renderHistorial(); });
$("portalLimpiarFiltros").onclick = () => { $("portalHistorialBuscar").value = ""; $("portalHistorialEstado").value = ""; pagina = 1; renderHistorial(); };
$("portalAnterior").onclick = () => { pagina = Math.max(1, pagina - 1); renderHistorial(); };
$("portalSiguiente").onclick = () => { pagina++; renderHistorial(); };

function renderDetalle(f) {
  const c = f.cliente || {}, actual = estado(f);
  $("portalDetalleTitulo").textContent = f.folioInterno || f.id;
  $("portalDetalleContenido").innerHTML = `
    <div class="portal-detail-state">${badge(f)}<p>${escapeHtml(actual.mensaje)}</p></div>
    <div class="portal-detail-grid"><div><h3>Datos de tu compra</h3><p><strong>Pedido:</strong> ${escapeHtml(f.folioOrigen || "—")}</p><p><strong>Solicitud:</strong> ${escapeHtml(fecha(f.creadaEn))}</p><p><strong>Forma de pago:</strong> ${escapeHtml(f.formaPago || "—")}</p><p><strong>Método de pago:</strong> ${escapeHtml(f.metodoPago || "—")}</p>${f.uuid ? `<p><strong>${actual.prueba ? "Identificador de prueba" : "UUID"}:</strong> ${escapeHtml(f.uuid)}</p>` : ""}${f.fechaCancelacion ? `<p><strong>Cancelación:</strong> ${escapeHtml(fecha(f.fechaCancelacion))}</p>` : ""}</div>
    <div><h3>Receptor</h3><p><strong>${escapeHtml(c.razonSocial || "—")}</strong></p><p>RFC: ${escapeHtml(c.rfc || "—")}</p><p>Código postal fiscal: ${escapeHtml(c.codigoPostal || "—")}</p><p>Régimen fiscal: ${escapeHtml(c.regimenFiscal || "—")}</p><p>Uso CFDI: ${escapeHtml(f.usoCfdi || "—")}</p></div></div>
    <div class="portal-table-wrap" tabindex="0" role="region" aria-label="Productos de la factura"><table class="portal-detail-table"><thead><tr><th scope="col">Cant.</th><th scope="col">Concepto</th><th scope="col">Total</th></tr></thead><tbody>${(f.conceptos || []).map(p => `<tr><td>${Number(p.cantidad || 0)}</td><td>${escapeHtml(p.descripcion)}${p.sku ? `<small>SKU: ${escapeHtml(p.sku)}</small>` : ""}</td><td>${p.importe == null ? "—" : mxn.format(p.importe)}</td></tr>`).join("") || '<tr><td colspan="3">Sin conceptos disponibles.</td></tr>'}</tbody></table></div>
    <div class="portal-detail-totals"><div><span>Subtotal</span><span>${mxn.format(f.subtotal || 0)}</span></div><div><span>IVA</span><span>${mxn.format(f.impuestos || 0)}</span></div><div><span>Total MXN</span><span>${mxn.format(f.total || 0)}</span></div></div>
    <div class="portal-detail-documents"><h3>Documentos</h3><p>${actual.prueba ? "Estos archivos son documentos de prueba sin valor fiscal." : "Descarga los archivos disponibles para esta solicitud."}${!f.documentos?.pdf && !f.documentos?.xml ? " Aún no hay documentos disponibles." : ""}</p><div class="portal-detail-actions">${botonesDocumentos(f, "detalle")}</div></div>`;
}
async function abrirDetalle(id) {
  carga("Abriendo el detalle…"); $("portalHistorialMensaje").textContent = "";
  try {
    const { r, data } = await api(`/api/portal/facturas/${encodeURIComponent(id)}`);
    if (!r.ok) throw new Error(data.error || "No fue posible abrir la factura.");
    detalleActual = data; $("portalDetalleMensaje").textContent = ""; renderDetalle(data); $("portalDetalle").showModal();
  } catch (error) { $("portalHistorialMensaje").textContent = mensajeError(error, "No fue posible conectar con el servidor. Vuelve a intentarlo."); }
  finally { finCarga(); }
}
$("portalCerrarDetalle").onclick = () => $("portalDetalle").close();
$("portalDetalle").addEventListener("click", event => {
  if (event.target === $("portalDetalle")) { const r = $("portalDetalle").getBoundingClientRect(); if (event.clientX < r.left || event.clientX > r.right || event.clientY < r.top || event.clientY > r.bottom) $("portalDetalle").close(); }
});
async function descargarDocumento(id, tipo, button) {
  if (!["pdf", "xml"].includes(tipo) || button.disabled) return;
  const mensaje = button.dataset.contexto === "detalle" ? $("portalDetalleMensaje") : $("portalHistorialMensaje");
  const etiqueta = button.textContent;
  mensaje.textContent = "Preparando el documento…"; button.textContent = "Descargando…"; button.disabled = true; carga(`Preparando tu ${tipo.toUpperCase()}…`);
  try {
    const response = await fetch(`/api/portal/facturas/${encodeURIComponent(id)}/documento/${tipo}`, { cache: "no-store" });
    if (response.status === 401) { location.replace("/portal-login.html"); throw new Error("Tu sesión terminó. Inicia sesión nuevamente."); }
    if (!response.ok) { const data = await json(response); throw new Error(data.error || "No fue posible descargar el documento."); }
    const blob = await response.blob(), url = URL.createObjectURL(blob), enlace = document.createElement("a");
    const factura = historial.find(f => f.id === id) || (detalleActual?.id === id ? detalleActual : null);
    const nombre = String(factura?.folioInterno || id).replace(/[^a-zA-Z0-9_-]/g, "_").slice(0, 100);
    enlace.href = url; enlace.download = `${nombre}.${tipo}`; document.body.appendChild(enlace); enlace.click(); enlace.remove(); setTimeout(() => URL.revokeObjectURL(url), 1000); mensaje.textContent = "";
  } catch (error) { mensaje.textContent = mensajeError(error, "No fue posible conectar con el servidor. Intenta nuevamente."); }
  finally { button.disabled = false; button.textContent = etiqueta; finCarga(); }
}
for (const id of ["portalHistorialLista", "portalDetalleContenido"]) $(id).addEventListener("click", event => {
  const detalle = event.target.closest("button[data-detalle]"); if (detalle) { abrirDetalle(detalle.dataset.detalle); return; }
  const descarga = event.target.closest("button[data-descargar]"); if (descarga) descargarDocumento(descarga.dataset.factura, descarga.dataset.descargar, descarga);
});
$("portalOtra").onclick = () => { $("portalExito").close(); abrir("portalNueva"); $("portalFolio").focus(); };
$("portalVerHistorial").onclick = () => { $("portalExito").close(); abrir("portalHistorial"); };
$("portalLogout").onclick = async () => {
  const button = $("portalLogout"); button.disabled = true;
  try { const response = await fetch("/api/portal/logout", { method: "POST" }); if (!response.ok) throw new Error(); location.replace("/portal-login.html"); }
  catch { errorGlobal("No fue posible cerrar sesión. Intenta nuevamente."); button.disabled = false; }
};
iniciar();

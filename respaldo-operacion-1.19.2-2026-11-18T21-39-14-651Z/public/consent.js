const VERSION="2026-10-06";
if(localStorage.getItem("noventia_privacidad_version")!==VERSION){
  const modal=document.createElement("div");
  modal.className="modal privacy-modal";
  modal.setAttribute("role","dialog");modal.setAttribute("aria-modal","true");
  modal.innerHTML=`<div class="modal-backdrop"></div><div class="success-panel privacy-panel"><p class="success-eyebrow">Tu información importa</p><h2>Aviso de privacidad y cookies</h2><p>Utilizamos cookies esenciales para mantener tu sesión y proteger el sistema. Consulta nuestro <a href="/aviso-privacidad.html" target="_blank" rel="noopener">aviso de privacidad</a>.</p><label class="consent-check"><input id="consentCheck" type="checkbox"> He leído y acepto el aviso de privacidad y las cookies esenciales.</label><p id="consentError" class="form-message"></p><div class="success-actions"><button id="consentReject" type="button" class="ghost">No aceptar</button><button id="consentAccept" type="button">Aceptar y continuar</button></div></div>`;
  document.body.append(modal);
  document.getElementById("consentAccept").onclick=()=>{
    if(!document.getElementById("consentCheck").checked){document.getElementById("consentError").textContent="Marca la casilla para continuar.";return}
    localStorage.setItem("noventia_privacidad_version",VERSION);localStorage.setItem("noventia_privacidad_fecha",new Date().toISOString());modal.remove();
  };
  document.getElementById("consentReject").onclick=()=>location.replace("/privacidad-requerida.html");
}

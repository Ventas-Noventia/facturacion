const $=id=>document.getElementById(id);
async function json(response){const text=await response.text();try{return text?JSON.parse(text):{}}catch{return{error:"El servidor devolvió una respuesta inesperada"}}}

$("portalLoginForm")?.addEventListener("submit",async event=>{
  event.preventDefault();const button=$("portalLoginButton");button.disabled=true;button.textContent="Ingresando…";$("portalAuthMensaje").textContent="";
  try{const response=await fetch("/api/portal/login",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({email:$("portalEmail").value,password:$("portalPassword").value,aceptaPrivacidad:$("aceptaAviso")?.checked===true})});const data=await json(response);if(data.codigo==="ACEPTAR_AVISO")$("avisoPendiente").hidden=false;if(!response.ok)throw new Error(data.error||"No fue posible iniciar sesión");location.replace("/portal.html")}catch(error){$("portalAuthMensaje").textContent=error.message}finally{button.disabled=false;button.textContent="Iniciar sesión"}
});

$("portalRegistroForm")?.addEventListener("submit",async event=>{
  event.preventDefault();const button=$("portalRegistroButton");button.disabled=true;button.textContent="Creando cuenta…";$("portalAuthMensaje").textContent="";
  try{const payload={nombre:$("registroNombre").value,email:$("registroEmail").value,telefono:$("registroTelefono").value,password:$("registroPassword").value,aceptaPrivacidad:$("registroPrivacidad").checked};const response=await fetch("/api/portal/registro",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify(payload)});const data=await json(response);if(!response.ok)throw new Error(data.error||"No fue posible crear la cuenta");if(data.requiereConfirmacion){$("portalAuthMensaje").textContent="Revisa tu correo para confirmar el registro. Si ya confirmaste la cuenta, inicia sesión.";event.target.reset()}else location.replace("/portal.html")}catch(error){$("portalAuthMensaje").textContent=error.message}finally{button.disabled=false;button.textContent="Crear cuenta"}
});

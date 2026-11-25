const $=id=>document.getElementById(id);

async function comprobarSesion(){
  try{
    const response=await fetch("/api/session");
    if(response.ok)window.location.replace("/");
  }catch{}
}

$("loginForm").onsubmit=async event=>{
  event.preventDefault();
  const button=$("loginButton");
  button.disabled=true;
  button.textContent="Ingresando…";
  $("loginMensaje").textContent="";
  try{
    const response=await fetch("/api/auth/login",{
      method:"POST",
      headers:{"Content-Type":"application/json"},
      body:JSON.stringify({email:$("loginEmail").value,password:$("loginPassword").value})
    });
    const data=await response.json();
    if(!response.ok)throw new Error(data.error||"No fue posible iniciar sesión");
    window.location.replace("/");
  }catch(error){
    $("loginMensaje").textContent=error.message;
  }finally{
    button.disabled=false;
    button.textContent="Iniciar sesión";
  }
};

comprobarSesion();

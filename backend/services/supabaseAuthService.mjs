export class SupabaseAuthService{
  constructor({url,publishableKey}){
    this.authBase=`${String(url).replace(/\/$/,"")}/auth/v1`;
    this.key=publishableKey;
  }

  async request(path,{method="GET",token,body}={}){
    const response=await fetch(`${this.authBase}${path}`,{
      method,
      headers:{
        apikey:this.key,
        Authorization:`Bearer ${token||this.key}`,
        ...(body?{"Content-Type":"application/json"}:{})
      },
      body:body?JSON.stringify(body):undefined
    });
    const text=await response.text();
    const data=text?JSON.parse(text):null;
    if(!response.ok){
      const error=new Error(data?.msg||data?.error_description||data?.message||"No fue posible iniciar sesión");
      error.status=response.status;
      throw error;
    }
    return data;
  }

  login(email,password){
    return this.request("/token?grant_type=password",{method:"POST",body:{email,password}});
  }

  refresh(refreshToken){
    return this.request("/token?grant_type=refresh_token",{method:"POST",body:{refresh_token:refreshToken}});
  }

  getUser(accessToken){
    return this.request("/user",{token:accessToken});
  }
}

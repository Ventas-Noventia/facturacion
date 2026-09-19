const MOTIVOS=new Set(["01","02","03","04"]);

export class MockCancelacionService{
  cancelar(factura,{motivo,uuidSustitucion=""}={}){
    const clave=String(motivo||"").trim();
    const sustitucion=String(uuidSustitucion||"").trim().toUpperCase();
    if(!MOTIVOS.has(clave))throw new Error("Selecciona un motivo de cancelación válido");
    if(clave==="01"&&!sustitucion)throw new Error("El motivo 01 requiere el UUID de la factura que sustituye a la actual");
    if(clave!=="01"&&sustitucion)throw new Error("El UUID de sustitución solamente corresponde al motivo 01");
    return{estatus:"CANCELADA_MOCK",motivoCancelacion:clave,uuidSustitucion:sustitucion||null,fechaCancelacion:new Date().toISOString(),acuseCancelacion:`MOCK-CANCEL-${factura.uuid||factura.id}`};
  }
}

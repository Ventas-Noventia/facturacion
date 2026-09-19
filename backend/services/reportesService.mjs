const numero=valor=>Number.isFinite(Number(valor))?Number(valor):0;
const redondear=valor=>Number(numero(valor).toFixed(2));
const fechaCorta=valor=>String(valor||"").slice(0,10);
const esTimbrada=factura=>String(factura.estatus||"").startsWith("TIMBRADA");

function aplicarFiltros(facturas,filtros={}){
  return facturas.filter(factura=>{
    const fecha=fechaCorta(factura.creadaEn);
    return (!filtros.desde||fecha>=filtros.desde)&&(!filtros.hasta||fecha<=filtros.hasta)&&
      (!filtros.origen||(factura.origen||"MANUAL")===filtros.origen)&&(!filtros.estatus||factura.estatus===filtros.estatus);
  });
}

function agrupar(facturas,campo,valorDefecto="OTRO"){
  const resultado={};
  for(const factura of facturas){
    const clave=factura[campo]||valorDefecto;
    if(!resultado[clave])resultado[clave]={cantidad:0,total:0};
    resultado[clave].cantidad+=1;
    resultado[clave].total=redondear(resultado[clave].total+numero(factura.total));
  }
  return resultado;
}

export class ReportesService{
  construir(facturas=[],filtros={}){
    const filtradas=aplicarFiltros(facturas,filtros);
    const timbradas=filtradas.filter(esTimbrada);
    const borradores=filtradas.filter(x=>x.estatus==="BORRADOR");
    const canceladas=filtradas.filter(x=>String(x.estatus||"").startsWith("CANCELADA"));
    return{
      filtros,totalFacturas:filtradas.length,timbradas:timbradas.length,borradores:borradores.length,canceladas:canceladas.length,
      subtotalFacturado:redondear(timbradas.reduce((s,x)=>s+numero(x.subtotal),0)),
      ivaFacturado:redondear(timbradas.reduce((s,x)=>s+numero(x.impuestos),0)),
      totalFacturado:redondear(timbradas.reduce((s,x)=>s+numero(x.total),0)),
      porOrigen:Object.fromEntries(Object.entries(agrupar(filtradas,"origen","MANUAL")).map(([k,v])=>[k,v.cantidad])),
      resumenPorOrigen:agrupar(filtradas,"origen","MANUAL"),porEstatus:agrupar(filtradas,"estatus","SIN_ESTATUS"),
      detalle:filtradas.map(f=>({fecha:f.creadaEn||"",factura:f.folioInterno||"",pedido:f.folioOrigen||"",origen:f.origen||"MANUAL",cliente:f.cliente?.razonSocial||"",rfc:f.cliente?.rfc||"",estatus:f.estatus||"",subtotal:redondear(f.subtotal),iva:redondear(f.impuestos),total:redondear(f.total),uuid:f.uuid||""}))
    };
  }
}

import { createHash } from "node:crypto";

const sha256 = text => createHash("sha256").update(text).digest("hex");
const object = value => value !== null && typeof value === "object" && !Array.isArray(value);

// PostgreSQL jsonb does not preserve object-key order. Arrays and every value
// remain significant, while the order of object keys must not affect a hash.
export function jsonCanonico(value) {
  return JSON.stringify(value, (_key, item) => object(item)
    ? Object.fromEntries(Object.keys(item).sort().map(key => [key, item[key]])) : item);
}
export const huellaSolicitud = payload => sha256(jsonCanonico(payload));
export const huellaSolicitudLegacy = payload => sha256(JSON.stringify(payload));

function camposEnOrden(value, names) {
  if (!object(value) || Object.keys(value).some(key => !names.includes(key))) throw new Error("Formato de solicitud anterior no reconocido");
  return Object.fromEntries(names.filter(key => Object.hasOwn(value, key)).map(key => [key, value[key]]));
}

// v1.17.0/1.17.1 hashed the constructor's insertion order. Restore that exact
// known format to verify existing hashes after a jsonb round trip. Never skip
// verification or replace an unverified hash with a freshly computed one.
export function restaurarFormatoLegacy(payload) {
  const restored = camposEnOrden(payload, ["NameId", "Currency", "CfdiType", "Serie", "Folio", "Date", "OrderNumber", "PaymentForm", "PaymentMethod", "ExpeditionPlace", "Exportation", "Observations", "Issuer", "Receiver", "Items"]);
  restored.Issuer = camposEnOrden(restored.Issuer, ["Rfc", "Name", "FiscalRegime"]);
  restored.Receiver = camposEnOrden(restored.Receiver, ["Rfc", "Name", "FiscalRegime", "TaxZipCode", "CfdiUse"]);
  if (!Array.isArray(restored.Items)) throw new Error("Conceptos anteriores no reconocidos");
  restored.Items = restored.Items.map(value => {
    const item = camposEnOrden(value, ["ProductCode", "IdentificationNumber", "Description", "UnitCode", "Unit", "UnitPrice", "Quantity", "Subtotal", "Discount", "TaxObject", "Taxes", "Total"]);
    if (!Array.isArray(item.Taxes)) throw new Error("Impuestos anteriores no reconocidos");
    item.Taxes = item.Taxes.map(tax => camposEnOrden(tax, ["Total", "Name", "Base", "Rate", "IsRetention"]));
    return item;
  });
  return restored;
}

export function verificarHuellaSolicitud(operation) {
  if (!object(operation?.solicitud) || !/^[a-f0-9]{64}$/.test(String(operation.huella || ""))) return false;
  try {
    if (operation.huellaVersion === 2) return operation.huella === huellaSolicitud(operation.solicitud);
    if (operation.huellaVersion != null && operation.huellaVersion !== 1) return false;
    if (operation.huella === huellaSolicitudLegacy(operation.solicitud)) return true;
    return operation.huella === huellaSolicitudLegacy(restaurarFormatoLegacy(operation.solicitud));
  } catch { return false; }
}

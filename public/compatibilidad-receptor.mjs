import {regimenesTicket} from './regimenes-ticket.mjs';

const gastos = new Set(['601','603','606','612','620','621','622','623','624','625','626']);
const deducciones = new Set(['605','606','607','608','611','612','614','615','625']);

export function usoCompatible(regimen, uso) {
  if (!regimenesTicket.some(([clave]) => clave === regimen)) return false;
  if (uso === 'S01') return true;
  if (/^(G0[1-3]|I0[1-8])$/.test(uso)) return gastos.has(regimen);
  return /^D(0[1-9]|10)$/.test(uso) && deducciones.has(regimen);
}

export function revisarReceptor(cliente, uso) {
  const {tipoPersona, regimenFiscal, rfc} = cliente || {};
  const clave = String(rfc || '').trim().toUpperCase();
  const tipo = tipoPersona || (clave.length === 12 ? 'MORAL' : 'FISICA');
  if (!['FISICA','MORAL'].includes(tipo) ||
      !(tipo === 'FISICA' ? /^[A-ZÑ&]{4}\d{6}[A-Z0-9]{3}$/ : /^[A-ZÑ&]{3}\d{6}[A-Z0-9]{3}$/).test(clave))
    return 'Revisa el RFC y el tipo de persona del receptor.';
  if (!regimenesTicket.some(([codigo,,tipos]) => codigo === regimenFiscal && tipos.includes(tipo)))
    return 'Selecciona el régimen de la constancia que corresponda al tipo de persona del receptor.';
  if (!uso) return 'Selecciona el uso de CFDI que indicó el receptor.';
  if (!usoCompatible(regimenFiscal, uso)) return 'El régimen '+regimenFiscal+' no admite '+uso+'. Revisa el uso de CFDI con el receptor.';
  return '';
}

export function filtrarUsos(regimen, select) {
  const anterior = select.value;
  if (!Array.from(select.options).some(op => op.value === '')) select.add(new Option('Selecciona el uso de CFDI',''),0);
  for (const opcion of select.options) {
    const excluir = Boolean(opcion.value && !usoCompatible(regimen,opcion.value));
    opcion.disabled = excluir;
    opcion.hidden = excluir;
  }
  select.required = true;
  select.value = usoCompatible(regimen,anterior) ? anterior : '';
}

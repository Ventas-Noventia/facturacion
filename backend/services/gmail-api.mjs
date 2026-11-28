import { readFile } from 'node:fs/promises';

export async function transporteGmail(nodemailer, archivo) {
  const { client_id, client_secret, refresh_token } = JSON.parse(await readFile(archivo, 'utf8'));
  if (![client_id, client_secret, refresh_token].every(v => typeof v === 'string' && v.trim())) {
    throw new Error('La autorización de Gmail está incompleta.');
  }
  const token = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST', signal: AbortSignal.timeout(15000),
    body: new URLSearchParams({ client_id, client_secret, refresh_token, grant_type: 'refresh_token' })
  });
  if (!token.ok) throw new Error('No se pudo renovar la autorización de Gmail (HTTP ' + token.status + ').');
  const { access_token } = await token.json();
  if (!access_token) throw new Error('Gmail no devolvió un token de acceso.');
  const mime = nodemailer.createTransport({ streamTransport: true, buffer: true, newline: 'windows', disableFileAccess: true, disableUrlAccess: true });
  return {
    async sendMail(mensaje) {
      const { message } = await mime.sendMail(mensaje);
      const respuesta = await fetch('https://gmail.googleapis.com/gmail/v1/users/me/messages/send', {
        method: 'POST', signal: AbortSignal.timeout(30000),
        headers: { Authorization: 'Bearer ' + access_token, 'Content-Type': 'application/json' },
        body: JSON.stringify({ raw: message.toString('base64url') })
      });
      if (!respuesta.ok) throw new Error('Gmail respondió HTTP ' + respuesta.status + '. Revisa Enviados antes de reintentar.');
      const { id } = await respuesta.json();
      if (!id) throw new Error('Gmail no confirmó el envío. Revisa Enviados antes de reintentar.');
      return { accepted: [mensaje.to.address], messageId: id };
    }
  };
}

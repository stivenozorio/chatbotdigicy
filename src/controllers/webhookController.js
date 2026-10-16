'use strict';

const whatsapp = require('../services/whatsapp');
const { generateReply, GeminiError } = require('../services/gemini');

const MAX_AI_INPUT = 1000;
const FALLBACK_REPLY = 'Disculpa, en este momento no puedo responderte. Intenta de nuevo en unos minutos.';
const NON_TEXT_REPLY = 'Por ahora solo puedo leer mensajes de texto. ¿Me escribes tu consulta?';

// Meta reintenta las entregas: se recuerdan los últimos ids para no responder dos veces.
const seen = new Set();
const SEEN_MAX = 1000;
function alreadySeen(id) {
  if (seen.has(id)) return true;
  seen.add(id);
  if (seen.size > SEEN_MAX) seen.delete(seen.values().next().value);
  return false;
}

// GET: verificación del webhook con Meta.
exports.verify = (req, res) => {
  const challenge = whatsapp.verifyChallenge(req.query);
  if (challenge === null) return res.sendStatus(403);
  return res.status(200).type('text/plain').send(challenge);
};

async function handleMessage(msg) {
  let reply;
  if (msg.text === null) {
    reply = NON_TEXT_REPLY;
  } else {
    try {
      reply = await generateReply(msg.text.trim().slice(0, MAX_AI_INPUT));
    } catch (err) {
      const code = err instanceof GeminiError ? err.code : 'ERROR_DESCONOCIDO';
      const detail = err instanceof GeminiError && err.detail ? ` - ${err.detail}` : '';
      console.error(`Webhook: fallo de IA: ${code}${detail}`);
      reply = FALLBACK_REPLY;
    }
  }
  await whatsapp.sendText(msg.phoneNumberId, msg.from, reply);
}

// POST: mensajes entrantes. Se valida la firma, se responde 200 enseguida y se procesa en segundo plano.
exports.receive = (req, res) => {
  if (!process.env.WHATSAPP_APP_SECRET) {
    console.error('Webhook: WHATSAPP_APP_SECRET no configurado');
    return res.sendStatus(503);
  }
  if (!whatsapp.isValidSignature(req.rawBody, req.get('x-hub-signature-256'))) {
    console.error('Webhook: firma inválida');
    return res.sendStatus(403);
  }

  res.sendStatus(200);

  const autoReply = Boolean(process.env.WHATSAPP_ACCESS_TOKEN);
  for (const msg of whatsapp.extractMessages(req.body)) {
    if (alreadySeen(msg.id)) continue;
    console.log(`Webhook: mensaje recibido (tipo=${msg.type})`); // sin número ni contenido
    if (!autoReply || !msg.phoneNumberId) {
      console.error('Webhook: sin WHATSAPP_ACCESS_TOKEN o phone_number_id; no se responde');
      continue;
    }
    handleMessage(msg).catch((err) => {
      console.error('Webhook: fallo al responder:', err && err.message ? err.message : 'ERROR_DESCONOCIDO');
    });
  }
};

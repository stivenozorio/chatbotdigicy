'use strict';

// WhatsApp Cloud API (Meta): verificación del webhook, firma, lectura de mensajes y envío de respuestas.
// Los secretos se leen de process.env.WHATSAPP_* y nunca se registran.

const crypto = require('crypto');

const DEFAULT_GRAPH_VERSION = 'v25.0'; // configurable con WHATSAPP_GRAPH_VERSION
const SEND_TIMEOUT_MS = 15000;

function safeEqual(a, b) {
  const ba = Buffer.from(String(a));
  const bb = Buffer.from(String(b));
  return ba.length === bb.length && crypto.timingSafeEqual(ba, bb);
}

// Verificación inicial que hace Meta con GET: devuelve el challenge o null si no es válida.
function verifyChallenge(query) {
  const expected = process.env.WHATSAPP_VERIFY_TOKEN;
  if (!expected) return null;
  if (query['hub.mode'] !== 'subscribe') return null;
  if (typeof query['hub.verify_token'] !== 'string' || !safeEqual(query['hub.verify_token'], expected)) return null;
  const challenge = query['hub.challenge'];
  return typeof challenge === 'string' ? challenge : null;
}

// Valida X-Hub-Signature-256 (HMAC-SHA256 del cuerpo sin procesar con el App Secret).
function isValidSignature(rawBody, header) {
  const secret = process.env.WHATSAPP_APP_SECRET;
  if (!secret || !rawBody || typeof header !== 'string') return false;
  const expected = `sha256=${crypto.createHmac('sha256', secret).update(rawBody).digest('hex')}`;
  return safeEqual(header, expected);
}

// Extrae los mensajes entrantes del payload: [{ id, from, type, text, phoneNumberId }].
// Los eventos de estado (entregado, leído...) no traen "messages" y se ignoran.
function extractMessages(payload) {
  const out = [];
  if (!payload || payload.object !== 'whatsapp_business_account' || !Array.isArray(payload.entry)) return out;
  for (const entry of payload.entry) {
    for (const change of (entry && entry.changes) || []) {
      const value = change && change.value;
      if (!value || !Array.isArray(value.messages)) continue;
      const phoneNumberId = value.metadata && value.metadata.phone_number_id;
      for (const m of value.messages) {
        if (!m || !m.id || !m.from) continue;
        out.push({
          id: String(m.id),
          from: String(m.from),
          type: m.type,
          text: m.type === 'text' && m.text && typeof m.text.body === 'string' ? m.text.body : null,
          phoneNumberId: phoneNumberId ? String(phoneNumberId) : null,
        });
      }
    }
  }
  return out;
}

function redact(text, token) {
  let out = String(text || '').replace(/\s+/g, ' ').slice(0, 300);
  if (token) out = out.split(token).join('[REDACTED]');
  return out;
}

// Envía un mensaje de texto. Lanza Error con un mensaje seguro (sin token) si falla.
async function sendText(phoneNumberId, to, body) {
  const token = process.env.WHATSAPP_ACCESS_TOKEN;
  if (!token) throw new Error('WHATSAPP_ACCESS_TOKEN no configurado');
  const version = process.env.WHATSAPP_GRAPH_VERSION || DEFAULT_GRAPH_VERSION;
  const url = `https://graph.facebook.com/${encodeURIComponent(version)}/${encodeURIComponent(phoneNumberId)}/messages`;

  let response;
  try {
    response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({
        messaging_product: 'whatsapp',
        to,
        type: 'text',
        text: { body: body.slice(0, 4000) },
      }),
      signal: AbortSignal.timeout(SEND_TIMEOUT_MS),
    });
  } catch (err) {
    throw new Error(`Graph API sin respuesta (${err && err.name === 'TimeoutError' ? 'TIMEOUT' : 'NETWORK'})`);
  }

  if (!response.ok) {
    let detail = '';
    try {
      const e = (await response.json()).error || {};
      detail = redact(`${e.type || ''} code=${e.code || ''} ${e.message || ''}`.trim(), token);
    } catch (err) {
      // cuerpo no JSON
    }
    throw new Error(`Graph API HTTP ${response.status} ${detail}`.trim());
  }
}

module.exports = { verifyChallenge, isValidSignature, extractMessages, sendText };

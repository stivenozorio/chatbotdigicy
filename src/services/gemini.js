'use strict';

// Cliente mínimo de la API REST oficial de Gemini (Google AI). Sin dependencias extra.
// La clave se lee solo de process.env.GEMINI_API_KEY y se envía en un header, nunca en la URL.

const API_BASE = 'https://generativelanguage.googleapis.com/v1beta';
const TIMEOUT_MS = 20000;

// Modelos preferidos, en orden. Se usan si GEMINI_MODEL no está definida; si el elegido
// responde 404 se consulta ListModels y se escoge el primero realmente disponible.
const PREFERRED_MODELS = [
  'gemini-2.5-flash',
  'gemini-flash-latest',
  'gemini-2.5-flash-lite',
  'gemini-flash-lite-latest',
  'gemini-2.0-flash',
];

const SYSTEM_INSTRUCTION = [
  'Eres el asistente comercial virtual de Digicyus AI, una plataforma de chatbots inteligentes para WhatsApp dirigida a negocios.',
  'Responde siempre en español, con un tono amable, claro y breve.',
  'No inventes precios, pedidos, disponibilidad, promociones ni información empresarial (horarios, direcciones, políticas, etc.).',
  'Si no tienes un dato, dilo con honestidad y ofrece derivar la consulta a una persona del negocio.',
].join(' ');

class GeminiError extends Error {
  constructor(code, status, detail, context) {
    super(code);
    this.name = 'GeminiError';
    this.code = code; // código interno seguro para registrar
    this.status = status; // HTTP status a devolver al cliente
    this.detail = detail || ''; // mensaje seguro y recortado del proveedor (para logs)
    this.context = context || ''; // operación que falló, p. ej. "generateContent model=x" (para logs)
  }
}

let resolvedModel = null; // modelo confirmado como disponible (caché en memoria)

function safeDetail(text, apiKey) {
  let out = String(text || '').replace(/\s+/g, ' ').slice(0, 300);
  if (apiKey) out = out.split(apiKey).join('[REDACTED]');
  return out;
}

async function request(path, apiKey, options, context) {
  try {
    return await fetch(`${API_BASE}/${path}`, {
      ...options,
      headers: { 'Content-Type': 'application/json', 'x-goog-api-key': apiKey },
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
  } catch (err) {
    throw new GeminiError(err && err.name === 'TimeoutError' ? 'TIMEOUT' : 'NETWORK', 504, '', context);
  }
}

// Convierte una respuesta HTTP no exitosa en GeminiError con el código HTTP y el mensaje de Google.
async function toError(response, apiKey, context) {
  let google = {};
  try {
    google = (await response.json()).error || {};
  } catch (err) {
    // cuerpo no JSON: se ignora
  }
  const s = response.status;
  const detail = safeDetail(`${google.status || ''} ${google.message || ''}`.trim(), apiKey);
  // 429: cuota; 5xx: falla de Google; 400/401/403/404: problema de configuración (clave o modelo).
  const status = s === 429 ? 429 : s >= 500 ? 502 : 503;
  return new GeminiError(`HTTP_${s}`, status, detail, context);
}

async function listUsableModels(apiKey) {
  const context = 'ListModels';
  const response = await request('models?pageSize=200', apiKey, { method: 'GET' }, context);
  if (!response.ok) throw await toError(response, apiKey, context);
  let data;
  try {
    data = await response.json();
  } catch (err) {
    throw new GeminiError('BAD_RESPONSE', 502, '', context);
  }
  return ((data && data.models) || [])
    .filter((m) => (m.supportedGenerationMethods || []).includes('generateContent'))
    .map((m) => String(m.name || '').replace(/^models\//, ''));
}

// Modelos disponibles en orden de preferencia: primero los preferidos, luego cualquier Flash estable
// (sin preview/exp/imagen/audio).
function candidateModels(available, exclude) {
  const preferred = PREFERRED_MODELS.filter((m) => available.includes(m));
  const otherFlash = available.filter((m) => /flash/.test(m)
    && !/(preview|exp|image|tts|live|audio|thinking)/.test(m) && !preferred.includes(m));
  return [...preferred, ...otherFlash].filter((m) => m !== exclude);
}

async function generate(model, message, apiKey) {
  const context = `generateContent model=${model}`;
  const response = await request(`models/${encodeURIComponent(model)}:generateContent`, apiKey, {
    method: 'POST',
    body: JSON.stringify({
      systemInstruction: { parts: [{ text: SYSTEM_INSTRUCTION }] },
      contents: [{ role: 'user', parts: [{ text: message }] }],
      generationConfig: { maxOutputTokens: 512, temperature: 0.4 },
    }),
  }, context);
  if (!response.ok) throw await toError(response, apiKey, context);

  let data;
  try {
    data = await response.json();
  } catch (err) {
    throw new GeminiError('BAD_RESPONSE', 502, '', context);
  }
  const parts = data && data.candidates && data.candidates[0] && data.candidates[0].content
    && data.candidates[0].content.parts;
  const text = Array.isArray(parts) ? parts.map((p) => p.text || '').join('').trim() : '';
  if (!text) {
    const reason = data && data.promptFeedback && data.promptFeedback.blockReason;
    throw new GeminiError('EMPTY_RESPONSE', 502, reason ? `blockReason=${safeDetail(reason, apiKey)}` : '', context);
  }
  return text;
}

async function generateReply(message) {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) throw new GeminiError('NOT_CONFIGURED', 503);

  const model = resolvedModel || process.env.GEMINI_MODEL || PREFERRED_MODELS[0];
  try {
    const text = await generate(model, message, apiKey);
    resolvedModel = model;
    return text;
  } catch (err) {
    if (!(err instanceof GeminiError) || err.code !== 'HTTP_404') throw err;
    resolvedModel = null;
    console.error(`Gemini: ${err.context} respondió ${err.code} ${err.detail}. Consultando modelos disponibles...`);
  }

  // El modelo no existe para esta clave/versión de API: se busca uno disponible y se prueba (máx. 3).
  const available = await listUsableModels(apiKey);
  const candidates = candidateModels(available, model).slice(0, 3);
  for (const candidate of candidates) {
    try {
      const text = await generate(candidate, message, apiKey);
      resolvedModel = candidate;
      console.error(`Gemini: usando el modelo "${candidate}". Define GEMINI_MODEL=${candidate} para fijarlo.`);
      return text;
    } catch (err) {
      if (!(err instanceof GeminiError) || err.code !== 'HTTP_404') throw err;
      console.error(`Gemini: ${err.context} respondió ${err.code} ${err.detail}.`);
    }
  }
  console.error(`Gemini: ningún modelo utilizable. Disponibles con generateContent: ${available.slice(0, 20).join(', ') || '(ninguno)'}`);
  throw new GeminiError('NO_MODEL_AVAILABLE', 503, '', 'selección de modelo');
}

function resetForTests() {
  resolvedModel = null;
}

module.exports = { generateReply, GeminiError, SYSTEM_INSTRUCTION, PREFERRED_MODELS, resetForTests };

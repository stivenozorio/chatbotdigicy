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
  constructor(code, status, detail) {
    super(code);
    this.name = 'GeminiError';
    this.code = code; // código interno seguro para registrar
    this.status = status; // HTTP status a devolver al cliente
    this.detail = detail || ''; // mensaje seguro y recortado del proveedor (para logs)
  }
}

let resolvedModel = null; // modelo confirmado como disponible (caché en memoria)

function safeDetail(text, apiKey) {
  let out = String(text || '').replace(/\s+/g, ' ').slice(0, 300);
  if (apiKey) out = out.split(apiKey).join('[REDACTED]');
  return out;
}

async function request(path, apiKey, options) {
  try {
    return await fetch(`${API_BASE}/${path}`, {
      ...options,
      headers: { 'Content-Type': 'application/json', 'x-goog-api-key': apiKey },
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
  } catch (err) {
    throw new GeminiError(err && err.name === 'TimeoutError' ? 'TIMEOUT' : 'NETWORK', 504);
  }
}

// Convierte una respuesta HTTP no exitosa en GeminiError con el código HTTP y el mensaje de Google.
async function toError(response, apiKey) {
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
  return new GeminiError(`HTTP_${s}`, status, detail);
}

async function listUsableModels(apiKey) {
  const response = await request('models?pageSize=200', apiKey, { method: 'GET' });
  if (!response.ok) throw await toError(response, apiKey);
  const data = await response.json();
  return (data.models || [])
    .filter((m) => (m.supportedGenerationMethods || []).includes('generateContent'))
    .map((m) => String(m.name || '').replace(/^models\//, ''));
}

function pickModel(available) {
  const preferred = PREFERRED_MODELS.find((m) => available.includes(m));
  if (preferred) return preferred;
  // Último recurso: cualquier Flash estable (sin preview/exp/imagen/audio).
  return available.find((m) => /flash/.test(m) && !/(preview|exp|image|tts|live|audio|thinking)/.test(m)) || null;
}

async function generate(model, message, apiKey) {
  const response = await request(`models/${encodeURIComponent(model)}:generateContent`, apiKey, {
    method: 'POST',
    body: JSON.stringify({
      systemInstruction: { parts: [{ text: SYSTEM_INSTRUCTION }] },
      contents: [{ role: 'user', parts: [{ text: message }] }],
      generationConfig: { maxOutputTokens: 512, temperature: 0.4 },
    }),
  });
  if (!response.ok) throw await toError(response, apiKey);

  let data;
  try {
    data = await response.json();
  } catch (err) {
    throw new GeminiError('BAD_RESPONSE', 502);
  }
  const parts = data && data.candidates && data.candidates[0] && data.candidates[0].content
    && data.candidates[0].content.parts;
  const text = Array.isArray(parts) ? parts.map((p) => p.text || '').join('').trim() : '';
  if (!text) {
    const reason = data && data.promptFeedback && data.promptFeedback.blockReason;
    throw new GeminiError('EMPTY_RESPONSE', 502, reason ? `blockReason=${safeDetail(reason, apiKey)}` : '');
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

    // El modelo no existe para esta clave/versión de API: se busca uno disponible y se reintenta una vez.
    resolvedModel = null;
    console.error(`Gemini: modelo "${model}" no disponible (${err.code} ${err.detail}). Consultando modelos disponibles...`);
    const available = await listUsableModels(apiKey);
    const alternative = pickModel(available);
    if (!alternative || alternative === model) {
      console.error(`Gemini: ningún modelo utilizable. Disponibles con generateContent: ${available.slice(0, 20).join(', ') || '(ninguno)'}`);
      throw new GeminiError('NO_MODEL_AVAILABLE', 503);
    }
    console.error(`Gemini: usando el modelo "${alternative}". Define GEMINI_MODEL=${alternative} para fijarlo.`);
    const text = await generate(alternative, message, apiKey);
    resolvedModel = alternative;
    return text;
  }
}

module.exports = { generateReply, GeminiError, SYSTEM_INSTRUCTION, PREFERRED_MODELS };

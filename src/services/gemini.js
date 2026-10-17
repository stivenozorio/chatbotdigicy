'use strict';

// Cliente mínimo de la Interactions API de Gemini (POST /v1beta/interactions). Sin dependencias extra.
// La clave se lee solo de process.env.GEMINI_API_KEY y se envía en el header x-goog-api-key, nunca en la URL.
// Formato verificado contra los tipos del SDK oficial @google/genai 2.30.0.

const INTERACTIONS_URL = 'https://generativelanguage.googleapis.com/v1beta/interactions';
const DEFAULT_MODEL = 'gemini-3.5-flash-lite'; // el plan gratuito da 15 RPM / 500 RPD (los Flash, 5 RPM / 20 RPD)
const TIMEOUT_MS = 25000; // límite de la única llamada a Google; no hay reintentos ni búsqueda de modelos

const SYSTEM_INSTRUCTION = [
  'Eres el asistente comercial virtual de Digicy SI, una plataforma de chatbots inteligentes para WhatsApp dirigida a negocios.',
  'Responde siempre en español, con un tono amable, claro y breve.',
  'No inventes precios, pedidos, disponibilidad, promociones ni información empresarial (horarios, direcciones, políticas, etc.).',
  'Si no tienes un dato, dilo con honestidad y ofrece derivar la consulta a una persona del negocio.',
].join(' ');

class GeminiError extends Error {
  constructor(code, status, detail, context) {
    super(code);
    this.name = 'GeminiError';
    this.code = code; // código interno seguro para registrar (p. ej. HTTP_404, TIMEOUT)
    // HTTP status a devolver al cliente. Solo 429 o 503: Cloudflare sustituye el cuerpo de los 502/504 que
    // genera el origen por su propia página, y el usuario perdería el mensaje JSON de la aplicación.
    this.status = status;
    this.detail = detail || ''; // mensaje seguro y recortado del proveedor (para logs)
    this.context = context || ''; // operación que falló, p. ej. "interactions model=x" (para logs)
  }
}

function safeDetail(text, apiKey) {
  let out = String(text || '').replace(/\s+/g, ' ').slice(0, 300);
  if (apiKey) out = out.split(apiKey).join('[REDACTED]');
  return out;
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
  // 429: cuota; cualquier otro fallo de Google se devuelve como 503 (ver nota en GeminiError).
  const status = s === 429 ? 429 : 503;
  return new GeminiError(`HTTP_${s}`, status, detail, context);
}

// Texto de la respuesta: pasos "model_output" con contenido de tipo "text" (formato actual);
// si no hay pasos, se acepta el formato anterior con "outputs".
function extractText(data) {
  const blocks = [];
  if (Array.isArray(data.steps)) {
    for (const step of data.steps) {
      if (step && step.type === 'model_output' && Array.isArray(step.content)) blocks.push(...step.content);
    }
  } else if (Array.isArray(data.outputs)) {
    blocks.push(...data.outputs);
  }
  return blocks
    .filter((b) => b && b.type === 'text' && typeof b.text === 'string')
    .map((b) => b.text)
    .join('')
    .trim();
}

async function callGemini(message, apiKey) {

  const model = process.env.GEMINI_MODEL || DEFAULT_MODEL;
  const context = `interactions model=${model}`;

  const generationConfig = { max_output_tokens: 1024 };
  if (process.env.GEMINI_THINKING_LEVEL) generationConfig.thinking_level = process.env.GEMINI_THINKING_LEVEL;

  const startedAt = Date.now();
  const elapsed = () => `${Date.now() - startedAt} ms`;

  let response;
  try {
    response = await fetch(INTERACTIONS_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-goog-api-key': apiKey },
      body: JSON.stringify({
        model,
        input: message,
        system_instruction: SYSTEM_INSTRUCTION,
        generation_config: generationConfig,
        store: false, // no guardar la conversación en Google
      }),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
  } catch (err) {
    const timedOut = err && (err.name === 'TimeoutError' || err.name === 'AbortError');
    // Para NETWORK se registra el código del error de red (p. ej. ENOTFOUND), nunca la URL ni cabeceras.
    const cause = err && err.cause && err.cause.code ? ` ${err.cause.code}` : '';
    throw new GeminiError(timedOut ? 'TIMEOUT' : 'NETWORK', 503, `sin respuesta de Google tras ${elapsed()}${cause}`, context);
  }

  if (!response.ok) throw await toError(response, apiKey, context);

  let data;
  try {
    data = await response.json();
  } catch (err) {
    // Incluye el caso de que el cuerpo se corte por el timeout.
    const timedOut = err && (err.name === 'TimeoutError' || err.name === 'AbortError');
    throw new GeminiError(timedOut ? 'TIMEOUT' : 'BAD_RESPONSE', 503, timedOut ? `cuerpo incompleto tras ${elapsed()}` : '', context);
  }

  const text = extractText(data || {});
  if (!text) {
    // Se registra solo la estructura (nombres de campos y tipos de paso), nunca el contenido.
    const keys = data && typeof data === 'object' ? Object.keys(data).join(',') : typeof data;
    const types = data && Array.isArray(data.steps) ? data.steps.map((st) => (st && st.type) || '?').join(',') : '';
    const status = data && data.status ? ` status=${safeDetail(data.status, apiKey)}` : '';
    throw new GeminiError('EMPTY_RESPONSE', 503, `sin texto; campos=${keys}; pasos=${types}${status}`, context);
  }
  if (Date.now() - startedAt > 5000) console.error(`Gemini: respuesta lenta (${elapsed()}) [${context}]`);
  return text;
}

const RETRY_DELAY_MS = 800;
const RETRYABLE = new Set(['HTTP_500', 'HTTP_503']);

// Un único reintento cuando Google responde 500/503 (suelen ser picos de demanda y devuelven rápido).
// No se reintenta ante timeout ni 429, para no alargar la espera ni gastar más cuota.
async function generateReply(message) {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) throw new GeminiError('NOT_CONFIGURED', 503);
  try {
    return await callGemini(message, apiKey);
  } catch (err) {
    if (!(err instanceof GeminiError) || !RETRYABLE.has(err.code)) throw err;
    console.error(`Gemini: ${err.context} respondió ${err.code} ${err.detail}. Reintentando una vez...`);
    await new Promise((resolve) => setTimeout(resolve, RETRY_DELAY_MS));
    return callGemini(message, apiKey);
  }
}

module.exports = { generateReply, GeminiError, SYSTEM_INSTRUCTION, INTERACTIONS_URL, DEFAULT_MODEL, TIMEOUT_MS };

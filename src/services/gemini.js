'use strict';

// Cliente mínimo de la API REST oficial de Gemini (Google AI). Sin dependencias extra.
// La clave se lee solo de process.env.GEMINI_API_KEY y se envía en un header, nunca en la URL.

const API_BASE = 'https://generativelanguage.googleapis.com/v1beta/models';
const DEFAULT_MODEL = 'gemini-2.5-flash';
const TIMEOUT_MS = 20000;

const SYSTEM_INSTRUCTION = [
  'Eres el asistente comercial virtual de Digicyus AI, una plataforma de chatbots inteligentes para WhatsApp dirigida a negocios.',
  'Responde siempre en español, con un tono amable, claro y breve.',
  'No inventes precios, pedidos, disponibilidad, promociones ni información empresarial (horarios, direcciones, políticas, etc.).',
  'Si no tienes un dato, dilo con honestidad y ofrece derivar la consulta a una persona del negocio.',
].join(' ');

class GeminiError extends Error {
  constructor(code, status) {
    super(code);
    this.name = 'GeminiError';
    this.code = code; // código interno seguro para registrar
    this.status = status; // HTTP status a devolver al cliente
  }
}

async function generateReply(message) {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) throw new GeminiError('NOT_CONFIGURED', 503);

  const model = process.env.GEMINI_MODEL || DEFAULT_MODEL;
  let response;
  try {
    response = await fetch(`${API_BASE}/${encodeURIComponent(model)}:generateContent`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-goog-api-key': apiKey },
      body: JSON.stringify({
        systemInstruction: { parts: [{ text: SYSTEM_INSTRUCTION }] },
        contents: [{ role: 'user', parts: [{ text: message }] }],
        generationConfig: { maxOutputTokens: 512, temperature: 0.4 },
      }),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
  } catch (err) {
    throw new GeminiError(err && err.name === 'TimeoutError' ? 'TIMEOUT' : 'NETWORK', 504);
  }

  if (!response.ok) {
    // 429: cuota agotada; el resto se trata como fallo del proveedor.
    throw new GeminiError(`HTTP_${response.status}`, response.status === 429 ? 429 : 502);
  }

  let data;
  try {
    data = await response.json();
  } catch (err) {
    throw new GeminiError('BAD_RESPONSE', 502);
  }

  const parts = data && data.candidates && data.candidates[0] && data.candidates[0].content
    && data.candidates[0].content.parts;
  const text = Array.isArray(parts) ? parts.map((p) => p.text || '').join('').trim() : '';
  if (!text) throw new GeminiError('EMPTY_RESPONSE', 502);
  return text;
}

module.exports = { generateReply, GeminiError, SYSTEM_INSTRUCTION };

'use strict';

const { generateReply, GeminiError } = require('../services/gemini');

const MAX_MESSAGE_LENGTH = 1000;

const QUOTA_MESSAGE = 'La IA alcanzó su límite de uso (por minuto o por día). Espera un minuto e intenta de nuevo; si persiste, vuelve más tarde.';
const CONFIG_CODES = new Set(['NOT_CONFIGURED', 'HTTP_400', 'HTTP_401', 'HTTP_403', 'HTTP_404']);

// Mensaje genérico para el usuario según el tipo de fallo (nunca detalles del proveedor).
function publicMessage(err) {
  if (!(err instanceof GeminiError)) return 'Error interno del servidor';
  if (err.code === 'HTTP_429') return QUOTA_MESSAGE;
  if (err.code === 'TIMEOUT') return 'La IA tardó demasiado en responder. Intenta de nuevo.';
  if (CONFIG_CODES.has(err.code)) return 'El servicio de IA no está disponible.';
  return 'No se pudo obtener respuesta de la IA. Intenta de nuevo.';
}

exports.test = async (req, res) => {
  const message = req.body && req.body.message;

  if (typeof message !== 'string' || message.trim() === '') {
    return res.status(400).json({ error: 'El campo "message" es obligatorio y debe ser texto.' });
  }
  if (message.length > MAX_MESSAGE_LENGTH) {
    return res.status(400).json({ error: `El campo "message" no puede superar ${MAX_MESSAGE_LENGTH} caracteres.` });
  }

  try {
    const reply = await generateReply(message.trim());
    res.json({ reply });
  } catch (err) {
    const status = err instanceof GeminiError ? err.status : 500;
    // Se registra el código interno (p. ej. HTTP_404) y el mensaje recortado de Gemini; nunca la clave.
    if (err instanceof GeminiError) {
      const where = err.context ? ` [${err.context}]` : '';
      const detail = err.detail ? ` - ${err.detail}` : '';
      console.error(`Fallo en /api/ai/test: ${err.code}${where}${detail}`);
    } else {
      console.error('Fallo en /api/ai/test: ERROR_DESCONOCIDO', err && err.name);
    }
    res.status(status).json({ error: publicMessage(err) });
  }
};

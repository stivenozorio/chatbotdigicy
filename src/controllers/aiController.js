'use strict';

const { generateReply, GeminiError } = require('../services/gemini');

const MAX_MESSAGE_LENGTH = 1000;

const PUBLIC_ERRORS = {
  429: 'La IA alcanzó su límite de uso (por minuto o por día). Espera un minuto e intenta de nuevo; si persiste, vuelve más tarde.',
  502: 'No se pudo obtener respuesta de la IA.',
  503: 'El servicio de IA no está disponible.',
  504: 'La IA tardó demasiado en responder.',
};

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
    res.status(status).json({ error: PUBLIC_ERRORS[status] || 'Error interno del servidor' });
  }
};

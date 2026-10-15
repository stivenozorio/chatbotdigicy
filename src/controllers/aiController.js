'use strict';

const { generateReply, GeminiError } = require('../services/gemini');

const MAX_MESSAGE_LENGTH = 1000;

const PUBLIC_ERRORS = {
  429: 'Se alcanzó el límite de uso de la IA. Intenta de nuevo más tarde.',
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
    // Solo se registra un código interno; nunca el mensaje completo, headers ni la clave.
    console.error('Fallo en /api/ai/test:', err instanceof GeminiError ? err.code : 'ERROR_DESCONOCIDO');
    res.status(status).json({ error: PUBLIC_ERRORS[status] || 'Error interno del servidor' });
  }
};

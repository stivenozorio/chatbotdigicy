'use strict';

// Límite global en memoria (ventana fija de 1 minuto) para proteger la cuota de la IA.
// Es global y no por IP porque detrás de Cloudflare/GoDaddy la IP del cliente no es fiable sin configurar el proxy.
const WINDOW_MS = 60 * 1000;
let windowStart = 0;
let count = 0;

function aiRateLimit(req, res, next) {
  const max = Number(process.env.AI_RATE_LIMIT_PER_MIN) || 20;
  const now = Date.now();
  if (now - windowStart >= WINDOW_MS) {
    windowStart = now;
    count = 0;
  }
  count += 1;
  if (count > max) {
    res.set('Retry-After', String(Math.ceil((windowStart + WINDOW_MS - now) / 1000)));
    return res.status(429).json({ error: 'Demasiadas solicitudes. Intenta de nuevo en un minuto.' });
  }
  return next();
}

aiRateLimit.reset = () => {
  windowStart = 0;
  count = 0;
};

module.exports = aiRateLimit;

'use strict';

// Mismo patrón que aiRateLimit, pero con su propia ventana: este endpoint
// solo lo consulta el panel de administración (no es público como el chat),
// así que el límite es más alto y existe sobre todo para evitar un bucle
// de refrescos accidental, no para proteger una cuota de IA.
const WINDOW_MS = 60 * 1000;
let windowStart = 0;
let count = 0;

function analyticsRateLimit(req, res, next) {
  const max = Number(process.env.ANALYTICS_RATE_LIMIT_PER_MIN) || 30;
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

analyticsRateLimit.reset = () => {
  windowStart = 0;
  count = 0;
};

module.exports = analyticsRateLimit;

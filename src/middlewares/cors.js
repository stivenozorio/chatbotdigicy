'use strict';

// Permite que digicyus.com llame a esta API desde el navegador (el
// Assistant flotante del sitio usa POST /api/ai/test). Sin esto, el
// navegador bloquea la respuesta por CORS aunque el servidor sí procese
// la solicitud. Sin dependencia nueva (el paquete "cors" no está en
// package.json y este repo solo tiene dotenv/express/mysql2) -- una
// allowlist fija es suficiente para los pocos orígenes que de verdad
// necesitan llamar a esta API.
const ALLOWED_ORIGINS = new Set([
  'https://digicyus.com',
  'https://www.digicyus.com',
]);

function cors(req, res, next) {
  const origin = req.headers.origin;
  if (origin && ALLOWED_ORIGINS.has(origin)) {
    res.setHeader('Access-Control-Allow-Origin', origin);
    res.setHeader('Vary', 'Origin');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  }
  if (req.method === 'OPTIONS') {
    return res.sendStatus(204);
  }
  return next();
}

module.exports = cors;

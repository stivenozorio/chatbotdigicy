'use strict';

// Cliente mínimo de la Google Analytics Data API (GA4), autenticado como
// cuenta de servicio. Sin dependencias extra (googleapis / google-auth-
// library no están en package.json y este repo solo tiene dotenv, express
// y mysql2): el flujo JWT bearer de Google es HTTP plano, firmado con el
// módulo crypto nativo de Node -- no hace falta más.
//
// Credenciales: GA_CLIENT_EMAIL y GA_PRIVATE_KEY vienen del archivo JSON
// de la cuenta de servicio (nunca se sube al repositorio; se configuran
// en el panel de GoDaddy). GA_PROPERTY_ID es el ID numérico de la
// propiedad de Analytics (Admin -> Property details) -- no es secreto,
// así que va fijo aquí en vez de como variable de entorno más.

const TOKEN_URL = 'https://oauth2.googleapis.com/token';
const DATA_API_URL = 'https://analyticsdata.googleapis.com/v1beta';
const SCOPE = 'https://www.googleapis.com/auth/analytics.readonly';
const PROPERTY_ID = '562241157';
const TIMEOUT_MS = 15000;

class AnalyticsError extends Error {
  constructor(code, status, detail) {
    super(code);
    this.name = 'AnalyticsError';
    this.code = code;
    this.status = status;
    this.detail = detail || '';
  }
}

function base64url(input) {
  return Buffer.from(input)
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
}

function signJwt(clientEmail, privateKey) {
  const crypto = require('crypto');
  const now = Math.floor(Date.now() / 1000);
  const header = base64url(JSON.stringify({ alg: 'RS256', typ: 'JWT' }));
  const claims = base64url(JSON.stringify({
    iss: clientEmail,
    scope: SCOPE,
    aud: TOKEN_URL,
    iat: now,
    exp: now + 3600,
  }));
  const signingInput = `${header}.${claims}`;
  const signature = crypto
    .createSign('RSA-SHA256')
    .update(signingInput)
    .sign(privateKey)
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
  return `${signingInput}.${signature}`;
}

// En memoria, por proceso -- un token dura 1 hora, así que para el tráfico
// esperado de este endpoint no hace falta nada más elaborado.
let cachedToken = null;
let cachedTokenExpiresAt = 0;
// La solicitud en curso, si hay una -- el summary endpoint pide dos
// reportes en paralelo (Promise.all), y sin esto cada uno vería el caché
// todavía vacío y pediría su propio token, duplicando la llamada a Google.
let pendingTokenRequest = null;

async function fetchNewToken(clientEmail, privateKey) {
  const assertion = signJwt(clientEmail, privateKey);
  let response;
  try {
    response = await fetch(TOKEN_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
        assertion,
      }),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
  } catch (err) {
    const timedOut = err && (err.name === 'TimeoutError' || err.name === 'AbortError');
    throw new AnalyticsError(timedOut ? 'TIMEOUT' : 'NETWORK', 503, 'fallo al pedir el token');
  }

  if (!response.ok) {
    const body = await response.text().catch(() => '');
    throw new AnalyticsError(`TOKEN_HTTP_${response.status}`, 503, body.slice(0, 300));
  }

  const data = await response.json();
  if (!data.access_token) throw new AnalyticsError('TOKEN_EMPTY', 503, '');

  cachedToken = data.access_token;
  cachedTokenExpiresAt = Date.now() + (Number(data.expires_in || 3600) - 300) * 1000;
  return cachedToken;
}

async function getAccessToken() {
  const clientEmail = process.env.GA_CLIENT_EMAIL;
  const rawKey = process.env.GA_PRIVATE_KEY;
  if (!clientEmail || !rawKey) throw new AnalyticsError('NOT_CONFIGURED', 503);
  // El panel de GoDaddy guarda la clave en una sola línea; el JSON original
  // trae saltos de línea reales dentro del string, representados como
  // "\n" -- hay que devolverlos antes de firmar o la clave no es válida.
  const privateKey = rawKey.replace(/\\n/g, '\n');

  if (cachedToken && Date.now() < cachedTokenExpiresAt) return cachedToken;

  if (!pendingTokenRequest) {
    pendingTokenRequest = fetchNewToken(clientEmail, privateKey).finally(() => {
      pendingTokenRequest = null;
    });
  }
  return pendingTokenRequest;
}

async function runReport(requestBody) {
  const token = await getAccessToken();
  let response;
  try {
    response = await fetch(`${DATA_API_URL}/properties/${PROPERTY_ID}:runReport`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify(requestBody),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
  } catch (err) {
    const timedOut = err && (err.name === 'TimeoutError' || err.name === 'AbortError');
    throw new AnalyticsError(timedOut ? 'TIMEOUT' : 'NETWORK', 503, 'fallo al consultar la API');
  }

  if (!response.ok) {
    const body = await response.text().catch(() => '');
    // 401/403 normalmente es que la cuenta de servicio no tiene acceso
    // todavía en Property Access Management -- se registra para depurar.
    throw new AnalyticsError(`REPORT_HTTP_${response.status}`, 503, body.slice(0, 300));
  }

  return response.json();
}

// Para pruebas: fuerza a pedir un token nuevo en la siguiente llamada,
// igual que .reset() en los middlewares de límite de solicitudes.
function resetTokenCache() {
  cachedToken = null;
  cachedTokenExpiresAt = 0;
  pendingTokenRequest = null;
}

module.exports = { runReport, AnalyticsError, PROPERTY_ID, resetTokenCache };

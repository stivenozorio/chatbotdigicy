'use strict';

// Pruebas de /api/ai/test con la Interactions API de Gemini simulada (se intercepta fetch; no hay red real).
const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');

const app = require('../src/app');
const aiRateLimit = require('../src/middlewares/rateLimit');
const { INTERACTIONS_URL, DEFAULT_MODEL, SYSTEM_INSTRUCTION } = require('../src/services/gemini');

const KEY = 'TEST-KEY-do-not-leak-123';

const json = (status, body) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
const interaction = (text) => json(200, {
  id: 'int_1',
  status: 'completed',
  steps: [
    { type: 'user_input', content: [{ type: 'text', text: 'Hola' }] },
    { type: 'thought', summary: 'pensando' },
    { type: 'model_output', content: [{ type: 'text', text }] },
  ],
});
const googleError = (status, code, message) => json(status, { error: { code: status, status: code, message } });

const realFetch = global.fetch;
let server; let url; let calls; let logs; let handler;

test.before(async () => {
  server = http.createServer(app).listen(0);
  await new Promise((r) => server.once('listening', r));
  url = `http://127.0.0.1:${server.address().port}`;
  // Solo se simulan las llamadas a Google; las locales pasan al fetch real.
  global.fetch = async (u, opts = {}) => {
    const target = String(u);
    if (!target.startsWith('https://generativelanguage.googleapis.com')) return realFetch(u, opts);
    calls.push({ method: opts.method || 'GET', url: target, headers: opts.headers || {}, body: opts.body ? JSON.parse(opts.body) : null, signal: opts.signal });
    return handler(target, opts);
  };
});

test.after(() => {
  global.fetch = realFetch;
  server.close();
});

test.beforeEach(() => {
  process.env.GEMINI_API_KEY = KEY;
  delete process.env.GEMINI_MODEL;
  delete process.env.GEMINI_THINKING_LEVEL;
  process.env.AI_RATE_LIMIT_PER_MIN = '1000';
  aiRateLimit.reset();
  calls = [];
  logs = [];
  console.error = (...a) => logs.push(a.join(' '));
});

const post = (body) => realFetch(`${url}/api/ai/test`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: typeof body === 'string' ? body : JSON.stringify(body),
});

function assertNoKeyLeak(responseText = '') {
  assert.ok(!responseText.includes(KEY), 'la clave no debe aparecer en la respuesta');
  assert.ok(!logs.join('\n').includes(KEY), 'la clave no debe aparecer en los logs');
  assert.ok(calls.every((c) => !c.url.includes(KEY)), 'la clave no debe ir en la URL');
}

test('respuesta exitosa: URL, cuerpo y autenticación de la Interactions API', async () => {
  handler = () => interaction('Hola, soy el asistente');
  const res = await post({ message: '  ¿Qué hacen?  ' });
  assert.equal(res.status, 200);
  assert.deepEqual(await res.json(), { reply: 'Hola, soy el asistente' });

  assert.equal(calls.length, 1, 'una sola llamada a Google');
  assert.equal(calls[0].method, 'POST');
  assert.equal(calls[0].url, 'https://generativelanguage.googleapis.com/v1beta/interactions');
  assert.equal(calls[0].url, INTERACTIONS_URL);
  assert.equal(calls[0].headers['x-goog-api-key'], KEY);
  assert.deepEqual(calls[0].body, {
    model: 'gemini-3.5-flash',
    input: '¿Qué hacen?',
    system_instruction: SYSTEM_INSTRUCTION,
    generation_config: { max_output_tokens: 1024 },
    store: false,
  });
  assert.equal(DEFAULT_MODEL, 'gemini-3.5-flash');
  assert.ok(calls[0].signal, 'la llamada lleva un timeout');
  assertNoKeyLeak();
});

test('une varios bloques de texto, ignora pensamientos y acepta el formato "outputs"', async () => {
  handler = () => json(200, { steps: [
    { type: 'thought', summary: 'x' },
    { type: 'model_output', content: [{ type: 'text', text: 'Hola ' }, { type: 'text', text: 'mundo' }] },
  ] });
  assert.deepEqual(await (await post({ message: 'a' })).json(), { reply: 'Hola mundo' });

  handler = () => json(200, { outputs: [{ type: 'text', text: 'Formato anterior' }] });
  assert.deepEqual(await (await post({ message: 'a' })).json(), { reply: 'Formato anterior' });
});

test('respuesta con la forma real devuelta por Google (capturada en pruebas con curl)', async () => {
  handler = () => json(200, {
    status: 'completed',
    usage: { total_tokens: 198, total_input_tokens: 2, total_output_tokens: 10, total_thought_tokens: 186 },
    created: '2026-10-16T20:22:45Z',
    updated: '2026-10-16T20:22:45Z',
    service_tier: 'standard',
    steps: [
      { signature: 'firma-recortada', type: 'thought' },
      { content: [{ text: '¡Hola! ¿En qué puedo ayudarte hoy?', type: 'text' }], type: 'model_output' },
    ],
    object: 'interaction',
    model: 'gemini-3.5-flash',
  });
  const res = await post({ message: 'Hola' });
  assert.equal(res.status, 200);
  assert.deepEqual(await res.json(), { reply: '¡Hola! ¿En qué puedo ayudarte hoy?' });
});

test('GEMINI_MODEL y GEMINI_THINKING_LEVEL se envían en el cuerpo', async () => {
  process.env.GEMINI_MODEL = 'gemini-3.5-flash-lite';
  process.env.GEMINI_THINKING_LEVEL = 'low';
  handler = () => interaction('ok');
  await post({ message: 'a' });
  assert.equal(calls[0].body.model, 'gemini-3.5-flash-lite');
  assert.equal(calls[0].body.generation_config.thinking_level, 'low');
});

test('404 (modelo no disponible): una sola llamada, sin buscar modelos, 503 JSON y log con el mensaje de Google', async () => {
  handler = () => googleError(404, 'NOT_FOUND', 'This model models/gemini-2.5-flash is no longer available to new users. Please update your code to use models/gemini-3.5-flash');
  const res = await post({ message: 'Hola' });
  const text = await res.text();
  assert.equal(res.status, 503);
  assert.deepEqual(JSON.parse(text), { error: 'El servicio de IA no está disponible.' });
  assert.equal(calls.length, 1, 'sin ListModels ni reintentos');
  assert.match(logs.join('\n'), /Fallo en \/api\/ai\/test: HTTP_404 \[interactions model=gemini-3\.5-flash\] - NOT_FOUND This model models\/gemini-2\.5-flash is no longer available/);
  assertNoKeyLeak(text);
});

test('429 (cuota): responde 429 JSON sin reintentar', async () => {
  handler = () => googleError(429, 'RESOURCE_EXHAUSTED', 'Quota exceeded for metric');
  const res = await post({ message: 'Hola' });
  const text = await res.text();
  assert.equal(res.status, 429);
  assert.deepEqual(JSON.parse(text), { error: 'Se alcanzó el límite de uso de la IA. Intenta de nuevo más tarde.' });
  assert.equal(calls.length, 1);
  assert.match(logs.join('\n'), /HTTP_429 .* - RESOURCE_EXHAUSTED Quota exceeded/);
  assertNoKeyLeak(text);
});

test('timeout: 504 JSON, una sola llamada y log con código TIMEOUT', async () => {
  handler = () => { throw new DOMException('The operation was aborted due to timeout', 'TimeoutError'); };
  const res = await post({ message: 'Hola' });
  const text = await res.text();
  assert.equal(res.status, 504);
  assert.deepEqual(JSON.parse(text), { error: 'La IA tardó demasiado en responder.' });
  assert.equal(calls.length, 1);
  assert.match(logs.join('\n'), /Fallo en \/api\/ai\/test: TIMEOUT \[interactions model=gemini-3\.5-flash\] - sin respuesta de Google tras \d+ ms/);
  assertNoKeyLeak(text);
});

test('otros errores de Google y respuestas inválidas devuelven JSON controlado', async () => {
  const cases = [
    [() => googleError(500, 'INTERNAL', 'boom'), 502],
    [() => googleError(400, 'INVALID_ARGUMENT', `API key not valid ${KEY}`), 503],
    [() => new Response('<html>no json</html>', { status: 403 }), 503],
    [() => { throw new TypeError('fetch failed'); }, 504],
    [() => new Response('no es json', { status: 200 }), 502],
    [() => json(200, { steps: [] }), 502],
    [() => json(200, null), 502],
  ];
  for (const [h, expected] of cases) {
    logs = [];
    handler = h;
    const res = await post({ message: 'Hola' });
    const text = await res.text();
    assert.equal(res.status, expected);
    assert.ok(typeof JSON.parse(text).error === 'string');
    assertNoKeyLeak(text);
  }
});

test('la clave que Google devuelva en un mensaje se censura en los logs', async () => {
  handler = () => googleError(400, 'INVALID_ARGUMENT', `API key not valid: ${KEY}`);
  await post({ message: 'Hola' });
  assert.match(logs.join('\n'), /HTTP_400 \[interactions model=gemini-3\.5-flash\] - INVALID_ARGUMENT API key not valid: \[REDACTED\]/);
  assertNoKeyLeak();
});

test('sin GEMINI_API_KEY responde 503 sin llamar a Google', async () => {
  delete process.env.GEMINI_API_KEY;
  handler = () => { throw new Error('no debe llamarse'); };
  const res = await post({ message: 'Hola' });
  assert.equal(res.status, 503);
  assert.equal(calls.length, 0);
});

test('validación de entrada y JSON inválido devuelven 400', async () => {
  handler = () => interaction('x');
  assert.equal((await post({})).status, 400);
  assert.equal((await post({ message: 5 })).status, 400);
  assert.equal((await post({ message: 'a'.repeat(1001) })).status, 400);
  assert.equal((await post('{malo')).status, 400);
  assert.equal(calls.length, 0);
});

test('rutas existentes siguen respondiendo', async () => {
  assert.equal((await realFetch(`${url}/`)).status, 200);
  const health = await realFetch(`${url}/health`);
  assert.equal(health.status, 200);
  assert.equal((await health.json()).status, 'ok');
});

test('límite de solicitudes: la solicitud N+1 recibe 429 JSON sin llamar a Google', async () => {
  process.env.AI_RATE_LIMIT_PER_MIN = '2';
  handler = () => interaction('ok');
  assert.equal((await post({ message: 'a' })).status, 200);
  assert.equal((await post({ message: 'b' })).status, 200);
  const res = await post({ message: 'c' });
  assert.equal(res.status, 429);
  assert.ok(res.headers.get('retry-after'));
  assert.ok(typeof (await res.json()).error === 'string');
  assert.equal(calls.length, 2);
});

test('frontend estático en /app/ y / conserva su mensaje', async () => {
  const page = await realFetch(`${url}/app/`);
  assert.equal(page.status, 200);
  assert.match(page.headers.get('content-type'), /text\/html/);
  assert.match(await page.text(), /Digicyus AI/);
  assert.equal((await realFetch(`${url}/app/app.js`)).status, 200);
  assert.equal((await realFetch(`${url}/app/styles.css`)).status, 200);
  assert.equal(await (await realFetch(`${url}/`)).text(), 'Digicyus AI está funcionando');
});

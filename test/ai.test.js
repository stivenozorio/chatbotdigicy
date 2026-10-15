'use strict';

// Pruebas de /api/ai/test con la API de Gemini simulada (se intercepta fetch; no hay red real).
const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');

const app = require('../src/app');
const gemini = require('../src/services/gemini');

const KEY = 'TEST-KEY-do-not-leak-123';
const BASE = 'https://generativelanguage.googleapis.com/v1beta';
const GEN = (m) => `${BASE}/models/${m}:generateContent`;
const LIST = `${BASE}/models?pageSize=200`;

const json = (status, body) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
const notFound = (msg) => json(404, { error: { code: 404, status: 'NOT_FOUND', message: msg } });
const ok = (text) => json(200, { candidates: [{ content: { parts: [{ text }] } }] });
const modelsList = (...names) => json(200, { models: names.map((name) => ({ name: `models/${name}`, supportedGenerationMethods: ['generateContent'] })) });

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
    calls.push({ method: opts.method || 'GET', url: target, headers: opts.headers || {} });
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
  gemini.resetForTests();
  calls = [];
  logs = [];
  console.error = (...a) => logs.push(a.join(' '));
});

const post = (body) => realFetch(`${url}/api/ai/test`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: typeof body === 'string' ? body : JSON.stringify(body),
});

function assertNoKeyLeak(responseText) {
  assert.ok(!responseText.includes(KEY), 'la clave no debe aparecer en la respuesta');
  assert.ok(!logs.join('\n').includes(KEY), 'la clave no debe aparecer en los logs');
  assert.ok(calls.every((c) => !c.url.includes(KEY)), 'la clave no debe ir en la URL');
}

test('usa las URLs correctas de Gemini y envía la clave solo en el header', async () => {
  handler = () => ok('Hola');
  const res = await post({ message: 'Hola' });
  assert.equal(res.status, 200);
  assert.deepEqual(await res.json(), { reply: 'Hola' });
  assert.equal(calls[0].method, 'POST');
  assert.equal(calls[0].url, GEN('gemini-2.5-flash'));
  assert.equal(calls[0].headers['x-goog-api-key'], KEY);
  assertNoKeyLeak('');
});

test('404 en generateContent: consulta ListModels y se recupera con otro modelo', async () => {
  handler = (u) => {
    if (u === GEN('gemini-2.5-flash')) return notFound('models/gemini-2.5-flash is not found for API version v1beta');
    if (u === LIST) return modelsList('gemini-flash-latest', 'embedding-001');
    if (u === GEN('gemini-flash-latest')) return ok('Respuesta alternativa');
    throw new Error(`URL inesperada ${u}`);
  };
  const res = await post({ message: 'Hola' });
  assert.equal(res.status, 200);
  assert.deepEqual(await res.json(), { reply: 'Respuesta alternativa' });
  assert.deepEqual(calls.map((c) => `${c.method} ${c.url}`), [
    `POST ${GEN('gemini-2.5-flash')}`,
    `GET ${LIST}`,
    `POST ${GEN('gemini-flash-latest')}`,
  ]);
  assert.match(logs.join('\n'), /generateContent model=gemini-2\.5-flash respondió HTTP_404 NOT_FOUND/);
  assertNoKeyLeak('');

  // Segunda petición: reutiliza el modelo confirmado, sin volver a consultar la lista.
  calls = [];
  const res2 = await post({ message: 'Otra' });
  assert.equal(res2.status, 200);
  assert.deepEqual(calls.map((c) => c.url), [GEN('gemini-flash-latest')]);
});

test('404 en generateContent y 404 en ListModels: JSON controlado 503, con código y detalle en el log', async () => {
  handler = (u) => (u === LIST
    ? notFound('Method not found for API version')
    : notFound('models/gemini-2.5-flash is not found'));
  const res = await post({ message: 'Hola' });
  const text = await res.text();
  assert.equal(res.status, 503);
  assert.deepEqual(JSON.parse(text), { error: 'El servicio de IA no está disponible.' });
  const out = logs.join('\n');
  assert.match(out, /Fallo en \/api\/ai\/test: HTTP_404 \[ListModels\] - NOT_FOUND Method not found/);
  assertNoKeyLeak(text);
});

test('404 en generateContent y ListModels sin modelos utilizables: 503 controlado', async () => {
  handler = (u) => (u === LIST ? modelsList('embedding-001') : notFound('models/x is not found'));
  const res = await post({ message: 'Hola' });
  assert.equal(res.status, 503);
  assert.match(logs.join('\n'), /NO_MODEL_AVAILABLE/);
  assert.match(logs.join('\n'), /embedding-001/);
  assertNoKeyLeak(await res.text());
});

test('prueba varios modelos candidatos si también dan 404', async () => {
  handler = (u) => {
    if (u === LIST) return modelsList('gemini-flash-latest', 'gemini-2.5-flash-lite');
    if (u === GEN('gemini-2.5-flash-lite')) return ok('Lite');
    return notFound('no existe');
  };
  const res = await post({ message: 'Hola' });
  assert.equal(res.status, 200);
  assert.deepEqual(await res.json(), { reply: 'Lite' });
});

test('GEMINI_MODEL inexistente también se recupera', async () => {
  process.env.GEMINI_MODEL = 'gemini-inexistente';
  handler = (u) => {
    if (u === GEN('gemini-inexistente')) return notFound('no existe');
    if (u === LIST) return modelsList('gemini-2.5-flash');
    return ok('Hola');
  };
  const res = await post({ message: 'Hola' });
  assert.equal(res.status, 200);
  assert.equal(calls[0].url, GEN('gemini-inexistente'));
  assert.equal(calls[2].url, GEN('gemini-2.5-flash'));
});

test('errores de Google se traducen a JSON controlado', async () => {
  const cases = [
    [() => json(429, { error: { status: 'RESOURCE_EXHAUSTED', message: 'quota' } }), 429],
    [() => json(500, { error: { status: 'INTERNAL', message: 'boom' } }), 502],
    [() => json(400, { error: { status: 'INVALID_ARGUMENT', message: `API key not valid ${KEY}` } }), 503],
    [() => new Response('<html>no json</html>', { status: 403 }), 503],
    [() => { throw new TypeError('fetch failed'); }, 504],
    [() => new Response('no es json', { status: 200 }), 502],
    [() => json(200, { candidates: [] }), 502],
  ];
  for (const [h, expected] of cases) {
    gemini.resetForTests();
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
  handler = () => json(400, { error: { status: 'INVALID_ARGUMENT', message: `API key not valid: ${KEY}` } });
  await post({ message: 'Hola' });
  assert.match(logs.join('\n'), /HTTP_400 \[generateContent model=gemini-2\.5-flash\] - INVALID_ARGUMENT API key not valid: \[REDACTED\]/);
  assertNoKeyLeak('');
});

test('sin GEMINI_API_KEY responde 503 sin llamar a Google', async () => {
  delete process.env.GEMINI_API_KEY;
  handler = () => { throw new Error('no debe llamarse'); };
  const res = await post({ message: 'Hola' });
  assert.equal(res.status, 503);
  assert.equal(calls.length, 0);
});

test('validación de entrada y JSON inválido devuelven 400', async () => {
  handler = () => ok('x');
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

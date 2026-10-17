'use strict';

// Pruebas del webhook de WhatsApp con Meta y Gemini simulados (se intercepta fetch; no hay red real).
const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const crypto = require('node:crypto');

const app = require('../src/app');

const VERIFY = 'verify-token-test';
const SECRET = 'app-secret-test';
const TOKEN = 'ACCESS-TOKEN-do-not-leak';
const GEMINI_KEY = 'GEMINI-KEY-do-not-leak';

const realFetch = global.fetch;
let server; let url; let calls; let logs; let seq = 0;
let geminiHandler; let graphHandler;

const json = (status, body) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
const geminiOk = (text) => json(200, { steps: [{ type: 'model_output', content: [{ type: 'text', text }] }] });

test.before(async () => {
  server = http.createServer(app).listen(0);
  await new Promise((r) => server.once('listening', r));
  url = `http://127.0.0.1:${server.address().port}`;
  global.fetch = async (u, opts = {}) => {
    const target = String(u);
    const body = opts.body ? JSON.parse(opts.body) : null;
    if (target.startsWith('https://generativelanguage.googleapis.com')) {
      calls.push({ api: 'gemini', url: target, body });
      return geminiHandler(body);
    }
    if (target.startsWith('https://graph.facebook.com')) {
      calls.push({ api: 'graph', url: target, headers: opts.headers, body });
      return graphHandler(body);
    }
    return realFetch(u, opts);
  };
});

test.after(() => {
  global.fetch = realFetch;
  server.close();
});

test.beforeEach(() => {
  process.env.WHATSAPP_VERIFY_TOKEN = VERIFY;
  process.env.WHATSAPP_APP_SECRET = SECRET;
  process.env.WHATSAPP_ACCESS_TOKEN = TOKEN;
  process.env.GEMINI_API_KEY = GEMINI_KEY;
  delete process.env.WHATSAPP_GRAPH_VERSION;
  calls = [];
  logs = [];
  console.error = (...a) => logs.push(a.join(' '));
  console.log = (...a) => logs.push(a.join(' '));
  geminiHandler = () => geminiOk('Respuesta de la IA');
  graphHandler = () => json(200, { messages: [{ id: 'wamid.out' }] });
});

const sign = (raw) => `sha256=${crypto.createHmac('sha256', SECRET).update(raw).digest('hex')}`;

function payload({ id, text = 'Hola', type = 'text', from = '573001112233', phoneNumberId = '555000111' } = {}) {
  seq += 1;
  const message = { from, id: id || `wamid.in.${seq}`, timestamp: '1760000000', type };
  if (type === 'text') message.text = { body: text };
  return {
    object: 'whatsapp_business_account',
    entry: [{ id: 'WABA', changes: [{ field: 'messages', value: {
      messaging_product: 'whatsapp',
      metadata: { display_phone_number: '15550001111', phone_number_id: phoneNumberId },
      contacts: [{ profile: { name: 'Cliente' }, wa_id: from }],
      messages: [message],
    } }] }],
  };
}

const postWebhook = (body, signature) => {
  const raw = typeof body === 'string' ? body : JSON.stringify(body);
  const headers = { 'Content-Type': 'application/json' };
  if (signature !== null) headers['X-Hub-Signature-256'] = signature === undefined ? sign(raw) : signature;
  return realFetch(`${url}/webhook`, { method: 'POST', headers, body: raw });
};

async function waitFor(cond) {
  for (let i = 0; i < 100; i += 1) {
    if (cond()) return;
    await new Promise((r) => setTimeout(r, 10));
  }
  throw new Error('condición no cumplida a tiempo');
}
const graphCalls = () => calls.filter((c) => c.api === 'graph');

function assertNoSecrets() {
  const all = logs.join('\n') + JSON.stringify(calls.map((c) => c.url));
  for (const s of [TOKEN, GEMINI_KEY, SECRET, VERIFY]) assert.ok(!all.includes(s), `no debe filtrarse ${s}`);
}

test('GET /webhook: verificación correcta devuelve el challenge', async () => {
  const res = await realFetch(`${url}/webhook?hub.mode=subscribe&hub.verify_token=${VERIFY}&hub.challenge=12345`);
  assert.equal(res.status, 200);
  assert.equal(await res.text(), '12345');
});

test('GET /webhook: token incorrecto, modo incorrecto o sin configurar devuelven 403', async () => {
  assert.equal((await realFetch(`${url}/webhook?hub.mode=subscribe&hub.verify_token=mal&hub.challenge=1`)).status, 403);
  assert.equal((await realFetch(`${url}/webhook?hub.mode=otro&hub.verify_token=${VERIFY}&hub.challenge=1`)).status, 403);
  assert.equal((await realFetch(`${url}/webhook`)).status, 403);
  delete process.env.WHATSAPP_VERIFY_TOKEN;
  assert.equal((await realFetch(`${url}/webhook?hub.mode=subscribe&hub.verify_token=&hub.challenge=1`)).status, 403);
});

test('POST /webhook: firma inválida o ausente devuelve 403 y no procesa nada', async () => {
  assert.equal((await postWebhook(payload(), 'sha256=00')).status, 403);
  assert.equal((await postWebhook(payload(), null)).status, 403);
  assert.equal((await postWebhook(payload(), sign('otro cuerpo'))).status, 403);
  await new Promise((r) => setTimeout(r, 30));
  assert.equal(calls.length, 0);
});

test('POST /webhook: sin WHATSAPP_APP_SECRET responde 503', async () => {
  delete process.env.WHATSAPP_APP_SECRET;
  assert.equal((await postWebhook(payload(), 'sha256=00')).status, 503);
  assert.equal(calls.length, 0);
});

test('mensaje de texto: responde 200 de inmediato, consulta a Gemini y envía la respuesta por Graph API', async () => {
  const res = await postWebhook(payload({ text: '¿Qué servicios tienen?', from: '573001112233', phoneNumberId: '555000111' }));
  assert.equal(res.status, 200);
  await waitFor(() => graphCalls().length === 1);

  const gemini = calls.find((c) => c.api === 'gemini');
  assert.equal(gemini.body.input, '¿Qué servicios tienen?');

  const g = graphCalls()[0];
  assert.equal(g.url, 'https://graph.facebook.com/v25.0/555000111/messages');
  assert.equal(g.headers.Authorization, `Bearer ${TOKEN}`);
  assert.deepEqual(g.body, {
    messaging_product: 'whatsapp',
    to: '573001112233',
    type: 'text',
    text: { body: 'Respuesta de la IA' },
  });
  assertNoSecrets();
  assert.ok(!logs.join('\n').includes('573001112233'), 'no se registra el número del cliente');
});

test('WHATSAPP_GRAPH_VERSION cambia la versión de la API de Meta', async () => {
  process.env.WHATSAPP_GRAPH_VERSION = 'v99.0';
  await postWebhook(payload());
  await waitFor(() => graphCalls().length === 1);
  assert.match(graphCalls()[0].url, /^https:\/\/graph\.facebook\.com\/v99\.0\//);
});

test('mensaje duplicado (reintento de Meta) se responde una sola vez', async () => {
  const body = payload({ id: 'wamid.dup' });
  assert.equal((await postWebhook(body)).status, 200);
  assert.equal((await postWebhook(body)).status, 200);
  await waitFor(() => graphCalls().length >= 1);
  await new Promise((r) => setTimeout(r, 50));
  assert.equal(graphCalls().length, 1);
});

test('mensaje que no es de texto recibe una respuesta fija sin llamar a Gemini', async () => {
  await postWebhook(payload({ type: 'image' }));
  await waitFor(() => graphCalls().length === 1);
  assert.equal(calls.filter((c) => c.api === 'gemini').length, 0);
  assert.match(graphCalls()[0].body.text.body, /solo puedo leer mensajes de texto/);
});

test('si Gemini falla, el cliente recibe un mensaje de disculpa y el log trae el motivo', async () => {
  geminiHandler = () => json(429, { error: { status: 'RESOURCE_EXHAUSTED', message: `cuota ${GEMINI_KEY}` } });
  await postWebhook(payload());
  await waitFor(() => graphCalls().length === 1);
  assert.match(graphCalls()[0].body.text.body, /no puedo responderte/);
  assert.match(logs.join('\n'), /Webhook: fallo de IA: HTTP_429 .*RESOURCE_EXHAUSTED cuota \[REDACTED\]/);
  assertNoSecrets();
});

test('si Meta rechaza el envío, se registra el error sin el token y el servidor sigue vivo', async () => {
  graphHandler = () => json(400, { error: { type: 'OAuthException', code: 190, message: `Token inválido ${TOKEN}` } });
  assert.equal((await postWebhook(payload())).status, 200);
  await waitFor(() => logs.some((l) => l.includes('fallo al responder')));
  assert.match(logs.join('\n'), /Graph API HTTP 400 OAuthException code=190 Token inválido \[REDACTED\]/);
  assertNoSecrets();
  assert.equal((await realFetch(`${url}/health`)).status, 200);
});

test('eventos de estado (sin mensajes) y payloads ajenos se aceptan sin responder', async () => {
  const status = { object: 'whatsapp_business_account', entry: [{ changes: [{ value: { statuses: [{ id: 'x', status: 'delivered' }] } }] }] };
  assert.equal((await postWebhook(status)).status, 200);
  assert.equal((await postWebhook({ object: 'otra_cosa' })).status, 200);
  await new Promise((r) => setTimeout(r, 30));
  assert.equal(calls.length, 0);
});

test('sin WHATSAPP_ACCESS_TOKEN no responde pero acepta el webhook', async () => {
  delete process.env.WHATSAPP_ACCESS_TOKEN;
  assert.equal((await postWebhook(payload())).status, 200);
  await new Promise((r) => setTimeout(r, 30));
  assert.equal(calls.length, 0);
  assert.match(logs.join('\n'), /no se responde/);
});

test('JSON inválido con firma correcta devuelve 400', async () => {
  const raw = '{malo';
  assert.equal((await postWebhook(raw, sign(raw))).status, 400);
});

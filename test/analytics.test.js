'use strict';

// Pruebas de /api/analytics/summary con el token OAuth y la Data API de
// Google Analytics simulados (se intercepta fetch; no hay red real).
const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const crypto = require('node:crypto');

const app = require('../src/app');
const analyticsRateLimit = require('../src/middlewares/analyticsRateLimit');
const { PROPERTY_ID, resetTokenCache } = require('../src/services/analyticsData');

// Clave de prueba real (generada aquí, nunca se sube a ningún lado) --
// crypto.createSign necesita una clave RSA valida para firmar el JWT.
const { privateKey } = crypto.generateKeyPairSync('rsa', {
  modulusLength: 2048,
  privateKeyEncoding: { type: 'pkcs1', format: 'pem' },
  publicKeyEncoding: { type: 'pkcs1', format: 'pem' },
});
const TEST_EMAIL = 'test-sa@estadisticasdigicy.iam.gserviceaccount.com';
const TEST_TOKEN = 'FAKE-ACCESS-TOKEN-do-not-leak';

const json = (status, body) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

const realFetch = global.fetch;
let server; let url; let tokenCalls; let reportCalls; let logs;
let tokenHandler; let reportHandler;

test.before(async () => {
  server = http.createServer(app).listen(0);
  await new Promise((r) => server.once('listening', r));
  url = `http://127.0.0.1:${server.address().port}`;
  global.fetch = async (u, opts = {}) => {
    const target = String(u);
    if (target.startsWith('https://oauth2.googleapis.com/token')) {
      tokenCalls.push({ method: opts.method, body: String(opts.body) });
      return tokenHandler(target, opts);
    }
    if (target.startsWith('https://analyticsdata.googleapis.com')) {
      const body = JSON.parse(opts.body);
      reportCalls.push({ method: opts.method, url: target, headers: opts.headers, body });
      return reportHandler(body);
    }
    return realFetch(u, opts);
  };
});

test.after(() => {
  global.fetch = realFetch;
  server.close();
});

test.beforeEach(() => {
  process.env.GA_CLIENT_EMAIL = TEST_EMAIL;
  process.env.GA_PRIVATE_KEY = privateKey;
  process.env.ANALYTICS_RATE_LIMIT_PER_MIN = '1000';
  analyticsRateLimit.reset();
  resetTokenCache();
  tokenCalls = [];
  reportCalls = [];
  logs = [];
  console.error = (...a) => logs.push(a.join(' '));
  tokenHandler = () => json(200, { access_token: TEST_TOKEN, expires_in: 3600 });
  reportHandler = (body) => {
    const dims = (body.dimensions || []).map((d) => d.name);
    if (dims.includes('customEvent:method')) {
      return json(200, {
        rows: [
          { dimensionValues: [{ value: 'whatsapp' }], metricValues: [{ value: '3' }] },
          { dimensionValues: [{ value: 'call' }], metricValues: [{ value: '1' }] },
        ],
      });
    }
    if (dims.includes('eventName')) {
      return json(200, {
        rows: [
          { dimensionValues: [{ value: 'page_view' }], metricValues: [{ value: '42' }] },
          { dimensionValues: [{ value: 'contact_click' }], metricValues: [{ value: '4' }] },
        ],
      });
    }
    return json(200, { rows: [{ metricValues: [{ value: '10' }, { value: '25' }, { value: '60' }] }] });
  };
});

const get = (qs = '') => realFetch(`${url}/api/analytics/summary${qs}`);

function assertNoKeyLeak(responseText = '') {
  assert.ok(!responseText.includes(TEST_TOKEN), 'el token no debe aparecer en la respuesta');
  assert.ok(!logs.join('\n').includes(TEST_TOKEN), 'el token no debe aparecer en los logs');
  assert.ok(!logs.join('\n').includes('BEGIN RSA PRIVATE KEY'), 'la clave privada no debe aparecer en los logs');
}

test('respuesta exitosa: totales y eventos con el formato esperado', async () => {
  const res = await get();
  assert.equal(res.status, 200);
  const data = await res.json();
  assert.deepEqual(data, {
    days: 7,
    totals: { activeUsers: 10, pageViews: 25, eventCount: 60 },
    events: [
      { name: 'page_view', count: 42 },
      { name: 'contact_click', count: 4 },
    ],
    contactByMethod: [
      { method: 'whatsapp', count: 3 },
      { method: 'call', count: 1 },
    ],
  });
  assertNoKeyLeak(JSON.stringify(data));
});

test('firma el JWT con scope de solo lectura y pide el property correcto', async () => {
  await get();
  assert.equal(tokenCalls.length, 1);
  assert.ok(String(tokenCalls[0].body).includes('grant_type=urn%3Aietf%3Aparams%3Aoauth%3Agrant-type%3Ajwt-bearer'));

  assert.equal(reportCalls.length, 3);
  for (const call of reportCalls) {
    assert.equal(call.headers.Authorization, `Bearer ${TEST_TOKEN}`);
    assert.ok(call.url.includes(`/properties/${PROPERTY_ID}:runReport`));
  }
});

test('reusa el token de acceso entre solicitudes (no pide uno nuevo cada vez)', async () => {
  await get();
  await get();
  assert.equal(tokenCalls.length, 1, 'un solo token para ambas solicitudes');
  assert.equal(reportCalls.length, 6);
});

test('?days= se usa en el rango de fechas, con limite de seguridad', async () => {
  await get('?days=30');
  assert.deepEqual(reportCalls[0].body.dateRanges, [{ startDate: '30daysAgo', endDate: 'today' }]);

  reportCalls = [];
  await get('?days=9999');
  assert.deepEqual(reportCalls[0].body.dateRanges, [{ startDate: '90daysAgo', endDate: 'today' }]);
});

test('sin credenciales configuradas responde 503 sin detalles', async () => {
  delete process.env.GA_CLIENT_EMAIL;
  delete process.env.GA_PRIVATE_KEY;
  const res = await get();
  assert.equal(res.status, 503);
  assert.deepEqual(await res.json(), { error: 'El servicio de estadísticas no está disponible.' });
  assert.equal(tokenCalls.length, 0);
});

test('si Google rechaza el token (sin acceso en la propiedad), responde 503', async () => {
  tokenHandler = () => json(401, { error: 'invalid_grant' });
  const res = await get();
  assert.equal(res.status, 503);
  assertNoKeyLeak(logs.join('\n'));
});

test('si la dimension "method" todavia no existe en GA4, el resto del resumen sigue funcionando', async () => {
  const baseHandler = reportHandler;
  reportHandler = (body) => {
    const dims = (body.dimensions || []).map((d) => d.name);
    if (dims.includes('customEvent:method')) {
      return json(400, { error: { code: 400, message: 'Field customEvent:method is not a valid dimension.' } });
    }
    return baseHandler(body);
  };

  const res = await get();
  assert.equal(res.status, 200);
  const data = await res.json();
  assert.equal(data.contactByMethod, null);
  assert.deepEqual(data.totals, { activeUsers: 10, pageViews: 25, eventCount: 60 });
  assert.equal(data.events.length, 2);
  assertNoKeyLeak(logs.join('\n'));
});

test('limite de solicitudes por minuto', async () => {
  process.env.ANALYTICS_RATE_LIMIT_PER_MIN = '2';
  analyticsRateLimit.reset();
  assert.equal((await get()).status, 200);
  assert.equal((await get()).status, 200);
  const res = await get();
  assert.equal(res.status, 429);
  assert.ok(res.headers.get('retry-after'));
});

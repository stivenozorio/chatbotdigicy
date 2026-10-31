'use strict';

// Pruebas del middleware CORS que permite a digicyus.com llamar a esta API
// desde el navegador.
const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');

const app = require('../src/app');

let server; let url;

test.before(async () => {
  server = http.createServer(app).listen(0);
  await new Promise((r) => server.once('listening', r));
  url = `http://127.0.0.1:${server.address().port}`;
});

test.after(() => {
  server.close();
});

test('origen permitido: refleja Access-Control-Allow-Origin', async () => {
  const res = await fetch(`${url}/health`, {
    headers: { Origin: 'https://digicyus.com' },
  });
  assert.equal(res.headers.get('access-control-allow-origin'), 'https://digicyus.com');
  assert.equal(res.headers.get('vary'), 'Origin');
});

test('origen no permitido: no manda cabeceras CORS', async () => {
  const res = await fetch(`${url}/health`, {
    headers: { Origin: 'https://example.com' },
  });
  assert.equal(res.headers.get('access-control-allow-origin'), null);
});

test('preflight OPTIONS: responde 204 con los métodos y cabeceras permitidas', async () => {
  const res = await fetch(`${url}/api/ai/test`, {
    method: 'OPTIONS',
    headers: {
      Origin: 'https://digicyus.com',
      'Access-Control-Request-Method': 'POST',
      'Access-Control-Request-Headers': 'Content-Type',
    },
  });
  assert.equal(res.status, 204);
  assert.equal(res.headers.get('access-control-allow-origin'), 'https://digicyus.com');
  assert.match(res.headers.get('access-control-allow-methods') || '', /POST/);
  assert.match(res.headers.get('access-control-allow-headers') || '', /Content-Type/);
});

test('www.digicyus.com también está permitido', async () => {
  const res = await fetch(`${url}/health`, {
    headers: { Origin: 'https://www.digicyus.com' },
  });
  assert.equal(res.headers.get('access-control-allow-origin'), 'https://www.digicyus.com');
});

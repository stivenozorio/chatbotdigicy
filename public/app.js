'use strict';

(function () {
  var form = document.getElementById('form');
  var input = document.getElementById('message');
  var send = document.getElementById('send');
  var log = document.getElementById('log');
  var counter = document.getElementById('counter');
  document.getElementById('year').textContent = new Date().getFullYear();

  // Las rutas de la API son relativas al sitio: /app/ -> /api/ai/test
  var API_URL = new URL('../api/ai/test', window.location.href).pathname;

  function addMessage(text, kind) {
    var el = document.createElement('div');
    el.className = 'msg ' + kind;
    el.textContent = text; // textContent: la respuesta de la IA nunca se interpreta como HTML
    log.appendChild(el);
    log.scrollTop = log.scrollHeight;
    return el;
  }

  function updateCounter() {
    counter.textContent = input.value.length + ' / 1000';
  }
  input.addEventListener('input', updateCounter);

  // Enter envía; Shift+Enter inserta un salto de línea.
  input.addEventListener('keydown', function (e) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      form.requestSubmit();
    }
  });

  form.addEventListener('submit', function (e) {
    e.preventDefault();
    var message = input.value.trim();
    if (!message) return;

    addMessage(message, 'user');
    input.value = '';
    updateCounter();
    send.disabled = true;
    var pending = addMessage('Escribiendo…', 'bot pending');

    var controller = new AbortController();
    var timer = setTimeout(function () { controller.abort(); }, 35000);

    fetch(API_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ message: message }),
      signal: controller.signal
    })
      .then(function (res) {
        return res.json().catch(function () { return {}; }).then(function (data) {
          if (res.ok && data.reply) {
            pending.className = 'msg bot';
            pending.textContent = data.reply;
          } else {
            pending.className = 'msg error';
            pending.textContent = data.error || (res.status === 504 ? 'La IA tardó demasiado en responder. Intenta de nuevo.' : 'No se pudo obtener respuesta (error HTTP ' + res.status + '). Intenta de nuevo.');
          }
        });
      })
      .catch(function () {
        pending.className = 'msg error';
        pending.textContent = 'No se pudo conectar con el servidor. Intenta de nuevo.';
      })
      .then(function () {
        clearTimeout(timer);
        send.disabled = false;
        input.focus();
        log.scrollTop = log.scrollHeight;
      });
  });
})();

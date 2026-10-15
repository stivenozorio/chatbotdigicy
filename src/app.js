'use strict';

const express = require('express');
const routes = require('./routes');

const app = express();

app.disable('x-powered-by');
app.use(express.json({ limit: '10kb' }));
app.use(routes);

app.use((req, res) => {
  res.status(404).json({ error: 'No encontrado' });
});

// eslint-disable-next-line no-unused-vars
app.use((err, req, res, next) => {
  if (err.type === 'entity.parse.failed') {
    return res.status(400).json({ error: 'JSON inválido' });
  }
  if (err.type === 'entity.too.large') {
    return res.status(413).json({ error: 'Solicitud demasiado grande' });
  }
  console.error(err);
  res.status(500).json({ error: 'Error interno del servidor' });
});

module.exports = app;

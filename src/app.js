'use strict';

const express = require('express');
const routes = require('./routes');

const app = express();

app.disable('x-powered-by');
app.use(express.json());
app.use(routes);

app.use((req, res) => {
  res.status(404).json({ error: 'No encontrado' });
});

// eslint-disable-next-line no-unused-vars
app.use((err, req, res, next) => {
  console.error(err);
  res.status(500).json({ error: 'Error interno del servidor' });
});

module.exports = app;

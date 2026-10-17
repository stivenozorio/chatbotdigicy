'use strict';

const db = require('../services/db');

exports.home = (req, res) => {
  res.send('Digicyus SI está funcionando');
};

exports.health = (req, res) => {
  res.json({
    status: 'ok',
    service: 'digicyus-ai',
    uptime: Math.round(process.uptime()),
    timestamp: new Date().toISOString(),
  });
};

exports.healthDb = async (req, res) => {
  try {
    await db.ping();
    res.json({ status: 'ok', database: 'connected' });
  } catch (err) {
    // Se registra solo el código de error; nunca credenciales ni el mensaje completo.
    console.error('Fallo en /health/db:', err && err.code ? err.code : 'ERROR_DESCONOCIDO');
    res.status(503).json({ status: 'error', database: 'unavailable', message: 'Servicio de base de datos no disponible' });
  }
};

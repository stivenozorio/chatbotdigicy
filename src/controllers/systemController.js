'use strict';

exports.home = (req, res) => {
  res.send('Digicyus AI está funcionando');
};

exports.health = (req, res) => {
  res.json({
    status: 'ok',
    service: 'digicyus-ai',
    uptime: Math.round(process.uptime()),
    timestamp: new Date().toISOString(),
  });
};

'use strict';

// Verificación del webhook de WhatsApp Cloud API: pendiente de implementar.
// Meta enviará hub.mode, hub.verify_token y hub.challenge; se validará contra
// config.whatsapp.verifyToken y se responderá con el challenge.
exports.verify = (req, res) => {
  res.status(501).json({ status: 'not_implemented', message: 'Verificación de WhatsApp pendiente' });
};

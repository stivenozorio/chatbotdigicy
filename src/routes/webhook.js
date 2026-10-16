'use strict';

const { Router } = require('express');
const webhook = require('../controllers/webhookController');

const router = Router();

router.get('/', webhook.verify);
router.post('/', webhook.receive);

module.exports = router;

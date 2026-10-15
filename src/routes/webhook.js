'use strict';

const { Router } = require('express');
const webhook = require('../controllers/webhookController');

const router = Router();

router.get('/', webhook.verify);

module.exports = router;

'use strict';

const { Router } = require('express');
const system = require('./system');
const webhook = require('./webhook');
const ai = require('./ai');

const router = Router();

router.use('/', system);
router.use('/webhook', webhook);
router.use('/api/ai', ai);

module.exports = router;

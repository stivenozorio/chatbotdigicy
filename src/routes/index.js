'use strict';

const { Router } = require('express');
const system = require('./system');
const webhook = require('./webhook');
const ai = require('./ai');
const analytics = require('./analytics');

const router = Router();

router.use('/', system);
router.use('/webhook', webhook);
router.use('/api/ai', ai);
router.use('/api/analytics', analytics);

module.exports = router;

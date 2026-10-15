'use strict';

const { Router } = require('express');
const system = require('./system');
const webhook = require('./webhook');

const router = Router();

router.use('/', system);
router.use('/webhook', webhook);

module.exports = router;

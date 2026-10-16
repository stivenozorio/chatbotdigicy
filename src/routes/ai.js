'use strict';

const { Router } = require('express');
const ai = require('../controllers/aiController');
const aiRateLimit = require('../middlewares/rateLimit');

const router = Router();

router.post('/test', aiRateLimit, ai.test);

module.exports = router;

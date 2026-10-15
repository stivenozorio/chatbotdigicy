'use strict';

const { Router } = require('express');
const ai = require('../controllers/aiController');

const router = Router();

router.post('/test', ai.test);

module.exports = router;

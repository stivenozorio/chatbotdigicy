'use strict';

const { Router } = require('express');
const analytics = require('../controllers/analyticsController');
const analyticsRateLimit = require('../middlewares/analyticsRateLimit');

const router = Router();

router.get('/summary', analyticsRateLimit, analytics.summary);

module.exports = router;

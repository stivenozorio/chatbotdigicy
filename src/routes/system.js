'use strict';

const { Router } = require('express');
const system = require('../controllers/systemController');

const router = Router();

router.get('/', system.home);
router.get('/health', system.health);
router.get('/health/db', system.healthDb);

module.exports = router;

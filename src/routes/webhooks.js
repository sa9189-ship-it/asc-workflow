const express = require('express');
const router = express.Router();
const { handleFirefliesWebhook } = require('../webhooks/fireflies');

// Raw body required for HMAC verification — capture it here before any parsing
router.post(
  '/fireflies',
  express.raw({ type: 'application/json' }),
  handleFirefliesWebhook
);

module.exports = router;

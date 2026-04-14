const express = require('express');
const router = express.Router();
const { uploadFinancials } = require('../webhooks/uploader');

// POST /upload/financials — accepts P&L, deck, or model files
router.post('/financials', uploadFinancials);

module.exports = router;

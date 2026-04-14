/**
 * POST /generate
 *
 * Accepts a context object (from Stage 2 extraction, or manually supplied),
 * runs all three generators in parallel, saves the result as v1 of the draft,
 * and returns the combined output.
 *
 * Request body (JSON):
 *   {
 *     companyName:       string,
 *     sector:            string,
 *     stage:             string,
 *     problemStatement:  string,
 *     arr:               number,   // Annual Recurring Revenue (USD)
 *     burnRate:          number,   // Monthly burn (USD)
 *     runway:            number,   // Months
 *     competitors:       string[],
 *     fundingAsk:        number,   // USD
 *     geography:         string    // e.g. "NY" | "SF"
 *   }
 *
 * Response body (JSON):
 *   {
 *     version:     "v1",
 *     outputFile:  "outputs/<meetingId>/<timestamp>_v1.json",
 *     deck:        [...],
 *     model:       { base, bear, bull, assumptions },
 *     vcShortlist: [...]
 *   }
 */

const express = require('express');
const router = express.Router();
const fs = require('fs');
const path = require('path');
const { runGeneration } = require('../generation/index');

const OUTPUTS_DIR = path.join(__dirname, '../../outputs');

function sanitiseId(str) {
  return (str || 'unknown').replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 64);
}

router.post('/', async (req, res) => {
  const context = req.body;

  if (!context || typeof context !== 'object') {
    return res.status(400).json({ error: 'Request body must be a JSON context object' });
  }

  console.log(`[Generate] Starting generation for company="${context.companyName || 'unknown'}"`);

  let result;
  try {
    result = await runGeneration(context);
  } catch (err) {
    console.error('[Generate] Generation failed:', err.message);
    return res.status(500).json({ error: err.message });
  }

  // ── Persist as v1 draft ──────────────────────────────────────────────────
  const companySlug = sanitiseId(context.companyName);
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const outputDir = path.join(OUTPUTS_DIR, companySlug);
  const filename = `${timestamp}_v1.json`;
  const filepath = path.join(outputDir, filename);

  const draft = {
    version: 'v1',
    generatedAt: new Date().toISOString(),
    context,
    ...result,
  };

  try {
    fs.mkdirSync(outputDir, { recursive: true });
    fs.writeFileSync(filepath, JSON.stringify(draft, null, 2), 'utf8');
    console.log(`[Generate] Draft saved → outputs/${companySlug}/${filename}`);
  } catch (err) {
    console.error('[Generate] Failed to save draft:', err.message);
    // Don't fail the request — return the result even if disk write failed
  }

  return res.status(200).json({
    version: 'v1',
    outputFile: `outputs/${companySlug}/${filename}`,
    ...result,
  });
});

module.exports = router;

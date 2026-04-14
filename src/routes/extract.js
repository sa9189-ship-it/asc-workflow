/**
 * POST /extract
 *
 * Accepts a raw meeting transcript (and optional document texts) and
 * returns a structured context object ready for Stage 3 generation.
 *
 * Request body (JSON):
 *   {
 *     transcript: string,           // required
 *     documents:  string[]          // optional — plain-text contents of uploaded files
 *   }
 *
 * Response body (JSON):
 *   {
 *     companyName, founderName, sector, stage, geography,
 *     problemStatement, arr, burnRate, runway, fundingAsk, competitors
 *   }
 */

const express = require('express');
const router = express.Router();
const { extractContext } = require('../extraction/extract');

router.post('/', async (req, res) => {
  const { transcript, documents } = req.body || {};

  if (!transcript || typeof transcript !== 'string' || transcript.trim().length === 0) {
    return res.status(400).json({ error: '"transcript" is required and must be a non-empty string' });
  }

  const docs = Array.isArray(documents) ? documents.filter((d) => typeof d === 'string' && d.trim()) : [];

  console.log(`\n[Extract] Received transcript (${transcript.length} chars)${docs.length ? `, ${docs.length} document(s)` : ''}`);

  let context;
  try {
    context = await extractContext(transcript, docs);
  } catch (err) {
    console.error('[Extract] Failed:', err.message);
    return res.status(500).json({ error: err.message });
  }

  // Log the full extracted context so it's visible during testing
  console.log('[Extract] Result:');
  console.log(`  companyName      : ${context.companyName}`);
  console.log(`  founderName      : ${context.founderName}`);
  console.log(`  sector           : ${context.sector}`);
  console.log(`  stage            : ${context.stage}`);
  console.log(`  geography        : ${context.geography}`);
  console.log(`  problemStatement : ${context.problemStatement}`);
  console.log(`  arr              : ${context.arr != null ? '$' + context.arr.toLocaleString() : 'null'}`);
  console.log(`  burnRate         : ${context.burnRate != null ? '$' + context.burnRate.toLocaleString() + '/mo' : 'null'}`);
  console.log(`  runway           : ${context.runway != null ? context.runway + ' months' : 'null'}`);
  console.log(`  fundingAsk       : ${context.fundingAsk != null ? '$' + context.fundingAsk.toLocaleString() : 'null'}`);
  console.log(`  competitors      : ${context.competitors.length ? context.competitors.join(', ') : '(none)'}`);

  return res.status(200).json(context);
});

module.exports = router;

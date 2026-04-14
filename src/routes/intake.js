/**
 * POST /intake
 *
 * Accepts a multipart form submission from /new.html and runs the full pipeline:
 *   1. If a transcript is provided → run Claude extraction, then merge explicit fields on top
 *   2. If only form fields → build context directly (no Claude extraction call)
 *   3. Always run generation (deck + model + VC scoring in parallel)
 *   4. Save to outputs/<slug>/
 *   5. Return { slug, redirectUrl }
 */

const express = require('express');
const router = express.Router();
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const { extractContext } = require('../extraction/extract');
const { runGeneration } = require('../generation/index');

const OUTPUTS_DIR = path.join(__dirname, '../../outputs');

// ── File upload (memory storage so we can read text inline) ───────────────────
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 }, // 10 MB
  fileFilter(req, file, cb) {
    const ext = path.extname(file.originalname).toLowerCase();
    cb(null, ['.txt', '.pdf'].includes(ext));
  },
}).array('documents', 5);

// ── Helpers ───────────────────────────────────────────────────────────────────

function sanitiseSlug(str) {
  return (str || 'unknown').replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 64);
}

function parseNum(val) {
  if (val === undefined || val === null || val === '') return null;
  const n = Number(val);
  return Number.isFinite(n) ? n : null;
}

function buildContextFromFields(fields) {
  return {
    companyName:      fields.companyName?.trim()      || null,
    founderName:      fields.founderName?.trim()      || null,
    sector:           fields.sector?.trim()           || null,
    stage:            fields.stage?.trim()            || null,
    geography:        fields.geography?.trim()        || null,
    problemStatement: fields.problemStatement?.trim() || null,
    arr:              parseNum(fields.arr),
    burnRate:         parseNum(fields.burnRate),
    runway:           parseNum(fields.runway),
    fundingAsk:       parseNum(fields.fundingAsk),
    competitors:      [],
  };
}

// ── Route ─────────────────────────────────────────────────────────────────────

router.post('/', (req, res) => {
  upload(req, res, async (uploadErr) => {
    if (uploadErr instanceof multer.MulterError) {
      return res.status(400).json({ error: uploadErr.message });
    }
    if (uploadErr) {
      return res.status(400).json({ error: uploadErr.message });
    }

    const fields = req.body || {};
    const transcript = (fields.transcript || '').trim();

    // Read .txt uploads as document strings for extraction
    const documentTexts = (req.files || [])
      .filter((f) => path.extname(f.originalname).toLowerCase() === '.txt')
      .map((f) => { try { return f.buffer.toString('utf8'); } catch { return null; } })
      .filter(Boolean);

    // ── Build context ──────────────────────────────────────────────────────────
    // Skip Claude extraction (and its API cost) when the key fields sector +
    // stage are already filled — the form data is authoritative in that case.
    const keyFieldsFilled = fields.sector?.trim() && fields.stage?.trim();
    let context;

    try {
      if (transcript && !keyFieldsFilled) {
        // Run extraction, then let explicit form fields override nulls
        console.log('[Intake] Extracting from transcript...');
        const extracted = await extractContext(transcript, documentTexts);
        const explicit = buildContextFromFields(fields);

        // Merge: non-null explicit fields win over extracted
        context = { ...extracted };
        for (const [k, v] of Object.entries(explicit)) {
          if (v !== null && v !== undefined && !(Array.isArray(v) && v.length === 0)) {
            context[k] = v;
          }
        }
        // Preserve extracted competitors if none explicit
        if (!context.competitors?.length) context.competitors = extracted.competitors || [];

      } else if (fields.companyName?.trim()) {
        // Fields already filled (or no transcript) — build directly, skip extraction
        console.log('[Intake] Key fields present — skipping extraction, building context from form fields.');
        context = buildContextFromFields(fields);

      } else {
        return res.status(400).json({ error: 'A transcript or company name is required.' });
      }
    } catch (err) {
      console.error('[Intake] Extraction error:', err.message);
      return res.status(500).json({ error: `Extraction failed: ${err.message}` });
    }

    // ── Run generation ─────────────────────────────────────────────────────────
    console.log(`[Intake] Generating outputs for "${context.companyName}"...`);
    let result;
    try {
      result = await runGeneration(context);
    } catch (err) {
      console.error('[Intake] Generation error:', err.message);
      return res.status(500).json({ error: `Generation failed: ${err.message}` });
    }

    // ── Persist draft ──────────────────────────────────────────────────────────
    const slug = sanitiseSlug(context.companyName);
    const outputDir = path.join(OUTPUTS_DIR, slug);
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const filename = `${timestamp}_v1.json`;
    const draft = { version: 'v1', generatedAt: new Date().toISOString(), context, ...result };

    try {
      fs.mkdirSync(outputDir, { recursive: true });
      fs.writeFileSync(path.join(outputDir, filename), JSON.stringify(draft, null, 2), 'utf8');
      console.log(`[Intake] Saved → outputs/${slug}/${filename}`);
    } catch (err) {
      console.error('[Intake] Failed to save draft:', err.message);
      // Still return success — data is in memory
    }

    return res.json({ slug, redirectUrl: `/?slug=${encodeURIComponent(slug)}` });
  });
});

module.exports = router;

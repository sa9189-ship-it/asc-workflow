/**
 * STAGE 1 — INTAKE: Fireflies Webhook Listener
 *
 * Fireflies sends a POST with a JSON body whenever a transcript is ready.
 * Docs: https://docs.fireflies.ai/webhooks
 *
 * Security: Fireflies signs each request with an HMAC-SHA256 signature
 * in the `x-hub-signature-256` header. We verify it before processing.
 *
 * Environment variables required:
 *   FIREFLIES_WEBHOOK_SECRET  — shared secret you set in the Fireflies dashboard
 */

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { extractContext } = require('../extraction/extract');
const { runGeneration } = require('../generation/index');

const OUTPUTS_DIR = path.join(__dirname, '../../outputs');

const TRANSCRIPTS_DIR = path.join(__dirname, '../../uploads/transcripts');

/**
 * Verify the HMAC-SHA256 signature Fireflies attaches to every webhook.
 * Returns true if the signature matches, false otherwise.
 */
function verifySignature(rawBody, signatureHeader, secret) {
  if (!signatureHeader) return false;

  // Header format: "sha256=<hex_digest>"
  const [algo, receivedHex] = signatureHeader.split('=');
  if (algo !== 'sha256' || !receivedHex) return false;

  const expectedHex = crypto
    .createHmac('sha256', secret)
    .update(rawBody)
    .digest('hex');

  // Constant-time comparison to prevent timing attacks
  try {
    return crypto.timingSafeEqual(
      Buffer.from(receivedHex, 'hex'),
      Buffer.from(expectedHex, 'hex')
    );
  } catch {
    return false;
  }
}

/**
 * Persist the raw transcript payload to disk so it can be picked up
 * by the extraction stage. Filename encodes the meeting ID and timestamp.
 */
function saveTranscript(payload) {
  const meetingId = payload.meetingId || payload.id || 'unknown';
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const filename = `${meetingId}_${timestamp}.json`;
  const filepath = path.join(TRANSCRIPTS_DIR, filename);

  fs.mkdirSync(TRANSCRIPTS_DIR, { recursive: true });
  fs.writeFileSync(filepath, JSON.stringify(payload, null, 2), 'utf8');

  return { filename, filepath };
}

/**
 * Express route handler for POST /webhooks/fireflies
 */
async function handleFirefliesWebhook(req, res) {
  const rawBody = req.body; // Buffer — set by express.raw() in the router
  const signatureHeader = req.headers['x-hub-signature-256'];
  const secret = process.env.FIREFLIES_WEBHOOK_SECRET;

  // 1. Signature verification (skip if secret not configured — warn loudly)
  if (secret) {
    const valid = verifySignature(rawBody, signatureHeader, secret);
    if (!valid) {
      console.warn('[Fireflies] Rejected webhook — invalid signature');
      return res.status(401).json({ error: 'Invalid signature' });
    }
  } else {
    console.warn(
      '[Fireflies] WARNING: FIREFLIES_WEBHOOK_SECRET not set. ' +
      'Skipping signature verification. Set this in production.'
    );
  }

  // 2. Parse body
  let payload;
  try {
    payload = JSON.parse(rawBody.toString('utf8'));
  } catch (err) {
    console.error('[Fireflies] Failed to parse webhook body:', err.message);
    return res.status(400).json({ error: 'Invalid JSON body' });
  }

  console.log('[Fireflies] Received webhook event:', payload.eventType || payload.type || '(no event type)');

  // 3. We only act on transcript-ready events; acknowledge all others immediately
  const eventType = (payload.eventType || payload.type || '').toLowerCase();
  if (eventType && eventType !== 'transcriptready' && eventType !== 'transcript_ready') {
    return res.status(200).json({ received: true, action: 'ignored', eventType });
  }

  // 4. Save raw transcript to disk
  let savedFile = null;
  try {
    const { filename } = saveTranscript(payload);
    savedFile = filename;
    console.log(`[Fireflies] Transcript saved → uploads/transcripts/${filename}`);
  } catch (err) {
    console.error('[Fireflies] Failed to save transcript:', err.message);
  }

  // 5. Extract transcript text from Fireflies payload
  const t = payload.transcript;
  let transcriptText = '';
  if (typeof t === 'string') {
    transcriptText = t;
  } else if (Array.isArray(t?.sentences) && t.sentences.length) {
    transcriptText = t.sentences
      .map((s) => `${s.speaker_name || s.speaker || 'Unknown'}: ${s.text}`)
      .join('\n');
  } else if (t?.text) {
    transcriptText = t.text;
  }

  if (!transcriptText.trim()) {
    return res.status(200).json({ received: true, action: 'no_transcript', file: savedFile });
  }

  // 6. Respond immediately — pipeline runs in the background
  const slug = (payload.meetingId || payload.id || 'unknown').replace(/[^a-zA-Z0-9_-]/g, '_');
  res.status(200).json({ received: true, action: 'processing', slug, file: savedFile });

  // 7. Run full pipeline asynchronously
  setImmediate(async () => {
    try {
      console.log('[Fireflies] Running extraction...');
      const context = await extractContext(transcriptText);

      console.log(`[Fireflies] Running generation for "${context.companyName}"...`);
      const result = await runGeneration(context);

      const companySlug = (context.companyName || slug).replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 64);
      const outputDir = path.join(OUTPUTS_DIR, companySlug);
      const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
      const filename = `${timestamp}_v1.json`;
      const draft = { version: 'v1', generatedAt: new Date().toISOString(), context, ...result };

      fs.mkdirSync(outputDir, { recursive: true });
      fs.writeFileSync(path.join(outputDir, filename), JSON.stringify(draft, null, 2), 'utf8');
      console.log(`[Fireflies] Pipeline complete → outputs/${companySlug}/${filename}`);
    } catch (err) {
      console.error('[Fireflies] Pipeline failed:', err.message);
    }
  });
}

module.exports = { handleFirefliesWebhook, verifySignature };

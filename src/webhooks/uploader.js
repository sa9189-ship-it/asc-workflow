/**
 * STAGE 1 — INTAKE: Financial Document Uploader
 *
 * Accepts multipart/form-data uploads for:
 *   - P&L statements
 *   - Existing pitch decks
 *   - Financial models
 *
 * Files are stored in uploads/financials/<meetingId>/ so they can be
 * correlated with the transcript from the same engagement.
 *
 * Request fields:
 *   meetingId  (string, required) — ties this upload to a transcript
 *   files      (file[])           — one or more documents
 */

const multer = require('multer');
const path = require('path');
const fs = require('fs');

const FINANCIALS_DIR = path.join(__dirname, '../../uploads/financials');

// Allowed MIME types and extensions
const ALLOWED_TYPES = new Set([
  'application/pdf',
  'application/vnd.ms-excel',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'application/vnd.ms-powerpoint',
  'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  'text/csv',
  'text/plain',
]);

const storage = multer.diskStorage({
  destination(req, file, cb) {
    const meetingId = req.body.meetingId || 'unassigned';
    // Sanitize meetingId to prevent path traversal
    const safeMeetingId = meetingId.replace(/[^a-zA-Z0-9_-]/g, '_');
    const dest = path.join(FINANCIALS_DIR, safeMeetingId);
    fs.mkdirSync(dest, { recursive: true });
    cb(null, dest);
  },
  filename(req, file, cb) {
    const timestamp = Date.now();
    const ext = path.extname(file.originalname);
    const base = path.basename(file.originalname, ext).replace(/[^a-zA-Z0-9_-]/g, '_');
    cb(null, `${base}_${timestamp}${ext}`);
  },
});

function fileFilter(req, file, cb) {
  if (ALLOWED_TYPES.has(file.mimetype)) {
    cb(null, true);
  } else {
    cb(new Error(`File type not allowed: ${file.mimetype}`), false);
  }
}

const upload = multer({
  storage,
  fileFilter,
  limits: { fileSize: 50 * 1024 * 1024 }, // 50 MB per file
}).array('files', 10);

function uploadFinancials(req, res) {
  upload(req, res, (err) => {
    if (err instanceof multer.MulterError) {
      return res.status(400).json({ error: err.message });
    }
    if (err) {
      return res.status(400).json({ error: err.message });
    }

    const meetingId = req.body.meetingId || 'unassigned';
    const uploaded = (req.files || []).map((f) => ({
      originalName: f.originalname,
      savedAs: f.filename,
      size: f.size,
      mimeType: f.mimetype,
    }));

    console.log(`[Uploader] ${uploaded.length} file(s) received for meetingId="${meetingId}"`);

    // TODO (Stage 2): enqueue these files for extraction alongside transcript
    // e.g. extractionQueue.add({ meetingId, uploadedFiles: uploaded });

    return res.status(200).json({
      received: true,
      meetingId,
      files: uploaded,
      nextStage: 'extraction (pending)',
    });
  });
}

module.exports = { uploadFinancials };

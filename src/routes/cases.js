/**
 * GET /cases
 *
 * Reads every subdirectory in outputs/, picks the latest versioned JSON
 * in each, and returns a summary array for the dashboard.
 *
 * Response: Array of case objects, newest-first:
 *   { slug, companyName, founderName, sector, stage,
 *     generatedAt, version, approvals, exportedFiles }
 */

const express = require('express');
const router = express.Router();
const fs = require('fs');
const path = require('path');

const OUTPUTS_DIR = path.join(__dirname, '../../outputs');

router.get('/', (req, res) => {
  if (!fs.existsSync(OUTPUTS_DIR)) return res.json([]);

  let entries;
  try {
    entries = fs.readdirSync(OUTPUTS_DIR, { withFileTypes: true });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }

  const cases = [];

  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const slug = entry.name;
    const dir = path.join(OUTPUTS_DIR, slug);

    // Latest .json in root of the slug directory (not in /export sub-folder)
    let jsonFiles;
    try {
      jsonFiles = fs.readdirSync(dir)
        .filter((f) => f.endsWith('.json'))
        .sort()
        .reverse();
    } catch { continue; }

    if (!jsonFiles.length) continue;

    let draft;
    try {
      draft = JSON.parse(fs.readFileSync(path.join(dir, jsonFiles[0]), 'utf8'));
    } catch { continue; }

    // Check export folder
    const exportDir = path.join(dir, 'export');
    let exportedFiles = [];
    if (fs.existsSync(exportDir)) {
      try {
        exportedFiles = fs.readdirSync(exportDir).filter((f) => !f.startsWith('.'));
      } catch {}
    }

    cases.push({
      slug,
      companyName:  draft.context?.companyName  || slug,
      founderName:  draft.context?.founderName  || null,
      sector:       draft.context?.sector       || null,
      stage:        draft.context?.stage        || null,
      generatedAt:  draft.generatedAt           || null,
      version:      draft.version               || 'v1',
      approvals:    draft.approvals             || {},
      exportedFiles,
    });
  }

  cases.sort((a, b) => new Date(b.generatedAt) - new Date(a.generatedAt));
  return res.json(cases);
});

module.exports = router;

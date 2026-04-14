/**
 * Routes for reading and acting on generated outputs.
 *
 * GET  /outputs/:slug/latest              — return latest draft JSON
 * POST /outputs/:slug/approve             — mark a section approved
 * POST /outputs/:slug/approve-slide       — mark a single slide approved
 * POST /outputs/:slug/revise              — re-run one full section
 * POST /outputs/:slug/revise-slide        — re-run one slide
 * POST /outputs/:slug/revise-scenario     — re-run one scenario (bear/base/bull)
 * POST /outputs/:slug/revise-vc           — re-run VC scoring
 * POST /outputs/:slug/upload-model        — upload revised Excel/CSV
 * GET  /outputs/:slug/download-model      — download model as .xlsx
 * POST /outputs/:slug/export              — export approved sections
 */

const express = require('express');
const router = express.Router();
const fs = require('fs');
const path = require('path');
const multer = require('multer');
const { runSection } = require('../generation/index');
const { generateSingleSlide } = require('../generation/deck');
const { generateScenario } = require('../generation/model');

const OUTPUTS_DIR = path.join(__dirname, '../../outputs');

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 },
}).single('file');

function sanitiseSlug(str) {
  return (str || '').replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 64);
}

function resolveSlugDir(rawSlug) {
  const slug = sanitiseSlug(rawSlug);
  if (!fs.existsSync(OUTPUTS_DIR)) return null;
  const entries = fs.readdirSync(OUTPUTS_DIR);
  const match = entries.find((e) => e.toLowerCase() === slug.toLowerCase());
  return match ? path.join(OUTPUTS_DIR, match) : null;
}

function latestFile(dir) {
  const files = fs.readdirSync(dir)
    .filter((f) => f.endsWith('.json'))
    .sort()
    .reverse();
  return files.length ? path.join(dir, files[0]) : null;
}

function readDraft(dir) {
  const file = latestFile(dir);
  if (!file) return null;
  return { file, draft: JSON.parse(fs.readFileSync(file, 'utf8')) };
}

function saveDraft(dir, draft) {
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const filename = `${timestamp}_${draft.version}.json`;
  fs.writeFileSync(path.join(dir, filename), JSON.stringify(draft, null, 2), 'utf8');
  return filename;
}

function bumpVersion(draft) {
  const vMatch = (draft.version || 'v1').match(/v(\d+)/);
  return `v${vMatch ? parseInt(vMatch[1]) + 1 : 2}`;
}

// ── GET /outputs/:slug/latest ────────────────────────────────────────────────

router.get('/:slug/latest', (req, res) => {
  const dir = resolveSlugDir(req.params.slug);
  if (!dir) return res.status(404).json({ error: `No outputs found for "${req.params.slug}"` });

  const result = readDraft(dir);
  if (!result) return res.status(404).json({ error: 'Output directory exists but contains no files' });

  return res.json(result.draft);
});

// ── POST /outputs/:slug/approve ──────────────────────────────────────────────

router.post('/:slug/approve', (req, res) => {
  const { section } = req.body || {};
  if (!['deck', 'model', 'vcShortlist'].includes(section)) {
    return res.status(400).json({ error: 'section must be one of: deck, model, vcShortlist' });
  }

  const dir = resolveSlugDir(req.params.slug);
  if (!dir) return res.status(404).json({ error: `No outputs found` });

  const result = readDraft(dir);
  if (!result) return res.status(404).json({ error: 'No output files found' });

  const { file, draft } = result;
  if (!draft.approvals) draft.approvals = {};
  draft.approvals[section] = true;

  fs.writeFileSync(file, JSON.stringify(draft, null, 2), 'utf8');
  console.log(`[Outputs] Approved section "${section}" for ${req.params.slug}`);
  return res.json({ ok: true, section, approved: true });
});

// ── POST /outputs/:slug/approve-slide ────────────────────────────────────────

router.post('/:slug/approve-slide', (req, res) => {
  const { slideIndex } = req.body || {};
  if (slideIndex == null || slideIndex < 0) {
    return res.status(400).json({ error: 'slideIndex is required' });
  }

  const dir = resolveSlugDir(req.params.slug);
  if (!dir) return res.status(404).json({ error: `No outputs found` });

  const result = readDraft(dir);
  if (!result) return res.status(404).json({ error: 'No output files found' });

  const { file, draft } = result;
  if (!draft.slideApprovals) draft.slideApprovals = {};
  draft.slideApprovals[slideIndex] = true;

  // Check if all slides are now approved
  const allApproved = (draft.deck || []).every((_, i) => draft.slideApprovals[i]);
  if (allApproved) {
    if (!draft.approvals) draft.approvals = {};
    draft.approvals.deck = true;
  }

  fs.writeFileSync(file, JSON.stringify(draft, null, 2), 'utf8');
  console.log(`[Outputs] Approved slide ${slideIndex} for ${req.params.slug}`);
  return res.json({ ok: true, slideIndex, allApproved });
});

// ── POST /outputs/:slug/revise ───────────────────────────────────────────────

router.post('/:slug/revise', async (req, res) => {
  const { section, instruction } = req.body || {};
  if (!['deck', 'model', 'vcShortlist'].includes(section)) {
    return res.status(400).json({ error: 'section must be one of: deck, model, vcShortlist' });
  }

  const dir = resolveSlugDir(req.params.slug);
  if (!dir) return res.status(404).json({ error: `No outputs found` });

  const result = readDraft(dir);
  if (!result) return res.status(404).json({ error: 'No output files found' });

  const { draft } = result;
  console.log(`[Outputs] Revising "${section}" — instruction: "${instruction || '(none)'}"`);

  let newData;
  try {
    newData = await runSection(section, draft.context, instruction || null);
  } catch (err) {
    console.error('[Outputs] Revision failed:', err.message);
    return res.status(500).json({ error: err.message });
  }

  const nextVersion = bumpVersion(draft);
  const newDraft = {
    ...draft,
    version: nextVersion,
    generatedAt: new Date().toISOString(),
    [section]: newData,
    approvals: { ...(draft.approvals || {}), [section]: false },
  };

  saveDraft(dir, newDraft);
  return res.json({ ok: true, version: nextVersion, [section]: newData, approvals: newDraft.approvals });
});

// ── POST /outputs/:slug/revise-slide ─────────────────────────────────────────

router.post('/:slug/revise-slide', async (req, res) => {
  const { slideIndex, instruction } = req.body || {};
  if (slideIndex == null || slideIndex < 0) {
    return res.status(400).json({ error: 'slideIndex is required' });
  }

  const dir = resolveSlugDir(req.params.slug);
  if (!dir) return res.status(404).json({ error: `No outputs found` });

  const result = readDraft(dir);
  if (!result) return res.status(404).json({ error: 'No output files found' });

  const { draft } = result;
  const currentSlide = draft.deck?.[slideIndex];
  if (!currentSlide) return res.status(400).json({ error: `Slide ${slideIndex} not found` });

  console.log(`[Outputs] Revising slide ${slideIndex} — instruction: "${instruction}"`);

  let newSlide;
  try {
    newSlide = await generateSingleSlide(draft.context, currentSlide, instruction);
  } catch (err) {
    console.error('[Outputs] Slide revision failed:', err.message);
    return res.status(500).json({ error: err.message });
  }

  const nextVersion = bumpVersion(draft);
  draft.deck[slideIndex] = newSlide;
  const newDraft = {
    ...draft,
    version: nextVersion,
    generatedAt: new Date().toISOString(),
    approvals: { ...(draft.approvals || {}), deck: false },
    slideApprovals: { ...(draft.slideApprovals || {}), [slideIndex]: false },
  };

  saveDraft(dir, newDraft);
  return res.json({ ok: true, version: nextVersion, slide: newSlide });
});

// ── POST /outputs/:slug/revise-scenario ──────────────────────────────────────

router.post('/:slug/revise-scenario', async (req, res) => {
  const { scenario, instruction } = req.body || {};
  if (!['bear', 'base', 'bull'].includes(scenario)) {
    return res.status(400).json({ error: 'scenario must be one of: bear, base, bull' });
  }

  const dir = resolveSlugDir(req.params.slug);
  if (!dir) return res.status(404).json({ error: `No outputs found` });

  const result = readDraft(dir);
  if (!result) return res.status(404).json({ error: 'No output files found' });

  const { draft } = result;
  console.log(`[Outputs] Revising scenario "${scenario}" — instruction: "${instruction}"`);

  let newScenario;
  try {
    newScenario = await generateScenario(draft.context, scenario, instruction);
  } catch (err) {
    console.error('[Outputs] Scenario revision failed:', err.message);
    return res.status(500).json({ error: err.message });
  }

  const nextVersion = bumpVersion(draft);
  draft.model[scenario] = newScenario;
  const newDraft = {
    ...draft,
    version: nextVersion,
    generatedAt: new Date().toISOString(),
    model: draft.model,
    approvals: { ...(draft.approvals || {}), model: false },
  };

  saveDraft(dir, newDraft);
  return res.json({ ok: true, version: nextVersion, scenario: newScenario });
});

// ── POST /outputs/:slug/revise-vc ────────────────────────────────────────────

router.post('/:slug/revise-vc', async (req, res) => {
  const { instruction } = req.body || {};

  const dir = resolveSlugDir(req.params.slug);
  if (!dir) return res.status(404).json({ error: `No outputs found` });

  const result = readDraft(dir);
  if (!result) return res.status(404).json({ error: 'No output files found' });

  const { draft } = result;
  console.log(`[Outputs] Revising VC list — instruction: "${instruction || '(none)'}"`);

  let newVCs;
  try {
    newVCs = await runSection('vcShortlist', draft.context, instruction || null);
  } catch (err) {
    console.error('[Outputs] VC revision failed:', err.message);
    return res.status(500).json({ error: err.message });
  }

  const nextVersion = bumpVersion(draft);
  const newDraft = {
    ...draft,
    version: nextVersion,
    generatedAt: new Date().toISOString(),
    vcShortlist: newVCs,
    approvals: { ...(draft.approvals || {}), vcShortlist: false },
  };

  saveDraft(dir, newDraft);
  return res.json({ ok: true, version: nextVersion, vcShortlist: newVCs });
});

// ── POST /outputs/:slug/upload-model ─────────────────────────────────────────

router.post('/:slug/upload-model', (req, res) => {
  upload(req, res, async (uploadErr) => {
    if (uploadErr) return res.status(400).json({ error: uploadErr.message });
    if (!req.file) return res.status(400).json({ error: 'No file uploaded' });

    const dir = resolveSlugDir(req.params.slug);
    if (!dir) return res.status(404).json({ error: `No outputs found` });

    const result = readDraft(dir);
    if (!result) return res.status(404).json({ error: 'No output files found' });

    const { draft } = result;
    const ext = path.extname(req.file.originalname).toLowerCase();

    let parsedModel;
    try {
      const XLSX = require('xlsx');
      let workbook;
      if (ext === '.csv') {
        const csvText = req.file.buffer.toString('utf8');
        workbook = XLSX.read(csvText, { type: 'string' });
      } else {
        workbook = XLSX.read(req.file.buffer, { type: 'buffer' });
      }

      // Try to read sheets named Base/Bear/Bull, or fall back to first 3 sheets
      const sheetNames = workbook.SheetNames;
      const scenarioNames = ['base', 'bear', 'bull'];
      parsedModel = { ...draft.model };

      for (const scenario of scenarioNames) {
        const sheetName = sheetNames.find(s => s.toLowerCase() === scenario) ||
                          sheetNames.find(s => s.toLowerCase().includes(scenario));
        if (!sheetName) continue;

        const sheet = workbook.Sheets[sheetName];
        const data = XLSX.utils.sheet_to_json(sheet);
        if (data.length) {
          parsedModel[scenario] = data.map(row => {
            const keys = Object.keys(row);
            return {
              metric: row[keys[0]] || '',
              year1: Number(row[keys[1]]) || 0,
              year2: Number(row[keys[2]]) || 0,
              year3: Number(row[keys[3]]) || 0,
            };
          });
        }
      }
    } catch (err) {
      return res.status(400).json({ error: `Failed to parse file: ${err.message}` });
    }

    const nextVersion = bumpVersion(draft);
    const newDraft = {
      ...draft,
      version: nextVersion,
      generatedAt: new Date().toISOString(),
      model: parsedModel,
      approvals: { ...(draft.approvals || {}), model: false },
    };

    saveDraft(dir, newDraft);
    return res.json({ ok: true, version: nextVersion, model: parsedModel });
  });
});

// ── GET /outputs/:slug/download-model ────────────────────────────────────────

router.get('/:slug/download-model', (req, res) => {
  const dir = resolveSlugDir(req.params.slug);
  if (!dir) return res.status(404).json({ error: `No outputs found` });

  const result = readDraft(dir);
  if (!result) return res.status(404).json({ error: 'No output files found' });

  const { draft } = result;
  const model = draft.model;
  if (!model) return res.status(404).json({ error: 'No model data' });

  const XLSX = require('xlsx');
  const wb = XLSX.utils.book_new();

  for (const scenario of ['Base', 'Bear', 'Bull']) {
    const rows = model[scenario.toLowerCase()];
    if (!Array.isArray(rows)) continue;

    const data = [['Metric', 'Year 1', 'Year 2', 'Year 3']];
    for (const r of rows) {
      data.push([r.metric, r.year1, r.year2, r.year3]);
    }

    if (model.assumptions?.length && scenario === 'Base') {
      data.push([]);
      data.push(['Key Assumptions']);
      for (const a of model.assumptions) data.push([a]);
    }

    const ws = XLSX.utils.aoa_to_sheet(data);
    // Column widths
    ws['!cols'] = [{ wch: 18 }, { wch: 14 }, { wch: 14 }, { wch: 14 }];
    XLSX.utils.book_append_sheet(wb, ws, scenario);
  }

  const buf = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
  const companyName = (draft.context?.companyName || 'Company').replace(/[^a-zA-Z0-9]/g, '_');
  const filename = `${companyName}_Financial_Model_${draft.version || 'v1'}.xlsx`;

  res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  return res.send(Buffer.from(buf));
});

// ── POST /outputs/:slug/export ───────────────────────────────────────────────

function writeDeckMd(exportDir, draft) {
  const lines = [
    `# ${draft.context?.companyName || 'Company'} — Pitch Deck`,
    `_Generated ${draft.generatedAt} · ${draft.version}_`, '',
  ];
  for (const slide of draft.deck || []) {
    lines.push(`## Slide ${slide.slideNumber}: ${slide.title}`);
    for (const b of slide.bullets || []) lines.push(`- ${b}`);
    if (slide.presenterNote) lines.push('', `> **Presenter note:** ${slide.presenterNote}`);
    lines.push('');
  }
  fs.writeFileSync(path.join(exportDir, 'deck.md'), lines.join('\n'), 'utf8');
  return 'deck.md';
}

function writeModelCsv(exportDir, draft) {
  const rows = ['Metric,Year 1,Year 2,Year 3'];
  for (const row of draft.model?.base || []) {
    rows.push(`"${row.metric}",${row.year1},${row.year2},${row.year3}`);
  }
  if (draft.model?.assumptions?.length) {
    rows.push('', 'Key Assumptions');
    for (const a of draft.model.assumptions) rows.push(`"${a.replace(/"/g, '""')}"`);
  }
  fs.writeFileSync(path.join(exportDir, 'model.csv'), rows.join('\n'), 'utf8');
  return 'model.csv';
}

function writeVcsTxt(exportDir, draft) {
  const lines = [
    `${draft.context?.companyName || 'Company'} — VC Shortlist`,
    `Generated ${draft.generatedAt}`,
    '\u2500'.repeat(48), '',
  ];
  for (const vc of draft.vcShortlist || []) {
    lines.push(`#${vc.rank}  ${vc.name} \u2014 ${vc.firm}`);
    lines.push(`    Score : ${vc.score}/100  (Stage ${vc.stageScore} \u00B7 Sector ${vc.sectorScore} \u00B7 Check ${vc.checkScore} \u00B7 Geo ${vc.geoScore})`);
    lines.push(`    Why   : ${vc.reason}`);
    if (vc.website) lines.push(`    Web   : ${vc.website}`);
    lines.push('');
  }
  fs.writeFileSync(path.join(exportDir, 'vcs.txt'), lines.join('\n'), 'utf8');
  return 'vcs.txt';
}

function writeSummaryJson(exportDir, draft) {
  const summary = {
    exportedAt: new Date().toISOString(),
    version: draft.version,
    context: draft.context,
    approvals: draft.approvals,
  };
  fs.writeFileSync(path.join(exportDir, 'summary.json'), JSON.stringify(summary, null, 2), 'utf8');
  return 'summary.json';
}

const SECTION_WRITERS = {
  deck: writeDeckMd,
  model: writeModelCsv,
  vcShortlist: writeVcsTxt,
};

router.post('/:slug/export', (req, res) => {
  const { section } = req.body || {};

  if (section && !SECTION_WRITERS[section]) {
    return res.status(400).json({ error: 'section must be one of: deck, model, vcShortlist' });
  }

  const dir = resolveSlugDir(req.params.slug);
  if (!dir) return res.status(404).json({ error: `No outputs found` });

  const result = readDraft(dir);
  if (!result) return res.status(404).json({ error: 'No output files found' });

  const { draft } = result;
  const approvals = draft.approvals || {};
  const sectionsToExport = section ? [section] : ['deck', 'model', 'vcShortlist'];
  const unapproved = sectionsToExport.filter((s) => !approvals[s]);
  if (unapproved.length > 0) {
    return res.status(400).json({ error: `Cannot export \u2014 not yet approved: ${unapproved.join(', ')}` });
  }

  const exportDir = path.join(dir, 'export');
  fs.mkdirSync(exportDir, { recursive: true });

  const written = [];
  for (const s of sectionsToExport) {
    written.push(SECTION_WRITERS[s](exportDir, draft));
  }
  if (!section) written.push(writeSummaryJson(exportDir, draft));

  const exportPath = `outputs/${path.basename(dir)}/export`;
  console.log(`[Outputs] Exported [${written.join(', ')}] \u2192 ${exportPath}`);
  return res.json({ ok: true, exportPath, files: written });
});

module.exports = router;

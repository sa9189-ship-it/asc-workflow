/**
 * End-to-end pipeline test
 *
 * Usage:   node scripts/test-pipeline.js
 * Assumes: server is already running  →  npm run dev
 */

// Load .env manually — bypasses Claude Code's dotenv hook which drops ANTHROPIC_API_KEY
const fs = require('fs');
const path = require('path');
const envPath = path.join(__dirname, '../.env');
if (fs.existsSync(envPath)) {
  for (const line of fs.readFileSync(envPath, 'utf8').split('\n')) {
    const t = line.trim();
    if (!t || t.startsWith('#')) continue;
    const eq = t.indexOf('=');
    if (eq === -1) continue;
    const key = t.slice(0, eq).trim();
    const val = t.slice(eq + 1).trim();
    if (key) process.env[key] = val;
  }
}

const BASE_URL = `http://localhost:${process.env.PORT || 3000}`;

const TRANSCRIPT =
  'We met with Jordan Chen, founder of LoanFlow, a FinTech startup ' +
  'based in New York. They are pre-seed, building an AI underwriting ' +
  'platform for small business loans. Current ARR is $180k, burn is ' +
  '$45k/month, runway is 14 months. They are raising a $2M seed round. ' +
  'Competitors mentioned: Kabbage, Fundbox, BlueVine.';

// ─── Utilities ────────────────────────────────────────────────────────────────

const hr = (label = '') => {
  const bar = '─'.repeat(56);
  console.log(`\n${bar}${label ? '\n  ' + label : ''}\n${bar}`);
};

const usd = (n) => (n != null ? '$' + Number(n).toLocaleString() : 'n/a');

async function post(path, body) {
  const res = await fetch(`${BASE_URL}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) {
    const msg = json.error || JSON.stringify(json);
    throw new Error(`POST ${path} → ${res.status}: ${msg}`);
  }
  return json;
}

// ─── Step 1: /extract ─────────────────────────────────────────────────────────

async function stepExtract() {
  hr('STEP 1 — POST /extract');
  console.log('  Transcript:\n');
  console.log(`  "${TRANSCRIPT}"\n`);
  console.log('  Calling Claude...');

  const ctx = await post('/extract', { transcript: TRANSCRIPT });

  hr('Extracted Context');

  const rows = [
    ['Company',       ctx.companyName],
    ['Founder',       ctx.founderName],
    ['Sector',        ctx.sector],
    ['Stage',         ctx.stage],
    ['Geography',     ctx.geography],
    ['Problem',       ctx.problemStatement],
    ['ARR',           usd(ctx.arr)],
    ['Burn / month',  usd(ctx.burnRate)],
    ['Runway',        ctx.runway != null ? `${ctx.runway} months` : 'n/a'],
    ['Funding ask',   usd(ctx.fundingAsk)],
    ['Competitors',   ctx.competitors?.length ? ctx.competitors.join(', ') : 'none'],
  ];

  const labelWidth = Math.max(...rows.map(([l]) => l.length)) + 2;
  for (const [label, value] of rows) {
    console.log(`  ${(label + ':').padEnd(labelWidth)} ${value ?? 'n/a'}`);
  }

  return ctx;
}

// ─── Step 2: /generate ───────────────────────────────────────────────────────

async function stepGenerate(ctx) {
  hr('STEP 2 — POST /generate');
  console.log('  Running deck + model + VC scoring in parallel...');

  const result = await post('/generate', ctx);
  console.log(`\n  Draft saved → ${result.outputFile}`);
  return result;
}

// ─── Step 3: Print outputs ───────────────────────────────────────────────────

function printDeck(slides) {
  hr('Deck — Slide Titles');
  if (!Array.isArray(slides) || slides.length === 0) {
    console.log('  (no slides)');
    return;
  }
  for (const s of slides) {
    console.log(`  ${String(s.slideNumber).padStart(2)}.  ${s.title}`);
  }
}

function printModelSummary(model) {
  hr('Financial Model — Base Case: Year 1 Snapshot');
  if (!Array.isArray(model?.base)) {
    console.log('  (no model)');
    return;
  }

  const find = (pattern) =>
    model.base.find((r) => pattern.test(r.metric || ''));

  const revenueRow = find(/^revenue$/i);
  const ebitdaRow  = find(/ebitda/i);

  if (revenueRow) {
    console.log(`  Revenue Y1 : ${usd(revenueRow.year1)}`);
  } else {
    console.log('  Revenue Y1 : n/a');
  }

  if (ebitdaRow) {
    console.log(`  EBITDA  Y1 : ${usd(ebitdaRow.year1)}`);
  } else {
    console.log('  EBITDA  Y1 : n/a');
  }
}

function printTopVCs(vcShortlist) {
  hr('VC Shortlist — Top 3 Matches');
  if (!Array.isArray(vcShortlist) || vcShortlist.length === 0) {
    console.log('  (no VCs — check data/vcs.csv)');
    return;
  }

  for (const vc of vcShortlist.slice(0, 3)) {
    console.log(`\n  #${vc.rank}  ${vc.name} — ${vc.firm}`);
    console.log(`      Score  : ${vc.score}/100  (stage ${vc.stageScore} + sector ${vc.sectorScore} + check ${vc.checkScore} + geo ${vc.geoScore})`);
    console.log(`      Why    : ${vc.reason}`);
    if (vc.website) console.log(`      Web    : ${vc.website}`);
  }
}

// ─── Step 4: PASS / FAIL ─────────────────────────────────────────────────────

function evaluate(result) {
  const checks = [
    ['deck present',        Array.isArray(result.deck) && result.deck.length > 0],
    ['deck has 10 slides',  Array.isArray(result.deck) && result.deck.length === 10],
    ['model present',       result.model?.base?.length > 0],
    ['model has scenarios', result.model?.bear && result.model?.bull],
    ['VC list present',     Array.isArray(result.vcShortlist) && result.vcShortlist.length > 0],
  ];

  hr('PASS / FAIL');
  let allPass = true;
  for (const [label, ok] of checks) {
    console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${label}`);
    if (!ok) allPass = false;
  }

  console.log('');
  if (allPass) {
    console.log('  ✓ All checks passed.\n');
  } else {
    console.log('  ✗ One or more checks failed.\n');
    process.exitCode = 1;
  }
}

// ─── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  console.log('\n╔══════════════════════════════════════════════════╗');
  console.log('║     ASC Workflow — End-to-End Pipeline Test      ║');
  console.log('╚══════════════════════════════════════════════════╝');

  try {
    const ctx    = await stepExtract();
    const result = await stepGenerate(ctx);

    printDeck(result.deck);
    printModelSummary(result.model);
    printTopVCs(result.vcShortlist);
    evaluate(result);

  } catch (err) {
    hr('FAIL');
    console.error(`  ${err.message}\n`);
    process.exit(1);
  }
}

main();

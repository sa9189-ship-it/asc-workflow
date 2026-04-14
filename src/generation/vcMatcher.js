/**
 * STAGE 3 — GENERATION: VC Scoring Engine
 *
 * Reads data/vcs.csv and scores each investor against the company
 * context. Returns the top 10 ranked VCs.
 *
 * CSV columns expected (case-insensitive):
 *   name, firm, geography, stages, sectors, minCheck, maxCheck, website, notes
 *
 * Scoring (total 100 points):
 *   Stage match     — 40 pts
 *   Sector match    — 30 pts
 *   Check size fit  — 20 pts
 *   Geography match — 10 pts
 *
 * @param {object} context
 * @param {string} context.stage        - e.g. "Seed", "Series A"
 * @param {string} context.sector       - e.g. "FinTech", "SaaS"
 * @param {number} context.fundingAsk   - Amount being raised (USD)
 * @param {string} context.geography    - e.g. "NY", "SF"
 *
 * @returns {Promise<object[]>} Top 10 VCs, each:
 *   { rank, name, firm, score, stageScore, sectorScore,
 *     checkScore, geoScore, reason, website }
 */

const fs = require('fs');
const path = require('path');

const VC_CSV_PATH = path.join(__dirname, '../../data/vcs.csv');

// ─── CSV Parser (no external dependency) ────────────────────────────────────

function parseCSV(raw) {
  const lines = raw.trim().split('\n');
  if (lines.length < 2) return [];

  const headers = lines[0].split(',').map((h) => h.trim().toLowerCase().replace(/"/g, ''));

  return lines.slice(1).map((line) => {
    // Handle quoted fields containing commas
    const fields = [];
    let current = '';
    let inQuotes = false;
    for (const char of line) {
      if (char === '"') {
        inQuotes = !inQuotes;
      } else if (char === ',' && !inQuotes) {
        fields.push(current.trim());
        current = '';
      } else {
        current += char;
      }
    }
    fields.push(current.trim());

    const row = {};
    headers.forEach((h, i) => {
      row[h] = (fields[i] || '').replace(/"/g, '').trim();
    });
    return row;
  });
}

// ─── Scoring Helpers ─────────────────────────────────────────────────────────

/**
 * Normalise a string for fuzzy matching: lowercase, no punctuation.
 */
function norm(str) {
  return (str || '').toLowerCase().replace(/[^a-z0-9\s]/g, '').trim();
}

/**
 * Check whether a delimited VC field (e.g. "Seed, Series A") contains
 * a value that matches the target.
 */
function fieldContains(vcField, target) {
  if (!target) return false;
  const normTarget = norm(target);
  const parts = vcField.split(/[,;|\/]/).map((p) => norm(p));
  return parts.some((p) => p.includes(normTarget) || normTarget.includes(p));
}

function scoreStage(vc, stage) {
  if (!stage) return 0;
  if (fieldContains(vc.stages || '', stage)) return 40;
  // Partial: adjacent stages (e.g. asking "Series A", VC does "Seed–B")
  const adjacents = { seed: ['pre-seed', 'series a'], 'series a': ['seed', 'series b'], 'series b': ['series a', 'series c'] };
  const normStage = norm(stage);
  const adj = adjacents[normStage] || [];
  if (adj.some((a) => fieldContains(vc.stages || '', a))) return 20;
  return 0;
}

function scoreSector(vc, sector) {
  if (!sector) return 0;
  return fieldContains(vc.sectors || '', sector) ? 30 : 0;
}

function scoreCheckSize(vc, fundingAsk) {
  if (fundingAsk == null || fundingAsk === 0) return 0;
  const min = parseFloat((vc.mincheck || vc['min check'] || vc.minCheck || '0').replace(/[^0-9.]/g, '')) || 0;
  const max = parseFloat((vc.maxcheck || vc['max check'] || vc.maxCheck || '0').replace(/[^0-9.]/g, '')) || Infinity;

  // Convert: if values look like millions (< 10000), scale up
  const scale = min < 10000 ? 1_000_000 : 1;
  const minUSD = min * scale;
  const maxUSD = max === Infinity ? Infinity : max * scale;

  if (fundingAsk >= minUSD && fundingAsk <= maxUSD) return 20;
  // Within 30% outside range = partial credit
  const lower = minUSD * 0.7;
  const upper = maxUSD * 1.3;
  if (fundingAsk >= lower && fundingAsk <= upper) return 10;
  return 0;
}

function scoreGeography(vc, geography) {
  if (!geography) return 0;
  return fieldContains(vc.geography || '', geography) ? 10 : 0;
}

function buildReason(vc, stageScore, sectorScore, checkScore, geoScore) {
  const parts = [];
  if (stageScore === 40) parts.push(`invests at ${vc.stages} stage`);
  if (sectorScore === 30) parts.push(`focuses on ${vc.sectors}`);
  if (checkScore === 20) parts.push(`check size aligns`);
  else if (checkScore === 10) parts.push(`check size is close`);
  if (geoScore === 10) parts.push(`active in ${vc.geography}`);
  if (parts.length === 0) return 'Partial match on one or more criteria';
  return parts[0].charAt(0).toUpperCase() + parts[0].slice(1) + (parts.length > 1 ? '; ' + parts.slice(1).join('; ') : '') + '.';
}

// ─── Main Export ──────────────────────────────────────────────────────────────

async function scoreVCs(context) {
  if (!fs.existsSync(VC_CSV_PATH)) {
    throw new Error(
      `VC database not found at data/vcs.csv. ` +
      `Please drop your vcs.csv file into the data/ folder before running generation.`
    );
  }

  const raw = fs.readFileSync(VC_CSV_PATH, 'utf8');
  const vcs = parseCSV(raw);

  if (vcs.length === 0) {
    throw new Error('data/vcs.csv is empty or could not be parsed');
  }

  const scored = vcs.map((vc) => {
    const stageScore = scoreStage(vc, context.stage);
    const sectorScore = scoreSector(vc, context.sector);
    const checkScore = scoreCheckSize(vc, context.fundingAsk);
    const geoScore = scoreGeography(vc, context.geography);
    const score = stageScore + sectorScore + checkScore + geoScore;

    return {
      name: vc.name || '',
      firm: vc.firm || '',
      website: vc.website || '',
      score,
      stageScore,
      sectorScore,
      checkScore,
      geoScore,
      reason: buildReason(vc, stageScore, sectorScore, checkScore, geoScore),
    };
  });

  // Sort descending by score, take top 10, add rank
  const top10 = scored
    .filter((v) => v.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, 10)
    .map((v, i) => ({ rank: i + 1, ...v }));

  return top10;
}

module.exports = { scoreVCs };

/**
 * STAGE 3 — GENERATION: Orchestrator
 *
 * Runs all three generators in parallel and returns a combined result object.
 *
 * @param {object} context - Structured data from Stage 2 extraction
 * @returns {Promise<{ deck, model, vcShortlist }>}
 */

const { generateDeckOutline } = require('./deck');
const { generateFinancialModel } = require('./model');
const { scoreVCs } = require('./vcMatcher');

async function runGeneration(context) {
  const [deck, model, vcShortlist] = await Promise.all([
    generateDeckOutline(context),
    generateFinancialModel(context),
    scoreVCs(context),
  ]);

  return { deck, model, vcShortlist };
}

/**
 * Re-run a single output section, optionally with a revision instruction.
 * @param {'deck'|'model'|'vcShortlist'} section
 * @param {object} context
 * @param {string|null} revisionInstruction
 */
async function runSection(section, context, revisionInstruction = null) {
  switch (section) {
    case 'deck':
      return generateDeckOutline(context, revisionInstruction);
    case 'model':
      return generateFinancialModel(context, revisionInstruction);
    case 'vcShortlist':
      return scoreVCs(context); // rule-based; instruction noted but not applied
    default:
      throw new Error(`Unknown section: "${section}"`);
  }
}

module.exports = { runGeneration, runSection };

/**
 * STAGE 3 — GENERATION: Financial Model Scaffold
 *
 * Generates a 3-year, 3-scenario financial model (bear / base / bull)
 * using the extracted company financials as grounding data.
 *
 * @param {object} context
 * @param {number} context.arr        - Current ARR (USD)
 * @param {number} context.burnRate   - Monthly burn (USD)
 * @param {number} context.runway     - Months of runway
 * @param {string} context.stage      - e.g. "Seed", "Series A"
 * @param {string} context.companyName
 *
 * @returns {Promise<object>} {
 *   base:        FinancialTable,
 *   bear:        FinancialTable,
 *   bull:        FinancialTable,
 *   assumptions: string[]
 * }
 *
 * FinancialTable: Array of row objects, one per metric:
 *   { metric, year1, year2, year3 }
 *
 * Rows: Revenue, COGS, Gross Profit, OpEx, EBITDA,
 *       Burn (monthly), Runway (months), Headcount
 */

const Anthropic = require('@anthropic-ai/sdk');

const REQUIRED_ROWS = [
  'Revenue',
  'COGS',
  'Gross Profit',
  'OpEx',
  'EBITDA',
  'Burn (monthly)',
  'Runway (months)',
  'Headcount',
];

function buildPrompt(context) {
  const annualBurn = context.burnRate != null ? context.burnRate * 12 : null;

  return `You are a startup CFO building a 3-year financial model for a VC pitch.

## Company Financials
- Company: ${context.companyName || 'Unknown'}
- Stage: ${context.stage || 'Unknown'}
- Current ARR: ${context.arr != null ? `$${context.arr.toLocaleString()}` : 'Not disclosed'}
- Monthly Burn: ${context.burnRate != null ? `$${context.burnRate.toLocaleString()}` : 'Not disclosed'}
- Annual Burn (implied): ${annualBurn != null ? `$${annualBurn.toLocaleString()}` : 'Not disclosed'}
- Runway: ${context.runway != null ? `${context.runway} months` : 'Not disclosed'}

## Instructions
Build a 3-year financial model with three scenarios:
- **Base case**: realistic growth derived from the company's current metrics
- **Bear case**: base revenue × 0.70 (cost structure same as base)
- **Bull case**: base revenue × 1.30 (cost structure same as base)

For each scenario produce a table with Year 1, Year 2, Year 3 columns and exactly these rows:
${REQUIRED_ROWS.map((r, i) => `${i + 1}. ${r}`).join('\n')}

All monetary values in whole USD (no decimals, no $ symbol in values).
Headcount is a whole number (people).
Runway is a whole number (months).

Also provide an "assumptions" array listing 4–6 key assumptions you made
(growth rate, gross margin target, hiring plan, etc.).

Return ONLY valid JSON — no markdown fences, no explanation. Schema:
{
  "base": [{ "metric": "Revenue", "year1": 0, "year2": 0, "year3": 0 }, ...],
  "bear": [...],
  "bull": [...],
  "assumptions": ["string", ...]
}`;
}

async function generateFinancialModel(context, revisionInstruction = null) {
  const client = new Anthropic();
  let prompt = buildPrompt(context);
  if (revisionInstruction) {
    prompt += `\n\n## Revision Instruction\nThe consultant has reviewed a previous draft and requests the following change:\n${revisionInstruction}\nApply this instruction while keeping the same JSON schema and all required rows.`;
  }

  const message = await client.messages.create({
    model: 'claude-sonnet-4-6',
    max_tokens: 4096,
    messages: [{ role: 'user', content: prompt }],
  });

  const rawText = message.content[0].text.trim();

  let result;
  try {
    result = JSON.parse(rawText);
  } catch (err) {
    const match = rawText.match(/```(?:json)?\s*([\s\S]*?)```/);
    if (match) {
      result = JSON.parse(match[1].trim());
    } else {
      throw new Error(`Failed to parse financial model JSON: ${err.message}`);
    }
  }

  // Validate structure
  for (const scenario of ['base', 'bear', 'bull']) {
    if (!Array.isArray(result[scenario])) {
      throw new Error(`Financial model missing scenario: ${scenario}`);
    }
  }
  if (!Array.isArray(result.assumptions)) {
    result.assumptions = [];
  }

  return result;
}

/**
 * Regenerate a single scenario (bear/base/bull) with a revision instruction.
 * Returns an array of 8 row objects.
 */
async function generateScenario(context, scenario, instruction) {
  const client = new Anthropic();
  const annualBurn = context.burnRate != null ? context.burnRate * 12 : null;
  const label = scenario.charAt(0).toUpperCase() + scenario.slice(1);

  const prompt = `You are a startup CFO revising ONE scenario of a 3-year financial model.

## Company Financials
- Company: ${context.companyName || 'Unknown'}
- Stage: ${context.stage || 'Unknown'}
- Current ARR: ${context.arr != null ? `$${context.arr.toLocaleString()}` : 'Not disclosed'}
- Monthly Burn: ${context.burnRate != null ? `$${context.burnRate.toLocaleString()}` : 'Not disclosed'}
- Annual Burn (implied): ${annualBurn != null ? `$${annualBurn.toLocaleString()}` : 'Not disclosed'}
- Runway: ${context.runway != null ? `${context.runway} months` : 'Not disclosed'}

## Scenario to revise: ${label} case

## Revision Instruction
${instruction}

Produce a table with Year 1, Year 2, Year 3 columns and exactly these rows:
${REQUIRED_ROWS.map((r, i) => `${i + 1}. ${r}`).join('\n')}

All monetary values in whole USD. Headcount = people. Runway = months.

Return ONLY a valid JSON array — no fences, no explanation:
[{ "metric": "Revenue", "year1": 0, "year2": 0, "year3": 0 }, ...]`;

  const message = await client.messages.create({
    model: 'claude-sonnet-4-6',
    max_tokens: 2048,
    messages: [{ role: 'user', content: prompt }],
  });

  const rawText = message.content[0].text.trim();
  let rows;
  try {
    rows = JSON.parse(rawText);
  } catch (err) {
    const match = rawText.match(/```(?:json)?\s*([\s\S]*?)```/);
    if (match) {
      rows = JSON.parse(match[1].trim());
    } else {
      throw new Error(`Failed to parse scenario JSON: ${err.message}`);
    }
  }

  if (!Array.isArray(rows)) throw new Error('Scenario response is not an array');
  return rows;
}

module.exports = { generateFinancialModel, generateScenario };

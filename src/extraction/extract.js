/**
 * STAGE 2 — EXTRACTION
 *
 * extractContext(transcript, documents)
 *
 * Builds a single Claude API call that includes the meeting transcript
 * and any uploaded document text, then returns a structured context
 * object consumed by all Stage 3 generators.
 *
 * @param {string}   transcript          - Raw meeting transcript text
 * @param {string[]} [documents=[]]      - Optional array of document text strings
 *                                         (e.g. contents of uploaded P&L, model, deck)
 *
 * @returns {Promise<{
 *   companyName:      string|null,
 *   founderName:      string|null,
 *   sector:           string|null,
 *   stage:            string|null,
 *   geography:        string|null,
 *   problemStatement: string|null,
 *   arr:              number|null,
 *   burnRate:         number|null,
 *   runway:           number|null,
 *   fundingAsk:       number|null,
 *   competitors:      string[]
 * }>}
 */

const Anthropic = require('@anthropic-ai/sdk');

const SYSTEM_PROMPT =
  'You are a consulting analyst. Extract structured company information ' +
  'from the meeting transcript and documents provided. ' +
  'Return ONLY a valid JSON object — no explanation, no markdown, no code fences.';

function buildUserPrompt(transcript, documents) {
  const parts = [];

  parts.push('## Meeting Transcript');
  parts.push(transcript.trim());

  if (documents.length > 0) {
    documents.forEach((doc, i) => {
      parts.push(`\n## Document ${i + 1}`);
      parts.push(doc.trim());
    });
  }

  parts.push(`
## Instructions
Extract the fields below. Use null for any field not mentioned — never guess.

- companyName      : string | null
- founderName      : string | null
- sector           : string | null   (e.g. "FinTech", "SaaS", "HealthTech")
- stage            : string | null   (normalise to: "Pre-Seed" | "Seed" | "Series A" | "Series B" | "Series C+")
- geography        : string | null   (normalise: New York area → "NY", Bay Area/SF → "SF", else city name)
- problemStatement : string | null   (one sentence describing the core problem being solved)
- arr              : number | null   (Annual Recurring Revenue in whole USD — e.g. $180k → 180000)
- burnRate         : number | null   (monthly cash burn in whole USD)
- runway           : number | null   (months of runway remaining, whole number)
- fundingAsk       : number | null   (amount being raised in whole USD)
- competitors      : string[]        (array of competitor company names; empty array if none mentioned)

Return exactly this JSON shape with no other text:
{
  "companyName": null,
  "founderName": null,
  "sector": null,
  "stage": null,
  "geography": null,
  "problemStatement": null,
  "arr": null,
  "burnRate": null,
  "runway": null,
  "fundingAsk": null,
  "competitors": []
}`);

  return parts.join('\n\n');
}

function parseResponse(rawText) {
  // First try direct parse
  try {
    return JSON.parse(rawText);
  } catch (_) {}

  // Strip code fences and retry
  const fenceMatch = rawText.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (fenceMatch) {
    return JSON.parse(fenceMatch[1].trim());
  }

  // Find first { ... } block and retry
  const braceMatch = rawText.match(/\{[\s\S]*\}/);
  if (braceMatch) {
    return JSON.parse(braceMatch[0]);
  }

  throw new Error('Could not locate a JSON object in the Claude response');
}

async function extractContext(transcript, documents = []) {
  if (!transcript || typeof transcript !== 'string' || transcript.trim().length === 0) {
    throw new Error('transcript must be a non-empty string');
  }

  if (!Array.isArray(documents)) {
    throw new TypeError('documents must be an array of strings');
  }

  const client = new Anthropic();
  const message = await client.messages.create({
    model: 'claude-sonnet-4-6',
    max_tokens: 1024,
    system: SYSTEM_PROMPT,
    messages: [
      {
        role: 'user',
        content: buildUserPrompt(transcript, documents),
      },
    ],
  });

  const rawText = message.content[0].text.trim();

  let extracted;
  try {
    extracted = parseResponse(rawText);
  } catch (err) {
    throw new Error(`Failed to parse extraction response: ${err.message}`);
  }

  // Guarantee competitors is always an array
  if (!Array.isArray(extracted.competitors)) {
    extracted.competitors = extracted.competitors ? [String(extracted.competitors)] : [];
  }

  // Coerce numeric fields — Claude occasionally returns strings like "180000"
  for (const field of ['arr', 'burnRate', 'runway', 'fundingAsk']) {
    if (extracted[field] !== null && extracted[field] !== undefined) {
      const n = Number(extracted[field]);
      extracted[field] = Number.isFinite(n) ? n : null;
    }
  }

  return extracted;
}

module.exports = { extractContext };

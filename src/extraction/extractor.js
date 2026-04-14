/**
 * STAGE 2 — EXTRACTION: Transcript Parser
 *
 * Calls the Claude API to extract structured company data from a
 * raw meeting transcript. The returned object is the canonical
 * "context" object consumed by all Stage 3 generators.
 *
 * @param {string} transcript - Raw text of the meeting transcript
 *
 * @returns {Promise<object>} Structured context:
 *   {
 *     companyName:      string,
 *     founderName:      string,
 *     sector:           string,
 *     stage:            string,       // e.g. "Pre-Seed", "Seed", "Series A"
 *     geography:        string,       // e.g. "NY", "SF"
 *     problemStatement: string,
 *     arr:              number|null,  // Annual Recurring Revenue (USD)
 *     burnRate:         number|null,  // Monthly burn (USD)
 *     runway:           number|null,  // Months
 *     fundingAsk:       number|null,  // USD
 *     competitors:      string[],
 *     rawTranscript:    string
 *   }
 */

const Anthropic = require('@anthropic-ai/sdk');

const client = new Anthropic();

function buildPrompt(transcript) {
  return `You are an expert analyst extracting structured data from a startup meeting transcript.

## Transcript
${transcript}

## Instructions
Extract the following fields from the transcript. Use null for any field that is not mentioned.

For geography: normalise to "NY" if New York area, "SF" if Bay Area / San Francisco, otherwise use the city name.
For stage: normalise to one of: "Pre-Seed", "Seed", "Series A", "Series B", "Series C+".
For ARR, burnRate, fundingAsk: return whole numbers in USD (e.g. $180k → 180000).
For runway: return a whole number of months.
For competitors: return an array of strings (company names only).

Return ONLY a valid JSON object — no markdown fences, no explanation. Schema:
{
  "companyName":      "string or null",
  "founderName":      "string or null",
  "sector":           "string or null",
  "stage":            "string or null",
  "geography":        "string or null",
  "problemStatement": "string or null",
  "arr":              "number or null",
  "burnRate":         "number or null",
  "runway":           "number or null",
  "fundingAsk":       "number or null",
  "competitors":      ["string"]
}`;
}

async function extractFromTranscript(transcript) {
  if (!transcript || typeof transcript !== 'string' || transcript.trim().length === 0) {
    throw new Error('Transcript must be a non-empty string');
  }

  const message = await client.messages.create({
    model: 'claude-sonnet-4-6',
    max_tokens: 1024,
    messages: [
      {
        role: 'user',
        content: buildPrompt(transcript),
      },
    ],
  });

  const rawText = message.content[0].text.trim();

  let extracted;
  try {
    extracted = JSON.parse(rawText);
  } catch (err) {
    const match = rawText.match(/```(?:json)?\s*([\s\S]*?)```/);
    if (match) {
      extracted = JSON.parse(match[1].trim());
    } else {
      throw new Error(`Failed to parse extraction JSON: ${err.message}`);
    }
  }

  // Ensure competitors is always an array
  if (!Array.isArray(extracted.competitors)) {
    extracted.competitors = extracted.competitors ? [extracted.competitors] : [];
  }

  // Attach raw transcript for audit trail
  extracted.rawTranscript = transcript;

  return extracted;
}

module.exports = { extractFromTranscript };

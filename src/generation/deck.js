/**
 * STAGE 3 — GENERATION: Pitch Deck Outline Generator
 *
 * Accepts the structured context object produced by Stage 2 extraction
 * and calls the Claude API to produce a 10-slide pitch deck outline.
 *
 * @param {object} context - Extracted company data from Stage 2
 * @param {string} context.companyName
 * @param {string} context.sector
 * @param {string} context.stage
 * @param {string} context.problemStatement
 * @param {number} context.arr            - Annual Recurring Revenue (USD)
 * @param {number} context.burnRate       - Monthly burn (USD)
 * @param {number} context.runway         - Months of runway remaining
 * @param {string[]} context.competitors
 * @param {number} context.fundingAsk     - Amount being raised (USD)
 *
 * @returns {Promise<object[]>} Array of 10 slide objects:
 *   { slideNumber, title, bullets: string[], presenterNote }
 */

const Anthropic = require('@anthropic-ai/sdk');

const SLIDE_STRUCTURE = `
1. Cover — company name, one-liner tagline
2. Problem — the pain being solved
3. Solution — how the product addresses it
4. Market Size — TAM / SAM / SOM
5. Product — what it does, key features
6. Traction — metrics, growth, milestones
7. Business Model — how revenue is generated
8. Competition — competitive landscape, differentiation
9. Team — founders and key hires
10. The Ask — funding amount and use of funds
`.trim();

function buildPrompt(context) {
  return `You are an expert startup pitch consultant preparing a pitch deck outline for a VC fundraise.

## Company Context
- Company: ${context.companyName || 'Unknown'}
- Sector: ${context.sector || 'Unknown'}
- Stage: ${context.stage || 'Unknown'}
- Problem: ${context.problemStatement || 'Not specified'}
- ARR: ${context.arr != null ? `$${context.arr.toLocaleString()}` : 'Not disclosed'}
- Monthly Burn: ${context.burnRate != null ? `$${context.burnRate.toLocaleString()}` : 'Not disclosed'}
- Runway: ${context.runway != null ? `${context.runway} months` : 'Not disclosed'}
- Competitors: ${context.competitors?.length ? context.competitors.join(', ') : 'Not specified'}
- Funding Ask: ${context.fundingAsk != null ? `$${context.fundingAsk.toLocaleString()}` : 'Not specified'}

## Required Slide Structure
${SLIDE_STRUCTURE}

## Instructions
Generate a 10-slide pitch deck outline following the structure above.
For each slide provide:
- title: a punchy, specific slide title (not just the category name)
- bullets: exactly 3–5 bullet points with concrete, specific content derived from the context
- presenterNote: one sentence on what the presenter should emphasise or watch out for on this slide

Return ONLY a valid JSON array — no markdown fences, no explanation. Schema:
[
  {
    "slideNumber": 1,
    "title": "string",
    "bullets": ["string", "string", "string"],
    "presenterNote": "string"
  },
  ...
]`;
}

async function generateDeckOutline(context, revisionInstruction = null) {
  const client = new Anthropic();
  let prompt = buildPrompt(context);
  if (revisionInstruction) {
    prompt += `\n\n## Revision Instruction\nThe consultant has reviewed a previous draft and requests the following change:\n${revisionInstruction}\nApply this instruction while keeping the overall 10-slide structure intact.`;
  }

  const message = await client.messages.create({
    model: 'claude-sonnet-4-6',
    max_tokens: 4096,
    messages: [{ role: 'user', content: prompt }],
  });

  const rawText = message.content[0].text.trim();

  let slides;
  try {
    slides = JSON.parse(rawText);
  } catch (err) {
    // Claude occasionally wraps in a code fence despite instructions — strip it
    const match = rawText.match(/```(?:json)?\s*([\s\S]*?)```/);
    if (match) {
      slides = JSON.parse(match[1].trim());
    } else {
      throw new Error(`Failed to parse deck outline JSON: ${err.message}`);
    }
  }

  if (!Array.isArray(slides) || slides.length === 0) {
    throw new Error('Deck outline response is not a non-empty array');
  }

  return slides;
}

/**
 * Regenerate a single slide with a revision instruction.
 * Returns a single slide object { slideNumber, title, bullets, presenterNote }.
 */
async function generateSingleSlide(context, currentSlide, instruction) {
  const client = new Anthropic();

  const prompt = `You are an expert startup pitch consultant. You are revising ONE slide from a pitch deck.

## Company Context
- Company: ${context.companyName || 'Unknown'}
- Sector: ${context.sector || 'Unknown'}
- Stage: ${context.stage || 'Unknown'}
- Problem: ${context.problemStatement || 'Not specified'}
- ARR: ${context.arr != null ? `$${context.arr.toLocaleString()}` : 'Not disclosed'}
- Monthly Burn: ${context.burnRate != null ? `$${context.burnRate.toLocaleString()}` : 'Not disclosed'}
- Competitors: ${context.competitors?.length ? context.competitors.join(', ') : 'Not specified'}
- Funding Ask: ${context.fundingAsk != null ? `$${context.fundingAsk.toLocaleString()}` : 'Not specified'}

## Current Slide (Slide ${currentSlide.slideNumber})
Title: ${currentSlide.title}
Bullets: ${JSON.stringify(currentSlide.bullets)}
Presenter Note: ${currentSlide.presenterNote || ''}

## Revision Instruction
${instruction}

Regenerate ONLY this slide. Keep the same slideNumber. Provide an improved title, 3–5 bullets, and a presenterNote.
Return ONLY a valid JSON object — no markdown fences, no explanation:
{
  "slideNumber": ${currentSlide.slideNumber},
  "title": "string",
  "bullets": ["string", ...],
  "presenterNote": "string"
}`;

  const message = await client.messages.create({
    model: 'claude-sonnet-4-6',
    max_tokens: 1024,
    messages: [{ role: 'user', content: prompt }],
  });

  const rawText = message.content[0].text.trim();
  let slide;
  try {
    slide = JSON.parse(rawText);
  } catch (err) {
    const match = rawText.match(/```(?:json)?\s*([\s\S]*?)```/);
    if (match) {
      slide = JSON.parse(match[1].trim());
    } else {
      throw new Error(`Failed to parse slide JSON: ${err.message}`);
    }
  }

  return slide;
}

module.exports = { generateDeckOutline, generateSingleSlide };

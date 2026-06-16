// supportFormatter.js — Formats support call follow-up email using transcript + AI.
//
// Uses Gong transcript utterances to extract per-participant action items via
// Anthropic claude-haiku. Falls back to keyPoints if ANTHROPIC_API_KEY is absent.
//
// Template:
//   Hi {First Name},
//   Below is a summary of our call today...
//   SiteZeus Team
//   * {action}
//   {Client First Name}
//   * {action}
//   Key Decisions
//   * {decision}
//   Next Milestone
//   {milestone}
//   Best, SiteZeus Support Team

import * as config from "./config.js";

const ANTHROPIC_API_URL = "https://api.anthropic.com/v1/messages";
const ANTHROPIC_MODEL = "claude-haiku-4-5-20251001";

// ------------------------------------------------------------------
// Transcript helpers
// ------------------------------------------------------------------

/**
 * Build a readable transcript string from flat sentences.
 * Groups consecutive utterances by the same speaker and maps
 * speakerId → human name using callData.parties.
 */
function buildTranscriptText(transcript, parties) {
  if (!transcript?.length) return "";

  // speakerId → display name
  const speakerMap = {};
  for (const party of (parties || [])) {
    const id = party.speakerId || party.userId || party.id;
    if (!id) continue;
    const isInternal =
      party.affiliation === "internal" ||
      (party.emailAddress || "").toLowerCase().includes(config.SITEZEUS_DOMAIN || "sitezeus.com");
    speakerMap[id] = isInternal
      ? "SiteZeus"
      : ((party.name || "Client").split(" ")[0]);
  }

  // Group consecutive sentences by speaker into utterances
  const utterances = [];
  let current = null;
  for (const s of transcript) {
    if (!s.text?.trim()) continue;
    const name = speakerMap[s.speakerId] || "Speaker";
    if (!current || current.name !== name) {
      current = { name, texts: [] };
      utterances.push(current);
    }
    current.texts.push(s.text.trim());
  }

  return utterances
    .map(u => `${u.name}: ${u.texts.join(" ")}`)
    .join("\n");
}

// ------------------------------------------------------------------
// AI extraction
// ------------------------------------------------------------------

/**
 * Call Anthropic to extract structured action items from the transcript.
 * Returns null on failure (triggers keyPoints fallback).
 */
async function extractActionsFromTranscript(transcriptText, prospectFirstName) {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey || !transcriptText) return null;

  const prompt = `You are writing a follow-up call summary email on behalf of the SiteZeus team member who hosted this support call. Write in FIRST PERSON as if the SiteZeus rep is writing directly to ${prospectFirstName}.

Transcript:
${transcriptText.slice(0, 12000)}

Return ONLY valid JSON in this exact format (no markdown, no extra text):
{
  "sitezeusActions": ["action 1", "action 2"],
  "clientActions": ["action 1", "action 2"],
  "keyDecisions": ["decision 1"],
  "nextMilestone": "one sentence describing the next concrete step or deliverable"
}

Rules:
- sitezeusActions: commitments from the SiteZeus team — write in FIRST PERSON: "I will..." or "We will..." — NEVER use a name in third person. Examples: "I will send over the updated model link", "We will adjust the drive-time settings and re-run the analysis"
- clientActions: things ${prospectFirstName} committed to do — use format "${prospectFirstName} to [action]". Examples: "${prospectFirstName} to review the new model and provide feedback", "${prospectFirstName} to confirm site addresses before the next session"
- keyDecisions: major agreements or decisions made together — write as "We agreed..." or "We decided..."
- nextMilestone: the next scheduled meeting or key deliverable — write as "Our next step is..." or "We have a follow-up scheduled for..."
- ALL items must be positive and forward-looking — no mention of issues, bugs, errors, or problems
- Keep each bullet under 15 words
- Return empty arrays/string if no clear items exist for a field`;

  try {
    const res = await fetch(ANTHROPIC_API_URL, {
      method: "POST",
      headers: {
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
        "content-type": "application/json",
      },
      body: JSON.stringify({
        model: ANTHROPIC_MODEL,
        max_tokens: 1024,
        messages: [{ role: "user", content: prompt }],
      }),
    });

    if (!res.ok) {
      const errText = await res.text();
      console.warn(`[Support] Anthropic API error ${res.status}: ${errText.slice(0, 200)}`);
      return null;
    }

    const data = await res.json();
    const text = (data.content?.[0]?.text || "").trim();

    const jsonMatch = text.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      console.warn("[Support] Anthropic response had no JSON:", text.slice(0, 200));
      return null;
    }

    return JSON.parse(jsonMatch[0]);
  } catch (err) {
    console.warn(`[Support] AI extraction failed: ${err.message}`);
    return null;
  }
}

// ------------------------------------------------------------------
// Fallback (no API key or AI failure)
// ------------------------------------------------------------------

function extractFallbackActions(callData, prospectFirstName) {
  const content = callData.content || {};
  const points = (content.keyPoints || [])
    .map(kp => (typeof kp === "string" ? kp : kp?.text || kp?.title || ""))
    .map(t => t.trim())
    .filter(Boolean);

  return {
    sitezeusActions: points.slice(0, 3),
    clientActions: points.slice(3, 5).map(p => `${prospectFirstName} to ${p.toLowerCase()}`),
    keyDecisions: [],
    nextMilestone: "",
  };
}

// ------------------------------------------------------------------
// Public API
// ------------------------------------------------------------------

/**
 * Format the support follow-up email from transcript + AI.
 * @returns {{ subject: string, html: string }}
 */
export async function formatSupportEmail(callData, prospectFirstName, callName, transcript = []) {
  const parties = callData.parties || [];

  // Build readable transcript
  const transcriptText = buildTranscriptText(transcript, parties);
  console.info(`[Support] Transcript: ${transcript.length} sentences, ${transcriptText.length} chars`);

  // Extract actions — AI first, fall back to keyPoints
  let extracted = await extractActionsFromTranscript(transcriptText, prospectFirstName);
  if (!extracted) {
    console.info("[Support] Falling back to keyPoints for action extraction");
    extracted = extractFallbackActions(callData, prospectFirstName);
  }

  const { sitezeusActions, clientActions, keyDecisions, nextMilestone } = extracted;

  const subject = `SiteZeus Call Summary — ${callName}`;
  const html = buildSupportHtml({ prospectFirstName, sitezeusActions, clientActions, keyDecisions, nextMilestone });

  return { subject, html };
}

// ------------------------------------------------------------------
// HTML builder
// ------------------------------------------------------------------

function li(items) {
  return items.map(i => `<li>${i}</li>`).join("");
}

function buildSupportHtml({ prospectFirstName, sitezeusActions, clientActions, keyDecisions, nextMilestone }) {
  const s = (arr) => arr?.length > 0;
  const parts = [
    `<div style="font-family:Arial,Helvetica,sans-serif;font-size:14px;color:#333;max-width:640px;line-height:1.6;">`,
    `<p>Hi ${prospectFirstName},</p>`,
    `<p>Below is a summary of our call today. Please don't hesitate to reach out with any questions!</p>`,

    // SiteZeus Team section
    `<p><strong>SiteZeus Team</strong></p>`,
    `<ul>${s(sitezeusActions) ? li(sitezeusActions) : "<li>Follow up on next steps discussed on the call</li>"}</ul>`,

    // Client section
    `<p><strong>${prospectFirstName}</strong></p>`,
    `<ul>${s(clientActions) ? li(clientActions) : "<li>Review materials shared during the call</li>"}</ul>`,
  ];

  // Key Decisions
  if (s(keyDecisions)) {
    parts.push(
      `<p><strong>Key Decisions</strong></p>`,
      `<ul>${li(keyDecisions)}</ul>`
    );
  }

  // Next Milestone
  if (nextMilestone) {
    parts.push(
      `<p><strong>Next Milestone</strong></p>`,
      `<p>${nextMilestone}</p>`
    );
  }

  parts.push(
    `<p>Best,<br>SiteZeus Support Team</p>`,
    `</div>`
  );

  return parts.join("\n");
}

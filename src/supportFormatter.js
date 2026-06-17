// supportFormatter.js — Formats the Support follow-up email for CSM review.
//
// Claude reads the call transcript and produces a scannable recap: a short
// "Quick Call Review", action items grouped by owner, key decisions, and the
// next milestone. Written from the perspective of the SiteZeus participant
// who led the call.

import * as config from "./config.js";

const ANTHROPIC_API_URL = "https://api.anthropic.com/v1/messages";
const ANTHROPIC_MODEL = "claude-sonnet-4-6";

function escapeHtml(s) {
  return String(s || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function buildTranscriptText(transcript, parties) {
  if (!transcript?.length) return "";
  const speakerMap = {};
  for (const party of (parties || [])) {
    const id = party.speakerId || party.userId || party.id;
    if (!id) continue;
    const isInternal =
      party.affiliation === "internal" ||
      (party.emailAddress || "").toLowerCase().includes(config.SITEZEUS_DOMAIN || "sitezeus.com");
    const first = (party.name || (isInternal ? "SiteZeus" : "Client")).split(" ")[0];
    speakerMap[id] = isInternal ? `${first} (SiteZeus)` : `${first} (Client)`;
  }
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
  return utterances.map(u => `${u.name}: ${u.texts.join(" ")}`).join("\n");
}

function primaryInternalSpeaker(transcript, parties) {
  const internalNames = {};
  for (const p of (parties || [])) {
    const id = p.speakerId || p.userId || p.id;
    if (!id) continue;
    const isInternal =
      p.affiliation === "internal" ||
      (p.emailAddress || "").toLowerCase().includes(config.SITEZEUS_DOMAIN || "sitezeus.com");
    if (isInternal && p.name) internalNames[id] = p.name.trim();
  }
  const words = {};
  for (const s of (transcript || [])) {
    if (!internalNames[s.speakerId] || !s.text) continue;
    words[s.speakerId] = (words[s.speakerId] || 0) + s.text.trim().split(/\s+/).length;
  }
  let bestId = null, best = -1;
  for (const [id, n] of Object.entries(words)) if (n > best) { best = n; bestId = id; }
  if (!bestId) return null;
  const name = internalNames[bestId];
  return { name, firstName: name.split(" ")[0] };
}

function participantRoster(parties) {
  const internal = [], external = [];
  for (const p of (parties || [])) {
    const name = (p.name || "").trim();
    if (!name) continue;
    const isInternal =
      p.affiliation === "internal" ||
      (p.emailAddress || "").toLowerCase().includes(config.SITEZEUS_DOMAIN || "sitezeus.com");
    (isInternal ? internal : external).push(name);
  }
  return { internal, external };
}

async function extractSupportContent({ transcriptText, roster, senderName }) {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey || !transcriptText) return null;

  const rosterText = `SiteZeus team: ${roster.internal.join(", ") || "(unknown)"}\nCustomer team: ${roster.external.join(", ") || "(unknown)"}`;

  const prompt = `You are ${senderName} from SiteZeus, recapping this customer call. Write a concise, scannable recap that you could send with little or no editing. Sound like a real person, not an AI. Focus on outcomes, commitments, and what happens next — not a transcript summary.

Participants:
${rosterText}

Transcript:
${transcriptText.slice(0, 14000)}

Return ONLY this JSON — no markdown, no commentary:
{
  "quickReview": ["2-4 short bullets on progress made, positive outcomes, key points, or agreed direction"],
  "actionItems": [
    { "owner": "SiteZeus Team (Name)" or "Customer Team (Name)", "items": ["what they committed to do, with a date if one was stated"] }
  ],
  "keyDecisions": ["each decision that was explicitly agreed"],
  "nextMilestone": "one sentence for the next agreed meeting/deadline, or empty string"
}

Rules:
- quickReview: positive framing, no filler, 2-4 bullets.
- actionItems: group by owner using real participant names from the roster above. ONLY include commitments explicitly made for AFTER the call. Skip anything merely demonstrated or discussed. Do not create empty owner groups. Empty array if nothing was committed.
- keyDecisions: only decisions explicitly made. Empty array otherwise.
- nextMilestone: only if a future meeting/deadline was agreed. Empty string otherwise.
- Never invent action items, decisions, owners, or dates. Keep the whole email under 300 words.`;

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
        max_tokens: 900,
        temperature: 0.4,
        messages: [{ role: "user", content: prompt }],
      }),
    });
    if (!res.ok) { console.warn(`[Support] API error ${res.status}`); return null; }
    const data = await res.json();
    const text = (data.content?.[0]?.text || "").trim();
    const jsonMatch = text.match(/\{[\s\S]*\}/);
    if (!jsonMatch) { console.warn("[Support] No JSON:", text.slice(0, 200)); return null; }
    return JSON.parse(jsonMatch[0]);
  } catch (err) {
    console.warn(`[Support] AI extraction failed: ${err.message}`);
    return null;
  }
}

export async function formatSupportReviewEmail({ callData, csmName, csmEmail, clientFirstName, clientEmail, callName, transcript = [] }) {
  const parties = callData.parties || [];
  const content = callData.content || {};
  const transcriptText = buildTranscriptText(transcript, parties);
  console.info(`[Support] Transcript: ${transcript.length} sentences, ${transcriptText.length} chars`);

  const roster = participantRoster(parties);
  const primary = primaryInternalSpeaker(transcript, parties);
  const senderName = primary?.name || csmName || "SiteZeus Support Team";

  const aiContent = await extractSupportContent({ transcriptText, roster, senderName });

  let quickReview = [];
  let actionGroups = [];
  let keyDecisions = [];
  let nextMilestone = "";

  if (aiContent) {
    quickReview = (aiContent.quickReview || []).map(b => String(b).trim()).filter(Boolean);
    actionGroups = (aiContent.actionItems || [])
      .map(g => ({ owner: String(g.owner || "").trim(), items: (g.items || []).map(i => String(i).trim()).filter(Boolean) }))
      .filter(g => g.owner && g.items.length);
    keyDecisions = (aiContent.keyDecisions || []).map(d => String(d).trim()).filter(Boolean);
    nextMilestone = (aiContent.nextMilestone || "").trim();
    console.info(`[Support] AI extracted ${actionGroups.length} owner group(s), ${keyDecisions.length} decision(s)`);
  } else {
    // Gong fallback — raw action strings under a single group.
    const gongActions = (content.actions || [])
      .map(a => (typeof a === "string" ? a : a?.text || a?.description || ""))
      .map(t => t.trim()).filter(Boolean);
    if (gongActions.length) actionGroups = [{ owner: "Action Items", items: gongActions }];
  }

  const supportHtml = buildClientHtml({ clientFirstName, callName, senderName, quickReview, actionGroups, keyDecisions, nextMilestone });
  const wrapperHtml = buildCsmWrapper({ csmEmail, clientFirstName, clientEmail, callName, supportHtml });
  const subject = `[REVIEW & SEND] Support follow-up for ${clientFirstName} — ${callName}`;
  return { subject, wrapperHtml, supportHtml };
}

function buildClientHtml({ clientFirstName, callName, senderName, quickReview, actionGroups, keyDecisions, nextMilestone }) {
  const parts = [
    `<p>Hi ${escapeHtml(clientFirstName)},</p>`,
    `<p>Below is a summary of the action items discussed during ${escapeHtml(callName)}.</p>`,
  ];

  if (quickReview.length) {
    parts.push(`<p><strong>Quick Call Review</strong></p>`);
    parts.push(`<ul>${quickReview.map(b => `<li>${escapeHtml(b)}</li>`).join("")}</ul>`);
  }

  if (actionGroups.length) {
    parts.push(`<p><strong>Action Items</strong></p>`);
    for (const g of actionGroups) {
      parts.push(`<p style="margin:8px 0 2px;"><strong>${escapeHtml(g.owner)}</strong></p>`);
      parts.push(`<ul>${g.items.map(i => `<li>${escapeHtml(i)}</li>`).join("")}</ul>`);
    }
  } else {
    parts.push(`<p>No specific action items came out of today's call — we'll be in touch if anything comes up.</p>`);
  }

  if (keyDecisions.length) {
    parts.push(`<p><strong>Key Decisions</strong></p>`);
    parts.push(`<ul>${keyDecisions.map(d => `<li>${escapeHtml(d)}</li>`).join("")}</ul>`);
  }

  if (nextMilestone) {
    parts.push(`<p><strong>Next Milestone</strong></p>`);
    parts.push(`<ul><li>${escapeHtml(nextMilestone)}</li></ul>`);
  }

  parts.push(`<p>Best,<br>${escapeHtml(senderName)}</p>`);
  return parts.join("\n");
}

function buildCsmWrapper({ csmEmail, clientFirstName, clientEmail, callName, supportHtml }) {
  return `
<div style="font-family:Arial,Helvetica,sans-serif;font-size:14px;color:#333;max-width:680px;">
<div style="background:#fff8e1;padding:14px 18px;border-left:5px solid #f9a825;margin-bottom:20px;border-radius:3px;">
<strong>ACTION REQUIRED — Review &amp; Send</strong><br><br>
Draft support follow-up for <strong>${escapeHtml(clientFirstName)}</strong> (<a href="mailto:${escapeHtml(clientEmail)}">${escapeHtml(clientEmail)}</a>).<br>
<strong>Call:</strong> ${escapeHtml(callName)}<br><br>
Review below, edit as needed, then send from <strong>${escapeHtml(csmEmail)}</strong>.<br>
<em>Do not reply — generated automatically.</em>
</div>
<hr style="border:none;border-top:1px solid #ddd;margin:0 0 20px 0;">
<div style="border:1px solid #e0e0e0;padding:20px;border-radius:4px;background:#fafafa;">
${supportHtml}
</div>
</div>
`;
}

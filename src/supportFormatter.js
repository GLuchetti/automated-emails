// supportFormatter.js — Formats the Support follow-up email for CSM review.

import * as config from "./config.js";

const ANTHROPIC_API_URL = "https://api.anthropic.com/v1/messages";
const ANTHROPIC_MODEL = "claude-haiku-4-5-20251001";

function buildTranscriptText(transcript, parties) {
  if (!transcript?.length) return "";
  const speakerMap = {};
  for (const party of (parties || [])) {
    const id = party.speakerId || party.userId || party.id;
    if (!id) continue;
    const isInternal =
      party.affiliation === "internal" ||
      (party.emailAddress || "").toLowerCase().includes(config.SITEZEUS_DOMAIN || "sitezeus.com");
    speakerMap[id] = isInternal ? "SiteZeus" : (party.name || "Client").split(" ")[0];
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

async function extractActionItems(transcriptText) {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey || !transcriptText) return null;

  const prompt = `Read this support call transcript and extract ONLY explicit future commitments — things promised to happen AFTER this call ends.

Transcript:
${transcriptText.slice(0, 12000)}

Return ONLY this exact JSON — no markdown, no explanation:
{
  "actionItems": [
    { "topic": "Short Topic Label", "note": "brief description of what will happen" }
  ],
  "nextMilestone": "one sentence for any agreed next meeting or deadline, or empty string"
}

Rules for actionItems:
- Each item needs a SHORT topic label (2-5 words, title case, e.g. "Mobile Data Priority", "Report Delivery", "Follow-Up Call")
- The note describes what will happen — it does NOT need to start with "I will" or "We will". Write it naturally, like: "mobile data not yet been pulled but would be prioritized this week" or "custom report will be sent by end of week"
- ONLY include things explicitly committed to happen AFTER the call
- SKIP anything demonstrated, shown, walked through, or discussed during the call
- If nothing was committed, return []

Rules for nextMilestone:
- One sentence for an agreed future meeting or deadline, or empty string`;

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
        max_tokens: 512,
        temperature: 0,
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

  const aiContent = await extractActionItems(transcriptText);

  let actionItems = [];
  let nextMilestone = "";

  if (aiContent) {
    actionItems = (aiContent.actionItems || []).filter(i => i.topic && i.note);
    nextMilestone = aiContent.nextMilestone?.trim() || "";
    console.info(`[Support] AI extracted ${actionItems.length} action items`);
  } else {
    // Gong fallback — use raw action strings
    const gongActions = (content.actions || [])
      .map(a => (typeof a === "string" ? a : a?.text || a?.description || ""))
      .map(t => t.trim()).filter(Boolean);
    actionItems = gongActions.map(note => ({ topic: "Follow-up Item", note }));
  }

  const supportHtml = buildClientHtml({ clientFirstName, csmName, actionItems, nextMilestone });
  const wrapperHtml = buildCsmWrapper({ csmEmail, clientFirstName, clientEmail, callName, supportHtml });
  const subject = `[REVIEW & SEND] Support follow-up for ${clientFirstName} — ${callName}`;
  return { subject, wrapperHtml, supportHtml };
}

function buildClientHtml({ clientFirstName, csmName, actionItems, nextMilestone }) {
  const parts = [
    `<p>Hi ${clientFirstName},</p>`,
    `<p>Below is a summary of our call today. Please don't hesitate to reach out with any questions!</p>`,
    `<p>SiteZeus Team</p>`,
  ];

  if (actionItems.length) {
    const bullets = actionItems
      .map(i => `<li><strong>${i.topic}:</strong> ${i.note}</li>`)
      .join("");
    parts.push(`<ul>${bullets}</ul>`);
  } else {
    parts.push(`<p>No specific action items came out of today's call — we'll be in touch if anything comes up.</p>`);
  }

  if (nextMilestone) {
    parts.push(`<p>${nextMilestone}</p>`);
  }

  parts.push(`<p>Best,<br>SiteZeus Support Team</p>`);
  return parts.join("\n");
}

function buildCsmWrapper({ csmEmail, clientFirstName, clientEmail, callName, supportHtml }) {
  return `
<div style="font-family:Arial,Helvetica,sans-serif;font-size:14px;color:#333;max-width:680px;">
<div style="background:#fff8e1;padding:14px 18px;border-left:5px solid #f9a825;margin-bottom:20px;border-radius:3px;">
<strong>ACTION REQUIRED — Review &amp; Send</strong><br><br>
Draft support follow-up for <strong>${clientFirstName}</strong> (<a href="mailto:${clientEmail}">${clientEmail}</a>).<br>
<strong>Call:</strong> ${callName}<br><br>
Review below, edit as needed, then send from <strong>${csmEmail}</strong>.<br>
<em>Do not reply — generated automatically.</em>
</div>
<hr style="border:none;border-top:1px solid #ddd;margin:0 0 20px 0;">
<div style="border:1px solid #e0e0e0;padding:20px;border-radius:4px;background:#fafafa;">
${supportHtml}
</div>
</div>
`;
}

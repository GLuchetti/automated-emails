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

async function extractActionsFromTranscript(transcriptText, clientFirstName) {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey || !transcriptText) return null;

  const prompt = `Read this support call transcript and extract ONLY future commitments and action items.

Transcript:
${transcriptText.slice(0, 12000)}

Return ONLY this exact JSON — no markdown, no explanation:
{
  "ourCommitments": ["commitment1", "commitment2"],
  "clientActions": ["action1", "action2"],
  "nextMilestone": "one sentence describing the agreed next milestone, or empty string"
}

Rules for ourCommitments:
- Include ONLY things SiteZeus explicitly agreed to do after this call
- Write each item starting with "We will..." or "I will..." (first person)
- Do NOT describe anything that happened during the call (no "We showed", "We walked through", "We demonstrated", "We discussed")
- If nothing was explicitly committed, return []

Rules for clientActions:
- Include ONLY things ${clientFirstName} explicitly agreed to do
- Write each item starting with "${clientFirstName} will..."
- If nothing was committed, return []

Rules for nextMilestone:
- One sentence describing the agreed next step or meeting, or "" if none`;

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
    if (!res.ok) {
      console.warn(`[Support] Anthropic API error ${res.status}: ${(await res.text()).slice(0, 200)}`);
      return null;
    }
    const data = await res.json();
    const text = (data.content?.[0]?.text || "").trim();
    const jsonMatch = text.match(/\{[\s\S]*\}/);
    if (!jsonMatch) { console.warn("[Support] No JSON in response:", text.slice(0, 200)); return null; }
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

  const aiContent = await extractActionsFromTranscript(transcriptText, clientFirstName);

  let sitezeusActions, clientActions, nextMilestone;

  if (aiContent) {
    sitezeusActions = (aiContent.ourCommitments || []).filter(Boolean);
    clientActions = (aiContent.clientActions || []).filter(Boolean);
    nextMilestone = aiContent.nextMilestone?.trim() || "";
    console.info(`[Support] AI extracted: ${sitezeusActions.length} our commitments, ${clientActions.length} client actions`);
  } else {
    console.info("[Support] Falling back to Gong AI content fields");
    const gongActions = (content.actions || [])
      .map(a => (typeof a === "string" ? a : a?.text || a?.description || ""))
      .map(t => t.trim()).filter(Boolean);
    sitezeusActions = gongActions.filter(a => /\b(we|i|sitezeus)\b/i.test(a));
    clientActions = gongActions.filter(a => !sitezeusActions.includes(a));
    nextMilestone = "";
  }

  const supportHtml = buildClientHtml({ clientFirstName, csmName, sitezeusActions, clientActions, nextMilestone });
  const wrapperHtml = buildCsmWrapper({ csmEmail, clientFirstName, clientEmail, callName, supportHtml });
  const subject = `[REVIEW & SEND] Support follow-up for ${clientFirstName} — ${callName}`;
  return { subject, wrapperHtml, supportHtml };
}

function bulletList(items) {
  return `<ul>${items.map(i => `<li>${i}</li>`).join("")}</ul>`;
}

function buildClientHtml({ clientFirstName, csmName, sitezeusActions, clientActions, nextMilestone }) {
  const parts = [
    `<p>Hi ${clientFirstName},</p>`,
    `<p>Thank you for connecting with us today. Here's a quick recap of what we'll be doing next:</p>`,
  ];
  if (sitezeusActions.length) {
    parts.push(`<p><strong>What we're doing for you:</strong></p>`, bulletList(sitezeusActions));
  }
  if (clientActions.length) {
    parts.push(`<p><strong>Action items for your team:</strong></p>`, bulletList(clientActions));
  }
  if (nextMilestone) {
    parts.push(`<p><strong>Next milestone:</strong></p>`, `<p>${nextMilestone}</p>`);
  }
  parts.push(`<p>Please don't hesitate to reach out if you have any questions in the meantime.</p>`);
  parts.push(`<p>Best,<br>${csmName}<br>SiteZeus Customer Success</p>`);
  return parts.join("\n");
}

function buildCsmWrapper({ csmEmail, clientFirstName, clientEmail, callName, supportHtml }) {
  return `
<div style="font-family:Arial,Helvetica,sans-serif;font-size:14px;color:#333;max-width:680px;">
<div style="background:#fff8e1;padding:14px 18px;border-left:5px solid #f9a825;margin-bottom:20px;border-radius:3px;">
<strong>ACTION REQUIRED — Review &amp; Send</strong><br><br>
This is a draft support follow-up for <strong>${clientFirstName}</strong>
(<a href="mailto:${clientEmail}">${clientEmail}</a>).<br>
<strong>Call:</strong> ${callName}<br><br>
Review the draft below. Edit as needed, then send it from your own account (<strong>${csmEmail}</strong>).<br>
<em>Do not reply to this message — it was sent automatically.</em>
</div>
<hr style="border:none;border-top:1px solid #ddd;margin:0 0 20px 0;">
<div style="border:1px solid #e0e0e0;padding:20px;border-radius:4px;background:#fafafa;">
${supportHtml}
</div>
</div>
`;
}

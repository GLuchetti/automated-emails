// salesFormatter.js — Formats the Sales follow-up email for rep review.
//
// Claude reads the call transcript and writes a short, human-sounding
// follow-up from the perspective of the SiteZeus rep who led the call.
// Resources are selected from the curated catalog in config.js (the script
// has no live web access) and given a call-specific reason.

import * as config from "./config.js";
import { extractJson } from "./anthropic.js";

function escapeHtml(s) {
  return String(s || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

// The template already opens with "Hi {name}," + "Thank you for hopping on the
// call today." Strip any leading greeting/pleasantry the model adds anyway, so
// the body starts with the recap rather than a second hello.
function stripLeadingGreeting(body) {
  if (!body) return body;
  let text = body.trimStart();
  const GREETING_RE = /^(hi|hey|hello|dear)\b[^.!?\n]*[.!?\n]+\s*/i;
  const PLEASANTRY_RE = /^[^.!?\n]*\b(really enjoyed|enjoyed (the |our )?(call|conversation|chat|connecting|meeting)|great (catching up|to (connect|chat|meet|speak)|connecting|meeting|chatting|speaking)|glad we (got to )?(connect|chat|met|spoke|connected|talked)|good (talking|speaking|connecting)|thanks (so much )?for|thank you (so much )?for|appreciate you|nice (to )?(meet|chat|connect|speak))\b[^.!?\n]*[.!?]+\s*/i;
  for (let i = 0; i < 2; i++) {
    if (GREETING_RE.test(text)) { text = text.replace(GREETING_RE, ""); continue; }
    if (PLEASANTRY_RE.test(text)) { text = text.replace(PLEASANTRY_RE, ""); continue; }
    break;
  }
  return text.trim() || body.trim(); // never return empty
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
    const first = (party.name || (isInternal ? "Rep" : "Prospect")).split(" ")[0];
    speakerMap[id] = isInternal ? `${first} (SiteZeus)` : `${first} (Prospect)`;
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

// Pick the SiteZeus participant who spoke the most — they led the call and
// the follow-up should appear to come from them.
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

// Unique resource catalog the model may choose from.
function resourceCatalog() {
  const seen = new Set();
  const list = [];
  for (const r of config.ENTERPRISE_RESOURCES) {
    if (seen.has(r.name)) continue;
    seen.add(r.name);
    list.push(r);
  }
  return list;
}

async function extractSalesContent({ transcriptText, prospectFirstName, prospectCompany, senderName }) {
  if (!transcriptText) return null;

  const companyRef = prospectCompany || `${prospectFirstName}'s company`;
  const catalog = resourceCatalog();
  const catalogText = catalog.map(r => `- ${r.name} — topics: ${(r.topics || []).join(", ")}`).join("\n");

  const prompt = `You are ${senderName}, a SiteZeus sales rep who was on this call with ${prospectFirstName} from ${companyRef}. You are drafting the BODY of a short, human follow-up email. The email is ALREADY opened for you with a greeting line ("Hi ${prospectFirstName},") and a second line ("Thank you for hopping on the call today.") — your text comes immediately AFTER those two lines.

Transcript:
${transcriptText.slice(0, 14000)}

Return ONLY this JSON — no markdown, no commentary:
{
  "body": "The greeting and thank-you line are ALREADY written — your body must NOT include any greeting, must NOT thank them for their time, and must NOT address them by name or say things like 'great catching up' / 'really enjoyed the conversation'. Start the FIRST sentence directly with the recap: e.g. 'We discussed your goal of...' or 'You shared that your team is looking for a more efficient way to...'. 1-2 short paragraphs (separate with a blank line) connecting the prospect's goal -> the challenge they described -> how SiteZeus helps. First person ('I', 'we', 'our team'), second person ('you', 'your'). Reference specific things from THIS call. Frame challenges positively. No buzzwords, no overselling, no invented capabilities.",
  "nextSteps": ["Each explicitly agreed next step, with date/time if it was stated, e.g. 'Demo scheduled for July 18 at 2:00 PM ET'"],
  "resources": [ { "name": "EXACT name from the list below", "reason": "one short sentence tying it to something specific discussed on this call" } ]
}

Available resources (choose 0-5, only the genuinely relevant ones; if none fit, return []):
${catalogText}

Rules:
- body: max ~150 words, outcome-focused, never restate the whole call, never invent anything.
- nextSteps: ONLY steps explicitly discussed. Empty array if none. Never invent.
- resources: pick from the list by EXACT name only. Each needs a personalized, call-specific reason. Never recommend generic content.
- Keep the whole thing under 250 words. Do not mention features that were not discussed.`;

  return extractJson({ prompt, maxTokens: 900, temperature: 0.5, label: "Sales" });
}

// Map AI-selected resource names back to catalog URLs, dropping any the model
// invented. Returns [{ name, url, reason }].
function resolveResources(aiResources) {
  const urlByName = {};
  for (const r of resourceCatalog()) urlByName[r.name.toLowerCase()] = r.url;
  const out = [];
  const seen = new Set();
  for (const r of (aiResources || [])) {
    const url = urlByName[(r.name || "").toLowerCase()];
    if (!url || seen.has(url)) continue;
    seen.add(url);
    out.push({ name: r.name, url, reason: (r.reason || "").trim() });
    if (out.length >= 5) break;
  }
  return out;
}

// Fallback resource selection by topic keyword (used when AI is unavailable).
function selectResourcesByTopic(topics, isEnterprise) {
  const pool = isEnterprise ? config.ENTERPRISE_RESOURCES : config.SMB_EMERGING_RESOURCES;
  const selected = [];
  const seen = new Set();
  for (const resource of pool) {
    if (selected.length >= 3) break;
    for (const topic of resource.topics || []) {
      if (topics.some(t => t.includes(topic) || topic.includes(t)) && !seen.has(resource.name)) {
        selected.push({ name: resource.name, url: resource.url, reason: "" });
        seen.add(resource.name);
        break;
      }
    }
  }
  return selected;
}

export async function formatSalesReviewEmail({ callData, repName, repEmail, prospectFirstName, prospectEmail, prospectCompany, isEnterprise, callName, transcript = [] }) {
  const parties = callData.parties || [];
  const content = callData.content || {};
  const transcriptText = buildTranscriptText(transcript, parties);
  console.info(`[Sales] Transcript: ${transcript.length} sentences, ${transcriptText.length} chars`);

  const primary = primaryInternalSpeaker(transcript, parties);
  const senderName = primary?.name || repName || "the SiteZeus team";

  const aiContent = await extractSalesContent({ transcriptText, prospectFirstName, prospectCompany, senderName });

  let body = null;
  let nextSteps = [];
  let resources = [];

  if (aiContent) {
    body = stripLeadingGreeting((aiContent.body || "").trim()) || null;
    nextSteps = Array.isArray(aiContent.nextSteps) ? aiContent.nextSteps.map(s => String(s).trim()).filter(Boolean) : [];
    resources = resolveResources(aiContent.resources);
  } else {
    // Gong fallback
    body = typeof content.brief === "string" ? content.brief.trim() : null;
    const highlights = content.highlights || [];
    const NEXT_MEETING_TYPES = new Set(["next_meeting", "follow_up", "follow-up", "upcoming_meeting"]);
    const meeting = highlights.find(h => NEXT_MEETING_TYPES.has((h.type || "").toLowerCase()))?.text?.trim();
    if (meeting) nextSteps = [meeting];
    const trackers = content.trackers || [];
    const topics = trackers.filter(t => (t.count || 0) > 0).map(t => (t.name || "").toLowerCase());
    resources = selectResourcesByTopic(topics, isEnterprise);
  }

  const prospectHtml = buildProspectHtml({ prospectFirstName, senderName, body, nextSteps, resources });
  const segmentLabel = isEnterprise ? "Enterprise" : "SMB / Emerging";
  const wrapperHtml = buildRepWrapper({ repEmail, prospectFirstName, prospectEmail, segmentLabel, callName, prospectHtml });
  const subject = `[REVIEW & SEND] Follow-up draft for ${prospectFirstName} — ${callName}`;
  return { subject, wrapperHtml, prospectHtml };
}

function buildProspectHtml({ prospectFirstName, senderName, body, nextSteps, resources }) {
  const parts = [
    `<p>Hi ${escapeHtml(prospectFirstName)},</p>`,
    `<p>Thank you for hopping on the call today.</p>`,
  ];

  if (body) {
    for (const para of body.split(/\n{2,}/).map(p => p.trim()).filter(Boolean)) {
      parts.push(`<p>${escapeHtml(para)}</p>`);
    }
  }

  if (nextSteps.length) {
    parts.push(`<p><strong>Next Steps</strong></p>`);
    parts.push(`<ul>${nextSteps.map(s => `<li>${escapeHtml(s)}</li>`).join("")}</ul>`);
  }

  if (resources.length) {
    parts.push(`<p><strong>Relevant Resources</strong></p>`);
    parts.push(`<ul>${resources.map(r => {
      const link = `<a href="${escapeHtml(r.url)}" style="color:#1a73e8;">${escapeHtml(r.name)}</a>`;
      return r.reason ? `<li>${link} — ${escapeHtml(r.reason)}</li>` : `<li>${link}</li>`;
    }).join("")}</ul>`);
  }

  parts.push(`<p>Thanks,<br>${escapeHtml(senderName)}</p>`);
  return parts.join("\n");
}

function buildRepWrapper({ repEmail, prospectFirstName, prospectEmail, segmentLabel, callName, prospectHtml }) {
  return `
<div style="font-family:Arial,Helvetica,sans-serif;font-size:14px;color:#333;max-width:680px;">
<div style="background:#fff8e1;padding:14px 18px;border-left:5px solid #f9a825;margin-bottom:20px;border-radius:3px;">
<strong>ACTION REQUIRED — Review &amp; Send</strong><br><br>
Draft follow-up for <strong>${escapeHtml(prospectFirstName)}</strong> (<a href="mailto:${escapeHtml(prospectEmail)}">${escapeHtml(prospectEmail)}</a>).<br>
<strong>Segment:</strong> ${escapeHtml(segmentLabel)} &nbsp;|&nbsp; <strong>Call:</strong> ${escapeHtml(callName)}<br><br>
Review below, edit as needed, then send from <strong>${escapeHtml(repEmail)}</strong>.<br>
<em>Do not reply to this message — it was generated automatically.</em>
</div>
<hr style="border:none;border-top:1px solid #ddd;margin:0 0 20px 0;">
<p style="color:#888;font-size:12px;margin-bottom:4px;">Suggested subject: <strong>Great connecting — SiteZeus resources &amp; next steps</strong></p>
<div style="border:1px solid #e0e0e0;padding:20px;border-radius:4px;background:#fafafa;">
${prospectHtml}
</div>
</div>
`;
}

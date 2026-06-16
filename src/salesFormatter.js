// salesFormatter.js — Formats the Sales follow-up email for rep review.

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
    speakerMap[id] = isInternal
      ? (party.name || "Rep").split(" ")[0]
      : (party.name || "Prospect").split(" ")[0];
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

async function extractSalesContent(transcriptText, prospectFirstName, prospectCompany) {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey || !transcriptText) return null;

  const companyRef = prospectCompany || prospectFirstName + "'s company";

  const prompt = `Read this sales call transcript and extract structured content for a follow-up email.

Transcript:
${transcriptText.slice(0, 12000)}

Return ONLY this exact JSON — no markdown, no explanation:
{
  "callSummary": "2-3 sentences. Start with 'we discussed [company name]'s [topic].' then 'We explored how SiteZeus's [specific product/capability] could support [their goal] by [specific details from the call].' Write as the rep — use 'we' for SiteZeus. Use the actual company name (${companyRef}). Reference specific things from the call (concepts, locations, markets, goals mentioned). Example: \"we discussed The Rabbit Group's expansion plans for three concepts. We explored how SiteZeus's location intelligence could support their growth by analyzing demographic data and identifying optimal sites.\"",
  "scheduledMeeting": "If a specific follow-up call, demo, or meeting was booked, one sentence (e.g. 'Demo scheduled for Thursday at 2pm'). Empty string if nothing booked.",
  "resourceTopics": ["topic1", "topic2", "topic3"]
}

Rules:
- callSummary: past tense recap. Mention the actual company/concepts discussed. Use specific SiteZeus product names if mentioned (Locate, Build, Sell, Zeus AI, Customer Insights). Do NOT use generic phrases like 'your needs' — be specific to the call.
- scheduledMeeting: ONLY for explicitly booked meetings. Empty string otherwise.
- resourceTopics: 3-5 tags. Examples: "site selection", "franchise expansion", "consumer data", "revenue forecasting", "construction management", "market intelligence"`;

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
        max_tokens: 600,
        temperature: 0,
        messages: [{ role: "user", content: prompt }],
      }),
    });
    if (!res.ok) { console.warn(`[Sales] API error ${res.status}`); return null; }
    const data = await res.json();
    const text = (data.content?.[0]?.text || "").trim();
    const jsonMatch = text.match(/\{[\s\S]*\}/);
    if (!jsonMatch) { console.warn("[Sales] No JSON in response:", text.slice(0, 200)); return null; }
    return JSON.parse(jsonMatch[0]);
  } catch (err) {
    console.warn(`[Sales] AI extraction failed: ${err.message}`);
    return null;
  }
}

function selectResources(topics, isEnterprise) {
  const pool = isEnterprise ? config.ENTERPRISE_RESOURCES : config.SMB_EMERGING_RESOURCES;
  const selected = [];
  const selectedNames = new Set();
  for (const resource of pool) {
    if (selected.length >= 4) break;
    for (const topic of resource.topics || []) {
      if (topics.some(t => t.includes(topic) || topic.includes(t))) {
        if (!selectedNames.has(resource.name)) { selected.push(resource); selectedNames.add(resource.name); break; }
      }
    }
  }
  for (const resource of pool) {
    if (selected.length >= 4) break;
    if (!selectedNames.has(resource.name)) { selected.push(resource); selectedNames.add(resource.name); }
  }
  selected.push({ name: "Customer Stories", url: config.CUSTOMER_STORIES_URL });
  return selected;
}

export async function formatSalesReviewEmail({ callData, repName, repEmail, prospectFirstName, prospectEmail, prospectCompany, isEnterprise, callName, transcript = [] }) {
  const parties = callData.parties || [];
  const content = callData.content || {};
  const transcriptText = buildTranscriptText(transcript, parties);
  console.info(`[Sales] Transcript: ${transcript.length} sentences, ${transcriptText.length} chars`);

  const aiContent = await extractSalesContent(transcriptText, prospectFirstName, prospectCompany);

  let callSummary = null;
  let scheduledMeeting = "";
  let resourceTopics = [];

  if (aiContent) {
    callSummary = aiContent.callSummary?.trim() || null;
    scheduledMeeting = aiContent.scheduledMeeting?.trim() || "";
    resourceTopics = aiContent.resourceTopics || [];
  } else {
    // Gong fallback
    const brief = typeof content.brief === "string" ? content.brief.trim() : null;
    callSummary = brief;
    const highlights = content.highlights || [];
    const NEXT_MEETING_TYPES = new Set(["next_meeting", "follow_up", "follow-up", "upcoming_meeting"]);
    scheduledMeeting = highlights.find(h => NEXT_MEETING_TYPES.has((h.type || "").toLowerCase()))?.text?.trim() || "";
    const trackers = content.trackers || [];
    resourceTopics = trackers.filter(t => (t.count || 0) > 0).map(t => (t.name || "").toLowerCase());
  }

  const resources = selectResources(resourceTopics, isEnterprise);
  const prospectHtml = buildProspectHtml({ prospectFirstName, repName, callSummary, scheduledMeeting, resources });
  const segmentLabel = isEnterprise ? "Enterprise" : "SMB / Emerging";
  const wrapperHtml = buildRepWrapper({ repEmail, prospectFirstName, prospectEmail, segmentLabel, callName, prospectHtml });
  const subject = `[REVIEW & SEND] Follow-up draft for ${prospectFirstName} — ${callName}`;
  return { subject, wrapperHtml, prospectHtml };
}

function buildProspectHtml({ prospectFirstName, repName, callSummary, scheduledMeeting, resources }) {
  const parts = [
    `<p>Hi ${prospectFirstName},</p>`,
    `<p>Great connecting with you today!</p>`,
  ];

  if (callSummary) {
    parts.push(`<p><strong>Call Summary:</strong> ${callSummary}</p>`);
  }

  if (scheduledMeeting) {
    parts.push(`<p><strong>Next Steps:</strong> ${scheduledMeeting}</p>`);
  } else {
    parts.push(`<p><strong>Next Steps:</strong> I'll follow up soon to find a time that works — feel free to grab time on my calendar through the link in my signature.</p>`);
  }

  if (resources.length) {
    parts.push(`<p><strong>A few resources that may be helpful:</strong></p>`);
    parts.push(`<ul>${resources.map(r => `<li><a href="${r.url}" style="color:#1a73e8;">${r.name}</a></li>`).join("")}</ul>`);
  }

  parts.push(`<p>Talk soon,<br>${repName}</p>`);
  return parts.join("\n");
}

function buildRepWrapper({ repEmail, prospectFirstName, prospectEmail, segmentLabel, callName, prospectHtml }) {
  return `
<div style="font-family:Arial,Helvetica,sans-serif;font-size:14px;color:#333;max-width:680px;">
<div style="background:#fff8e1;padding:14px 18px;border-left:5px solid #f9a825;margin-bottom:20px;border-radius:3px;">
<strong>ACTION REQUIRED — Review &amp; Send</strong><br><br>
Draft follow-up for <strong>${prospectFirstName}</strong> (<a href="mailto:${prospectEmail}">${prospectEmail}</a>).<br>
<strong>Segment:</strong> ${segmentLabel} &nbsp;|&nbsp; <strong>Call:</strong> ${callName}<br><br>
Review below, edit as needed, then send from <strong>${repEmail}</strong>.<br>
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

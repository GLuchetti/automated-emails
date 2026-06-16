// salesFormatter.js — Formats the Sales follow-up email for rep review.

import * as config from "./config.js";

const ANTHROPIC_API_URL = "https://api.anthropic.com/v1/messages";
const ANTHROPIC_MODEL = "claude-haiku-4-5-20251001";

const PRODUCT_KEYWORDS = {
  locate: ["locate", "site selection", "forecast", "revenue", "model", "prediction"],
  build: ["build", "construction", "milestone", "opening", "timeline", "project"],
  sell: ["sell", "franchise", "crm", "pipeline", "candidate", "territory"],
  market: ["market", "customer insights", "trade area", "mobile data", "consumer"],
  zeus_ai: ["zeus", "ai", "artificial intelligence", "predict", "recommendation"],
  white_space: ["white space", "whitespace", "expansion", "growth", "new market"],
  sales_impact: ["cannibalization", "impact", "transfer", "overlap"],
  poc: ["proof of concept", "poc", "pilot", "trial", "test"],
  pricing: ["pricing", "price", "cost", "investment", "contract", "proposal"],
};

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

function detectTopicsFromText(text) {
  const lower = text.toLowerCase();
  const topics = new Set();
  for (const [topic, keywords] of Object.entries(PRODUCT_KEYWORDS)) {
    if (keywords.some(kw => lower.includes(kw))) topics.add(topic.replace("_", " "));
  }
  return [...topics];
}

async function extractSalesContentFromTranscript(transcriptText, prospectFirstName, prospectCompany) {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey || !transcriptText) return null;

  const prompt = `Read this sales call transcript and extract information for a follow-up email written by the SiteZeus rep (we ARE SiteZeus).

Transcript:
${transcriptText.slice(0, 12000)}

Return ONLY this exact JSON — no markdown, no explanation:
{
  "callSummary": "1-2 sentences summarizing what was discussed, written from our perspective as SiteZeus. Reference the prospect's business and what we discussed helping them with. Example: 'As discussed, ${prospectCompany || prospectFirstName} is expanding into new markets and we walked through how our site selection and revenue forecasting tools can support that growth.' Use 'we' and 'our' for SiteZeus — never say 'SiteZeus' in third person.",
  "scheduledMeeting": "If a specific follow-up call, demo, or meeting was booked, describe it in one sentence (e.g. 'We have a demo scheduled for next week'). If nothing was scheduled, return empty string.",
  "resourceTopics": ["topic1", "topic2", "topic3"]
}

Rules:
- callSummary: Start with 'As discussed' or 'It was great connecting'. Use 'we', 'our', 'I' — never 'SiteZeus did' or 'SiteZeus offers'. Mention the prospect's actual business context and what SiteZeus capabilities are relevant. Keep it conversational, not a pitch.
- scheduledMeeting: ONLY for an explicitly booked next call/demo. Do NOT put company background or notes here. Empty string if nothing was scheduled.
- resourceTopics: 3-5 short tags for topics the prospect engaged with. Examples: "site selection", "franchise expansion", "consumer data", "revenue forecasting", "construction timeline".`;

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
      console.warn(`[Sales] Anthropic API error ${res.status}: ${(await res.text()).slice(0, 200)}`);
      return null;
    }
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

function extractFallbackContent(callData) {
  const content = callData.content || {};
  const brief = typeof content.brief === "string" ? content.brief.trim() : null;
  const nextSteps = (content.actions || [])
    .map(a => (typeof a === "string" ? a : a?.text || a?.description || ""))
    .map(t => t.trim()).filter(Boolean).slice(0, 4);
  const highlights = content.highlights || [];
  const NEXT_MEETING_TYPES = new Set(["next_meeting", "follow_up", "follow-up", "upcoming_meeting"]);
  const nextMeeting = highlights.find(h => NEXT_MEETING_TYPES.has((h.type || "").toLowerCase()))?.text?.trim() || "";
  return { summary: brief, nextSteps, nextMeeting };
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

  const aiContent = await extractSalesContentFromTranscript(transcriptText, prospectFirstName, prospectCompany);

  let summary, nextSteps, nextMeeting, resourceTopics = [];

  if (aiContent) {
    summary = aiContent.callSummary?.trim() || null;
    const scheduled = aiContent.scheduledMeeting?.trim();
    nextSteps = scheduled ? [scheduled] : [];
    nextMeeting = "";
    resourceTopics = aiContent.resourceTopics || [];
  } else {
    console.info("[Sales] Falling back to Gong AI content fields");
    const fallback = extractFallbackContent(callData);
    summary = fallback.summary;
    nextSteps = fallback.nextSteps;
    nextMeeting = fallback.nextMeeting;
  }

  if (!resourceTopics.length) {
    const trackers = content.trackers || [];
    resourceTopics = trackers.filter(t => (t.count || 0) > 0).map(t => (t.name || "").toLowerCase());
  }
  if (!resourceTopics.length && transcriptText) resourceTopics = detectTopicsFromText(transcriptText);

  const resources = selectResources(resourceTopics, isEnterprise);
  const prospectHtml = buildProspectHtml({ prospectFirstName, repName, summary, nextSteps, nextMeeting, resources });
  const segmentLabel = isEnterprise ? "Enterprise" : "SMB / Emerging";
  const wrapperHtml = buildRepWrapper({ repEmail, prospectFirstName, prospectEmail, segmentLabel, callName, prospectHtml });
  const subject = `[REVIEW & SEND] Follow-up draft for ${prospectFirstName} — ${callName}`;
  return { subject, wrapperHtml, prospectHtml };
}

function bulletList(items) {
  return `<ul>${items.map(i => `<li>${i}</li>`).join("")}</ul>`;
}

function buildProspectHtml({ prospectFirstName, repName, summary, nextSteps, nextMeeting, resources }) {
  const parts = [
    `<p>Hi ${prospectFirstName},</p>`,
    `<p>Great connecting with you today!</p>`,
  ];
  if (summary) parts.push(`<p>${summary}</p>`);
  if (nextSteps.length) {
    parts.push(`<p><strong>Next steps:</strong></p>`, bulletList(nextSteps));
  } else if (nextMeeting) {
    parts.push(`<p><strong>Next steps:</strong></p>`, `<p>${nextMeeting}</p>`);
  } else {
    parts.push(`<p>I'll follow up soon — feel free to grab time on my calendar through the link in my signature.</p>`);
  }
  if (resources.length) {
    parts.push(`<p><strong>A few resources that may be helpful:</strong></p>`, bulletList(resources.map(r => `<a href="${r.url}" style="color:#1a73e8;">${r.name}</a>`)));
  }
  parts.push(`<p>Talk soon,<br>${repName}</p>`);
  return parts.join("\n");
}

function buildRepWrapper({ repEmail, prospectFirstName, prospectEmail, segmentLabel, callName, prospectHtml }) {
  return `
<div style="font-family:Arial,Helvetica,sans-serif;font-size:14px;color:#333;max-width:680px;">
<div style="background:#fff8e1;padding:14px 18px;border-left:5px solid #f9a825;margin-bottom:20px;border-radius:3px;">
<strong>ACTION REQUIRED — Review &amp; Send</strong><br><br>
This is a draft follow-up email for <strong>${prospectFirstName}</strong>
(<a href="mailto:${prospectEmail}">${prospectEmail}</a>).<br>
<strong>Segment:</strong> ${segmentLabel} &nbsp;|&nbsp;
<strong>Call:</strong> ${callName}<br><br>
Review the draft below. Edit as needed, then send it from your own account (<strong>${repEmail}</strong>).<br>
<em>Do not reply to this message — it was sent automatically.</em>
</div>
<hr style="border:none;border-top:1px solid #ddd;margin:0 0 20px 0;">
<p style="color:#888;font-size:12px;margin-bottom:4px;">Suggested subject: <strong>SiteZeus Resources &amp; Next Steps</strong></p>
<div style="border:1px solid #e0e0e0;padding:20px;border-radius:4px;background:#fafafa;">
${prospectHtml}
</div>
</div>
`;
}

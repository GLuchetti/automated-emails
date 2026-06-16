// salesFormatter.js — Formats the Sales follow-up email for rep review.
//
// Uses Gong transcript + Anthropic AI to build a prospect-facing draft the rep
// reviews and sends from their own account. Sent to the rep via the dashboard.
//
// Subject: [REVIEW & SEND] Follow-up draft for {First Name} — {Call Name}
// Prospect draft:
//   Hi {First Name},
//   Thank you for taking the time to connect...
//   What we discussed: ... (AI summary from transcript)
//   Next steps: ... (AI extracted from transcript)
//   Resources: ... (from trackers/topics)
//   Best, {Rep Name}

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

// ------------------------------------------------------------------
// Transcript helpers
// ------------------------------------------------------------------

/**
 * Build readable transcript text from flat sentences, mapping speakerId → name.
 */
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
      : ((party.name || "Prospect").split(" ")[0]);
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

  return utterances
    .map(u => `${u.name}: ${u.texts.join(" ")}`)
    .join("\n");
}

/**
 * Detect product topics from transcript text for resource selection.
 */
function detectTopicsFromText(text) {
  const lower = text.toLowerCase();
  const topics = new Set();
  for (const [topic, keywords] of Object.entries(PRODUCT_KEYWORDS)) {
    if (keywords.some(kw => lower.includes(kw))) {
      topics.add(topic.replace("_", " "));
    }
  }
  return [...topics];
}

// ------------------------------------------------------------------
// AI extraction
// ------------------------------------------------------------------

/**
 * Call Anthropic to extract "what we discussed" summary and next steps from transcript.
 * Returns null on failure.
 */
async function extractSalesContentFromTranscript(transcriptText, prospectFirstName, repName) {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey || !transcriptText) return null;

  const prompt = `You are helping a SiteZeus sales rep write a follow-up email to a prospect after a discovery or demo call. Extract the key content from the transcript in a warm, professional tone.

Transcript:
${transcriptText.slice(0, 12000)}

Return ONLY valid JSON in this exact format (no markdown, no extra text):
{
  "summary": "2-3 sentence summary of what was discussed on the call, written as if ${repName} is speaking to ${prospectFirstName}",
  "nextSteps": ["next step 1", "next step 2", "next step 3"],
  "nextMeeting": "brief description of any scheduled follow-up call or meeting, empty string if none"
}

Rules:
- summary: conversational recap of topics covered — what SiteZeus does and how it applies to ${prospectFirstName}'s business
- nextSteps: 2-4 concrete follow-up actions (rep commitments and/or prospect asks), keep each under 15 words
- nextMeeting: if a next call/demo/meeting was scheduled or mentioned, describe it briefly; otherwise empty string
- Write everything from the rep's perspective, as if ${repName} is writing to ${prospectFirstName}
- Keep tone warm and professional`;

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
      console.warn(`[Sales] Anthropic API error ${res.status}: ${errText.slice(0, 200)}`);
      return null;
    }

    const data = await res.json();
    const text = (data.content?.[0]?.text || "").trim();

    const jsonMatch = text.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      console.warn("[Sales] Anthropic response had no JSON:", text.slice(0, 200));
      return null;
    }

    return JSON.parse(jsonMatch[0]);
  } catch (err) {
    console.warn(`[Sales] AI extraction failed: ${err.message}`);
    return null;
  }
}

// ------------------------------------------------------------------
// Fallback (no API key or AI failure)
// ------------------------------------------------------------------

function extractFallbackContent(callData) {
  const content = callData.content || {};

  const brief = typeof content.brief === "string" ? content.brief.trim() : null;
  const keyPoints = (content.keyPoints || [])
    .map(kp => (typeof kp === "string" ? kp : kp?.text || kp?.title || ""))
    .map(t => t.trim())
    .filter(Boolean)
    .slice(0, 4);

  const nextSteps = (content.actions || [])
    .map(a => (typeof a === "string" ? a : a?.text || a?.description || ""))
    .map(t => t.trim())
    .filter(Boolean)
    .slice(0, 4);

  const highlights = content.highlights || [];
  const NEXT_MEETING_TYPES = new Set(["next_meeting", "follow_up", "follow-up", "upcoming_meeting"]);
  const nextMeeting = highlights.find(h => NEXT_MEETING_TYPES.has((h.type || "").toLowerCase()))?.text?.trim() || "";

  return { summary: brief, keyPoints, nextSteps, nextMeeting };
}

// ------------------------------------------------------------------
// Resource selection
// ------------------------------------------------------------------

function selectResources(topics, isEnterprise) {
  const pool = isEnterprise ? config.ENTERPRISE_RESOURCES : config.SMB_EMERGING_RESOURCES;
  const selected = [];
  const selectedNames = new Set();

  for (const resource of pool) {
    if (selected.length >= 4) break;
    for (const topic of resource.topics || []) {
      if (topics.some(t => t.includes(topic) || topic.includes(t))) {
        if (!selectedNames.has(resource.name)) {
          selected.push(resource);
          selectedNames.add(resource.name);
          break;
        }
      }
    }
  }
  for (const resource of pool) {
    if (selected.length >= 4) break;
    if (!selectedNames.has(resource.name)) {
      selected.push(resource);
      selectedNames.add(resource.name);
    }
  }
  selected.push({ name: "Customer Stories", url: config.CUSTOMER_STORIES_URL });
  return selected;
}

// ------------------------------------------------------------------
// Public API
// ------------------------------------------------------------------

/**
 * Build the full sales review email (rep wrapper + prospect draft).
 * @returns {{ subject: string, wrapperHtml: string, prospectHtml: string }}
 */
export async function formatSalesReviewEmail({ callData, repName, repEmail, prospectFirstName, prospectEmail, isEnterprise, callName, transcript = [] }) {
  const parties = callData.parties || [];
  const content = callData.content || {};

  // Build transcript text
  const transcriptText = buildTranscriptText(transcript, parties);
  console.info(`[Sales] Transcript: ${transcript.length} sentences, ${transcriptText.length} chars`);

  // AI extraction
  let aiContent = await extractSalesContentFromTranscript(transcriptText, prospectFirstName, repName);

  let summary, nextSteps, nextMeeting;

  if (aiContent) {
    summary = aiContent.summary || null;
    nextSteps = aiContent.nextSteps || [];
    nextMeeting = aiContent.nextMeeting || "";
  } else {
    console.info("[Sales] Falling back to Gong AI content fields");
    const fallback = extractFallbackContent(callData);
    summary = fallback.summary;
    nextSteps = fallback.nextSteps;
    nextMeeting = fallback.nextMeeting;
    if (!nextSteps.length) nextSteps = fallback.keyPoints.slice(2);
  }

  // Resources — from trackers, then transcript topic detection
  const trackers = content.trackers || [];
  let trackerNames = trackers
    .filter(t => (t.count || 0) > 0)
    .map(t => (t.name || "").toLowerCase());

  if (!trackerNames.length && transcriptText) {
    trackerNames = detectTopicsFromText(transcriptText);
  }

  const resources = selectResources(trackerNames, isEnterprise);

  const prospectHtml = buildProspectHtml({
    prospectFirstName, repName,
    summary,
    nextSteps,
    nextMeeting,
    resources,
  });

  const segmentLabel = isEnterprise ? "Enterprise" : "SMB / Emerging";
  const wrapperHtml = buildRepWrapper({ repEmail, prospectFirstName, prospectEmail, segmentLabel, callName, prospectHtml });
  const subject = `[REVIEW & SEND] Follow-up draft for ${prospectFirstName} — ${callName}`;

  return { subject, wrapperHtml, prospectHtml };
}

// ------------------------------------------------------------------
// HTML builders
// ------------------------------------------------------------------

function bulletList(items) {
  return `<ul>${items.map(i => `<li>${i}</li>`).join("")}</ul>`;
}

function buildProspectHtml({ prospectFirstName, repName, summary, nextSteps, nextMeeting, resources }) {
  const parts = [
    `<p>Hi ${prospectFirstName},</p>`,
    `<p>Thank you for taking the time to connect with me today. I wanted to follow up with a quick recap of our conversation.</p>`,
  ];

  if (summary) {
    parts.push(`<p><strong>What we discussed:</strong></p>`, `<p>${summary}</p>`);
  }

  if (nextSteps.length) {
    parts.push(`<p><strong>Next steps:</strong></p>`, bulletList(nextSteps));
  } else if (nextMeeting) {
    parts.push(`<p><strong>Next steps:</strong></p>`, `<p>${nextMeeting}</p>`);
  } else {
    parts.push(
      `<p><strong>Next steps:</strong></p>`,
      `<p>I'll be in touch soon. Feel free to reach out with any questions — you can also find time through the scheduling link in my signature.</p>`
    );
  }

  if (resources.length) {
    parts.push(
      `<p><strong>Resources:</strong></p>`,
      bulletList(resources.map(r => `<a href="${r.url}" style="color:#1a73e8;">${r.name}</a>`))
    );
  }

  parts.push(`<p>Best,<br>${repName}</p>`);
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
Review the draft below. Edit as needed, then send it to the prospect from
your own email account (<strong>${repEmail}</strong>).<br>
<em>Do not reply to this message — it was sent automatically.</em>
</div>

<hr style="border:none;border-top:1px solid #ddd;margin:0 0 20px 0;">

<p style="color:#888;font-size:12px;margin-bottom:4px;">
Suggested subject: <strong>SiteZeus Resources &amp; Next Steps</strong>
</p>

<div style="border:1px solid #e0e0e0;padding:20px;border-radius:4px;background:#fafafa;">
${prospectHtml}
</div>

</div>
`;
}

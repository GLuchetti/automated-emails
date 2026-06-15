// salesFormatter.js — Formats the Sales follow-up email for rep review.
//
// Builds a prospect-facing draft the rep reviews and sends from their own account.
// Sent to the rep via the dashboard (no auto-send for sales).
//
// Subject: SiteZeus Resources & Next Steps
// Hi {First Name},
// Thank you for taking the time to connect...
// What we discussed: ... (Gong brief > key points > highlights)
// Next steps: ... (Gong actions > action highlights > transcript)
// Resources: ...
// Best, {Rep Name}

import * as config from "./config.js";

const EXCLUDE_HIGHLIGHT_TYPES = new Set([
  "action_item", "action item", "next_step", "next step", "decision", "key_decision",
]);
const NEXT_MEETING_TYPES = new Set(["next_meeting", "follow_up", "follow-up", "upcoming_meeting"]);

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

const NEXT_MEETING_KEYWORDS = [
  "next week", "follow up", "follow-up", "schedule", "tuesday", "wednesday",
  "thursday", "monday", "friday", "next call", "next meeting", "demo", "presentation",
];

/**
 * Build the full sales review email (rep wrapper + prospect draft).
 * @returns {{ subject: string, wrapperHtml: string, prospectHtml: string }}
 */
export function formatSalesReviewEmail({ callData, repName, repEmail, prospectFirstName, prospectEmail, isEnterprise, callName, transcript = [] }) {
  const content = callData.content || {};
  const highlights = content.highlights || [];
  const trackers = content.trackers || [];

  // 1. "What we discussed" — Gong AI brief > key points > highlights > transcript
  const briefText = cleanText(content.brief);
  const keyPoints = extractKeyPoints(content.keyPoints || content.key_points);
  let callHighlights = extractHighlights(highlights).slice(0, 5);
  if (!callHighlights.length && transcript.length) {
    callHighlights = extractFromTranscript(transcript, repName).slice(0, 5);
  }

  console.info(`[Sales] Gong AI — brief: ${briefText ? "yes" : "no"}, keyPoints: ${keyPoints.length}, highlights: ${callHighlights.length}`);

  // 2. Resources — from trackers, outline/topics, then transcript
  let trackerNames = trackers
    .filter(t => (t.count || 0) > 0)
    .map(t => (t.name || "").toLowerCase());
  const outlineTopics = extractOutlineTopics(content.outline || content.topics);
  trackerNames = [...new Set([...trackerNames, ...outlineTopics])];
  if (!trackerNames.length && transcript.length) {
    trackerNames = detectTopicsFromTranscript(transcript);
  }
  const resources = selectResources(trackerNames, isEnterprise);

  // 3. Next steps — Gong actions > action highlights > transcript
  let nextSteps = extractGongActions(content.actions);
  if (!nextSteps.length) {
    nextSteps = highlights
      .filter(h => ["action_item", "action item", "next_step", "next step"].includes((h.type || "").toLowerCase()))
      .map(h => (h.text || "").trim())
      .filter(Boolean);
  }
  if (!nextSteps.length && transcript.length) {
    nextSteps = extractActionItemsFromTranscript(transcript).slice(0, 5);
  }

  let nextMeeting = detectNextMeeting(highlights);
  if (!nextMeeting && transcript.length) {
    nextMeeting = detectNextMeetingFromTranscript(transcript);
  }

  const prospectHtml = buildProspectHtml({
    prospectFirstName, repName, briefText, keyPoints,
    highlights: callHighlights, resources, nextMeeting, nextSteps,
  });

  const segmentLabel = isEnterprise ? "Enterprise" : "SMB / Emerging";
  const wrapperHtml = buildRepWrapper({ repEmail, prospectFirstName, prospectEmail, segmentLabel, callName, prospectHtml });
  const subject = `[REVIEW & SEND] Follow-up draft for ${prospectFirstName} — ${callName}`;

  return { subject, wrapperHtml, prospectHtml };
}

// ------------------------------------------------------------------
// Helpers — text extraction
// ------------------------------------------------------------------

function cleanText(val) {
  if (!val || typeof val !== "string") return null;
  const t = val.trim();
  return t || null;
}

function extractKeyPoints(field) {
  if (!field || !Array.isArray(field)) return [];
  return field
    .map(kp => (typeof kp === "string" ? kp : kp?.text || kp?.title || kp?.description || ""))
    .map(t => t.trim())
    .filter(Boolean)
    .slice(0, 6);
}

function extractGongActions(field) {
  if (!field || !Array.isArray(field)) return [];
  return field
    .map(a => (typeof a === "string" ? a : a?.text || a?.description || a?.title || ""))
    .map(t => t.trim())
    .filter(Boolean)
    .slice(0, 5);
}

function extractOutlineTopics(field) {
  if (!field) return [];
  if (typeof field === "string") return [field.toLowerCase()];
  if (!Array.isArray(field)) return [];
  return field
    .map(item => (typeof item === "string" ? item : item?.name || item?.title || item?.topic || ""))
    .filter(Boolean)
    .map(s => s.toLowerCase());
}

function extractHighlights(highlights) {
  return highlights
    .filter(h => !EXCLUDE_HIGHLIGHT_TYPES.has((h.type || "").toLowerCase()) && (h.text || "").trim())
    .map(h => h.text.trim());
}

function detectNextMeeting(highlights) {
  for (const h of highlights) {
    if (NEXT_MEETING_TYPES.has((h.type || "").toLowerCase()) && (h.text || "").trim()) {
      return h.text.trim();
    }
  }
  return null;
}

// ------------------------------------------------------------------
// Resource selection
// ------------------------------------------------------------------

function selectResources(trackerNames, isEnterprise) {
  const pool = isEnterprise ? config.ENTERPRISE_RESOURCES : config.SMB_EMERGING_RESOURCES;
  const selected = [];
  const selectedNames = new Set();

  for (const resource of pool) {
    if (selected.length >= 4) break;
    for (const topic of resource.topics || []) {
      if (trackerNames.some(t => t.includes(topic) || topic.includes(t))) {
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
// Transcript helpers
// ------------------------------------------------------------------

function extractFromTranscript(transcript, repName) {
  const highlights = [];
  const seen = new Set();
  for (const s of transcript) {
    const text = (s.text || "").trim();
    if (text.length < 20 || text.length > 200) continue;
    const tl = text.toLowerCase();
    if (["how are you", "happy friday", "nice to meet", "sounds good", "absolutely", "okay"].some(skip => tl.includes(skip))) continue;
    for (const [, keywords] of Object.entries(PRODUCT_KEYWORDS)) {
      if (keywords.some(kw => tl.includes(kw)) && !seen.has(text)) {
        highlights.push(text);
        seen.add(text);
        break;
      }
    }
    if (highlights.length >= 5) break;
  }
  return highlights;
}

function detectTopicsFromTranscript(transcript) {
  const topics = new Set();
  const fullText = transcript.map(s => (s.text || "").toLowerCase()).join(" ");
  for (const [topic, keywords] of Object.entries(PRODUCT_KEYWORDS)) {
    if (keywords.some(kw => fullText.includes(kw))) {
      topics.add(topic.replace("_", " "));
    }
  }
  return [...topics];
}

function extractActionItemsFromTranscript(transcript) {
  const actionPhrases = [
    "i will", "i'll", "we will", "we'll", "i'm going to",
    "will send", "will follow", "will check", "will get back",
    "will share", "will reach out", "by end of", "by next week",
    "going to send", "going to follow",
  ];
  const items = [];
  const seen = new Set();
  for (const s of transcript) {
    const text = (s.text || "").trim();
    const tl = text.toLowerCase();
    if (text.length > 15 && text.length < 200 && actionPhrases.some(p => tl.includes(p)) && !seen.has(text)) {
      items.push(text);
      seen.add(text);
    }
  }
  return items;
}

function detectNextMeetingFromTranscript(transcript) {
  for (const s of [...transcript].reverse()) {
    const text = (s.text || "").trim();
    const tl = text.toLowerCase();
    if (text.length < 150 && NEXT_MEETING_KEYWORDS.some(kw => tl.includes(kw))) {
      return text;
    }
  }
  return null;
}

// ------------------------------------------------------------------
// HTML builders
// ------------------------------------------------------------------

function bulletList(items) {
  return `<ul>${items.map(i => `<li>${i}</li>`).join("")}</ul>`;
}

function buildProspectHtml({ prospectFirstName, repName, highlights, resources, nextMeeting, nextSteps = [], briefText = null, keyPoints = [] }) {
  const parts = [
    `<p>Hi ${prospectFirstName},</p>`,
    `<p>Thank you for taking the time to connect with me today. I wanted to follow up with a quick recap of what we covered.</p>`,
  ];

  // What we discussed — brief > key points > highlights
  if (briefText) {
    parts.push("<p><strong>What we discussed:</strong></p>", `<p>${briefText}</p>`);
  } else if (keyPoints.length) {
    parts.push("<p><strong>What we discussed:</strong></p>", bulletList(keyPoints));
  } else if (highlights.length) {
    parts.push("<p><strong>What we discussed:</strong></p>", bulletList(highlights));
  }

  // Next steps
  if (nextSteps.length) {
    parts.push("<p><strong>Next steps:</strong></p>", bulletList(nextSteps));
  } else if (nextMeeting) {
    parts.push("<p><strong>Next steps:</strong></p>", `<p>${nextMeeting}</p>`);
  } else {
    parts.push(
      "<p><strong>Next steps:</strong></p>",
      "<p>I'll be in touch soon. Feel free to reach out with any questions in the meantime. You can find time through the scheduling link in my signature.</p>"
    );
  }

  // Resources
  if (resources.length) {
    parts.push(
      "<p><strong>Resources:</strong></p>",
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

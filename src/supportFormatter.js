// supportFormatter.js — Formats the Support post-call summary email.
//
// Template:
// Hi {First Name},
// Below is a summary of the action items discussed during {Call Name}.
//
// SiteZeus Team
// * {Action Item}, {Due Date}
// {Participant Name}
// * {Action Item}, {Due Date}
// Key Decisions
// * {Decision}
// Next Milestone:
// * {Milestone}, {Date}
// Best, SiteZeus Support Team

const SITEZEUS_DOMAIN = "sitezeus.com";

// All highlight types Gong might use for action items
const ACTION_ITEM_TYPES = new Set([
  "action_item", "action item", "action",
  "next_step", "next step", "next steps",
  "task", "todo", "follow_up", "follow-up", "follow up",
  "deliverable", "commitment",
]);

const DECISION_TYPES = new Set([
  "decision", "key_decision", "key decision",
  "agreement", "conclusion", "resolution",
]);

const MILESTONE_TYPES = new Set([
  "next_meeting", "next meeting", "milestone",
  "follow_up", "follow-up", "upcoming", "checkpoint",
  "deadline", "schedule",
]);

// Patterns that indicate problem/failure framing — strip these from client emails.
// We surface outcomes and actions, not internal issues.
const NEGATIVE_PATTERNS = [
  /\b(acknowledged?|admit(ted)?)\s+that\b/i,
  /\b(issues?|problems?|errors?|bugs?|incorrect(ly)?|wrong|fail(ed|ure)?|broken)\b/i,
  /\b(couldn'?t|wasn'?t|weren'?t|didn'?t|hasn'?t|haven'?t)\b/i,
];

/**
 * Returns false if text contains problem/negative framing that shouldn't
 * appear in a client-facing email.
 */
function isClientSafe(text) {
  if (!text) return false;
  for (const pattern of NEGATIVE_PATTERNS) {
    if (pattern.test(text)) return false;
  }
  return true;
}

/**
 * Try to use a keyPoint as an action item.
 * Only keeps items that are outcome/action-focused and client-safe.
 */
function keyPointAsAction(text) {
  const t = (text || "").trim();
  if (!t) return null;
  if (!isClientSafe(t)) return null;
  // Prefer items that look like forward-looking actions
  if (/\bto\s+[a-z]+\b/i.test(t) || /\bwill\s+[a-z]+\b/i.test(t)) return t;
  // Exclude past-tense narrative summaries
  if (/^[A-Z][a-z]+\s+(acknowledged|said|noted|mentioned|explained|showed|demonstrated)/i.test(t)) return null;
  return t;
}

/**
 * Build the support summary email.
 * @param {object} callData  — full Gong extensive call object
 * @param {string} prospectFirstName
 * @param {string} callName
 * @returns {{ subject: string, html: string }}
 */
export function formatSupportEmail(callData, prospectFirstName, callName) {
  const parties   = callData.parties  || [];
  const content   = callData.content  || {};
  const highlights = content.highlights || [];
  const keyPoints  = content.keyPoints  || [];
  const outline    = content.outline    || [];

  // Speaker ID → party info
  const speakerMap = Object.fromEntries(
    parties.filter(p => p.speakerId).map(p => [p.speakerId, p])
  );

  const sitezeusActions = [];
  const clientActions   = {};   // { participantName: [items] }

  // ── 1. Structured actions from Gong ────────────────────────────
  let structuredActions = content.actions || [];

  // ── 2. Highlights with action types ────────────────────────────
  if (!structuredActions.length) {
    structuredActions = highlights
      .filter(h => ACTION_ITEM_TYPES.has((h.type || "").toLowerCase().trim()))
      .map(h => ({ text: h.text, speakerId: h.speakerId || "", dueDate: "" }));
  }

  // ── 3. Outline "Action Items" / "Next Steps" sections ──────────
  if (!structuredActions.length) {
    for (const section of outline) {
      const title = (section.section || section.title || "").toLowerCase();
      if (title.includes("action") || title.includes("next step") || title.includes("task")) {
        for (const item of (section.items || [])) {
          const text = (item.text || item).trim();
          if (text) structuredActions.push({ text, speakerId: item.speakerId || "", dueDate: "" });
        }
      }
    }
  }

  // Attribute structured actions to SiteZeus vs client.
  // Items with no speakerId default to SiteZeus Team (we own unattributed items).
  for (const action of structuredActions) {
    const text = (action.text || "").trim();
    if (!text || !isClientSafe(text)) continue;
    const speakerId = action.speakerId || action.assignee?.speakerId || "";
    const party     = speakerMap[speakerId] || {};
    const due       = (action.dueDate || "").trim();
    const item      = due ? `${text}, ${due}` : text;

    // No speakerId = unattributed → default to SiteZeus Team
    if (!speakerId || isSiteZeus(party)) {
      sitezeusActions.push(item);
    } else {
      const name = (party.name || "").trim() || prospectFirstName;
      (clientActions[name] = clientActions[name] || []).push(item);
    }
  }

  // ── 4. Fallback: keyPoints filtered for positive action language ─
  if (!sitezeusActions.length && !Object.keys(clientActions).length) {
    for (const kp of keyPoints) {
      const action = keyPointAsAction(kp.text || "");
      if (action) sitezeusActions.push(action);
    }
  }

  // ── Key Decisions (highlights only — never keyPoints) ──────────
  const decisions = [];
  for (const h of highlights) {
    if (DECISION_TYPES.has((h.type || "").toLowerCase().trim())) {
      const text = (h.text || "").trim();
      if (text && isClientSafe(text) && !decisions.includes(text)) decisions.push(text);
    }
  }

  // ── Next Milestone ─────────────────────────────────────────────
  const nextMilestones = [];
  for (const h of highlights) {
    if (MILESTONE_TYPES.has((h.type || "").toLowerCase().trim())) {
      const text = (h.text || "").trim();
      if (text && !nextMilestones.includes(text)) nextMilestones.push(text);
    }
  }
  // Fallback: keyPoints mentioning upcoming meetings / schedule
  if (!nextMilestones.length) {
    for (const kp of keyPoints) {
      const text = (kp.text || "").trim();
      if (
        /\b(next\s+(meeting|call|step|week|month)|follow[\s-]up|schedule(d)?|upcoming)\b/i.test(text) &&
        isClientSafe(text)
      ) {
        nextMilestones.push(text);
        break;
      }
    }
  }

  const html = buildSupportHtml({
    prospectFirstName, callName,
    sitezeusActions, clientActions,
    decisions, nextMilestones,
  });

  return { subject: `Action Items & Next Steps — ${callName}`, html };
}

// ─────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────

function isSiteZeus(party) {
  const email       = (party.emailAddress || "").toLowerCase();
  const affiliation = (party.affiliation  || "").toLowerCase();
  return email.includes(SITEZEUS_DOMAIN) || affiliation === "internal";
}

function bulletList(items) {
  return `<ul>${items.map(i => `<li>${i}</li>`).join("")}</ul>`;
}

function buildSupportHtml({ prospectFirstName, callName, sitezeusActions, clientActions, decisions, nextMilestones }) {
  const parts = [
    `<div style="font-family:Arial,Helvetica,sans-serif;font-size:14px;color:#333;line-height:1.6;max-width:680px;">`,
    `<p>Hi ${prospectFirstName},</p>`,
    `<p>Below is a summary of the action items discussed during <strong>${callName}</strong>.</p>`,
  ];

  if (sitezeusActions.length) {
    parts.push("<p><strong>SiteZeus Team</strong></p>", bulletList(sitezeusActions));
  }

  for (const [name, items] of Object.entries(clientActions)) {
    if (items.length) {
      parts.push(`<p><strong>${name}</strong></p>`, bulletList(items));
    }
  }

  if (decisions.length) {
    parts.push("<p><strong>Key Decisions</strong></p>", bulletList(decisions));
  }

  if (nextMilestones.length) {
    parts.push("<p><strong>Next Milestone:</strong></p>", bulletList(nextMilestones));
  }

  parts.push("<p>Best,<br><strong>SiteZeus Support Team</strong></p>", "</div>");
  return parts.join("\n");
}

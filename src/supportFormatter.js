// supportFormatter.js — Formats the Support post-call summary email.
//
// Template structure:
//   Hi {First Name},
//   Below is a summary of the action items discussed during {Call Name}.
//
//   SiteZeus Team    → their action items
//   {Client Name}    → client action items
//   Key Decisions
//   Next Milestone
//   Best, SiteZeus Support Team

const SITEZEUS_DOMAIN = "sitezeus.com";

const ACTION_ITEM_TYPES = new Set(["action_item", "action item", "next_step", "next step", "task"]);
const DECISION_TYPES = new Set(["decision", "key_decision", "agreement", "key_point", "conclusion"]);
const MILESTONE_TYPES = new Set([
  "next_meeting", "next_step", "milestone", "follow_up",
  "follow-up", "upcoming", "checkpoint",
]);

/**
 * Build the support summary email.
 * @param {object} callData
 * @param {string} prospectFirstName
 * @param {string} callName
 * @returns {{ subject: string, html: string }}
 */
export function formatSupportEmail(callData, prospectFirstName, callName) {
  const parties = callData.parties || [];
  const content = callData.content || {};
  const highlights = content.highlights || [];
  let actions = content.actions || [];

  // Speaker ID → party info
  const speakerMap = Object.fromEntries(
    parties.filter(p => p.speakerId).map(p => [p.speakerId, p])
  );

  // Action items — prefer .actions; fall back to action-type highlights
  if (!actions.length) {
    actions = highlights
      .filter(h => ACTION_ITEM_TYPES.has((h.type || "").toLowerCase()) && (h.text || "").trim())
      .map(h => ({ text: h.text, speakerId: h.speakerId || "", dueDate: "" }));
  }

  const sitezeusActions = [];
  const clientActions = {};

  for (const action of actions) {
    const text = (action.text || "").trim();
    if (!text) continue;
    const speakerId = action.speakerId || action.assignee?.speakerId || "";
    const party = speakerMap[speakerId] || {};
    const due = (action.dueDate || "").trim();
    const item = due ? `${text}, ${due}` : text;

    if (isSiteZeus(party)) {
      sitezeusActions.push(item);
    } else {
      const name = (party.name || "").trim() || "Client";
      (clientActions[name] = clientActions[name] || []).push(item);
    }
  }

  // Key Decisions
  const decisions = [];
  for (const h of highlights) {
    if (DECISION_TYPES.has((h.type || "").toLowerCase())) {
      const text = (h.text || "").trim();
      if (text && !decisions.includes(text)) decisions.push(text);
    }
  }
  for (const kp of content.keyPoints || []) {
    const text = (kp.text || "").trim();
    if (text && !decisions.includes(text)) decisions.push(text);
  }

  // Next Milestone
  const nextMilestones = [];
  for (const h of highlights) {
    if (MILESTONE_TYPES.has((h.type || "").toLowerCase())) {
      const text = (h.text || "").trim();
      if (text && !nextMilestones.includes(text)) nextMilestones.push(text);
    }
  }

  const html = buildSupportHtml({ prospectFirstName, callName, sitezeusActions, clientActions, decisions, nextMilestones });
  return { subject: `Action Items & Next Steps — ${callName}`, html };
}

// ------------------------------------------------------------------
// Helpers
// ------------------------------------------------------------------

function isSiteZeus(party) {
  const email = (party.emailAddress || "").toLowerCase();
  const affiliation = (party.affiliation || "").toLowerCase();
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
    parts.push("<p><strong>Next Milestone</strong></p>", bulletList(nextMilestones));
  }

  parts.push("<p>Best,<br><strong>SiteZeus Support Team</strong></p>", "</div>");
  return parts.join("\n");
}

// main.js — Entry point for the Gong call email automation.
//
// 1. Reads last_run.json to determine the processing window.
// 2. Fetches completed Gong calls since that window.
// 3. For each call, routes to the sales or support pipeline.
// 4. Appends results to the activity log and regenerates the dashboard.
// 5. Commits updated state files back to GitHub.

import { readFileSync, writeFileSync, mkdirSync, existsSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

import { GongClient } from "./gongClient.js";
import { HubSpotClient } from "./hubspotClient.js";
import { sendEmail } from "./emailHandler.js";
import { formatSalesReviewEmail } from "./salesFormatter.js";
import { formatSupportEmail } from "./supportFormatter.js";
import { recordRun } from "./dashboard.js";
import * as config from "./config.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "..");
const LAST_RUN_FILE = join(ROOT, "state", "last_run.json");
const STATE_DIR = join(ROOT, "state");

// ------------------------------------------------------------------
// State management
// ------------------------------------------------------------------

function loadLastRun() {
  if (existsSync(LAST_RUN_FILE)) {
    try {
      const data = JSON.parse(readFileSync(LAST_RUN_FILE, "utf-8"));
      if (data.last_run) return new Date(data.last_run);
    } catch {
      // fall through
    }
  }
  // Default: 24 hours ago
  const dt = new Date();
  dt.setHours(dt.getHours() - 24);
  return dt;
}

function saveLastRun(dt) {
  mkdirSync(STATE_DIR, { recursive: true });
  writeFileSync(LAST_RUN_FILE, JSON.stringify({ last_run: dt.toISOString() }, null, 2), "utf-8");
}

// ------------------------------------------------------------------
// Call processing helpers
// ------------------------------------------------------------------

/**
 * Fetch prospect info from transcript participants (non-SiteZeus attendees).
 */
function extractProspectFromCall(callData) {
  const parties = callData.parties || [];
  const external = parties.find(
    p => p.affiliation !== "internal" && !((p.emailAddress || "").includes(config.SITEZEUS_DOMAIN))
  );
  if (!external) return { email: null, name: null, firstName: null };
  const email = (external.emailAddress || "").toLowerCase().trim() || null;
  const name = (external.name || "").trim() || null;
  const firstName = name ? name.split(" ")[0] : "there";
  return { email, name, firstName };
}

/**
 * Process a single Sales call.
 */
async function processSalesCall({ callId, callName, callData, transcript, teamMap, hs, smtp, runLog }) {
  const prospect = extractProspectFromCall(callData);
  if (!prospect.email) {
    console.info(`[Sales] Call ${callId}: no external prospect email — skipping`);
    runLog.calls_processed.push({
      call_id: callId, call_name: callName, team: "sales",
      status: "no_contact", error: "No external prospect found",
      timestamp: new Date().toISOString(),
    });
    return;
  }

  // HubSpot contact lookup
  let isEnterprise = false;
  let repEmail = null;
  const hContact = await hs.findContactByEmail(prospect.email);
  if (hContact) {
    isEnterprise = hs.isEnterprise(hContact, config.ENTERPRISE_UNIT_COUNT_PROPERTY, config.ENTERPRISE_THRESHOLD);
    const ownerId = hContact.properties?.hubspot_owner_id;
    if (ownerId) repEmail = await hs.getOwnerEmail(ownerId);
  }

  // Identify the rep from the call parties (internal attendee)
  const parties = callData.parties || [];
  const repParty = parties.find(
    p => p.affiliation === "internal" || ((p.emailAddress || "").includes(config.SITEZEUS_DOMAIN))
  );
  const repPartyEmail = (repParty?.emailAddress || "").toLowerCase().trim() || null;
  repEmail = repEmail || repPartyEmail;

  const repName = (repParty?.name || "").trim() ||
    Object.values(config.SALES_REPS).find((_, i) => Object.keys(config.SALES_REPS)[i] === repEmail) ||
    repEmail || "Sales Rep";

  const segment = isEnterprise ? "Enterprise" : "SMB";
  console.info(`[Sales] Call ${callId}: prospect=${prospect.email}, rep=${repEmail}, segment=${segment}`);

  // Log available AI content fields
  const content = callData.content || {};
  const availableFields = ["trackers","topics","brief","outline","highlights","keyPoints"].filter(f => content[f]);
  console.info(`[Gong] Content fields available: ${availableFields.join(", ")}`);

  let emailHtml = null;
  let emailSubject = null;
  let status = "dashboard";

  try {
    const { subject, wrapperHtml } = formatSalesReviewEmail({
      callData, repName, repEmail: repEmail || "",
      prospectFirstName: prospect.firstName, prospectEmail: prospect.email,
      isEnterprise, callName, transcript,
    });
    emailHtml = wrapperHtml;
    emailSubject = subject;

    // Sales emails always go to the rep for review — attempt SMTP if configured
    if (smtp.user && smtp.password && repEmail) {
      try {
        await sendEmail({
          smtpUser: smtp.user, smtpPassword: smtp.password,
          fromAddress: `SiteZeus Automation <${smtp.user}>`,
          toAddresses: [repEmail], ccAddresses: [],
          subject, bodyHtml: wrapperHtml,
        });
        status = "sent";
        console.info(`[Sales] Email sent to rep ${repEmail} for call ${callId}`);
      } catch (smtpErr) {
        console.warn(`[Sales] SMTP failed for call ${callId} (${smtpErr.message}) — falling back to dashboard`);
        status = "dashboard";
      }
    }
  } catch (err) {
    console.error(`[Sales] Format error for call ${callId}:`, err.message);
    status = "error";
  }

  runLog.calls_processed.push({
    call_id: callId, call_name: callName, team: "sales",
    prospect_name: prospect.name, prospect_email: prospect.email,
    rep_name: repName, rep_email: repEmail,
    email_to: repEmail ? [repEmail] : [],
    email_cc: [], email_subject: emailSubject,
    email_html: emailHtml, segment, status,
    timestamp: new Date().toISOString(),
  });
}

/**
 * Process a single Support call.
 */
async function processSupportCall({ callId, callName, callData, transcript, smtp, runLog }) {
  const parties = callData.parties || [];
  const external = parties.filter(
    p => p.affiliation !== "internal" && !((p.emailAddress || "").includes(config.SITEZEUS_DOMAIN))
  );

  const toEmails = external
    .map(p => (p.emailAddress || "").toLowerCase().trim())
    .filter(Boolean);

  const ccEmails = [config.INTERNAL_NOTIFICATION_EMAIL].filter(Boolean);

  const prospect = external[0] || {};
  const prospectName = (prospect.name || "").trim();
  const prospectFirstName = prospectName ? prospectName.split(" ")[0] : "there";
  const primaryEmail = (prospect.emailAddress || "").toLowerCase().trim() || null;

  if (!primaryEmail) {
    console.info(`[Support] Call ${callId}: no external attendee — skipping`);
    runLog.calls_processed.push({
      call_id: callId, call_name: callName, team: "support",
      status: "no_contact", error: "No external attendees found",
      timestamp: new Date().toISOString(),
    });
    return;
  }

  console.info(`[Support] Call ${callId}: prospect=${primaryEmail}, transcript sentences=${transcript?.length ?? 0}`);

  let emailHtml = null;
  let emailSubject = null;
  let status = "dashboard";

  try {
    const { subject, html } = await formatSupportEmail(callData, prospectFirstName, callName, transcript);
    emailHtml = html;
    emailSubject = subject;

    if (smtp.user && smtp.password) {
      try {
        await sendEmail({
          smtpUser: smtp.user, smtpPassword: smtp.password,
          fromAddress: config.SUPPORT_FROM_EMAIL,
          toAddresses: toEmails, ccAddresses: ccEmails,
          subject, bodyHtml: html,
        });
        status = "sent";
        console.info(`[Support] Email sent for call ${callId} → ${toEmails}`);
      } catch (smtpErr) {
        console.warn(`[Support] SMTP failed for call ${callId} (${smtpErr.message}) — falling back to dashboard`);
        status = "dashboard";
      }
    } else {
      console.info(`[Support] Call ${callId}: no SMTP credentials — logging draft to dashboard`);
    }
  } catch (err) {
    console.error(`[Support] Format error for call ${callId}:`, err.message);
    status = "error";
  }

  runLog.calls_processed.push({
    call_id: callId, call_name: callName, team: "support",
    prospect_name: prospectName, prospect_email: primaryEmail,
    email_to: toEmails, email_cc: ccEmails,
    email_subject: emailSubject, email_html: emailHtml, status,
    timestamp: new Date().toISOString(),
  });
}

// ------------------------------------------------------------------
// Main
// ------------------------------------------------------------------

async function main() {
  const runStart = new Date();
  console.info("=".repeat(60));
  console.info(`[Main] Run started: ${runStart.toISOString()}`);

  // Environment
  const gongAccessKey = process.env.GONG_ACCESS_KEY;
  const gongSecret = process.env.GONG_SECRET;
  const hubspotToken = process.env.HUBSPOT_TOKEN;
  const smtpUser = process.env.SMTP_USER;
  const smtpPassword = process.env.SMTP_PASSWORD;

  if (!gongAccessKey || !gongSecret) {
    console.error("[Main] GONG_ACCESS_KEY and GONG_SECRET are required. Aborting.");
    process.exit(1);
  }

  const gong = new GongClient(gongAccessKey, gongSecret);
  const hs = hubspotToken ? new HubSpotClient(hubspotToken) : null;
  const smtp = { user: smtpUser, password: smtpPassword };

  if (!hs) console.warn("[Main] No HUBSPOT_TOKEN — enterprise classification disabled.");
  if (!smtp.user || !smtp.password) console.warn("[Main] No SMTP credentials — emails will go to dashboard only.");
  if (!process.env.ANTHROPIC_API_KEY) console.warn("[Main] No ANTHROPIC_API_KEY — support emails will use keyPoints fallback.");

  // Window
  const windowStart = loadLastRun();
  const windowEnd = runStart;
  console.info(`[Main] Window: ${windowStart.toISOString()} → ${windowEnd.toISOString()}`);

  const runLog = {
    id: `run-${runStart.getTime()}`,
    timestamp: runStart.toISOString(),
    window_start: windowStart.toISOString(),
    window_end: windowEnd.toISOString(),
    calls_processed: [],
  };

  try {
    // Team map
    const teamMap = await gong.buildTeamMap(config.SALES_MANAGER_NAME, config.SUPPORT_MANAGER_NAME);
    const userEmailMap = await gong.userEmailMap();
    const salesCount = Object.values(teamMap).filter(v => v === "sales").length;
    const supportCount = Object.values(teamMap).filter(v => v === "support").length;
    console.info(`[Main] Team map — sales: ${salesCount}, support: ${supportCount}`);

    // Fetch calls
    const calls = await gong.getCompletedCalls(windowStart, windowEnd);
    console.info(`[Main] Calls found: ${calls.length}`);

    if (!calls.length) {
      console.info("[Main] No new calls — done.");
      saveLastRun(windowEnd);
      recordRun(runLog);
      return;
    }

    const callIds = calls.map(c => c.id);

    // Fetch extensive data + transcripts
    const [extensive, transcriptsMap] = await Promise.all([
      gong.getCallsExtensive(callIds),
      gong.getTranscripts(callIds),
    ]);

    const extensiveMap = Object.fromEntries((extensive || []).map(c => [c.metaData?.id || c.id, c]));

    // Process each call
    for (const call of calls) {
      const callId = call.id;
      const callName = call.title || call.name || callId;
      const callData = extensiveMap[callId] || {};
      const transcript = transcriptsMap[callId] || [];

      // Determine team by host user ID
      const hostUserId = call.primaryUserId || call.ownerId || "";
      const hostEmail = (userEmailMap[hostUserId] || "").toLowerCase();

      const isSales = teamMap[hostUserId] === "sales" || (hostEmail && teamMap[hostEmail] === "sales");
      const isSupport = teamMap[hostUserId] === "support" || (hostEmail && teamMap[hostEmail] === "support");

      console.info(`[Main] Processing call ${callId} — team: ${isSales ? "sales" : isSupport ? "support" : "unknown"} — "${callName}"`);

      if (isSales) {
        await processSalesCall({ callId, callName, callData, transcript, teamMap, hs: hs || { findContactByEmail: async () => null, getOwnerEmail: async () => null, isEnterprise: () => false }, smtp, runLog });
      } else if (isSupport) {
        await processSupportCall({ callId, callName, callData, transcript, smtp, runLog });
      } else {
        console.info(`[Main] Call ${callId}: host ${hostEmail || hostUserId} not in a tracked team — skipping`);
      }
    }
  } catch (err) {
    console.error("[Main] Fatal error:", err.message, err.stack);
    runLog.fatal_error = err.message;
  }

  // Persist state
  saveLastRun(windowEnd);
  recordRun(runLog);

  const counts = runLog.calls_processed.reduce((acc, c) => {
    acc[c.status] = (acc[c.status] || 0) + 1;
    return acc;
  }, {});

  console.info("[Main] Done.", counts);
  console.info("=".repeat(60));
}

main().catch(err => {
  console.error("[Main] Unhandled:", err);
  process.exit(1);
});

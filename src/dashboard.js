// dashboard.js — Manages the activity log and regenerates docs/index.html.
//
// The dashboard is a self-contained HTML file with all data embedded as a
// JavaScript constant — no server required; works via GitHub Pages.

import { readFileSync, writeFileSync, mkdirSync, existsSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "..");

const ACTIVITY_LOG_FILE = join(ROOT, "state", "activity_log.json");
const DASHBOARD_FILE = join(ROOT, "docs", "index.html");
const MAX_RUNS = 100;

// ------------------------------------------------------------------
// Log management
// ------------------------------------------------------------------

export function loadLog() {
  if (existsSync(ACTIVITY_LOG_FILE)) {
    try {
      return JSON.parse(readFileSync(ACTIVITY_LOG_FILE, "utf-8"));
    } catch {
      // fall through
    }
  }
  return { runs: [] };
}

export function saveLog(log) {
  const dir = dirname(ACTIVITY_LOG_FILE);
  mkdirSync(dir, { recursive: true });
  writeFileSync(ACTIVITY_LOG_FILE, JSON.stringify(log, null, 2), "utf-8");
}

export function recordRun(run) {
  const log = loadLog();
  log.runs.unshift(run);
  log.runs = log.runs.slice(0, MAX_RUNS);
  log.last_updated = new Date().toISOString();
  saveLog(log);
  writeDashboard(log);
  console.info("[Dashboard] Updated.");
}

// ------------------------------------------------------------------
// Dashboard generation
// ------------------------------------------------------------------

export function writeDashboard(log) {
  mkdirSync(dirname(DASHBOARD_FILE), { recursive: true });
  writeFileSync(DASHBOARD_FILE, buildHtml(log), "utf-8");
}

function buildHtml(log) {
  const runsJson = JSON.stringify(log.runs || [], null, 0);
  const lastUpdated = log.last_updated || "";
  let lastUpdatedDisplay = "Never";
  if (lastUpdated) {
    try {
      const dt = new Date(lastUpdated);
      lastUpdatedDisplay = dt.toLocaleString("en-US", {
        month: "short", day: "numeric", year: "numeric",
        hour: "numeric", minute: "2-digit", timeZone: "UTC", timeZoneName: "short",
      });
    } catch {
      lastUpdatedDisplay = lastUpdated;
    }
  }

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>SiteZeus — Call Email Automation</title>
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link href="https://fonts.googleapis.com/css2?family=Lato:wght@300;400;700;900&display=swap" rel="stylesheet">
  <link href="https://fonts.googleapis.com/icon?family=Material+Icons+Round" rel="stylesheet">
  <style>
    /* ---- Reset ---- */
    *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }

    /* ---- Brand tokens ---- */
    :root {
      --sz-bg:         #100c2d;
      --sz-surface:    #130e35;
      --sz-surface-2:  #1b1545;
      --sz-border:     rgba(255,255,255,0.08);
      --sz-cyan:       #00e1ed;
      --sz-cyan-dim:   rgba(0,225,237,0.12);
      --sz-cyan-glow:  rgba(0,225,237,0.25);
      --sz-text:       #f8fafc;
      --sz-text-muted: rgba(248,250,252,0.55);
      --sz-radius:     12px;
      --sz-radius-sm:  6px;
      --sz-shadow:     0 4px 24px rgba(0,0,0,0.4);
    }

    body {
      font-family: 'Lato', sans-serif;
      background: var(--sz-bg);
      color: var(--sz-text);
      min-height: 100vh;
    }

    /* ---- Header ---- */
    .header {
      background: var(--sz-surface);
      border-bottom: 1px solid var(--sz-border);
      padding: 0 32px;
      height: 64px;
      display: flex;
      align-items: center;
      justify-content: space-between;
      position: sticky;
      top: 0;
      z-index: 100;
      backdrop-filter: blur(8px);
    }
    .header-left { display: flex; align-items: center; gap: 14px; }
    .sz-logo {
      width: 36px; height: 36px;
      background: linear-gradient(135deg, #00e1ed 0%, #7b5ea7 100%);
      border-radius: 8px;
      display: flex; align-items: center; justify-content: center;
      font-weight: 900; font-size: 13px; color: #100c2d;
      letter-spacing: -0.5px;
      flex-shrink: 0;
    }
    .header-title { font-size: 16px; font-weight: 700; }
    .header-sub { font-size: 11px; color: var(--sz-text-muted); margin-top: 1px; }
    .last-updated { font-size: 11px; color: var(--sz-text-muted); text-align: right; line-height: 1.5; }
    .last-updated strong { color: var(--sz-cyan); font-weight: 700; }

    /* ---- Stats bar ---- */
    .stats-bar {
      background: var(--sz-surface);
      border-bottom: 1px solid var(--sz-border);
      padding: 0 32px;
      display: flex;
      gap: 0;
      overflow-x: auto;
    }
    .stat {
      padding: 16px 32px 16px 0;
      margin-right: 32px;
      border-right: 1px solid var(--sz-border);
      white-space: nowrap;
      flex-shrink: 0;
    }
    .stat:last-child { border-right: none; }
    .stat-value { font-size: 26px; font-weight: 900; color: var(--sz-cyan); }
    .stat-label { font-size: 11px; color: var(--sz-text-muted); margin-top: 2px; text-transform: uppercase; letter-spacing: 0.08em; }

    /* ---- Main content ---- */
    .content { max-width: 1100px; margin: 32px auto; padding: 0 24px; }
    .section-title {
      font-size: 11px; font-weight: 700; color: var(--sz-text-muted);
      text-transform: uppercase; letter-spacing: 0.1em; margin-bottom: 16px;
    }

    /* ---- Run cards ---- */
    .run-card {
      background: var(--sz-surface);
      border: 1px solid var(--sz-border);
      border-radius: var(--sz-radius);
      margin-bottom: 12px;
      overflow: hidden;
      transition: border-color 0.2s;
    }
    .run-card:hover { border-color: rgba(0,225,237,0.3); }

    .run-header {
      padding: 16px 20px;
      display: flex;
      align-items: center;
      justify-content: space-between;
      cursor: pointer;
      user-select: none;
      transition: background 0.15s;
    }
    .run-header:hover { background: var(--sz-surface-2); }
    .run-header-left { display: flex; align-items: center; gap: 12px; }

    .run-dot { width: 8px; height: 8px; border-radius: 50%; flex-shrink: 0; }
    .dot-success { background: #00e1ed; box-shadow: 0 0 6px rgba(0,225,237,0.6); }
    .dot-empty   { background: rgba(255,255,255,0.2); }
    .dot-error   { background: #ff5c5c; box-shadow: 0 0 6px rgba(255,92,92,0.5); }

    .run-time { font-size: 14px; font-weight: 700; }
    .run-meta { font-size: 11px; color: var(--sz-text-muted); margin-top: 2px; }

    .run-pills { display: flex; gap: 8px; align-items: center; flex-wrap: wrap; }
    .pill {
      display: inline-flex; align-items: center; gap: 4px;
      padding: 3px 10px; border-radius: 20px;
      font-size: 11px; font-weight: 700; letter-spacing: 0.02em;
    }
    .pill-cyan  { background: var(--sz-cyan-dim); color: var(--sz-cyan); border: 1px solid var(--sz-cyan-glow); }
    .pill-green { background: rgba(0,225,150,0.12); color: #00e196; border: 1px solid rgba(0,225,150,0.25); }
    .pill-red   { background: rgba(255,92,92,0.12); color: #ff5c5c; border: 1px solid rgba(255,92,92,0.25); }
    .pill-gray  { background: rgba(255,255,255,0.06); color: var(--sz-text-muted); border: 1px solid var(--sz-border); }

    .chevron {
      font-size: 12px; color: var(--sz-text-muted);
      transition: transform 0.2s; margin-left: 8px;
    }
    .chevron.open { transform: rotate(90deg); }

    /* ---- Run body ---- */
    .run-body { display: none; border-top: 1px solid var(--sz-border); }
    .run-body.open { display: block; }

    /* ---- Call rows ---- */
    .call-row {
      padding: 14px 20px 14px 40px;
      border-bottom: 1px solid var(--sz-border);
    }
    .call-row:last-child { border-bottom: none; }
    .call-top { display: flex; align-items: flex-start; justify-content: space-between; gap: 16px; }
    .call-info { flex: 1; min-width: 0; }
    .call-name { font-size: 14px; font-weight: 700; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
    .call-detail {
      font-size: 12px; color: var(--sz-text-muted);
      margin-top: 4px; display: flex; flex-wrap: wrap; gap: 12px;
    }
    .call-right { display: flex; align-items: center; gap: 8px; flex-shrink: 0; }

    .team-badge {
      padding: 2px 8px; border-radius: 4px;
      font-size: 10px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.05em;
    }
    .badge-sales    { background: rgba(123,94,167,0.2); color: #b39ddb; border: 1px solid rgba(123,94,167,0.4); }
    .badge-support  { background: rgba(0,225,237,0.1); color: var(--sz-cyan); border: 1px solid var(--sz-cyan-glow); }

    .status-badge {
      padding: 2px 8px; border-radius: 4px;
      font-size: 10px; font-weight: 700; letter-spacing: 0.03em;
    }
    .badge-sent        { background: rgba(0,225,150,0.12); color: #00e196; border: 1px solid rgba(0,225,150,0.25); }
    .badge-dashboard   { background: var(--sz-cyan-dim); color: var(--sz-cyan); border: 1px solid var(--sz-cyan-glow); }
    .badge-error       { background: rgba(255,92,92,0.12); color: #ff5c5c; border: 1px solid rgba(255,92,92,0.25); }
    .badge-no-contact  { background: rgba(255,185,50,0.1); color: #fbb950; border: 1px solid rgba(255,185,50,0.25); }

    /* ---- Email preview ---- */
    .email-toggle-btn {
      margin-top: 10px;
      padding: 5px 14px;
      background: var(--sz-surface-2);
      border: 1px solid var(--sz-border);
      border-radius: var(--sz-radius-sm);
      font-size: 12px; font-weight: 700; font-family: 'Lato', sans-serif;
      color: var(--sz-cyan);
      cursor: pointer;
      display: inline-flex; align-items: center; gap: 6px;
      transition: background 0.15s, border-color 0.15s;
    }
    .email-toggle-btn:hover {
      background: var(--sz-cyan-dim);
      border-color: var(--sz-cyan-glow);
    }

    .email-preview {
      display: none;
      margin-top: 12px;
      border: 1px solid var(--sz-border);
      border-radius: var(--sz-radius-sm);
      overflow: hidden;
    }
    .email-preview.open { display: block; }

    .email-preview-header {
      background: var(--sz-surface-2);
      padding: 10px 16px;
      font-size: 12px;
      color: var(--sz-text-muted);
      border-bottom: 1px solid var(--sz-border);
    }
    .email-preview-subject { font-weight: 700; color: var(--sz-text); }
    .email-preview-body {
      padding: 16px;
      background: #fff;
      color: #333;
      font-size: 13px;
      line-height: 1.6;
      max-height: 400px;
      overflow-y: auto;
    }

    .copy-btn {
      padding: 5px 12px;
      background: var(--sz-cyan);
      color: #100c2d;
      border: none;
      border-radius: var(--sz-radius-sm);
      font-size: 11px; font-weight: 700; font-family: 'Lato', sans-serif;
      cursor: pointer;
      white-space: nowrap;
      transition: opacity 0.2s;
    }
    .copy-btn:hover { opacity: 0.85; }

    .call-error {
      margin-top: 6px;
      font-size: 12px;
      color: #ff5c5c;
      background: rgba(255,92,92,0.08);
      padding: 6px 10px;
      border-radius: 4px;
      border: 1px solid rgba(255,92,92,0.2);
    }

    /* ---- Empty state ---- */
    .empty-state {
      text-align: center;
      padding: 80px 32px;
      color: var(--sz-text-muted);
    }
    .empty-icon {
      width: 56px; height: 56px;
      background: var(--sz-cyan-dim);
      border-radius: 14px;
      display: flex; align-items: center; justify-content: center;
      margin: 0 auto 16px;
      font-size: 28px;
    }
    .empty-state h3 { font-size: 16px; font-weight: 700; color: var(--sz-text); margin-bottom: 8px; }
    .empty-state p { font-size: 13px; line-height: 1.6; }
  </style>
</head>
<body>

<!-- Header -->
<div class="header">
  <div class="header-left">
    <div class="sz-logo">SZ</div>
    <div>
      <div class="header-title">Call Email Automation</div>
      <div class="header-sub">SiteZeus · Gong → Outlook</div>
    </div>
  </div>
  <div class="last-updated">
    Last updated<br><strong>${lastUpdatedDisplay}</strong>
  </div>
</div>

<!-- Stats -->
<div class="stats-bar" id="stats-bar"></div>

<!-- Content -->
<div class="content">
  <div class="section-title">Run History</div>
  <div id="runs-container"></div>
</div>

<script>
const RUNS = ${runsJson};

// -------------------------------------------------------
// Stats
// -------------------------------------------------------
function renderStats() {
  const bar = document.getElementById('stats-bar');
  let totalRuns = RUNS.length, totalCalls = 0, totalSent = 0, totalDraft = 0, totalErrors = 0;
  let totalWaiting = 0;
  RUNS.forEach(r => {
    (r.calls_processed || []).forEach(c => {
      if (c.status === 'waiting') { totalWaiting++; return; } // not processed yet
      totalCalls++;
      if (c.status === 'sent') totalSent++;
      else if (c.status === 'dashboard') totalDraft++;
      else if (c.status === 'error') totalErrors++;
    });
  });
  const stats = [
    { value: totalRuns,    label: 'Total Runs' },
    { value: totalCalls,   label: 'Calls Processed' },
    { value: totalSent,    label: 'Emails Sent' },
    { value: totalDraft,   label: 'Drafts Ready' },
    { value: totalWaiting, label: 'Awaiting Transcript' },
    { value: totalErrors,  label: 'Errors' },
  ];
  bar.innerHTML = stats.map(s =>
    \`<div class="stat"><div class="stat-value">\${s.value}</div><div class="stat-label">\${s.label}</div></div>\`
  ).join('');
}

// -------------------------------------------------------
// Format helpers
// -------------------------------------------------------
function fmtTime(iso) {
  if (!iso) return '';
  try {
    return new Date(iso).toLocaleString('en-US', {
      month: 'short', day: 'numeric', year: 'numeric',
      hour: 'numeric', minute: '2-digit', timeZoneName: 'short',
    });
  } catch { return iso; }
}

function statusBadge(status) {
  const map = {
    sent:        ['badge-sent',       'Sent'],
    dashboard:   ['badge-dashboard',  'Draft Ready'],
    error:       ['badge-error',      'Error'],
    no_contact:  ['badge-no-contact', 'No Contact'],
    waiting:     ['badge-no-contact', 'Awaiting Transcript'],
  };
  const [cls, label] = map[status] || ['badge-gray', status];
  return \`<span class="status-badge \${cls}">\${label}</span>\`;
}

function teamBadge(team) {
  return team === 'sales'
    ? \`<span class="team-badge badge-sales">Sales</span>\`
    : \`<span class="team-badge badge-support">Support</span>\`;
}

function runDotClass(run) {
  const calls = run.calls_processed || [];
  if (!calls.length) return 'dot-empty';
  if (calls.some(c => c.status === 'error')) return 'dot-error';
  if (calls.some(c => c.status === 'sent' || c.status === 'dashboard')) return 'dot-success';
  return 'dot-empty';
}

// -------------------------------------------------------
// Email preview
// -------------------------------------------------------
function toggleEmailPreview(btn, previewId) {
  const preview = document.getElementById(previewId);
  const isOpen = preview.classList.contains('open');
  preview.classList.toggle('open', !isOpen);
  btn.innerHTML = isOpen
    ? '<span class="material-icons-round" style="font-size:14px;vertical-align:middle;">mail</span> View Email Draft'
    : '<span class="material-icons-round" style="font-size:14px;vertical-align:middle;">expand_less</span> Hide';
}

function copyEmailDraft(elementId, btn) {
  const el = document.getElementById(elementId);
  if (!el) return;
  const original = btn.innerHTML;
  const confirm = () => {
    btn.innerHTML = '✓ Copied!';
    btn.style.background = '#00c8a0';
    setTimeout(() => { btn.innerHTML = original; btn.style.background = ''; }, 2500);
  };
  try {
    const item = new ClipboardItem({
      'text/html': new Blob([el.innerHTML], { type: 'text/html' }),
      'text/plain': new Blob([el.innerText || el.textContent], { type: 'text/plain' }),
    });
    navigator.clipboard.write([item]).then(confirm).catch(() => navigator.clipboard.writeText(el.innerText).then(confirm));
  } catch {
    navigator.clipboard.writeText(el.innerText).then(confirm);
  }
}

// -------------------------------------------------------
// Call row
// -------------------------------------------------------
function renderCall(call, runId, idx) {
  const previewId = \`preview-\${runId}-\${idx}\`;
  const hasDraft = (call.status === 'sent' || call.status === 'dashboard') && call.email_html;

  const recipients = [];
  if (call.rep_name) recipients.push(\`Rep: \${call.rep_name}\`);
  if (call.prospect_name && call.prospect_email) recipients.push(\`Prospect: \${call.prospect_name} &lt;\${call.prospect_email}&gt;\`);
  if (call.segment) recipients.push(\`Segment: \${call.segment}\`);
  if (!call.rep_name && call.email_to?.length) recipients.push(\`To: \${call.email_to.join(', ')}\`);

  const draftHtml = hasDraft ? \`
    <button class="email-toggle-btn" onclick="toggleEmailPreview(this,'\${previewId}')">
      <span class="material-icons-round" style="font-size:14px;vertical-align:middle;">mail</span>
      View Email Draft
    </button>
    <div class="email-preview" id="\${previewId}">
      <div class="email-preview-header">
        <div style="display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:8px;">
          <div>
            <div class="email-preview-subject">\${call.email_subject || 'Email'}</div>
            \${call.email_to ? \`<div style="margin-top:3px;font-size:11px;">To: \${call.email_to.join(', ')}\${call.email_cc?.length ? ' · CC: ' + call.email_cc.join(', ') : ''}</div>\` : ''}
          </div>
          <button class="copy-btn" onclick="copyEmailDraft('draft-\${runId}-\${idx}', this)">Copy Email</button>
        </div>
      </div>
      <div class="email-preview-body" id="draft-\${runId}-\${idx}">\${call.email_html}</div>
    </div>\` : '';

  const errorHtml = (call.status !== 'sent' && call.error)
    ? \`<div class="call-error">⚠ \${call.error}</div>\` : '';

  return \`
    <div class="call-row">
      <div class="call-top">
        <div class="call-info">
          <div class="call-name">\${call.call_name || 'Unknown Call'}</div>
          <div class="call-detail">
            \${recipients.map(r => \`<span>\${r}</span>\`).join('')}
            <span>🕐 \${fmtTime(call.timestamp)}</span>
          </div>
          \${errorHtml}\${draftHtml}
        </div>
        <div class="call-right">
          \${teamBadge(call.team)}
          \${statusBadge(call.status)}
        </div>
      </div>
    </div>\`;
}

// -------------------------------------------------------
// Run card
// -------------------------------------------------------
function renderRun(run, idx) {
  const calls = run.calls_processed || [];
  const sentCount = calls.filter(c => c.status === 'sent').length;
  const draftCount = calls.filter(c => c.status === 'dashboard').length;
  const errCount = calls.filter(c => c.status === 'error').length;
  const runId = run.id || idx;
  const bodyId = \`run-body-\${runId}\`;
  const chevId = \`chev-\${runId}\`;

  const pills = [];
  if (calls.length) pills.push(\`<span class="pill pill-cyan">\${calls.length} call\${calls.length !== 1 ? 's' : ''}</span>\`);
  if (sentCount) pills.push(\`<span class="pill pill-green">✓ \${sentCount} sent</span>\`);
  if (draftCount) pills.push(\`<span class="pill pill-cyan">✎ \${draftCount} draft\${draftCount !== 1 ? 's' : ''}</span>\`);
  if (errCount)   pills.push(\`<span class="pill pill-red">⚠ \${errCount} error\${errCount !== 1 ? 's' : ''}</span>\`);
  if (!calls.length) pills.push('<span class="pill pill-gray">No calls</span>');

  const callsHtml = calls.length
    ? calls.map((c, i) => renderCall(c, runId, i)).join('')
    : '<div style="padding:16px 20px 16px 40px;font-size:13px;color:var(--sz-text-muted);">No calls processed in this run.</div>';

  return \`
    <div class="run-card">
      <div class="run-header" onclick="toggleRun('\${bodyId}','\${chevId}')">
        <div class="run-header-left">
          <div class="run-dot \${runDotClass(run)}"></div>
          <div>
            <div class="run-time">\${fmtTime(run.timestamp)}</div>
            <div class="run-meta">Window: \${fmtTime(run.window_start)} → \${fmtTime(run.window_end)}</div>
          </div>
        </div>
        <div style="display:flex;align-items:center;gap:8px;">
          <div class="run-pills">\${pills.join('')}</div>
          <span class="chevron material-icons-round" id="\${chevId}">chevron_right</span>
        </div>
      </div>
      <div class="run-body" id="\${bodyId}">\${callsHtml}</div>
    </div>\`;
}

function toggleRun(bodyId, chevId) {
  const body = document.getElementById(bodyId);
  const chev = document.getElementById(chevId);
  const open = body.classList.toggle('open');
  chev.classList.toggle('open', open);
}

// -------------------------------------------------------
// Init
// -------------------------------------------------------
function init() {
  renderStats();
  const container = document.getElementById('runs-container');
  if (!RUNS?.length) {
    container.innerHTML = \`
      <div class="empty-state">
        <div class="empty-icon">⚡</div>
        <h3>No runs recorded yet</h3>
        <p>Trigger the GitHub Actions workflow to see call activity here.</p>
      </div>\`;
    return;
  }
  container.innerHTML = RUNS.map((r, i) => renderRun(r, i)).join('');
}

init();
</script>
</body>
</html>`;
}

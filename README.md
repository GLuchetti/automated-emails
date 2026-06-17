# SiteZeus Gong → Email Automation

Automatically sends post-call summary emails after Gong calls end.
- **Support calls** → sends an action-items summary draft for CSM review.
- **Sales calls** → sends a formatted follow-up draft to the rep for review before they send to the prospect.

Runs on **Node.js 20** via GitHub Actions every 15 minutes. No middleware, no new platforms — just GitHub, Gong, HubSpot, Anthropic, and Outlook SMTP.

A live status dashboard is published via GitHub Pages from `docs/index.html`:
👉 https://gluchetti.github.io/automated-emails/

---

## How It Runs

The workflow [`.github/workflows/process_calls.yml`](.github/workflows/process_calls.yml) does:

1. `npm ci` — install dependencies
2. `node src/main.js` — pull recent Gong calls, route them, and send/draft emails
3. Commits `state/last_run.json`, `state/activity_log.json`, and the regenerated `docs/index.html` back to `main`

```
.github/workflows/process_calls.yml
src/
  main.js              # entry point — orchestrates a run
  config.js            # reps, managers, resource links, domain settings
  gongClient.js        # Gong API
  hubspotClient.js     # HubSpot contact lookup
  emailHandler.js      # Outlook SMTP send (nodemailer)
  salesFormatter.js    # builds the sales follow-up HTML draft
  supportFormatter.js  # builds the support follow-up HTML draft
  dashboard.js         # activity log + regenerates docs/index.html
docs/index.html        # GitHub Pages dashboard (auto-generated)
state/                 # last_run.json + activity_log.json (auto-committed)
package.json
```

> **There is only one codebase: the `.js` files.** Edit those, commit, and push to `main` — the next scheduled run (or a manual trigger) picks them up.

---

## One-Time Setup

### Step 1 — Generate an Outlook App Password

This lets the script send email from `support@sitezeus.com` without using the main password.

1. Sign in to [account.microsoft.com](https://account.microsoft.com) with the sending account
2. Go to **Security → Advanced security options → App passwords**
3. Click **Create a new app password** and copy it (you will not see it again)

> If "App passwords" is not visible, your Microsoft 365 admin needs to enable Multi-Factor Authentication for the account first.

### Step 2 — Add GitHub Secrets

In the repo: **Settings → Secrets and variables → Actions → New repository secret**.

| Secret name | Value |
|---|---|
| `GONG_ACCESS_KEY` | Gong API Access Key |
| `GONG_SECRET` | Gong API Access Key Secret |
| `HUBSPOT_TOKEN` | HubSpot Private App token |
| `SMTP_USER` | Sending mailbox, e.g. `support@sitezeus.com` |
| `SMTP_PASSWORD` | The Outlook app password from Step 1 |
| `ANTHROPIC_API_KEY` | Anthropic API key (used to summarize transcripts) |

### Step 3 — Verify `src/config.js`

Open [`src/config.js`](src/config.js) and confirm:
- Manager names match exactly as they appear in Gong (case-sensitive)
- Sales rep emails match their Gong account emails exactly
- Resource URLs point to live sitezeus.com pages

### Step 4 — Enable GitHub Actions

**Actions** tab → enable workflows if prompted. It then runs automatically every 15 minutes, and can be triggered manually via **Actions → Process Gong Calls → Run workflow**.

---

## How State Works

Gong needs time to transcribe a call after it ends, so the workflow waits for the transcript instead of emailing immediately:

- Each run scans a **lookback window** of the last `LOOKBACK_HOURS` (default 8h), not just since the last run.
- A call is only emailed once its **transcript is actually available**. If it isn't ready yet, the call is **deferred and retried** on later runs (shown as *Awaiting Transcript* on the dashboard).
- If a transcript still hasn't appeared after `TRANSCRIPT_CUTOFF_HOURS` (default 6h), the call is sent on the Gong-summary fallback so it never waits forever.
- Every emailed call ID is recorded in `state/processed_calls.json` so **no call is ever emailed twice** (this, not the time window, is the dedupe guarantee). Entries are pruned after 7 days.

Both `LOOKBACK_HOURS` and `TRANSCRIPT_CUTOFF_HOURS` live in [`src/config.js`](src/config.js). `state/last_run.json` is still written each run for reference but no longer gates which calls are processed.

---

## Common Edits

**Add / remove a sales rep:** edit `SALES_REPS` in [`src/config.js`](src/config.js), commit, push.

**Change managers:** update `SALES_MANAGER_NAME` / `SUPPORT_MANAGER_NAME` in `config.js`.

**Update resource links:** edit `ENTERPRISE_RESOURCES` / `SMB_EMERGING_RESOURCES` in `config.js`. Each entry's `topics` list is matched against Gong call tracker names to pick the most relevant resources.

**Change email wording/format:** edit `salesFormatter.js` (sales) or `supportFormatter.js` (support).

---

## Troubleshooting

| Symptom | Likely cause | Fix |
|---|---|---|
| `SMTP authentication failed` | Wrong app password | Regenerate app password, update `SMTP_PASSWORD` secret |
| Sales manager not found in Gong | Name mismatch | Check exact spelling in Gong → update `SALES_MANAGER_NAME` in `config.js` |
| Calls processed but emails not received | Spam filter | Check spam folder; whitelist the sending address |
| HubSpot contact missing | Prospect not in HubSpot | Add the contact to HubSpot manually and send follow-up |
| Duplicate emails | Overlapping runs | Rare; the state file prevents true duplicates |

Run logs are available under **Actions** for every execution, and a visual history is on the [dashboard](https://gluchetti.github.io/automated-emails/).

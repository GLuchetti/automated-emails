# SiteZeus Gong → Email Automation

Automatically sends post-call summary emails after Gong calls end.
- **Support calls** → sends action items + key decisions email to all participants from `support@sitezeus.com`
- **Sales calls** → sends a formatted draft to the rep for review before they send to the prospect

Runs via GitHub Actions every 15 minutes. No middleware, no new platforms — just GitHub, Gong, HubSpot, and Outlook.

---

## One-Time Setup

### Step 1 — Create the GitHub repo

1. Create a new **private** GitHub repo (e.g. `gong-email-automation`)
2. Upload all files from this folder into the repo, preserving the folder structure:
   ```
   .github/workflows/process_calls.yml
   src/
     config.py
     main.py
     gong_client.py
     hubspot_client.py
     email_handler.py
     support_formatter.py
     sales_formatter.py
   state/.gitkeep
   requirements.txt
   README.md
   ```

---

### Step 2 — Generate an Outlook App Password

This lets the script send email from `support@sitezeus.com` without using your main password.

1. Sign in to [account.microsoft.com](https://account.microsoft.com) with the `support@sitezeus.com` account
2. Go to **Security → Advanced security options → App passwords**
3. Click **Create a new app password**
4. Copy the generated password — you will not see it again

> If "App passwords" is not visible, your Microsoft 365 admin needs to enable Multi-Factor Authentication for the account first.

---

### Step 3 — Add GitHub Secrets

In your GitHub repo, go to **Settings → Secrets and variables → Actions → New repository secret**.

Add each of these:

| Secret name | Value |
|---|---|
| `GONG_ACCESS_KEY` | Your Gong API Access Key |
| `GONG_SECRET` | Your Gong API Access Key Secret |
| `HUBSPOT_TOKEN` | Your HubSpot Private App token |
| `SUPPORT_EMAIL` | `support@sitezeus.com` |
| `SUPPORT_APP_PASSWORD` | The app password from Step 2 |

---

### Step 4 — Verify `src/config.py`

Open `src/config.py` and confirm:

- Manager names match exactly as they appear in Gong (case-sensitive)
- Sales rep emails match their Gong account emails exactly
- `ENTERPRISE_UNIT_COUNT_PROPERTY` matches the HubSpot internal property name
- Resource URLs point to live sitezeus.com pages

---

### Step 5 — Enable GitHub Actions

1. In the repo, go to **Actions**
2. If prompted, click **"I understand my workflows, go ahead and enable them"**
3. The workflow will now run automatically every 15 minutes

---

### Step 6 — Test it manually

1. In the repo, go to **Actions → Process Gong Calls**
2. Click **"Run workflow"** → **"Run workflow"**
3. Watch the run log to confirm it connects to Gong and HubSpot successfully
4. On first run with no recent calls, you will see: `No new calls in window.` — that is correct

To test with a real call: record a short Gong call, wait for it to process (~5 min), then manually trigger the workflow.

---

## How State Works

After each run, the script writes `state/last_run.json` with the current UTC timestamp and commits it back to the repo. The next run picks up from that timestamp, so no call is processed twice.

If the state file is missing (e.g. first run), the script defaults to 25 minutes ago.

---

## Adding or Removing Team Members

**To add a new sales rep:** Open `src/config.py`, add their email and name to `SALES_REPS`. Commit and push.

**To remove a rep:** Delete their entry from `SALES_REPS`. Commit and push.

**Support team members** are identified by their Gong manager (Olivia Bolton) — no config change needed when support staff join or leave, as long as they're set up correctly in Gong under her team.

**To change managers:** Update `SALES_MANAGER_NAME` or `SUPPORT_MANAGER_NAME` in `config.py`.

---

## Updating Resource Links

All SiteZeus resource URLs live in `src/config.py` under `ENTERPRISE_RESOURCES` and `SMB_EMERGING_RESOURCES`. Each entry has a `topics` list — these are matched against Gong's call tracker names to select the most relevant resources for each call. Update URLs or add new topics as the sitezeus.com site evolves.

---

## Troubleshooting

| Symptom | Likely cause | Fix |
|---|---|---|
| `SMTP authentication failed` | Wrong app password | Regenerate app password, update `SUPPORT_APP_PASSWORD` secret |
| `Sales manager not found in Gong` | Name mismatch | Check exact spelling in Gong → update `SALES_MANAGER_NAME` in config.py |
| Calls processed but emails not received | Spam filter | Check spam folder; whitelist `support@sitezeus.com` |
| `HubSpot contact missing` alert | Prospect not in HubSpot | Add the contact to HubSpot manually and send follow-up |
| Duplicate emails | GitHub Actions delay caused overlapping runs | Rare; the state file prevents true duplicates |

Run logs are available under **Actions** in the GitHub repo for every execution.

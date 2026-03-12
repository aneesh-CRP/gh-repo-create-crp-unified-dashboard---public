# CRP Dashboard — Parallel Deployment Guide

## Architecture: GitHub Pages + Apps Script

```
                    ┌─────────────────────────────────────────┐
                    │           index.html (source of truth)   │
                    └──────────────┬───────────────────────────┘
                                   │
                    ┌──────────────┴───────────────┐
                    ▼                               ▼
          GitHub Pages (dev)              Apps Script (production)
          ─────────────────              ──────────────────────────
          • git push → live             • ./deploy-appscript.sh
          • Public URL                  • Google SSO restricted
          • Fast iteration              • @phillyresearch.com only
          • No auth                     • HIPAA-compliant access
```

**Both stay in sync** — `index.html` is the single source. The deploy script copies it to `Dashboard.html` for Apps Script.

---

## One-Time Setup (10 minutes)

### 1. Install clasp

```bash
npm install -g @google/clasp
clasp login    # opens browser for Google auth
```

### 2. Create Apps Script Project

1. Go to [script.google.com](https://script.google.com) → **New Project**
2. Rename to **"CRP-Dashboard"**
3. Go to **Project Settings** (gear icon) → copy the **Script ID**
4. Check **"Show appsscript.json manifest file in editor"**

### 3. Configure clasp locally

```bash
cd appscript
cp .clasp.json.template .clasp.json
```

Edit `.clasp.json` and replace `YOUR_SCRIPT_ID_HERE` with your Script ID:

```json
{
  "scriptId": "1abc...xyz",
  "rootDir": "."
}
```

### 4. First push

```bash
cd ..
./deploy-appscript.sh --deploy
```

This copies `index.html` → `appscript/Dashboard.html`, pushes all files to Apps Script, and creates the first deployment.

### 5. Set web app access

1. In Apps Script editor: **Deploy** → **Manage deployments**
2. Click the pencil icon on the active deployment
3. Set:
   - **Execute as:** Me
   - **Who has access:** Anyone within phillyresearch.com
4. Click **Deploy**
5. Copy the web app URL — this is your production dashboard

---

## Daily Workflow

### After making changes to index.html:

```bash
# 1. Push to GitHub (dev)
git add index.html
git commit -m "description"
git push origin main
# → GitHub Pages updates in ~30 seconds

# 2. Push to Apps Script (production)
./deploy-appscript.sh
# → Updates the Apps Script code (existing deployment URL stays the same)

# 3. Deploy new version (only needed for URL changes or major updates)
./deploy-appscript.sh --deploy
```

**Note:** `clasp push` updates the code behind the existing deployment URL. You only need `--deploy` to create a new versioned deployment.

---

## File Structure

```
repo/
├── index.html                  ← Source of truth (GitHub Pages + dev)
├── WebApp.gs                   ← Reference copy (not used by clasp)
├── apps-script.js              ← Data consolidation triggers
├── deploy-appscript.sh         ← One-command sync & deploy
├── appscript/                  ← clasp project directory
│   ├── .clasp.json.template    ← Template (committed)
│   ├── .clasp.json             ← Your config (gitignored)
│   ├── .gitignore              ← Ignores .clasp.json + Dashboard.html
│   ├── appsscript.json         ← Apps Script manifest
│   ├── WebApp.gs               ← doGet() handler
│   └── Dashboard.html          ← Generated from index.html (gitignored)
└── DEPLOY-APPS-SCRIPT.md       ← This file
```

---

## Apps Script Project Files

Your Apps Script project will contain:

| File | Purpose |
|------|---------|
| `WebApp.gs` | `doGet()` serves the dashboard HTML |
| `Dashboard.html` | The full dashboard (copied from `index.html`) |
| `appsscript.json` | Project manifest (timezone, runtime, web app config) |
| `Code.gs` | Data consolidation triggers (your existing script) |

---

## Security

- **Authentication:** Google Workspace SSO — only `@phillyresearch.com` users
- **BAA Coverage:** Falls under existing Google Workspace Enterprise BAA
- **PHI Masking:** Default-on, togglable per session
- **GitHub Pages:** Remains as fast dev preview (consider making repo private later)
- **No secrets in repo:** `.clasp.json` is gitignored

---

## Troubleshooting

**"Authorization required" on first visit:**
Normal — click through the Google auth prompt. Only happens once per user.

**Changes not showing after `clasp push`:**
For existing deployments, changes take effect immediately. If not, try:
```bash
./deploy-appscript.sh --deploy
```
This creates a fresh deployment version.

**"Exceeded maximum execution time":**
The dashboard HTML is large (~16K lines). If Apps Script times out serving it, the doGet function may need optimization. This hasn't been an issue so far.

**clasp push fails:**
```bash
clasp login --status    # Check if logged in
clasp pull              # Sync from server first, then re-push
```

# CRP Dashboard — Google Apps Script Web App Deployment

## Overview
This converts the dashboard from a public GitHub Pages site to an authenticated Google Apps Script web app, restricted to `phillyresearch.com` Google Workspace users. Covered under your existing Google Workspace Enterprise BAA.

---

## Step 1: Create the Apps Script Project

1. Go to [script.google.com](https://script.google.com) → **New Project**
2. Rename the project to **"CRP-Dashboard"**
3. You'll see a default `Code.gs` — this is your existing consolidation script

## Step 2: Add Files to the Project

Your Apps Script project needs 3 files:

| File | Source | Purpose |
|------|--------|---------|
| `Code.gs` | `apps-script.js` (already exists) | Data consolidation triggers |
| `WebApp.gs` | `WebApp.gs` (new file in this repo) | `doGet()` web app handler |
| `Dashboard.html` | `index.html` (renamed) | The dashboard UI |

**To add them:**
- Click **+** → **Script** → name it `WebApp` → paste contents of `WebApp.gs`
- Click **+** → **HTML** → name it `Dashboard` → paste contents of `index.html`
- Replace `Code.gs` contents with `apps-script.js` (if not already done)

## Step 3: Deploy as Web App

1. Click **Deploy** → **New deployment**
2. Click the gear icon → select **Web app**
3. Settings:
   - **Description:** "CRP Unified Intelligence Dashboard"
   - **Execute as:** Me (your Google account)
   - **Who has access:** Anyone within phillyresearch.com
4. Click **Deploy**
5. Copy the web app URL — this is your new authenticated dashboard link

## Step 4: Test

- Open the web app URL in an incognito window → should prompt for Google login
- Only `@phillyresearch.com` accounts will have access
- Verify all tabs load correctly (data comes from the same Google Sheets CSVs)

---

## Updating the Dashboard

### Option A: clasp CLI (Recommended)

```bash
# One-time setup
npm install -g @google/clasp
clasp login
clasp clone <SCRIPT_ID>   # Get script ID from Apps Script project settings

# Each time you update index.html:
cp index.html Dashboard.html
clasp push

# To deploy a new version:
clasp deploy --description "v2.x.x update"
```

### Option B: Manual Copy-Paste

1. Open [script.google.com](https://script.google.com) → your CRP-Dashboard project
2. Click on `Dashboard.html`
3. Select all → paste updated `index.html` contents
4. Click **Deploy** → **Manage deployments** → edit the active deployment → **Deploy**

---

## Architecture

```
User (phillyresearch.com) → Google SSO → Apps Script Web App
                                              ↓
                                         doGet() serves Dashboard.html
                                              ↓
                                    Dashboard fetches data from:
                                    ├── Google Sheets (published CSVs)
                                    ├── ClickUp API (referrals)
                                    └── CRIO (visit links)
```

## Security Notes

- **Authentication:** Handled by Google — only `@phillyresearch.com` domain users can access
- **BAA Coverage:** Falls under your existing Google Workspace Enterprise BAA
- **PHI Masking:** Patient names are masked by default (initials only), with toggle to reveal
- **No public exposure:** Dashboard is no longer accessible without Google Workspace authentication
- **GitHub repo:** Can remain as code backup (not user-facing) or be made private

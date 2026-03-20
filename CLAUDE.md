# CRP Dashboard — Development Rules

## Build Process
1. Edit `index.html` (source of truth)
2. Run `python3 scripts/build-appscript.py`
3. If `scripts/bigquery-cancels-sync.gs` was changed, copy it: `cp scripts/bigquery-cancels-sync.gs appscript/BigQueryCancels.gs`
4. Run `clasp push --force` to deploy to Apps Script (auto-deploys all files in `appscript/`)
5. Commit `index.html` + `dashboard.js` + `appscript/*.gs` together
6. Push without asking

## Apps Script Deployment
- `clasp` is configured via `.clasp.json` → script ID `15ZDwJzbYqFVtVc5e4TGl7yEWZFVKq2pQl-RyOKw8vsVnAGBqWrkSO19K`
- `rootDir: "appscript/"` — all `.gs`, `.html`, `.json` files in this dir get pushed
- `scripts/bigquery-cancels-sync.gs` is the source of truth for BQ sync; `appscript/BigQueryCancels.gs` is the deploy copy
- **NEVER** edit files in `appscript/` directly — edit source files, then build/copy

## Code Rules — MUST follow when writing or reviewing code

### Dates
- **NEVER** use `new Date('YYYY-MM-DD')` — it parses as UTC, off by 1 day in US timezones
- **ALWAYS** use `parseDate()` (appends `T00:00:00` for local time)
- **NEVER** hardcode years (`new Date(2026, ...)`) — use `new Date().getFullYear()`
- **NEVER** hardcode month names in KPI labels — compute dynamically

### Keys & Lookups
- **ALWAYS** use `buildKey()` for Set/Map lookups — it joins with `|` and applies `normalize()`
- **NEVER** concatenate keys manually (e.g., `name + '||' + study`) — it won't match

### Data Deduplication
- `allRows` (LIVE_URL1) and `legacyCancels` (LIVE_URL2_LEGACY) overlap
- `splitAndDedup()` handles the main flow, but **any new aggregation must dedup separately**
- Dedup key: `buildKey(r['Subject Full Name'], r['Study Name'], r['Cancel Date']||r['Scheduled Date'])`

### Regex in categorizeReason()
- **ALWAYS** use `\b` word boundaries for short patterns (e.g., `\bbmi\b` not `bmi`)
- Test patterns against common false positives: "submitted", "did not call back", "unable to reach"

### openModal()
- Signature: `openModal(title, subtitle, bodyHtml)` — **3 arguments required**
- Passing HTML as arg 2 will strip tags (`.textContent`), body will be empty

### HTML
- **NEVER** put two `class=` or `style=` attributes on the same element — browser ignores the second
- Use `jsAttr()` for onclick handler string escaping, not `.replace(/'/g, "\\'")`
- Use `escapeHTML()` for all user/CSV data injected into innerHTML

### Bar Chart Text Contrast
- When text sits ON a dark bar (gradient), use white text when bar width > 30%
- Pattern: `color:'+(pct>30?'#fff':'#1e293b')+'`

### Render Calls
- `renderTrendsCharts()` already calls `renderCoordTrendChart()` internally — don't call it separately
- Check for double-render before adding `safe()` calls to `renderAll()`

### Health Chips
- `setHealthChip('dh-xxx', ...)` requires a matching `<span id="dh-xxx">` in the data health strip HTML
- Call `_updateHealthButton()` after any render cycle that might change chip states

## Audit Hotspots — check these areas first for "bugs data code" requests

| Area | What to check |
|------|---------------|
| `categorizeReason()` | Regex false positives, overly broad patterns |
| `processLiveData()` return (~8130-8200) | Missing properties on allCancels/allVisitDetail |
| `splitAndDedup()` + trends aggregation | Key format, dedup consistency |
| `renderAll()` KPI updates | Hardcoded text, missing dynamic updates |
| `renderInvCapacity()` | Correct variable names (iv not visits) |
| Schedule KPI HTML (~1395-1415) | Hardcoded months, onclick filter prefixes |
| `autoRefreshAll()` | Health button update, render order |
| `buildRiskFlagCards()` | Hardcoded year in date parsing |
| `buildSiteChart()` | Null guards on DOM chains |

## Data Object Schemas

**DATA.allVisitDetail[]**: name, url, study, study_url, date_iso, coord, investigator, patient, patient_url, visit, status, site
**DATA.allCancels[]**: name, url, study, study_url, subject_status, coord, investigator, type, reason, visit, category, cancel_date, site

## Config
- `CRP_CONFIG.COORDINATORS` — all 10
- `CRP_CONFIG.SCHEDULE_COORDINATORS` — 5 PHL schedulers
- Recruiters = COORDINATORS minus SCHEDULE_COORDINATORS
- `CRP_CONFIG.INVESTIGATORS` — 6 PIs

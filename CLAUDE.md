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

## Cloud Function Architecture

**URL:** `https://us-east1-crio-468120.cloudfunctions.net/crp-bq-feeds`
**Entry point:** `crpBqApi` (Gen 2, Node.js 20, 512MB, 120s timeout, concurrency=10)
**Auth:** User OAuth2 refresh token from `~/.clasprc.json` (for Fivetran authorized views)
**Deploy:** `cd cloud-function && gcloud functions deploy crp-bq-feeds --gen2 --entry-point crpBqApi --concurrency 10 --cpu 1 --memory 512MB --timeout 120s --region us-east1 --project crio-468120 --runtime nodejs20 --trigger-http --allow-unauthenticated`

### Batch Endpoint
`?feed=batch&feeds=name1,name2,name3&format=json` — runs multiple feeds in one HTTP request, returns `{ results: { name1: { rows, data }, name2: { rows, data } } }`. Used by dashboard for Action Required banner (4 feeds) and GAAP finance (4 feeds).

### 47 BQ Feeds

| # | Feed | Source Table(s) | Key Join |
|---|------|----------------|----------|
| 1 | visits | calendar_appointment + subject_visit_stats | subject_visit_key |
| 2 | cancels | appointment_audit_log + subject_visit_stats | subject_visit_key |
| 3 | studies | study + subject_visit_stats (coordinator CTE) | study_key |
| 4 | subjects | subject | study_key |
| 5 | studyStatus | study + study_details | study_key |
| 6 | auditLog | appointment_audit_log | calendar_appointment_key |
| 7 | patientDB | patient (sex field, not gender) | patient_key |
| 8 | funnel | fact_patient_funnel | study_key |
| 9 | retention | subject (status counts) | study_key |
| 10 | revenue | study_finance | study_key |
| 11 | coordinators | subject_visit_stats + subject_visit | coordinator_user_key |
| 12 | compliance | fact_subject_visit | study_key |
| 13 | agingInvoices | invoice | study_key |
| 14 | payments | payment | study_key |
| 15 | revenueItems | revenue_item | study_key |
| 16 | monthlyRevenue | revenue_item (aggregated) | — |
| 17 | stipends | subject_payment | study_key |
| 18 | studyFinance | study_finance + invoice + payment + subject_payment | study_key |
| 19 | revenuePerSubject | study_finance | study_key |
| 20 | health | multiple (UNION ALL) | — |
| 21 | regulatory | regulatory_training_user + regulatory_duty_user | study_key |
| 22 | visitTodos | subject_visit_todo | study_key |
| 23 | recruiting | study_recruiting_patient | patient_key + study_key |
| 24 | gaapStudyRevenue | gaap_revenue_data_point + gaap_revenue_group | group_id; study via external_id |
| 25 | gaapMonthly | gaap_revenue_data_point + gaap_revenue_group | group_id |
| 26 | gaapAging | gaap_revenue_data_point + gaap_reconciliation | revenue_data_point_id |
| 27 | enrollmentForecast | study_month_forecast | study_key |
| 28 | siteFinance | cache_reports_overview | site_key |
| 29 | enrollmentVelocity | fact_subject_status_audit_log | study_key + subject_key |
| 30 | recruiterStats | patient_interaction | user_key |
| 31 | demographics | dim_race + dim_ethnicity + study_recruiting_patient | patient_key |
| 32 | webFormFunnel | web_form_submission + web_form | web_form_key |
| 33 | procedureRevenue | subject_visit_procedure_revenue + study_procedure | study_procedure_key |
| 34 | comments | comment (is_resolved=0) | study_key |
| 35 | consentTracking | informed_consent_audit_log | subject_key |
| 36 | sourceDocuments | subject_document + document_type + document_category | document_type_key |
| 37 | visitProcedureRevenue | subject_visit_procedure_revenue (detail) | subject_visit_key |
| 38 | esourceByUser | fact_subject_visit_procedure_question | subject_visit_key |
| 39 | gaapInvoices | gaap_invoice + gaap_invoice_item | invoice_id; study via external_id |
| 40 | gaapPayments | gaap_payment + gaap_reconciliation | payment_id; study via external_id |
| 41 | procedureRevenueConfig | study_procedure_revenue | study_procedure_key |
| 42 | procedureCostConfig | study_procedure_cost + vendor | vendor_key |
| 43 | visitFinance | study_visit_finance | study_visit_key |
| 44 | visitSignOff | subject_visit_sign_off | subject_visit_key |
| 45 | subjectAudit | subject_status_audit_log | subject_key |
| 46 | stipendPayments | stipend_payment + subject_payment + stipend_account | stipend_payment_key |
| 47 | documentSummary | subject_document (aggregated) | study_key |

### GAAP UUID Join
GAAP tables use STRING UUIDs (`study_id`, `site_id`). Join to study table via `study.external_id`, NOT `CAST(study_key AS STRING)`.

### Status Codes (verified from CRIO Looker Formulas)
- **study.status**: 0=Configuring, 1=Startup, 2=Enrolling, 3=Maintenance, 4=Pre-Closed, 10=Closed, 11=Suspended, 12=Withdrawn
- **subject.status**: -2=Not Interested, -1=Not Eligible, 1=Interested, 2=Prequalified, 3=No Show/Cancelled V1, 4=Scheduled V1, 10=Screening, 11=Enrolled, 12=Screen Fail, 13=Discontinued, 20=Completed
- **subject_visit.status**: 0=Unscheduled, 1=Scheduled, 11=In Progress, 12=Paused, 20=Cancelled, 21=Partially Complete, 22=Complete, 23=Completed Outside CRIO
- **cancel_type**: 1=No Show, 2=Site Cancelled, 3=Patient Cancelled
- **change_type**: 0=Created, 1=User Added, 2=User Removed, 3=Rescheduled, 4=Cancelled, 5=Deleted, 6=Restored
- **invoice.status**: 0=Draft, 1=Unpaid, 2=Paid, 3=Partially Paid
- **document.status**: -1=Deleted, 0=Updated, 1=Active, 2=Incoming, 3=Assigned, 4=Rejected, 6=Completed, 10=Signed

### Dashboard Load Phases
1. **Phase 1** (Critical): visits, cancels, audit log → renders Overview, Schedule, Actions
2. **Phase 2** (Finance): 5 core finance feeds + 4 GAAP feeds (batched) → renders Finance tab
3. **Phase 3** (Supplemental): Action Required batch (4 feeds), Patient DB, Facebook CRM
4. **Phase 4** (Referrals): referrals, campaigns, medRecords from Google Sheets CSV
5. **Late render**: CRIO studies + subjects, expansion feeds (funnel, retention, coordinators, compliance)

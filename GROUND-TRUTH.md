# CRP Dashboard — Ground Truth

> Last verified: March 18, 2026 | 1,959 CRIO subjects across 50 studies | Site assignment fixed

This document is the single reference for all dashboard data mappings, formulas, configurations, and verified counts. Use it to validate that the dashboard is rendering correctly.

---

## 1. Tab Structure

| Tab | View ID | Contents |
|-----|---------|----------|
| Overview | `view-overview` | KPI banners, enrollment pipeline, trends, charts |
| Studies | `view-studies` | Merged study table, CRIO Recruitment Intelligence, Scheduling Gaps, Re-enrollment |
| Schedule | `view-schedule` | KPI row, visit table, At-Risk Patients, Medical Records, cancellations, coordinator goals, Action Plan |
| Referrals | `view-referrals` | ClickUp pipeline, campaigns, Facebook leads, Patient Pipeline, Contact Quality Alerts |
| Admin | `view-admin` | Trends, data export (PIN-protected) |
| Finance (6) | `view-fin-*` | PIN-protected: Finance, Collections, Aging AR, Revenue, Accruals, CRIO vs QB |
| Insights | `view-insights` | Cross-tab insights (PIN-protected) |

**Eliminated:** Actions tab (March 17) — redistributed to Studies/Schedule/Referrals.

---

## 2. Data Sources

### Primary CSV Feeds

| Feed | GID | Content |
|------|-----|---------|
| UPCOMING | `0` | Master — upcoming visits (CRIO calendar export) |
| CANCELLATIONS | `1487298034` | Master — cancellation records |
| REFERRALS_CSV | `1264328878` | ClickUp referral pipeline snapshot |
| CAMPAIGNS_CSV | `44963051` | Central campaigns |
| MED_RECORDS_CSV | `1921715962` | Medical records & patient's path |
| CRIO_STUDIES_CSV | `932189572` | CRIO study enrollment status, roles, subject counts |
| CRIO_SUBJECTS_CSV | `941302257` | CRIO individual subject IDs & statuses |
| PATIENT_DB | (separate sheet) | CRIO daily patient export |
| FACEBOOK_CRM | (separate sheet) | Facebook leads + Delfa AI pre-screener |
| AUDIT_LOG | (separate sheet) | Appointment change audit trail |

### Finance Feeds (18 GIDs)

Published key: `2PACX-1vQXxreb6lrZHej3luMOSI07ditFm6mmGHIHrxWu9BkTfsvk0OLk_gx7o_JIY34UIgroGIKgEYbVdC_V`

| Feed | GID |
|------|-----|
| AGING_INV | `1436743094` |
| AGING_AP | `1893853669` |
| UNPAID_INV | `970419989` |
| UNPAID_AP | `162958154` |
| UNINVOICED | `1408187165` |
| REVENUE | `1739434495` |
| PAYMENTS | `454961282` |
| QB_INVOICE_LINES | `1796313718` |
| QB_CLASSES | `290152182` |
| QB_PNL_CLASS | `629976666` |
| QB_INVOICES | `1199010047` |
| QB_PAYMENTS | `1181551688` |
| QB_INCOME_GAPS | `2002097301` |
| QB_TIME_ACTIVITY | `899947143` |
| QB_EMPLOYEES | `669970890` |
| INV_VISITS | `747872177` |
| QB_ITEMS | `706580197` |
| QB_PNL_MONTHLY | `131816911` |

### ClickUp Integration

| Config | Value |
|--------|-------|
| Team ID | `36109289` |
| Space ID | `90142526279` |
| Campaign List | `901407896291` |
| Med Records Folder | `90147290121` |

**Referral Lists:**
- `901413202462` — Dr. Modarressi (physician)
- `901413613356` — Connolly Dermatology (physician)
- `901413613360` — Dr. Savita Singh (physician)
- `901414013590` — Center for Primary Care Medicine (physician)

---

## 3. CRIO Configuration

| Config | Value |
|--------|-------|
| CRIO App URL | `https://app.clinicalresearch.io/clinical-research-philadelphia-crp/philadelphia-pa/study/{study_key}/subjects` |
| Pennington Study Keys | `161619, 162446, 167755, 167794, 172389, 173164` |

### Site Resolution

The upcoming visits CSV (LIVE_URL1) has **no `Site Name` column**. Only the cancellations CSV (LIVE_URL2_LEGACY) has it. Site is resolved as follows:

1. `processLiveData()` backfills `r['Site Name']` on every raw row immediately after parsing
2. If `r['Site Name']` already exists (cancellations) → keep it
3. If missing (upcoming visits) → derive from `siteSlug(studyKey)` via `PENNINGTON_KEYS`
4. All downstream code reads `r['Site Name']` directly — single source of truth

**Verified Study Key → Site mapping (from cancellations CSV):**

| Study Key | Study | Site Name | Notes |
|-----------|-------|-----------|-------|
| `161619` | D6973C00001 | Pennington, NJ | PNJ version |
| `161620` | D6973C00001 | Philadelphia, PA | PHL version (same study, different site) |
| `167755` | N1T-MC-MALO | Pennington, NJ | |
| `167794` | 20230222 | Pennington, NJ | |
| `172389` | J3F-MC-EZCC | Pennington, NJ | |
| `173164` | Hypertriglyceridemia | (no cancel data) | PNJ per coordinator pattern |
| `162446` | (no data) | — | Stale key, no active visits or cancels |
| `150548` | 80202135SJS3001 | Philadelphia, PA | PHL despite PNJ coordinator (Angelina McMullen) |

**Active visit counts (verified March 18, 2026):** 256 total — 23 PNJ + 233 PHL

### Coordinators (10)

| Name | Site | In Config |
|------|------|-----------|
| Stacey Scott | PHL | ✅ |
| Ruby Pereira | PHL | ✅ |
| Mario Castellanos | PHL | ✅ |
| Ana Lambic | PHL | ✅ |
| Jana Milankovic | PHL | ✅ |
| Angelina McMullen | PNJ | ✅ |
| Cady Chilensky | PNJ | ✅ |
| Ema Gunic | PNJ | ✅ |
| Vlado Draganic | PNJ | ✅ |
| Gabrijela Ateljevic | PNJ | ✅ |

**Note:** Coordinator site is informational only. Site assignment is determined by Study Key, not coordinator. Angelina McMullen coordinates SJS (150548) which is a PHL study.

### PRESCREEN_OVERRIDES (8 entries)

Maps pre-screening study_key → protocol study_key(s):

| Pre-Screen Key | Protocol Keys | Therapeutic Area |
|----------------|---------------|------------------|
| `100455` | `154462, 161620, 188815` | Cardiology |
| `38926` | `86826, 135648` | Migraine |
| `148951` | `135157` | Obesity |
| `35892` | `109260` | Contraceptives |
| `55102` | `177553` | Lupus |
| `140400` | `136289` | Plaque Psoriasis |
| `49590` | `50058, 60296` | Type 2 Diabetes |
| `67088` | `[]` | Rheumatoid Arthritis (no protocol study yet) |

### INDICATION_ALIASES (17 entries)

Normalizes fragmented CRIO indication strings:

| Raw CRIO Indication | Normalized To |
|---------------------|---------------|
| cardiovascular disease | cardiology |
| established/at risk ascvd | cardiology |
| ascvd / ckd with cv risk factors | cardiology |
| heart failure - prevention | cardiology |
| diabetes type 2 | type 2 diabetes |
| type 2 diabetes and obesity or overweight at increased cardiovascular risk | type 2 diabetes |
| moderate to severe atopic dermatitis | atopic dermatitis |
| contraception | contraceptives |
| contraception (patch) | contraceptives |
| contraceptive efficacy & safety | contraceptives |
| menstrual migraine | migraine |
| moderate to severe plaque psoriasis | plaque psoriasis |
| obesity or overweight with and without type 2 diabetes | obesity |
| arthritis | rheumatoid arthritis |
| systemic lupus erythematosus | lupus |
| masld | mash |
| metabolic dysfunction-associated steatotic liver disease (masld) | mash |

### SKIP_PROTO (4 placeholder studies excluded from KPIs)

- Config Study
- Upload test
- EVENT
- 2025_COVID_FLU_RSV_DETECTION STUDY

### REFERRAL_STUDY_MAP (7 entries)

Maps referral CSV nicknames to protocol numbers for the Studies table:

| Referral Nickname | Protocol Number |
|-------------------|----------------|
| prevent-hf-az-d6973 baxduo | D6973C00001 |
| az-baxduo | D6973C00001 |
| ocean(a) | EFC17599 |
| sjogren's disease | 80202135SJS3001 |
| psa-2001 | 88545223PSA2001 |
| mash prescreening | MASLD |
| aqua | EFC17600 (ESTUARY) |

**REFERRAL_STUDY_SKIP:** Filters non-study values from referral CSV study column (blank, doctor names, source names, date strings).

**Matching logic:** Exact lookup → alias map → one-directional fuzzy (referral nickname ⊂ protocol, min 3 chars).

### Pre-Screening Detection (4 conditions, any = pre-screening)

1. `protocol_number` contains "pre-screen" (case-insensitive)
2. `protocol_number` contains "pre screen" (case-insensitive)
3. `protocol_number === indication` (generic-name fallback)
4. `study_key` exists in `PRESCREEN_OVERRIDES`

---

## 4. Formulas & Business Logic

### Screen Fail Rate

```
screened = enrolled + screen_fail + discontinued + completed
sfRate = (screen_fail / screened) × 100
```

Color thresholds: >40% = red, >25% = orange, else = green.

### Enrollment KPI Exclusions

Overview enrollment KPIs exclude:
- All pre-screening study subjects (detected by 4-condition check above)
- All SKIP_PROTO placeholder study subjects
- Build `psKeys` set of excluded study_keys, then skip any subject whose `study_key ∈ psKeys`

### At-Risk Patient Criteria

- Patient has **2+ cancellation events**
- Patient has an **upcoming visit scheduled**
- If next visit within 14 days → URGENT (red), otherwise → WARNING (orange)

### Scheduling Gap Definition

A study has a scheduling gap when ALL of:
1. Study status is ENROLLING or STARTUP
2. Study has >= 1 subject
3. Study has **zero** upcoming visits in the calendar
4. Study is not in SKIP_PROTO
5. Study is not a pre-screening study

### Rescheduled Visits

- **Confirmed:** Cancel reason = "Rescheduled" AND patient has a future appointment in same study
- **Pending:** Cancel reason = "Rescheduled" BUT no future appointment found → potential dropout

### Re-Enrollment Opportunities

1. Group all protocol studies by normalized indication (via INDICATION_ALIASES)
2. For each indication, count SCREEN_FAIL + COMPLETED + DISCONTINUED subjects = pool
3. Count other ENROLLING studies in same indication = targets
4. If pool > 0 AND targets exist → show re-enrollment opportunity
5. Study-level aggregate only (no patient-level cross-study tracking from CRIO)

### Enrolled-No-Visit Gap

Shows when:
- `gap = enrolled_count - upcoming_visit_count`
- `gap >= 2 AND upcoming < enrolled × 0.5`

---

## 5. Refresh Architecture

### Timing

| Trigger | Interval |
|---------|----------|
| Auto-refresh | 900,000ms (15 minutes) |
| Visibility change | If tab hidden 5+ minutes, refresh on return |
| Manual | Click refresh button |

### Phases

| Phase | What | Guard |
|-------|------|-------|
| 1 (Critical) | CTMS data: 3 CSVs → `processLiveData()` → `DATA` → `renderAll()` | `_refreshInFlight` |
| 2 (Finance) | Aging, payments, QuickBooks | — |
| 3 (Supplemental, +1500ms) | Patient DB, Facebook CRM, CRIO studies | `_crioFetchInFlight` |

### Guard Pattern

```javascript
var _guardVar = false;
async function guarded() {
  if (_guardVar) return;
  _guardVar = true;
  try { /* work */ } finally { _guardVar = false; }
}
```

### fetchCrioStudies() Post-Fetch Chain

1. `renderCrioStudies()` — renders CRIO intelligence panel
2. `mergeCrioIntoStudies()` — merges CRIO data into study table
3. `buildSchedulingGapAlerts()` — populates gap alerts
4. `buildEnrollmentKPIs()` — updates overview enrollment KPIs

---

## 6. Study Roster (29 fallback studies)

| Protocol | Enrolled |
|----------|----------|
| J2A-MC-GZPS | 0 |
| C4951063 | 0 |
| N1T-MC-MALO | 1 |
| MR-130A-01-TD-3001 | 12 |
| D7960C00015 | 1 |
| J3F-MC-EZCC | 0 |
| 88545223PSA2001 | 0 |
| D6973C00001 | 1 |
| M23-714 | 5 |
| 20230222 | 1 |
| M20-465 | 10 |
| 80202135SLE3001 | 0 |
| 95597528ADM2001 | 1 |
| M23-698 | 6 |
| EFC17599 | 2 |
| J2O-MC-EKBG | 0 |
| ATD002 | 0 |
| 77242113PSO3006 | 7 |
| 80202135SJS3001 | 2 |
| CDX0159-12 | 1 |
| EFC17600 (ESTUARY) | 1 |
| I8F-MC-GPHE | 2 |
| J1G-MC-LAKI | 6 |
| J2A-MC-GZGS | 9 |
| J2A-MC-GZPO | 6 |
| J3L-MC-EZEF | 52 |
| LTS17367 | 1 |
| MR-100A-01-TD-3001 | 52 |
| M24-601 | 0 |

**Note:** 3 PNJ-only studies (20230222, N1T-MC-MALO, J3F-MC-EZCC) always show fallback data — not in CRIO PHL site.

---

## 7. Render Functions → HTML Containers

### Overview Tab
| Function | Target Element(s) |
|----------|-------------------|
| `renderAll()` | `kpi-cancels`, `kpi-upcoming`, `kpi-next14`, `kpi-risk`, `kpi-studies`, `kpi-rescheduled`, `sched-count` |
| `buildHorizon()` | `horizon-grid` |
| `buildCancelTrend()` | `cancelTrendChart` |
| `buildUpcomingTrend()` | `upcomingTrendChart` |
| `buildReasonChart()` | `reasonChart` |
| `buildSiteChart()` | `siteChart` |
| `buildCancelStudyBars()` | `cancel-study-bars` |
| `buildCoordList()` | `coord-list` |
| `buildEnrollmentKPIs()` | `ov-kpi-enrolled`, `ov-kpi-screening`, `ov-kpi-winback`, `ov-kpi-prequalified`, `ov-kpi-sfrate` |

### Studies Tab
| Function | Target Element(s) |
|----------|-------------------|
| `buildStudiesView()` | `studies-view`, `merged-study-tbody`, `enroll-cards-grid` |
| `renderCrioStudies()` | `crio-studies-container` |
| `buildSchedulingGapAlerts()` | `scheduling-gap-list`, `sched-gap-badge` |

### Schedule Tab
| Function | Target Element(s) |
|----------|-------------------|
| `buildScheduleTable()` | `upcoming-tbody` |
| `buildRiskFlagCards()` | `riskCards` |
| `buildWeeklyBySiteChart()` | `wkChart` |
| `buildVisitTypeChart()` | `visitChart` |
| `buildStatusChart()` | `statusChart` |
| `renderCoordinatorGoals()` | `coordGoalsGrid`, `coordMonthBody` |

### Referrals Tab
| Function | Target Element(s) |
|----------|-------------------|
| `renderReferralDashboard()` | `ref-kpi-*`, `ref-funnel-chart`, `ref-source-chart`, `ref-study-table` |
| `renderContactAlerts()` | `contact-alert-cards` |

---

## 8. Global Data Variables

| Variable | Populated By | Consumed By |
|----------|-------------|-------------|
| `DATA` | `processLiveData()` | All render/build functions |
| `CRIO_STUDIES_DATA` | `fetchCrioStudies()` | `renderCrioStudies`, `buildEnrollmentKPIs`, `buildSchedulingGapAlerts`, `mergeCrioIntoStudies` |
| `CRIO_SUBJECTS_DATA` | `fetchCrioStudies()` | `renderCrioStudies`, `buildEnrollmentKPIs` |
| `REFERRAL_DATA` | `refreshReferrals()` | `renderReferralDashboard`, `buildPatientJourneyFunnel` |
| `FB_CRM_DATA` | `fetchFacebookCRM()` | Facebook CRM visualization |
| `MED_RECORDS_DATA` | `fetchMedicalRecords()` | `injectScheduleMedRecords` |
| `QB_DATA` | `fetchQuickBooksData()` | Finance tab renders |

---

## 9. Organization Config

| Config | Value |
|--------|-------|
| Org Name | Clinical Research Philadelphia |
| Org Short | CRP |
| Version | 2.9.6 |
| Coordinators | Mario Castellanos, Stacey Scott, Ruby Pereira, Cady Chilensky, Angelina McMullen |
| Investigators | Taher Modarressi, Eugene Andruczyk, Lolita Vaughan, Michael Tomeo, Joseph Heether, Brian Shaffer |
| Coord Daily Goal | 2 visits/day |
| PHL Coordinators | Stacey Scott, Ruby Pereira, Mario Castellanos |
| PNJ Coordinators | Angelina McMullen, Cady Chilensky |

### ClickUp Pipeline Map

| ClickUp Status | Dashboard Stage |
|----------------|-----------------|
| pending provider outreach | New Lead |
| recruiter to contact | New Lead |
| pending release | New Lead |
| under review | New Lead |
| schedule directly | Contacted |
| participant interested | Contacted |
| in contact | Contacted |
| ready to schedule | Contacted |
| scheduled pre-screening | Pre-Screening |
| scheduled screening | Screening |
| in screening | Screening |
| scheduled | Screening |
| screening completed | Screened |
| randomization completed | Enrolled |
| complete | Enrolled |
| enrolled | Enrolled |
| dnq | DNQ |
| unable to reach | Lost |
| not interested | Lost |
| no show | Lost |
| screen fail | Screen Fail |

---

## 10. localStorage / sessionStorage Keys

| Key | Storage | Purpose |
|-----|---------|---------|
| `crp_theme` | localStorage | Dark/light mode preference |
| `crp_audit_log` | localStorage | Dashboard audit log (500-entry cap) |
| `crp_coord_snapshot_v1` | localStorage | Coordinator visit data snapshot |
| `crp_dismissed_actions_v1` | localStorage | Dismissed action items (60-day prune) |
| `crp_coll_{invoice}` | localStorage | Invoice collection status/notes |
| `crp_clickup_token` | localStorage | ClickUp API token |
| `crp_confirmed_visits` | localStorage | Confirmed visit checkboxes |
| `crp_fin_auth` | sessionStorage | Finance PIN auth flag |

---

## 11. Verified Data Points (March 17, 2026)

- **1,959 CRIO subjects** across **50 studies**
- All study `subject_count` values match actual subject records (zero mismatches)
- All 8 PRESCREEN_OVERRIDES therapeutically correct
- 15 pre-screening studies correctly detected and excluded from KPIs
- 4 placeholder studies correctly excluded
- Screen fail rate formula verified correct
- Re-enrollment: 6 indication groups qualify (cardiology, atopic dermatitis, contraceptives, migraine, hidradenitis suppurativa, lupus) with 390 total candidates
- All 16 unit tests passing

---

## 12. Build & Deploy

```bash
# Edit source
vim index.html

# Build
python3 scripts/build-appscript.py

# Syntax check
node -c dashboard.js

# Test
node tests/run.js

# Commit & push (auto-deploys via GitHub Actions)
git add index.html dashboard.js appscript/
git commit -m "description"
git push
```

**Output files from build:**
- `dashboard.js` — extracted JS for GitHub Pages
- `styles.css` — extracted CSS
- `appscript/Dashboard.html` — HTML shell for Apps Script
- `appscript/DashboardJS_0..3.gs` — JS chunks as string constants

---

## 13. Known Limitations

- Re-enrollment is study-level only (no patient-level cross-study tracking)
- 3 PNJ studies always show stale fallback data (not in CRIO PHL site)
- 92/275 visits (33%) have empty Subject ID in CRIO
- Patient DB has data quality gaps (45% no Record Number, 76% Sex=Unknown)
- ~70 console.log statements remain
- ~40 innerHTML assignments in finance views lack escapeHTML wrapping
- Detail modal reattaches sort handlers on every open
- CRIO patient links require active CRIO login
- Client-side PIN auth is bypassable

**Resolved:**
- ~~Chart.js 4.x "Ignoring resolver" scale warnings~~ — fixed in `mkChart()` by adding explicit scale types (`2c8e5a2`)
- ~~Referral/Total Leads columns showed wrong counts in studies table~~ — fixed with `REFERRAL_STUDY_MAP`, garbage filter, one-directional matching (`88e3563`)

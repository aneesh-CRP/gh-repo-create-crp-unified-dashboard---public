/* ═══════════════════════════════════════════════════════════════════
 * CRP UNIFIED INTELLIGENCE DASHBOARD
 * Clinical Research Philadelphia
 * ═══════════════════════════════════════════════════════════════════
 *
 * ARCHITECTURE OVERVIEW
 * ─────────────────────
 * This dashboard consolidates two systems:
 *   1. Clinical Trial Operations (performance) — live Google Sheets data
 *   2. Finance (AR, collections, revenue) — static data arrays
 *
 * CONFIGURATION
 * ─────────────
 * All configurable values are in the CRP_CONFIG object below.
 * To add a new data feed: add a URL to CRP_CONFIG.DATA_FEEDS
 * To add a new tab: register in CRP_CONFIG.TABS and create a view div
 *
 * EXTENSION POINTS
 * ────────────────
 * • Data feeds:   CRP_CONFIG.DATA_FEEDS — add new Google Sheets CSVs
 * • Tabs:         CRP_CONFIG.TABS — register new views
 * • Plugins:      CRP.plugins[] — register render hooks
 * • Events:       CRP.on('dataLoaded', fn) — subscribe to lifecycle events
 *
 * DEPENDENCIES
 * ────────────
 * • Chart.js 4.4.1 (CDN)
 * • IBM Plex Sans / Mono (Google Fonts)
 * • Google Sheets (published CSV URLs)
 * • CRIO (app.clinicalresearch.io) for study/subject deep links
 *
 * COORDINATORS
 * ────────────
 * PHL: Stacey Scott, Ruby Pereira, Mario Castellanos
 * PNJ: Angelina McMullen, Cady Chilensky
 *
 * © 2026 Clinical Research Philadelphia
 * ═══════════════════════════════════════════════════════════════════ */

// ═══ CONFIGURATION LAYER ═══
// Edit this object to customize the dashboard without touching code below
const CRP_CONFIG = {
  // Organization
  ORG_NAME: 'Clinical Research Philadelphia',
  ORG_SHORT: 'CRP',

  // Brand Colors (match CSS :root variables)
  BRAND: {
    NAVY:   '#072061',
    BLUE:   '#1843ad',
    CYAN:   '#a2dceb',
    ORANGE: '#ff9933',
  },

  // Google Sheets Data Feeds
  // To add a new feed: add an entry here, then handle in processLiveData()
  DATA_FEEDS: {
    UPCOMING: 'https://docs.google.com/spreadsheets/d/e/2PACX-1vRUXJxTDsr5IRByMfuLF0P3hVq_QuEw6M1MPNDwd1CaV2UZ9tnFflUwsmUKAd3xeX3_esn0c4YlrV0q/pub?gid=0&single=true&output=csv',
    CANCELLATIONS: 'https://docs.google.com/spreadsheets/d/e/2PACX-1vRUXJxTDsr5IRByMfuLF0P3hVq_QuEw6M1MPNDwd1CaV2UZ9tnFflUwsmUKAd3xeX3_esn0c4YlrV0q/pub?gid=1487298034&single=true&output=csv',
    // Finance Master Sheet — published key + tab GIDs for CSV access
    FINANCE_PUB_KEY: '2PACX-1vQXxreb6lrZHej3luMOSI07ditFm6mmGHIHrxWu9BkTfsvk0OLk_gx7o_JIY34UIgroGIKgEYbVdC_V',
  },

  // Finance tab GIDs in the published Master Sheet
  FINANCE_TABS: {
    AGING_INV:     '1436743094',
    AGING_AP:      '1893853669',
    UNPAID_INV:    '970419989',
    UNPAID_AP:     '162958154',
    UNINVOICED:    '1408187165',
    REVENUE:       '1739434495',
    PAYMENTS:      '454961282',
  },

  // Patient Database (CRIO daily export — published CSV)
  PATIENT_DB_URL: 'https://docs.google.com/spreadsheets/d/e/2PACX-1vSF6m57VM1I7VMG__gFSRGWGFUc05ZIymyMDCu4RiLcgNlBwgqccQmnT2A-bbfkm6f7mjb9f2Qe5lLf/pub?output=csv',

  // ClickUp Integration — Referral Pipeline
  CLICKUP: {
    TEAM_ID: '36109289',
    SPACE_ID: '90142526279',
    // Physician Partnership Tracker lists (each task = patient referral)
    REFERRAL_LISTS: [
      { id: '901413202462', name: 'Dr. Modarressi', source_type: 'physician' },
      { id: '901413613356', name: 'Connolly Dermatology', source_type: 'physician' },
      { id: '901413613360', name: 'Dr. Savita Singh', source_type: 'physician' },
      { id: '901414013590', name: 'Center for Primary Care Medicine', source_type: 'physician' },
    ],
    // Central Campaigns list (each task = campaign/vendor with aggregate counts)
    CAMPAIGN_LIST: '901407896291',
    // Additional lists (add future tracker lists here)
    EXTRA_LISTS: [],
    // Facebook CRM Google Sheet (published CSV — recruitment team comments + Delfa AI pre-screener)
    FACEBOOK_CRM_URL: 'https://docs.google.com/spreadsheets/d/e/2PACX-1vR2y6TsaFLnVQcyskBntErNr5zl1WZRxZhWo-0cOIgMfEWvNm6NStcYatK9MF7U2tj4QDlnOCnopHri/pub?output=csv',
    // Map FB campaign names → study protocol IDs (campaign keyword → [study1, study2])
    // Keys are lowercased substrings matched against the 'Study Campaign' column
    // More specific keys are checked first (longest match wins)
    FB_CAMPAIGN_MAP: {
      'high triglycerides_v2': ['J2A-MC-GZPS'],
      'high triglycerides_v1': ['J2A-MC-GZPO'],
      'high triglycerides':    ['J2A-MC-GZPS'],  // fallback for unversioned
    },
    // Unified pipeline stage mapping (ClickUp status → dashboard stage)
    PIPELINE_MAP: {
      'pending provider outreach': 'New Lead',
      'recruiter to contact':     'New Lead',
      'schedule directly':        'Contacted',
      'participant interested':   'Contacted',
      'in contact':               'Contacted',
      'scheduled pre-screening':  'Pre-Screening',
      'scheduled screening':      'Screening',
      'screening completed':      'Screened',
      'randomization completed':  'Enrolled',
      'dnq':                      'DNQ',
      'unable to reach':          'Lost',
      'screen fail':              'Screen Fail',
      'complete':                 'Enrolled',
      // Medical Records statuses
      'pending release':          'New Lead',
      'under review':             'New Lead',
      'not interested':           'Lost',
      'ready to schedule':        'Contacted',
      'no show':                  'Lost',
      'in screening':             'Screening',
      'enrolled':                 'Enrolled',
      // Patient tracker NJ statuses
      'scheduled':                'Screening',
    },
    // Pipeline stage order for funnel
    PIPELINE_ORDER: ['New Lead', 'Contacted', 'Pre-Screening', 'Screening', 'Screened', 'Enrolled'],
    // Closed/terminal stages (not in funnel)
    CLOSED_STAGES: ['DNQ', 'Screen Fail', 'Lost'],
    SOURCE_RENAME: { 'Practice': 'Princeton CardioMetabolic' },

    // Medical Records & Patient's Path folder (per-study patient tracking)
    MED_RECORDS_FOLDER: '90147290121',
    MED_RECORDS_STATUS_MAP: {
      'unable to reach': 'Unable to Reach',
      'not interested':  'Not Interested',
      'pending release':  'Pending Release',
      'under review':     'Under Review',
      'dnq':              'DNQ',
      'ready to schedule':'Ready to Schedule',
      'visit 0 scheduled':'Visit Scheduled',
      'visit 1 scheduled':'Visit Scheduled',
      'visit 2 scheduled':'Visit Scheduled',
      'visit 3 scheduled':'Visit Scheduled',
      'visit 4 scheduled':'Visit Scheduled',
      'visit 5 scheduled':'Visit Scheduled',
      'visit 6 scheduled':'Visit Scheduled',
      'visit 7 scheduled':'Visit Scheduled',
      'enrolled':         'Enrolled',
      'in screening':     'In Screening',
      'screen fail':      'Screen Fail',
      'no show':          'No Show',
      'complete':         'Complete',
    },
    MED_RECORDS_ACTIVE: ['Pending Release','Under Review','Ready to Schedule','Visit Scheduled','In Screening','Enrolled'],
    MED_RECORDS_CLOSED: ['DNQ','Screen Fail','Not Interested','Unable to Reach','No Show','Complete'],

  },

  // Master Sheet (for Apps Script consolidation)
  MASTER_SHEET_ID: '1LZWJeJE9EJqe1Th13sSazrWOI5k8I56mbZPieAHqoyo',

  // Coordinator visit goals
  COORDINATORS: ['Mario Castellanos','Stacey Scott','Ruby Pereira','Cady Chilensky','Angelina Mcmullen'],
  INVESTIGATORS: ['Taher Modarressi','Eugene Andruczyk','Lolita Vaughan','Michael Tomeo','Joseph Heether','Brian Shaffer'],
  COORD_DAILY_GOAL: 2,

  // Auto-refresh interval (ms) — 0 to disable
  REFRESH_INTERVAL: 900000,

  // Finance auth (SHA-256 hash of PIN)
  AUTH_HASH: '78e370b587b145920213731b7c7c725e512b3b6577c51c800218a7c764c532ae',
  AUTH_STORAGE_KEY: 'crp_fin_auth',

  // Tab registry — add new tabs here
  TABS: {
    PERFORMANCE: ['overview', 'studies', 'schedule', 'actions', 'referrals', 'admin'],
    FINANCE: ['fin-overview', 'fin-collections', 'fin-aging', 'fin-revenue', 'fin-accruals', 'insights'],
    CROSS: ['insights'],
  },

  // Sites
  SITES: {
    PHL: { name: 'Philadelphia, PA', coordinators: ['Stacey Scott', 'Ruby Pereira', 'Mario Castellanos'] },
    PNJ: { name: 'Pennington, NJ', coordinators: ['Angelina McMullen', 'Cady Chilensky'] },
  },

  // Version
  VERSION: '2.9.5',
  BUILD_DATE: '2026-03-11T12:00:00Z',
};

// ═══ EVENT BUS (for plugin extensibility) ═══
const CRP = {
  plugins: [],
  _listeners: {},
  on(event, fn) {
    if (!this._listeners[event]) this._listeners[event] = [];
    this._listeners[event].push(fn);
  },
  emit(event, data) {
    (this._listeners[event] || []).forEach(fn => {
      try { fn(data); } catch(e) { console.warn(`CRP plugin error [${event}]:`, e); }
    });
  },
  registerPlugin(plugin) {
    this.plugins.push(plugin);
    console.log(`CRP: Plugin registered — ${plugin.name || 'unnamed'}`);
    if (plugin.init) plugin.init(CRP_CONFIG);
  },
};

// ════════════════════════════════════════
// STAGE COLORS — unified color map for all pipeline/funnel stages
// ════════════════════════════════════════
const STAGE_COLORS = {
  'New Lead': '#3b82f6',
  'Contacted': '#f59e0b',
  'Pre-Screening': '#8b5cf6',
  'Screening': '#06b6d4',
  'Screened': '#10b981',
  'Enrolled': '#059669',
  'Randomization': '#8b5cf6',
  'Treatment': '#1843ad',
  'Follow-Up': '#6366f1',
  'DNQ': '#ef4444',
  'Screen Fail': '#f97316',
  'Lost': '#94a3b8',
};

// ════════════════════════════════════════
// CRIO DIRECT LINKS — all studies mapped to their CRIO subject pages
// ════════════════════════════════════════
const CRIO_LINKS = {
  "107641": "https://app.clinicalresearch.io/clinical-research-philadelphia-crp/philadelphia-pa/study/107641/subjects",
  "M20-465": "https://app.clinicalresearch.io/clinical-research-philadelphia-crp/philadelphia-pa/study/107641/subjects",
  "Abbvie - M20-465": "https://app.clinicalresearch.io/clinical-research-philadelphia-crp/philadelphia-pa/study/107641/subjects",
  "67894": "https://app.clinicalresearch.io/clinical-research-philadelphia-crp/philadelphia-pa/study/67894/subjects",
  "M23-698": "https://app.clinicalresearch.io/clinical-research-philadelphia-crp/philadelphia-pa/study/67894/subjects",
  "Abbvie - M23-698": "https://app.clinicalresearch.io/clinical-research-philadelphia-crp/philadelphia-pa/study/67894/subjects",
  "86826": "https://app.clinicalresearch.io/clinical-research-philadelphia-crp/philadelphia-pa/study/86826/subjects",
  "M23-714": "https://app.clinicalresearch.io/clinical-research-philadelphia-crp/philadelphia-pa/study/86826/subjects",
  "Abbvie - M23-714": "https://app.clinicalresearch.io/clinical-research-philadelphia-crp/philadelphia-pa/study/86826/subjects",
  "101728": "https://app.clinicalresearch.io/clinical-research-philadelphia-crp/philadelphia-pa/study/101728/subjects",
  "M24-601": "https://app.clinicalresearch.io/clinical-research-philadelphia-crp/philadelphia-pa/study/101728/subjects",
  "Abbvie - M24-601": "https://app.clinicalresearch.io/clinical-research-philadelphia-crp/philadelphia-pa/study/101728/subjects",
  "109282": "https://app.clinicalresearch.io/clinical-research-philadelphia-crp/philadelphia-pa/study/109282/subjects",
  "ESK-001-010": "https://app.clinicalresearch.io/clinical-research-philadelphia-crp/philadelphia-pa/study/109282/subjects",
  "Alumis Inc. - ESK-001-010": "https://app.clinicalresearch.io/clinical-research-philadelphia-crp/philadelphia-pa/study/109282/subjects",
  "119237": "https://app.clinicalresearch.io/clinical-research-philadelphia-crp/philadelphia-pa/study/119237/subjects",
  "Alzheimer's disease Pre-Screening": "https://app.clinicalresearch.io/clinical-research-philadelphia-crp/philadelphia-pa/study/119237/subjects",
  "167794": "https://app.clinicalresearch.io/clinical-research-philadelphia-crp/clinical-research-philadelphia-pennington/study/167794/subjects",
  "20230222": "https://app.clinicalresearch.io/clinical-research-philadelphia-crp/clinical-research-philadelphia-pennington/study/167794/subjects",
  "Amgen, Inc. - 20230222": "https://app.clinicalresearch.io/clinical-research-philadelphia-crp/clinical-research-philadelphia-pennington/study/167794/subjects",
  "161620": "https://app.clinicalresearch.io/clinical-research-philadelphia-crp/philadelphia-pa/study/161620/subjects",
  "D6973C00001": "https://app.clinicalresearch.io/clinical-research-philadelphia-crp/philadelphia-pa/study/161620/subjects",
  "Astrazeneca Pharmaceuticals - D6973C00001": "https://app.clinicalresearch.io/clinical-research-philadelphia-crp/philadelphia-pa/study/161620/subjects",
  "161619": "https://app.clinicalresearch.io/clinical-research-philadelphia-crp/clinical-research-philadelphia-pennington/study/161619/subjects",
  "154462": "https://app.clinicalresearch.io/clinical-research-philadelphia-crp/philadelphia-pa/study/154462/subjects",
  "D7960C00015": "https://app.clinicalresearch.io/clinical-research-philadelphia-crp/philadelphia-pa/study/154462/subjects",
  "Astrazeneca Pharmaceuticals - D7960C00015": "https://app.clinicalresearch.io/clinical-research-philadelphia-crp/philadelphia-pa/study/154462/subjects",
  "89193": "https://app.clinicalresearch.io/clinical-research-philadelphia-crp/philadelphia-pa/study/89193/subjects",
  "Atopic Dermatitis": "https://app.clinicalresearch.io/clinical-research-philadelphia-crp/philadelphia-pa/study/89193/subjects",
  "100455": "https://app.clinicalresearch.io/clinical-research-philadelphia-crp/philadelphia-pa/study/100455/subjects",
  "Cardiology Pre-Screening": "https://app.clinicalresearch.io/clinical-research-philadelphia-crp/philadelphia-pa/study/100455/subjects",
  "162446": "https://app.clinicalresearch.io/clinical-research-philadelphia-crp/clinical-research-philadelphia-pennington/study/162446/subjects",
  "102540": "https://app.clinicalresearch.io/clinical-research-philadelphia-crp/philadelphia-pa/study/102540/subjects",
  "CDX0159-12": "https://app.clinicalresearch.io/clinical-research-philadelphia-crp/philadelphia-pa/study/102540/subjects",
  "Celldex Therapeutics - CDX0159-12": "https://app.clinicalresearch.io/clinical-research-philadelphia-crp/philadelphia-pa/study/102540/subjects",
  "35892": "https://app.clinicalresearch.io/clinical-research-philadelphia-crp/philadelphia-pa/study/35892/subjects",
  "Contraceptives": "https://app.clinicalresearch.io/clinical-research-philadelphia-crp/philadelphia-pa/study/35892/subjects",
  "150551": "https://app.clinicalresearch.io/clinical-research-philadelphia-crp/philadelphia-pa/study/150551/subjects",
  "EVENT": "https://app.clinicalresearch.io/clinical-research-philadelphia-crp/philadelphia-pa/study/150551/subjects",
  "50058": "https://app.clinicalresearch.io/clinical-research-philadelphia-crp/philadelphia-pa/study/50058/subjects",
  "I8F-MC-GPHE": "https://app.clinicalresearch.io/clinical-research-philadelphia-crp/philadelphia-pa/study/50058/subjects",
  "Eli Lilly and Company - I8F-MC-GPHE": "https://app.clinicalresearch.io/clinical-research-philadelphia-crp/philadelphia-pa/study/50058/subjects",
  "119640": "https://app.clinicalresearch.io/clinical-research-philadelphia-crp/philadelphia-pa/study/119640/subjects",
  "J1G-MC-LAKI": "https://app.clinicalresearch.io/clinical-research-philadelphia-crp/philadelphia-pa/study/119640/subjects",
  "Eli Lilly and Company - J1G-MC-LAKI": "https://app.clinicalresearch.io/clinical-research-philadelphia-crp/philadelphia-pa/study/119640/subjects",
  "115961": "https://app.clinicalresearch.io/clinical-research-philadelphia-crp/philadelphia-pa/study/115961/subjects",
  "J1I-MC-GZBO (TRIUMPH-OUTCOMES)": "https://app.clinicalresearch.io/clinical-research-philadelphia-crp/philadelphia-pa/study/115961/subjects",
  "Eli Lilly and Company - J1I-MC-GZBO (TRIUMPH-OUTCOMES)": "https://app.clinicalresearch.io/clinical-research-philadelphia-crp/philadelphia-pa/study/115961/subjects",
  "92602": "https://app.clinicalresearch.io/clinical-research-philadelphia-crp/philadelphia-pa/study/92602/subjects",
  "J1I-MC-GZBY": "https://app.clinicalresearch.io/clinical-research-philadelphia-crp/philadelphia-pa/study/92602/subjects",
  "Eli Lilly and Company - J1I-MC-GZBY": "https://app.clinicalresearch.io/clinical-research-philadelphia-crp/philadelphia-pa/study/92602/subjects",
  "60296": "https://app.clinicalresearch.io/clinical-research-philadelphia-crp/philadelphia-pa/study/60296/subjects",
  "J2A-MC-GZGS": "https://app.clinicalresearch.io/clinical-research-philadelphia-crp/philadelphia-pa/study/60296/subjects",
  "Eli Lilly and Company - J2A-MC-GZGS": "https://app.clinicalresearch.io/clinical-research-philadelphia-crp/philadelphia-pa/study/60296/subjects",
  "135157": "https://app.clinicalresearch.io/clinical-research-philadelphia-crp/philadelphia-pa/study/135157/subjects",
  "J2A-MC-GZPO": "https://app.clinicalresearch.io/clinical-research-philadelphia-crp/philadelphia-pa/study/135157/subjects",
  "Eli Lilly and Company - J2A-MC-GZPO": "https://app.clinicalresearch.io/clinical-research-philadelphia-crp/philadelphia-pa/study/135157/subjects",
  "162596": "https://app.clinicalresearch.io/clinical-research-philadelphia-crp/philadelphia-pa/study/162596/subjects",
  "J2A-MC-GZPS": "https://app.clinicalresearch.io/clinical-research-philadelphia-crp/philadelphia-pa/study/162596/subjects",
  "Eli Lilly and Company - J2A-MC-GZPS": "https://app.clinicalresearch.io/clinical-research-philadelphia-crp/philadelphia-pa/study/162596/subjects",
  "188815": "https://app.clinicalresearch.io/clinical-research-philadelphia-crp/philadelphia-pa/study/188815/subjects",
  "J2O-MC-EKBG": "https://app.clinicalresearch.io/clinical-research-philadelphia-crp/philadelphia-pa/study/188815/subjects",
  "Eli Lilly and Company - J2O-MC-EKBG": "https://app.clinicalresearch.io/clinical-research-philadelphia-crp/philadelphia-pa/study/188815/subjects",
  "172389": "https://app.clinicalresearch.io/clinical-research-philadelphia-crp/clinical-research-philadelphia-pennington/study/172389/subjects",
  "J3F-MC-EZCC": "https://app.clinicalresearch.io/clinical-research-philadelphia-crp/clinical-research-philadelphia-pennington/study/172389/subjects",
  "Eli Lilly and Company - J3F-MC-EZCC": "https://app.clinicalresearch.io/clinical-research-philadelphia-crp/clinical-research-philadelphia-pennington/study/172389/subjects",
  "89175": "https://app.clinicalresearch.io/clinical-research-philadelphia-crp/philadelphia-pa/study/89175/subjects",
  "J3L-MC-EZEF": "https://app.clinicalresearch.io/clinical-research-philadelphia-crp/philadelphia-pa/study/89175/subjects",
  "Eli Lilly and Company - J3L-MC-EZEF": "https://app.clinicalresearch.io/clinical-research-philadelphia-crp/philadelphia-pa/study/89175/subjects",
  "167755": "https://app.clinicalresearch.io/clinical-research-philadelphia-crp/clinical-research-philadelphia-pennington/study/167755/subjects",
  "N1T-MC-MALO": "https://app.clinicalresearch.io/clinical-research-philadelphia-crp/clinical-research-philadelphia-pennington/study/167755/subjects",
  "Eli Lilly and Company - N1T-MC-MALO": "https://app.clinicalresearch.io/clinical-research-philadelphia-crp/clinical-research-philadelphia-pennington/study/167755/subjects",
  "162597": "https://app.clinicalresearch.io/clinical-research-philadelphia-crp/philadelphia-pa/study/162597/subjects",
  "67089": "https://app.clinicalresearch.io/clinical-research-philadelphia-crp/philadelphia-pa/study/67089/subjects",
  "Hidradenitis Suppurativa": "https://app.clinicalresearch.io/clinical-research-philadelphia-crp/philadelphia-pa/study/67089/subjects",
  "173164": "https://app.clinicalresearch.io/clinical-research-philadelphia-crp/clinical-research-philadelphia-pennington/study/173164/subjects",
  "Hypertriglyceridemia": "https://app.clinicalresearch.io/clinical-research-philadelphia-crp/clinical-research-philadelphia-pennington/study/173164/subjects",
  "173860": "https://app.clinicalresearch.io/clinical-research-philadelphia-crp/philadelphia-pa/study/173860/subjects",
  "88545223PSA2001": "https://app.clinicalresearch.io/clinical-research-philadelphia-crp/philadelphia-pa/study/173860/subjects",
  "Janssen Pharmaceuticals, Inc. - 88545223PSA2001": "https://app.clinicalresearch.io/clinical-research-philadelphia-crp/philadelphia-pa/study/173860/subjects",
  "150548": "https://app.clinicalresearch.io/clinical-research-philadelphia-crp/philadelphia-pa/study/150548/subjects",
  "80202135SJS3001": "https://app.clinicalresearch.io/clinical-research-philadelphia-crp/philadelphia-pa/study/150548/subjects",
  "Janssen Research & Development, LLC - 80202135SJS3001": "https://app.clinicalresearch.io/clinical-research-philadelphia-crp/philadelphia-pa/study/150548/subjects",
  "177553": "https://app.clinicalresearch.io/clinical-research-philadelphia-crp/philadelphia-pa/study/177553/subjects",
  "80202135SLE3001": "https://app.clinicalresearch.io/clinical-research-philadelphia-crp/philadelphia-pa/study/177553/subjects",
  "Janssen Research & Development, LLC - 80202135SLE3001": "https://app.clinicalresearch.io/clinical-research-philadelphia-crp/philadelphia-pa/study/177553/subjects",
  "136289": "https://app.clinicalresearch.io/clinical-research-philadelphia-crp/philadelphia-pa/study/136289/subjects",
  "77242113PSO3006": "https://app.clinicalresearch.io/clinical-research-philadelphia-crp/philadelphia-pa/study/136289/subjects",
  "Johnson & Johnson - 77242113PSO3006": "https://app.clinicalresearch.io/clinical-research-philadelphia-crp/philadelphia-pa/study/136289/subjects",
  "172395": "https://app.clinicalresearch.io/clinical-research-philadelphia-crp/philadelphia-pa/study/172395/subjects",
  "95597528ADM2001": "https://app.clinicalresearch.io/clinical-research-philadelphia-crp/philadelphia-pa/study/172395/subjects",
  "Johnson & Johnson - 95597528ADM2001": "https://app.clinicalresearch.io/clinical-research-philadelphia-crp/philadelphia-pa/study/172395/subjects",
  "154611": "https://app.clinicalresearch.io/clinical-research-philadelphia-crp/philadelphia-pa/study/154611/subjects",
  "Lichen simplex chronicus Pre-screening": "https://app.clinicalresearch.io/clinical-research-philadelphia-crp/philadelphia-pa/study/154611/subjects",
  "55102": "https://app.clinicalresearch.io/clinical-research-philadelphia-crp/philadelphia-pa/study/55102/subjects",
  "Lupus Pre-Screening": "https://app.clinicalresearch.io/clinical-research-philadelphia-crp/philadelphia-pa/study/55102/subjects",
  "163368": "https://app.clinicalresearch.io/clinical-research-philadelphia-crp/philadelphia-pa/study/163368/subjects",
  "MASH Pre-Screening": "https://app.clinicalresearch.io/clinical-research-philadelphia-crp/philadelphia-pa/study/163368/subjects",
  "38926": "https://app.clinicalresearch.io/clinical-research-philadelphia-crp/philadelphia-pa/study/38926/subjects",
  "Migraine": "https://app.clinicalresearch.io/clinical-research-philadelphia-crp/philadelphia-pa/study/38926/subjects",
  "32653": "https://app.clinicalresearch.io/clinical-research-philadelphia-crp/philadelphia-pa/study/32653/subjects",
  "MR-100A-01-TD-3001": "https://app.clinicalresearch.io/clinical-research-philadelphia-crp/philadelphia-pa/study/32653/subjects",
  "Mylan Inc. - MR-100A-01-TD-3001": "https://app.clinicalresearch.io/clinical-research-philadelphia-crp/philadelphia-pa/study/32653/subjects",
  "109260": "https://app.clinicalresearch.io/clinical-research-philadelphia-crp/philadelphia-pa/study/109260/subjects",
  "MR-130A-01-TD-3001": "https://app.clinicalresearch.io/clinical-research-philadelphia-crp/philadelphia-pa/study/109260/subjects",
  "Mylan Inc. - MR-130A-01-TD-3001": "https://app.clinicalresearch.io/clinical-research-philadelphia-crp/philadelphia-pa/study/109260/subjects",
  "148951": "https://app.clinicalresearch.io/clinical-research-philadelphia-crp/philadelphia-pa/study/148951/subjects",
  "Obesity Pre-Screening": "https://app.clinicalresearch.io/clinical-research-philadelphia-crp/philadelphia-pa/study/148951/subjects",
  "135648": "https://app.clinicalresearch.io/clinical-research-philadelphia-crp/philadelphia-pa/study/135648/subjects",
  "C4951063": "https://app.clinicalresearch.io/clinical-research-philadelphia-crp/philadelphia-pa/study/135648/subjects",
  "Pfizer Inc. - C4951063": "https://app.clinicalresearch.io/clinical-research-philadelphia-crp/philadelphia-pa/study/135648/subjects",
  "140400": "https://app.clinicalresearch.io/clinical-research-philadelphia-crp/philadelphia-pa/study/140400/subjects",
  "Plaque Psoriasis": "https://app.clinicalresearch.io/clinical-research-philadelphia-crp/philadelphia-pa/study/140400/subjects",
  "67088": "https://app.clinicalresearch.io/clinical-research-philadelphia-crp/philadelphia-pa/study/67088/subjects",
  "Rheumatoid Arthritis": "https://app.clinicalresearch.io/clinical-research-philadelphia-crp/philadelphia-pa/study/67088/subjects",
  "86830": "https://app.clinicalresearch.io/clinical-research-philadelphia-crp/philadelphia-pa/study/86830/subjects",
  "EFC17559": "https://app.clinicalresearch.io/clinical-research-philadelphia-crp/philadelphia-pa/study/86830/subjects",
  "Sanofi US Services Inc. - EFC17559": "https://app.clinicalresearch.io/clinical-research-philadelphia-crp/philadelphia-pa/study/86830/subjects",
  "97908": "https://app.clinicalresearch.io/clinical-research-philadelphia-crp/philadelphia-pa/study/97908/subjects",
  "EFC17599": "https://app.clinicalresearch.io/clinical-research-philadelphia-crp/philadelphia-pa/study/97908/subjects",
  "Sanofi US Services Inc. - EFC17599": "https://app.clinicalresearch.io/clinical-research-philadelphia-crp/philadelphia-pa/study/97908/subjects",
  "122602": "https://app.clinicalresearch.io/clinical-research-philadelphia-crp/philadelphia-pa/study/122602/subjects",
  "EFC17600": "https://app.clinicalresearch.io/clinical-research-philadelphia-crp/philadelphia-pa/study/122602/subjects",
  "EFC17600 (ESTUARY)": "https://app.clinicalresearch.io/clinical-research-philadelphia-crp/philadelphia-pa/study/122602/subjects",
  "Sanofi US Services Inc. - EFC17600 (ESTUARY)": "https://app.clinicalresearch.io/clinical-research-philadelphia-crp/philadelphia-pa/study/122602/subjects",
  "123954": "https://app.clinicalresearch.io/clinical-research-philadelphia-crp/philadelphia-pa/study/123954/subjects",
  "EFC18366": "https://app.clinicalresearch.io/clinical-research-philadelphia-crp/philadelphia-pa/study/123954/subjects",
  "Sanofi US Services Inc. - EFC18366": "https://app.clinicalresearch.io/clinical-research-philadelphia-crp/philadelphia-pa/study/123954/subjects",
  "129137": "https://app.clinicalresearch.io/clinical-research-philadelphia-crp/philadelphia-pa/study/129137/subjects",
  "LTS17367": "https://app.clinicalresearch.io/clinical-research-philadelphia-crp/philadelphia-pa/study/129137/subjects",
  "Sanofi US Services Inc. - LTS17367": "https://app.clinicalresearch.io/clinical-research-philadelphia-crp/philadelphia-pa/study/129137/subjects",
  "154612": "https://app.clinicalresearch.io/clinical-research-philadelphia-crp/philadelphia-pa/study/154612/subjects",
  "Sjogren's Disease Pre-Screening": "https://app.clinicalresearch.io/clinical-research-philadelphia-crp/philadelphia-pa/study/154612/subjects",
  "162818": "https://app.clinicalresearch.io/clinical-research-philadelphia-crp/philadelphia-pa/study/162818/subjects",
  "Stress Urinary Incontinence Pre-Screening": "https://app.clinicalresearch.io/clinical-research-philadelphia-crp/philadelphia-pa/study/162818/subjects",
  "49590": "https://app.clinicalresearch.io/clinical-research-philadelphia-crp/philadelphia-pa/study/49590/subjects",
  "Type 2 Diabetes": "https://app.clinicalresearch.io/clinical-research-philadelphia-crp/philadelphia-pa/study/49590/subjects",
  "163891": "https://app.clinicalresearch.io/clinical-research-philadelphia-crp/philadelphia-pa/study/163891/subjects",
  "ATD002": "https://app.clinicalresearch.io/clinical-research-philadelphia-crp/philadelphia-pa/study/163891/subjects",
  "UCB Biopharma SRL - ATD002": "https://app.clinicalresearch.io/clinical-research-philadelphia-crp/philadelphia-pa/study/163891/subjects",
  "107009": "https://app.clinicalresearch.io/clinical-research-philadelphia-crp/philadelphia-pa/study/107009/subjects",
  "Config Study": "https://app.clinicalresearch.io/clinical-research-philadelphia-crp/philadelphia-pa/study/107009/subjects",
  "n/a - Config Study": "https://app.clinicalresearch.io/clinical-research-philadelphia-crp/philadelphia-pa/study/107009/subjects"
};

// ═══ FINANCE JS (from v8) ═══

// ══════════ DATA (defaults — overwritten by live fetch from Finance Master Sheet) ══════════
let AGING_INV=[{"study":"Abbvie - M20-465","current":24232.33,"d30_60":10568.04,"d61_90":0.0,"d91_120":39894.1,"d121_150":1713.15,"d150plus":0.0},{"study":"Abbvie - M23-698","current":0.0,"d30_60":0.0,"d61_90":0.0,"d91_120":0.0,"d121_150":464.4,"d150plus":8004.02},{"study":"Abbvie - M23-714","current":4533.07,"d30_60":0.0,"d61_90":0.0,"d91_120":0.0,"d121_150":0.0,"d150plus":2641.57},{"study":"Abbvie - M24-601","current":0.0,"d30_60":0.0,"d61_90":6000.0,"d91_120":15000.0,"d121_150":0.0,"d150plus":12670.95},{"study":"Alumis Inc. - ESK-001-010","current":0.0,"d30_60":0.0,"d61_90":0.0,"d91_120":0.0,"d121_150":2000.0,"d150plus":0.0},{"study":"Amgen, Inc. - 20230222","current":21000.0,"d30_60":0.0,"d61_90":0.0,"d91_120":0.0,"d121_150":0.0,"d150plus":600.0},{"study":"Astrazeneca Pharmaceuticals - D6973C00001","current":0.0,"d30_60":3000.0,"d61_90":0.0,"d91_120":0.0,"d121_150":0.0,"d150plus":884.5},{"study":"Astrazeneca Pharmaceuticals - D7960C00015","current":0.0,"d30_60":750.0,"d61_90":17000.0,"d91_120":0.0,"d121_150":0.0,"d150plus":379.0},{"study":"Celldex Therapeutics - CDX0159-12","current":0.0,"d30_60":0.0,"d61_90":0.0,"d91_120":0.0,"d121_150":1000.0,"d150plus":397.13},{"study":"Eli Lilly and Company - I8F-MC-GPHE","current":0.0,"d30_60":1500.0,"d61_90":0.0,"d91_120":0.0,"d121_150":0.0,"d150plus":3868.0},{"study":"Eli Lilly and Company - J1G-MC-LAKI","current":83543.0,"d30_60":0.0,"d61_90":0.0,"d91_120":0.0,"d121_150":0.0,"d150plus":15450.0},{"study":"Eli Lilly and Company - J1I-MC-GZBO (TRIUMPH-OUTCOMES)","current":4600.0,"d30_60":0.0,"d61_90":0.0,"d91_120":0.0,"d121_150":0.0,"d150plus":550.0},{"study":"Eli Lilly and Company - J1I-MC-GZBY","current":0.0,"d30_60":1150.0,"d61_90":0.0,"d91_120":0.0,"d121_150":0.0,"d150plus":550.0},{"study":"Eli Lilly and Company - J2A-MC-GZGS","current":0.0,"d30_60":5750.0,"d61_90":0.0,"d91_120":0.0,"d121_150":0.0,"d150plus":0.0},{"study":"Eli Lilly and Company - J2A-MC-GZPO","current":0.0,"d30_60":2300.0,"d61_90":0.0,"d91_120":0.0,"d121_150":0.0,"d150plus":42553.0},{"study":"Eli Lilly and Company - J2A-MC-GZPS","current":0.0,"d30_60":0.0,"d61_90":0.0,"d91_120":0.0,"d121_150":0.0,"d150plus":0.0},{"study":"Eli Lilly and Company - J3F-MC-EZCC","current":0.0,"d30_60":0.0,"d61_90":19250.0,"d91_120":0.0,"d121_150":0.0,"d150plus":0.0},{"study":"Eli Lilly and Company - J3L-MC-EZEF","current":0.0,"d30_60":9200.0,"d61_90":0.0,"d91_120":0.0,"d121_150":0.0,"d150plus":68171.0},{"study":"Eli Lilly and Company - N1T-MC-MALO","current":19250.0,"d30_60":725.0,"d61_90":0.0,"d91_120":0.0,"d121_150":0.0,"d150plus":0.0},{"study":"Janssen Pharmaceuticals, Inc. - 88545223PSA2001","current":0.0,"d30_60":0.0,"d61_90":0.0,"d91_120":0.0,"d121_150":0.0,"d150plus":0.0},{"study":"Janssen Research & Development, LLC - 80202135SJS3001","current":0.0,"d30_60":3425.0,"d61_90":0.0,"d91_120":0.0,"d121_150":0.0,"d150plus":1755.0},{"study":"Johnson & Johnson - 77242113PSO3006","current":0.0,"d30_60":1000.0,"d61_90":5000.0,"d91_120":0.0,"d121_150":0.0,"d150plus":3000.0},{"study":"Johnson & Johnson - 95597528ADM2001","current":0.0,"d30_60":0.0,"d61_90":0.0,"d91_120":0.0,"d121_150":0.0,"d150plus":0.0},{"study":"Mylan Inc. - MR-130A-01-TD-3001","current":0.0,"d30_60":0.0,"d61_90":3500.0,"d91_120":0.0,"d121_150":750.0,"d150plus":10036.0},{"study":"Pfizer Inc. - C4951063","current":0.0,"d30_60":0.0,"d61_90":0.0,"d91_120":0.0,"d121_150":0.0,"d150plus":0.0},{"study":"Sanofi US Services Inc. - EFC17559","current":0.0,"d30_60":0.0,"d61_90":0.0,"d91_120":0.0,"d121_150":0.0,"d150plus":12244.0},{"study":"Sanofi US Services Inc. - EFC17599","current":0.0,"d30_60":0.0,"d61_90":0.0,"d91_120":0.0,"d121_150":0.0,"d150plus":1220.0},{"study":"Sanofi US Services Inc. - EFC17600 (ESTUARY)","current":0.0,"d30_60":2000.0,"d61_90":0.0,"d91_120":7406.0,"d121_150":1250.0,"d150plus":0.0},{"study":"Sanofi US Services Inc. - EFC18366","current":0.0,"d30_60":0.0,"d61_90":3000.0,"d91_120":0.0,"d121_150":0.0,"d150plus":0.0},{"study":"Sanofi US Services Inc. - LTS17367","current":0.0,"d30_60":1000.0,"d61_90":0.0,"d91_120":0.0,"d121_150":0.0,"d150plus":0.0}];

let AGING_AP=[{"study":"Abbvie - M20-465","current":32440.26,"d30_60":22113.38,"d61_90":14723.35,"d91_120":11238.57,"d121_150":623.3,"d150plus":1246.6},{"study":"Abbvie - M23-698","current":0.0,"d30_60":3824.62,"d61_90":0.0,"d91_120":0.0,"d121_150":0.0,"d150plus":701.0},{"study":"Abbvie - M23-714","current":7093.44,"d30_60":6616.51,"d61_90":4218.05,"d91_120":0.0,"d121_150":7181.58,"d150plus":63953.42},{"study":"Abbvie - M24-601","current":0.0,"d30_60":0.0,"d61_90":0.0,"d91_120":0.0,"d121_150":0.0,"d150plus":0.0},{"study":"Amgen, Inc. - 20230222","current":19513.45,"d30_60":4849.0,"d61_90":0.0,"d91_120":0.0,"d121_150":0.0,"d150plus":0.0},{"study":"Astrazeneca Pharmaceuticals - D6973C00001","current":4640.3,"d30_60":3117.8,"d61_90":0.0,"d91_120":5606.1,"d121_150":0.0,"d150plus":0.0},{"study":"Astrazeneca Pharmaceuticals - D7960C00015","current":0.0,"d30_60":0.0,"d61_90":0.0,"d91_120":1557.75,"d121_150":0.0,"d150plus":0.0},{"study":"Celldex Therapeutics - CDX0159-12","current":1599.24,"d30_60":1820.31,"d61_90":1544.91,"d91_120":0.0,"d121_150":0.0,"d150plus":6939.02},{"study":"Eli Lilly and Company - I8F-MC-GPHE","current":2883.0,"d30_60":0.0,"d61_90":0.0,"d91_120":0.0,"d121_150":0.0,"d150plus":0.0},{"study":"Eli Lilly and Company - J1G-MC-LAKI","current":4964.0,"d30_60":0.0,"d61_90":6230.0,"d91_120":0.0,"d121_150":0.0,"d150plus":21124.0},{"study":"Eli Lilly and Company - J1I-MC-GZBO (TRIUMPH-OUTCOMES)","current":0.0,"d30_60":0.0,"d61_90":0.0,"d91_120":0.0,"d121_150":0.0,"d150plus":0.0},{"study":"Eli Lilly and Company - J1I-MC-GZBY","current":0.0,"d30_60":0.0,"d61_90":0.0,"d91_120":0.0,"d121_150":0.0,"d150plus":0.0},{"study":"Eli Lilly and Company - J2A-MC-GZGS","current":2978.0,"d30_60":0.0,"d61_90":0.0,"d91_120":1998.0,"d121_150":0.0,"d150plus":0.0},{"study":"Eli Lilly and Company - J2A-MC-GZPO","current":10431.0,"d30_60":0.0,"d61_90":2301.0,"d91_120":0.0,"d121_150":8257.0,"d150plus":26808.0},{"study":"Eli Lilly and Company - J2A-MC-GZPS","current":0.0,"d30_60":0.0,"d61_90":0.0,"d91_120":0.0,"d121_150":0.0,"d150plus":0.0},{"study":"Eli Lilly and Company - J3F-MC-EZCC","current":0.0,"d30_60":0.0,"d61_90":0.0,"d91_120":0.0,"d121_150":0.0,"d150plus":0.0},{"study":"Eli Lilly and Company - J3L-MC-EZEF","current":22579.0,"d30_60":0.0,"d61_90":854.0,"d91_120":854.0,"d121_150":26470.0,"d150plus":12665.0},{"study":"Eli Lilly and Company - N1T-MC-MALO","current":12307.0,"d30_60":0.0,"d61_90":0.0,"d91_120":0.0,"d121_150":0.0,"d150plus":0.0},{"study":"Janssen Research & Development, LLC - 80202135SJS3001","current":10364.0,"d30_60":5530.0,"d61_90":4623.0,"d91_120":0.0,"d121_150":0.0,"d150plus":0.0},{"study":"Johnson & Johnson - 77242113PSO3006","current":17106.0,"d30_60":11149.0,"d61_90":0.0,"d91_120":0.0,"d121_150":0.0,"d150plus":3393.0},{"study":"Mylan Inc. - MR-100A-01-TD-3001","current":0.0,"d30_60":0.0,"d61_90":0.0,"d91_120":0.0,"d121_150":0.0,"d150plus":404.3},{"study":"Mylan Inc. - MR-130A-01-TD-3001","current":6426.0,"d30_60":4382.3,"d61_90":5800.4,"d91_120":5445.2,"d121_150":9613.5,"d150plus":34597.15},{"study":"Pfizer Inc. - C4951063","current":8902.37,"d30_60":1505.25,"d61_90":5949.61,"d91_120":0.0,"d121_150":0.0,"d150plus":0.0},{"study":"Sanofi US Services Inc. - EFC17559","current":0.0,"d30_60":0.0,"d61_90":0.0,"d91_120":0.0,"d121_150":0.0,"d150plus":0.0},{"study":"Sanofi US Services Inc. - EFC17599","current":3503.0,"d30_60":5920.0,"d61_90":3512.3,"d91_120":0.0,"d121_150":0.0,"d150plus":0.0},{"study":"Sanofi US Services Inc. - EFC17600 (ESTUARY)","current":4869.6,"d30_60":3786.0,"d61_90":3769.2,"d91_120":0.0,"d121_150":0.0,"d150plus":0.0},{"study":"Sanofi US Services Inc. - LTS17367","current":1335.6,"d30_60":2488.5,"d61_90":0.0,"d91_120":0.0,"d121_150":0.0,"d150plus":0.0}];

let UNPAID_INVOICES=[{"study":"Abbvie - M23-698","invoice":"Adv-69802032","due":"2024-03-28","days":711,"amount":4242.5,"unpaid":4242.5},{"study":"Eli Lilly and Company - J2A-MC-GZGS","invoice":"adv-1131713484","due":"2024-08-02","days":584,"amount":1475.0,"unpaid":1475.0},{"study":"Abbvie - M23-698","invoice":"69802027.0","due":"2024-08-24","days":562,"amount":6000.0,"unpaid":6000.0},{"study":"Abbvie - M23-698","invoice":"698-009 b","due":"2024-09-14","days":541,"amount":2743.2,"unpaid":2743.2},{"study":"Sanofi US Services Inc. - EFC17559","invoice":"adv-8415312","due":"2024-10-16","days":509,"amount":3000.0,"unpaid":3000.0},{"study":"Sanofi US Services Inc. - EFC17559","invoice":"8415310.0","due":"2025-01-11","days":422,"amount":9093.0,"unpaid":9093.0},{"study":"Abbvie - M23-714","invoice":"M23714-004","due":"2025-03-04","days":370,"amount":540.0,"unpaid":540.0},{"study":"Eli Lilly and Company - J3L-MC-EZEF","invoice":"EZEF-007 IMV & Uns  sbd on portal","due":"2025-04-17","days":326,"amount":2844.0,"unpaid":2844.0},{"study":"Eli Lilly and Company - I8F-MC-GPHE","invoice":"GPHE-014 IMV","due":"2025-04-26","days":317,"amount":1250.0,"unpaid":1250.0},{"study":"Mylan Inc. - MR-100A-01-TD-3001","invoice":"M65 UNS","due":"2025-04-27","days":316,"amount":249.75,"unpaid":249.75},{"study":"Mylan Inc. - MR-130A-01-TD-3001","invoice":"adv-5","due":"2025-04-30","days":313,"amount":1500.0,"unpaid":1500.0},{"study":"Sanofi US Services Inc. - EFC17599","invoice":"5.0","due":"2025-05-03","days":310,"amount":1500.0,"unpaid":1500.0},{"study":"Sanofi US Services Inc. - EFC17600 (ESTUARY)","invoice":"17600-002","due":"2025-05-07","days":306,"amount":162.0,"unpaid":162.0},{"study":"Abbvie - M20-465","invoice":"M20465-006","due":"2025-05-07","days":306,"amount":3549.26,"unpaid":3549.26},{"study":"Mylan Inc. - MR-130A-01-TD-3001","invoice":"MR-002","due":"2025-05-11","days":302,"amount":650.0,"unpaid":650.0},{"study":"Eli Lilly and Company - J1G-MC-LAKI","invoice":"LAKI-003","due":"2025-05-22","days":291,"amount":4220.0,"unpaid":4220.0},{"study":"Abbvie - M23-698","invoice":"698-015","due":"2025-05-23","days":290,"amount":4145.72,"unpaid":4145.72},{"study":"Eli Lilly and Company - J3L-MC-EZEF","invoice":"125017602.0","due":"2025-05-24","days":289,"amount":3791.0,"unpaid":3791.0},{"study":"Eli Lilly and Company - J1G-MC-LAKI","invoice":"LAKI-004A","due":"2025-05-27","days":286,"amount":4710.0,"unpaid":4710.0},{"study":"Eli Lilly and Company - J1G-MC-LAKI","invoice":"LAKI2032","due":"2025-06-20","days":262,"amount":13842.0,"unpaid":13842.0},{"study":"Eli Lilly and Company - J1G-MC-LAKI","invoice":"2030.0","due":"2025-06-22","days":260,"amount":-3380.0,"unpaid":-3380.0},{"study":"Abbvie - M24-601","invoice":"Adv-601004","due":"2025-06-22","days":260,"amount":6000.0,"unpaid":6000.0},{"study":"Celldex Therapeutics - CDX0159-12","invoice":"Adv-3","due":"2025-06-22","days":260,"amount":6000.0,"unpaid":6000.0},{"study":"Abbvie - M20-465","invoice":"20465008.0","due":"2025-06-26","days":256,"amount":2232.93,"unpaid":2232.93},{"study":"Pfizer Inc. - C4951063","invoice":"1.0","due":"2025-06-29","days":253,"amount":21000.0,"unpaid":21000.0},{"study":"Abbvie - M23-698","invoice":"698-0 Annual fees 2025","due":"2025-07-10","days":242,"amount":3500.0,"unpaid":3500.0},{"study":"Abbvie - M24-601","invoice":"601003.0","due":"2025-07-12","days":240,"amount":12000.0,"unpaid":12000.0},{"study":"Johnson & Johnson - 77242113PSO3006","invoice":"4.0","due":"2025-07-18","days":234,"amount":3000.0,"unpaid":3000.0},{"study":"Eli Lilly and Company - J2A-MC-GZPO","invoice":"1.0","due":"2025-07-18","days":234,"amount":15700.0,"unpaid":15700.0},{"study":"Abbvie - M20-465","invoice":"20465013.0","due":"2025-07-19","days":233,"amount":6000.0,"unpaid":6000.0},{"study":"Eli Lilly and Company - J1G-MC-LAKI","invoice":"LAKI009","due":"2025-07-23","days":229,"amount":12173.0,"unpaid":12173.0},{"study":"Eli Lilly and Company - J1G-MC-LAKI","invoice":"LAKI010","due":"2025-07-23","days":229,"amount":7105.0,"unpaid":7105.0},{"study":"Eli Lilly and Company - J1I-MC-GZBO (TRIUMPH-OUTCOMES)","invoice":"3.0","due":"2025-07-27","days":225,"amount":550.0,"unpaid":550.0},{"study":"Eli Lilly and Company - J2A-MC-GZPO","invoice":"2.0","due":"2025-08-01","days":220,"amount":550.0,"unpaid":550.0},{"study":"Eli Lilly and Company - J1I-MC-GZBY","invoice":"50692.0","due":"2025-08-01","days":220,"amount":550.0,"unpaid":550.0},{"study":"Sanofi US Services Inc. - EFC17599","invoice":"4.0","due":"2025-08-16","days":205,"amount":562.0,"unpaid":562.0},{"study":"Janssen Research & Development, LLC - 80202135SJS3001","invoice":"1.0","due":"2025-08-16","days":205,"amount":17948.0,"unpaid":17948.0},{"study":"Abbvie - M23-698","invoice":"69802028.0","due":"2025-08-24","days":197,"amount":6000.0,"unpaid":6000.0},{"study":"Celldex Therapeutics - CDX0159-12","invoice":"4.0","due":"2025-08-27","days":194,"amount":500.0,"unpaid":500.0},{"study":"Eli Lilly and Company - I8F-MC-GPHE","invoice":"718230.0","due":"2025-08-27","days":194,"amount":500.0,"unpaid":500.0},{"study":"Abbvie - M20-465","invoice":"20465014.0","due":"2025-08-27","days":194,"amount":500.0,"unpaid":500.0},{"study":"Sanofi US Services Inc. - EFC17600 (ESTUARY)","invoice":"17600005.0","due":"2025-08-27","days":194,"amount":500.0,"unpaid":500.0},{"study":"Abbvie - M20-465","invoice":"M20465-004","due":null,"days":0,"amount":245.92,"unpaid":245.92}];

let UNPAID_AP=[{"study":"Eli Lilly and Company - J2A-MC-GZPO","total":123967.0,"visits":115988.0,"procs":7979.0},{"study":"Johnson & Johnson - 77242113PSO3006","total":65616.0,"visits":65116.0,"procs":500.0},{"study":"Eli Lilly and Company - J3L-MC-EZEF","total":64078.0,"visits":58768.0,"procs":5310.0},{"study":"Abbvie - M20-465","total":61048.08,"visits":52084.0,"procs":8964.08},{"study":"Mylan Inc. - MR-130A-01-TD-3001","total":35599.35,"visits":35599.35,"procs":0},{"study":"Eli Lilly and Company - J1G-MC-LAKI","total":29385.0,"visits":18197.0,"procs":11188.0},{"study":"Abbvie - M23-714","total":19916.95,"visits":19916.95,"procs":0},{"study":"Sanofi US Services Inc. - EFC17599","total":17849.5,"visits":17849.5,"procs":0},{"study":"Abbvie - M23-698","total":14962.47,"visits":14962.47,"procs":0},{"study":"Sanofi US Services Inc. - EFC17600 (ESTUARY)","total":13597.4,"visits":12530.4,"procs":1067.0},{"study":"Sanofi US Services Inc. - LTS17367","total":6552.0,"visits":6552.0,"procs":0},{"study":"Celldex Therapeutics - CDX0159-12","total":4634.73,"visits":4634.73,"procs":0},{"study":"Janssen Research & Development, LLC - 80202135SJS3001","total":4423.0,"visits":4423.0,"procs":0}];

let UNINVOICED=[{"study":"Astrazeneca Pharmaceuticals - D6973C00001","amount":38400.0},{"study":"Janssen Research & Development, LLC - 80202135SLE3001","amount":33000.0},{"study":"Amgen, Inc. - 20230222","amount":28250.0},{"study":"Eli Lilly and Company - J2A-MC-GZPS","amount":23150.0},{"study":"Abbvie - M24-601","amount":20750.0},{"study":"Abbvie - M23-698","amount":12500.0},{"study":"Johnson & Johnson - 95597528ADM2001","amount":8250.0},{"study":"Sanofi US Services Inc. - EFC17559","amount":7000.0},{"study":"Eli Lilly and Company - N1T-MC-MALO","amount":6800.0},{"study":"Astrazeneca Pharmaceuticals - D7960C00015","amount":6050.0},{"study":"Eli Lilly and Company - J3L-MC-EZEF","amount":5950.0},{"study":"Eli Lilly and Company - J3F-MC-EZCC","amount":5950.0},{"study":"Pfizer Inc. - C4951063","amount":5174.0},{"study":"Alumis Inc. - ESK-001-010","amount":4798.0},{"study":"Mylan Inc. - MR-130A-01-TD-3001","amount":4750.0},{"study":"Abbvie - M20-465","amount":4750.0},{"study":"Abbvie - M23-714","amount":4750.0},{"study":"Celldex Therapeutics - CDX0159-12","amount":4500.0},{"study":"Eli Lilly and Company - J1G-MC-LAKI","amount":4040.0},{"study":"Eli Lilly and Company - J1I-MC-GZBY","amount":3950.0},{"study":"Eli Lilly and Company - J2A-MC-GZGS","amount":3950.0},{"study":"Eli Lilly and Company - J1I-MC-GZBO (TRIUMPH-OUTCOMES)","amount":3950.0},{"study":"Eli Lilly and Company - J2A-MC-GZPO","amount":3950.0},{"study":"Janssen Research & Development, LLC - 80202135SJS3001","amount":3000.0},{"study":"Janssen Pharmaceuticals, Inc. - 88545223PSA2001","amount":3000.0},{"study":"Johnson & Johnson - 77242113PSO3006","amount":3000.0},{"study":"Sanofi US Services Inc. - LTS17367","amount":2500.0},{"study":"Sanofi US Services Inc. - EFC17600 (ESTUARY)","amount":2500.0},{"study":"Sanofi US Services Inc. - EFC17599","amount":2500.0},{"study":"Sanofi US Services Inc. - EFC18366","amount":2500.0}];

let MONTHLY_PAYMENTS=[{"month":"Apr '25","amount":191242.64},{"month":"May '25","amount":299083.6},{"month":"Jun '25","amount":223866.06},{"month":"Jul '25","amount":190991.55},{"month":"Aug '25","amount":219359.88},{"month":"Sep '25","amount":185972.88},{"month":"Oct '25","amount":234105.75},{"month":"Nov '25","amount":172982.84},{"month":"Dec '25","amount":329010.52},{"month":"Jan '26","amount":243848.2},{"month":"Feb '26","amount":193403.5}];

let MONTHLY_REVENUE=[{"month":"Oct '24","autopay":42008,"procedures":0,"invoicables":21276},{"month":"Nov '24","autopay":89656,"procedures":0,"invoicables":13207},{"month":"Dec '24","autopay":91974,"procedures":0,"invoicables":18301},{"month":"Jan '25","autopay":108584,"procedures":0,"invoicables":31276},{"month":"Feb '25","autopay":133396,"procedures":0,"invoicables":22097},{"month":"Mar '25","autopay":158115,"procedures":0,"invoicables":47481},{"month":"Apr '25","autopay":217244,"procedures":0,"invoicables":18288},{"month":"May '25","autopay":204365,"procedures":0,"invoicables":65687},{"month":"Jun '25","autopay":211716,"procedures":0,"invoicables":60500},{"month":"Jul '25","autopay":237237,"procedures":0,"invoicables":84969},{"month":"Aug '25","autopay":155207,"procedures":0,"invoicables":74142},{"month":"Sep '25","autopay":188341,"procedures":0,"invoicables":12055},{"month":"Oct '25","autopay":177891,"procedures":0,"invoicables":62935},{"month":"Nov '25","autopay":233352,"procedures":0,"invoicables":92363},{"month":"Dec '25","autopay":251923,"procedures":0,"invoicables":91569},{"month":"Jan '26","autopay":195570,"procedures":0,"invoicables":70860},{"month":"Feb '26","autopay":192886,"procedures":0,"invoicables":27147},{"month":"Mar '26","autopay":53201,"procedures":0,"invoicables":4746}];

let STUDY_REVENUE_12M={"J3L-MC-EZEF":851656,"M20-465":425369,"J1G-MC-LAKI":418862,"J2A-MC-GZPO":330548,"77242113PSO3006":256138,"MR-130A-01-TD-3001":217480,"J2A-MC-GZGS":168400,"M23-714":142162,"EFC17599":101924,"M23-698":101429,"EFC17600 (ESTUARY)":88532,"80202135SJS3001":80818,"N1T-MC-MALO":79306,"D6973C00001":49749,"20230222":45962,"M24-601":43449,"LTS17367":42132,"EFC17559":41711,"I8F-MC-GPHE":38167,"C4951063":35357,"88545223PSA2001":32620,"J1I-MC-GZBO (TRIUMPH-OUTCOMES)":28775,"D7960C00015":28313,"J3F-MC-EZCC":27873,"CDX0159-12":22846,"EFC18366":19100,"95597528ADM2001":17500,"J1I-MC-GZBY":14254,"MR-100A-01-TD-3001":9134,"ESK-001-010":2000};

let TOP_AR_STUDIES=[{"study":"Abbvie - M20-465","invAR":76407.62,"apAR":82385.46,"total":158793.08,"collected":249057.59},{"study":"Eli Lilly and Company - J3L-MC-EZEF","invAR":77371.0,"apAR":63422.0,"total":140793.0,"collected":574822.0},{"study":"Eli Lilly and Company - J1G-MC-LAKI","invAR":98993.0,"apAR":32318.0,"total":131311.0,"collected":312174.0},{"study":"Abbvie - M23-714","invAR":7174.64,"apAR":89063.0,"total":96237.64,"collected":44938.8},{"study":"Eli Lilly and Company - J2A-MC-GZPO","invAR":44853.0,"apAR":47797.0,"total":92650.0,"collected":263130.0},{"study":"Mylan Inc. - MR-130A-01-TD-3001","invAR":14286.0,"apAR":66264.55,"total":80550.55,"collected":122763.0},{"study":"Amgen, Inc. - 20230222","invAR":21600.0,"apAR":24362.45,"total":45962.45,"collected":0},{"study":"Johnson & Johnson - 77242113PSO3006","invAR":9000.0,"apAR":31648.0,"total":40648.0,"collected":222825.0},{"study":"Abbvie - M24-601","invAR":33670.95,"apAR":0.0,"total":33670.95,"collected":1318.4},{"study":"Eli Lilly and Company - N1T-MC-MALO","invAR":19975.0,"apAR":12307.0,"total":32282.0,"collected":82945.0},{"study":"Janssen Research & Development, LLC - 80202135SJS3001","invAR":5180.0,"apAR":20517.0,"total":25697.0,"collected":59944.0},{"study":"Sanofi US Services Inc. - EFC17600 (ESTUARY)","invAR":10656.0,"apAR":12424.8,"total":23080.8,"collected":64790.8},{"study":"Astrazeneca Pharmaceuticals - D7960C00015","invAR":18129.0,"apAR":1557.75,"total":19686.75,"collected":17591.75},{"study":"Eli Lilly and Company - J3F-MC-EZCC","invAR":19250.0,"apAR":0.0,"total":19250.0,"collected":14946.0},{"study":"Astrazeneca Pharmaceuticals - D6973C00001","invAR":3884.5,"apAR":13364.2,"total":17248.7,"collected":0},{"study":"Pfizer Inc. - C4951063","invAR":0.0,"apAR":16357.23,"total":16357.23,"collected":19000.0},{"study":"Sanofi US Services Inc. - EFC17599","invAR":1220.0,"apAR":12935.3,"total":14155.3,"collected":95465.2},{"study":"Celldex Therapeutics - CDX0159-12","invAR":1397.13,"apAR":11903.48,"total":13300.61,"collected":10539.91},{"study":"Abbvie - M23-698","invAR":8468.42,"apAR":4525.62,"total":12994.04,"collected":79806.1},{"study":"Sanofi US Services Inc. - EFC17559","invAR":12244.0,"apAR":0.0,"total":12244.0,"collected":17106.1},{"study":"Eli Lilly and Company - J2A-MC-GZGS","invAR":5750.0,"apAR":4976.0,"total":10726.0,"collected":96627.0},{"study":"Eli Lilly and Company - I8F-MC-GPHE","invAR":5368.0,"apAR":2883.0,"total":8251.0,"collected":24022.0},{"study":"Eli Lilly and Company - J1I-MC-GZBO (TRIUMPH-OUTCOMES)","invAR":5150.0,"apAR":0.0,"total":5150.0,"collected":15250.0},{"study":"Sanofi US Services Inc. - LTS17367","invAR":1000.0,"apAR":3824.1,"total":4824.1,"collected":37307.42},{"study":"Sanofi US Services Inc. - EFC18366","invAR":3000.0,"apAR":0,"total":3000.0,"collected":0},{"study":"Alumis Inc. - ESK-001-010","invAR":2000.0,"apAR":0,"total":2000.0,"collected":0},{"study":"Eli Lilly and Company - J1I-MC-GZBY","invAR":1700.0,"apAR":0.0,"total":1700.0,"collected":0},{"study":"Mylan Inc. - MR-100A-01-TD-3001","invAR":0,"apAR":404.3,"total":404.3,"collected":4957.2}];

let totalInvAR=507728.26;
let totalApAR=555240.24;
const BUCKET_COLLECT_RATES={current:0.88,d30_60:0.78,d61_90:0.62,d91_120:0.45,d121_150:0.28,d150plus:0.12};

// ══════════ ENHANCED DATA (populated by live fetch) ══════════
let REVENUE_BY_TYPE = [];      // [{type:'Visit',amount:2981151},{type:'Procedure',amount:381081},...]
let REVENUE_BY_PAY_TYPE = [];  // [{type:'Autopay',amount:2942664},{type:'Invoice',amount:818898}]
let UNINVOICED_DETAIL = [];    // [{study,name,amount},...] — line-level uninvoiced items
let UNINVOICED_BY_CATEGORY = [];// [{category:'Start-Up',amount:46750,count:5},...]
let UNPAID_AP_DETAIL = [];     // [{study,visit,revType,amount,daysUnpaid},...]
let UNPAID_AP_BY_TYPE = [];    // [{type:'Visit',amount:423073},{type:'Procedure',amount:35008},...]
let UNPAID_AP_AGING = [];      // [{bucket:'0-30',amount:X,count:N},...]
let REVENUE_ITEMS_TOP = [];    // [{item:'Visit 3 - Week 1...',amount:X,count:N},...]

// ══════════ PATIENT DATABASE (populated by live fetch) ══════════
let PATIENT_DB = [];           // [{name,status,email,phone,record_number},...]
let PATIENT_DB_MAP = new Map(); // name_lower → patient object (O(1) lookup)
let CONTACT_ALERTS = [];       // [{patient,study,alert_type,severity,detail,patient_url,study_url},...]

// ══════════ HELPERS ══════════
const fmt=v=>{const a=Math.abs(v);return a%1===0?'$'+a.toLocaleString('en-US',{minimumFractionDigits:0,maximumFractionDigits:0}):'$'+a.toLocaleString('en-US',{minimumFractionDigits:2,maximumFractionDigits:2});};
const fmtK=v=>'$'+(v/1000).toFixed(0)+'K';
function pid(s){const m=s.match(/- ([A-Z0-9][A-Za-z0-9\-]+ ?(\(.+?\))?)/);return m?m[1].replace(/ \(.*/,''):null;}
function slink(s){const p=pid(s);if(p&&CRIO_LINKS[p])return'<a href="'+CRIO_LINKS[p]+'" target="_blank" class="study-link">'+s+'</a>';return s;}

// ══════════ MODAL ══════════
function showFinModal(t,html){document.getElementById('mTitle').textContent=t;document.getElementById('mBody').innerHTML=html;document.getElementById('modalBg').classList.add('active');}
function closeFinModal(){document.getElementById('modalBg').classList.remove('active');}
document.addEventListener('DOMContentLoaded',()=>{
  const mb=document.getElementById('modalBg');
  if(mb)mb.addEventListener('click',e=>{if(e.target===mb)closeFinModal();});
});
document.addEventListener('keydown',e=>{if(e.key==='Escape')closeFinModal();});

// ══════════ OVERVIEW MODALS ══════════
function agingModalHTML(arr,label){
  let h='<table><thead><tr><th>Study</th><th class="r">Current</th><th class="r">30-60d</th><th class="r">61-90d</th><th class="r">91-120d</th><th class="r">121-150d</th><th class="r">&gt;150d</th><th class="r">Total</th></tr></thead><tbody>';
  let t={c:0,a:0,b:0,d:0,e:0,f:0};
  arr.forEach(r=>{const tt=r.current+r.d30_60+r.d61_90+r.d91_120+r.d121_150+r.d150plus;h+='<tr><td>'+slink(r.study)+'</td><td class="r">'+fmt(r.current)+'</td><td class="r">'+fmt(r.d30_60)+'</td><td class="r">'+fmt(r.d61_90)+'</td><td class="r">'+fmt(r.d91_120)+'</td><td class="r">'+fmt(r.d121_150)+'</td><td class="r">'+fmt(r.d150plus)+'</td><td class="r">'+fmt(tt)+'</td></tr>';t.c+=r.current;t.a+=r.d30_60;t.b+=r.d61_90;t.d+=r.d91_120;t.e+=r.d121_150;t.f+=r.d150plus;});
  const gt=t.c+t.a+t.b+t.d+t.e+t.f;
  h+='<tr class="total-row"><td>TOTAL</td><td class="r">'+fmt(t.c)+'</td><td class="r">'+fmt(t.a)+'</td><td class="r">'+fmt(t.b)+'</td><td class="r">'+fmt(t.d)+'</td><td class="r">'+fmt(t.e)+'</td><td class="r">'+fmt(t.f)+'</td><td class="r">'+fmt(gt)+'</td></tr></tbody></table>';
  return h;
}
function showInvAgingModal(){showFinModal('Invoice AR — Aging Detail',agingModalHTML(AGING_INV,'Invoice'));}
function showApAgingModal(){showFinModal('Autopay AR — Aging Detail',agingModalHTML(AGING_AP,'Autopay'));}
function showTotalARModal(){
  let h='<table><thead><tr><th>Study</th><th class="r">Invoice AR</th><th class="r">Autopay AR</th><th class="r">Total AR</th><th class="r">Collected</th><th class="r">%</th></tr></thead><tbody>';
  TOP_AR_STUDIES.forEach(r=>{const pct=r.collected>0?((r.collected/(r.collected+r.total))*100).toFixed(0):'0';h+='<tr><td>'+slink(r.study)+'</td><td class="r">'+fmt(r.invAR)+'</td><td class="r">'+fmt(r.apAR)+'</td><td class="r">'+fmt(r.total)+'</td><td class="r">'+fmt(r.collected)+'</td><td class="r">'+pct+'%</td></tr>';});
  h+='<tr class="total-row"><td>TOTAL</td><td class="r">'+fmt(totalInvAR)+'</td><td class="r">'+fmt(totalApAR)+'</td><td class="r">'+fmt(totalInvAR+totalApAR)+'</td><td class="r">$2,483,867.42</td><td class="r">70%</td></tr></tbody></table>';
  showFinModal('Total Open AR — Top 15 Studies',h);
}
function showPaymentsModal(){
  let h='<table><thead><tr><th>Month</th><th class="r">Amount</th></tr></thead><tbody>';let tot=0;
  MONTHLY_PAYMENTS.forEach(r=>{h+='<tr><td>'+r.month+'</td><td class="r">'+fmt(r.amount)+'</td></tr>';tot+=r.amount;});
  h+='<tr class="total-row"><td>TOTAL</td><td class="r">'+fmt(tot)+'</td></tr></tbody></table>';
  showFinModal('Payments Collected — Last 11 Months',h);
}
function showUnpaidInvModal(){
  let h='<table><thead><tr><th>Study</th><th>Invoice</th><th>Due</th><th class="r">Days</th><th class="r">Amount</th></tr></thead><tbody>';let tot=0;
  [...UNPAID_INVOICES].sort((a,b)=>b.days-a.days).forEach(r=>{h+='<tr><td>'+slink(r.study)+'</td><td>'+r.invoice+'</td><td>'+(r.due||'—')+'</td><td class="r">'+r.days+'</td><td class="r">'+fmt(r.unpaid)+'</td></tr>';tot+=r.unpaid;});
  h+='<tr class="total-row"><td colspan="4">TOTAL (42 invoices)</td><td class="r">'+fmt(tot)+'</td></tr></tbody></table>';
  showFinModal('Unpaid Invoices',h);
}
function showUnpaidAPModal(){
  let h='<table><thead><tr><th>Study</th><th class="r">Total</th><th class="r">Visits</th><th class="r">Procedures</th></tr></thead><tbody>';let t={a:0,v:0,p:0};
  UNPAID_AP.forEach(r=>{h+='<tr><td>'+slink(r.study)+'</td><td class="r">'+fmt(r.total)+'</td><td class="r">'+fmt(r.visits)+'</td><td class="r">'+fmt(r.procs)+'</td></tr>';t.a+=r.total;t.v+=r.visits;t.p+=r.procs;});
  h+='<tr class="total-row"><td>TOTAL</td><td class="r">'+fmt(t.a)+'</td><td class="r">'+fmt(t.v)+'</td><td class="r">'+fmt(t.p)+'</td></tr></tbody></table>';
  showFinModal('Unpaid Autopay — 13 Studies',h);
}
function showUninvoicedModal(){
  let h='<table><thead><tr><th>Study</th><th class="r">Amount</th></tr></thead><tbody>';let tot=0;
  UNINVOICED.forEach(r=>{h+='<tr><td>'+slink(r.study)+'</td><td class="r">'+fmt(r.amount)+'</td></tr>';tot+=r.amount;});
  h+='<tr class="total-row"><td>TOTAL (30 studies)</td><td class="r">'+fmt(tot)+'</td></tr></tbody></table>';
  showFinModal('Uninvoiced Revenue',h);
}
function showRev12mModal(){
  let h='<table><thead><tr><th>Study</th><th class="r">Revenue</th></tr></thead><tbody>';let tot=0;
  Object.entries(STUDY_REVENUE_12M).sort((a,b)=>b[1]-a[1]).forEach(([s,v])=>{if(v>0){h+='<tr><td>'+s+'</td><td class="r">'+fmt(v)+'</td></tr>';tot+=v;}});
  h+='<tr class="total-row"><td>TOTAL</td><td class="r">'+fmt(tot)+'</td></tr></tbody></table>';
  showFinModal('12-Month Revenue by Study',h);
}
function showForecastModal(){
  showFinModal('90-Day Cash Forecast — Methodology','<p style="margin-bottom:12px;font-size:13px;color:#4A5568">Forecast based on current AR aging buckets weighted by historical collection probability rates:</p><table><thead><tr><th>Bucket</th><th class="r">Collection Rate</th><th class="r">Invoice AR</th><th class="r">Autopay AR</th><th class="r">Expected</th></tr></thead><tbody>'+
  [{k:'current',l:'Current (0-30d)',r:0.88},{k:'d30_60',l:'30-60 Days',r:0.78},{k:'d61_90',l:'61-90 Days',r:0.62},{k:'d91_120',l:'91-120 Days',r:0.45},{k:'d121_150',l:'121-150 Days',r:0.28},{k:'d150plus',l:'>150 Days',r:0.12}].map(b=>{
    const iv=AGING_INV.reduce((s,x)=>s+(x[b.k]||0),0);const ap=AGING_AP.reduce((s,x)=>s+(x[b.k]||0),0);
    return'<tr><td>'+b.l+'</td><td class="r">'+(b.r*100)+'%</td><td class="r">'+fmt(iv)+'</td><td class="r">'+fmt(ap)+'</td><td class="r">'+fmt((iv+ap)*b.r)+'</td></tr>';
  }).join('')+'</tbody></table>');
}
function showBucketModal(bk){
  const labels={current:'Current (0-30d)',d30_60:'30-60 Days',d61_90:'61-90 Days',d91_120:'91-120 Days',d121_150:'121-150 Days',d150plus:'>150 Days'};
  let h='<table><thead><tr><th>Study</th><th class="r">Invoice</th><th class="r">Autopay</th><th class="r">Total</th></tr></thead><tbody>';
  const map={};
  AGING_INV.forEach(r=>{if(!map[r.study])map[r.study]={i:0,a:0};map[r.study].i+=r[bk]||0;});
  AGING_AP.forEach(r=>{if(!map[r.study])map[r.study]={i:0,a:0};map[r.study].a+=r[bk]||0;});
  let gt=0;Object.entries(map).filter(([_,v])=>(v.i+v.a)>0).sort((a,b)=>(b[1].i+b[1].a)-(a[1].i+a[1].a)).forEach(([s,v])=>{const t=v.i+v.a;h+='<tr><td>'+slink(s)+'</td><td class="r">'+fmt(v.i)+'</td><td class="r">'+fmt(v.a)+'</td><td class="r">'+fmt(t)+'</td></tr>';gt+=t;});
  h+='<tr class="total-row"><td>TOTAL</td><td colspan="2"></td><td class="r">'+fmt(gt)+'</td></tr></tbody></table>';
  showFinModal('AR: '+labels[bk],h);
}
function showStudyModal(s){
  const ar=TOP_AR_STUDIES.find(x=>x.study===s);const p=pid(s);const rev=p?STUDY_REVENUE_12M[p]||0:0;
  const ms=FIN_MERGED_STUDIES.find(x=>s.includes(x.study));const ui=UNINVOICED.find(x=>x.study===s);
  let h='<div style="display:grid;grid-template-columns:1fr 1fr;gap:16px;margin-bottom:20px">';
  if(ar){h+='<div><strong>Invoice AR:</strong> '+fmt(ar.invAR)+'</div><div><strong>Autopay AR:</strong> '+fmt(ar.apAR)+'</div><div><strong>Total AR:</strong> '+fmt(ar.total)+'</div><div><strong>Collected:</strong> '+fmt(ar.collected)+'</div>';}
  h+='<div><strong>12M Revenue:</strong> '+fmt(rev)+'</div>';
  if(ui)h+='<div><strong>Uninvoiced:</strong> '+fmt(ui.amount)+'</div>';
  if(ms)h+='<div><strong>Status:</strong> '+ms.status+'</div><div><strong>Enrolled:</strong> '+ms.enrolled+'</div>';
  h+='</div>';
  const invs=UNPAID_INVOICES.filter(x=>x.study===s);
  if(invs.length){h+='<h3 style="font-size:13px;font-weight:700;margin-bottom:8px">Unpaid Invoices ('+invs.length+')</h3><table><thead><tr><th>Invoice</th><th>Due</th><th class="r">Days</th><th class="r">Amount</th></tr></thead><tbody>';invs.forEach(i=>{h+='<tr><td>'+i.invoice+'</td><td>'+(i.due||'—')+'</td><td class="r">'+i.days+'</td><td class="r">'+fmt(i.unpaid)+'</td></tr>';});h+='</tbody></table>';}
  showFinModal(s,h);
}

// ══════════ CHARTS ══════════
function drawRevChart(){
  const sv=document.getElementById('revChart');if(!sv)return;sv.innerHTML='';
  const d=MONTHLY_REVENUE.slice(-12);const mx=Math.max(...d.map(m=>m.autopay+m.procedures+Math.max(0,m.invoicables)))*1.1;
  const bw=58,pad=50;
  d.forEach((m,i)=>{const x=pad+i*((950-pad)/d.length);const a=m.autopay,p=m.procedures,inv=Math.max(0,m.invoicables);const tot=a+p+inv;const sc=230/mx;
    const ha=a*sc,hp=p*sc,hi=inv*sc;
    [['#60A5FA',ha,230-ha],['#34D399',hp,230-(ha+hp)],['#FBBF24',hi,230-(ha+hp+hi)]].forEach(([c,h,y])=>{if(h>0){const r=document.createElementNS('http://www.w3.org/2000/svg','rect');r.setAttribute('x',x);r.setAttribute('y',y);r.setAttribute('width',bw);r.setAttribute('height',h);r.setAttribute('fill',c);r.setAttribute('rx','2');sv.appendChild(r);}});
    const t=document.createElementNS('http://www.w3.org/2000/svg','text');t.setAttribute('x',x+bw/2);t.setAttribute('y',258);t.setAttribute('text-anchor','middle');t.setAttribute('font-size','12');t.setAttribute('fill','#4A5568');t.textContent=m.month;sv.appendChild(t);
    const v=document.createElementNS('http://www.w3.org/2000/svg','text');v.setAttribute('x',x+bw/2);v.setAttribute('y',230-tot*sc-6);v.setAttribute('text-anchor','middle');v.setAttribute('font-size','14');v.setAttribute('font-weight','700');v.setAttribute('fill','#1a202c');v.textContent='$'+(tot/1000).toFixed(0)+'K';sv.appendChild(v);
  });
}
function drawPayChart(){
  const sv=document.getElementById('payChart');if(!sv)return;sv.innerHTML='';
  const mx=Math.max(...MONTHLY_PAYMENTS.map(m=>m.amount))*1.1;const bw=62,pad=50;
  MONTHLY_PAYMENTS.forEach((m,i)=>{const x=pad+i*((950-pad)/MONTHLY_PAYMENTS.length);const h=(m.amount/mx)*230;
    const r=document.createElementNS('http://www.w3.org/2000/svg','rect');r.setAttribute('x',x);r.setAttribute('y',230-h);r.setAttribute('width',bw);r.setAttribute('height',h);r.setAttribute('fill','#14B8A6');r.setAttribute('rx','2');sv.appendChild(r);
    const t=document.createElementNS('http://www.w3.org/2000/svg','text');t.setAttribute('x',x+bw/2);t.setAttribute('y',258);t.setAttribute('text-anchor','middle');t.setAttribute('font-size','12');t.setAttribute('fill','#4A5568');t.textContent=m.month;sv.appendChild(t);
    const v=document.createElementNS('http://www.w3.org/2000/svg','text');v.setAttribute('x',x+bw/2);v.setAttribute('y',230-h-6);v.setAttribute('text-anchor','middle');v.setAttribute('font-size','14');v.setAttribute('font-weight','700');v.setAttribute('fill','#1a202c');v.textContent='$'+(m.amount/1000).toFixed(0)+'K';sv.appendChild(v);
  });
}

// ══════════ TABLE RENDERING ══════════
function renderARStudies(){
  const tb=document.getElementById('arStudiesBody');
  tb.innerHTML=TOP_AR_STUDIES.map(r=>{const pct=r.collected>0?((r.collected/(r.collected+r.total))*100).toFixed(0):'0';
    return'<tr class="clickable" onclick="showStudyModal(\''+r.study.replace(/'/g,"\\'")+'\')">' +
      '<td>'+slink(r.study)+'</td><td class="r">'+fmt(r.invAR)+'</td><td class="r">'+fmt(r.apAR)+'</td><td class="r">'+fmt(r.total)+'</td><td class="r">'+fmt(r.collected)+'</td><td class="r">'+pct+'%</td></tr>';}).join('');
}
function renderAgingTables(){
  const inv=document.getElementById('invAgingBody');const ap=document.getElementById('apAgingBody');
  let it={c:0,a:0,b:0,d:0,e:0,f:0},at={c:0,a:0,b:0,d:0,e:0,f:0};
  inv.innerHTML=AGING_INV.map(r=>{const t=r.current+r.d30_60+r.d61_90+r.d91_120+r.d121_150+r.d150plus;it.c+=r.current;it.a+=r.d30_60;it.b+=r.d61_90;it.d+=r.d91_120;it.e+=r.d121_150;it.f+=r.d150plus;
    return'<tr class="clickable" onclick="showStudyModal(\''+r.study.replace(/'/g,"\\'")+'\')">' +
      '<td>'+slink(r.study)+'</td><td class="r">'+fmt(r.current)+'</td><td class="r">'+fmt(r.d30_60)+'</td><td class="r">'+fmt(r.d61_90)+'</td><td class="r">'+fmt(r.d91_120)+'</td><td class="r">'+fmt(r.d121_150)+'</td><td class="r">'+fmt(r.d150plus)+'</td><td class="r">'+fmt(t)+'</td></tr>';}).join('');
  inv.innerHTML+='<tr class="total-row"><td>TOTAL</td><td class="r">'+fmt(it.c)+'</td><td class="r">'+fmt(it.a)+'</td><td class="r">'+fmt(it.b)+'</td><td class="r">'+fmt(it.d)+'</td><td class="r">'+fmt(it.e)+'</td><td class="r">'+fmt(it.f)+'</td><td class="r">'+fmt(it.c+it.a+it.b+it.d+it.e+it.f)+'</td></tr>';
  ap.innerHTML=AGING_AP.map(r=>{const t=r.current+r.d30_60+r.d61_90+r.d91_120+r.d121_150+r.d150plus;at.c+=r.current;at.a+=r.d30_60;at.b+=r.d61_90;at.d+=r.d91_120;at.e+=r.d121_150;at.f+=r.d150plus;
    return'<tr class="clickable" onclick="showStudyModal(\''+r.study.replace(/'/g,"\\'")+'\')">' +
      '<td>'+slink(r.study)+'</td><td class="r">'+fmt(r.current)+'</td><td class="r">'+fmt(r.d30_60)+'</td><td class="r">'+fmt(r.d61_90)+'</td><td class="r">'+fmt(r.d91_120)+'</td><td class="r">'+fmt(r.d121_150)+'</td><td class="r">'+fmt(r.d150plus)+'</td><td class="r">'+fmt(t)+'</td></tr>';}).join('');
  ap.innerHTML+='<tr class="total-row"><td>TOTAL</td><td class="r">'+fmt(at.c)+'</td><td class="r">'+fmt(at.a)+'</td><td class="r">'+fmt(at.b)+'</td><td class="r">'+fmt(at.d)+'</td><td class="r">'+fmt(at.e)+'</td><td class="r">'+fmt(at.f)+'</td><td class="r">'+fmt(at.c+at.a+at.b+at.d+at.e+at.f)+'</td></tr>';
}
function renderAgingKPIs(){
  const bks=[{k:'current',l:'Current (0-30d)',c:'#10B981'},{k:'d30_60',l:'30-60 Days',c:'#F59E0B'},{k:'d61_90',l:'61-90 Days',c:'#F97316'},{k:'d91_120',l:'91-120 Days',c:'#EF4444'},{k:'d121_150',l:'121-150 Days',c:'#DC2626'},{k:'d150plus',l:'>150 Days',c:'#7F1D1D'}];
  document.getElementById('agingKPIs').innerHTML=bks.map(b=>{
    const iv=AGING_INV.reduce((s,x)=>s+(x[b.k]||0),0);const ap=AGING_AP.reduce((s,x)=>s+(x[b.k]||0),0);const t=iv+ap;
    return'<div class="kpi click" onclick="showBucketModal(\''+b.k+'\')"><div class="kpi-stripe" style="background:'+b.c+'"></div><div class="label">'+b.l+'</div><div class="value" style="color:'+b.c+'">'+fmtK(t)+'</div><div class="sub">Inv '+fmtK(iv)+' + AP '+fmtK(ap)+'</div></div>';
  }).join('');
}
function renderRevByStudy(){
  const tb=document.getElementById('revByStudyBody');let tot=0;
  tb.innerHTML=Object.entries(STUDY_REVENUE_12M).sort((a,b)=>b[1]-a[1]).filter(([_,v])=>v>0).map(([s,v])=>{tot+=v;return'<tr class="clickable" onclick="showStudyModal(\''+s.replace(/'/g,"\\'")+'\')"><td>'+slink(s)+'</td><td class="r">'+fmt(v)+'</td></tr>';}).join('');
  tb.innerHTML+='<tr class="total-row"><td>TOTAL</td><td class="r">'+fmt(tot)+'</td></tr>';
}
function renderUninvoiced(){
  const tb=document.getElementById('uninvBody');if(!tb)return;let tot=0;
  tb.innerHTML=UNINVOICED.map(r=>{tot+=r.amount;return'<tr><td>'+slink(r.study)+'</td><td class="r">'+fmt(r.amount)+'</td></tr>';}).join('');
  tb.innerHTML+='<tr class="total-row"><td>TOTAL ('+UNINVOICED.length+' studies)</td><td class="r">'+fmt(tot)+'</td></tr>';
}

// ══════════ ENHANCED REVENUE TAB ══════════
function renderRevenueTab() {
  // KPIs
  const total12m = Object.values(STUDY_REVENUE_12M).reduce((s,v) => s+v, 0);
  const monthCount = MONTHLY_REVENUE.length || 1;
  const avgMonthly = total12m / Math.min(monthCount, 12);
  const studyCount = Object.keys(STUDY_REVENUE_12M).length || 1;
  const revPerStudy = total12m / studyCount;
  const topType = REVENUE_BY_TYPE.length ? REVENUE_BY_TYPE[0] : null;

  const el = id => document.getElementById(id);
  if (el('rev-total')) { el('rev-total').textContent = '$' + (total12m/1000000).toFixed(2) + 'M'; }
  if (el('rev-total-sub')) { el('rev-total-sub').textContent = (REVENUE_BY_PAY_TYPE.length >= 2 ? 'Autopay ' + fmtK(REVENUE_BY_PAY_TYPE.find(t=>t.type==='Autopay')?.amount||0) + ' + Invoice ' + fmtK(REVENUE_BY_PAY_TYPE.find(t=>t.type==='Invoice')?.amount||0) : studyCount + ' studies'); }
  if (el('rev-avg')) { el('rev-avg').textContent = fmtK(avgMonthly); }
  if (el('rev-avg-sub')) {
    const last3 = MONTHLY_REVENUE.slice(-3);
    const avg3 = last3.length ? last3.reduce((s,m)=>s+m.autopay+m.procedures+m.invoicables,0)/last3.length : 0;
    const trend = avg3 > avgMonthly ? '↑' : avg3 < avgMonthly ? '↓' : '→';
    el('rev-avg-sub').textContent = 'Last 3mo avg: ' + fmtK(avg3) + ' ' + trend;
  }
  if (el('rev-per-study')) { el('rev-per-study').textContent = fmtK(revPerStudy); }
  if (el('rev-per-study-sub')) { el('rev-per-study-sub').textContent = studyCount + ' active studies'; }
  if (el('rev-top-type') && topType) { el('rev-top-type').textContent = topType.type; }
  if (el('rev-top-type-sub') && topType) { el('rev-top-type-sub').textContent = '$' + (topType.amount/1000000).toFixed(2) + 'M (' + Math.round(topType.amount/total12m*100) + '%)'; }

  // Revenue Trend chart (duplicate of overview revChart but on Revenue tab)
  drawRevChartOn('revChartDetail');

  // Revenue by Type donut
  drawDonutChart('revTypeDonut', 'revTypeLegend', REVENUE_BY_TYPE, ['#8B5CF6','#14B8A6','#F59E0B','#EF4444','#6B7280']);

  // Revenue by Payment Type horizontal bars
  renderPayTypeChart();

  // Top Items table
  renderRevenueItems();

  // Study revenue table (existing)
  renderRevByStudy();
}

function drawRevChartOn(svgId) {
  const sv = document.getElementById(svgId); if (!sv) return; sv.innerHTML = '';
  const d = MONTHLY_REVENUE.slice(-12);
  if (!d.length) return;
  const mx = Math.max(...d.map(m => m.autopay + m.procedures + Math.max(0, m.invoicables))) * 1.1 || 1;
  const bw = 58, pad = 50;
  d.forEach((m, i) => {
    const x = pad + i * ((950 - pad) / d.length);
    const a = m.autopay, p = m.procedures, inv = Math.max(0, m.invoicables), tot = a + p + inv, sc = 230 / mx;
    const ha = a * sc, hp = p * sc, hi = inv * sc;
    [['#60A5FA', ha, 230 - ha], ['#34D399', hp, 230 - (ha + hp)], ['#FBBF24', hi, 230 - (ha + hp + hi)]].forEach(([c, h, y]) => {
      if (h > 0) { const r = document.createElementNS('http://www.w3.org/2000/svg', 'rect'); r.setAttribute('x', x); r.setAttribute('y', y); r.setAttribute('width', bw); r.setAttribute('height', h); r.setAttribute('fill', c); r.setAttribute('rx', '2'); sv.appendChild(r); }
    });
    const t = document.createElementNS('http://www.w3.org/2000/svg', 'text'); t.setAttribute('x', x + bw / 2); t.setAttribute('y', 258); t.setAttribute('text-anchor', 'middle'); t.setAttribute('font-size', '12'); t.setAttribute('fill', '#4A5568'); t.textContent = m.month; sv.appendChild(t);
    const v = document.createElementNS('http://www.w3.org/2000/svg', 'text'); v.setAttribute('x', x + bw / 2); v.setAttribute('y', 230 - tot * sc - 6); v.setAttribute('text-anchor', 'middle'); v.setAttribute('font-size', '14'); v.setAttribute('font-weight', '700'); v.setAttribute('fill', '#1a202c'); v.textContent = '$' + (tot / 1000).toFixed(0) + 'K'; sv.appendChild(v);
  });
}

function drawDonutChart(svgId, legendId, data, colors) {
  const svg = document.getElementById(svgId); if (!svg) return; svg.innerHTML = '';
  const legend = document.getElementById(legendId); if (legend) legend.innerHTML = '';
  if (!data.length) return;
  const total = data.reduce((s, d) => s + Math.abs(d.amount), 0);
  if (total === 0) return;
  const cx = 100, cy = 100, r = 80, ir = 50;
  let startAngle = -Math.PI / 2;
  data.forEach((d, i) => {
    const pct = Math.abs(d.amount) / total;
    if (pct < 0.005) return;
    const endAngle = startAngle + pct * 2 * Math.PI;
    const largeArc = pct > 0.5 ? 1 : 0;
    const x1 = cx + r * Math.cos(startAngle), y1 = cy + r * Math.sin(startAngle);
    const x2 = cx + r * Math.cos(endAngle), y2 = cy + r * Math.sin(endAngle);
    const ix1 = cx + ir * Math.cos(endAngle), iy1 = cy + ir * Math.sin(endAngle);
    const ix2 = cx + ir * Math.cos(startAngle), iy2 = cy + ir * Math.sin(startAngle);
    const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    path.setAttribute('d', `M${x1},${y1} A${r},${r} 0 ${largeArc},1 ${x2},${y2} L${ix1},${iy1} A${ir},${ir} 0 ${largeArc},0 ${ix2},${iy2} Z`);
    path.setAttribute('fill', colors[i % colors.length]);
    svg.appendChild(path);
    startAngle = endAngle;
    // Legend
    if (legend) {
      legend.innerHTML += '<div style="display:flex;align-items:center;gap:8px;margin-bottom:4px"><span style="display:inline-block;width:10px;height:10px;background:' + colors[i % colors.length] + ';border-radius:2px;flex-shrink:0"></span><span style="color:#4A5568">' + d.type + '</span><span style="font-weight:700;color:#1a202c;margin-left:auto">' + fmtK(d.amount) + '</span><span style="color:#9CA3AF;font-size:11px">(' + Math.round(pct * 100) + '%)</span></div>';
    }
  });
  // Center text
  const ct = document.createElementNS('http://www.w3.org/2000/svg', 'text');
  ct.setAttribute('x', cx); ct.setAttribute('y', cy - 5); ct.setAttribute('text-anchor', 'middle'); ct.setAttribute('font-size', '14'); ct.setAttribute('font-weight', '700'); ct.setAttribute('fill', '#1a202c');
  ct.textContent = '$' + (total / 1000000).toFixed(1) + 'M';
  svg.appendChild(ct);
  const cs = document.createElementNS('http://www.w3.org/2000/svg', 'text');
  cs.setAttribute('x', cx); cs.setAttribute('y', cy + 12); cs.setAttribute('text-anchor', 'middle'); cs.setAttribute('font-size', '11'); cs.setAttribute('fill', '#718096');
  cs.textContent = 'Total';
  svg.appendChild(cs);
}

function renderPayTypeChart() {
  const container = document.getElementById('revPayTypeChart'); if (!container) return;
  if (!REVENUE_BY_PAY_TYPE.length) { container.innerHTML = '<div style="color:#9CA3AF;text-align:center">No data</div>'; return; }
  const maxAmt = Math.max(...REVENUE_BY_PAY_TYPE.map(d => d.amount));
  const colors = { 'Autopay': '#60A5FA', 'Invoice': '#FBBF24' };
  container.innerHTML = REVENUE_BY_PAY_TYPE.map(d => {
    const pct = (d.amount / maxAmt * 100).toFixed(0);
    const c = colors[d.type] || '#8B5CF6';
    return '<div style="margin-bottom:16px"><div style="display:flex;justify-content:space-between;margin-bottom:4px;font-size:13px"><span style="font-weight:600;color:#1a202c">' + d.type + '</span><span style="color:#4A5568;font-weight:700">' + fmt(d.amount) + '</span></div><div style="background:#F3F4F6;border-radius:6px;height:28px;overflow:hidden"><div style="background:' + c + ';height:100%;width:' + pct + '%;border-radius:6px;transition:width 0.5s"></div></div></div>';
  }).join('');
}

function renderRevenueItems() {
  const tb = document.getElementById('revItemsBody'); if (!tb) return;
  if (!REVENUE_ITEMS_TOP.length) return;
  let total = 0;
  tb.innerHTML = REVENUE_ITEMS_TOP.map(r => {
    total += r.amount;
    const avg = r.count > 0 ? r.amount / r.count : 0;
    return '<tr><td style="max-width:400px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">' + r.item + '</td><td class="r">' + fmt(r.amount) + '</td><td class="r">' + r.count.toLocaleString() + '</td><td class="r">' + fmt(avg) + '</td></tr>';
  }).join('');
  tb.innerHTML += '<tr class="total-row"><td>TOTAL</td><td class="r">' + fmt(total) + '</td><td></td><td></td></tr>';
}
// ══════════ ENHANCED ACCRUALS TAB ══════════
function renderAccruals() {
  const el = id => document.getElementById(id);

  // KPI values
  const uninvTotal = UNINVOICED.reduce((s, r) => s + r.amount, 0);
  const unpaidApTotal = UNPAID_AP.reduce((s, r) => s + r.total, 0);
  const unpaidInvTotal = UNPAID_INVOICES.reduce((s, r) => s + r.unpaid, 0);
  const grandTotal = uninvTotal + unpaidApTotal + unpaidInvTotal;

  if (el('acc-total')) el('acc-total').textContent = fmtK(grandTotal);
  if (el('acc-total-sub')) el('acc-total-sub').textContent = 'Across all categories';
  if (el('acc-uninv')) el('acc-uninv').textContent = fmt(uninvTotal);
  if (el('acc-uninv-sub')) el('acc-uninv-sub').textContent = UNINVOICED.length + ' studies';
  if (el('acc-unpaid-ap')) el('acc-unpaid-ap').textContent = fmt(unpaidApTotal);
  if (el('acc-unpaid-ap-sub')) el('acc-unpaid-ap-sub').textContent = new Set(UNPAID_AP.map(r=>r.study)).size + ' studies';
  if (el('acc-unpaid-inv')) el('acc-unpaid-inv').textContent = fmt(unpaidInvTotal);
  if (el('acc-unpaid-inv-sub')) el('acc-unpaid-inv-sub').textContent = UNPAID_INVOICES.length + ' invoices';

  // Uninvoiced by Category donut
  if (UNINVOICED_BY_CATEGORY.length) {
    const catData = UNINVOICED_BY_CATEGORY.map(c => ({ type: c.category, amount: c.amount }));
    drawDonutChart('uninvCatDonut', 'uninvCatLegend', catData, ['#8B5CF6','#EC4899','#F59E0B','#14B8A6','#EF4444','#60A5FA','#6B7280']);
  }

  // Unpaid AP by Revenue Type bars
  renderUnpaidApTypeChart();

  // Unpaid AP Aging distribution
  renderUnpaidApAging();

  // Uninvoiced detail table
  renderUninvoicedDetail();

  // Uninvoiced summary (existing)
  renderUninvoiced();
}

function renderUnpaidApTypeChart() {
  const container = document.getElementById('unpaidApTypeChart'); if (!container) return;
  if (!UNPAID_AP_BY_TYPE.length) { container.innerHTML = '<div style="color:#9CA3AF;text-align:center">No data</div>'; return; }
  const total = UNPAID_AP_BY_TYPE.reduce((s,d) => s + d.amount, 0);
  const maxAmt = Math.max(...UNPAID_AP_BY_TYPE.map(d => d.amount));
  const colors = { 'Visit': '#F59E0B', 'Procedure': '#14B8A6', 'Unscheduled Visit': '#8B5CF6' };
  container.innerHTML = UNPAID_AP_BY_TYPE.map(d => {
    const pct = total > 0 ? Math.round(d.amount / total * 100) : 0;
    const barPct = (d.amount / maxAmt * 100).toFixed(0);
    const c = colors[d.type] || '#6B7280';
    return '<div style="margin-bottom:16px"><div style="display:flex;justify-content:space-between;margin-bottom:4px;font-size:13px"><span style="font-weight:600;color:#1a202c">' + d.type + ' <span style="color:#9CA3AF;font-weight:400">(' + d.count + ' items · ' + pct + '%)</span></span><span style="color:#4A5568;font-weight:700">' + fmt(d.amount) + '</span></div><div style="background:#F3F4F6;border-radius:6px;height:24px;overflow:hidden"><div style="background:' + c + ';height:100%;width:' + barPct + '%;border-radius:6px;transition:width 0.5s"></div></div></div>';
  }).join('');
}

function renderUnpaidApAging() {
  const container = document.getElementById('unpaidApAgingChart'); if (!container) return;
  if (!UNPAID_AP_AGING.length) { container.innerHTML = '<div style="color:#9CA3AF;text-align:center">No data</div>'; return; }
  const total = UNPAID_AP_AGING.reduce((s,d) => s + d.amount, 0);
  const maxAmt = Math.max(...UNPAID_AP_AGING.map(d => d.amount));
  const agingColors = { '0-30': '#10B981', '31-60': '#F59E0B', '61-90': '#F97316', '91-120': '#EF4444', '121+': '#7F1D1D' };
  // Check for data concentration warning — if 121+ bucket has >80% of total
  const bucket121 = UNPAID_AP_AGING.find(d => d.bucket === '121+');
  const pct121 = (bucket121 && total > 0) ? Math.round(bucket121.amount / total * 100) : 0;
  let warningHtml = '';
  if (pct121 >= 80) {
    warningHtml = '<div style="background:#FEF3C7;border:1px solid #F59E0B;border-radius:8px;padding:12px 16px;margin-bottom:12px;display:flex;align-items:center;gap:10px;">' +
      '<span style="font-size:18px;">⚠️</span>' +
      '<div><div style="font-weight:700;font-size:12px;color:#92400E;">Data Quality Flag: ' + pct121 + '% of unpaid autopay is in the 121+ day bucket</div>' +
      '<div style="font-size:11px;color:#B45309;margin-top:2px;">This may indicate stale data or a batch processing delay. Verify autopay payment records are current in the Master Sheet.</div></div></div>';
  }
  container.innerHTML = warningHtml + '<div style="display:flex;gap:12px;flex-wrap:wrap">' + UNPAID_AP_AGING.map(d => {
    const pct = total > 0 ? Math.round(d.amount / total * 100) : 0;
    const c = agingColors[d.bucket] || '#6B7280';
    return '<div style="flex:1;min-width:140px;background:#F9FAFB;border-radius:10px;padding:16px;text-align:center;border:2px solid ' + c + '20">' +
      '<div style="font-size:11px;color:#6B7280;font-weight:600;text-transform:uppercase;letter-spacing:0.5px">' + d.bucket + ' Days</div>' +
      '<div style="font-size:22px;font-weight:700;color:' + c + ';margin:4px 0">' + fmt(d.amount) + '</div>' +
      '<div style="font-size:12px;color:#9CA3AF">' + d.count + ' visits · ' + pct + '%</div>' +
    '</div>';
  }).join('') + '</div>';
}

function renderUninvoicedDetail() {
  const tb = document.getElementById('uninvDetailBody'); if (!tb) return;
  const label = document.getElementById('uninvDetailLabel');
  const data = UNINVOICED_DETAIL.length ? UNINVOICED_DETAIL : UNINVOICED.map(r => ({ study: r.study, name: '—', category: '—', amount: r.amount }));
  if (label) label.textContent = 'Uninvoiced Revenue Detail (' + data.length + ' items)';
  let total = 0;
  tb.innerHTML = data.map(r => {
    total += r.amount;
    return '<tr><td>' + slink(r.study) + '</td><td style="max-width:250px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">' + (r.name || '—') + '</td><td><span class="pill" style="background:' + getCategoryColor(r.category) + '20;color:' + getCategoryColor(r.category) + ';font-size:11px">' + (r.category || '—') + '</span></td><td class="r">' + fmt(r.amount) + '</td></tr>';
  }).join('');
  tb.innerHTML += '<tr class="total-row"><td colspan="3">TOTAL</td><td class="r">' + fmt(total) + '</td></tr>';
}

function getCategoryColor(cat) {
  const map = { 'Start-Up Fees': '#8B5CF6', 'Close-Out Fees': '#EF4444', 'Archiving / Storage': '#F59E0B', 'Ethics / IRB Fees': '#14B8A6', 'SAE Reports': '#EC4899', 'Pharmacy Fees': '#60A5FA', 'Other Fees': '#6B7280' };
  return map[cat] || '#6B7280';
}

function renderStudies(){
  const tb=document.getElementById('studiesBody');
  tb.innerHTML=FIN_MERGED_STUDIES.map(r=>{const rev=STUDY_REVENUE_12M[r.study]||0;const ar=TOP_AR_STUDIES.find(x=>x.study.includes(r.study));const arv=ar?ar.total:0;
    const pc=r.status==='Enrolling'?'pill-enrolling':r.status==='Maintenance'?'pill-maintenance':'pill-pre-closed';
    const lnk=CRIO_LINKS[r.study]?'<a href="'+CRIO_LINKS[r.study]+'" target="_blank" class="study-link">'+r.study+'</a>':r.study;
    return'<tr class="clickable"><td>'+lnk+'</td><td><span class="pill '+pc+'">'+r.status+'</span></td><td class="r">'+r.enrolled+'</td><td class="r">'+fmt(rev)+'</td><td class="r">'+fmt(arv)+'</td></tr>';
  }).join('');
}

// ══════════ COLLECTIONS ══════════
let collData=[],collSort='days',collFilter='All';
function defaultStatus(days,amt){
  // Realistic defaults based on age & amount
  if(days>=500) return 'Escalated';
  if(days>=365) return amt>2000?'Disputed':'Escalated';
  if(days>=280) return 'Contacted';
  if(days>=230) return amt>10000?'Contacted':'New';
  if(days>=200) return 'New';
  return 'New';
}
function initColl(){
  collData=UNPAID_INVOICES.map(inv=>{const k='crp_coll_'+inv.invoice;const s=localStorage.getItem(k);
    if(s){const p=JSON.parse(s);return{...inv,...p};}
    return{...inv,status:defaultStatus(inv.days,Math.abs(inv.unpaid)),notes:''};});
}
function cycleSt(inv){
  const sts=['New','Contacted','Escalated','Disputed','Resolved'];
  const item=collData.find(i=>i.invoice===inv);if(!item)return;
  item.status=sts[(sts.indexOf(item.status)+1)%sts.length];
  localStorage.setItem('crp_coll_'+inv,JSON.stringify({status:item.status,notes:item.notes}));
  renderCollections();
}
function saveNote(inv){
  const item=collData.find(i=>i.invoice===inv);if(!item)return;
  const el=document.querySelector('[data-inv="'+inv+'"]');if(el){item.notes=el.value;
  localStorage.setItem('crp_coll_'+inv,JSON.stringify({status:item.status,notes:item.notes}));}
}
function toggleNote(inv){const el=document.querySelector('[data-inv="'+inv+'"]');if(el)el.classList.toggle('active');}
function renderCollections(){
  // Summary
  const counts={New:0,Contacted:0,Escalated:0,Disputed:0,Resolved:0};
  collData.forEach(i=>counts[i.status]=(counts[i.status]||0)+1);
  const colors={New:'#1D4ED8',Contacted:'#D97706',Escalated:'#EA580C',Disputed:'#DC2626',Resolved:'#059669'};
  document.getElementById('collSummary').innerHTML=Object.entries(counts).map(([s,c])=>'<div class="cs-card"><div class="cs-label">'+s+'</div><div class="cs-val" style="color:'+colors[s]+'">'+c+'</div></div>').join('');
  // Filters
  document.getElementById('statusFilters').innerHTML=['All','New','Contacted','Escalated','Disputed','Resolved'].map(s=>'<button class="fbtn'+(s===collFilter?' active':'')+'" onclick="collFilter=\''+s+'\';renderCollections()">'+s+'</button>').join('');
  // Table
  let d=collFilter==='All'?[...collData]:collData.filter(i=>i.status===collFilter);
  if(collSort==='days')d.sort((a,b)=>b.days-a.days);
  else if(collSort==='amount')d.sort((a,b)=>Math.abs(b.amount)-Math.abs(a.amount));
  else{const o={New:0,Contacted:1,Escalated:2,Disputed:3,Resolved:4};d.sort((a,b)=>o[a.status]-o[b.status]);}
  const pm={New:'pill-new',Contacted:'pill-contacted',Escalated:'pill-escalated',Disputed:'pill-disputed',Resolved:'pill-resolved'};
  document.getElementById('collBody').innerHTML=d.map(r=>'<tr><td>'+slink(r.study)+'</td><td>'+r.invoice+'</td><td class="r" style="font-weight:700;color:'+(r.days>365?'#DC2626':r.days>180?'#EA580C':'#4A5568')+'">'+r.days+'</td><td class="r">'+fmt(r.unpaid)+'</td><td><span class="pill '+(pm[r.status]||'pill-new')+'" onclick="cycleSt(\''+r.invoice.replace(/'/g,"\\'")+'\')" title="Click to cycle status">'+r.status+'</span></td><td><button class="notes-btn" onclick="toggleNote(\''+r.invoice.replace(/'/g,"\\'")+'\')">Notes</button><input class="notes-input" data-inv="'+r.invoice+'" value="'+(r.notes||'')+'" onblur="saveNote(\''+r.invoice.replace(/'/g,"\\'")+'\')" onkeypress="if(event.key===\'Enter\')saveNote(\''+r.invoice.replace(/'/g,"\\'")+'\')" placeholder="Add note..."></td></tr>').join('');
}

// ══════════ ALERTS ══════════
function showZeroCollAlert(){
  const nc=TOP_AR_STUDIES.filter(s=>s.collected===0&&s.total>5000);
  let h='<table class="tbl"><thead><tr><th>Study</th><th class="r">Invoice AR</th><th class="r">Autopay AR</th><th class="r">Total AR</th></tr></thead><tbody>';
  nc.forEach(r=>{h+='<tr><td>'+slink(r.study)+'</td><td class="r">'+fmt(r.invAR)+'</td><td class="r">'+fmt(r.apAR)+'</td><td class="r" style="font-weight:700;color:#DC2626">'+fmt(r.total)+'</td></tr>';});
  h+='</tbody></table><div style="margin-top:12px;padding:12px;background:#FEF3C7;border-radius:8px;font-size:12px"><strong>Recommended Action:</strong> Contact sponsor billing contacts for each study. Verify invoice delivery and confirm payment timelines. Escalate to site director if no response within 5 business days.</div>';
  showFinModal('Zero Collections — Immediate Follow Up Required ('+nc.length+' studies)',h);
}
function renderAlerts(){
  const box=document.getElementById('alertsBox');let h='';
  const nc=TOP_AR_STUDIES.filter(s=>s.collected===0&&s.total>5000);
  if(nc.length)h+='<div class="alert-bar alert-warn" style="cursor:pointer" onclick="showZeroCollAlert()">'+nc.length+' studies with significant AR but zero collections — <u>click to see details</u></div>';
  const old=UNPAID_INVOICES.filter(i=>i.days>=365);
  if(old.length)h+='<div class="alert-bar alert-crit" style="cursor:pointer" onclick="showUnpaidInvModal()">'+old.length+' invoices over 365 days old — <u>click to review</u></div>';
  const bigAR=TOP_AR_STUDIES.filter(s=>s.total>100000);
  if(bigAR.length)h+='<div class="alert-bar alert-info" style="cursor:pointer" onclick="showTotalARModal()">'+bigAR.length+' studies with AR exceeding $100K — <u>click for breakdown</u></div>';
  box.innerHTML=h;
}

// ══════════ FORECAST ══════════
function renderForecast(){
  let f30=0,f60=0,f90=0;
  [AGING_INV,AGING_AP].forEach(arr=>{arr.forEach(s=>{f30+=s.current*BUCKET_COLLECT_RATES.current;f60+=s.d30_60*BUCKET_COLLECT_RATES.d30_60;f90+=s.d61_90*BUCKET_COLLECT_RATES.d61_90;});});
let FIN_MERGED_STUDIES=[{"study":"M20-465","full":"Abbvie - M20-465","invAR":76407.62,"apAR":82385.46,"uninvoiced":4750.0,"status":"Active"},{"study":"M23-698","full":"Abbvie - M23-698","invAR":8468.42,"apAR":4525.62,"uninvoiced":12500.0,"status":"Active"},{"study":"M23-714","full":"Abbvie - M23-714","invAR":7174.64,"apAR":89063.0,"uninvoiced":4750.0,"status":"Active"},{"study":"M24-601","full":"Abbvie - M24-601","invAR":33670.95,"apAR":0.0,"uninvoiced":20750.0,"status":"Active"},{"study":"ESK-001-010","full":"Alumis Inc. - ESK-001-010","invAR":2000.0,"apAR":0,"uninvoiced":4798.0,"status":"Active"},{"study":"20230222","full":"Amgen, Inc. - 20230222","invAR":21600.0,"apAR":24362.45,"uninvoiced":28250.0,"status":"Active"},{"study":"D6973C00001","full":"Astrazeneca Pharmaceuticals - D6973C00001","invAR":3884.5,"apAR":13364.2,"uninvoiced":38400.0,"status":"Active"},{"study":"D7960C00015","full":"Astrazeneca Pharmaceuticals - D7960C00015","invAR":18129.0,"apAR":1557.75,"uninvoiced":6050.0,"status":"Active"},{"study":"CDX0159-12","full":"Celldex Therapeutics - CDX0159-12","invAR":1397.13,"apAR":11903.48,"uninvoiced":4500.0,"status":"Active"},{"study":"I8F-MC-GPHE","full":"Eli Lilly and Company - I8F-MC-GPHE","invAR":5368.0,"apAR":2883.0,"uninvoiced":0,"status":"Active"},{"study":"J1G-MC-LAKI","full":"Eli Lilly and Company - J1G-MC-LAKI","invAR":98993.0,"apAR":32318.0,"uninvoiced":4040.0,"status":"Active"},{"study":"J1I-MC-GZBO (TRIUMPH-OUTCOMES)","full":"Eli Lilly and Company - J1I-MC-GZBO (TRIUMPH-OUTCOMES)","invAR":5150.0,"apAR":0.0,"uninvoiced":3950.0,"status":"Active"},{"study":"J1I-MC-GZBY","full":"Eli Lilly and Company - J1I-MC-GZBY","invAR":1700.0,"apAR":0.0,"uninvoiced":3950.0,"status":"Active"},{"study":"J2A-MC-GZGS","full":"Eli Lilly and Company - J2A-MC-GZGS","invAR":5750.0,"apAR":4976.0,"uninvoiced":3950.0,"status":"Active"},{"study":"J2A-MC-GZPO","full":"Eli Lilly and Company - J2A-MC-GZPO","invAR":44853.0,"apAR":47797.0,"uninvoiced":3950.0,"status":"Active"},{"study":"J2A-MC-GZPS","full":"Eli Lilly and Company - J2A-MC-GZPS","invAR":0.0,"apAR":0.0,"uninvoiced":23150.0,"status":"Active"},{"study":"J3F-MC-EZCC","full":"Eli Lilly and Company - J3F-MC-EZCC","invAR":19250.0,"apAR":0.0,"uninvoiced":5950.0,"status":"Active"},{"study":"J3L-MC-EZEF","full":"Eli Lilly and Company - J3L-MC-EZEF","invAR":77371.0,"apAR":63422.0,"uninvoiced":5950.0,"status":"Active"},{"study":"N1T-MC-MALO","full":"Eli Lilly and Company - N1T-MC-MALO","invAR":19975.0,"apAR":12307.0,"uninvoiced":6800.0,"status":"Active"},{"study":"88545223PSA2001","full":"Janssen Pharmaceuticals, Inc. - 88545223PSA2001","invAR":0.0,"apAR":0,"uninvoiced":3000.0,"status":"Active"},{"study":"80202135SJS3001","full":"Janssen Research & Development, LLC - 80202135SJS3001","invAR":5180.0,"apAR":20517.0,"uninvoiced":3000.0,"status":"Active"},{"study":"80202135SLE3001","full":"Janssen Research & Development, LLC - 80202135SLE3001","invAR":0,"apAR":0,"uninvoiced":33000.0,"status":"Active"},{"study":"77242113PSO3006","full":"Johnson & Johnson - 77242113PSO3006","invAR":9000.0,"apAR":31648.0,"uninvoiced":3000.0,"status":"Active"},{"study":"95597528ADM2001","full":"Johnson & Johnson - 95597528ADM2001","invAR":0.0,"apAR":0,"uninvoiced":8250.0,"status":"Active"},{"study":"MR-100A-01-TD-3001","full":"Mylan Inc. - MR-100A-01-TD-3001","invAR":0,"apAR":404.3,"uninvoiced":0,"status":"Active"},{"study":"MR-130A-01-TD-3001","full":"Mylan Inc. - MR-130A-01-TD-3001","invAR":14286.0,"apAR":66264.55,"uninvoiced":4750.0,"status":"Active"},{"study":"C4951063","full":"Pfizer Inc. - C4951063","invAR":0.0,"apAR":16357.23,"uninvoiced":5174.0,"status":"Active"},{"study":"EFC17559","full":"Sanofi US Services Inc. - EFC17559","invAR":12244.0,"apAR":0.0,"uninvoiced":7000.0,"status":"Active"},{"study":"EFC17599","full":"Sanofi US Services Inc. - EFC17599","invAR":1220.0,"apAR":12935.3,"uninvoiced":2500.0,"status":"Active"},{"study":"EFC17600 (ESTUARY)","full":"Sanofi US Services Inc. - EFC17600 (ESTUARY)","invAR":10656.0,"apAR":12424.8,"uninvoiced":2500.0,"status":"Active"},{"study":"EFC18366","full":"Sanofi US Services Inc. - EFC18366","invAR":3000.0,"apAR":0,"uninvoiced":2500.0,"status":"Active"},{"study":"LTS17367","full":"Sanofi US Services Inc. - LTS17367","invAR":1000.0,"apAR":3824.1,"uninvoiced":2500.0,"status":"Active"}];
  document.getElementById('fc30').textContent=fmtK(f30);
  document.getElementById('fc60').textContent=fmtK(f60);
  document.getElementById('fc90').textContent=fmtK(f90);
  const hf=document.getElementById('heroForecast');if(hf)hf.textContent=fmtK(f30+f60+f90);
}

function drawPayChartOverview(){
  const sv=document.getElementById('payChartOverview');if(!sv)return;sv.innerHTML='';
  const mx=Math.max(...MONTHLY_PAYMENTS.map(m=>m.amount))*1.1;const bw=62,pad=50;
  MONTHLY_PAYMENTS.forEach((m,i)=>{const x=pad+i*((950-pad)/MONTHLY_PAYMENTS.length);const h=(m.amount/mx)*230;
    const r=document.createElementNS('http://www.w3.org/2000/svg','rect');r.setAttribute('x',x);r.setAttribute('y',230-h);r.setAttribute('width',bw);r.setAttribute('height',h);r.setAttribute('fill','#14B8A6');r.setAttribute('rx','2');sv.appendChild(r);
    const t=document.createElementNS('http://www.w3.org/2000/svg','text');t.setAttribute('x',x+bw/2);t.setAttribute('y',258);t.setAttribute('text-anchor','middle');t.setAttribute('font-size','12');t.setAttribute('fill','#4A5568');t.textContent=m.month;sv.appendChild(t);
    const v=document.createElementNS('http://www.w3.org/2000/svg','text');v.setAttribute('x',x+bw/2);v.setAttribute('y',230-h-6);v.setAttribute('text-anchor','middle');v.setAttribute('font-size','14');v.setAttribute('font-weight','700');v.setAttribute('fill','#1a202c');v.textContent='$'+(m.amount/1000).toFixed(0)+'K';sv.appendChild(v);
  });
}

// ══════════ INIT ══════════



// ═══ PASSWORD AUTHENTICATION ═══
const FIN_PIN_HASH = CRP_CONFIG.AUTH_HASH;
const FIN_TABS = CRP_CONFIG.TABS.FINANCE;

async function hashPin(pin) {
  const enc = new TextEncoder().encode(pin);
  const buf = await crypto.subtle.digest('SHA-256', enc);
  return Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2,'0')).join('');
}

function isFinanceUnlocked() {
  return sessionStorage.getItem(CRP_CONFIG.AUTH_STORAGE_KEY) === 'true';
}

function showAuthModal(pendingTab) {
  const m = document.getElementById('authModal');
  m.style.display = 'flex';
  m.dataset.pending = pendingTab || '';
  document.getElementById('authPinInput').value = '';
  document.getElementById('authError').style.display = 'none';
  setTimeout(() => document.getElementById('authPinInput').focus(), 100);
}

function closeAuthModal() {
  document.getElementById('authModal').style.display = 'none';
}

async function verifyPin() {
  const pin = document.getElementById('authPinInput').value;
  const hash = await hashPin(pin);
  if (hash === FIN_PIN_HASH) {
    sessionStorage.setItem(CRP_CONFIG.AUTH_STORAGE_KEY, 'true');
    closeAuthModal();
    initFinanceDashboard();
    const pending = document.getElementById('authModal').dataset.pending;
    if (pending) switchTab(pending);
  } else {
    document.getElementById('authError').style.display = 'block';
    document.getElementById('authPinInput').value = '';
    document.getElementById('authPinInput').focus();
  }
}

// ═══ PHI DE-IDENTIFICATION (HIPAA Minimum Necessary) ═══
let PHI_MASKED = true; // default: patient names masked

function maskPHI(fullName) {
  if (!PHI_MASKED) return fullName || '';
  if (!fullName || typeof fullName !== 'string') return '--';
  var parts = fullName.trim().split(/\s+/);
  if (parts.length === 0) return '--';
  if (parts.length === 1) return parts[0].charAt(0).toUpperCase() + '.';
  return parts[0].charAt(0).toUpperCase() + '.' + parts[parts.length-1].charAt(0).toUpperCase() + '.';
}

/**
 * Mask/unmask patient names in pre-rendered (static) HTML tables.
 * Stores original name in data-phi-original, replaces visible text with initials.
 * Targets: Schedule upcoming visits (col 4), cancellation horizon tables,
 * and any table cell with data-phi="patient".
 */
function maskStaticPHI() {
  // Schedule: upcoming-tbody patient column (index 3 = 4th column)
  var tables = [
    { tbody: 'upcoming-tbody', col: 3 }
  ];
  tables.forEach(function(t) {
    var tbody = document.getElementById(t.tbody);
    if (!tbody) return;
    var rows = tbody.querySelectorAll('tr');
    rows.forEach(function(row) {
      var cell = row.cells[t.col];
      if (!cell) return;
      // Find the <a> tag or use cell directly
      var link = cell.querySelector('a');
      var target = link || cell;
      // Store original name on first call
      if (!target.dataset.phiOriginal) {
        // Extract just the text (not SVG)
        var txt = '';
        target.childNodes.forEach(function(n) { if (n.nodeType === 3) txt += n.textContent; });
        target.dataset.phiOriginal = txt.trim();
      }
      var orig = target.dataset.phiOriginal;
      if (PHI_MASKED) {
        // Replace text nodes with masked version
        var masked = maskPHI(orig);
        target.childNodes.forEach(function(n) { if (n.nodeType === 3) n.textContent = ''; });
        if (target.firstChild && target.firstChild.nodeType === 3) {
          target.firstChild.textContent = masked;
        } else {
          target.insertBefore(document.createTextNode(masked), target.firstChild);
        }
      } else {
        // Restore original
        target.childNodes.forEach(function(n) { if (n.nodeType === 3) n.textContent = ''; });
        if (target.firstChild && target.firstChild.nodeType === 3) {
          target.firstChild.textContent = orig;
        } else {
          target.insertBefore(document.createTextNode(orig), target.firstChild);
        }
      }
    });
  });
  // Also handle any element with data-phi="patient"
  document.querySelectorAll('[data-phi="patient"]').forEach(function(el) {
    if (!el.dataset.phiOriginal) el.dataset.phiOriginal = el.textContent.trim();
    el.textContent = PHI_MASKED ? maskPHI(el.dataset.phiOriginal) : el.dataset.phiOriginal;
  });
}

// Backfill investigator names from DATA.allVisitDetail into pre-rendered Schedule table
function backfillInvestigators() {
  var tbody = document.getElementById('upcoming-tbody');
  if (!tbody || !DATA || !DATA.allVisitDetail || !DATA.allVisitDetail.length) return;
  // Build lookup: "date|study" -> investigator
  var invMap = {};
  DATA.allVisitDetail.forEach(function(v) {
    if (!v.investigator) return;
    var key = (v.date||'') + '|' + (v.study||'');
    invMap[key] = v.investigator;
    // Also map by patient for more precise matching
    var key2 = (v.date||'') + '|' + (v.patient||'').toLowerCase().trim();
    invMap[key2] = v.investigator;
  });
  var rows = tbody.querySelectorAll('tr');
  rows.forEach(function(row) {
    if (row.cells.length < 7) return;
    var dateCell = row.cells[0], studyCell = row.cells[1], patientCell = row.cells[3], invCell = row.cells[6];
    // Only backfill if cell is empty or shows —
    if (invCell.textContent.trim() !== '—' && invCell.textContent.trim() !== '') return;
    var dateText = (dateCell.textContent||'').trim();
    var studyText = (studyCell.textContent||'').trim();
    // Get original patient name (may be masked)
    var patientText = patientCell.dataset && patientCell.dataset.phiOriginal ? patientCell.dataset.phiOriginal : '';
    if (!patientText) {
      var link = patientCell.querySelector('a');
      patientText = link ? (link.dataset.phiOriginal || link.textContent) : patientCell.textContent;
    }
    var inv = invMap[dateText + '|' + studyText] || invMap[dateText + '|' + (patientText||'').toLowerCase().trim()];
    if (inv) {
      invCell.textContent = inv;
      invCell.style.color = '#7c3aed';
      invCell.style.fontSize = '11px';
    }
  });
}

function togglePHIMask() {
  PHI_MASKED = !PHI_MASKED;
  var btn = document.getElementById('phi-toggle-btn');
  if (btn) {
    btn.innerHTML = PHI_MASKED ? '&#x1f512; PHI Masked' : '&#x1f513; PHI Visible';
    btn.title = PHI_MASKED ? 'Click to reveal patient names' : 'Click to mask patient names';
    btn.style.background = PHI_MASKED ? '#059669' : '#dc2626';
  }
  // Re-render dynamic views
  try { if (typeof renderAll === 'function') renderAll(); } catch(e) {}
  try { if (typeof renderStudiesTable === 'function') renderStudiesTable(); } catch(e) {}
  try { if (typeof renderReferralDashboard === 'function' && _referralsLoaded) renderReferralDashboard(); } catch(e) {}
  // Mask/unmask pre-rendered static tables
  try { maskStaticPHI(); } catch(e) { console.warn('maskStaticPHI:', e); }
}

let finInitDone = false;
function initFinanceDashboard() {
  if (finInitDone) return;
  finInitDone = true;
  // Overview: alerts, forecast, charts, AR studies
  try { renderAlerts(); } catch(e) { console.warn('renderAlerts:', e); }
  try { renderForecast(); } catch(e) { console.warn('renderForecast:', e); }
  try { drawRevChart(); } catch(e) { console.warn('drawRevChart:', e); }
  try { drawPayChart(); } catch(e) { console.warn('drawPayChart:', e); }
  try { drawPayChartOverview(); } catch(e) { console.warn('drawPayChartOverview:', e); }
  try { renderARStudies(); } catch(e) { console.warn('renderARStudies:', e); }
  // Aging
  try { renderAgingKPIs(); } catch(e) { console.warn('renderAgingKPIs:', e); }
  try { renderAgingTables(); } catch(e) { console.warn('renderAgingTables:', e); }
  // Revenue (enhanced)
  try { renderRevenueTab(); } catch(e) { console.warn('renderRevenueTab:', e); }
  // Accruals (enhanced)
  try { renderAccruals(); } catch(e) { console.warn('renderAccruals:', e); }
  // Studies
  try { renderStudies(); } catch(e) { console.warn('renderStudies:', e); }
  // Collections
  try { initColl(); renderCollections(); } catch(e) { console.warn('collections:', e); }
  // Emit lifecycle event for plugins
  CRP.emit('financeLoaded', { arrays: ['AGING_INV','AGING_AP','UNPAID_INVOICES','UNPAID_AP','UNINVOICED','MONTHLY_PAYMENTS','MONTHLY_REVENUE','TOP_AR_STUDIES'] });
  console.log('CRP: Finance dashboard initialized');
}

// ═══ UNIFIED TAB SWITCHER (wraps perf switchView + finance gating) ═══
function switchTab(name, el) {
  // Performance tabs → delegate to switchView (handles lazy building)
  const PERF_TABS = ['overview','studies','schedule','actions','referrals','admin'];
  if (PERF_TABS.includes(name)) {
    // Hide finance+insights views first
    document.querySelectorAll('[id^="view-fin-"], #view-insights').forEach(v => {
      v.style.display = 'none';
      v.classList.remove('active');
    });
    // Deactivate finance tab highlights
    document.querySelectorAll('.nav-tab.fin-tab').forEach(t => t.classList.remove('active'));
    // Delegate to performance's switchView
    switchView(name, el);
    return;
  }

  // Finance tabs require auth
  if (FIN_TABS.includes(name) && !isFinanceUnlocked()) {
    showAuthModal(name);
    return;
  }

  // Hide ALL views
  document.querySelectorAll('.view, [id^="view-"]').forEach(v => {
    v.style.display = 'none';
    v.classList.remove('active');
  });

  // Deactivate all tabs, activate current
  document.querySelectorAll('.nav-tab').forEach(t => {
    t.classList.remove('active');
    t.setAttribute('aria-selected', 'false');
  });
  if (el) {
    el.classList.add('active');
    el.setAttribute('aria-selected', 'true');
  }

  // Show target view
  const viewId = 'view-' + name;
  const view = document.getElementById(viewId);
  if (view) {
    view.style.display = 'block';
    view.classList.add('active');
  } else {
    console.warn('switchTab: view not found:', viewId);
  }

  // Finance init on first access
  if (FIN_TABS.includes(name) && !finInitDone) {
    initFinanceDashboard();
  }

  // Insights rendering
  if (name === 'insights') {
    setTimeout(() => {
      if (typeof renderInsights === 'function') renderInsights();
    }, 50);
  }
}

// ═══ COMPREHENSIVE INSIGHTS ═══
function renderInsights() {
  const totalStudies = FIN_MERGED_STUDIES.length;
  const el = (id) => document.getElementById(id);
  if (el('ins-studies')) el('ins-studies').textContent = totalStudies;

  const totalCollected = MONTHLY_PAYMENTS.reduce((s,m) => s+m.amount, 0);
  const totalBilled = totalCollected + totalInvAR + totalApAR;
  const efficiency = ((totalCollected / totalBilled) * 100).toFixed(0);
  if (el('ins-collect-eff')) el('ins-collect-eff').textContent = efficiency + '%';

  const highAgingAR = AGING_INV.reduce((s,r) => s + r.d91_120 + r.d121_150 + r.d150plus, 0) +
                      AGING_AP.reduce((s,r) => s + r.d91_120 + r.d121_150 + r.d150plus, 0);
  if (el('ins-rev-risk')) el('ins-rev-risk').textContent = '$' + (highAgingAR/1000).toFixed(0) + 'K';

  const cancelRate = (DATA && DATA.cancelTotal && DATA.upcomingTotal)
    ? Math.round(DATA.cancelTotal / (DATA.cancelTotal + DATA.upcomingTotal) * 100) : null;
  if (el('ins-cancel-rate')) el('ins-cancel-rate').textContent = cancelRate !== null ? cancelRate + '%' : '--';

  // Build cross-referenced study data
  const crossMap = {};
  TOP_AR_STUDIES.forEach(s => {
    const code = pid(s.study) || s.study;
    crossMap[code] = { name:s.study, code, invAR:s.invAR, apAR:s.apAR, totalAR:s.total, collected:s.collected, cancels:0, upcoming:0 };
  });
  FIN_MERGED_STUDIES.forEach(m => {
    if (crossMap[m.study]) { crossMap[m.study].status = m.status; crossMap[m.study].enrolled = m.enrolled; }
    else { crossMap[m.study] = { name:m.study, code:m.study, status:m.status, enrolled:m.enrolled, totalAR:0, collected:0, cancels:0, upcoming:0 }; }
  });
  if (typeof DATA !== 'undefined') {
    (DATA.cancelByStudy || []).forEach(c => {
      const code = c.code || c.name || c.study || c.full || '';
      Object.keys(crossMap).forEach(k => { if (code && (k===code || crossMap[k].name.includes(code) || code.includes(k))) crossMap[k].cancels = (crossMap[k].cancels||0) + c.count; });
    });
    (DATA.upcomingByStudyFull || DATA.upcomingByStudy || []).forEach(u => {
      const code = u.code || u.name;
      Object.keys(crossMap).forEach(k => { if (code && (k===code || crossMap[k].name.includes(code) || code.includes(k))) crossMap[k].upcoming = (crossMap[k].upcoming||0) + u.count; });
    });
  }

  // Financial Risk Matrix
  const riskBody = el('insightRiskBody');
  if (riskBody) {
    const studies = Object.values(crossMap).filter(s => s.totalAR > 0).sort((a,b) => b.totalAR - a.totalAR);
    riskBody.innerHTML = studies.map(s => {
      const pct = s.collected > 0 ? ((s.collected/(s.collected+s.totalAR))*100).toFixed(0) : '0';
      let risk='Low',rc='risk-low';
      const hc=s.cancels>=10, lc=parseInt(pct)<50, ha=s.totalAR>50000;
      if(ha&&lc&&hc){risk='Critical';rc='risk-critical';}
      else if((ha&&lc)||(ha&&hc)){risk='High';rc='risk-high';}
      else if(ha||hc||lc){risk='Medium';rc='risk-medium';}
      const st=s.status||'--';
      const sc=st==='Enrolling'?'badge-green':st==='Maintenance'?'badge-yellow':'badge-gray';
      const link=CRIO_LINKS[s.code]?'<a href="'+CRIO_LINKS[s.code]+'" target="_blank" style="color:inherit;text-decoration:underline dotted">'+s.name+'</a>':s.name;
      const safe=s.name.replace(/'/g,'&#39;');
      return '<tr class="clickable" onclick="showStudyModal(\''+safe+'\')"><td>'+link+'</td><td><span class="badge '+sc+'">'+st+'</span></td><td class="r">'+(s.cancels||'--')+'</td><td class="r">'+(s.upcoming||'--')+'</td><td class="r">$'+(s.totalAR/1000).toFixed(0)+'K</td><td class="r">'+pct+'%</td><td><span class="risk-tag '+rc+'">'+risk+'</span></td></tr>';
    }).join('');
  }

  // Revenue Impact of Cancellations
  const cancelRevEl = el('ins-cancel-revenue');
  if (cancelRevEl) {
    const cancelStudies = Object.values(crossMap).filter(s=>s.cancels>0).sort((a,b)=>b.cancels-a.cancels);
    let totalLostEst=0, html='<div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(280px,1fr));gap:12px;margin-bottom:16px">';
    cancelStudies.slice(0,8).forEach(s=>{
      const rev12=STUDY_REVENUE_12M[s.code]||0;
      const enrolled=s.enrolled||1;
      const avgVR=enrolled>0&&rev12>0?Math.round(rev12/(enrolled*12)):0;
      const lost=s.cancels*avgVR;
      totalLostEst+=lost;
      const link=CRIO_LINKS[s.code]?'<a href="'+CRIO_LINKS[s.code]+'" target="_blank" style="color:inherit;text-decoration:underline dotted">'+s.code+'</a>':s.code;
      html+='<div style="background:#FEF2F2;border-radius:8px;padding:12px;border-left:3px solid #EF4444"><div style="font-weight:700;font-size:13px">'+link+'</div><div style="font-size:12px;color:#718096;margin-top:4px">'+s.cancels+' cancellations · '+s.upcoming+' upcoming</div><div style="font-size:14px;font-weight:700;color:#EF4444;margin-top:6px">~$'+(lost/1000).toFixed(0)+'K est. revenue impact</div></div>';
    });
    html+='</div>';
    if(cancelStudies.length>0) html+='<div style="background:linear-gradient(135deg,#1e3a5f,#2d5a87);color:white;border-radius:10px;padding:16px;text-align:center"><div style="font-size:12px;opacity:0.8">Total Estimated Revenue at Risk from Cancellations</div><div style="font-size:28px;font-weight:800;margin-top:4px">$'+(totalLostEst/1000).toFixed(0)+'K</div></div>';
    else html='<div style="color:#718096;font-size:13px;padding:12px">Connect Google Sheets to see cancellation revenue impact</div>';
    cancelRevEl.innerHTML=html;
  }

  // ═══ CANCELLATION ROOT CAUSE PLAYBOOK ═══
  const playbookEl = el('ins-cancel-playbook');
  if (playbookEl && typeof DATA !== 'undefined' && DATA.cancelReasons) {
    const reasons = DATA.cancelReasons || [];
    const totalCancels = reasons.reduce((s,r) => s + r.count, 0);

    const PLAYBOOK = {
      'No Show': {
        icon: '🚫', color: '#DC2626', bg: '#FEF2F2', border: '#FECACA',
        impact: 'Lost visit revenue, wasted coordinator time, disrupts study timelines',
        nextSteps: [
          'Call patient within 2 hours of missed appointment — document attempt in CRIO',
          'If unreachable after 3 attempts across 48hrs, escalate to site director',
          'For repeat no-shows (2+): schedule a retention call with coordinator before next visit',
          'Implement 48hr + 24hr + same-day reminder texts for all upcoming visits',
          'Flag chronic no-show patients in CRIO for proactive outreach'
        ]
      },
      'Screen Fail / DNQ': {
        icon: '🔍', color: '#C2410C', bg: '#FFF7ED', border: '#FED7AA',
        impact: 'Wasted screening resources, indicates pre-screening gaps',
        nextSteps: [
          'Review the pre-screening checklist for each study with screen fails',
          'Add specific eligibility questions to the initial phone screen (BMI, meds, conditions)',
          'Track screen fail reasons by study to identify recurring protocol gaps',
          'Update recruitment materials to better communicate eligibility requirements',
          'Hold bi-weekly pre-screener review with recruitment team'
        ]
      },
      'Screen Fail/DNQ': {
        icon: '🔍', color: '#C2410C', bg: '#FFF7ED', border: '#FED7AA',
        impact: 'Wasted screening resources, indicates pre-screening gaps',
        nextSteps: [
          'Review the pre-screening checklist for each study with screen fails',
          'Add specific eligibility questions to the initial phone screen (BMI, meds, conditions)',
          'Track screen fail reasons by study to identify recurring protocol gaps',
          'Update recruitment materials to better communicate eligibility requirements',
          'Hold bi-weekly pre-screener review with recruitment team'
        ]
      },
      'Patient Withdrew': {
        icon: '🚪', color: '#7C3AED', bg: '#F5F3FF', border: '#DDD6FE',
        impact: 'Permanent loss of enrolled patient, impacts enrollment targets',
        nextSteps: [
          'Conduct exit interview within 48hrs — understand root cause (comfort, travel, compensation)',
          'For privacy concerns: review consent process, ensure clear communication of data protections',
          'For compensation issues: escalate to sponsor if visit burden is disproportionate',
          'Document withdrawal reason in CRIO for sponsor reporting',
          'Review if retention support (travel reimbursement, flexible scheduling) could have helped'
        ]
      },
      'Weather': {
        icon: '🌧️', color: '#0369A1', bg: '#F0F9FF', border: '#BAE6FD',
        impact: 'Temporary disruption, patients generally willing to reschedule',
        nextSteps: [
          'Proactively reschedule within 48hrs of weather event',
          'Maintain a weather backup protocol: pre-identify flexible reschedule windows',
          'Send proactive cancellation notices before severe weather to show patient care',
          'No coordinator accountability — track separately from preventable cancellations'
        ]
      },
      'Not Documented': {
        icon: '📝', color: '#92400E', bg: '#FEF3C7', border: '#FDE68A',
        impact: 'Cannot analyze root cause, skews all reporting and risk scoring',
        nextSteps: [
          'URGENT: Each coordinator must log into CRIO and add the cancellation reason today',
          'Implement a same-day documentation requirement: reason must be logged within 4 hours of cancellation',
          'Add cancellation reason as a required field in the CRIO workflow',
          'Review undocumented cancellations in weekly team huddle'
        ]
      },
      'Other': {
        icon: '📋', color: '#475569', bg: '#F8FAFC', border: '#E2E8F0',
        impact: 'Unclassified — may contain patterns worth isolating',
        nextSteps: [
          'Review all "Other" cancellations monthly to identify emerging patterns',
          'If 3+ cancellations share a similar reason, create a new tracking category',
          'Ensure coordinators are using the correct cancellation categories in CRIO',
          'Discuss recurring "Other" reasons in monthly ops review'
        ]
      },
      'Discontinued': {
        icon: '⏹️', color: '#991B1B', bg: '#FEF2F2', border: '#FECACA',
        impact: 'Patient permanently removed from study per protocol or medical decision',
        nextSteps: [
          'Verify discontinuation was per protocol criteria and properly documented',
          'Complete all required discontinuation visit procedures and forms',
          'Notify sponsor per protocol timelines',
          'Archive patient record in CRIO with proper discontinuation coding'
        ]
      },
      'No Response': {
        icon: '📵', color: '#B45309', bg: '#FFFBEB', border: '#FDE68A',
        impact: 'Patient engagement lost — at risk of becoming a no-show or withdrawal',
        nextSteps: [
          'Attempt contact via all available channels (phone, text, email, alternate contact)',
          'If no response after 5 business days and 3+ attempts: flag as Lost to Follow-Up',
          'Document all outreach attempts with timestamps in CRIO',
          'Consider sending a certified letter as a final attempt before marking inactive'
        ]
      }
    };

    let pbHtml = '<div style="margin-bottom:12px;font-size:12px;color:#64748b">Based on <strong>' + totalCancels + ' true cancellations</strong> in the last 2 months. Rescheduled, completed, admin errors, and study closures are excluded from these counts.</div>';
    pbHtml += '<div style="display:flex;flex-direction:column;gap:12px">';

    reasons.forEach(r => {
      const pb = PLAYBOOK[r.reason];
      if (!pb) return;
      const pct = totalCancels > 0 ? Math.round(r.count / totalCancels * 100) : 0;
      pbHtml += '<div style="background:' + pb.bg + ';border:1px solid ' + pb.border + ';border-radius:10px;padding:16px;border-left:4px solid ' + pb.color + '">';
      pbHtml += '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:10px">';
      pbHtml += '<div style="display:flex;align-items:center;gap:8px"><span style="font-size:20px">' + pb.icon + '</span><span style="font-weight:700;font-size:14px;color:' + pb.color + '">' + r.reason + '</span></div>';
      pbHtml += '<div style="display:flex;gap:8px;align-items:center"><span style="background:' + pb.color + ';color:white;padding:3px 10px;border-radius:12px;font-size:12px;font-weight:700">' + r.count + ' (' + pct + '%)</span></div>';
      pbHtml += '</div>';
      pbHtml += '<div style="font-size:11px;color:#64748b;margin-bottom:8px;font-style:italic">Impact: ' + pb.impact + '</div>';
      pbHtml += '<div style="font-size:12px;font-weight:700;color:#334155;margin-bottom:6px">Next Steps:</div>';
      pbHtml += '<div style="display:flex;flex-direction:column;gap:4px">';
      pb.nextSteps.forEach((step, i) => {
        pbHtml += '<div style="display:flex;gap:8px;align-items:flex-start;font-size:12px;color:#475569;padding:4px 0"><span style="font-weight:700;color:' + pb.color + ';min-width:16px">' + (i+1) + '.</span><span>' + step + '</span></div>';
      });
      pbHtml += '</div></div>';
    });

    pbHtml += '</div>';
    playbookEl.innerHTML = pbHtml;
  }

  // AR Aging vs Enrollment
  const agingByStudy={};
  AGING_INV.forEach(a=>{const c=pid(a.study)||a.study;agingByStudy[c]={invCurrent:a.current,inv30:a.d30_60,inv60:a.d61_90,inv90:a.d91_120+a.d121_150+a.d150plus};});
  AGING_AP.forEach(a=>{const c=pid(a.study)||a.study;if(!agingByStudy[c])agingByStudy[c]={};agingByStudy[c].apCurrent=a.current;agingByStudy[c].ap30=a.d30_60;agingByStudy[c].ap60=a.d61_90;agingByStudy[c].ap90=(a.d91_120||0)+(a.d121_150||0)+(a.d150plus||0);});
  const agingOpsBody=el('insAgingOpsBody');
  if(agingOpsBody){
    const rows=[];
    Object.keys(agingByStudy).forEach(code=>{
      const ag=agingByStudy[code];
      const cur=(ag.invCurrent||0)+(ag.apCurrent||0)+(ag.inv30||0)+(ag.ap30||0)+(ag.inv60||0)+(ag.ap60||0);
      const over=(ag.inv90||0)+(ag.ap90||0);
      const tot=cur+over;if(tot<1000)return;
      const pct=tot>0?Math.round(over/tot*100):0;
      const ms=crossMap[code]||{};const st=ms.status||'--';const en=ms.enrolled||'--';
      let alert='',ac='';
      if(pct>60&&st==='Enrolling'){alert='Double Risk';ac='risk-critical';}
      else if(pct>60){alert='Collection Crisis';ac='risk-high';}
      else if(pct>40){alert='Watch';ac='risk-medium';}
      else{alert='OK';ac='risk-low';}
      const nm=ms.name||code;
      const link=CRIO_LINKS[code]?'<a href="'+CRIO_LINKS[code]+'" target="_blank" style="color:inherit;text-decoration:underline dotted">'+nm+'</a>':nm;
      rows.push({pct,html:'<tr class="clickable" onclick="showStudyModal(\''+code.replace(/'/g,"\\'")+'\')"><td>'+link+'</td><td><span class="badge '+(st==='Enrolling'?'badge-green':st==='Maintenance'?'badge-yellow':'badge-gray')+'">'+en+' enrolled</span></td><td class="r">$'+(cur/1000).toFixed(0)+'K</td><td class="r" style="color:'+(pct>40?'#EF4444':'inherit')+'">$'+(over/1000).toFixed(0)+'K</td><td class="r" style="font-weight:700;color:'+(pct>60?'#dc2626':pct>40?'#F59E0B':'#10B981')+'">'+pct+'%</td><td><span class="risk-tag '+ac+'">'+alert+'</span></td></tr>'});
    });
    rows.sort((a,b)=>b.pct-a.pct);
    agingOpsBody.innerHTML=rows.map(r=>r.html).join('');
  }

  // 90-Day Forecast
  const forecastEl=el('ins-forecast');
  if(forecastEl){
    const buckets=[
      {l:'Current (<30d)',r:BUCKET_COLLECT_RATES.current,inv:AGING_INV.reduce((s,r)=>s+r.current,0),ap:AGING_AP.reduce((s,r)=>s+r.current,0)},
      {l:'30-60d',r:BUCKET_COLLECT_RATES.d30_60,inv:AGING_INV.reduce((s,r)=>s+r.d30_60,0),ap:AGING_AP.reduce((s,r)=>s+r.d30_60,0)},
      {l:'61-90d',r:BUCKET_COLLECT_RATES.d61_90,inv:AGING_INV.reduce((s,r)=>s+r.d61_90,0),ap:AGING_AP.reduce((s,r)=>s+r.d61_90,0)},
      {l:'91-120d',r:BUCKET_COLLECT_RATES.d91_120,inv:AGING_INV.reduce((s,r)=>s+r.d91_120,0),ap:AGING_AP.reduce((s,r)=>s+r.d91_120,0)},
      {l:'121-150d',r:BUCKET_COLLECT_RATES.d121_150,inv:AGING_INV.reduce((s,r)=>s+r.d121_150,0),ap:AGING_AP.reduce((s,r)=>s+r.d121_150,0)},
      {l:'150+',r:BUCKET_COLLECT_RATES.d150plus,inv:AGING_INV.reduce((s,r)=>s+r.d150plus,0),ap:AGING_AP.reduce((s,r)=>s+r.d150plus,0)}
    ];
    let totExp=0,totOut=0;
    let html='<table class="tbl"><thead><tr><th>Bucket</th><th class="r">Outstanding</th><th class="r">Rate</th><th class="r">Expected</th></tr></thead><tbody>';
    buckets.forEach(b=>{const t=b.inv+b.ap;const e=t*b.r;totExp+=e;totOut+=t;html+='<tr><td>'+b.l+'</td><td class="r">$'+(t/1000).toFixed(0)+'K</td><td class="r">'+(b.r*100).toFixed(0)+'%</td><td class="r" style="color:#10B981;font-weight:600">$'+(e/1000).toFixed(0)+'K</td></tr>';});
    html+='</tbody></table>';
    const rp=MONTHLY_PAYMENTS.slice(0,6);const avgM=rp.reduce((s,m)=>s+m.amount,0)/rp.length;
    html+='<div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:12px;margin-top:16px"><div style="background:#F0FDF4;border-radius:8px;padding:14px;text-align:center"><div style="font-size:11px;color:#718096">Expected 90-Day Recovery</div><div style="font-size:22px;font-weight:800;color:#10B981;margin-top:4px">$'+(totExp/1000).toFixed(0)+'K</div></div><div style="background:#EFF6FF;border-radius:8px;padding:14px;text-align:center"><div style="font-size:11px;color:#718096">Avg Monthly Collections</div><div style="font-size:22px;font-weight:800;color:#2d5a87;margin-top:4px">$'+(avgM/1000).toFixed(0)+'K</div></div><div style="background:'+(totExp<avgM*3?'#FEF2F2':'#F0FDF4')+';border-radius:8px;padding:14px;text-align:center"><div style="font-size:11px;color:#718096">Projected vs. Trend</div><div style="font-size:22px;font-weight:800;color:'+(totExp<avgM*3?'#EF4444':'#10B981')+';margin-top:4px">'+(totExp>=avgM*3?'+':'')+'$'+((totExp-avgM*3)/1000).toFixed(0)+'K</div></div></div>';
    forecastEl.innerHTML=html;
  }

  // ═══ WIRE UP INSIGHTS DRILL-DOWN ═══
  // Studies Tracked → show all studies
  const insStudies = el('ins-studies');
  if (insStudies) {
    insStudies.style.cursor = 'pointer';
    insStudies.title = 'Click for study breakdown';
    insStudies.onclick = () => {
      let h='<table class="tbl"><thead><tr><th>Study</th><th>Status</th><th class="r">Enrolled</th><th class="r">Revenue</th><th class="r">Open AR</th></tr></thead><tbody>';
      FIN_MERGED_STUDIES.forEach(r=>{
        const rev=STUDY_REVENUE_12M[r.study]||0;
        const ar=TOP_AR_STUDIES.find(x=>x.study.includes(r.study));
        h+='<tr><td>'+slink(r.study)+'</td><td><span class="badge '+(r.status==='Enrolling'?'badge-green':'badge-yellow')+'">'+r.status+'</span></td><td class="r">'+r.enrolled+'</td><td class="r">'+fmt(rev)+'</td><td class="r">'+(ar?fmt(ar.total):'--')+'</td></tr>';
      });
      h+='</tbody></table>';
      showFinModal('All Tracked Studies ('+FIN_MERGED_STUDIES.length+')',h);
    };
  }

  // Revenue at Risk → show high-aging studies
  const insRisk = el('ins-rev-risk');
  if (insRisk) {
    insRisk.style.cursor = 'pointer';
    insRisk.title = 'Click for risk breakdown';
    insRisk.onclick = () => {
      let h='<table class="tbl"><thead><tr><th>Study</th><th class="r">91-120d</th><th class="r">121-150d</th><th class="r">&gt;150d</th><th class="r">Total at Risk</th></tr></thead><tbody>';
      let gt=0;
      [...AGING_INV,...AGING_AP].sort((a,b)=>(b.d91_120+b.d121_150+b.d150plus)-(a.d91_120+a.d121_150+a.d150plus)).forEach(r=>{
        const risk=r.d91_120+r.d121_150+r.d150plus;if(risk<100)return;gt+=risk;
        h+='<tr><td>'+slink(r.study)+'</td><td class="r">'+fmt(r.d91_120)+'</td><td class="r">'+fmt(r.d121_150)+'</td><td class="r">'+fmt(r.d150plus)+'</td><td class="r" style="font-weight:700;color:#EF4444">'+fmt(risk)+'</td></tr>';
      });
      h+='<tr class="total-row"><td>TOTAL</td><td></td><td></td><td></td><td class="r">'+fmt(gt)+'</td></tr></tbody></table>';
      showFinModal('Revenue at Risk — AR Over 90 Days',h);
    };
  }

  // Collection Efficiency → show monthly trend
  const insEff = el('ins-collect-eff');
  if (insEff) {
    insEff.style.cursor = 'pointer';
    insEff.title = 'Click for collection trend';
    insEff.onclick = () => {
      let h='<table class="tbl"><thead><tr><th>Month</th><th class="r">Collections</th><th class="r">Revenue</th><th class="r">Efficiency</th></tr></thead><tbody>';
      MONTHLY_PAYMENTS.forEach((p,i)=>{
        const r=MONTHLY_REVENUE[i];const rv=r?(r.invoicables+r.autopay):0;const eff=rv>0?((p.amount/rv)*100).toFixed(0):'--';
        h+='<tr><td>'+p.month+'</td><td class="r">'+fmt(p.amount)+'</td><td class="r">'+(rv?fmt(rv):'--')+'</td><td class="r" style="color:'+(parseInt(eff)>80?'#10B981':parseInt(eff)>50?'#F59E0B':'#EF4444')+'">'+eff+'%</td></tr>';
      });
      h+='</tbody></table>';
      showFinModal('Collection Efficiency — Monthly Trend',h);
    };
  }

  // Cancel Rate → show cancels by study (if live data available)
  const insCancelRate = el('ins-cancel-rate');
  if (insCancelRate && typeof DATA !== 'undefined' && DATA.cancelByStudy) {
    insCancelRate.style.cursor = 'pointer';
    insCancelRate.title = 'Click for cancellation breakdown';
    insCancelRate.onclick = () => {
      if (typeof showCancels === 'function') showCancels(null, 'All Cancellations');
      else {
        let h='<table class="tbl"><thead><tr><th>Study</th><th class="r">Cancellations</th></tr></thead><tbody>';
        (DATA.cancelByStudy||[]).sort((a,b)=>b.count-a.count).forEach(s=>{
          h+='<tr><td>'+slink(s.name||s.study||s.code||s.full)+'</td><td class="r">'+s.count+'</td></tr>';
        });
        h+='</tbody></table>';
        showFinModal('Cancellations by Study',h);
      }
    };
  }

  // Make Insights Risk Matrix rows clickable
  if (riskBody) {
    riskBody.querySelectorAll('tr').forEach(tr => {
      tr.style.cursor = 'pointer';
      tr.classList.add('clickable');
    });
  }

  // ═══ WHAT TO DO NEXT — Actionable Recommendations ═══
  const nextEl = el('ins-next-steps');
  if (nextEl) {
    const actions = [];
    const icon = (emoji, bg) => '<div style="min-width:36px;height:36px;border-radius:50%;background:'+bg+';display:flex;align-items:center;justify-content:center;font-size:16px">'+emoji+'</div>';

    // 1. Zero-collection studies
    const zeroCollStudies = TOP_AR_STUDIES.filter(s => s.collected === 0 && s.total > 5000);
    if (zeroCollStudies.length) {
      actions.push({
        priority: 1,
        html: '<div style="display:flex;gap:12px;align-items:flex-start;padding:14px;background:#FEF2F2;border-radius:10px;border-left:4px solid #EF4444">'+icon('🚨','#FEE2E2')+'<div><div style="font-weight:700;font-size:13px;color:#991B1B">URGENT: '+zeroCollStudies.length+' studies with $0 collections</div><div style="font-size:12px;color:#6B7280;margin-top:4px">'+zeroCollStudies.map(s=>'<span style="cursor:pointer;text-decoration:underline" onclick="showStudyModal(\''+s.study.replace(/'/g,'&#39;')+'\')">'+s.study.split(' - ').pop()+'</span>').join(', ')+'</div><div style="font-size:12px;font-weight:600;color:#DC2626;margin-top:6px">→ Contact sponsor billing for each study this week. Verify invoice delivery.</div></div></div>'
      });
    }

    // 2. High-aging invoices (>365 days)
    const oldInv = UNPAID_INVOICES.filter(i => i.days >= 365);
    if (oldInv.length) {
      actions.push({
        priority: 2,
        html: '<div style="display:flex;gap:12px;align-items:flex-start;padding:14px;background:#FEF3C7;border-radius:10px;border-left:4px solid #F59E0B">'+icon('⏰','#FEF3C7')+'<div><div style="font-weight:700;font-size:13px;color:#92400E">'+oldInv.length+' invoices over 1 year old ($'+fmt(oldInv.reduce((s,i)=>s+Math.abs(i.unpaid),0))+')</div><div style="font-size:12px;color:#6B7280;margin-top:4px">Oldest: '+oldInv.sort((a,b)=>b.days-a.days)[0].days+' days overdue</div><div style="font-size:12px;font-weight:600;color:#D97706;margin-top:6px">→ Escalate to site director. Consider formal collection process or write-off review.</div></div></div>'
      });
    }

    // 3. Risk patients needing calls (from live data)
    if (typeof DATA !== 'undefined' && DATA.riskFlags && DATA.riskFlags.length) {
      const urgent = DATA.riskFlags.filter(r => {
        const d = new Date(r.next_visit);
        return (d - new Date()) / 86400000 <= 14;
      });
      if (urgent.length) {
        actions.push({
          priority: 1,
          html: '<div style="display:flex;gap:12px;align-items:flex-start;padding:14px;background:#FEF2F2;border-radius:10px;border-left:4px solid #EF4444">'+icon('📞','#FEE2E2')+'<div><div style="font-weight:700;font-size:13px;color:#991B1B">'+urgent.length+' at-risk patients with visits in next 14 days</div><div style="font-size:12px;color:#6B7280;margin-top:4px">'+urgent.map(r=>r.patient_name||'Patient').join(', ')+'</div><div style="font-size:12px;font-weight:600;color:#DC2626;margin-top:6px">→ Personal calls within 48 hours. Confirm attendance and address concerns. Document in CTMS.</div></div></div>'
        });
      }
    }

    // 4. Studies with high cancel rates
    const highCancel = Object.values(crossMap).filter(s => s.cancels >= 10 && s.upcoming > 0).sort((a,b) => b.cancels - a.cancels);
    if (highCancel.length) {
      actions.push({
        priority: 3,
        html: '<div style="display:flex;gap:12px;align-items:flex-start;padding:14px;background:#EFF6FF;border-radius:10px;border-left:4px solid #3B82F6">'+icon('📊','#DBEAFE')+'<div><div style="font-weight:700;font-size:13px;color:#1E40AF">'+highCancel.length+' studies with 10+ cancellations need retention review</div><div style="font-size:12px;color:#6B7280;margin-top:4px">'+highCancel.slice(0,5).map(s=>s.code+' ('+s.cancels+' cancels)').join(', ')+'</div><div style="font-size:12px;font-weight:600;color:#2563EB;margin-top:6px">→ Schedule root cause analysis meeting. Review coordinator assignments and patient communication protocols.</div></div></div>'
      });
    }

    // 5. Collection efficiency below target
    if (parseInt(efficiency) < 70) {
      actions.push({
        priority: 2,
        html: '<div style="display:flex;gap:12px;align-items:flex-start;padding:14px;background:#FEF3C7;border-radius:10px;border-left:4px solid #F59E0B">'+icon('💰','#FEF3C7')+'<div><div style="font-weight:700;font-size:13px;color:#92400E">Collection efficiency at '+efficiency+'% — below 70% target</div><div style="font-size:12px;color:#6B7280;margin-top:4px">Gap: $'+fmt(totalBilled * 0.7 - totalCollected)+' needed to reach target</div><div style="font-size:12px;font-weight:600;color:#D97706;margin-top:6px">→ Prioritize top 5 studies by AR balance. Send payment reminders for invoices 60+ days.</div></div></div>'
      });
    }

    // 6. Positive: strong enrollment momentum
    const enrolling = FIN_MERGED_STUDIES.filter(s => s.status === 'Enrolling');
    if (enrolling.length >= 10) {
      actions.push({
        priority: 5,
        html: '<div style="display:flex;gap:12px;align-items:flex-start;padding:14px;background:#F0FDF4;border-radius:10px;border-left:4px solid #10B981">'+icon('✅','#D1FAE5')+'<div><div style="font-weight:700;font-size:13px;color:#065F46">'+enrolling.length+' studies actively enrolling — strong pipeline</div><div style="font-size:12px;color:#6B7280;margin-top:4px">Total enrolled: '+enrolling.reduce((s,r)=>s+r.enrolled,0)+' patients across active studies</div><div style="font-size:12px;font-weight:600;color:#059669;margin-top:6px">→ Maintain momentum. Ensure coordinator capacity matches enrollment demand.</div></div></div>'
      });
    }

    // Sort by priority and render
    actions.sort((a,b) => a.priority - b.priority);
    if (actions.length) {
      nextEl.innerHTML = '<div style="display:flex;flex-direction:column;gap:12px">' + actions.map(a => a.html).join('') + '</div>';
    } else {
      nextEl.innerHTML = '<div style="color:#10B981;font-size:14px;font-weight:600;padding:16px;text-align:center">All clear — no urgent actions needed right now.</div>';
    }
  }

  // Call performance buildInsights if available
  if (typeof buildInsights === 'function') {
    try { buildInsights(); } catch(e) { console.warn('buildInsights:', e); }
  }
  CRP.emit('insightsRendered', { timestamp: new Date() });
}



function crioStudyUrl(name) {
  if (!name) return null;
  return CRIO_LINKS[name]
    || CRIO_LINKS[name.trim()]
    || CRIO_LINKS[name.split(' - ').pop()]
    || null;
}

function crioStudyLink(name, label, extraStyle) {
  const url = crioStudyUrl(name);
  const s = extraStyle || '';
  const icon = `<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" style="margin-left:3px;opacity:0.45;vertical-align:middle;flex-shrink:0"><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/><polyline points="15 3 21 3 21 9"/><line x1="10" y1="14" x2="21" y2="3"/></svg>`;
  if (!url) return `<span style="${s}">${label}</span>`;
  return `<a href="${url}" target="_blank" rel="noopener" onclick="event.stopPropagation()" title="Open ${label} in CRIO" style="text-decoration:none;display:inline-flex;align-items:center;gap:0;${s}">${label}${icon}</a>`;
}

function crioSubjectLink(patientName, studyName, label) {
  const url = crioStudyUrl(studyName);
  if (!url) return label;
  const icon = `<svg xmlns="http://www.w3.org/2000/svg" width="9" height="9" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" style="margin-left:2px;opacity:0.4;vertical-align:middle"><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/><polyline points="15 3 21 3 21 9"/><line x1="10" y1="14" x2="21" y2="3"/></svg>`;
  return `<a href="${url}" target="_blank" rel="noopener" onclick="event.stopPropagation()" title="Find ${patientName} in CRIO → ${studyName}" style="text-decoration:none;color:inherit;">${label}${icon}</a>`;
}

// ═══════════════════════════════════════════════════
// DATA — loaded from sample, can be replaced by live CSV
// ═══════════════════════════════════════════════════
const SAMPLE = {
  "allVisitDetail": [
    {
      "date": "Mar 9",
      "date_iso": "2026-03-09",
      "study": "J3L-MC-EZEF",
      "study_url": "https://app.clinicalresearch.io/clinical-research-philadelphia-crp/philadelphia-pa/study/89175/subjects",
      "visit": "V9-Treatment (T)",
      "patient": "Mathew  Samuel",
      "patient_url": "https://app.clinicalresearch.io/clinical-research-philadelphia-crp/philadelphia-pa/study/89175/subjects",
      "status": "Enrolled",
      "coord": "Stacey Scott",
      "site": "Philadelphia, PA"
    },
    {
      "date": "Mar 9",
      "date_iso": "2026-03-09",
      "study": "N1T-MC-MALO",
      "study_url": "https://app.clinicalresearch.io/clinical-research-philadelphia-crp/clinical-research-philadelphia-pennington/study/167755/subjects",
      "visit": "V1/OffsiteManagement",
      "patient": "Susan  Butch",
      "patient_url": "https://app.clinicalresearch.io/clinical-research-philadelphia-crp/clinical-research-philadelphia-pennington/study/167755/subjects",
      "status": "Screening",
      "coord": "Cady Chilensky",
      "site": "Pennington, NJ"
    },
    {
      "date": "Mar 9",
      "date_iso": "2026-03-09",
      "study": "MR-130A-01-TD-3001",
      "study_url": "https://app.clinicalresearch.io/clinical-research-philadelphia-crp/philadelphia-pa/study/109260/subjects",
      "visit": "Cycle 5",
      "patient": "Sinthia  Charels",
      "patient_url": "https://app.clinicalresearch.io/clinical-research-philadelphia-crp/philadelphia-pa/study/109260/subjects",
      "status": "Enrolled",
      "coord": "Ruby Pereira",
      "site": "Philadelphia, PA"
    },
    {
      "date": "Mar 9",
      "date_iso": "2026-03-09",
      "study": "J3L-MC-EZEF",
      "study_url": "https://app.clinicalresearch.io/clinical-research-philadelphia-crp/philadelphia-pa/study/89175/subjects",
      "visit": "V4-Treatment (W13)",
      "patient": "Mariano  perez",
      "patient_url": "https://app.clinicalresearch.io/clinical-research-philadelphia-crp/philadelphia-pa/study/89175/subjects",
      "status": "Enrolled",
      "coord": "Ruby Pereira",
      "site": "Philadelphia, PA"
    },
    {
      "date": "Mar 9",
      "date_iso": "2026-03-09",
      "study": "MR-130A-01-TD-3001",
      "study_url": "https://app.clinicalresearch.io/clinical-research-philadelphia-crp/philadelphia-pa/study/109260/subjects",
      "visit": "Cycle 12",
      "patient": "Bridney  Mumford",
      "patient_url": "https://app.clinicalresearch.io/clinical-research-philadelphia-crp/philadelphia-pa/study/109260/subjects",
      "status": "Enrolled",
      "coord": "Ruby Pereira",
      "site": "Philadelphia, PA"
    },
    {
      "date": "Mar 9",
      "date_iso": "2026-03-09",
      "study": "J3L-MC-EZEF",
      "study_url": "https://app.clinicalresearch.io/clinical-research-philadelphia-crp/philadelphia-pa/study/89175/subjects",
      "visit": "V4-Treatment (W13)",
      "patient": "Carol  Adonizio",
      "patient_url": "https://app.clinicalresearch.io/clinical-research-philadelphia-crp/philadelphia-pa/study/89175/subjects",
      "status": "Enrolled",
      "coord": "Stacey Scott",
      "site": "Philadelphia, PA"
    },
    {
      "date": "Mar 10",
      "date_iso": "2026-03-10",
      "study": "M20-465",
      "study_url": "https://app.clinicalresearch.io/clinical-research-philadelphia-crp/philadelphia-pa/study/107641/subjects",
      "visit": "Week 41",
      "patient": "Danai  Richards",
      "patient_url": "https://app.clinicalresearch.io/clinical-research-philadelphia-crp/philadelphia-pa/study/107641/subjects",
      "status": "Enrolled",
      "coord": "Mario Castellanos",
      "site": "Philadelphia, PA"
    },
    {
      "date": "Mar 10",
      "date_iso": "2026-03-10",
      "study": "20230222",
      "study_url": "https://app.clinicalresearch.io/clinical-research-philadelphia-crp/clinical-research-philadelphia-pennington/study/167794/subjects",
      "visit": "Main Screening",
      "patient": "Nafeesah Dennis",
      "patient_url": "https://app.clinicalresearch.io/clinical-research-philadelphia-crp/clinical-research-philadelphia-pennington/study/167794/subjects",
      "status": "Screening",
      "coord": "Cady Chilensky",
      "site": "Pennington, NJ"
    },
    {
      "date": "Mar 10",
      "date_iso": "2026-03-10",
      "study": "N1T-MC-MALO",
      "study_url": "https://app.clinicalresearch.io/clinical-research-philadelphia-crp/clinical-research-philadelphia-pennington/study/167755/subjects",
      "visit": "V1/Screening",
      "patient": "Andrew  M Shekhar",
      "patient_url": "https://app.clinicalresearch.io/clinical-research-philadelphia-crp/clinical-research-philadelphia-pennington/study/167755/subjects",
      "status": "Screening",
      "coord": "Mario Castellanos",
      "site": "Philadelphia, PA"
    },
    {
      "date": "Mar 10",
      "date_iso": "2026-03-10",
      "study": "J3L-MC-EZEF",
      "study_url": "https://app.clinicalresearch.io/clinical-research-philadelphia-crp/philadelphia-pa/study/89175/subjects",
      "visit": "V8-Treatment",
      "patient": "Marilin Walton",
      "patient_url": "https://app.clinicalresearch.io/clinical-research-philadelphia-crp/philadelphia-pa/study/89175/subjects",
      "status": "Enrolled",
      "coord": "Stacey Scott",
      "site": "Philadelphia, PA"
    },
    {
      "date": "Mar 10",
      "date_iso": "2026-03-10",
      "study": "M20-465",
      "study_url": "https://app.clinicalresearch.io/clinical-research-philadelphia-crp/philadelphia-pa/study/107641/subjects",
      "visit": "Week 8",
      "patient": "Daryl  Lloyd",
      "patient_url": "https://app.clinicalresearch.io/clinical-research-philadelphia-crp/philadelphia-pa/study/107641/subjects",
      "status": "Enrolled",
      "coord": "Mario Castellanos",
      "site": "Philadelphia, PA"
    },
    {
      "date": "Mar 10",
      "date_iso": "2026-03-10",
      "study": "20230222",
      "study_url": "https://app.clinicalresearch.io/clinical-research-philadelphia-crp/clinical-research-philadelphia-pennington/study/167794/subjects",
      "visit": "Main Screening",
      "patient": "Josephine  Cruz",
      "patient_url": "https://app.clinicalresearch.io/clinical-research-philadelphia-crp/clinical-research-philadelphia-pennington/study/167794/subjects",
      "status": "Screening",
      "coord": "Angelina Mcmullen",
      "site": "Pennington, NJ"
    },
    {
      "date": "Mar 10",
      "date_iso": "2026-03-10",
      "study": "J3L-MC-EZEF",
      "study_url": "https://app.clinicalresearch.io/clinical-research-philadelphia-crp/philadelphia-pa/study/89175/subjects",
      "visit": "V4-Treatment (W13)",
      "patient": "David  Garrett",
      "patient_url": "https://app.clinicalresearch.io/clinical-research-philadelphia-crp/philadelphia-pa/study/89175/subjects",
      "status": "Enrolled",
      "coord": "Stacey Scott",
      "site": "Philadelphia, PA"
    },
    {
      "date": "Mar 10",
      "date_iso": "2026-03-10",
      "study": "M23-714",
      "study_url": "https://app.clinicalresearch.io/clinical-research-philadelphia-crp/philadelphia-pa/study/86826/subjects",
      "visit": "V2-Randomization",
      "patient": "Lauren  BraunStrumfels",
      "patient_url": "https://app.clinicalresearch.io/clinical-research-philadelphia-crp/philadelphia-pa/study/86826/subjects",
      "status": "Screening",
      "coord": "Ruby Pereira",
      "site": "Philadelphia, PA"
    },
    {
      "date": "Mar 11",
      "date_iso": "2026-03-11",
      "study": "80202135SJS3001",
      "study_url": "https://app.clinicalresearch.io/clinical-research-philadelphia-crp/clinical-research-philadelphia-pennington/study/150548/subjects",
      "visit": "Week 16",
      "patient": "Marlyn  Wisnieski",
      "patient_url": "https://app.clinicalresearch.io/clinical-research-philadelphia-crp/clinical-research-philadelphia-pennington/study/150548/subjects",
      "status": "Enrolled",
      "coord": "Angelina Mcmullen",
      "site": "Pennington, NJ"
    },
    {
      "date": "Mar 11",
      "date_iso": "2026-03-11",
      "study": "N1T-MC-MALO",
      "study_url": "https://app.clinicalresearch.io/clinical-research-philadelphia-crp/clinical-research-philadelphia-pennington/study/167755/subjects",
      "visit": "V1/Screening",
      "patient": "Brittany  Daniel",
      "patient_url": "https://app.clinicalresearch.io/clinical-research-philadelphia-crp/clinical-research-philadelphia-pennington/study/167755/subjects",
      "status": "Screening",
      "coord": "Cady Chilensky",
      "site": "Pennington, NJ"
    },
    {
      "date": "Mar 11",
      "date_iso": "2026-03-11",
      "study": "M20-465",
      "study_url": "https://app.clinicalresearch.io/clinical-research-philadelphia-crp/philadelphia-pa/study/107641/subjects",
      "visit": "Week 19",
      "patient": "Jesse  Cummings",
      "patient_url": "https://app.clinicalresearch.io/clinical-research-philadelphia-crp/philadelphia-pa/study/107641/subjects",
      "status": "Enrolled",
      "coord": "Mario Castellanos",
      "site": "Philadelphia, PA"
    },
    {
      "date": "Mar 11",
      "date_iso": "2026-03-11",
      "study": "J2A-MC-GZPO",
      "study_url": "https://app.clinicalresearch.io/clinical-research-philadelphia-crp/philadelphia-pa/study/135157/subjects",
      "visit": "Treatment (V10)",
      "patient": "Jonathan  Freedman",
      "patient_url": "https://app.clinicalresearch.io/clinical-research-philadelphia-crp/philadelphia-pa/study/135157/subjects",
      "status": "Enrolled",
      "coord": "Stacey Scott",
      "site": "Philadelphia, PA"
    },
    {
      "date": "Mar 11",
      "date_iso": "2026-03-11",
      "study": "MR-130A-01-TD-3001",
      "study_url": "https://app.clinicalresearch.io/clinical-research-philadelphia-crp/philadelphia-pa/study/109260/subjects",
      "visit": "Cycle 13 / TFU",
      "patient": "Gladys  Cabon",
      "patient_url": "https://app.clinicalresearch.io/clinical-research-philadelphia-crp/philadelphia-pa/study/109260/subjects",
      "status": "Enrolled",
      "coord": "Ruby Pereira",
      "site": "Philadelphia, PA"
    },
    {
      "date": "Mar 11",
      "date_iso": "2026-03-11",
      "study": "J3L-MC-EZEF",
      "study_url": "https://app.clinicalresearch.io/clinical-research-philadelphia-crp/philadelphia-pa/study/89175/subjects",
      "visit": "V7-Treatment",
      "patient": "Jurdell Arnold Davis",
      "patient_url": "https://app.clinicalresearch.io/clinical-research-philadelphia-crp/philadelphia-pa/study/89175/subjects",
      "status": "Enrolled",
      "coord": "Stacey Scott",
      "site": "Philadelphia, PA"
    },
    {
      "date": "Mar 11",
      "date_iso": "2026-03-11",
      "study": "M23-698",
      "study_url": "https://app.clinicalresearch.io/clinical-research-philadelphia-crp/philadelphia-pa/study/67894/subjects",
      "visit": "Phone Call-U/A preg.",
      "patient": "Marquita  Thomas",
      "patient_url": "https://app.clinicalresearch.io/clinical-research-philadelphia-crp/philadelphia-pa/study/67894/subjects",
      "status": "Enrolled",
      "coord": "Mario Castellanos",
      "site": "Philadelphia, PA"
    },
    {
      "date": "Mar 12",
      "date_iso": "2026-03-12",
      "study": "J3L-MC-EZEF",
      "study_url": "https://app.clinicalresearch.io/clinical-research-philadelphia-crp/philadelphia-pa/study/89175/subjects",
      "visit": "V4-Treatment (W13)",
      "patient": "Rakesh  Joshi",
      "patient_url": "https://app.clinicalresearch.io/clinical-research-philadelphia-crp/philadelphia-pa/study/89175/subjects",
      "status": "Enrolled",
      "coord": "Stacey Scott",
      "site": "Philadelphia, PA"
    },
    {
      "date": "Mar 12",
      "date_iso": "2026-03-12",
      "study": "77242113PSO3006",
      "study_url": "https://app.clinicalresearch.io/clinical-research-philadelphia-crp/philadelphia-pa/study/136289/subjects",
      "visit": "Week 36",
      "patient": "Marissa Damico",
      "patient_url": "https://app.clinicalresearch.io/clinical-research-philadelphia-crp/philadelphia-pa/study/136289/subjects",
      "status": "Enrolled",
      "coord": "Mario Castellanos",
      "site": "Philadelphia, PA"
    },
    {
      "date": "Mar 12",
      "date_iso": "2026-03-12",
      "study": "J3L-MC-EZEF",
      "study_url": "https://app.clinicalresearch.io/clinical-research-philadelphia-crp/philadelphia-pa/study/89175/subjects",
      "visit": "V4-Treatment (W13)",
      "patient": "Grace  Henrie",
      "patient_url": "https://app.clinicalresearch.io/clinical-research-philadelphia-crp/philadelphia-pa/study/89175/subjects",
      "status": "Enrolled",
      "coord": "Stacey Scott",
      "site": "Philadelphia, PA"
    },
    {
      "date": "Mar 12",
      "date_iso": "2026-03-12",
      "study": "M20-465",
      "study_url": "https://app.clinicalresearch.io/clinical-research-philadelphia-crp/philadelphia-pa/study/107641/subjects",
      "visit": "Week 2",
      "patient": "Courtney  Campuzano",
      "patient_url": "https://app.clinicalresearch.io/clinical-research-philadelphia-crp/philadelphia-pa/study/107641/subjects",
      "status": "Enrolled",
      "coord": "Mario Castellanos",
      "site": "Philadelphia, PA"
    },
    {
      "date": "Mar 12",
      "date_iso": "2026-03-12",
      "study": "M20-465",
      "study_url": "https://app.clinicalresearch.io/clinical-research-philadelphia-crp/philadelphia-pa/study/107641/subjects",
      "visit": "Week 29",
      "patient": "Samantha  Jackson",
      "patient_url": "https://app.clinicalresearch.io/clinical-research-philadelphia-crp/philadelphia-pa/study/107641/subjects",
      "status": "Enrolled",
      "coord": "Mario Castellanos",
      "site": "Philadelphia, PA"
    },
    {
      "date": "Mar 13",
      "date_iso": "2026-03-13",
      "study": "D6973C00001",
      "study_url": "https://app.clinicalresearch.io/clinical-research-philadelphia-crp/clinical-research-philadelphia-pennington/study/161619/subjects",
      "visit": "Randomisation",
      "patient": "Brian  Hill",
      "patient_url": "https://app.clinicalresearch.io/clinical-research-philadelphia-crp/clinical-research-philadelphia-pennington/study/161619/subjects",
      "status": "Screening",
      "coord": "Angelina Mcmullen",
      "site": "Pennington, NJ"
    },
    {
      "date": "Mar 16",
      "date_iso": "2026-03-16",
      "study": "J2A-MC-GZPO",
      "study_url": "https://app.clinicalresearch.io/clinical-research-philadelphia-crp/philadelphia-pa/study/135157/subjects",
      "visit": "Treatment (V6)",
      "patient": "Cheryl Mosley",
      "patient_url": "https://app.clinicalresearch.io/clinical-research-philadelphia-crp/philadelphia-pa/study/135157/subjects",
      "status": "Enrolled",
      "coord": "Stacey Scott",
      "site": "Philadelphia, PA"
    },
    {
      "date": "Mar 16",
      "date_iso": "2026-03-16",
      "study": "M23-714",
      "study_url": "https://app.clinicalresearch.io/clinical-research-philadelphia-crp/philadelphia-pa/study/86826/subjects",
      "visit": "V13/Wk52 Final V/ET",
      "patient": "Annamarie  DeSantis",
      "patient_url": "https://app.clinicalresearch.io/clinical-research-philadelphia-crp/philadelphia-pa/study/86826/subjects",
      "status": "Enrolled",
      "coord": "Ruby Pereira",
      "site": "Philadelphia, PA"
    },
    {
      "date": "Mar 17",
      "date_iso": "2026-03-17",
      "study": "MR-130A-01-TD-3001",
      "study_url": "https://app.clinicalresearch.io/clinical-research-philadelphia-crp/philadelphia-pa/study/109260/subjects",
      "visit": "Cycle 10 / TFU",
      "patient": "Payton Newman",
      "patient_url": "https://app.clinicalresearch.io/clinical-research-philadelphia-crp/philadelphia-pa/study/109260/subjects",
      "status": "Enrolled",
      "coord": "Ruby Pereira",
      "site": "Philadelphia, PA"
    },
    {
      "date": "Mar 17",
      "date_iso": "2026-03-17",
      "study": "J3L-MC-EZEF",
      "study_url": "https://app.clinicalresearch.io/clinical-research-philadelphia-crp/philadelphia-pa/study/89175/subjects",
      "visit": "V4-Treatment (W13)",
      "patient": "Ernest Butts",
      "patient_url": "https://app.clinicalresearch.io/clinical-research-philadelphia-crp/philadelphia-pa/study/89175/subjects",
      "status": "Enrolled",
      "coord": "Stacey Scott",
      "site": "Philadelphia, PA"
    },
    {
      "date": "Mar 17",
      "date_iso": "2026-03-17",
      "study": "N1T-MC-MALO",
      "study_url": "https://app.clinicalresearch.io/clinical-research-philadelphia-crp/clinical-research-philadelphia-pennington/study/167755/subjects",
      "visit": "V4/W4",
      "patient": "Carmen  Rios",
      "patient_url": "https://app.clinicalresearch.io/clinical-research-philadelphia-crp/clinical-research-philadelphia-pennington/study/167755/subjects",
      "status": "Enrolled",
      "coord": "Cady Chilensky",
      "site": "Pennington, NJ"
    },
    {
      "date": "Mar 17",
      "date_iso": "2026-03-17",
      "study": "M20-465",
      "study_url": "https://app.clinicalresearch.io/clinical-research-philadelphia-crp/philadelphia-pa/study/107641/subjects",
      "visit": "Week 47",
      "patient": "Karen  Smith",
      "patient_url": "https://app.clinicalresearch.io/clinical-research-philadelphia-crp/philadelphia-pa/study/107641/subjects",
      "status": "Enrolled",
      "coord": "Mario Castellanos",
      "site": "Philadelphia, PA"
    },
    {
      "date": "Mar 17",
      "date_iso": "2026-03-17",
      "study": "M20-465",
      "study_url": "https://app.clinicalresearch.io/clinical-research-philadelphia-crp/philadelphia-pa/study/107641/subjects",
      "visit": "Week 39",
      "patient": "Jenelle  Luis",
      "patient_url": "https://app.clinicalresearch.io/clinical-research-philadelphia-crp/philadelphia-pa/study/107641/subjects",
      "status": "Enrolled",
      "coord": "Mario Castellanos",
      "site": "Philadelphia, PA"
    },
    {
      "date": "Mar 17",
      "date_iso": "2026-03-17",
      "study": "20230222",
      "study_url": "https://app.clinicalresearch.io/clinical-research-philadelphia-crp/clinical-research-philadelphia-pennington/study/167794/subjects",
      "visit": "Main Screening",
      "patient": "Darryl  Rice",
      "patient_url": "https://app.clinicalresearch.io/clinical-research-philadelphia-crp/clinical-research-philadelphia-pennington/study/167794/subjects",
      "status": "Screening",
      "coord": "Angelina Mcmullen",
      "site": "Pennington, NJ"
    },
    {
      "date": "Mar 18",
      "date_iso": "2026-03-18",
      "study": "C4951063",
      "study_url": "https://app.clinicalresearch.io/clinical-research-philadelphia-crp/philadelphia-pa/study/135648/subjects",
      "visit": "V2 - Obs Phase_MC2",
      "patient": "Kayla  Baresich",
      "patient_url": "https://app.clinicalresearch.io/clinical-research-philadelphia-crp/philadelphia-pa/study/135648/subjects",
      "status": "Screening",
      "coord": "Ruby Pereira",
      "site": "Philadelphia, PA"
    },
    {
      "date": "Mar 18",
      "date_iso": "2026-03-18",
      "study": "J3L-MC-EZEF",
      "study_url": "https://app.clinicalresearch.io/clinical-research-philadelphia-crp/philadelphia-pa/study/89175/subjects",
      "visit": "V9-Treatment (T)",
      "patient": "Ratna  Setiono",
      "patient_url": "https://app.clinicalresearch.io/clinical-research-philadelphia-crp/philadelphia-pa/study/89175/subjects",
      "status": "Enrolled",
      "coord": "Stacey Scott",
      "site": "Philadelphia, PA"
    },
    {
      "date": "Mar 18",
      "date_iso": "2026-03-18",
      "study": "J3L-MC-EZEF",
      "study_url": "https://app.clinicalresearch.io/clinical-research-philadelphia-crp/philadelphia-pa/study/89175/subjects",
      "visit": "V7-Treatment",
      "patient": "James  Clark",
      "patient_url": "https://app.clinicalresearch.io/clinical-research-philadelphia-crp/philadelphia-pa/study/89175/subjects",
      "status": "Enrolled",
      "coord": "Stacey Scott",
      "site": "Philadelphia, PA"
    },
    {
      "date": "Mar 18",
      "date_iso": "2026-03-18",
      "study": "MR-130A-01-TD-3001",
      "study_url": "https://app.clinicalresearch.io/clinical-research-philadelphia-crp/philadelphia-pa/study/109260/subjects",
      "visit": "Cycle 10 / TFU",
      "patient": "Eve Morris",
      "patient_url": "https://app.clinicalresearch.io/clinical-research-philadelphia-crp/philadelphia-pa/study/109260/subjects",
      "status": "Enrolled",
      "coord": "Ruby Pereira",
      "site": "Philadelphia, PA"
    },
    {
      "date": "Mar 18",
      "date_iso": "2026-03-18",
      "study": "LTS17367",
      "study_url": "https://app.clinicalresearch.io/clinical-research-philadelphia-crp/philadelphia-pa/study/129137/subjects",
      "visit": "Visit 13 - Week 36",
      "patient": "Taylor  Charles",
      "patient_url": "https://app.clinicalresearch.io/clinical-research-philadelphia-crp/philadelphia-pa/study/129137/subjects",
      "status": "Enrolled",
      "coord": "Mario Castellanos",
      "site": "Philadelphia, PA"
    },
    {
      "date": "Mar 19",
      "date_iso": "2026-03-19",
      "study": "80202135SJS3001",
      "study_url": "https://app.clinicalresearch.io/clinical-research-philadelphia-crp/clinical-research-philadelphia-pennington/study/150548/subjects",
      "visit": "Week 6 Call",
      "patient": "Melissa  Richards",
      "patient_url": "https://app.clinicalresearch.io/clinical-research-philadelphia-crp/clinical-research-philadelphia-pennington/study/150548/subjects",
      "status": "Enrolled",
      "coord": "Angelina Mcmullen",
      "site": "Pennington, NJ"
    },
    {
      "date": "Mar 19",
      "date_iso": "2026-03-19",
      "study": "M23-714",
      "study_url": "https://app.clinicalresearch.io/clinical-research-philadelphia-crp/philadelphia-pa/study/86826/subjects",
      "visit": "V5/DB-Cycle3/Pre.Dis",
      "patient": "Kerrie  Carvalho",
      "patient_url": "https://app.clinicalresearch.io/clinical-research-philadelphia-crp/philadelphia-pa/study/86826/subjects",
      "status": "Enrolled",
      "coord": "Ruby Pereira",
      "site": "Philadelphia, PA"
    },
    {
      "date": "Mar 20",
      "date_iso": "2026-03-20",
      "study": "80202135SJS3001",
      "study_url": "https://app.clinicalresearch.io/clinical-research-philadelphia-crp/clinical-research-philadelphia-pennington/study/150548/subjects",
      "visit": "Random nipo conc",
      "patient": "Melissa  Richards",
      "patient_url": "https://app.clinicalresearch.io/clinical-research-philadelphia-crp/clinical-research-philadelphia-pennington/study/150548/subjects",
      "status": "Enrolled",
      "coord": "Angelina Mcmullen",
      "site": "Pennington, NJ"
    },
    {
      "date": "Mar 23",
      "date_iso": "2026-03-23",
      "study": "MR-130A-01-TD-3001",
      "study_url": "https://app.clinicalresearch.io/clinical-research-philadelphia-crp/philadelphia-pa/study/109260/subjects",
      "visit": "Cycle 10 / TFU",
      "patient": "Janae  Rockemore",
      "patient_url": "https://app.clinicalresearch.io/clinical-research-philadelphia-crp/philadelphia-pa/study/109260/subjects",
      "status": "Enrolled",
      "coord": "Ruby Pereira",
      "site": "Philadelphia, PA"
    },
    {
      "date": "Mar 23",
      "date_iso": "2026-03-23",
      "study": "J2A-MC-GZPO",
      "study_url": "https://app.clinicalresearch.io/clinical-research-philadelphia-crp/philadelphia-pa/study/135157/subjects",
      "visit": "Treatment (V12)",
      "patient": "Linda  Cerino",
      "patient_url": "https://app.clinicalresearch.io/clinical-research-philadelphia-crp/philadelphia-pa/study/135157/subjects",
      "status": "Enrolled",
      "coord": "Ruby Pereira",
      "site": "Philadelphia, PA"
    },
    {
      "date": "Mar 24",
      "date_iso": "2026-03-24",
      "study": "N1T-MC-MALO",
      "study_url": "https://app.clinicalresearch.io/clinical-research-philadelphia-crp/clinical-research-philadelphia-pennington/study/167755/subjects",
      "visit": "V1/Screening",
      "patient": "Maria Pueyo Sanchez",
      "patient_url": "https://app.clinicalresearch.io/clinical-research-philadelphia-crp/clinical-research-philadelphia-pennington/study/167755/subjects",
      "status": "Screening",
      "coord": "Angelina Mcmullen",
      "site": "Pennington, NJ"
    },
    {
      "date": "Mar 24",
      "date_iso": "2026-03-24",
      "study": "CDX0159-12",
      "study_url": "https://app.clinicalresearch.io/clinical-research-philadelphia-crp/philadelphia-pa/study/102540/subjects",
      "visit": "V4-Wk8-D57",
      "patient": "Vivienne Van Nguyen",
      "patient_url": "https://app.clinicalresearch.io/clinical-research-philadelphia-crp/philadelphia-pa/study/102540/subjects",
      "status": "Enrolled",
      "coord": "Mario Castellanos",
      "site": "Philadelphia, PA"
    },
    {
      "date": "Mar 24",
      "date_iso": "2026-03-24",
      "study": "77242113PSO3006",
      "study_url": "https://app.clinicalresearch.io/clinical-research-philadelphia-crp/philadelphia-pa/study/136289/subjects",
      "visit": "Week 36",
      "patient": "Tahtim Francis",
      "patient_url": "https://app.clinicalresearch.io/clinical-research-philadelphia-crp/philadelphia-pa/study/136289/subjects",
      "status": "Enrolled",
      "coord": "Mario Castellanos",
      "site": "Philadelphia, PA"
    },
    {
      "date": "Mar 24",
      "date_iso": "2026-03-24",
      "study": "N1T-MC-MALO",
      "study_url": "https://app.clinicalresearch.io/clinical-research-philadelphia-crp/clinical-research-philadelphia-pennington/study/167755/subjects",
      "visit": "V1/OffsiteManagement",
      "patient": "Brittany  Daniel",
      "patient_url": "https://app.clinicalresearch.io/clinical-research-philadelphia-crp/clinical-research-philadelphia-pennington/study/167755/subjects",
      "status": "Screening",
      "coord": "Cady Chilensky",
      "site": "Pennington, NJ"
    },
    {
      "date": "Mar 25",
      "date_iso": "2026-03-25",
      "study": "EFC17600 (ESTUARY)",
      "study_url": "https://app.clinicalresearch.io/clinical-research-philadelphia-crp/philadelphia-pa/study/122602/subjects",
      "visit": "V14 - Week 52 EOT",
      "patient": "Barbara E Green",
      "patient_url": "https://app.clinicalresearch.io/clinical-research-philadelphia-crp/philadelphia-pa/study/122602/subjects",
      "status": "Enrolled",
      "coord": "Mario Castellanos",
      "site": "Philadelphia, PA"
    },
    {
      "date": "Mar 25",
      "date_iso": "2026-03-25",
      "study": "J2A-MC-GZPO",
      "study_url": "https://app.clinicalresearch.io/clinical-research-philadelphia-crp/philadelphia-pa/study/135157/subjects",
      "visit": "Treatment (V12)",
      "patient": "Jodi  Wolff",
      "patient_url": "https://app.clinicalresearch.io/clinical-research-philadelphia-crp/philadelphia-pa/study/135157/subjects",
      "status": "Enrolled",
      "coord": "Stacey Scott",
      "site": "Philadelphia, PA"
    },
    {
      "date": "Mar 27",
      "date_iso": "2026-03-27",
      "study": "20230222",
      "study_url": "https://app.clinicalresearch.io/clinical-research-philadelphia-crp/clinical-research-philadelphia-pennington/study/167794/subjects",
      "visit": "Main Screening",
      "patient": "Lee Kurtz",
      "patient_url": "https://app.clinicalresearch.io/clinical-research-philadelphia-crp/clinical-research-philadelphia-pennington/study/167794/subjects",
      "status": "Screening",
      "coord": "Cady Chilensky",
      "site": "Pennington, NJ"
    },
    {
      "date": "Mar 27",
      "date_iso": "2026-03-27",
      "study": "20230222",
      "study_url": "https://app.clinicalresearch.io/clinical-research-philadelphia-crp/clinical-research-philadelphia-pennington/study/167794/subjects",
      "visit": "Main Screening",
      "patient": "Gail Titus",
      "patient_url": "https://app.clinicalresearch.io/clinical-research-philadelphia-crp/clinical-research-philadelphia-pennington/study/167794/subjects",
      "status": "Screening",
      "coord": "Angelina Mcmullen",
      "site": "Pennington, NJ"
    },
    {
      "date": "Mar 30",
      "date_iso": "2026-03-30",
      "study": "MR-130A-01-TD-3001",
      "study_url": "https://app.clinicalresearch.io/clinical-research-philadelphia-crp/philadelphia-pa/study/109260/subjects",
      "visit": "Cycle 8",
      "patient": "Sharisse  King",
      "patient_url": "https://app.clinicalresearch.io/clinical-research-philadelphia-crp/philadelphia-pa/study/109260/subjects",
      "status": "Enrolled",
      "coord": "Ruby Pereira",
      "site": "Philadelphia, PA"
    },
    {
      "date": "Mar 30",
      "date_iso": "2026-03-30",
      "study": "J3L-MC-EZEF",
      "study_url": "https://app.clinicalresearch.io/clinical-research-philadelphia-crp/philadelphia-pa/study/89175/subjects",
      "visit": "V5-Treatment",
      "patient": "Pamela  Robinson",
      "patient_url": "https://app.clinicalresearch.io/clinical-research-philadelphia-crp/philadelphia-pa/study/89175/subjects",
      "status": "Enrolled",
      "coord": "Ruby Pereira",
      "site": "Philadelphia, PA"
    },
    {
      "date": "Mar 30",
      "date_iso": "2026-03-30",
      "study": "D6973C00001",
      "study_url": "https://app.clinicalresearch.io/clinical-research-philadelphia-crp/clinical-research-philadelphia-pennington/study/161619/subjects",
      "visit": "Randomisation",
      "patient": "Gloria Saafir",
      "patient_url": "https://app.clinicalresearch.io/clinical-research-philadelphia-crp/clinical-research-philadelphia-pennington/study/161619/subjects",
      "status": "Screening",
      "coord": "Stacey Scott",
      "site": "Philadelphia, PA"
    },
    {
      "date": "Mar 30",
      "date_iso": "2026-03-30",
      "study": "J3L-MC-EZEF",
      "study_url": "https://app.clinicalresearch.io/clinical-research-philadelphia-crp/philadelphia-pa/study/89175/subjects",
      "visit": "V10-Treatment",
      "patient": "Rosaria  Martin-Serrano",
      "patient_url": "https://app.clinicalresearch.io/clinical-research-philadelphia-crp/philadelphia-pa/study/89175/subjects",
      "status": "Enrolled",
      "coord": "Stacey Scott",
      "site": "Philadelphia, PA"
    },
    {
      "date": "Mar 30",
      "date_iso": "2026-03-30",
      "study": "J3L-MC-EZEF",
      "study_url": "https://app.clinicalresearch.io/clinical-research-philadelphia-crp/philadelphia-pa/study/89175/subjects",
      "visit": "V10-Treatment",
      "patient": "Charline  Coughlin",
      "patient_url": "https://app.clinicalresearch.io/clinical-research-philadelphia-crp/philadelphia-pa/study/89175/subjects",
      "status": "Enrolled",
      "coord": "Stacey Scott",
      "site": "Philadelphia, PA"
    },
    {
      "date": "Mar 31",
      "date_iso": "2026-03-31",
      "study": "M23-714",
      "study_url": "https://app.clinicalresearch.io/clinical-research-philadelphia-crp/philadelphia-pa/study/86826/subjects",
      "visit": "V4 / DB-Cycle 2",
      "patient": "Lakeisha  Johnson",
      "patient_url": "https://app.clinicalresearch.io/clinical-research-philadelphia-crp/philadelphia-pa/study/86826/subjects",
      "status": "Enrolled",
      "coord": "Ruby Pereira",
      "site": "Philadelphia, PA"
    },
    {
      "date": "Mar 31",
      "date_iso": "2026-03-31",
      "study": "D6973C00001",
      "study_url": "https://app.clinicalresearch.io/clinical-research-philadelphia-crp/clinical-research-philadelphia-pennington/study/161619/subjects",
      "visit": "Unscheduled Visit",
      "patient": "George  Ragos",
      "patient_url": "https://app.clinicalresearch.io/clinical-research-philadelphia-crp/clinical-research-philadelphia-pennington/study/161619/subjects",
      "status": "Enrolled",
      "coord": "Angelina Mcmullen",
      "site": "Pennington, NJ"
    },
    {
      "date": "Mar 31",
      "date_iso": "2026-03-31",
      "study": "M23-698",
      "study_url": "https://app.clinicalresearch.io/clinical-research-philadelphia-crp/philadelphia-pa/study/67894/subjects",
      "visit": "V16-Wk88 - D617",
      "patient": "Angelica  Moss",
      "patient_url": "https://app.clinicalresearch.io/clinical-research-philadelphia-crp/philadelphia-pa/study/67894/subjects",
      "status": "Enrolled",
      "coord": "Mario Castellanos",
      "site": "Philadelphia, PA"
    },
    {
      "date": "Mar 31",
      "date_iso": "2026-03-31",
      "study": "J3L-MC-EZEF",
      "study_url": "https://app.clinicalresearch.io/clinical-research-philadelphia-crp/philadelphia-pa/study/89175/subjects",
      "visit": "V4-Treatment (W13)",
      "patient": "Brian  Mckenzie",
      "patient_url": "https://app.clinicalresearch.io/clinical-research-philadelphia-crp/philadelphia-pa/study/89175/subjects",
      "status": "Enrolled",
      "coord": "Stacey Scott",
      "site": "Philadelphia, PA"
    },
    {
      "date": "Apr 1",
      "date_iso": "2026-04-01",
      "study": "J3L-MC-EZEF",
      "study_url": "https://app.clinicalresearch.io/clinical-research-philadelphia-crp/philadelphia-pa/study/89175/subjects",
      "visit": "V8-Treatment",
      "patient": "Shelley thomas Garrett",
      "patient_url": "https://app.clinicalresearch.io/clinical-research-philadelphia-crp/philadelphia-pa/study/89175/subjects",
      "status": "Enrolled",
      "coord": "Stacey Scott",
      "site": "Philadelphia, PA"
    },
    {
      "date": "Apr 2",
      "date_iso": "2026-04-02",
      "study": "EFC17599",
      "study_url": "https://app.clinicalresearch.io/clinical-research-philadelphia-crp/philadelphia-pa/study/97908/subjects",
      "visit": "Visit 11",
      "patient": "Natasha  Booker",
      "patient_url": "https://app.clinicalresearch.io/clinical-research-philadelphia-crp/philadelphia-pa/study/97908/subjects",
      "status": "Enrolled",
      "coord": "Mario Castellanos",
      "site": "Philadelphia, PA"
    },
    {
      "date": "Apr 3",
      "date_iso": "2026-04-03",
      "study": "80202135SJS3001",
      "study_url": "https://app.clinicalresearch.io/clinical-research-philadelphia-crp/clinical-research-philadelphia-pennington/study/150548/subjects",
      "visit": "Week 8",
      "patient": "Melissa  Richards",
      "patient_url": "https://app.clinicalresearch.io/clinical-research-philadelphia-crp/clinical-research-philadelphia-pennington/study/150548/subjects",
      "status": "Enrolled",
      "coord": "Angelina Mcmullen",
      "site": "Pennington, NJ"
    },
    {
      "date": "Apr 6",
      "date_iso": "2026-04-06",
      "study": "J3L-MC-EZEF",
      "study_url": "https://app.clinicalresearch.io/clinical-research-philadelphia-crp/philadelphia-pa/study/89175/subjects",
      "visit": "V10-Treatment",
      "patient": "Rosemary  Craft",
      "patient_url": "https://app.clinicalresearch.io/clinical-research-philadelphia-crp/philadelphia-pa/study/89175/subjects",
      "status": "Enrolled",
      "coord": "Ruby Pereira",
      "site": "Philadelphia, PA"
    },
    {
      "date": "Apr 6",
      "date_iso": "2026-04-06",
      "study": "J3L-MC-EZEF",
      "study_url": "https://app.clinicalresearch.io/clinical-research-philadelphia-crp/philadelphia-pa/study/89175/subjects",
      "visit": "V11-Treatment (T)",
      "patient": "Ann  Guarnaccia",
      "patient_url": "https://app.clinicalresearch.io/clinical-research-philadelphia-crp/philadelphia-pa/study/89175/subjects",
      "status": "Enrolled",
      "coord": "Stacey Scott",
      "site": "Philadelphia, PA"
    },
    {
      "date": "Apr 6",
      "date_iso": "2026-04-06",
      "study": "J3L-MC-EZEF",
      "study_url": "https://app.clinicalresearch.io/clinical-research-philadelphia-crp/philadelphia-pa/study/89175/subjects",
      "visit": "V9-Treatment (T)",
      "patient": "Frank  Padlo",
      "patient_url": "https://app.clinicalresearch.io/clinical-research-philadelphia-crp/philadelphia-pa/study/89175/subjects",
      "status": "Enrolled",
      "coord": "Stacey Scott",
      "site": "Philadelphia, PA"
    },
    {
      "date": "Apr 7",
      "date_iso": "2026-04-07",
      "study": "M20-465",
      "study_url": "https://app.clinicalresearch.io/clinical-research-philadelphia-crp/philadelphia-pa/study/107641/subjects",
      "visit": "Week 12",
      "patient": "Daryl  Lloyd",
      "patient_url": "https://app.clinicalresearch.io/clinical-research-philadelphia-crp/philadelphia-pa/study/107641/subjects",
      "status": "Enrolled",
      "coord": "Mario Castellanos",
      "site": "Philadelphia, PA"
    },
    {
      "date": "Apr 7",
      "date_iso": "2026-04-07",
      "study": "20230222",
      "study_url": "https://app.clinicalresearch.io/clinical-research-philadelphia-crp/clinical-research-philadelphia-pennington/study/167794/subjects",
      "visit": "Main Screening",
      "patient": "Lou  Napolitano",
      "patient_url": "https://app.clinicalresearch.io/clinical-research-philadelphia-crp/clinical-research-philadelphia-pennington/study/167794/subjects",
      "status": "Screening",
      "coord": "Cady Chilensky",
      "site": "Pennington, NJ"
    },
    {
      "date": "Apr 7",
      "date_iso": "2026-04-07",
      "study": "M23-698",
      "study_url": "https://app.clinicalresearch.io/clinical-research-philadelphia-crp/philadelphia-pa/study/67894/subjects",
      "visit": "V14-Wk64 - D449",
      "patient": "Marquita  Thomas",
      "patient_url": "https://app.clinicalresearch.io/clinical-research-philadelphia-crp/philadelphia-pa/study/67894/subjects",
      "status": "Enrolled",
      "coord": "Mario Castellanos",
      "site": "Philadelphia, PA"
    },
    {
      "date": "Apr 7",
      "date_iso": "2026-04-07",
      "study": "77242113PSO3006",
      "study_url": "https://app.clinicalresearch.io/clinical-research-philadelphia-crp/philadelphia-pa/study/136289/subjects",
      "visit": "Week 44",
      "patient": "Lorayne  Thum",
      "patient_url": "https://app.clinicalresearch.io/clinical-research-philadelphia-crp/philadelphia-pa/study/136289/subjects",
      "status": "Enrolled",
      "coord": "Mario Castellanos",
      "site": "Philadelphia, PA"
    },
    {
      "date": "Apr 7",
      "date_iso": "2026-04-07",
      "study": "M23-714",
      "study_url": "https://app.clinicalresearch.io/clinical-research-philadelphia-crp/philadelphia-pa/study/86826/subjects",
      "visit": "V6 / OLE Week 4",
      "patient": "Julie  Atkinson",
      "patient_url": "https://app.clinicalresearch.io/clinical-research-philadelphia-crp/philadelphia-pa/study/86826/subjects",
      "status": "Enrolled",
      "coord": "Ruby Pereira",
      "site": "Philadelphia, PA"
    },
    {
      "date": "Apr 7",
      "date_iso": "2026-04-07",
      "study": "J3L-MC-EZEF",
      "study_url": "https://app.clinicalresearch.io/clinical-research-philadelphia-crp/philadelphia-pa/study/89175/subjects",
      "visit": "V10-Treatment",
      "patient": "Michele  Greaves",
      "patient_url": "https://app.clinicalresearch.io/clinical-research-philadelphia-crp/philadelphia-pa/study/89175/subjects",
      "status": "Enrolled",
      "coord": "Stacey Scott",
      "site": "Philadelphia, PA"
    },
    {
      "date": "Apr 8",
      "date_iso": "2026-04-08",
      "study": "20230222",
      "study_url": "https://app.clinicalresearch.io/clinical-research-philadelphia-crp/clinical-research-philadelphia-pennington/study/167794/subjects",
      "visit": "Week 4",
      "patient": "Anthony  Chan",
      "patient_url": "https://app.clinicalresearch.io/clinical-research-philadelphia-crp/clinical-research-philadelphia-pennington/study/167794/subjects",
      "status": "Enrolled",
      "coord": "Angelina Mcmullen",
      "site": "Pennington, NJ"
    },
    {
      "date": "Apr 8",
      "date_iso": "2026-04-08",
      "study": "J3L-MC-EZEF",
      "study_url": "https://app.clinicalresearch.io/clinical-research-philadelphia-crp/philadelphia-pa/study/89175/subjects",
      "visit": "V8-Treatment",
      "patient": "Simon  Wolf",
      "patient_url": "https://app.clinicalresearch.io/clinical-research-philadelphia-crp/philadelphia-pa/study/89175/subjects",
      "status": "Enrolled",
      "coord": "Ruby Pereira",
      "site": "Philadelphia, PA"
    },
    {
      "date": "Apr 8",
      "date_iso": "2026-04-08",
      "study": "J3L-MC-EZEF",
      "study_url": "https://app.clinicalresearch.io/clinical-research-philadelphia-crp/philadelphia-pa/study/89175/subjects",
      "visit": "V8-Treatment",
      "patient": "Christopher  Hedges",
      "patient_url": "https://app.clinicalresearch.io/clinical-research-philadelphia-crp/philadelphia-pa/study/89175/subjects",
      "status": "Enrolled",
      "coord": "Stacey Scott",
      "site": "Philadelphia, PA"
    },
    {
      "date": "Apr 8",
      "date_iso": "2026-04-08",
      "study": "MR-130A-01-TD-3001",
      "study_url": "https://app.clinicalresearch.io/clinical-research-philadelphia-crp/philadelphia-pa/study/109260/subjects",
      "visit": "EOS/ET",
      "patient": "Gladys  Cabon",
      "patient_url": "https://app.clinicalresearch.io/clinical-research-philadelphia-crp/philadelphia-pa/study/109260/subjects",
      "status": "Enrolled",
      "coord": "Ruby Pereira",
      "site": "Philadelphia, PA"
    },
    {
      "date": "Apr 8",
      "date_iso": "2026-04-08",
      "study": "J2A-MC-GZPO",
      "study_url": "https://app.clinicalresearch.io/clinical-research-philadelphia-crp/philadelphia-pa/study/135157/subjects",
      "visit": "Treatment (V11)",
      "patient": "Jonathan  Freedman",
      "patient_url": "https://app.clinicalresearch.io/clinical-research-philadelphia-crp/philadelphia-pa/study/135157/subjects",
      "status": "Enrolled",
      "coord": "Stacey Scott",
      "site": "Philadelphia, PA"
    },
    {
      "date": "Apr 8",
      "date_iso": "2026-04-08",
      "study": "J1G-MC-LAKI",
      "study_url": "https://app.clinicalresearch.io/clinical-research-philadelphia-crp/philadelphia-pa/study/119640/subjects",
      "visit": "DBTx: V6 Wk32",
      "patient": "Patricia  Garland",
      "patient_url": "https://app.clinicalresearch.io/clinical-research-philadelphia-crp/philadelphia-pa/study/119640/subjects",
      "status": "Enrolled",
      "coord": "Ruby Pereira",
      "site": "Philadelphia, PA"
    },
    {
      "date": "Apr 9",
      "date_iso": "2026-04-09",
      "study": "J3L-MC-EZEF",
      "study_url": "https://app.clinicalresearch.io/clinical-research-philadelphia-crp/philadelphia-pa/study/89175/subjects",
      "visit": "V9-Treatment (T)",
      "patient": "Brian  Murphy",
      "patient_url": "https://app.clinicalresearch.io/clinical-research-philadelphia-crp/philadelphia-pa/study/89175/subjects",
      "status": "Enrolled",
      "coord": "Stacey Scott",
      "site": "Philadelphia, PA"
    },
    {
      "date": "Apr 10",
      "date_iso": "2026-04-10",
      "study": "J3L-MC-EZEF",
      "study_url": "https://app.clinicalresearch.io/clinical-research-philadelphia-crp/philadelphia-pa/study/89175/subjects",
      "visit": "V4-Treatment (W13)",
      "patient": "Thomas  Hilton",
      "patient_url": "https://app.clinicalresearch.io/clinical-research-philadelphia-crp/philadelphia-pa/study/89175/subjects",
      "status": "Enrolled",
      "coord": "Ruby Pereira",
      "site": "Philadelphia, PA"
    },
    {
      "date": "Apr 10",
      "date_iso": "2026-04-10",
      "study": "J3F-MC-EZCC",
      "study_url": "https://app.clinicalresearch.io/clinical-research-philadelphia-crp/clinical-research-philadelphia-pennington/study/172389/subjects",
      "visit": "Screening V1",
      "patient": "Dulana  Thaminda Ranaweera",
      "patient_url": "https://app.clinicalresearch.io/clinical-research-philadelphia-crp/clinical-research-philadelphia-pennington/study/172389/subjects",
      "status": "Scheduled V1",
      "coord": "Angelina Mcmullen",
      "site": "Pennington, NJ"
    },
    {
      "date": "Apr 13",
      "date_iso": "2026-04-13",
      "study": "J3L-MC-EZEF",
      "study_url": "https://app.clinicalresearch.io/clinical-research-philadelphia-crp/philadelphia-pa/study/89175/subjects",
      "visit": "V10-Treatment",
      "patient": "Walter  Sawka",
      "patient_url": "https://app.clinicalresearch.io/clinical-research-philadelphia-crp/philadelphia-pa/study/89175/subjects",
      "status": "Enrolled",
      "coord": "Stacey Scott",
      "site": "Philadelphia, PA"
    },
    {
      "date": "Apr 14",
      "date_iso": "2026-04-14",
      "study": "MR-130A-01-TD-3001",
      "study_url": "https://app.clinicalresearch.io/clinical-research-philadelphia-crp/philadelphia-pa/study/109260/subjects",
      "visit": "Cycle 11 / TFU",
      "patient": "Payton Newman",
      "patient_url": "https://app.clinicalresearch.io/clinical-research-philadelphia-crp/philadelphia-pa/study/109260/subjects",
      "status": "Enrolled",
      "coord": "Ruby Pereira",
      "site": "Philadelphia, PA"
    },
    {
      "date": "Apr 14",
      "date_iso": "2026-04-14",
      "study": "J3L-MC-EZEF",
      "study_url": "https://app.clinicalresearch.io/clinical-research-philadelphia-crp/philadelphia-pa/study/89175/subjects",
      "visit": "V7-Treatment",
      "patient": "Debora Green  Howell",
      "patient_url": "https://app.clinicalresearch.io/clinical-research-philadelphia-crp/philadelphia-pa/study/89175/subjects",
      "status": "Enrolled",
      "coord": "Stacey Scott",
      "site": "Philadelphia, PA"
    },
    {
      "date": "Apr 15",
      "date_iso": "2026-04-15",
      "study": "MR-130A-01-TD-3001",
      "study_url": "https://app.clinicalresearch.io/clinical-research-philadelphia-crp/philadelphia-pa/study/109260/subjects",
      "visit": "Cycle 11 / TFU",
      "patient": "Eve Morris",
      "patient_url": "https://app.clinicalresearch.io/clinical-research-philadelphia-crp/philadelphia-pa/study/109260/subjects",
      "status": "Enrolled",
      "coord": "Ruby Pereira",
      "site": "Philadelphia, PA"
    },
    {
      "date": "Apr 16",
      "date_iso": "2026-04-16",
      "study": "J3L-MC-EZEF",
      "study_url": "https://app.clinicalresearch.io/clinical-research-philadelphia-crp/philadelphia-pa/study/89175/subjects",
      "visit": "V4-Treatment (W13)",
      "patient": "Leonard Mcdonald",
      "patient_url": "https://app.clinicalresearch.io/clinical-research-philadelphia-crp/philadelphia-pa/study/89175/subjects",
      "status": "Enrolled",
      "coord": "Stacey Scott",
      "site": "Philadelphia, PA"
    },
    {
      "date": "Apr 20",
      "date_iso": "2026-04-20",
      "study": "77242113PSO3006",
      "study_url": "https://app.clinicalresearch.io/clinical-research-philadelphia-crp/philadelphia-pa/study/136289/subjects",
      "visit": "Week 44",
      "patient": "Angel  Feria Merino",
      "patient_url": "https://app.clinicalresearch.io/clinical-research-philadelphia-crp/philadelphia-pa/study/136289/subjects",
      "status": "Enrolled",
      "coord": "Mario Castellanos",
      "site": "Philadelphia, PA"
    },
    {
      "date": "Apr 20",
      "date_iso": "2026-04-20",
      "study": "MR-130A-01-TD-3001",
      "study_url": "https://app.clinicalresearch.io/clinical-research-philadelphia-crp/philadelphia-pa/study/109260/subjects",
      "visit": "Cycle 11 / TFU",
      "patient": "Janae  Rockemore",
      "patient_url": "https://app.clinicalresearch.io/clinical-research-philadelphia-crp/philadelphia-pa/study/109260/subjects",
      "status": "Enrolled",
      "coord": "Ruby Pereira",
      "site": "Philadelphia, PA"
    },
    {
      "date": "Apr 20",
      "date_iso": "2026-04-20",
      "study": "J3L-MC-EZEF",
      "study_url": "https://app.clinicalresearch.io/clinical-research-philadelphia-crp/philadelphia-pa/study/89175/subjects",
      "visit": "V11-Treatment (T)",
      "patient": "Barbara  Musselman",
      "patient_url": "https://app.clinicalresearch.io/clinical-research-philadelphia-crp/philadelphia-pa/study/89175/subjects",
      "status": "Enrolled",
      "coord": "Ruby Pereira",
      "site": "Philadelphia, PA"
    },
    {
      "date": "Apr 22",
      "date_iso": "2026-04-22",
      "study": "D7960C00015",
      "study_url": "https://app.clinicalresearch.io/clinical-research-philadelphia-crp/philadelphia-pa/study/154462/subjects",
      "visit": "V6 - Week 24",
      "patient": "Andrea M Branche",
      "patient_url": "https://app.clinicalresearch.io/clinical-research-philadelphia-crp/philadelphia-pa/study/154462/subjects",
      "status": "Enrolled",
      "coord": "Stacey Scott",
      "site": "Philadelphia, PA"
    },
    {
      "date": "Apr 22",
      "date_iso": "2026-04-22",
      "study": "J3L-MC-EZEF",
      "study_url": "https://app.clinicalresearch.io/clinical-research-philadelphia-crp/philadelphia-pa/study/89175/subjects",
      "visit": "V10-Treatment",
      "patient": "Laurie  Bochert",
      "patient_url": "https://app.clinicalresearch.io/clinical-research-philadelphia-crp/philadelphia-pa/study/89175/subjects",
      "status": "Enrolled",
      "coord": "Ruby Pereira",
      "site": "Philadelphia, PA"
    },
    {
      "date": "Apr 22",
      "date_iso": "2026-04-22",
      "study": "J3L-MC-EZEF",
      "study_url": "https://app.clinicalresearch.io/clinical-research-philadelphia-crp/philadelphia-pa/study/89175/subjects",
      "visit": "V4-Treatment (W13)",
      "patient": "Madearia Lowery",
      "patient_url": "https://app.clinicalresearch.io/clinical-research-philadelphia-crp/philadelphia-pa/study/89175/subjects",
      "status": "Enrolled",
      "coord": "Stacey Scott",
      "site": "Philadelphia, PA"
    },
    {
      "date": "Apr 23",
      "date_iso": "2026-04-23",
      "study": "J3L-MC-EZEF",
      "study_url": "https://app.clinicalresearch.io/clinical-research-philadelphia-crp/philadelphia-pa/study/89175/subjects",
      "visit": "V11-Treatment (T)",
      "patient": "Lottie  Hicks",
      "patient_url": "https://app.clinicalresearch.io/clinical-research-philadelphia-crp/philadelphia-pa/study/89175/subjects",
      "status": "Enrolled",
      "coord": "Ruby Pereira",
      "site": "Philadelphia, PA"
    },
    {
      "date": "Apr 23",
      "date_iso": "2026-04-23",
      "study": "J3L-MC-EZEF",
      "study_url": "https://app.clinicalresearch.io/clinical-research-philadelphia-crp/philadelphia-pa/study/89175/subjects",
      "visit": "V9-Treatment (T)",
      "patient": "Fred  Early",
      "patient_url": "https://app.clinicalresearch.io/clinical-research-philadelphia-crp/philadelphia-pa/study/89175/subjects",
      "status": "Enrolled",
      "coord": "Ruby Pereira",
      "site": "Philadelphia, PA"
    },
    {
      "date": "Apr 28",
      "date_iso": "2026-04-28",
      "study": "77242113PSO3006",
      "study_url": "https://app.clinicalresearch.io/clinical-research-philadelphia-crp/philadelphia-pa/study/136289/subjects",
      "visit": "Week 44",
      "patient": "Baris  Baltali",
      "patient_url": "https://app.clinicalresearch.io/clinical-research-philadelphia-crp/philadelphia-pa/study/136289/subjects",
      "status": "Enrolled",
      "coord": "Mario Castellanos",
      "site": "Philadelphia, PA"
    },
    {
      "date": "Apr 29",
      "date_iso": "2026-04-29",
      "study": "J3L-MC-EZEF",
      "study_url": "https://app.clinicalresearch.io/clinical-research-philadelphia-crp/philadelphia-pa/study/89175/subjects",
      "visit": "V4-Treatment (W13)",
      "patient": "Linda Terrick",
      "patient_url": "https://app.clinicalresearch.io/clinical-research-philadelphia-crp/philadelphia-pa/study/89175/subjects",
      "status": "Enrolled",
      "coord": "Stacey Scott",
      "site": "Philadelphia, PA"
    },
    {
      "date": "Apr 30",
      "date_iso": "2026-04-30",
      "study": "J3L-MC-EZEF",
      "study_url": "https://app.clinicalresearch.io/clinical-research-philadelphia-crp/philadelphia-pa/study/89175/subjects",
      "visit": "V7-Treatment",
      "patient": "Sheila  Simmons",
      "patient_url": "https://app.clinicalresearch.io/clinical-research-philadelphia-crp/philadelphia-pa/study/89175/subjects",
      "status": "Enrolled",
      "coord": "Stacey Scott",
      "site": "Philadelphia, PA"
    },
    {
      "date": "Apr 30",
      "date_iso": "2026-04-30",
      "study": "77242113PSO3006",
      "study_url": "https://app.clinicalresearch.io/clinical-research-philadelphia-crp/philadelphia-pa/study/136289/subjects",
      "visit": "Week 44",
      "patient": "Virgil  Casey",
      "patient_url": "https://app.clinicalresearch.io/clinical-research-philadelphia-crp/philadelphia-pa/study/136289/subjects",
      "status": "Enrolled",
      "coord": "Mario Castellanos",
      "site": "Philadelphia, PA"
    },
    {
      "date": "Apr 30",
      "date_iso": "2026-04-30",
      "study": "77242113PSO3006",
      "study_url": "https://app.clinicalresearch.io/clinical-research-philadelphia-crp/philadelphia-pa/study/136289/subjects",
      "visit": "Week 44",
      "patient": "Vaughn  Jeffries",
      "patient_url": "https://app.clinicalresearch.io/clinical-research-philadelphia-crp/philadelphia-pa/study/136289/subjects",
      "status": "Enrolled",
      "coord": "Mario Castellanos",
      "site": "Philadelphia, PA"
    },
    {
      "date": "May 5",
      "date_iso": "2026-05-05",
      "study": "M20-465",
      "study_url": "https://app.clinicalresearch.io/clinical-research-philadelphia-crp/philadelphia-pa/study/107641/subjects",
      "visit": "Week 16",
      "patient": "Daryl  Lloyd",
      "patient_url": "https://app.clinicalresearch.io/clinical-research-philadelphia-crp/philadelphia-pa/study/107641/subjects",
      "status": "Enrolled",
      "coord": "Mario Castellanos",
      "site": "Philadelphia, PA"
    },
    {
      "date": "May 6",
      "date_iso": "2026-05-06",
      "study": "J3L-MC-EZEF",
      "study_url": "https://app.clinicalresearch.io/clinical-research-philadelphia-crp/philadelphia-pa/study/89175/subjects",
      "visit": "V8-Treatment",
      "patient": "Joel  Jaffe",
      "patient_url": "https://app.clinicalresearch.io/clinical-research-philadelphia-crp/philadelphia-pa/study/89175/subjects",
      "status": "Enrolled",
      "coord": "Stacey Scott",
      "site": "Philadelphia, PA"
    },
    {
      "date": "May 6",
      "date_iso": "2026-05-06",
      "study": "J3L-MC-EZEF",
      "study_url": "https://app.clinicalresearch.io/clinical-research-philadelphia-crp/philadelphia-pa/study/89175/subjects",
      "visit": "V10-Treatment",
      "patient": "John  Ervin",
      "patient_url": "https://app.clinicalresearch.io/clinical-research-philadelphia-crp/philadelphia-pa/study/89175/subjects",
      "status": "Enrolled",
      "coord": "Stacey Scott",
      "site": "Philadelphia, PA"
    },
    {
      "date": "May 7",
      "date_iso": "2026-05-07",
      "study": "J3L-MC-EZEF",
      "study_url": "https://app.clinicalresearch.io/clinical-research-philadelphia-crp/philadelphia-pa/study/89175/subjects",
      "visit": "V10-Treatment",
      "patient": "Lawrence  Washington",
      "patient_url": "https://app.clinicalresearch.io/clinical-research-philadelphia-crp/philadelphia-pa/study/89175/subjects",
      "status": "Enrolled",
      "coord": "Ruby Pereira",
      "site": "Philadelphia, PA"
    },
    {
      "date": "May 7",
      "date_iso": "2026-05-07",
      "study": "J3L-MC-EZEF",
      "study_url": "https://app.clinicalresearch.io/clinical-research-philadelphia-crp/philadelphia-pa/study/89175/subjects",
      "visit": "V7-Treatment",
      "patient": "CHAROLETTE  Willis",
      "patient_url": "https://app.clinicalresearch.io/clinical-research-philadelphia-crp/philadelphia-pa/study/89175/subjects",
      "status": "Enrolled",
      "coord": "Stacey Scott",
      "site": "Philadelphia, PA"
    }
  ],
  "allCancels": [
    {
        "study": "J2A-MC-GZPO",
        "study_url": "https://app.clinicalresearch.io/clinical-research-philadelphia-crp/philadelphia-pa/study/135157/subjects",
        "url": "https://app.clinicalresearch.io/clinical-research-philadelphia-crp/philadelphia-pa/study/135157/subjects",
        "name": "Linda  Demeter",
        "patient_url": "https://app.clinicalresearch.io/clinical-research-philadelphia-crp/philadelphia-pa/study/135157/subjects",
        "coord": "Stacey Scott",
        "cancel_date": "2026-03-04",
        "date": "Apr 20",
        "type": "Site Cancelled",
        "reason": "subject is a transfer patient to Florida",
        "category": "Other"
    },
    {
        "study": "C4951063",
        "study_url": "https://app.clinicalresearch.io/clinical-research-philadelphia-crp/philadelphia-pa/study/135648/subjects",
        "url": "https://app.clinicalresearch.io/clinical-research-philadelphia-crp/philadelphia-pa/study/135648/subjects",
        "name": "Stephanie  Madrinan",
        "patient_url": "https://app.clinicalresearch.io/clinical-research-philadelphia-crp/philadelphia-pa/study/135648/subjects",
        "coord": "Ruby Pereira",
        "cancel_date": "2026-03-03",
        "date": "Mar 3",
        "type": "Patient Cancelled",
        "reason": "due to weather and her son school 2 hour delay",
        "category": "Weather"
    },
    {
        "study": "J2A-MC-GZPS",
        "study_url": "https://app.clinicalresearch.io/clinical-research-philadelphia-crp/philadelphia-pa/study/162596/subjects",
        "url": "https://app.clinicalresearch.io/clinical-research-philadelphia-crp/philadelphia-pa/study/162596/subjects",
        "name": "AngelLewis AngelLewis",
        "patient_url": "https://app.clinicalresearch.io/clinical-research-philadelphia-crp/philadelphia-pa/study/162596/subjects",
        "coord": "Jana Milankovic",
        "cancel_date": "2026-03-03",
        "date": "Mar 3",
        "type": "Site Cancelled",
        "reason": "No ultrasound tech available for appt several text messages were sent without a reply",
        "category": "Other"
    },
    {
        "study": "C4951063",
        "study_url": "https://app.clinicalresearch.io/clinical-research-philadelphia-crp/philadelphia-pa/study/135648/subjects",
        "url": "https://app.clinicalresearch.io/clinical-research-philadelphia-crp/philadelphia-pa/study/135648/subjects",
        "name": "Jennyfer  Floyd",
        "patient_url": "https://app.clinicalresearch.io/clinical-research-philadelphia-crp/philadelphia-pa/study/135648/subjects",
        "coord": "Jana Milankovic",
        "cancel_date": "2026-03-03",
        "date": "Mar 3",
        "type": "No Show",
        "reason": "Text message sent about rescheduling missed appt  if interested",
        "category": "No Show"
    },
    {
        "study": "88545223PSA2001",
        "study_url": "https://app.clinicalresearch.io/clinical-research-philadelphia-crp/philadelphia-pa/study/173860/subjects",
        "url": "https://app.clinicalresearch.io/clinical-research-philadelphia-crp/philadelphia-pa/study/173860/subjects",
        "name": "Paul  McMenemy",
        "patient_url": "https://app.clinicalresearch.io/clinical-research-philadelphia-crp/philadelphia-pa/study/173860/subjects",
        "coord": "Gabrijela Ateljevic",
        "cancel_date": "2026-03-03",
        "date": "Feb 27",
        "type": "Patient Cancelled",
        "reason": "Patient cancelled due to work commitments. Tried two times to reach out and reschedule but no answer",
        "category": "No Response"
    },
    {
        "study": "MR-130A-01-TD-3001",
        "study_url": "https://app.clinicalresearch.io/clinical-research-philadelphia-crp/philadelphia-pa/study/109260/subjects",
        "url": "https://app.clinicalresearch.io/clinical-research-philadelphia-crp/philadelphia-pa/study/109260/subjects",
        "name": "Haley  Robinson",
        "patient_url": "https://app.clinicalresearch.io/clinical-research-philadelphia-crp/philadelphia-pa/study/109260/subjects",
        "coord": "Jana Milankovic",
        "cancel_date": "2026-03-03",
        "date": "Apr 27",
        "type": "Site Cancelled",
        "reason": "Due to changes in the protocol criteria, I need to cancel her appointment because her BMI is below the updated eligibility requirement.",
        "category": "Screen Fail/DNQ"
    },
    {
        "study": "MR-130A-01-TD-3001",
        "study_url": "https://app.clinicalresearch.io/clinical-research-philadelphia-crp/philadelphia-pa/study/109260/subjects",
        "url": "https://app.clinicalresearch.io/clinical-research-philadelphia-crp/philadelphia-pa/study/109260/subjects",
        "name": "Sofia  Retamal",
        "patient_url": "https://app.clinicalresearch.io/clinical-research-philadelphia-crp/philadelphia-pa/study/109260/subjects",
        "coord": "Jana Milankovic",
        "cancel_date": "2026-03-03",
        "date": "Mar 10",
        "type": "Site Cancelled",
        "reason": "Due to changes in the protocol criteria, I need to cancel her appointment because her BMI is below the updated eligibility requirement.",
        "category": "Screen Fail/DNQ"
    },
    {
        "study": "J2A-MC-GZPS",
        "study_url": "https://app.clinicalresearch.io/clinical-research-philadelphia-crp/philadelphia-pa/study/162596/subjects",
        "url": "https://app.clinicalresearch.io/clinical-research-philadelphia-crp/philadelphia-pa/study/162596/subjects",
        "name": "Bernice Oglesby",
        "patient_url": "https://app.clinicalresearch.io/clinical-research-philadelphia-crp/philadelphia-pa/study/162596/subjects",
        "coord": "Jana Milankovic",
        "cancel_date": "2026-03-03",
        "date": "Mar 31",
        "type": "Patient Cancelled",
        "reason": "Patient cancelled, She is no longer interested in the study",
        "category": "Patient Withdrew"
    },
    {
        "study": "MR-130A-01-TD-3001",
        "study_url": "https://app.clinicalresearch.io/clinical-research-philadelphia-crp/philadelphia-pa/study/109260/subjects",
        "url": "https://app.clinicalresearch.io/clinical-research-philadelphia-crp/philadelphia-pa/study/109260/subjects",
        "name": "Devon  Anthony",
        "patient_url": "https://app.clinicalresearch.io/clinical-research-philadelphia-crp/philadelphia-pa/study/109260/subjects",
        "coord": "Jana Milankovic",
        "cancel_date": "2026-03-02",
        "date": "Mar 4",
        "type": "Site Cancelled",
        "reason": "Per Dr. A:  participant does not Qualify for the Contraceptive Patch Study. She is on topiramate (Topamax) and she has an IUD",
        "category": "Screen Fail/DNQ"
    },
    {
        "study": "C4951063",
        "study_url": "https://app.clinicalresearch.io/clinical-research-philadelphia-crp/philadelphia-pa/study/135648/subjects",
        "url": "https://app.clinicalresearch.io/clinical-research-philadelphia-crp/philadelphia-pa/study/135648/subjects",
        "name": "Kathleen Brown",
        "patient_url": "https://app.clinicalresearch.io/clinical-research-philadelphia-crp/philadelphia-pa/study/135648/subjects",
        "coord": "Jana Milankovic",
        "cancel_date": "2026-03-02",
        "date": "Mar 2",
        "type": "No Show",
        "reason": "Sent text about rescheduling if interested",
        "category": "No Show"
    },
    {
        "study": "J2A-MC-GZPS",
        "study_url": "https://app.clinicalresearch.io/clinical-research-philadelphia-crp/philadelphia-pa/study/162596/subjects",
        "url": "https://app.clinicalresearch.io/clinical-research-philadelphia-crp/philadelphia-pa/study/162596/subjects",
        "name": "Mikita Mickens",
        "patient_url": "https://app.clinicalresearch.io/clinical-research-philadelphia-crp/philadelphia-pa/study/162596/subjects",
        "coord": "Jana Milankovic",
        "cancel_date": "2026-02-25",
        "date": "Mar 5",
        "type": "Patient Cancelled",
        "reason": "Not comfortable with releasing her medical records.",
        "category": "Other"
    },
    {
        "study": "J2A-MC-GZPS",
        "study_url": "https://app.clinicalresearch.io/clinical-research-philadelphia-crp/philadelphia-pa/study/162596/subjects",
        "url": "https://app.clinicalresearch.io/clinical-research-philadelphia-crp/philadelphia-pa/study/162596/subjects",
        "name": "Desiree Sommerville",
        "patient_url": "https://app.clinicalresearch.io/clinical-research-philadelphia-crp/philadelphia-pa/study/162596/subjects",
        "coord": "Ana Lambic",
        "cancel_date": "2026-02-25",
        "date": "Mar 2",
        "type": "Site Cancelled",
        "reason": "Participant does not qualify for the study as she has Overactive bladder and pelvic floor dysfunction, which are exclusionary in the study",
        "category": "Screen Fail/DNQ"
    },
    {
        "study": "M23-698",
        "study_url": "https://app.clinicalresearch.io/clinical-research-philadelphia-crp/philadelphia-pa/study/67894/subjects",
        "url": "https://app.clinicalresearch.io/clinical-research-philadelphia-crp/philadelphia-pa/study/67894/subjects",
        "name": "Regina  Santiago",
        "patient_url": "https://app.clinicalresearch.io/clinical-research-philadelphia-crp/philadelphia-pa/study/67894/subjects",
        "coord": "Mario Castellanos",
        "cancel_date": "2026-02-24",
        "date": "Feb 17",
        "type": "No Show",
        "reason": "nan",
        "category": "No Show"
    },
    {
        "study": "C4951063",
        "study_url": "https://app.clinicalresearch.io/clinical-research-philadelphia-crp/philadelphia-pa/study/135648/subjects",
        "url": "https://app.clinicalresearch.io/clinical-research-philadelphia-crp/philadelphia-pa/study/135648/subjects",
        "name": "Kristina Wilson",
        "patient_url": "https://app.clinicalresearch.io/clinical-research-philadelphia-crp/philadelphia-pa/study/135648/subjects",
        "coord": "Jana Milankovic",
        "cancel_date": "2026-02-24",
        "date": "Feb 24",
        "type": "No Show",
        "reason": "Text sent to participant about rescheduling if still interested in participating in the study",
        "category": "No Show"
    },
    {
        "study": "N1T-MC-MALO",
        "study_url": "https://app.clinicalresearch.io/clinical-research-philadelphia-crp/clinical-research-philadelphia-pennington/study/167755/subjects",
        "url": "https://app.clinicalresearch.io/clinical-research-philadelphia-crp/clinical-research-philadelphia-pennington/study/167755/subjects",
        "name": "sharon  Bagelo",
        "patient_url": "https://app.clinicalresearch.io/clinical-research-philadelphia-crp/clinical-research-philadelphia-pennington/study/167755/subjects",
        "coord": "Vlado Draganic",
        "cancel_date": "2026-02-23",
        "date": "Feb 24",
        "type": "Patient Cancelled",
        "reason": "Pt. cancelled due to weather conditions.",
        "category": "Weather"
    },
    {
        "study": "N1T-MC-MALO",
        "study_url": "https://app.clinicalresearch.io/clinical-research-philadelphia-crp/clinical-research-philadelphia-pennington/study/167755/subjects",
        "url": "https://app.clinicalresearch.io/clinical-research-philadelphia-crp/clinical-research-philadelphia-pennington/study/167755/subjects",
        "name": "William  Birch",
        "patient_url": "https://app.clinicalresearch.io/clinical-research-philadelphia-crp/clinical-research-philadelphia-pennington/study/167755/subjects",
        "coord": "Vlado Draganic",
        "cancel_date": "2026-02-23",
        "date": "Feb 23",
        "type": "Site Cancelled",
        "reason": "Site cancelled due to weather.",
        "category": "Weather"
    },
    {
        "study": "J2A-MC-GZPS",
        "study_url": "https://app.clinicalresearch.io/clinical-research-philadelphia-crp/philadelphia-pa/study/162596/subjects",
        "url": "https://app.clinicalresearch.io/clinical-research-philadelphia-crp/philadelphia-pa/study/162596/subjects",
        "name": "Shanan Olds",
        "patient_url": "https://app.clinicalresearch.io/clinical-research-philadelphia-crp/philadelphia-pa/study/162596/subjects",
        "coord": "Jana Milankovic",
        "cancel_date": "2026-02-23",
        "date": "Mar 3",
        "type": "Patient Cancelled",
        "reason": "She is no longer interested",
        "category": "Patient Withdrew"
    },
    {
        "study": "20230222",
        "study_url": "https://app.clinicalresearch.io/clinical-research-philadelphia-crp/clinical-research-philadelphia-pennington/study/167794/subjects",
        "url": "https://app.clinicalresearch.io/clinical-research-philadelphia-crp/clinical-research-philadelphia-pennington/study/167794/subjects",
        "name": "Gail Titus",
        "patient_url": "https://app.clinicalresearch.io/clinical-research-philadelphia-crp/clinical-research-philadelphia-pennington/study/167794/subjects",
        "coord": "Cady Chilensky",
        "cancel_date": "2026-02-23",
        "date": "Mar 3",
        "type": "Site Cancelled",
        "reason": "Patient needs a redraw",
        "category": "Other"
    },
    {
        "study": "J3F-MC-EZCC",
        "study_url": "https://app.clinicalresearch.io/clinical-research-philadelphia-crp/clinical-research-philadelphia-pennington/study/172389/subjects",
        "url": "https://app.clinicalresearch.io/clinical-research-philadelphia-crp/clinical-research-philadelphia-pennington/study/172389/subjects",
        "name": "Billy Stanley",
        "patient_url": "https://app.clinicalresearch.io/clinical-research-philadelphia-crp/clinical-research-philadelphia-pennington/study/172389/subjects",
        "coord": "Ema Gunic",
        "cancel_date": "2026-02-23",
        "date": "Feb 24",
        "type": "Patient Cancelled",
        "reason": "Patient is no longer interested in participation.",
        "category": "Patient Withdrew"
    },
    {
        "study": "J3F-MC-EZCC",
        "study_url": "https://app.clinicalresearch.io/clinical-research-philadelphia-crp/clinical-research-philadelphia-pennington/study/172389/subjects",
        "url": "https://app.clinicalresearch.io/clinical-research-philadelphia-crp/clinical-research-philadelphia-pennington/study/172389/subjects",
        "name": "Dulana  Thaminda Ranaweera",
        "patient_url": "https://app.clinicalresearch.io/clinical-research-philadelphia-crp/clinical-research-philadelphia-pennington/study/172389/subjects",
        "coord": "Ema Gunic",
        "cancel_date": "2026-02-23",
        "date": "Feb 23",
        "type": "Site Cancelled",
        "reason": "Site cancelled due to weather",
        "category": "Weather"
    },
    {
        "study": "20230222",
        "study_url": "https://app.clinicalresearch.io/clinical-research-philadelphia-crp/clinical-research-philadelphia-pennington/study/167794/subjects",
        "url": "https://app.clinicalresearch.io/clinical-research-philadelphia-crp/clinical-research-philadelphia-pennington/study/167794/subjects",
        "name": "David  Tipton",
        "patient_url": "https://app.clinicalresearch.io/clinical-research-philadelphia-crp/clinical-research-philadelphia-pennington/study/167794/subjects",
        "coord": "Vlado Draganic",
        "cancel_date": "2026-02-22",
        "date": "Feb 23",
        "type": "Patient Cancelled",
        "reason": "Please see note regarding upcoming health procedure.",
        "category": "Other"
    },
    {
        "study": "C4951063",
        "study_url": "https://app.clinicalresearch.io/clinical-research-philadelphia-crp/philadelphia-pa/study/135648/subjects",
        "url": "https://app.clinicalresearch.io/clinical-research-philadelphia-crp/philadelphia-pa/study/135648/subjects",
        "name": "Khadija  Butt",
        "patient_url": "https://app.clinicalresearch.io/clinical-research-philadelphia-crp/philadelphia-pa/study/135648/subjects",
        "coord": "Jana Milankovic",
        "cancel_date": "2026-02-22",
        "date": "Feb 23",
        "type": "Site Cancelled",
        "reason": "Due to snow that is expected",
        "category": "Weather"
    },
    {
        "study": "C4951063",
        "study_url": "https://app.clinicalresearch.io/clinical-research-philadelphia-crp/philadelphia-pa/study/135648/subjects",
        "url": "https://app.clinicalresearch.io/clinical-research-philadelphia-crp/philadelphia-pa/study/135648/subjects",
        "name": "Kayla  Baresich",
        "patient_url": "https://app.clinicalresearch.io/clinical-research-philadelphia-crp/philadelphia-pa/study/135648/subjects",
        "coord": "Ruby Pereira",
        "cancel_date": "2026-02-22",
        "date": "Feb 23",
        "type": "Site Cancelled",
        "reason": "Due to snow that is expected",
        "category": "Weather"
    },
    {
        "study": "20230222",
        "study_url": "https://app.clinicalresearch.io/clinical-research-philadelphia-crp/clinical-research-philadelphia-pennington/study/167794/subjects",
        "url": "https://app.clinicalresearch.io/clinical-research-philadelphia-crp/clinical-research-philadelphia-pennington/study/167794/subjects",
        "name": "Altina  Alvin",
        "patient_url": "https://app.clinicalresearch.io/clinical-research-philadelphia-crp/clinical-research-philadelphia-pennington/study/167794/subjects",
        "coord": "Angelina Mcmullen",
        "cancel_date": "2026-02-22",
        "date": "Feb 23",
        "type": "Site Cancelled",
        "reason": "Cancelled due to weather",
        "category": "Weather"
    },
    {
        "study": "C4951063",
        "study_url": "https://app.clinicalresearch.io/clinical-research-philadelphia-crp/philadelphia-pa/study/135648/subjects",
        "url": "https://app.clinicalresearch.io/clinical-research-philadelphia-crp/philadelphia-pa/study/135648/subjects",
        "name": "Heidi  Mathis",
        "patient_url": "https://app.clinicalresearch.io/clinical-research-philadelphia-crp/philadelphia-pa/study/135648/subjects",
        "coord": "Ruby Pereira",
        "cancel_date": "2026-02-20",
        "date": "Feb 26",
        "type": "Site Cancelled",
        "reason": "Participant is a screen failure",
        "category": "Screen Fail/DNQ"
    },
    {
        "study": "J3L-MC-EZEF",
        "study_url": "https://app.clinicalresearch.io/clinical-research-philadelphia-crp/philadelphia-pa/study/89175/subjects",
        "url": "https://app.clinicalresearch.io/clinical-research-philadelphia-crp/philadelphia-pa/study/89175/subjects",
        "name": "Madearia Lowery",
        "patient_url": "https://app.clinicalresearch.io/clinical-research-philadelphia-crp/philadelphia-pa/study/89175/subjects",
        "coord": "Ruby Pereira",
        "cancel_date": "2026-02-18",
        "date": "Feb 18",
        "type": "No Show",
        "reason": "subject is a no show study coordinator left two messages and sent a text",
        "category": "No Show"
    },
    {
        "study": "J2A-MC-GZPS",
        "study_url": "https://app.clinicalresearch.io/clinical-research-philadelphia-crp/philadelphia-pa/study/162596/subjects",
        "url": "https://app.clinicalresearch.io/clinical-research-philadelphia-crp/philadelphia-pa/study/162596/subjects",
        "name": "MsDidi Richardson",
        "patient_url": "https://app.clinicalresearch.io/clinical-research-philadelphia-crp/philadelphia-pa/study/162596/subjects",
        "coord": "Ana Lambic",
        "cancel_date": "2026-02-18",
        "date": "Feb 18",
        "type": "Patient Cancelled",
        "reason": "Participant has do not solicit in file",
        "category": "Other"
    },
    {
        "study": "C4951063",
        "study_url": "https://app.clinicalresearch.io/clinical-research-philadelphia-crp/philadelphia-pa/study/135648/subjects",
        "url": "https://app.clinicalresearch.io/clinical-research-philadelphia-crp/philadelphia-pa/study/135648/subjects",
        "name": "Larissa Oliveira",
        "patient_url": "https://app.clinicalresearch.io/clinical-research-philadelphia-crp/philadelphia-pa/study/135648/subjects",
        "coord": "Jana Milankovic",
        "cancel_date": "2026-02-16",
        "date": "Feb 16",
        "type": "No Show",
        "reason": "Participant was a no show text message sent about rescheduling if interested.",
        "category": "No Show"
    },
    {
        "study": "N1T-MC-MALO",
        "study_url": "https://app.clinicalresearch.io/clinical-research-philadelphia-crp/clinical-research-philadelphia-pennington/study/167755/subjects",
        "url": "https://app.clinicalresearch.io/clinical-research-philadelphia-crp/clinical-research-philadelphia-pennington/study/167755/subjects",
        "name": "Carolyn  Boxmeyer",
        "patient_url": "https://app.clinicalresearch.io/clinical-research-philadelphia-crp/clinical-research-philadelphia-pennington/study/167755/subjects",
        "coord": "Vlado Draganic",
        "cancel_date": "2026-02-13",
        "date": "Feb 13",
        "type": "Site Cancelled",
        "reason": "scheduled under Christine",
        "category": "Other"
    },
    {
        "study": "J2A-MC-GZPS",
        "study_url": "https://app.clinicalresearch.io/clinical-research-philadelphia-crp/philadelphia-pa/study/162596/subjects",
        "url": "https://app.clinicalresearch.io/clinical-research-philadelphia-crp/philadelphia-pa/study/162596/subjects",
        "name": "Marion Groarke",
        "patient_url": "https://app.clinicalresearch.io/clinical-research-philadelphia-crp/philadelphia-pa/study/162596/subjects",
        "coord": "Gabrijela Ateljevic",
        "cancel_date": "2026-02-12",
        "date": "Mar 10",
        "type": "Patient Cancelled",
        "reason": "Participant cancelled due to starting a new job.",
        "category": "Other"
    },
    {
        "study": "M23-714",
        "study_url": "https://app.clinicalresearch.io/clinical-research-philadelphia-crp/philadelphia-pa/study/86826/subjects",
        "url": "https://app.clinicalresearch.io/clinical-research-philadelphia-crp/philadelphia-pa/study/86826/subjects",
        "name": "Leilani Leilani",
        "patient_url": "https://app.clinicalresearch.io/clinical-research-philadelphia-crp/philadelphia-pa/study/86826/subjects",
        "coord": "Jana Milankovic",
        "cancel_date": "2026-02-12",
        "date": "Feb 18",
        "type": "Site Cancelled",
        "reason": "Study is closed and patient is unresponsive",
        "category": "Other"
    },
    {
        "study": "N1T-MC-MALO",
        "study_url": "https://app.clinicalresearch.io/clinical-research-philadelphia-crp/clinical-research-philadelphia-pennington/study/167755/subjects",
        "url": "https://app.clinicalresearch.io/clinical-research-philadelphia-crp/clinical-research-philadelphia-pennington/study/167755/subjects",
        "name": "Shana  Barreto",
        "patient_url": "https://app.clinicalresearch.io/clinical-research-philadelphia-crp/clinical-research-philadelphia-pennington/study/167755/subjects",
        "coord": "Angelina Mcmullen",
        "cancel_date": "2026-02-11",
        "date": "Feb 13",
        "type": "Site Cancelled",
        "reason": "She was a screen fail at Visit 1",
        "category": "Screen Fail/DNQ"
    },
    {
        "study": "J2A-MC-GZPS",
        "study_url": "https://app.clinicalresearch.io/clinical-research-philadelphia-crp/philadelphia-pa/study/162596/subjects",
        "url": "https://app.clinicalresearch.io/clinical-research-philadelphia-crp/philadelphia-pa/study/162596/subjects",
        "name": "Stephanie Fortune-Beard",
        "patient_url": "https://app.clinicalresearch.io/clinical-research-philadelphia-crp/philadelphia-pa/study/162596/subjects",
        "coord": "Jana Milankovic",
        "cancel_date": "2026-02-11",
        "date": "Feb 11",
        "type": "No Show",
        "reason": "no show left text message about rescheduling if interested in participating.",
        "category": "No Show"
    },
    {
        "study": "MR-130A-01-TD-3001",
        "study_url": "https://app.clinicalresearch.io/clinical-research-philadelphia-crp/philadelphia-pa/study/109260/subjects",
        "url": "https://app.clinicalresearch.io/clinical-research-philadelphia-crp/philadelphia-pa/study/109260/subjects",
        "name": "Keegan  Mcloughlin",
        "patient_url": "https://app.clinicalresearch.io/clinical-research-philadelphia-crp/philadelphia-pa/study/109260/subjects",
        "coord": "Jana Milankovic",
        "cancel_date": "2026-02-10",
        "date": "Feb 10",
        "type": "No Show",
        "reason": "Text message sent participant was a no show",
        "category": "No Show"
    },
    {
        "study": "N1T-MC-MALO",
        "study_url": "https://app.clinicalresearch.io/clinical-research-philadelphia-crp/clinical-research-philadelphia-pennington/study/167755/subjects",
        "url": "https://app.clinicalresearch.io/clinical-research-philadelphia-crp/clinical-research-philadelphia-pennington/study/167755/subjects",
        "name": "Andrew  M Shekhar",
        "patient_url": "https://app.clinicalresearch.io/clinical-research-philadelphia-crp/clinical-research-philadelphia-pennington/study/167755/subjects",
        "coord": "Angelina Mcmullen",
        "cancel_date": "2026-02-10",
        "date": "Feb 19",
        "type": "Site Cancelled",
        "reason": "Scheduled in error",
        "category": "Other"
    },
    {
        "study": "J3F-MC-EZCC",
        "study_url": "https://app.clinicalresearch.io/clinical-research-philadelphia-crp/clinical-research-philadelphia-pennington/study/172389/subjects",
        "url": "https://app.clinicalresearch.io/clinical-research-philadelphia-crp/clinical-research-philadelphia-pennington/study/172389/subjects",
        "name": "Srinivas LS",
        "patient_url": "https://app.clinicalresearch.io/clinical-research-philadelphia-crp/clinical-research-philadelphia-pennington/study/172389/subjects",
        "coord": "Ema Gunic",
        "cancel_date": "2026-02-10",
        "date": "Feb 26",
        "type": "Site Cancelled",
        "reason": "According to his medical records, the patient is enrolled in another clinical trial.",
        "category": "Other"
    },
    {
        "study": "D6973C00001",
        "study_url": "https://app.clinicalresearch.io/clinical-research-philadelphia-crp/clinical-research-philadelphia-pennington/study/161619/subjects",
        "url": "https://app.clinicalresearch.io/clinical-research-philadelphia-crp/clinical-research-philadelphia-pennington/study/161619/subjects",
        "name": "Larry Jordan",
        "patient_url": "https://app.clinicalresearch.io/clinical-research-philadelphia-crp/clinical-research-philadelphia-pennington/study/161619/subjects",
        "coord": "Ema Gunic",
        "cancel_date": "2026-02-09",
        "date": "Feb 9",
        "type": "No Show",
        "reason": "subject was a no show study coordinator called the participant and sent text message",
        "category": "No Show"
    },
    {
        "study": "D7960C00015",
        "study_url": "https://app.clinicalresearch.io/clinical-research-philadelphia-crp/philadelphia-pa/study/154462/subjects",
        "url": "https://app.clinicalresearch.io/clinical-research-philadelphia-crp/philadelphia-pa/study/154462/subjects",
        "name": "Gilbert Monte",
        "patient_url": "https://app.clinicalresearch.io/clinical-research-philadelphia-crp/philadelphia-pa/study/154462/subjects",
        "coord": "Stacey Scott",
        "cancel_date": "2026-02-06",
        "date": "Feb 23",
        "type": "Site Cancelled",
        "reason": "subject is a screen fail per PI inclusion 1A",
        "category": "Screen Fail/DNQ"
    },
    {
        "study": "MR-130A-01-TD-3001",
        "study_url": "https://app.clinicalresearch.io/clinical-research-philadelphia-crp/philadelphia-pa/study/109260/subjects",
        "url": "https://app.clinicalresearch.io/clinical-research-philadelphia-crp/philadelphia-pa/study/109260/subjects",
        "name": "Janae  Rockemore",
        "patient_url": "https://app.clinicalresearch.io/clinical-research-philadelphia-crp/philadelphia-pa/study/109260/subjects",
        "coord": "Ruby Pereira",
        "cancel_date": "2026-02-05",
        "date": "Feb 5",
        "type": "No Show",
        "reason": "LM and text message sent to reschedule missed appt",
        "category": "No Show"
    },
    {
        "study": "J1G-MC-LAKI",
        "study_url": "https://app.clinicalresearch.io/clinical-research-philadelphia-crp/philadelphia-pa/study/119640/subjects",
        "url": "https://app.clinicalresearch.io/clinical-research-philadelphia-crp/philadelphia-pa/study/119640/subjects",
        "name": "Patricia  Garland",
        "patient_url": "https://app.clinicalresearch.io/clinical-research-philadelphia-crp/philadelphia-pa/study/119640/subjects",
        "coord": "Ruby Pereira",
        "cancel_date": "2026-02-05",
        "date": "Feb 11",
        "type": "Site Cancelled",
        "reason": "Participant needs to have CDR done prior to injection",
        "category": "Other"
    },
    {
        "study": "D7960C00015",
        "study_url": "https://app.clinicalresearch.io/clinical-research-philadelphia-crp/philadelphia-pa/study/154462/subjects",
        "url": "https://app.clinicalresearch.io/clinical-research-philadelphia-crp/philadelphia-pa/study/154462/subjects",
        "name": "David Rochlis",
        "patient_url": "https://app.clinicalresearch.io/clinical-research-philadelphia-crp/philadelphia-pa/study/154462/subjects",
        "coord": "Stacey Scott",
        "cancel_date": "2026-02-04",
        "date": "Feb 17",
        "type": "Site Cancelled",
        "reason": "SUBJECT IS A SCREEN FAIL",
        "category": "Screen Fail/DNQ"
    },
    {
        "study": "J2A-MC-GZPS",
        "study_url": "https://app.clinicalresearch.io/clinical-research-philadelphia-crp/philadelphia-pa/study/162596/subjects",
        "url": "https://app.clinicalresearch.io/clinical-research-philadelphia-crp/philadelphia-pa/study/162596/subjects",
        "name": "Mitzi S",
        "patient_url": "https://app.clinicalresearch.io/clinical-research-philadelphia-crp/philadelphia-pa/study/162596/subjects",
        "coord": "Jana Milankovic",
        "cancel_date": "2026-02-04",
        "date": "Feb 4",
        "type": "No Show",
        "reason": "No show LM about rescheduling if still interested in Participating the study",
        "category": "No Show"
    },
    {
        "study": "J2A-MC-GZPS",
        "study_url": "https://app.clinicalresearch.io/clinical-research-philadelphia-crp/philadelphia-pa/study/162596/subjects",
        "url": "https://app.clinicalresearch.io/clinical-research-philadelphia-crp/philadelphia-pa/study/162596/subjects",
        "name": "Joanne Gebhardt",
        "patient_url": "https://app.clinicalresearch.io/clinical-research-philadelphia-crp/philadelphia-pa/study/162596/subjects",
        "coord": "Jana Milankovic",
        "cancel_date": "2026-02-03",
        "date": "Feb 3",
        "type": "No Show",
        "reason": "Participant was a no show, text message sent",
        "category": "No Show"
    },
    {
        "study": "M20-465",
        "study_url": "https://app.clinicalresearch.io/clinical-research-philadelphia-crp/philadelphia-pa/study/107641/subjects",
        "url": "https://app.clinicalresearch.io/clinical-research-philadelphia-crp/philadelphia-pa/study/107641/subjects",
        "name": "Kirshna  Hillyard",
        "patient_url": "https://app.clinicalresearch.io/clinical-research-philadelphia-crp/philadelphia-pa/study/107641/subjects",
        "coord": "Mario Castellanos",
        "cancel_date": "2026-02-03",
        "date": "Feb 3",
        "type": "No Show",
        "reason": "nan",
        "category": "No Show"
    },
    {
        "study": "J2A-MC-GZPS",
        "study_url": "https://app.clinicalresearch.io/clinical-research-philadelphia-crp/philadelphia-pa/study/162596/subjects",
        "url": "https://app.clinicalresearch.io/clinical-research-philadelphia-crp/philadelphia-pa/study/162596/subjects",
        "name": "Julie Dowburd",
        "patient_url": "https://app.clinicalresearch.io/clinical-research-philadelphia-crp/philadelphia-pa/study/162596/subjects",
        "coord": "Jana Milankovic",
        "cancel_date": "2026-02-02",
        "date": "Feb 19",
        "type": "Site Cancelled",
        "reason": "After reviewing her Med records Lita told us that she DNQ",
        "category": "Screen Fail/DNQ"
    },
    {
        "study": "J2A-MC-GZPS",
        "study_url": "https://app.clinicalresearch.io/clinical-research-philadelphia-crp/philadelphia-pa/study/162596/subjects",
        "url": "https://app.clinicalresearch.io/clinical-research-philadelphia-crp/philadelphia-pa/study/162596/subjects",
        "name": "Sydney McMillan",
        "patient_url": "https://app.clinicalresearch.io/clinical-research-philadelphia-crp/philadelphia-pa/study/162596/subjects",
        "coord": "Jana Milankovic",
        "cancel_date": "2026-02-02",
        "date": "Feb 26",
        "type": "Site Cancelled",
        "reason": "After reviewing her MR Lita told us she DNQ",
        "category": "Screen Fail/DNQ"
    },
    {
        "study": "J2A-MC-GZPS",
        "study_url": "https://app.clinicalresearch.io/clinical-research-philadelphia-crp/philadelphia-pa/study/162596/subjects",
        "url": "https://app.clinicalresearch.io/clinical-research-philadelphia-crp/philadelphia-pa/study/162596/subjects",
        "name": "shareda Copps",
        "patient_url": "https://app.clinicalresearch.io/clinical-research-philadelphia-crp/philadelphia-pa/study/162596/subjects",
        "coord": "Ana Lambic",
        "cancel_date": "2026-02-02",
        "date": "Feb 2",
        "type": "No Show",
        "reason": "No show, left text message about rescheduling",
        "category": "No Show"
    },
    {
        "study": "MR-130A-01-TD-3001",
        "study_url": "https://app.clinicalresearch.io/clinical-research-philadelphia-crp/philadelphia-pa/study/109260/subjects",
        "url": "https://app.clinicalresearch.io/clinical-research-philadelphia-crp/philadelphia-pa/study/109260/subjects",
        "name": "Diyona  Hawkins",
        "patient_url": "https://app.clinicalresearch.io/clinical-research-philadelphia-crp/philadelphia-pa/study/109260/subjects",
        "coord": "Ruby Pereira",
        "cancel_date": "2026-01-29",
        "date": "Jan 29",
        "type": "No Show",
        "reason": "Participant was a no show. LM about rescheduling appt",
        "category": "No Show"
    },
    {
        "study": "C4951063",
        "study_url": "https://app.clinicalresearch.io/clinical-research-philadelphia-crp/philadelphia-pa/study/135648/subjects",
        "url": "https://app.clinicalresearch.io/clinical-research-philadelphia-crp/philadelphia-pa/study/135648/subjects",
        "name": "Jennifer  Hopkins",
        "patient_url": "https://app.clinicalresearch.io/clinical-research-philadelphia-crp/philadelphia-pa/study/135648/subjects",
        "coord": "Jana Milankovic",
        "cancel_date": "2026-01-28",
        "date": "Jan 28",
        "type": "No Show",
        "reason": "No show, Left text message",
        "category": "No Show"
    },
    {
        "study": "J2A-MC-GZPS",
        "study_url": "https://app.clinicalresearch.io/clinical-research-philadelphia-crp/philadelphia-pa/study/162596/subjects",
        "url": "https://app.clinicalresearch.io/clinical-research-philadelphia-crp/philadelphia-pa/study/162596/subjects",
        "name": "Melissa Kingkiner",
        "patient_url": "https://app.clinicalresearch.io/clinical-research-philadelphia-crp/philadelphia-pa/study/162596/subjects",
        "coord": "Jana Milankovic",
        "cancel_date": "2026-01-28",
        "date": "Jan 28",
        "type": "No Show",
        "reason": "No show, text message sent if interested in rescheduling.",
        "category": "No Show"
    },
    {
        "study": "M20-465",
        "study_url": "https://app.clinicalresearch.io/clinical-research-philadelphia-crp/philadelphia-pa/study/107641/subjects",
        "url": "https://app.clinicalresearch.io/clinical-research-philadelphia-crp/philadelphia-pa/study/107641/subjects",
        "name": "Davia  Jones",
        "patient_url": "https://app.clinicalresearch.io/clinical-research-philadelphia-crp/philadelphia-pa/study/107641/subjects",
        "coord": "Mario Castellanos",
        "cancel_date": "2026-01-28",
        "date": "Jan 28",
        "type": "Patient Cancelled",
        "reason": "Discontinued",
        "category": "Discontinued"
    },
    {
        "study": "J2A-MC-GZPS",
        "study_url": "https://app.clinicalresearch.io/clinical-research-philadelphia-crp/philadelphia-pa/study/162596/subjects",
        "url": "https://app.clinicalresearch.io/clinical-research-philadelphia-crp/philadelphia-pa/study/162596/subjects",
        "name": "Jill  Hurtado",
        "patient_url": "https://app.clinicalresearch.io/clinical-research-philadelphia-crp/philadelphia-pa/study/162596/subjects",
        "coord": "Gabrijela Ateljevic",
        "cancel_date": "2026-01-27",
        "date": "Jan 27",
        "type": "No Show",
        "reason": "Participant was a no show, text message sent",
        "category": "No Show"
    },
    {
        "study": "N1T-MC-MALO",
        "study_url": "https://app.clinicalresearch.io/clinical-research-philadelphia-crp/clinical-research-philadelphia-pennington/study/167755/subjects",
        "url": "https://app.clinicalresearch.io/clinical-research-philadelphia-crp/clinical-research-philadelphia-pennington/study/167755/subjects",
        "name": "Daniel Howard",
        "patient_url": "https://app.clinicalresearch.io/clinical-research-philadelphia-crp/clinical-research-philadelphia-pennington/study/167755/subjects",
        "coord": "Angelina Mcmullen",
        "cancel_date": "2026-01-23",
        "date": "Jan 23",
        "type": "Patient Cancelled",
        "reason": "The patient cancelled without explanation.",
        "category": "Other"
    },
    {
        "study": "M20-465",
        "study_url": "https://app.clinicalresearch.io/clinical-research-philadelphia-crp/philadelphia-pa/study/107641/subjects",
        "url": "https://app.clinicalresearch.io/clinical-research-philadelphia-crp/philadelphia-pa/study/107641/subjects",
        "name": "Christopher  Glenn",
        "patient_url": "https://app.clinicalresearch.io/clinical-research-philadelphia-crp/philadelphia-pa/study/107641/subjects",
        "coord": "Gabrijela Ateljevic",
        "cancel_date": "2026-01-22",
        "date": "Jan 22",
        "type": "No Show",
        "reason": "nan",
        "category": "No Show"
    },
    {
        "study": "C4951063",
        "study_url": "https://app.clinicalresearch.io/clinical-research-philadelphia-crp/philadelphia-pa/study/135648/subjects",
        "url": "https://app.clinicalresearch.io/clinical-research-philadelphia-crp/philadelphia-pa/study/135648/subjects",
        "name": "Kayla  Baresich",
        "patient_url": "https://app.clinicalresearch.io/clinical-research-philadelphia-crp/philadelphia-pa/study/135648/subjects",
        "coord": "Jana Milankovic",
        "cancel_date": "2026-01-22",
        "date": "Jan 26",
        "type": "Site Cancelled",
        "reason": "Canceled because of weather",
        "category": "Weather"
    },
    {
        "study": "C4951063",
        "study_url": "https://app.clinicalresearch.io/clinical-research-philadelphia-crp/philadelphia-pa/study/135648/subjects",
        "url": "https://app.clinicalresearch.io/clinical-research-philadelphia-crp/philadelphia-pa/study/135648/subjects",
        "name": "Alyssa Giungo",
        "patient_url": "https://app.clinicalresearch.io/clinical-research-philadelphia-crp/philadelphia-pa/study/135648/subjects",
        "coord": "Jana Milankovic",
        "cancel_date": "2026-01-21",
        "date": "Jan 21",
        "type": "No Show",
        "reason": "Mailbox full unable to LM",
        "category": "No Show"
    },
    {
        "study": "C4951063",
        "study_url": "https://app.clinicalresearch.io/clinical-research-philadelphia-crp/philadelphia-pa/study/135648/subjects",
        "url": "https://app.clinicalresearch.io/clinical-research-philadelphia-crp/philadelphia-pa/study/135648/subjects",
        "name": "Kimberly blossom",
        "patient_url": "https://app.clinicalresearch.io/clinical-research-philadelphia-crp/philadelphia-pa/study/135648/subjects",
        "coord": "Jana Milankovic",
        "cancel_date": "2026-01-21",
        "date": "Jan 22",
        "type": "Site Cancelled",
        "reason": "After reviewing MR she has autoimmune neurological disorder",
        "category": "Screen Fail/DNQ"
    },
    {
        "study": "D7960C00015",
        "study_url": "https://app.clinicalresearch.io/clinical-research-philadelphia-crp/philadelphia-pa/study/154462/subjects",
        "url": "https://app.clinicalresearch.io/clinical-research-philadelphia-crp/philadelphia-pa/study/154462/subjects",
        "name": "Pamela Gallagher",
        "patient_url": "https://app.clinicalresearch.io/clinical-research-philadelphia-crp/philadelphia-pa/study/154462/subjects",
        "coord": "Gabrijela Ateljevic",
        "cancel_date": "2026-01-21",
        "date": "Jan 21",
        "type": "Site Cancelled",
        "reason": "She was rescheduled for today at 9:30, but she didn't show up. Study coordinator left voice mail and sent text message",
        "category": "No Show"
    },
    {
        "study": "N1T-MC-MALO",
        "study_url": "https://app.clinicalresearch.io/clinical-research-philadelphia-crp/clinical-research-philadelphia-pennington/study/167755/subjects",
        "url": "https://app.clinicalresearch.io/clinical-research-philadelphia-crp/clinical-research-philadelphia-pennington/study/167755/subjects",
        "name": "Darryl  Pringle",
        "patient_url": "https://app.clinicalresearch.io/clinical-research-philadelphia-crp/clinical-research-philadelphia-pennington/study/167755/subjects",
        "coord": "Aneesh Vaze",
        "cancel_date": "2026-01-21",
        "date": "Jan 21",
        "type": "Site Cancelled",
        "reason": "Site cancelled. No reasons noted",
        "category": "Not Documented"
    },
    {
        "study": "D7960C00015",
        "study_url": "https://app.clinicalresearch.io/clinical-research-philadelphia-crp/philadelphia-pa/study/154462/subjects",
        "url": "https://app.clinicalresearch.io/clinical-research-philadelphia-crp/philadelphia-pa/study/154462/subjects",
        "name": "Bill Kaufman",
        "patient_url": "https://app.clinicalresearch.io/clinical-research-philadelphia-crp/philadelphia-pa/study/154462/subjects",
        "coord": "Jana Milankovic",
        "cancel_date": "2026-01-20",
        "date": "Jan 30",
        "type": "Site Cancelled",
        "reason": "Pt does not qualify",
        "category": "Screen Fail/DNQ"
    },
    {
        "study": "D6973C00001",
        "study_url": "https://app.clinicalresearch.io/clinical-research-philadelphia-crp/clinical-research-philadelphia-pennington/study/161619/subjects",
        "url": "https://app.clinicalresearch.io/clinical-research-philadelphia-crp/clinical-research-philadelphia-pennington/study/161619/subjects",
        "name": "Renetta  Kinniebrew",
        "patient_url": "https://app.clinicalresearch.io/clinical-research-philadelphia-crp/clinical-research-philadelphia-pennington/study/161619/subjects",
        "coord": "Angelina Mcmullen",
        "cancel_date": "2026-01-20",
        "date": "Jan 21",
        "type": "Site Cancelled",
        "reason": "Pending guidance from Sponsor about re-screening since participant was screened failed at Philadelpiha, PA site",
        "category": "Other"
    },
    {
        "study": "N1T-MC-MALO",
        "study_url": "https://app.clinicalresearch.io/clinical-research-philadelphia-crp/clinical-research-philadelphia-pennington/study/167755/subjects",
        "url": "https://app.clinicalresearch.io/clinical-research-philadelphia-crp/clinical-research-philadelphia-pennington/study/167755/subjects",
        "name": "Mehrdad  Zoroufi",
        "patient_url": "https://app.clinicalresearch.io/clinical-research-philadelphia-crp/clinical-research-philadelphia-pennington/study/167755/subjects",
        "coord": "Ema Gunic",
        "cancel_date": "2026-01-19",
        "date": "Jan 22",
        "type": "Patient Cancelled",
        "reason": "Patient Not satisfied with compensation, does not wish to participate any longer.",
        "category": "Other"
    },
    {
        "study": "80202135SLE3001",
        "study_url": "https://app.clinicalresearch.io/clinical-research-philadelphia-crp/philadelphia-pa/study/177553/subjects",
        "url": "https://app.clinicalresearch.io/clinical-research-philadelphia-crp/philadelphia-pa/study/177553/subjects",
        "name": "Gina Wilson",
        "patient_url": "https://app.clinicalresearch.io/clinical-research-philadelphia-crp/philadelphia-pa/study/177553/subjects",
        "coord": "Jana Milankovic",
        "cancel_date": "2026-01-16",
        "date": "Jan 16",
        "type": "Site Cancelled",
        "reason": "Scheduled in error.",
        "category": "Other"
    },
    {
        "study": "N1T-MC-MALO",
        "study_url": "https://app.clinicalresearch.io/clinical-research-philadelphia-crp/clinical-research-philadelphia-pennington/study/167755/subjects",
        "url": "https://app.clinicalresearch.io/clinical-research-philadelphia-crp/clinical-research-philadelphia-pennington/study/167755/subjects",
        "name": "Cindy Oleck",
        "patient_url": "https://app.clinicalresearch.io/clinical-research-philadelphia-crp/clinical-research-philadelphia-pennington/study/167755/subjects",
        "coord": "Automated System",
        "cancel_date": "2026-01-15",
        "date": "Jan 16",
        "type": "Site Cancelled",
        "reason": "Cancelled due to exclusion criteria - She had a Adenocarcinoma in 2023 and it was metastasized",
        "category": "Screen Fail/DNQ"
    },
    {
        "study": "D7960C00015",
        "study_url": "https://app.clinicalresearch.io/clinical-research-philadelphia-crp/philadelphia-pa/study/154462/subjects",
        "url": "https://app.clinicalresearch.io/clinical-research-philadelphia-crp/philadelphia-pa/study/154462/subjects",
        "name": "Pamela Gallagher",
        "patient_url": "https://app.clinicalresearch.io/clinical-research-philadelphia-crp/philadelphia-pa/study/154462/subjects",
        "coord": "Gabrijela Ateljevic",
        "cancel_date": "2026-01-15",
        "date": "Jan 15",
        "type": "No Show",
        "reason": "SUBJECT DID NOT SHOW FOR APPOINTMENT",
        "category": "No Show"
    },
    {
        "study": "J2A-MC-GZPS",
        "study_url": "https://app.clinicalresearch.io/clinical-research-philadelphia-crp/philadelphia-pa/study/162596/subjects",
        "url": "https://app.clinicalresearch.io/clinical-research-philadelphia-crp/philadelphia-pa/study/162596/subjects",
        "name": "Jacquelyn F Amer",
        "patient_url": "https://app.clinicalresearch.io/clinical-research-philadelphia-crp/philadelphia-pa/study/162596/subjects",
        "coord": "Ruby Pereira",
        "cancel_date": "2026-01-15",
        "date": "Jan 15",
        "type": "No Show",
        "reason": "Participant does not qualify for the study",
        "category": "Screen Fail/DNQ"
    },
    {
        "study": "J2A-MC-GZPS",
        "study_url": "https://app.clinicalresearch.io/clinical-research-philadelphia-crp/philadelphia-pa/study/162596/subjects",
        "url": "https://app.clinicalresearch.io/clinical-research-philadelphia-crp/philadelphia-pa/study/162596/subjects",
        "name": "Donna  Virden",
        "patient_url": "https://app.clinicalresearch.io/clinical-research-philadelphia-crp/philadelphia-pa/study/162596/subjects",
        "coord": "Jana Milankovic",
        "cancel_date": "2026-01-15",
        "date": "Jan 15",
        "type": "Site Cancelled",
        "reason": "Participant did not sign consent is on an excluded medication",
        "category": "Other"
    },
    {
        "study": "J3L-MC-EZEF",
        "study_url": "https://app.clinicalresearch.io/clinical-research-philadelphia-crp/philadelphia-pa/study/89175/subjects",
        "url": "https://app.clinicalresearch.io/clinical-research-philadelphia-crp/philadelphia-pa/study/89175/subjects",
        "name": "Fred  Early",
        "patient_url": "https://app.clinicalresearch.io/clinical-research-philadelphia-crp/philadelphia-pa/study/89175/subjects",
        "coord": "Ruby Pereira",
        "cancel_date": "2026-01-14",
        "date": "Jan 14",
        "type": "No Show",
        "reason": "Text message sent about missed appointment",
        "category": "No Show"
    },
    {
        "study": "J2A-MC-GZPS",
        "study_url": "https://app.clinicalresearch.io/clinical-research-philadelphia-crp/philadelphia-pa/study/162596/subjects",
        "url": "https://app.clinicalresearch.io/clinical-research-philadelphia-crp/philadelphia-pa/study/162596/subjects",
        "name": "LaMonika  Koley",
        "patient_url": "https://app.clinicalresearch.io/clinical-research-philadelphia-crp/philadelphia-pa/study/162596/subjects",
        "coord": "Jana Milankovic",
        "cancel_date": "2026-01-14",
        "date": "Jan 14",
        "type": "No Show",
        "reason": "text message sent about missed appt and to reschedule if interested.",
        "category": "No Show"
    },
    {
        "study": "J2A-MC-GZGS",
        "study_url": "https://app.clinicalresearch.io/clinical-research-philadelphia-crp/philadelphia-pa/study/60296/subjects",
        "url": "https://app.clinicalresearch.io/clinical-research-philadelphia-crp/philadelphia-pa/study/60296/subjects",
        "name": "Eloise  Browder",
        "patient_url": "https://app.clinicalresearch.io/clinical-research-philadelphia-crp/philadelphia-pa/study/60296/subjects",
        "coord": "Stacey Scott",
        "cancel_date": "2026-01-13",
        "date": "Jun 16",
        "type": "Site Cancelled",
        "reason": "She was rescheduled for today at 9:30, but she didn't show up. Study coordinator left voice mail and sent text message",
        "category": "No Show"
    },
    {
        "study": "J2A-MC-GZGS",
        "study_url": "https://app.clinicalresearch.io/clinical-research-philadelphia-crp/philadelphia-pa/study/60296/subjects",
        "url": "https://app.clinicalresearch.io/clinical-research-philadelphia-crp/philadelphia-pa/study/60296/subjects",
        "name": "DARREN  CATHEY",
        "patient_url": "https://app.clinicalresearch.io/clinical-research-philadelphia-crp/philadelphia-pa/study/60296/subjects",
        "coord": "Stacey Scott",
        "cancel_date": "2026-01-13",
        "date": "Apr 13",
        "type": "Site Cancelled",
        "reason": "SCHEULED LTV",
        "category": "Other"
    },
    {
        "study": "J2A-MC-GZPS",
        "study_url": "https://app.clinicalresearch.io/clinical-research-philadelphia-crp/philadelphia-pa/study/162596/subjects",
        "url": "https://app.clinicalresearch.io/clinical-research-philadelphia-crp/philadelphia-pa/study/162596/subjects",
        "name": "Jovon Thompson",
        "patient_url": "https://app.clinicalresearch.io/clinical-research-philadelphia-crp/philadelphia-pa/study/162596/subjects",
        "coord": "Gabrijela Ateljevic",
        "cancel_date": "2026-01-13",
        "date": "Jan 13",
        "type": "No Show",
        "reason": "no show text message sent about missed appt",
        "category": "No Show"
    },
    {
        "study": "D6973C00001",
        "study_url": "https://app.clinicalresearch.io/clinical-research-philadelphia-crp/clinical-research-philadelphia-pennington/study/161619/subjects",
        "url": "https://app.clinicalresearch.io/clinical-research-philadelphia-crp/clinical-research-philadelphia-pennington/study/161619/subjects",
        "name": "Patricia Gallagher",
        "patient_url": "https://app.clinicalresearch.io/clinical-research-philadelphia-crp/clinical-research-philadelphia-pennington/study/161619/subjects",
        "coord": "Gabrijela Ateljevic",
        "cancel_date": "2026-01-13",
        "date": "Jan 19",
        "type": "Patient Cancelled",
        "reason": "Patient cancelled due to injury",
        "category": "Other"
    },
    {
        "study": "N1T-MC-MALO",
        "study_url": "https://app.clinicalresearch.io/clinical-research-philadelphia-crp/clinical-research-philadelphia-pennington/study/167755/subjects",
        "url": "https://app.clinicalresearch.io/clinical-research-philadelphia-crp/clinical-research-philadelphia-pennington/study/167755/subjects",
        "name": "Ryan  Romero",
        "patient_url": "https://app.clinicalresearch.io/clinical-research-philadelphia-crp/clinical-research-philadelphia-pennington/study/167755/subjects",
        "coord": "Ema Gunic",
        "cancel_date": "2026-01-13",
        "date": "Jan 13",
        "type": "No Show",
        "reason": "nan",
        "category": "No Show"
    },
    {
        "study": "C4951063",
        "study_url": "https://app.clinicalresearch.io/clinical-research-philadelphia-crp/philadelphia-pa/study/135648/subjects",
        "url": "https://app.clinicalresearch.io/clinical-research-philadelphia-crp/philadelphia-pa/study/135648/subjects",
        "name": "Jenn  Bernard",
        "patient_url": "https://app.clinicalresearch.io/clinical-research-philadelphia-crp/philadelphia-pa/study/135648/subjects",
        "coord": "Jana Milankovic",
        "cancel_date": "2026-01-13",
        "date": "Jan 13",
        "type": "No Show",
        "reason": "Text message sent about missed appt",
        "category": "No Show"
    },
    {
        "study": "J2A-MC-GZPO",
        "study_url": "https://app.clinicalresearch.io/clinical-research-philadelphia-crp/philadelphia-pa/study/135157/subjects",
        "url": "https://app.clinicalresearch.io/clinical-research-philadelphia-crp/philadelphia-pa/study/135157/subjects",
        "name": "Kevin  Sheils",
        "patient_url": "https://app.clinicalresearch.io/clinical-research-philadelphia-crp/philadelphia-pa/study/135157/subjects",
        "coord": "Ema Gunic",
        "cancel_date": "2026-01-12",
        "date": "Jan 21",
        "type": "Site Cancelled",
        "reason": "Study is closed",
        "category": "Other"
    },
    {
        "study": "D6973C00001",
        "study_url": "https://app.clinicalresearch.io/clinical-research-philadelphia-crp/clinical-research-philadelphia-pennington/study/161619/subjects",
        "url": "https://app.clinicalresearch.io/clinical-research-philadelphia-crp/clinical-research-philadelphia-pennington/study/161619/subjects",
        "name": "Donald Garber",
        "patient_url": "https://app.clinicalresearch.io/clinical-research-philadelphia-crp/clinical-research-philadelphia-pennington/study/161619/subjects",
        "coord": "Stacey Scott",
        "cancel_date": "2026-01-12",
        "date": "Jan 19",
        "type": "Patient Cancelled",
        "reason": "subject withdrew consent called site and stated he coukld not make study scheduled appointments and refuses to return study drug",
        "category": "Patient Withdrew"
    },
    {
        "study": "C4951063",
        "study_url": "https://app.clinicalresearch.io/clinical-research-philadelphia-crp/philadelphia-pa/study/135648/subjects",
        "url": "https://app.clinicalresearch.io/clinical-research-philadelphia-crp/philadelphia-pa/study/135648/subjects",
        "name": "Tiffany Baldwin",
        "patient_url": "https://app.clinicalresearch.io/clinical-research-philadelphia-crp/philadelphia-pa/study/135648/subjects",
        "coord": "Jana Milankovic",
        "cancel_date": "2026-01-12",
        "date": "Jan 12",
        "type": "No Show",
        "reason": "Participant never reached back with address to schedule Lyft ride",
        "category": "No Show"
    },
    {
        "study": "J2A-MC-GZPS",
        "study_url": "https://app.clinicalresearch.io/clinical-research-philadelphia-crp/philadelphia-pa/study/162596/subjects",
        "url": "https://app.clinicalresearch.io/clinical-research-philadelphia-crp/philadelphia-pa/study/162596/subjects",
        "name": "Mary Dingle",
        "patient_url": "https://app.clinicalresearch.io/clinical-research-philadelphia-crp/philadelphia-pa/study/162596/subjects",
        "coord": "Jana Milankovic",
        "cancel_date": "2026-01-12",
        "date": "Jan 12",
        "type": "No Show",
        "reason": "No show for appt text message sent",
        "category": "No Show"
    },
    {
        "study": "J2A-MC-GZPO",
        "study_url": "https://app.clinicalresearch.io/clinical-research-philadelphia-crp/philadelphia-pa/study/135157/subjects",
        "url": "https://app.clinicalresearch.io/clinical-research-philadelphia-crp/philadelphia-pa/study/135157/subjects",
        "name": "David  Thomas",
        "patient_url": "https://app.clinicalresearch.io/clinical-research-philadelphia-crp/philadelphia-pa/study/135157/subjects",
        "coord": "Ema Gunic",
        "cancel_date": "2026-01-12",
        "date": "Jan 22",
        "type": "Site Cancelled",
        "reason": "Study is closed",
        "category": "Other"
    },
    {
        "study": "J2A-MC-GZPO",
        "study_url": "https://app.clinicalresearch.io/clinical-research-philadelphia-crp/philadelphia-pa/study/135157/subjects",
        "url": "https://app.clinicalresearch.io/clinical-research-philadelphia-crp/philadelphia-pa/study/135157/subjects",
        "name": "Joann  Frazier",
        "patient_url": "https://app.clinicalresearch.io/clinical-research-philadelphia-crp/philadelphia-pa/study/135157/subjects",
        "coord": "Ema Gunic",
        "cancel_date": "2026-01-12",
        "date": "Jan 19",
        "type": "Site Cancelled",
        "reason": "Study is closed",
        "category": "Other"
    },
    {
        "study": "N1T-MC-MALO",
        "study_url": "https://app.clinicalresearch.io/clinical-research-philadelphia-crp/clinical-research-philadelphia-pennington/study/167755/subjects",
        "url": "https://app.clinicalresearch.io/clinical-research-philadelphia-crp/clinical-research-philadelphia-pennington/study/167755/subjects",
        "name": "Calvin  Jones",
        "patient_url": "https://app.clinicalresearch.io/clinical-research-philadelphia-crp/clinical-research-philadelphia-pennington/study/167755/subjects",
        "coord": "Ema Gunic",
        "cancel_date": "2026-01-12",
        "date": "Jan 12",
        "type": "No Show",
        "reason": "nan",
        "category": "No Show"
    },
    {
        "study": "J2A-MC-GZPO",
        "study_url": "https://app.clinicalresearch.io/clinical-research-philadelphia-crp/philadelphia-pa/study/135157/subjects",
        "url": "https://app.clinicalresearch.io/clinical-research-philadelphia-crp/philadelphia-pa/study/135157/subjects",
        "name": "Denise  Esposito",
        "patient_url": "https://app.clinicalresearch.io/clinical-research-philadelphia-crp/philadelphia-pa/study/135157/subjects",
        "coord": "Ema Gunic",
        "cancel_date": "2026-01-09",
        "date": "Jan 8",
        "type": "No Show",
        "reason": "Text sent to participant about missed appt",
        "category": "No Show"
    },
    {
        "study": "J2A-MC-GZPO",
        "study_url": "https://app.clinicalresearch.io/clinical-research-philadelphia-crp/philadelphia-pa/study/135157/subjects",
        "url": "https://app.clinicalresearch.io/clinical-research-philadelphia-crp/philadelphia-pa/study/135157/subjects",
        "name": "JAMES Schwartz",
        "patient_url": "https://app.clinicalresearch.io/clinical-research-philadelphia-crp/philadelphia-pa/study/135157/subjects",
        "coord": "Stacey Scott",
        "cancel_date": "2026-01-08",
        "date": "Feb 5",
        "type": "Site Cancelled",
        "reason": "screen fail inclusion 2007 per PI",
        "category": "Screen Fail/DNQ"
    },
    {
        "study": "80202135SJS3001",
        "study_url": "https://app.clinicalresearch.io/clinical-research-philadelphia-crp/clinical-research-philadelphia-pennington/study/150548/subjects",
        "url": "https://app.clinicalresearch.io/clinical-research-philadelphia-crp/clinical-research-philadelphia-pennington/study/150548/subjects",
        "name": "Tina  Pelligra",
        "patient_url": "https://app.clinicalresearch.io/clinical-research-philadelphia-crp/clinical-research-philadelphia-pennington/study/150548/subjects",
        "coord": "Angelina Mcmullen",
        "cancel_date": "2026-01-08",
        "date": "Jan 8",
        "type": "Patient Cancelled",
        "reason": "Cancelled due to patient reported illness.",
        "category": "Other"
    },
    {
        "study": "C4951063",
        "study_url": "https://app.clinicalresearch.io/clinical-research-philadelphia-crp/philadelphia-pa/study/135648/subjects",
        "url": "https://app.clinicalresearch.io/clinical-research-philadelphia-crp/philadelphia-pa/study/135648/subjects",
        "name": "Veronica  Grant",
        "patient_url": "https://app.clinicalresearch.io/clinical-research-philadelphia-crp/philadelphia-pa/study/135648/subjects",
        "coord": "Jana Milankovic",
        "cancel_date": "2026-01-07",
        "date": "Jan 7",
        "type": "Patient Cancelled",
        "reason": "no reason provided",
        "category": "Not Documented"
    },
    {
        "study": "C4951063",
        "study_url": "https://app.clinicalresearch.io/clinical-research-philadelphia-crp/philadelphia-pa/study/135648/subjects",
        "url": "https://app.clinicalresearch.io/clinical-research-philadelphia-crp/philadelphia-pa/study/135648/subjects",
        "name": "tasha pitts",
        "patient_url": "https://app.clinicalresearch.io/clinical-research-philadelphia-crp/philadelphia-pa/study/135648/subjects",
        "coord": "Jana Milankovic",
        "cancel_date": "2026-01-07",
        "date": "Jan 7",
        "type": "No Show",
        "reason": "text message sent",
        "category": "No Show"
    },
    {
        "study": "MR-130A-01-TD-3001",
        "study_url": "https://app.clinicalresearch.io/clinical-research-philadelphia-crp/philadelphia-pa/study/109260/subjects",
        "url": "https://app.clinicalresearch.io/clinical-research-philadelphia-crp/philadelphia-pa/study/109260/subjects",
        "name": "Emily  Pfeil",
        "patient_url": "https://app.clinicalresearch.io/clinical-research-philadelphia-crp/philadelphia-pa/study/109260/subjects",
        "coord": "Ruby Pereira",
        "cancel_date": "2026-01-07",
        "date": "Jan 7",
        "type": "No Show",
        "reason": "Site is unable to get in contact with the Participant possible lost to follow up",
        "category": "No Show"
    },
    {
        "study": "J2A-MC-GZPO",
        "study_url": "https://app.clinicalresearch.io/clinical-research-philadelphia-crp/philadelphia-pa/study/135157/subjects",
        "url": "https://app.clinicalresearch.io/clinical-research-philadelphia-crp/philadelphia-pa/study/135157/subjects",
        "name": "Grace Hankinson",
        "patient_url": "https://app.clinicalresearch.io/clinical-research-philadelphia-crp/philadelphia-pa/study/135157/subjects",
        "coord": "Stacey Scott",
        "cancel_date": "2026-01-06",
        "date": "Feb 3",
        "type": "Site Cancelled",
        "reason": "subject is a screenfail",
        "category": "Screen Fail/DNQ"
    },
    {
        "study": "D7960C00015",
        "study_url": "https://app.clinicalresearch.io/clinical-research-philadelphia-crp/philadelphia-pa/study/154462/subjects",
        "url": "https://app.clinicalresearch.io/clinical-research-philadelphia-crp/philadelphia-pa/study/154462/subjects",
        "name": "Mary DeAngelis",
        "patient_url": "https://app.clinicalresearch.io/clinical-research-philadelphia-crp/philadelphia-pa/study/154462/subjects",
        "coord": "Gabrijela Ateljevic",
        "cancel_date": "2026-01-06",
        "date": "Jan 6",
        "type": "Site Cancelled",
        "reason": "subject did not sign consent does not qualify for study per Dr Heether was not on maximum therapy 40 mh og a statin for 30 days",
        "category": "Screen Fail/DNQ"
    },
    {
        "study": "M23-714",
        "study_url": "https://app.clinicalresearch.io/clinical-research-philadelphia-crp/philadelphia-pa/study/86826/subjects",
        "url": "https://app.clinicalresearch.io/clinical-research-philadelphia-crp/philadelphia-pa/study/86826/subjects",
        "name": "Meg  Clark",
        "patient_url": "https://app.clinicalresearch.io/clinical-research-philadelphia-crp/philadelphia-pa/study/86826/subjects",
        "coord": "Jana Milankovic",
        "cancel_date": "2026-01-06",
        "date": "Jan 6",
        "type": "No Show",
        "reason": "Text sent to the Participant, she was a no show",
        "category": "No Show"
    },
    {
        "study": "CDX0159-12",
        "study_url": "https://app.clinicalresearch.io/clinical-research-philadelphia-crp/philadelphia-pa/study/102540/subjects",
        "url": "https://app.clinicalresearch.io/clinical-research-philadelphia-crp/philadelphia-pa/study/102540/subjects",
        "name": "Vivienne Van Nguyen",
        "patient_url": "https://app.clinicalresearch.io/clinical-research-philadelphia-crp/philadelphia-pa/study/102540/subjects",
        "coord": "Mario Castellanos",
        "cancel_date": "2026-01-06",
        "date": "Jan 6",
        "type": "Site Cancelled",
        "reason": "nan",
        "category": "Not Documented"
    },
    {
        "study": "J2A-MC-GZPO",
        "study_url": "https://app.clinicalresearch.io/clinical-research-philadelphia-crp/philadelphia-pa/study/135157/subjects",
        "url": "https://app.clinicalresearch.io/clinical-research-philadelphia-crp/philadelphia-pa/study/135157/subjects",
        "name": "Barbara Walker",
        "patient_url": "https://app.clinicalresearch.io/clinical-research-philadelphia-crp/philadelphia-pa/study/135157/subjects",
        "coord": "Ana Lambic",
        "cancel_date": "2026-01-06",
        "date": "Jan 21",
        "type": "No Show",
        "reason": "nan",
        "category": "No Show"
    }
],
  "coordinators": [
    {
      "name": "Angelina Mcmullen",
      "site": "Pennington, NJ",
      "upcoming": 12,
      "cancels": 8,
      "visits": [
        {
          "date": "Mar 10",
          "date_iso": "2026-03-10",
          "study": "20230222",
          "study_url": "https://app.clinicalresearch.io/clinical-research-philadelphia-crp/clinical-research-philadelphia-pennington/study/167794/subjects",
          "visit": "Main Screening",
          "patient": "Josephine  Cruz",
          "patient_url": "https://app.clinicalresearch.io/clinical-research-philadelphia-crp/clinical-research-philadelphia-pennington/study/167794/subjects",
          "status": "Screening",
          "coord": "Angelina Mcmullen",
          "site": "Pennington, NJ"
        },
        {
          "date": "Mar 11",
          "date_iso": "2026-03-11",
          "study": "80202135SJS3001",
          "study_url": "https://app.clinicalresearch.io/clinical-research-philadelphia-crp/clinical-research-philadelphia-pennington/study/150548/subjects",
          "visit": "Week 16",
          "patient": "Marlyn  Wisnieski",
          "patient_url": "https://app.clinicalresearch.io/clinical-research-philadelphia-crp/clinical-research-philadelphia-pennington/study/150548/subjects",
          "status": "Enrolled",
          "coord": "Angelina Mcmullen",
          "site": "Pennington, NJ"
        },
        {
          "date": "Mar 13",
          "date_iso": "2026-03-13",
          "study": "D6973C00001",
          "study_url": "https://app.clinicalresearch.io/clinical-research-philadelphia-crp/clinical-research-philadelphia-pennington/study/161619/subjects",
          "visit": "Randomisation",
          "patient": "Brian  Hill",
          "patient_url": "https://app.clinicalresearch.io/clinical-research-philadelphia-crp/clinical-research-philadelphia-pennington/study/161619/subjects",
          "status": "Screening",
          "coord": "Angelina Mcmullen",
          "site": "Pennington, NJ"
        },
        {
          "date": "Mar 17",
          "date_iso": "2026-03-17",
          "study": "20230222",
          "study_url": "https://app.clinicalresearch.io/clinical-research-philadelphia-crp/clinical-research-philadelphia-pennington/study/167794/subjects",
          "visit": "Main Screening",
          "patient": "Darryl  Rice",
          "patient_url": "https://app.clinicalresearch.io/clinical-research-philadelphia-crp/clinical-research-philadelphia-pennington/study/167794/subjects",
          "status": "Screening",
          "coord": "Angelina Mcmullen",
          "site": "Pennington, NJ"
        },
        {
          "date": "Mar 19",
          "date_iso": "2026-03-19",
          "study": "80202135SJS3001",
          "study_url": "https://app.clinicalresearch.io/clinical-research-philadelphia-crp/clinical-research-philadelphia-pennington/study/150548/subjects",
          "visit": "Week 6 Call",
          "patient": "Melissa  Richards",
          "patient_url": "https://app.clinicalresearch.io/clinical-research-philadelphia-crp/clinical-research-philadelphia-pennington/study/150548/subjects",
          "status": "Enrolled",
          "coord": "Angelina Mcmullen",
          "site": "Pennington, NJ"
        },
        {
          "date": "Mar 20",
          "date_iso": "2026-03-20",
          "study": "80202135SJS3001",
          "study_url": "https://app.clinicalresearch.io/clinical-research-philadelphia-crp/clinical-research-philadelphia-pennington/study/150548/subjects",
          "visit": "Random nipo conc",
          "patient": "Melissa  Richards",
          "patient_url": "https://app.clinicalresearch.io/clinical-research-philadelphia-crp/clinical-research-philadelphia-pennington/study/150548/subjects",
          "status": "Enrolled",
          "coord": "Angelina Mcmullen",
          "site": "Pennington, NJ"
        },
        {
          "date": "Mar 24",
          "date_iso": "2026-03-24",
          "study": "N1T-MC-MALO",
          "study_url": "https://app.clinicalresearch.io/clinical-research-philadelphia-crp/clinical-research-philadelphia-pennington/study/167755/subjects",
          "visit": "V1/Screening",
          "patient": "Maria Pueyo Sanchez",
          "patient_url": "https://app.clinicalresearch.io/clinical-research-philadelphia-crp/clinical-research-philadelphia-pennington/study/167755/subjects",
          "status": "Screening",
          "coord": "Angelina Mcmullen",
          "site": "Pennington, NJ"
        },
        {
          "date": "Mar 27",
          "date_iso": "2026-03-27",
          "study": "20230222",
          "study_url": "https://app.clinicalresearch.io/clinical-research-philadelphia-crp/clinical-research-philadelphia-pennington/study/167794/subjects",
          "visit": "Main Screening",
          "patient": "Gail Titus",
          "patient_url": "https://app.clinicalresearch.io/clinical-research-philadelphia-crp/clinical-research-philadelphia-pennington/study/167794/subjects",
          "status": "Screening",
          "coord": "Angelina Mcmullen",
          "site": "Pennington, NJ"
        },
        {
          "date": "Mar 31",
          "date_iso": "2026-03-31",
          "study": "D6973C00001",
          "study_url": "https://app.clinicalresearch.io/clinical-research-philadelphia-crp/clinical-research-philadelphia-pennington/study/161619/subjects",
          "visit": "Unscheduled Visit",
          "patient": "George  Ragos",
          "patient_url": "https://app.clinicalresearch.io/clinical-research-philadelphia-crp/clinical-research-philadelphia-pennington/study/161619/subjects",
          "status": "Enrolled",
          "coord": "Angelina Mcmullen",
          "site": "Pennington, NJ"
        },
        {
          "date": "Apr 3",
          "date_iso": "2026-04-03",
          "study": "80202135SJS3001",
          "study_url": "https://app.clinicalresearch.io/clinical-research-philadelphia-crp/clinical-research-philadelphia-pennington/study/150548/subjects",
          "visit": "Week 8",
          "patient": "Melissa  Richards",
          "patient_url": "https://app.clinicalresearch.io/clinical-research-philadelphia-crp/clinical-research-philadelphia-pennington/study/150548/subjects",
          "status": "Enrolled",
          "coord": "Angelina Mcmullen",
          "site": "Pennington, NJ"
        },
        {
          "date": "Apr 8",
          "date_iso": "2026-04-08",
          "study": "20230222",
          "study_url": "https://app.clinicalresearch.io/clinical-research-philadelphia-crp/clinical-research-philadelphia-pennington/study/167794/subjects",
          "visit": "Week 4",
          "patient": "Anthony  Chan",
          "patient_url": "https://app.clinicalresearch.io/clinical-research-philadelphia-crp/clinical-research-philadelphia-pennington/study/167794/subjects",
          "status": "Enrolled",
          "coord": "Angelina Mcmullen",
          "site": "Pennington, NJ"
        },
        {
          "date": "Apr 10",
          "date_iso": "2026-04-10",
          "study": "J3F-MC-EZCC",
          "study_url": "https://app.clinicalresearch.io/clinical-research-philadelphia-crp/clinical-research-philadelphia-pennington/study/172389/subjects",
          "visit": "Screening V1",
          "patient": "Dulana  Thaminda Ranaweera",
          "patient_url": "https://app.clinicalresearch.io/clinical-research-philadelphia-crp/clinical-research-philadelphia-pennington/study/172389/subjects",
          "status": "Scheduled V1",
          "coord": "Angelina Mcmullen",
          "site": "Pennington, NJ"
        }
      ]
    },
    {
      "name": "Cady Chilensky",
      "site": "Pennington, NJ",
      "upcoming": 7,
      "cancels": 2,
      "visits": [
        {
          "date": "Mar 9",
          "date_iso": "2026-03-09",
          "study": "N1T-MC-MALO",
          "study_url": "https://app.clinicalresearch.io/clinical-research-philadelphia-crp/clinical-research-philadelphia-pennington/study/167755/subjects",
          "visit": "V1/OffsiteManagement",
          "patient": "Susan  Butch",
          "patient_url": "https://app.clinicalresearch.io/clinical-research-philadelphia-crp/clinical-research-philadelphia-pennington/study/167755/subjects",
          "status": "Screening",
          "coord": "Cady Chilensky",
          "site": "Pennington, NJ"
        },
        {
          "date": "Mar 10",
          "date_iso": "2026-03-10",
          "study": "20230222",
          "study_url": "https://app.clinicalresearch.io/clinical-research-philadelphia-crp/clinical-research-philadelphia-pennington/study/167794/subjects",
          "visit": "Main Screening",
          "patient": "Nafeesah Dennis",
          "patient_url": "https://app.clinicalresearch.io/clinical-research-philadelphia-crp/clinical-research-philadelphia-pennington/study/167794/subjects",
          "status": "Screening",
          "coord": "Cady Chilensky",
          "site": "Pennington, NJ"
        },
        {
          "date": "Mar 11",
          "date_iso": "2026-03-11",
          "study": "N1T-MC-MALO",
          "study_url": "https://app.clinicalresearch.io/clinical-research-philadelphia-crp/clinical-research-philadelphia-pennington/study/167755/subjects",
          "visit": "V1/Screening",
          "patient": "Brittany  Daniel",
          "patient_url": "https://app.clinicalresearch.io/clinical-research-philadelphia-crp/clinical-research-philadelphia-pennington/study/167755/subjects",
          "status": "Screening",
          "coord": "Cady Chilensky",
          "site": "Pennington, NJ"
        },
        {
          "date": "Mar 17",
          "date_iso": "2026-03-17",
          "study": "N1T-MC-MALO",
          "study_url": "https://app.clinicalresearch.io/clinical-research-philadelphia-crp/clinical-research-philadelphia-pennington/study/167755/subjects",
          "visit": "V4/W4",
          "patient": "Carmen  Rios",
          "patient_url": "https://app.clinicalresearch.io/clinical-research-philadelphia-crp/clinical-research-philadelphia-pennington/study/167755/subjects",
          "status": "Enrolled",
          "coord": "Cady Chilensky",
          "site": "Pennington, NJ"
        },
        {
          "date": "Mar 24",
          "date_iso": "2026-03-24",
          "study": "N1T-MC-MALO",
          "study_url": "https://app.clinicalresearch.io/clinical-research-philadelphia-crp/clinical-research-philadelphia-pennington/study/167755/subjects",
          "visit": "V1/OffsiteManagement",
          "patient": "Brittany  Daniel",
          "patient_url": "https://app.clinicalresearch.io/clinical-research-philadelphia-crp/clinical-research-philadelphia-pennington/study/167755/subjects",
          "status": "Screening",
          "coord": "Cady Chilensky",
          "site": "Pennington, NJ"
        },
        {
          "date": "Mar 27",
          "date_iso": "2026-03-27",
          "study": "20230222",
          "study_url": "https://app.clinicalresearch.io/clinical-research-philadelphia-crp/clinical-research-philadelphia-pennington/study/167794/subjects",
          "visit": "Main Screening",
          "patient": "Lee Kurtz",
          "patient_url": "https://app.clinicalresearch.io/clinical-research-philadelphia-crp/clinical-research-philadelphia-pennington/study/167794/subjects",
          "status": "Screening",
          "coord": "Cady Chilensky",
          "site": "Pennington, NJ"
        },
        {
          "date": "Apr 7",
          "date_iso": "2026-04-07",
          "study": "20230222",
          "study_url": "https://app.clinicalresearch.io/clinical-research-philadelphia-crp/clinical-research-philadelphia-pennington/study/167794/subjects",
          "visit": "Main Screening",
          "patient": "Lou  Napolitano",
          "patient_url": "https://app.clinicalresearch.io/clinical-research-philadelphia-crp/clinical-research-philadelphia-pennington/study/167794/subjects",
          "status": "Screening",
          "coord": "Cady Chilensky",
          "site": "Pennington, NJ"
        }
      ]
    },
    {
      "name": "Mario Castellanos",
      "site": "Philadelphia, PA",
      "upcoming": 24,
      "cancels": 5,
      "visits": [
        {
          "date": "Mar 10",
          "date_iso": "2026-03-10",
          "study": "M20-465",
          "study_url": "https://app.clinicalresearch.io/clinical-research-philadelphia-crp/philadelphia-pa/study/107641/subjects",
          "visit": "Week 41",
          "patient": "Danai  Richards",
          "patient_url": "https://app.clinicalresearch.io/clinical-research-philadelphia-crp/philadelphia-pa/study/107641/subjects",
          "status": "Enrolled",
          "coord": "Mario Castellanos",
          "site": "Philadelphia, PA"
        },
        {
          "date": "Mar 10",
          "date_iso": "2026-03-10",
          "study": "N1T-MC-MALO",
          "study_url": "https://app.clinicalresearch.io/clinical-research-philadelphia-crp/clinical-research-philadelphia-pennington/study/167755/subjects",
          "visit": "V1/Screening",
          "patient": "Andrew  M Shekhar",
          "patient_url": "https://app.clinicalresearch.io/clinical-research-philadelphia-crp/clinical-research-philadelphia-pennington/study/167755/subjects",
          "status": "Screening",
          "coord": "Mario Castellanos",
          "site": "Philadelphia, PA"
        },
        {
          "date": "Mar 10",
          "date_iso": "2026-03-10",
          "study": "M20-465",
          "study_url": "https://app.clinicalresearch.io/clinical-research-philadelphia-crp/philadelphia-pa/study/107641/subjects",
          "visit": "Week 8",
          "patient": "Daryl  Lloyd",
          "patient_url": "https://app.clinicalresearch.io/clinical-research-philadelphia-crp/philadelphia-pa/study/107641/subjects",
          "status": "Enrolled",
          "coord": "Mario Castellanos",
          "site": "Philadelphia, PA"
        },
        {
          "date": "Mar 11",
          "date_iso": "2026-03-11",
          "study": "M20-465",
          "study_url": "https://app.clinicalresearch.io/clinical-research-philadelphia-crp/philadelphia-pa/study/107641/subjects",
          "visit": "Week 19",
          "patient": "Jesse  Cummings",
          "patient_url": "https://app.clinicalresearch.io/clinical-research-philadelphia-crp/philadelphia-pa/study/107641/subjects",
          "status": "Enrolled",
          "coord": "Mario Castellanos",
          "site": "Philadelphia, PA"
        },
        {
          "date": "Mar 11",
          "date_iso": "2026-03-11",
          "study": "M23-698",
          "study_url": "https://app.clinicalresearch.io/clinical-research-philadelphia-crp/philadelphia-pa/study/67894/subjects",
          "visit": "Phone Call-U/A preg.",
          "patient": "Marquita  Thomas",
          "patient_url": "https://app.clinicalresearch.io/clinical-research-philadelphia-crp/philadelphia-pa/study/67894/subjects",
          "status": "Enrolled",
          "coord": "Mario Castellanos",
          "site": "Philadelphia, PA"
        },
        {
          "date": "Mar 12",
          "date_iso": "2026-03-12",
          "study": "77242113PSO3006",
          "study_url": "https://app.clinicalresearch.io/clinical-research-philadelphia-crp/philadelphia-pa/study/136289/subjects",
          "visit": "Week 36",
          "patient": "Marissa Damico",
          "patient_url": "https://app.clinicalresearch.io/clinical-research-philadelphia-crp/philadelphia-pa/study/136289/subjects",
          "status": "Enrolled",
          "coord": "Mario Castellanos",
          "site": "Philadelphia, PA"
        },
        {
          "date": "Mar 12",
          "date_iso": "2026-03-12",
          "study": "M20-465",
          "study_url": "https://app.clinicalresearch.io/clinical-research-philadelphia-crp/philadelphia-pa/study/107641/subjects",
          "visit": "Week 2",
          "patient": "Courtney  Campuzano",
          "patient_url": "https://app.clinicalresearch.io/clinical-research-philadelphia-crp/philadelphia-pa/study/107641/subjects",
          "status": "Enrolled",
          "coord": "Mario Castellanos",
          "site": "Philadelphia, PA"
        },
        {
          "date": "Mar 12",
          "date_iso": "2026-03-12",
          "study": "M20-465",
          "study_url": "https://app.clinicalresearch.io/clinical-research-philadelphia-crp/philadelphia-pa/study/107641/subjects",
          "visit": "Week 29",
          "patient": "Samantha  Jackson",
          "patient_url": "https://app.clinicalresearch.io/clinical-research-philadelphia-crp/philadelphia-pa/study/107641/subjects",
          "status": "Enrolled",
          "coord": "Mario Castellanos",
          "site": "Philadelphia, PA"
        },
        {
          "date": "Mar 17",
          "date_iso": "2026-03-17",
          "study": "M20-465",
          "study_url": "https://app.clinicalresearch.io/clinical-research-philadelphia-crp/philadelphia-pa/study/107641/subjects",
          "visit": "Week 47",
          "patient": "Karen  Smith",
          "patient_url": "https://app.clinicalresearch.io/clinical-research-philadelphia-crp/philadelphia-pa/study/107641/subjects",
          "status": "Enrolled",
          "coord": "Mario Castellanos",
          "site": "Philadelphia, PA"
        },
        {
          "date": "Mar 17",
          "date_iso": "2026-03-17",
          "study": "M20-465",
          "study_url": "https://app.clinicalresearch.io/clinical-research-philadelphia-crp/philadelphia-pa/study/107641/subjects",
          "visit": "Week 39",
          "patient": "Jenelle  Luis",
          "patient_url": "https://app.clinicalresearch.io/clinical-research-philadelphia-crp/philadelphia-pa/study/107641/subjects",
          "status": "Enrolled",
          "coord": "Mario Castellanos",
          "site": "Philadelphia, PA"
        },
        {
          "date": "Mar 18",
          "date_iso": "2026-03-18",
          "study": "LTS17367",
          "study_url": "https://app.clinicalresearch.io/clinical-research-philadelphia-crp/philadelphia-pa/study/129137/subjects",
          "visit": "Visit 13 - Week 36",
          "patient": "Taylor  Charles",
          "patient_url": "https://app.clinicalresearch.io/clinical-research-philadelphia-crp/philadelphia-pa/study/129137/subjects",
          "status": "Enrolled",
          "coord": "Mario Castellanos",
          "site": "Philadelphia, PA"
        },
        {
          "date": "Mar 24",
          "date_iso": "2026-03-24",
          "study": "CDX0159-12",
          "study_url": "https://app.clinicalresearch.io/clinical-research-philadelphia-crp/philadelphia-pa/study/102540/subjects",
          "visit": "V4-Wk8-D57",
          "patient": "Vivienne Van Nguyen",
          "patient_url": "https://app.clinicalresearch.io/clinical-research-philadelphia-crp/philadelphia-pa/study/102540/subjects",
          "status": "Enrolled",
          "coord": "Mario Castellanos",
          "site": "Philadelphia, PA"
        },
        {
          "date": "Mar 24",
          "date_iso": "2026-03-24",
          "study": "77242113PSO3006",
          "study_url": "https://app.clinicalresearch.io/clinical-research-philadelphia-crp/philadelphia-pa/study/136289/subjects",
          "visit": "Week 36",
          "patient": "Tahtim Francis",
          "patient_url": "https://app.clinicalresearch.io/clinical-research-philadelphia-crp/philadelphia-pa/study/136289/subjects",
          "status": "Enrolled",
          "coord": "Mario Castellanos",
          "site": "Philadelphia, PA"
        },
        {
          "date": "Mar 25",
          "date_iso": "2026-03-25",
          "study": "EFC17600 (ESTUARY)",
          "study_url": "https://app.clinicalresearch.io/clinical-research-philadelphia-crp/philadelphia-pa/study/122602/subjects",
          "visit": "V14 - Week 52 EOT",
          "patient": "Barbara E Green",
          "patient_url": "https://app.clinicalresearch.io/clinical-research-philadelphia-crp/philadelphia-pa/study/122602/subjects",
          "status": "Enrolled",
          "coord": "Mario Castellanos",
          "site": "Philadelphia, PA"
        },
        {
          "date": "Mar 31",
          "date_iso": "2026-03-31",
          "study": "M23-698",
          "study_url": "https://app.clinicalresearch.io/clinical-research-philadelphia-crp/philadelphia-pa/study/67894/subjects",
          "visit": "V16-Wk88 - D617",
          "patient": "Angelica  Moss",
          "patient_url": "https://app.clinicalresearch.io/clinical-research-philadelphia-crp/philadelphia-pa/study/67894/subjects",
          "status": "Enrolled",
          "coord": "Mario Castellanos",
          "site": "Philadelphia, PA"
        },
        {
          "date": "Apr 2",
          "date_iso": "2026-04-02",
          "study": "EFC17599",
          "study_url": "https://app.clinicalresearch.io/clinical-research-philadelphia-crp/philadelphia-pa/study/97908/subjects",
          "visit": "Visit 11",
          "patient": "Natasha  Booker",
          "patient_url": "https://app.clinicalresearch.io/clinical-research-philadelphia-crp/philadelphia-pa/study/97908/subjects",
          "status": "Enrolled",
          "coord": "Mario Castellanos",
          "site": "Philadelphia, PA"
        },
        {
          "date": "Apr 7",
          "date_iso": "2026-04-07",
          "study": "M20-465",
          "study_url": "https://app.clinicalresearch.io/clinical-research-philadelphia-crp/philadelphia-pa/study/107641/subjects",
          "visit": "Week 12",
          "patient": "Daryl  Lloyd",
          "patient_url": "https://app.clinicalresearch.io/clinical-research-philadelphia-crp/philadelphia-pa/study/107641/subjects",
          "status": "Enrolled",
          "coord": "Mario Castellanos",
          "site": "Philadelphia, PA"
        },
        {
          "date": "Apr 7",
          "date_iso": "2026-04-07",
          "study": "M23-698",
          "study_url": "https://app.clinicalresearch.io/clinical-research-philadelphia-crp/philadelphia-pa/study/67894/subjects",
          "visit": "V14-Wk64 - D449",
          "patient": "Marquita  Thomas",
          "patient_url": "https://app.clinicalresearch.io/clinical-research-philadelphia-crp/philadelphia-pa/study/67894/subjects",
          "status": "Enrolled",
          "coord": "Mario Castellanos",
          "site": "Philadelphia, PA"
        },
        {
          "date": "Apr 7",
          "date_iso": "2026-04-07",
          "study": "77242113PSO3006",
          "study_url": "https://app.clinicalresearch.io/clinical-research-philadelphia-crp/philadelphia-pa/study/136289/subjects",
          "visit": "Week 44",
          "patient": "Lorayne  Thum",
          "patient_url": "https://app.clinicalresearch.io/clinical-research-philadelphia-crp/philadelphia-pa/study/136289/subjects",
          "status": "Enrolled",
          "coord": "Mario Castellanos",
          "site": "Philadelphia, PA"
        },
        {
          "date": "Apr 20",
          "date_iso": "2026-04-20",
          "study": "77242113PSO3006",
          "study_url": "https://app.clinicalresearch.io/clinical-research-philadelphia-crp/philadelphia-pa/study/136289/subjects",
          "visit": "Week 44",
          "patient": "Angel  Feria Merino",
          "patient_url": "https://app.clinicalresearch.io/clinical-research-philadelphia-crp/philadelphia-pa/study/136289/subjects",
          "status": "Enrolled",
          "coord": "Mario Castellanos",
          "site": "Philadelphia, PA"
        },
        {
          "date": "Apr 28",
          "date_iso": "2026-04-28",
          "study": "77242113PSO3006",
          "study_url": "https://app.clinicalresearch.io/clinical-research-philadelphia-crp/philadelphia-pa/study/136289/subjects",
          "visit": "Week 44",
          "patient": "Baris  Baltali",
          "patient_url": "https://app.clinicalresearch.io/clinical-research-philadelphia-crp/philadelphia-pa/study/136289/subjects",
          "status": "Enrolled",
          "coord": "Mario Castellanos",
          "site": "Philadelphia, PA"
        },
        {
          "date": "Apr 30",
          "date_iso": "2026-04-30",
          "study": "77242113PSO3006",
          "study_url": "https://app.clinicalresearch.io/clinical-research-philadelphia-crp/philadelphia-pa/study/136289/subjects",
          "visit": "Week 44",
          "patient": "Virgil  Casey",
          "patient_url": "https://app.clinicalresearch.io/clinical-research-philadelphia-crp/philadelphia-pa/study/136289/subjects",
          "status": "Enrolled",
          "coord": "Mario Castellanos",
          "site": "Philadelphia, PA"
        },
        {
          "date": "Apr 30",
          "date_iso": "2026-04-30",
          "study": "77242113PSO3006",
          "study_url": "https://app.clinicalresearch.io/clinical-research-philadelphia-crp/philadelphia-pa/study/136289/subjects",
          "visit": "Week 44",
          "patient": "Vaughn  Jeffries",
          "patient_url": "https://app.clinicalresearch.io/clinical-research-philadelphia-crp/philadelphia-pa/study/136289/subjects",
          "status": "Enrolled",
          "coord": "Mario Castellanos",
          "site": "Philadelphia, PA"
        },
        {
          "date": "May 5",
          "date_iso": "2026-05-05",
          "study": "M20-465",
          "study_url": "https://app.clinicalresearch.io/clinical-research-philadelphia-crp/philadelphia-pa/study/107641/subjects",
          "visit": "Week 16",
          "patient": "Daryl  Lloyd",
          "patient_url": "https://app.clinicalresearch.io/clinical-research-philadelphia-crp/philadelphia-pa/study/107641/subjects",
          "status": "Enrolled",
          "coord": "Mario Castellanos",
          "site": "Philadelphia, PA"
        }
      ]
    },
    {
      "name": "Ruby Pereira",
      "site": "Philadelphia, PA",
      "upcoming": 29,
      "cancels": 12,
      "visits": [
        {
          "date": "Mar 9",
          "date_iso": "2026-03-09",
          "study": "MR-130A-01-TD-3001",
          "study_url": "https://app.clinicalresearch.io/clinical-research-philadelphia-crp/philadelphia-pa/study/109260/subjects",
          "visit": "Cycle 5",
          "patient": "Sinthia  Charels",
          "patient_url": "https://app.clinicalresearch.io/clinical-research-philadelphia-crp/philadelphia-pa/study/109260/subjects",
          "status": "Enrolled",
          "coord": "Ruby Pereira",
          "site": "Philadelphia, PA"
        },
        {
          "date": "Mar 9",
          "date_iso": "2026-03-09",
          "study": "J3L-MC-EZEF",
          "study_url": "https://app.clinicalresearch.io/clinical-research-philadelphia-crp/philadelphia-pa/study/89175/subjects",
          "visit": "V4-Treatment (W13)",
          "patient": "Mariano  perez",
          "patient_url": "https://app.clinicalresearch.io/clinical-research-philadelphia-crp/philadelphia-pa/study/89175/subjects",
          "status": "Enrolled",
          "coord": "Ruby Pereira",
          "site": "Philadelphia, PA"
        },
        {
          "date": "Mar 9",
          "date_iso": "2026-03-09",
          "study": "MR-130A-01-TD-3001",
          "study_url": "https://app.clinicalresearch.io/clinical-research-philadelphia-crp/philadelphia-pa/study/109260/subjects",
          "visit": "Cycle 12",
          "patient": "Bridney  Mumford",
          "patient_url": "https://app.clinicalresearch.io/clinical-research-philadelphia-crp/philadelphia-pa/study/109260/subjects",
          "status": "Enrolled",
          "coord": "Ruby Pereira",
          "site": "Philadelphia, PA"
        },
        {
          "date": "Mar 10",
          "date_iso": "2026-03-10",
          "study": "M23-714",
          "study_url": "https://app.clinicalresearch.io/clinical-research-philadelphia-crp/philadelphia-pa/study/86826/subjects",
          "visit": "V2-Randomization",
          "patient": "Lauren  BraunStrumfels",
          "patient_url": "https://app.clinicalresearch.io/clinical-research-philadelphia-crp/philadelphia-pa/study/86826/subjects",
          "status": "Screening",
          "coord": "Ruby Pereira",
          "site": "Philadelphia, PA"
        },
        {
          "date": "Mar 11",
          "date_iso": "2026-03-11",
          "study": "MR-130A-01-TD-3001",
          "study_url": "https://app.clinicalresearch.io/clinical-research-philadelphia-crp/philadelphia-pa/study/109260/subjects",
          "visit": "Cycle 13 / TFU",
          "patient": "Gladys  Cabon",
          "patient_url": "https://app.clinicalresearch.io/clinical-research-philadelphia-crp/philadelphia-pa/study/109260/subjects",
          "status": "Enrolled",
          "coord": "Ruby Pereira",
          "site": "Philadelphia, PA"
        },
        {
          "date": "Mar 16",
          "date_iso": "2026-03-16",
          "study": "M23-714",
          "study_url": "https://app.clinicalresearch.io/clinical-research-philadelphia-crp/philadelphia-pa/study/86826/subjects",
          "visit": "V13/Wk52 Final V/ET",
          "patient": "Annamarie  DeSantis",
          "patient_url": "https://app.clinicalresearch.io/clinical-research-philadelphia-crp/philadelphia-pa/study/86826/subjects",
          "status": "Enrolled",
          "coord": "Ruby Pereira",
          "site": "Philadelphia, PA"
        },
        {
          "date": "Mar 17",
          "date_iso": "2026-03-17",
          "study": "MR-130A-01-TD-3001",
          "study_url": "https://app.clinicalresearch.io/clinical-research-philadelphia-crp/philadelphia-pa/study/109260/subjects",
          "visit": "Cycle 10 / TFU",
          "patient": "Payton Newman",
          "patient_url": "https://app.clinicalresearch.io/clinical-research-philadelphia-crp/philadelphia-pa/study/109260/subjects",
          "status": "Enrolled",
          "coord": "Ruby Pereira",
          "site": "Philadelphia, PA"
        },
        {
          "date": "Mar 18",
          "date_iso": "2026-03-18",
          "study": "C4951063",
          "study_url": "https://app.clinicalresearch.io/clinical-research-philadelphia-crp/philadelphia-pa/study/135648/subjects",
          "visit": "V2 - Obs Phase_MC2",
          "patient": "Kayla  Baresich",
          "patient_url": "https://app.clinicalresearch.io/clinical-research-philadelphia-crp/philadelphia-pa/study/135648/subjects",
          "status": "Screening",
          "coord": "Ruby Pereira",
          "site": "Philadelphia, PA"
        },
        {
          "date": "Mar 18",
          "date_iso": "2026-03-18",
          "study": "MR-130A-01-TD-3001",
          "study_url": "https://app.clinicalresearch.io/clinical-research-philadelphia-crp/philadelphia-pa/study/109260/subjects",
          "visit": "Cycle 10 / TFU",
          "patient": "Eve Morris",
          "patient_url": "https://app.clinicalresearch.io/clinical-research-philadelphia-crp/philadelphia-pa/study/109260/subjects",
          "status": "Enrolled",
          "coord": "Ruby Pereira",
          "site": "Philadelphia, PA"
        },
        {
          "date": "Mar 19",
          "date_iso": "2026-03-19",
          "study": "M23-714",
          "study_url": "https://app.clinicalresearch.io/clinical-research-philadelphia-crp/philadelphia-pa/study/86826/subjects",
          "visit": "V5/DB-Cycle3/Pre.Dis",
          "patient": "Kerrie  Carvalho",
          "patient_url": "https://app.clinicalresearch.io/clinical-research-philadelphia-crp/philadelphia-pa/study/86826/subjects",
          "status": "Enrolled",
          "coord": "Ruby Pereira",
          "site": "Philadelphia, PA"
        },
        {
          "date": "Mar 23",
          "date_iso": "2026-03-23",
          "study": "MR-130A-01-TD-3001",
          "study_url": "https://app.clinicalresearch.io/clinical-research-philadelphia-crp/philadelphia-pa/study/109260/subjects",
          "visit": "Cycle 10 / TFU",
          "patient": "Janae  Rockemore",
          "patient_url": "https://app.clinicalresearch.io/clinical-research-philadelphia-crp/philadelphia-pa/study/109260/subjects",
          "status": "Enrolled",
          "coord": "Ruby Pereira",
          "site": "Philadelphia, PA"
        },
        {
          "date": "Mar 23",
          "date_iso": "2026-03-23",
          "study": "J2A-MC-GZPO",
          "study_url": "https://app.clinicalresearch.io/clinical-research-philadelphia-crp/philadelphia-pa/study/135157/subjects",
          "visit": "Treatment (V12)",
          "patient": "Linda  Cerino",
          "patient_url": "https://app.clinicalresearch.io/clinical-research-philadelphia-crp/philadelphia-pa/study/135157/subjects",
          "status": "Enrolled",
          "coord": "Ruby Pereira",
          "site": "Philadelphia, PA"
        },
        {
          "date": "Mar 30",
          "date_iso": "2026-03-30",
          "study": "MR-130A-01-TD-3001",
          "study_url": "https://app.clinicalresearch.io/clinical-research-philadelphia-crp/philadelphia-pa/study/109260/subjects",
          "visit": "Cycle 8",
          "patient": "Sharisse  King",
          "patient_url": "https://app.clinicalresearch.io/clinical-research-philadelphia-crp/philadelphia-pa/study/109260/subjects",
          "status": "Enrolled",
          "coord": "Ruby Pereira",
          "site": "Philadelphia, PA"
        },
        {
          "date": "Mar 30",
          "date_iso": "2026-03-30",
          "study": "J3L-MC-EZEF",
          "study_url": "https://app.clinicalresearch.io/clinical-research-philadelphia-crp/philadelphia-pa/study/89175/subjects",
          "visit": "V5-Treatment",
          "patient": "Pamela  Robinson",
          "patient_url": "https://app.clinicalresearch.io/clinical-research-philadelphia-crp/philadelphia-pa/study/89175/subjects",
          "status": "Enrolled",
          "coord": "Ruby Pereira",
          "site": "Philadelphia, PA"
        },
        {
          "date": "Mar 31",
          "date_iso": "2026-03-31",
          "study": "M23-714",
          "study_url": "https://app.clinicalresearch.io/clinical-research-philadelphia-crp/philadelphia-pa/study/86826/subjects",
          "visit": "V4 / DB-Cycle 2",
          "patient": "Lakeisha  Johnson",
          "patient_url": "https://app.clinicalresearch.io/clinical-research-philadelphia-crp/philadelphia-pa/study/86826/subjects",
          "status": "Enrolled",
          "coord": "Ruby Pereira",
          "site": "Philadelphia, PA"
        },
        {
          "date": "Apr 6",
          "date_iso": "2026-04-06",
          "study": "J3L-MC-EZEF",
          "study_url": "https://app.clinicalresearch.io/clinical-research-philadelphia-crp/philadelphia-pa/study/89175/subjects",
          "visit": "V10-Treatment",
          "patient": "Rosemary  Craft",
          "patient_url": "https://app.clinicalresearch.io/clinical-research-philadelphia-crp/philadelphia-pa/study/89175/subjects",
          "status": "Enrolled",
          "coord": "Ruby Pereira",
          "site": "Philadelphia, PA"
        },
        {
          "date": "Apr 7",
          "date_iso": "2026-04-07",
          "study": "M23-714",
          "study_url": "https://app.clinicalresearch.io/clinical-research-philadelphia-crp/philadelphia-pa/study/86826/subjects",
          "visit": "V6 / OLE Week 4",
          "patient": "Julie  Atkinson",
          "patient_url": "https://app.clinicalresearch.io/clinical-research-philadelphia-crp/philadelphia-pa/study/86826/subjects",
          "status": "Enrolled",
          "coord": "Ruby Pereira",
          "site": "Philadelphia, PA"
        },
        {
          "date": "Apr 8",
          "date_iso": "2026-04-08",
          "study": "J3L-MC-EZEF",
          "study_url": "https://app.clinicalresearch.io/clinical-research-philadelphia-crp/philadelphia-pa/study/89175/subjects",
          "visit": "V8-Treatment",
          "patient": "Simon  Wolf",
          "patient_url": "https://app.clinicalresearch.io/clinical-research-philadelphia-crp/philadelphia-pa/study/89175/subjects",
          "status": "Enrolled",
          "coord": "Ruby Pereira",
          "site": "Philadelphia, PA"
        },
        {
          "date": "Apr 8",
          "date_iso": "2026-04-08",
          "study": "MR-130A-01-TD-3001",
          "study_url": "https://app.clinicalresearch.io/clinical-research-philadelphia-crp/philadelphia-pa/study/109260/subjects",
          "visit": "EOS/ET",
          "patient": "Gladys  Cabon",
          "patient_url": "https://app.clinicalresearch.io/clinical-research-philadelphia-crp/philadelphia-pa/study/109260/subjects",
          "status": "Enrolled",
          "coord": "Ruby Pereira",
          "site": "Philadelphia, PA"
        },
        {
          "date": "Apr 8",
          "date_iso": "2026-04-08",
          "study": "J1G-MC-LAKI",
          "study_url": "https://app.clinicalresearch.io/clinical-research-philadelphia-crp/philadelphia-pa/study/119640/subjects",
          "visit": "DBTx: V6 Wk32",
          "patient": "Patricia  Garland",
          "patient_url": "https://app.clinicalresearch.io/clinical-research-philadelphia-crp/philadelphia-pa/study/119640/subjects",
          "status": "Enrolled",
          "coord": "Ruby Pereira",
          "site": "Philadelphia, PA"
        },
        {
          "date": "Apr 10",
          "date_iso": "2026-04-10",
          "study": "J3L-MC-EZEF",
          "study_url": "https://app.clinicalresearch.io/clinical-research-philadelphia-crp/philadelphia-pa/study/89175/subjects",
          "visit": "V4-Treatment (W13)",
          "patient": "Thomas  Hilton",
          "patient_url": "https://app.clinicalresearch.io/clinical-research-philadelphia-crp/philadelphia-pa/study/89175/subjects",
          "status": "Enrolled",
          "coord": "Ruby Pereira",
          "site": "Philadelphia, PA"
        },
        {
          "date": "Apr 14",
          "date_iso": "2026-04-14",
          "study": "MR-130A-01-TD-3001",
          "study_url": "https://app.clinicalresearch.io/clinical-research-philadelphia-crp/philadelphia-pa/study/109260/subjects",
          "visit": "Cycle 11 / TFU",
          "patient": "Payton Newman",
          "patient_url": "https://app.clinicalresearch.io/clinical-research-philadelphia-crp/philadelphia-pa/study/109260/subjects",
          "status": "Enrolled",
          "coord": "Ruby Pereira",
          "site": "Philadelphia, PA"
        },
        {
          "date": "Apr 15",
          "date_iso": "2026-04-15",
          "study": "MR-130A-01-TD-3001",
          "study_url": "https://app.clinicalresearch.io/clinical-research-philadelphia-crp/philadelphia-pa/study/109260/subjects",
          "visit": "Cycle 11 / TFU",
          "patient": "Eve Morris",
          "patient_url": "https://app.clinicalresearch.io/clinical-research-philadelphia-crp/philadelphia-pa/study/109260/subjects",
          "status": "Enrolled",
          "coord": "Ruby Pereira",
          "site": "Philadelphia, PA"
        },
        {
          "date": "Apr 20",
          "date_iso": "2026-04-20",
          "study": "MR-130A-01-TD-3001",
          "study_url": "https://app.clinicalresearch.io/clinical-research-philadelphia-crp/philadelphia-pa/study/109260/subjects",
          "visit": "Cycle 11 / TFU",
          "patient": "Janae  Rockemore",
          "patient_url": "https://app.clinicalresearch.io/clinical-research-philadelphia-crp/philadelphia-pa/study/109260/subjects",
          "status": "Enrolled",
          "coord": "Ruby Pereira",
          "site": "Philadelphia, PA"
        },
        {
          "date": "Apr 20",
          "date_iso": "2026-04-20",
          "study": "J3L-MC-EZEF",
          "study_url": "https://app.clinicalresearch.io/clinical-research-philadelphia-crp/philadelphia-pa/study/89175/subjects",
          "visit": "V11-Treatment (T)",
          "patient": "Barbara  Musselman",
          "patient_url": "https://app.clinicalresearch.io/clinical-research-philadelphia-crp/philadelphia-pa/study/89175/subjects",
          "status": "Enrolled",
          "coord": "Ruby Pereira",
          "site": "Philadelphia, PA"
        },
        {
          "date": "Apr 22",
          "date_iso": "2026-04-22",
          "study": "J3L-MC-EZEF",
          "study_url": "https://app.clinicalresearch.io/clinical-research-philadelphia-crp/philadelphia-pa/study/89175/subjects",
          "visit": "V10-Treatment",
          "patient": "Laurie  Bochert",
          "patient_url": "https://app.clinicalresearch.io/clinical-research-philadelphia-crp/philadelphia-pa/study/89175/subjects",
          "status": "Enrolled",
          "coord": "Ruby Pereira",
          "site": "Philadelphia, PA"
        },
        {
          "date": "Apr 23",
          "date_iso": "2026-04-23",
          "study": "J3L-MC-EZEF",
          "study_url": "https://app.clinicalresearch.io/clinical-research-philadelphia-crp/philadelphia-pa/study/89175/subjects",
          "visit": "V11-Treatment (T)",
          "patient": "Lottie  Hicks",
          "patient_url": "https://app.clinicalresearch.io/clinical-research-philadelphia-crp/philadelphia-pa/study/89175/subjects",
          "status": "Enrolled",
          "coord": "Ruby Pereira",
          "site": "Philadelphia, PA"
        },
        {
          "date": "Apr 23",
          "date_iso": "2026-04-23",
          "study": "J3L-MC-EZEF",
          "study_url": "https://app.clinicalresearch.io/clinical-research-philadelphia-crp/philadelphia-pa/study/89175/subjects",
          "visit": "V9-Treatment (T)",
          "patient": "Fred  Early",
          "patient_url": "https://app.clinicalresearch.io/clinical-research-philadelphia-crp/philadelphia-pa/study/89175/subjects",
          "status": "Enrolled",
          "coord": "Ruby Pereira",
          "site": "Philadelphia, PA"
        },
        {
          "date": "May 7",
          "date_iso": "2026-05-07",
          "study": "J3L-MC-EZEF",
          "study_url": "https://app.clinicalresearch.io/clinical-research-philadelphia-crp/philadelphia-pa/study/89175/subjects",
          "visit": "V10-Treatment",
          "patient": "Lawrence  Washington",
          "patient_url": "https://app.clinicalresearch.io/clinical-research-philadelphia-crp/philadelphia-pa/study/89175/subjects",
          "status": "Enrolled",
          "coord": "Ruby Pereira",
          "site": "Philadelphia, PA"
        }
      ]
    },
    {
      "name": "Stacey Scott",
      "site": "Philadelphia, PA",
      "upcoming": 34,
      "cancels": 11,
      "visits": [
        {
          "date": "Mar 9",
          "date_iso": "2026-03-09",
          "study": "J3L-MC-EZEF",
          "study_url": "https://app.clinicalresearch.io/clinical-research-philadelphia-crp/philadelphia-pa/study/89175/subjects",
          "visit": "V9-Treatment (T)",
          "patient": "Mathew  Samuel",
          "patient_url": "https://app.clinicalresearch.io/clinical-research-philadelphia-crp/philadelphia-pa/study/89175/subjects",
          "status": "Enrolled",
          "coord": "Stacey Scott",
          "site": "Philadelphia, PA"
        },
        {
          "date": "Mar 9",
          "date_iso": "2026-03-09",
          "study": "J3L-MC-EZEF",
          "study_url": "https://app.clinicalresearch.io/clinical-research-philadelphia-crp/philadelphia-pa/study/89175/subjects",
          "visit": "V4-Treatment (W13)",
          "patient": "Carol  Adonizio",
          "patient_url": "https://app.clinicalresearch.io/clinical-research-philadelphia-crp/philadelphia-pa/study/89175/subjects",
          "status": "Enrolled",
          "coord": "Stacey Scott",
          "site": "Philadelphia, PA"
        },
        {
          "date": "Mar 10",
          "date_iso": "2026-03-10",
          "study": "J3L-MC-EZEF",
          "study_url": "https://app.clinicalresearch.io/clinical-research-philadelphia-crp/philadelphia-pa/study/89175/subjects",
          "visit": "V8-Treatment",
          "patient": "Marilin Walton",
          "patient_url": "https://app.clinicalresearch.io/clinical-research-philadelphia-crp/philadelphia-pa/study/89175/subjects",
          "status": "Enrolled",
          "coord": "Stacey Scott",
          "site": "Philadelphia, PA"
        },
        {
          "date": "Mar 10",
          "date_iso": "2026-03-10",
          "study": "J3L-MC-EZEF",
          "study_url": "https://app.clinicalresearch.io/clinical-research-philadelphia-crp/philadelphia-pa/study/89175/subjects",
          "visit": "V4-Treatment (W13)",
          "patient": "David  Garrett",
          "patient_url": "https://app.clinicalresearch.io/clinical-research-philadelphia-crp/philadelphia-pa/study/89175/subjects",
          "status": "Enrolled",
          "coord": "Stacey Scott",
          "site": "Philadelphia, PA"
        },
        {
          "date": "Mar 11",
          "date_iso": "2026-03-11",
          "study": "J2A-MC-GZPO",
          "study_url": "https://app.clinicalresearch.io/clinical-research-philadelphia-crp/philadelphia-pa/study/135157/subjects",
          "visit": "Treatment (V10)",
          "patient": "Jonathan  Freedman",
          "patient_url": "https://app.clinicalresearch.io/clinical-research-philadelphia-crp/philadelphia-pa/study/135157/subjects",
          "status": "Enrolled",
          "coord": "Stacey Scott",
          "site": "Philadelphia, PA"
        },
        {
          "date": "Mar 11",
          "date_iso": "2026-03-11",
          "study": "J3L-MC-EZEF",
          "study_url": "https://app.clinicalresearch.io/clinical-research-philadelphia-crp/philadelphia-pa/study/89175/subjects",
          "visit": "V7-Treatment",
          "patient": "Jurdell Arnold Davis",
          "patient_url": "https://app.clinicalresearch.io/clinical-research-philadelphia-crp/philadelphia-pa/study/89175/subjects",
          "status": "Enrolled",
          "coord": "Stacey Scott",
          "site": "Philadelphia, PA"
        },
        {
          "date": "Mar 12",
          "date_iso": "2026-03-12",
          "study": "J3L-MC-EZEF",
          "study_url": "https://app.clinicalresearch.io/clinical-research-philadelphia-crp/philadelphia-pa/study/89175/subjects",
          "visit": "V4-Treatment (W13)",
          "patient": "Rakesh  Joshi",
          "patient_url": "https://app.clinicalresearch.io/clinical-research-philadelphia-crp/philadelphia-pa/study/89175/subjects",
          "status": "Enrolled",
          "coord": "Stacey Scott",
          "site": "Philadelphia, PA"
        },
        {
          "date": "Mar 12",
          "date_iso": "2026-03-12",
          "study": "J3L-MC-EZEF",
          "study_url": "https://app.clinicalresearch.io/clinical-research-philadelphia-crp/philadelphia-pa/study/89175/subjects",
          "visit": "V4-Treatment (W13)",
          "patient": "Grace  Henrie",
          "patient_url": "https://app.clinicalresearch.io/clinical-research-philadelphia-crp/philadelphia-pa/study/89175/subjects",
          "status": "Enrolled",
          "coord": "Stacey Scott",
          "site": "Philadelphia, PA"
        },
        {
          "date": "Mar 16",
          "date_iso": "2026-03-16",
          "study": "J2A-MC-GZPO",
          "study_url": "https://app.clinicalresearch.io/clinical-research-philadelphia-crp/philadelphia-pa/study/135157/subjects",
          "visit": "Treatment (V6)",
          "patient": "Cheryl Mosley",
          "patient_url": "https://app.clinicalresearch.io/clinical-research-philadelphia-crp/philadelphia-pa/study/135157/subjects",
          "status": "Enrolled",
          "coord": "Stacey Scott",
          "site": "Philadelphia, PA"
        },
        {
          "date": "Mar 17",
          "date_iso": "2026-03-17",
          "study": "J3L-MC-EZEF",
          "study_url": "https://app.clinicalresearch.io/clinical-research-philadelphia-crp/philadelphia-pa/study/89175/subjects",
          "visit": "V4-Treatment (W13)",
          "patient": "Ernest Butts",
          "patient_url": "https://app.clinicalresearch.io/clinical-research-philadelphia-crp/philadelphia-pa/study/89175/subjects",
          "status": "Enrolled",
          "coord": "Stacey Scott",
          "site": "Philadelphia, PA"
        },
        {
          "date": "Mar 18",
          "date_iso": "2026-03-18",
          "study": "J3L-MC-EZEF",
          "study_url": "https://app.clinicalresearch.io/clinical-research-philadelphia-crp/philadelphia-pa/study/89175/subjects",
          "visit": "V9-Treatment (T)",
          "patient": "Ratna  Setiono",
          "patient_url": "https://app.clinicalresearch.io/clinical-research-philadelphia-crp/philadelphia-pa/study/89175/subjects",
          "status": "Enrolled",
          "coord": "Stacey Scott",
          "site": "Philadelphia, PA"
        },
        {
          "date": "Mar 18",
          "date_iso": "2026-03-18",
          "study": "J3L-MC-EZEF",
          "study_url": "https://app.clinicalresearch.io/clinical-research-philadelphia-crp/philadelphia-pa/study/89175/subjects",
          "visit": "V7-Treatment",
          "patient": "James  Clark",
          "patient_url": "https://app.clinicalresearch.io/clinical-research-philadelphia-crp/philadelphia-pa/study/89175/subjects",
          "status": "Enrolled",
          "coord": "Stacey Scott",
          "site": "Philadelphia, PA"
        },
        {
          "date": "Mar 25",
          "date_iso": "2026-03-25",
          "study": "J2A-MC-GZPO",
          "study_url": "https://app.clinicalresearch.io/clinical-research-philadelphia-crp/philadelphia-pa/study/135157/subjects",
          "visit": "Treatment (V12)",
          "patient": "Jodi  Wolff",
          "patient_url": "https://app.clinicalresearch.io/clinical-research-philadelphia-crp/philadelphia-pa/study/135157/subjects",
          "status": "Enrolled",
          "coord": "Stacey Scott",
          "site": "Philadelphia, PA"
        },
        {
          "date": "Mar 30",
          "date_iso": "2026-03-30",
          "study": "D6973C00001",
          "study_url": "https://app.clinicalresearch.io/clinical-research-philadelphia-crp/clinical-research-philadelphia-pennington/study/161619/subjects",
          "visit": "Randomisation",
          "patient": "Gloria Saafir",
          "patient_url": "https://app.clinicalresearch.io/clinical-research-philadelphia-crp/clinical-research-philadelphia-pennington/study/161619/subjects",
          "status": "Screening",
          "coord": "Stacey Scott",
          "site": "Philadelphia, PA"
        },
        {
          "date": "Mar 30",
          "date_iso": "2026-03-30",
          "study": "J3L-MC-EZEF",
          "study_url": "https://app.clinicalresearch.io/clinical-research-philadelphia-crp/philadelphia-pa/study/89175/subjects",
          "visit": "V10-Treatment",
          "patient": "Rosaria  Martin-Serrano",
          "patient_url": "https://app.clinicalresearch.io/clinical-research-philadelphia-crp/philadelphia-pa/study/89175/subjects",
          "status": "Enrolled",
          "coord": "Stacey Scott",
          "site": "Philadelphia, PA"
        },
        {
          "date": "Mar 30",
          "date_iso": "2026-03-30",
          "study": "J3L-MC-EZEF",
          "study_url": "https://app.clinicalresearch.io/clinical-research-philadelphia-crp/philadelphia-pa/study/89175/subjects",
          "visit": "V10-Treatment",
          "patient": "Charline  Coughlin",
          "patient_url": "https://app.clinicalresearch.io/clinical-research-philadelphia-crp/philadelphia-pa/study/89175/subjects",
          "status": "Enrolled",
          "coord": "Stacey Scott",
          "site": "Philadelphia, PA"
        },
        {
          "date": "Mar 31",
          "date_iso": "2026-03-31",
          "study": "J3L-MC-EZEF",
          "study_url": "https://app.clinicalresearch.io/clinical-research-philadelphia-crp/philadelphia-pa/study/89175/subjects",
          "visit": "V4-Treatment (W13)",
          "patient": "Brian  Mckenzie",
          "patient_url": "https://app.clinicalresearch.io/clinical-research-philadelphia-crp/philadelphia-pa/study/89175/subjects",
          "status": "Enrolled",
          "coord": "Stacey Scott",
          "site": "Philadelphia, PA"
        },
        {
          "date": "Apr 1",
          "date_iso": "2026-04-01",
          "study": "J3L-MC-EZEF",
          "study_url": "https://app.clinicalresearch.io/clinical-research-philadelphia-crp/philadelphia-pa/study/89175/subjects",
          "visit": "V8-Treatment",
          "patient": "Shelley thomas Garrett",
          "patient_url": "https://app.clinicalresearch.io/clinical-research-philadelphia-crp/philadelphia-pa/study/89175/subjects",
          "status": "Enrolled",
          "coord": "Stacey Scott",
          "site": "Philadelphia, PA"
        },
        {
          "date": "Apr 6",
          "date_iso": "2026-04-06",
          "study": "J3L-MC-EZEF",
          "study_url": "https://app.clinicalresearch.io/clinical-research-philadelphia-crp/philadelphia-pa/study/89175/subjects",
          "visit": "V11-Treatment (T)",
          "patient": "Ann  Guarnaccia",
          "patient_url": "https://app.clinicalresearch.io/clinical-research-philadelphia-crp/philadelphia-pa/study/89175/subjects",
          "status": "Enrolled",
          "coord": "Stacey Scott",
          "site": "Philadelphia, PA"
        },
        {
          "date": "Apr 6",
          "date_iso": "2026-04-06",
          "study": "J3L-MC-EZEF",
          "study_url": "https://app.clinicalresearch.io/clinical-research-philadelphia-crp/philadelphia-pa/study/89175/subjects",
          "visit": "V9-Treatment (T)",
          "patient": "Frank  Padlo",
          "patient_url": "https://app.clinicalresearch.io/clinical-research-philadelphia-crp/philadelphia-pa/study/89175/subjects",
          "status": "Enrolled",
          "coord": "Stacey Scott",
          "site": "Philadelphia, PA"
        },
        {
          "date": "Apr 7",
          "date_iso": "2026-04-07",
          "study": "J3L-MC-EZEF",
          "study_url": "https://app.clinicalresearch.io/clinical-research-philadelphia-crp/philadelphia-pa/study/89175/subjects",
          "visit": "V10-Treatment",
          "patient": "Michele  Greaves",
          "patient_url": "https://app.clinicalresearch.io/clinical-research-philadelphia-crp/philadelphia-pa/study/89175/subjects",
          "status": "Enrolled",
          "coord": "Stacey Scott",
          "site": "Philadelphia, PA"
        },
        {
          "date": "Apr 8",
          "date_iso": "2026-04-08",
          "study": "J3L-MC-EZEF",
          "study_url": "https://app.clinicalresearch.io/clinical-research-philadelphia-crp/philadelphia-pa/study/89175/subjects",
          "visit": "V8-Treatment",
          "patient": "Christopher  Hedges",
          "patient_url": "https://app.clinicalresearch.io/clinical-research-philadelphia-crp/philadelphia-pa/study/89175/subjects",
          "status": "Enrolled",
          "coord": "Stacey Scott",
          "site": "Philadelphia, PA"
        },
        {
          "date": "Apr 8",
          "date_iso": "2026-04-08",
          "study": "J2A-MC-GZPO",
          "study_url": "https://app.clinicalresearch.io/clinical-research-philadelphia-crp/philadelphia-pa/study/135157/subjects",
          "visit": "Treatment (V11)",
          "patient": "Jonathan  Freedman",
          "patient_url": "https://app.clinicalresearch.io/clinical-research-philadelphia-crp/philadelphia-pa/study/135157/subjects",
          "status": "Enrolled",
          "coord": "Stacey Scott",
          "site": "Philadelphia, PA"
        },
        {
          "date": "Apr 9",
          "date_iso": "2026-04-09",
          "study": "J3L-MC-EZEF",
          "study_url": "https://app.clinicalresearch.io/clinical-research-philadelphia-crp/philadelphia-pa/study/89175/subjects",
          "visit": "V9-Treatment (T)",
          "patient": "Brian  Murphy",
          "patient_url": "https://app.clinicalresearch.io/clinical-research-philadelphia-crp/philadelphia-pa/study/89175/subjects",
          "status": "Enrolled",
          "coord": "Stacey Scott",
          "site": "Philadelphia, PA"
        },
        {
          "date": "Apr 13",
          "date_iso": "2026-04-13",
          "study": "J3L-MC-EZEF",
          "study_url": "https://app.clinicalresearch.io/clinical-research-philadelphia-crp/philadelphia-pa/study/89175/subjects",
          "visit": "V10-Treatment",
          "patient": "Walter  Sawka",
          "patient_url": "https://app.clinicalresearch.io/clinical-research-philadelphia-crp/philadelphia-pa/study/89175/subjects",
          "status": "Enrolled",
          "coord": "Stacey Scott",
          "site": "Philadelphia, PA"
        },
        {
          "date": "Apr 14",
          "date_iso": "2026-04-14",
          "study": "J3L-MC-EZEF",
          "study_url": "https://app.clinicalresearch.io/clinical-research-philadelphia-crp/philadelphia-pa/study/89175/subjects",
          "visit": "V7-Treatment",
          "patient": "Debora Green  Howell",
          "patient_url": "https://app.clinicalresearch.io/clinical-research-philadelphia-crp/philadelphia-pa/study/89175/subjects",
          "status": "Enrolled",
          "coord": "Stacey Scott",
          "site": "Philadelphia, PA"
        },
        {
          "date": "Apr 16",
          "date_iso": "2026-04-16",
          "study": "J3L-MC-EZEF",
          "study_url": "https://app.clinicalresearch.io/clinical-research-philadelphia-crp/philadelphia-pa/study/89175/subjects",
          "visit": "V4-Treatment (W13)",
          "patient": "Leonard Mcdonald",
          "patient_url": "https://app.clinicalresearch.io/clinical-research-philadelphia-crp/philadelphia-pa/study/89175/subjects",
          "status": "Enrolled",
          "coord": "Stacey Scott",
          "site": "Philadelphia, PA"
        },
        {
          "date": "Apr 22",
          "date_iso": "2026-04-22",
          "study": "D7960C00015",
          "study_url": "https://app.clinicalresearch.io/clinical-research-philadelphia-crp/philadelphia-pa/study/154462/subjects",
          "visit": "V6 - Week 24",
          "patient": "Andrea M Branche",
          "patient_url": "https://app.clinicalresearch.io/clinical-research-philadelphia-crp/philadelphia-pa/study/154462/subjects",
          "status": "Enrolled",
          "coord": "Stacey Scott",
          "site": "Philadelphia, PA"
        },
        {
          "date": "Apr 22",
          "date_iso": "2026-04-22",
          "study": "J3L-MC-EZEF",
          "study_url": "https://app.clinicalresearch.io/clinical-research-philadelphia-crp/philadelphia-pa/study/89175/subjects",
          "visit": "V4-Treatment (W13)",
          "patient": "Madearia Lowery",
          "patient_url": "https://app.clinicalresearch.io/clinical-research-philadelphia-crp/philadelphia-pa/study/89175/subjects",
          "status": "Enrolled",
          "coord": "Stacey Scott",
          "site": "Philadelphia, PA"
        },
        {
          "date": "Apr 29",
          "date_iso": "2026-04-29",
          "study": "J3L-MC-EZEF",
          "study_url": "https://app.clinicalresearch.io/clinical-research-philadelphia-crp/philadelphia-pa/study/89175/subjects",
          "visit": "V4-Treatment (W13)",
          "patient": "Linda Terrick",
          "patient_url": "https://app.clinicalresearch.io/clinical-research-philadelphia-crp/philadelphia-pa/study/89175/subjects",
          "status": "Enrolled",
          "coord": "Stacey Scott",
          "site": "Philadelphia, PA"
        },
        {
          "date": "Apr 30",
          "date_iso": "2026-04-30",
          "study": "J3L-MC-EZEF",
          "study_url": "https://app.clinicalresearch.io/clinical-research-philadelphia-crp/philadelphia-pa/study/89175/subjects",
          "visit": "V7-Treatment",
          "patient": "Sheila  Simmons",
          "patient_url": "https://app.clinicalresearch.io/clinical-research-philadelphia-crp/philadelphia-pa/study/89175/subjects",
          "status": "Enrolled",
          "coord": "Stacey Scott",
          "site": "Philadelphia, PA"
        },
        {
          "date": "May 6",
          "date_iso": "2026-05-06",
          "study": "J3L-MC-EZEF",
          "study_url": "https://app.clinicalresearch.io/clinical-research-philadelphia-crp/philadelphia-pa/study/89175/subjects",
          "visit": "V8-Treatment",
          "patient": "Joel  Jaffe",
          "patient_url": "https://app.clinicalresearch.io/clinical-research-philadelphia-crp/philadelphia-pa/study/89175/subjects",
          "status": "Enrolled",
          "coord": "Stacey Scott",
          "site": "Philadelphia, PA"
        },
        {
          "date": "May 6",
          "date_iso": "2026-05-06",
          "study": "J3L-MC-EZEF",
          "study_url": "https://app.clinicalresearch.io/clinical-research-philadelphia-crp/philadelphia-pa/study/89175/subjects",
          "visit": "V10-Treatment",
          "patient": "John  Ervin",
          "patient_url": "https://app.clinicalresearch.io/clinical-research-philadelphia-crp/philadelphia-pa/study/89175/subjects",
          "status": "Enrolled",
          "coord": "Stacey Scott",
          "site": "Philadelphia, PA"
        },
        {
          "date": "May 7",
          "date_iso": "2026-05-07",
          "study": "J3L-MC-EZEF",
          "study_url": "https://app.clinicalresearch.io/clinical-research-philadelphia-crp/philadelphia-pa/study/89175/subjects",
          "visit": "V7-Treatment",
          "patient": "CHAROLETTE  Willis",
          "patient_url": "https://app.clinicalresearch.io/clinical-research-philadelphia-crp/philadelphia-pa/study/89175/subjects",
          "status": "Enrolled",
          "coord": "Stacey Scott",
          "site": "Philadelphia, PA"
        }
      ]
    }
  ],
  "cancelByStudy": [
    {
        "name": "J2A-MC-GZPS",
        "count": 20,
        "study_url": "https://app.clinicalresearch.io/clinical-research-philadelphia-crp/philadelphia-pa/study/162596/subjects"
    },
    {
        "name": "C4951063",
        "count": 16,
        "study_url": "https://app.clinicalresearch.io/clinical-research-philadelphia-crp/philadelphia-pa/study/135648/subjects"
    },
    {
        "name": "N1T-MC-MALO",
        "count": 11,
        "study_url": "https://app.clinicalresearch.io/clinical-research-philadelphia-crp/clinical-research-philadelphia-pennington/study/167755/subjects"
    },
    {
        "name": "J2A-MC-GZPO",
        "count": 8,
        "study_url": "https://app.clinicalresearch.io/clinical-research-philadelphia-crp/philadelphia-pa/study/135157/subjects"
    },
    {
        "name": "MR-130A-01-TD-3001",
        "count": 7,
        "study_url": "https://app.clinicalresearch.io/clinical-research-philadelphia-crp/philadelphia-pa/study/109260/subjects"
    },
    {
        "name": "D7960C00015",
        "count": 6,
        "study_url": "https://app.clinicalresearch.io/clinical-research-philadelphia-crp/philadelphia-pa/study/154462/subjects"
    },
    {
        "name": "D6973C00001",
        "count": 4,
        "study_url": "https://app.clinicalresearch.io/clinical-research-philadelphia-crp/clinical-research-philadelphia-pennington/study/161619/subjects"
    },
    {
        "name": "20230222",
        "count": 3,
        "study_url": "https://app.clinicalresearch.io/clinical-research-philadelphia-crp/clinical-research-philadelphia-pennington/study/167794/subjects"
    },
    {
        "name": "J3F-MC-EZCC",
        "count": 3,
        "study_url": "https://app.clinicalresearch.io/clinical-research-philadelphia-crp/clinical-research-philadelphia-pennington/study/172389/subjects"
    },
    {
        "name": "M20-465",
        "count": 3,
        "study_url": "https://app.clinicalresearch.io/clinical-research-philadelphia-crp/philadelphia-pa/study/107641/subjects"
    },
    {
        "name": "J3L-MC-EZEF",
        "count": 2,
        "study_url": "https://app.clinicalresearch.io/clinical-research-philadelphia-crp/philadelphia-pa/study/89175/subjects"
    },
    {
        "name": "M23-714",
        "count": 2,
        "study_url": "https://app.clinicalresearch.io/clinical-research-philadelphia-crp/philadelphia-pa/study/86826/subjects"
    },
    {
        "name": "J2A-MC-GZGS",
        "count": 2,
        "study_url": "https://app.clinicalresearch.io/clinical-research-philadelphia-crp/philadelphia-pa/study/60296/subjects"
    },
    {
        "name": "88545223PSA2001",
        "count": 1,
        "study_url": "https://app.clinicalresearch.io/clinical-research-philadelphia-crp/philadelphia-pa/study/173860/subjects"
    },
    {
        "name": "M23-698",
        "count": 1,
        "study_url": "https://app.clinicalresearch.io/clinical-research-philadelphia-crp/philadelphia-pa/study/67894/subjects"
    },
    {
        "name": "J1G-MC-LAKI",
        "count": 1,
        "study_url": "https://app.clinicalresearch.io/clinical-research-philadelphia-crp/philadelphia-pa/study/119640/subjects"
    },
    {
        "name": "80202135SLE3001",
        "count": 1,
        "study_url": "https://app.clinicalresearch.io/clinical-research-philadelphia-crp/philadelphia-pa/study/177553/subjects"
    },
    {
        "name": "80202135SJS3001",
        "count": 1,
        "study_url": "https://app.clinicalresearch.io/clinical-research-philadelphia-crp/clinical-research-philadelphia-pennington/study/150548/subjects"
    },
    {
        "name": "CDX0159-12",
        "count": 1,
        "study_url": "https://app.clinicalresearch.io/clinical-research-philadelphia-crp/philadelphia-pa/study/102540/subjects"
    }
],
  "upcomingByStudyFull": [
    {
      "study": "J3L-MC-EZEF",
      "full": "J3L-MC-EZEF",
      "name": "J3L-MC-EZEF",
      "count": 38,
      "study_url": "https://app.clinicalresearch.io/clinical-research-philadelphia-crp/philadelphia-pa/study/89175/subjects"
    },
    {
      "study": "MR-130A-01-TD-3001",
      "full": "MR-130A-01-TD-3001",
      "name": "MR-130A-01-TD-3001",
      "count": 11,
      "study_url": "https://app.clinicalresearch.io/clinical-research-philadelphia-crp/philadelphia-pa/study/109260/subjects"
    },
    {
      "study": "M20-465",
      "full": "M20-465",
      "name": "M20-465",
      "count": 9,
      "study_url": "https://app.clinicalresearch.io/clinical-research-philadelphia-crp/philadelphia-pa/study/107641/subjects"
    },
    {
      "study": "20230222",
      "full": "20230222",
      "name": "20230222",
      "count": 7,
      "study_url": "https://app.clinicalresearch.io/clinical-research-philadelphia-crp/clinical-research-philadelphia-pennington/study/167794/subjects"
    },
    {
      "study": "77242113PSO3006",
      "full": "77242113PSO3006",
      "name": "77242113PSO3006",
      "count": 7,
      "study_url": "https://app.clinicalresearch.io/clinical-research-philadelphia-crp/philadelphia-pa/study/136289/subjects"
    },
    {
      "study": "N1T-MC-MALO",
      "full": "N1T-MC-MALO",
      "name": "N1T-MC-MALO",
      "count": 6,
      "study_url": "https://app.clinicalresearch.io/clinical-research-philadelphia-crp/clinical-research-philadelphia-pennington/study/167755/subjects"
    },
    {
      "study": "M23-714",
      "full": "M23-714",
      "name": "M23-714",
      "count": 5,
      "study_url": "https://app.clinicalresearch.io/clinical-research-philadelphia-crp/philadelphia-pa/study/86826/subjects"
    },
    {
      "study": "J2A-MC-GZPO",
      "full": "J2A-MC-GZPO",
      "name": "J2A-MC-GZPO",
      "count": 5,
      "study_url": "https://app.clinicalresearch.io/clinical-research-philadelphia-crp/philadelphia-pa/study/135157/subjects"
    },
    {
      "study": "80202135SJS3001",
      "full": "80202135SJS3001",
      "name": "80202135SJS3001",
      "count": 4,
      "study_url": "https://app.clinicalresearch.io/clinical-research-philadelphia-crp/clinical-research-philadelphia-pennington/study/150548/subjects"
    },
    {
      "study": "M23-698",
      "full": "M23-698",
      "name": "M23-698",
      "count": 3,
      "study_url": "https://app.clinicalresearch.io/clinical-research-philadelphia-crp/philadelphia-pa/study/67894/subjects"
    },
    {
      "study": "D6973C00001",
      "full": "D6973C00001",
      "name": "D6973C00001",
      "count": 3,
      "study_url": "https://app.clinicalresearch.io/clinical-research-philadelphia-crp/clinical-research-philadelphia-pennington/study/161619/subjects"
    },
    {
      "study": "C4951063",
      "full": "C4951063",
      "name": "C4951063",
      "count": 1,
      "study_url": "https://app.clinicalresearch.io/clinical-research-philadelphia-crp/philadelphia-pa/study/135648/subjects"
    },
    {
      "study": "LTS17367",
      "full": "LTS17367",
      "name": "LTS17367",
      "count": 1,
      "study_url": "https://app.clinicalresearch.io/clinical-research-philadelphia-crp/philadelphia-pa/study/129137/subjects"
    },
    {
      "study": "CDX0159-12",
      "full": "CDX0159-12",
      "name": "CDX0159-12",
      "count": 1,
      "study_url": "https://app.clinicalresearch.io/clinical-research-philadelphia-crp/philadelphia-pa/study/102540/subjects"
    },
    {
      "study": "EFC17600 (ESTUARY)",
      "full": "EFC17600 (ESTUARY)",
      "name": "EFC17600 (ESTUARY)",
      "count": 1,
      "study_url": "https://app.clinicalresearch.io/clinical-research-philadelphia-crp/philadelphia-pa/study/122602/subjects"
    },
    {
      "study": "EFC17599",
      "full": "EFC17599",
      "name": "EFC17599",
      "count": 1,
      "study_url": "https://app.clinicalresearch.io/clinical-research-philadelphia-crp/philadelphia-pa/study/97908/subjects"
    },
    {
      "study": "J1G-MC-LAKI",
      "full": "J1G-MC-LAKI",
      "name": "J1G-MC-LAKI",
      "count": 1,
      "study_url": "https://app.clinicalresearch.io/clinical-research-philadelphia-crp/philadelphia-pa/study/119640/subjects"
    },
    {
      "study": "J3F-MC-EZCC",
      "full": "J3F-MC-EZCC",
      "name": "J3F-MC-EZCC",
      "count": 1,
      "study_url": "https://app.clinicalresearch.io/clinical-research-philadelphia-crp/clinical-research-philadelphia-pennington/study/172389/subjects"
    },
    {
      "study": "D7960C00015",
      "full": "D7960C00015",
      "name": "D7960C00015",
      "count": 1,
      "study_url": "https://app.clinicalresearch.io/clinical-research-philadelphia-crp/philadelphia-pa/study/154462/subjects"
    }
  ],
  "riskMatrix": [
    {
      "study": "J2A-MC-GZPS",
      "study_url": "https://app.clinicalresearch.io/clinical-research-philadelphia-crp/philadelphia-pa/study/162596/subjects",
      "cancels": 22,
      "upcoming": 0,
      "score": 22.0,
      "level": "critical",
      "action": "Immediate review"
    },
    {
      "study": "C4951063",
      "study_url": "https://app.clinicalresearch.io/clinical-research-philadelphia-crp/philadelphia-pa/study/135648/subjects",
      "cancels": 18,
      "upcoming": 1,
      "score": 18.2,
      "level": "critical",
      "action": "Immediate review"
    },
    {
      "study": "N1T-MC-MALO",
      "study_url": "https://app.clinicalresearch.io/clinical-research-philadelphia-crp/clinical-research-philadelphia-pennington/study/167755/subjects",
      "cancels": 18,
      "upcoming": 6,
      "score": 18.0,
      "level": "critical",
      "action": "Immediate review"
    },
    {
      "study": "J2A-MC-GZPO",
      "study_url": "https://app.clinicalresearch.io/clinical-research-philadelphia-crp/philadelphia-pa/study/135157/subjects",
      "cancels": 12,
      "upcoming": 5,
      "score": 12.0,
      "level": "high",
      "action": "Monitor"
    },
    {
      "study": "MR-130A-01-TD-3001",
      "study_url": "https://app.clinicalresearch.io/clinical-research-philadelphia-crp/philadelphia-pa/study/109260/subjects",
      "cancels": 8,
      "upcoming": 11,
      "score": 8.0,
      "level": "high",
      "action": "Monitor"
    },
    {
      "study": "D7960C00015",
      "study_url": "https://app.clinicalresearch.io/clinical-research-philadelphia-crp/philadelphia-pa/study/154462/subjects",
      "cancels": 6,
      "upcoming": 1,
      "score": 6.2,
      "level": "medium",
      "action": "Monitor"
    },
    {
      "study": "J3F-MC-EZCC",
      "study_url": "https://app.clinicalresearch.io/clinical-research-philadelphia-crp/clinical-research-philadelphia-pennington/study/172389/subjects",
      "cancels": 5,
      "upcoming": 1,
      "score": 5.2,
      "level": "medium",
      "action": "Monitor"
    },
    {
      "study": "J2A-MC-GZGS",
      "study_url": "https://app.clinicalresearch.io/clinical-research-philadelphia-crp/philadelphia-pa/study/60296/subjects",
      "cancels": 5,
      "upcoming": 0,
      "score": 5.0,
      "level": "medium",
      "action": "Monitor"
    },
    {
      "study": "D6973C00001",
      "study_url": "https://app.clinicalresearch.io/clinical-research-philadelphia-crp/clinical-research-philadelphia-pennington/study/161619/subjects",
      "cancels": 4,
      "upcoming": 3,
      "score": 4.6,
      "level": "medium",
      "action": "Monitor"
    },
    {
      "study": "M23-714",
      "study_url": "https://app.clinicalresearch.io/clinical-research-philadelphia-crp/philadelphia-pa/study/86826/subjects",
      "cancels": 4,
      "upcoming": 5,
      "score": 4.0,
      "level": "medium",
      "action": "Monitor"
    },
    {
      "study": "20230222",
      "study_url": "https://app.clinicalresearch.io/clinical-research-philadelphia-crp/clinical-research-philadelphia-pennington/study/167794/subjects",
      "cancels": 3,
      "upcoming": 7,
      "score": 3.0,
      "level": "low",
      "action": "Monitor"
    },
    {
      "study": "M20-465",
      "study_url": "https://app.clinicalresearch.io/clinical-research-philadelphia-crp/philadelphia-pa/study/107641/subjects",
      "cancels": 3,
      "upcoming": 9,
      "score": 3.0,
      "level": "low",
      "action": "Monitor"
    },
    {
      "study": "88545223PSA2001",
      "study_url": "https://app.clinicalresearch.io/clinical-research-philadelphia-crp/philadelphia-pa/study/173860/subjects",
      "cancels": 3,
      "upcoming": 0,
      "score": 3.0,
      "level": "low",
      "action": "Monitor"
    },
    {
      "study": "J3L-MC-EZEF",
      "study_url": "https://app.clinicalresearch.io/clinical-research-philadelphia-crp/philadelphia-pa/study/89175/subjects",
      "cancels": 2,
      "upcoming": 38,
      "score": 2.0,
      "level": "low",
      "action": "Monitor"
    },
    {
      "study": "80202135SJS3001",
      "study_url": "https://app.clinicalresearch.io/clinical-research-philadelphia-crp/clinical-research-philadelphia-pennington/study/150548/subjects",
      "cancels": 1,
      "upcoming": 4,
      "score": 1.8,
      "level": "low",
      "action": "Monitor"
    },
    {
      "study": "M23-698",
      "study_url": "https://app.clinicalresearch.io/clinical-research-philadelphia-crp/philadelphia-pa/study/67894/subjects",
      "cancels": 1,
      "upcoming": 3,
      "score": 1.6,
      "level": "low",
      "action": "Monitor"
    },
    {
      "study": "J1G-MC-LAKI",
      "study_url": "https://app.clinicalresearch.io/clinical-research-philadelphia-crp/philadelphia-pa/study/119640/subjects",
      "cancels": 1,
      "upcoming": 1,
      "score": 1.2,
      "level": "low",
      "action": "Monitor"
    },
    {
      "study": "EFC17600 (ESTUARY)",
      "study_url": "https://app.clinicalresearch.io/clinical-research-philadelphia-crp/philadelphia-pa/study/122602/subjects",
      "cancels": 1,
      "upcoming": 1,
      "score": 1.2,
      "level": "low",
      "action": "Monitor"
    },
    {
      "study": "CDX0159-12",
      "study_url": "https://app.clinicalresearch.io/clinical-research-philadelphia-crp/philadelphia-pa/study/102540/subjects",
      "cancels": 1,
      "upcoming": 1,
      "score": 1.2,
      "level": "low",
      "action": "Monitor"
    },
    {
      "study": "80202135SLE3001",
      "study_url": "https://app.clinicalresearch.io/clinical-research-philadelphia-crp/philadelphia-pa/study/177553/subjects",
      "cancels": 1,
      "upcoming": 0,
      "score": 1.0,
      "level": "low",
      "action": "Monitor"
    },
    {
      "study": "95597528ADM2001",
      "study_url": "https://app.clinicalresearch.io/clinical-research-philadelphia-crp/philadelphia-pa/study/172395/subjects",
      "cancels": 1,
      "upcoming": 0,
      "score": 1.0,
      "level": "low",
      "action": "Monitor"
    },
    {
      "study": "LTS17367",
      "study_url": "https://app.clinicalresearch.io/clinical-research-philadelphia-crp/philadelphia-pa/study/129137/subjects",
      "cancels": 0,
      "upcoming": 1,
      "score": 0.2,
      "level": "low",
      "action": "Monitor"
    },
    {
      "study": "EFC17599",
      "study_url": "https://app.clinicalresearch.io/clinical-research-philadelphia-crp/philadelphia-pa/study/97908/subjects",
      "cancels": 0,
      "upcoming": 1,
      "score": 0.2,
      "level": "low",
      "action": "Monitor"
    },
    {
      "study": "77242113PSO3006",
      "study_url": "https://app.clinicalresearch.io/clinical-research-philadelphia-crp/philadelphia-pa/study/136289/subjects",
      "cancels": 0,
      "upcoming": 7,
      "score": 0.0,
      "level": "low",
      "action": "Monitor"
    }
  ],
  "mergedStudies": [
    {
        "study": "J2A-MC-GZPS",
        "study_url": "https://app.clinicalresearch.io/clinical-research-philadelphia-crp/philadelphia-pa/study/162596/subjects",
        "sites": [
            "PHL"
        ],
        "enroll_status": "Enrolling",
        "cancels": 22,
        "upcoming": 0,
        "risk_score": 22.0,
        "risk_level": "critical",
        "target": 5,
        "enrolled": 0,
        "pct": 0,
        "remaining": 5,
        "over": 0,
        "screening": 0,
        "screened": 9,
        "screen_fail": 9,
        "screen_fail_pct": 100.0,
        "active": 0,
        "completed": 0
    },
    {
        "study": "C4951063",
        "study_url": "https://app.clinicalresearch.io/clinical-research-philadelphia-crp/philadelphia-pa/study/135648/subjects",
        "sites": [
            "PHL"
        ],
        "enroll_status": "Enrolling",
        "cancels": 18,
        "upcoming": 1,
        "risk_score": 14.4,
        "risk_level": "critical",
        "target": 5,
        "enrolled": 0,
        "pct": 0,
        "remaining": 5,
        "over": 0,
        "screening": 3,
        "screened": 7,
        "screen_fail": 4,
        "screen_fail_pct": 57.1,
        "active": 0,
        "completed": 0
    },
    {
        "study": "N1T-MC-MALO",
        "study_url": "https://app.clinicalresearch.io/clinical-research-philadelphia-crp/clinical-research-philadelphia-pennington/study/167755/subjects",
        "sites": [
            "PNJ"
        ],
        "enroll_status": "Enrolling",
        "cancels": 18,
        "upcoming": 6,
        "risk_score": 11.83,
        "risk_level": "critical",
        "target": 15,
        "enrolled": 1,
        "pct": 7,
        "remaining": 14,
        "over": 0,
        "screening": 33,
        "screened": 59,
        "screen_fail": 25,
        "screen_fail_pct": 42.4,
        "active": 1,
        "completed": 0
    },
    {
        "study": "MR-130A-01-TD-3001",
        "study_url": "https://app.clinicalresearch.io/clinical-research-philadelphia-crp/philadelphia-pa/study/109260/subjects",
        "sites": [
            "PHL"
        ],
        "enroll_status": "Enrolling",
        "cancels": 8,
        "upcoming": 11,
        "risk_score": 5.07,
        "risk_level": "critical",
        "target": 15,
        "enrolled": 12,
        "pct": 80,
        "remaining": 3,
        "over": 0,
        "screening": 0,
        "screened": 21,
        "screen_fail": 9,
        "screen_fail_pct": 42.9,
        "active": 10,
        "completed": 0
    },
    {
        "study": "D7960C00015",
        "study_url": "https://app.clinicalresearch.io/clinical-research-philadelphia-crp/philadelphia-pa/study/154462/subjects",
        "sites": [
            "PHL"
        ],
        "enroll_status": "Enrolling",
        "cancels": 6,
        "upcoming": 1,
        "risk_score": 4.8,
        "risk_level": "critical",
        "target": 10,
        "enrolled": 1,
        "pct": 10,
        "remaining": 9,
        "over": 0,
        "screening": 0,
        "screened": 9,
        "screen_fail": 8,
        "screen_fail_pct": 88.9,
        "active": 1,
        "completed": 0
    },
    {
        "study": "J3F-MC-EZCC",
        "study_url": "https://app.clinicalresearch.io/clinical-research-philadelphia-crp/clinical-research-philadelphia-pennington/study/172389/subjects",
        "sites": [
            "PNJ"
        ],
        "enroll_status": "Enrolling",
        "cancels": 5,
        "upcoming": 1,
        "risk_score": 4.0,
        "risk_level": "critical",
        "target": 5,
        "enrolled": 0,
        "pct": 0,
        "remaining": 5,
        "over": 0,
        "screening": 1,
        "screened": 4,
        "screen_fail": 3,
        "screen_fail_pct": 75.0,
        "active": 0,
        "completed": 0
    },
    {
        "study": "88545223PSA2001",
        "study_url": "https://app.clinicalresearch.io/clinical-research-philadelphia-crp/philadelphia-pa/study/173860/subjects",
        "sites": [
            "PHL"
        ],
        "enroll_status": "Enrolling",
        "cancels": 3,
        "upcoming": 0,
        "risk_score": 3.0,
        "risk_level": "high",
        "target": 4,
        "enrolled": 0,
        "pct": 0,
        "remaining": 4,
        "over": 0,
        "screening": 0,
        "screened": 0,
        "screen_fail": 0,
        "screen_fail_pct": 0,
        "active": 0,
        "completed": 0
    },
    {
        "study": "D6973C00001",
        "study_url": "https://app.clinicalresearch.io/clinical-research-philadelphia-crp/clinical-research-philadelphia-pennington/study/161619/subjects",
        "sites": [
            "PNJ",
            "PHL"
        ],
        "enroll_status": "Enrolling",
        "cancels": 4,
        "upcoming": 3,
        "risk_score": 2.8,
        "risk_level": "high",
        "target": 10,
        "enrolled": 1,
        "pct": 10,
        "remaining": 9,
        "over": 0,
        "screening": 2,
        "screened": 7,
        "screen_fail": 4,
        "screen_fail_pct": 57.1,
        "active": 1,
        "completed": 0
    },
    {
        "study": "M23-714",
        "study_url": "https://app.clinicalresearch.io/clinical-research-philadelphia-crp/philadelphia-pa/study/86826/subjects",
        "sites": [
            "PHL"
        ],
        "enroll_status": "Enrolling",
        "cancels": 4,
        "upcoming": 5,
        "risk_score": 2.67,
        "risk_level": "high",
        "target": 6,
        "enrolled": 5,
        "pct": 83,
        "remaining": 1,
        "over": 0,
        "screening": 1,
        "screened": 36,
        "screen_fail": 30,
        "screen_fail_pct": 83.3,
        "active": 4,
        "completed": 1
    },
    {
        "study": "20230222",
        "study_url": "https://app.clinicalresearch.io/clinical-research-philadelphia-crp/clinical-research-philadelphia-pennington/study/167794/subjects",
        "sites": [
            "PNJ"
        ],
        "enroll_status": "Enrolling",
        "cancels": 3,
        "upcoming": 7,
        "risk_score": 1.95,
        "risk_level": "medium",
        "target": 10,
        "enrolled": 1,
        "pct": 10,
        "remaining": 9,
        "over": 0,
        "screening": 13,
        "screened": 19,
        "screen_fail": 5,
        "screen_fail_pct": 26.3,
        "active": 1,
        "completed": 0
    },
    {
        "study": "M20-465",
        "study_url": "https://app.clinicalresearch.io/clinical-research-philadelphia-crp/philadelphia-pa/study/107641/subjects",
        "sites": [
            "PHL"
        ],
        "enroll_status": "Enrolling",
        "cancels": 3,
        "upcoming": 9,
        "risk_score": 1.92,
        "risk_level": "medium",
        "target": 5,
        "enrolled": 10,
        "pct": 200,
        "remaining": 0,
        "over": 5,
        "screening": 0,
        "screened": 17,
        "screen_fail": 7,
        "screen_fail_pct": 41.2,
        "active": 8,
        "completed": 0
    },
    {
        "study": "80202135SLE3001",
        "study_url": "https://app.clinicalresearch.io/clinical-research-philadelphia-crp/philadelphia-pa/study/177553/subjects",
        "sites": [
            "PHL"
        ],
        "enroll_status": "Enrolling",
        "cancels": 1,
        "upcoming": 0,
        "risk_score": 1.0,
        "risk_level": "medium",
        "target": 4,
        "enrolled": 0,
        "pct": 0,
        "remaining": 4,
        "over": 0,
        "screening": 0,
        "screened": 0,
        "screen_fail": 0,
        "screen_fail_pct": 0,
        "active": 0,
        "completed": 0
    },
    {
        "study": "95597528ADM2001",
        "study_url": "https://app.clinicalresearch.io/clinical-research-philadelphia-crp/philadelphia-pa/study/172395/subjects",
        "sites": [
            "PHL"
        ],
        "enroll_status": "Enrolling",
        "cancels": 1,
        "upcoming": 0,
        "risk_score": 1.0,
        "risk_level": "medium",
        "target": 6,
        "enrolled": 1,
        "pct": 17,
        "remaining": 5,
        "over": 0,
        "screening": 0,
        "screened": 2,
        "screen_fail": 1,
        "screen_fail_pct": 50.0,
        "active": 1,
        "completed": 0
    },
    {
        "study": "M23-698",
        "study_url": "https://app.clinicalresearch.io/clinical-research-philadelphia-crp/philadelphia-pa/study/67894/subjects",
        "sites": [
            "PHL"
        ],
        "enroll_status": "Enrolling",
        "cancels": 1,
        "upcoming": 3,
        "risk_score": 0.7,
        "risk_level": "low",
        "target": 5,
        "enrolled": 6,
        "pct": 120,
        "remaining": 0,
        "over": 1,
        "screening": 0,
        "screened": 10,
        "screen_fail": 4,
        "screen_fail_pct": 40.0,
        "active": 2,
        "completed": 0
    },
    {
        "study": "EFC17599",
        "study_url": "https://app.clinicalresearch.io/clinical-research-philadelphia-crp/philadelphia-pa/study/97908/subjects",
        "sites": [
            "PHL"
        ],
        "enroll_status": "Enrolling",
        "cancels": 0,
        "upcoming": 1,
        "risk_score": 0,
        "risk_level": "low",
        "target": 4,
        "enrolled": 2,
        "pct": 50,
        "remaining": 2,
        "over": 0,
        "screening": 0,
        "screened": 2,
        "screen_fail": 0,
        "screen_fail_pct": 0.0,
        "active": 1,
        "completed": 1
    },
    {
        "study": "J2O-MC-EKBG",
        "study_url": "https://app.clinicalresearch.io/clinical-research-philadelphia-crp/philadelphia-pa/study/188815/subjects",
        "sites": [
            "PHL"
        ],
        "enroll_status": "Enrolling",
        "cancels": 0,
        "upcoming": 0,
        "risk_score": 0,
        "risk_level": "low",
        "target": 15,
        "enrolled": 0,
        "pct": 0,
        "remaining": 15,
        "over": 0,
        "screening": 0,
        "screened": 0,
        "screen_fail": 0,
        "screen_fail_pct": 0,
        "active": 0,
        "completed": 0
    },
    {
        "study": "ATD002",
        "study_url": "https://app.clinicalresearch.io/clinical-research-philadelphia-crp/philadelphia-pa/study/163891/subjects",
        "sites": [
            "PHL"
        ],
        "enroll_status": "Enrolling",
        "cancels": 0,
        "upcoming": 0,
        "risk_score": 0,
        "risk_level": "n/a",
        "target": 6,
        "enrolled": 0,
        "pct": 0,
        "remaining": 6,
        "over": 0,
        "screening": 0,
        "screened": 0,
        "screen_fail": 0,
        "screen_fail_pct": 0,
        "active": 0,
        "completed": 0
    },
    {
        "study": "77242113PSO3006",
        "study_url": "https://app.clinicalresearch.io/clinical-research-philadelphia-crp/philadelphia-pa/study/136289/subjects",
        "sites": [
            "PHL"
        ],
        "enroll_status": "Maintenance",
        "cancels": 0,
        "upcoming": 7,
        "risk_score": 0,
        "risk_level": "n/a",
        "target": 5,
        "enrolled": 7,
        "pct": 140,
        "remaining": 0,
        "over": 2,
        "screening": 0,
        "screened": 10,
        "screen_fail": 3,
        "screen_fail_pct": 30.0,
        "active": 7,
        "completed": 0
    },
    {
        "study": "80202135SJS3001",
        "study_url": "https://app.clinicalresearch.io/clinical-research-philadelphia-crp/clinical-research-philadelphia-pennington/study/150548/subjects",
        "sites": [
            "PHL"
        ],
        "enroll_status": "Maintenance",
        "cancels": 1,
        "upcoming": 4,
        "risk_score": 0,
        "risk_level": "n/a",
        "target": null,
        "enrolled": 2,
        "pct": 0,
        "remaining": 0,
        "over": 2,
        "screening": 0,
        "screened": 10,
        "screen_fail": 8,
        "screen_fail_pct": 80.0,
        "active": 2,
        "completed": 0
    },
    {
        "study": "CDX0159-12",
        "study_url": "https://app.clinicalresearch.io/clinical-research-philadelphia-crp/philadelphia-pa/study/102540/subjects",
        "sites": [
            "PHL"
        ],
        "enroll_status": "Maintenance",
        "cancels": 1,
        "upcoming": 1,
        "risk_score": 0,
        "risk_level": "n/a",
        "target": null,
        "enrolled": 1,
        "pct": 0,
        "remaining": 0,
        "over": 1,
        "screening": 0,
        "screened": 9,
        "screen_fail": 8,
        "screen_fail_pct": 88.9,
        "active": 1,
        "completed": 0
    },
    {
        "study": "EFC17600 (ESTUARY)",
        "study_url": "https://app.clinicalresearch.io/clinical-research-philadelphia-crp/philadelphia-pa/study/122602/subjects",
        "sites": [
            "PHL"
        ],
        "enroll_status": "Maintenance",
        "cancels": 1,
        "upcoming": 1,
        "risk_score": 0,
        "risk_level": "n/a",
        "target": null,
        "enrolled": 1,
        "pct": 0,
        "remaining": 0,
        "over": 1,
        "screening": 0,
        "screened": 1,
        "screen_fail": 0,
        "screen_fail_pct": 0.0,
        "active": 1,
        "completed": 0
    },
    {
        "study": "I8F-MC-GPHE",
        "study_url": "https://app.clinicalresearch.io/clinical-research-philadelphia-crp/philadelphia-pa/study/50058/subjects",
        "sites": [
            "PHL"
        ],
        "enroll_status": "Maintenance",
        "cancels": 0,
        "upcoming": 0,
        "risk_score": 0,
        "risk_level": "n/a",
        "target": null,
        "enrolled": 2,
        "pct": 0,
        "remaining": 0,
        "over": 2,
        "screening": 0,
        "screened": 5,
        "screen_fail": 3,
        "screen_fail_pct": 60.0,
        "active": 2,
        "completed": 0
    },
    {
        "study": "J1G-MC-LAKI",
        "study_url": "https://app.clinicalresearch.io/clinical-research-philadelphia-crp/philadelphia-pa/study/119640/subjects",
        "sites": [
            "PHL"
        ],
        "enroll_status": "Maintenance",
        "cancels": 1,
        "upcoming": 1,
        "risk_score": 0,
        "risk_level": "n/a",
        "target": 4,
        "enrolled": 6,
        "pct": 150,
        "remaining": 0,
        "over": 2,
        "screening": 0,
        "screened": 147,
        "screen_fail": 141,
        "screen_fail_pct": 95.9,
        "active": 3,
        "completed": 0
    },
    {
        "study": "J2A-MC-GZGS",
        "study_url": "https://app.clinicalresearch.io/clinical-research-philadelphia-crp/philadelphia-pa/study/60296/subjects",
        "sites": [
            "PHL"
        ],
        "enroll_status": "Maintenance",
        "cancels": 5,
        "upcoming": 0,
        "risk_score": 0,
        "risk_level": "n/a",
        "target": 4,
        "enrolled": 9,
        "pct": 225,
        "remaining": 0,
        "over": 5,
        "screening": 0,
        "screened": 25,
        "screen_fail": 16,
        "screen_fail_pct": 64.0,
        "active": 0,
        "completed": 6
    },
    {
        "study": "J2A-MC-GZPO",
        "study_url": "https://app.clinicalresearch.io/clinical-research-philadelphia-crp/philadelphia-pa/study/135157/subjects",
        "sites": [
            "PHL"
        ],
        "enroll_status": "Maintenance",
        "cancels": 12,
        "upcoming": 5,
        "risk_score": 0,
        "risk_level": "n/a",
        "target": null,
        "enrolled": 6,
        "pct": 0,
        "remaining": 0,
        "over": 6,
        "screening": 0,
        "screened": 49,
        "screen_fail": 43,
        "screen_fail_pct": 87.8,
        "active": 5,
        "completed": 0
    },
    {
        "study": "J3L-MC-EZEF",
        "study_url": "https://app.clinicalresearch.io/clinical-research-philadelphia-crp/philadelphia-pa/study/89175/subjects",
        "sites": [
            "PHL"
        ],
        "enroll_status": "Maintenance",
        "cancels": 2,
        "upcoming": 38,
        "risk_score": 0,
        "risk_level": "n/a",
        "target": 15,
        "enrolled": 52,
        "pct": 347,
        "remaining": 0,
        "over": 37,
        "screening": 0,
        "screened": 262,
        "screen_fail": 210,
        "screen_fail_pct": 80.2,
        "active": 50,
        "completed": 0
    },
    {
        "study": "LTS17367",
        "study_url": "https://app.clinicalresearch.io/clinical-research-philadelphia-crp/philadelphia-pa/study/129137/subjects",
        "sites": [
            "PHL"
        ],
        "enroll_status": "Maintenance",
        "cancels": 0,
        "upcoming": 1,
        "risk_score": 0,
        "risk_level": "n/a",
        "target": 1,
        "enrolled": 1,
        "pct": 100,
        "remaining": 0,
        "over": 0,
        "screening": 0,
        "screened": 1,
        "screen_fail": 0,
        "screen_fail_pct": 0.0,
        "active": 1,
        "completed": 0
    },
    {
        "study": "MR-100A-01-TD-3001",
        "study_url": "https://app.clinicalresearch.io/clinical-research-philadelphia-crp/philadelphia-pa/study/32653/subjects",
        "sites": [
            "PHL"
        ],
        "enroll_status": "Pre-Closed",
        "cancels": 0,
        "upcoming": 0,
        "risk_score": 0,
        "risk_level": "n/a",
        "target": 25,
        "enrolled": 52,
        "pct": 208,
        "remaining": 0,
        "over": 27,
        "screening": 0,
        "screened": 66,
        "screen_fail": 14,
        "screen_fail_pct": 21.2,
        "active": 0,
        "completed": 19
    },
    {
        "study": "M24-601",
        "study_url": "https://app.clinicalresearch.io/clinical-research-philadelphia-crp/philadelphia-pa/study/101728/subjects",
        "sites": [
            "PHL"
        ],
        "enroll_status": "Enrolling",
        "cancels": 0,
        "upcoming": 0,
        "risk_score": 0,
        "risk_level": "low",
        "target": 5,
        "enrolled": 0,
        "pct": 0,
        "remaining": 5,
        "over": 0,
        "screening": 1,
        "screened": 4,
        "screen_fail": 3,
        "screen_fail_pct": 75.0,
        "active": 0,
        "completed": 0
    }
],
  "enrollmentData": [
    {
        "study": "20230222",
        "full_name": "Amgen, Inc. - 20230222",
        "study_url": "https://app.clinicalresearch.io/clinical-research-philadelphia-crp/clinical-research-philadelphia-pennington/study/167794/subjects",
        "sites": [
            "PNJ"
        ],
        "status": "Enrolling",
        "target": 10,
        "enrolled": 1,
        "active": 1,
        "v1": 4,
        "screening": 13,
        "screened": 19,
        "screen_fail": 5,
        "screen_fail_pct": 26.3,
        "completed": 0,
        "discontinued": 0,
        "pct": 10,
        "remaining": 9,
        "over": 0,
        "upcoming": 7,
        "cancels": 3
    },
    {
        "study": "80202135SJS3001",
        "full_name": "Janssen Research & Development, LLC - 80202135SJS3001",
        "study_url": "https://app.clinicalresearch.io/clinical-research-philadelphia-crp/clinical-research-philadelphia-pennington/study/150548/subjects",
        "sites": [
            "PHL"
        ],
        "status": "Maintenance",
        "target": null,
        "enrolled": 2,
        "active": 2,
        "v1": 0,
        "screening": 0,
        "screened": 10,
        "screen_fail": 8,
        "screen_fail_pct": 80.0,
        "completed": 0,
        "discontinued": 0,
        "pct": 0,
        "remaining": 0,
        "over": 2,
        "upcoming": 4,
        "cancels": 1
    },
    {
        "study": "80202135SLE3001",
        "full_name": "Janssen Research & Development, LLC - 80202135SLE3001",
        "study_url": "https://app.clinicalresearch.io/clinical-research-philadelphia-crp/philadelphia-pa/study/177553/subjects",
        "sites": [
            "PHL"
        ],
        "status": "Enrolling",
        "target": 4,
        "enrolled": 0,
        "active": 0,
        "v1": 0,
        "screening": 0,
        "screened": 0,
        "screen_fail": 0,
        "screen_fail_pct": 0,
        "completed": 0,
        "discontinued": 0,
        "pct": 0,
        "remaining": 4,
        "over": 0,
        "upcoming": 0,
        "cancels": 1
    },
    {
        "study": "88545223PSA2001",
        "full_name": "Janssen Pharmaceuticals, Inc. - 88545223PSA2001",
        "study_url": "https://app.clinicalresearch.io/clinical-research-philadelphia-crp/philadelphia-pa/study/173860/subjects",
        "sites": [
            "PHL"
        ],
        "status": "Enrolling",
        "target": 4,
        "enrolled": 0,
        "active": 0,
        "v1": 0,
        "screening": 0,
        "screened": 0,
        "screen_fail": 0,
        "screen_fail_pct": 0,
        "completed": 0,
        "discontinued": 0,
        "pct": 0,
        "remaining": 4,
        "over": 0,
        "upcoming": 0,
        "cancels": 3
    },
    {
        "study": "95597528ADM2001",
        "full_name": "Johnson & Johnson - 95597528ADM2001",
        "study_url": "https://app.clinicalresearch.io/clinical-research-philadelphia-crp/philadelphia-pa/study/172395/subjects",
        "sites": [
            "PHL"
        ],
        "status": "Enrolling",
        "target": 6,
        "enrolled": 1,
        "active": 1,
        "v1": 6,
        "screening": 0,
        "screened": 2,
        "screen_fail": 1,
        "screen_fail_pct": 50.0,
        "completed": 0,
        "discontinued": 0,
        "pct": 17,
        "remaining": 5,
        "over": 0,
        "upcoming": 0,
        "cancels": 1
    },
    {
        "study": "C4951063",
        "full_name": "Pfizer Inc. - C4951063",
        "study_url": "https://app.clinicalresearch.io/clinical-research-philadelphia-crp/philadelphia-pa/study/135648/subjects",
        "sites": [
            "PHL"
        ],
        "status": "Enrolling",
        "target": 5,
        "enrolled": 0,
        "active": 0,
        "v1": 3,
        "screening": 3,
        "screened": 7,
        "screen_fail": 4,
        "screen_fail_pct": 57.1,
        "completed": 0,
        "discontinued": 0,
        "pct": 0,
        "remaining": 5,
        "over": 0,
        "upcoming": 1,
        "cancels": 18
    },
    {
        "study": "CDX0159-12",
        "full_name": "Celldex Therapeutics - CDX0159-12",
        "study_url": "https://app.clinicalresearch.io/clinical-research-philadelphia-crp/philadelphia-pa/study/102540/subjects",
        "sites": [
            "PHL"
        ],
        "status": "Maintenance",
        "target": null,
        "enrolled": 1,
        "active": 1,
        "v1": 0,
        "screening": 0,
        "screened": 9,
        "screen_fail": 8,
        "screen_fail_pct": 88.9,
        "completed": 0,
        "discontinued": 0,
        "pct": 0,
        "remaining": 0,
        "over": 1,
        "upcoming": 1,
        "cancels": 1
    },
    {
        "study": "D6973C00001",
        "full_name": "Astrazeneca Pharmaceuticals - D6973C00001",
        "study_url": "https://app.clinicalresearch.io/clinical-research-philadelphia-crp/clinical-research-philadelphia-pennington/study/161619/subjects",
        "sites": [
            "PNJ",
            "PHL"
        ],
        "status": "Enrolling",
        "target": 10,
        "enrolled": 1,
        "active": 1,
        "v1": 1,
        "screening": 2,
        "screened": 7,
        "screen_fail": 4,
        "screen_fail_pct": 57.1,
        "completed": 0,
        "discontinued": 0,
        "pct": 10,
        "remaining": 9,
        "over": 0,
        "upcoming": 3,
        "cancels": 4
    },
    {
        "study": "D7960C00015",
        "full_name": "Astrazeneca Pharmaceuticals - D7960C00015",
        "study_url": "https://app.clinicalresearch.io/clinical-research-philadelphia-crp/philadelphia-pa/study/154462/subjects",
        "sites": [
            "PHL"
        ],
        "status": "Enrolling",
        "target": 10,
        "enrolled": 1,
        "active": 1,
        "v1": 7,
        "screening": 0,
        "screened": 9,
        "screen_fail": 8,
        "screen_fail_pct": 88.9,
        "completed": 0,
        "discontinued": 0,
        "pct": 10,
        "remaining": 9,
        "over": 0,
        "upcoming": 1,
        "cancels": 6
    },
    {
        "study": "EFC17599",
        "full_name": "Sanofi US Services Inc. - EFC17599",
        "study_url": "https://app.clinicalresearch.io/clinical-research-philadelphia-crp/philadelphia-pa/study/97908/subjects",
        "sites": [
            "PHL"
        ],
        "status": "Enrolling",
        "target": 4,
        "enrolled": 2,
        "active": 1,
        "v1": 0,
        "screening": 0,
        "screened": 2,
        "screen_fail": 0,
        "screen_fail_pct": 0.0,
        "completed": 1,
        "discontinued": 0,
        "pct": 50,
        "remaining": 2,
        "over": 0,
        "upcoming": 1,
        "cancels": 0
    },
    {
        "study": "EFC17600 (ESTUARY)",
        "full_name": "Sanofi US Services Inc. - EFC17600 (ESTUARY)",
        "study_url": "https://app.clinicalresearch.io/clinical-research-philadelphia-crp/philadelphia-pa/study/122602/subjects",
        "sites": [
            "PHL"
        ],
        "status": "Maintenance",
        "target": null,
        "enrolled": 1,
        "active": 1,
        "v1": 0,
        "screening": 0,
        "screened": 1,
        "screen_fail": 0,
        "screen_fail_pct": 0.0,
        "completed": 0,
        "discontinued": 0,
        "pct": 0,
        "remaining": 0,
        "over": 1,
        "upcoming": 1,
        "cancels": 1
    },
    {
        "study": "I8F-MC-GPHE",
        "full_name": "Eli Lilly and Company - I8F-MC-GPHE",
        "study_url": "https://app.clinicalresearch.io/clinical-research-philadelphia-crp/philadelphia-pa/study/50058/subjects",
        "sites": [
            "PHL"
        ],
        "status": "Maintenance",
        "target": null,
        "enrolled": 2,
        "active": 2,
        "v1": 0,
        "screening": 0,
        "screened": 5,
        "screen_fail": 3,
        "screen_fail_pct": 60.0,
        "completed": 0,
        "discontinued": 0,
        "pct": 0,
        "remaining": 0,
        "over": 2,
        "upcoming": 0,
        "cancels": 0
    },
    {
        "study": "J2A-MC-GZPO",
        "full_name": "Eli Lilly and Company - J2A-MC-GZPO",
        "study_url": "https://app.clinicalresearch.io/clinical-research-philadelphia-crp/philadelphia-pa/study/135157/subjects",
        "sites": [
            "PHL"
        ],
        "status": "Maintenance",
        "target": null,
        "enrolled": 6,
        "active": 5,
        "v1": 2,
        "screening": 0,
        "screened": 49,
        "screen_fail": 43,
        "screen_fail_pct": 87.8,
        "completed": 0,
        "discontinued": 1,
        "pct": 0,
        "remaining": 0,
        "over": 6,
        "upcoming": 5,
        "cancels": 12
    },
    {
        "study": "J2A-MC-GZPS",
        "full_name": "Eli Lilly and Company - J2A-MC-GZPS",
        "study_url": "https://app.clinicalresearch.io/clinical-research-philadelphia-crp/philadelphia-pa/study/162596/subjects",
        "sites": [
            "PHL"
        ],
        "status": "Enrolling",
        "target": 5,
        "enrolled": 0,
        "active": 0,
        "v1": 46,
        "screening": 0,
        "screened": 9,
        "screen_fail": 9,
        "screen_fail_pct": 100.0,
        "completed": 0,
        "discontinued": 0,
        "pct": 0,
        "remaining": 5,
        "over": 0,
        "upcoming": 0,
        "cancels": 22
    },
    {
        "study": "J2O-MC-EKBG",
        "full_name": "Eli Lilly and Company - J2O-MC-EKBG",
        "study_url": "https://app.clinicalresearch.io/clinical-research-philadelphia-crp/philadelphia-pa/study/188815/subjects",
        "sites": [
            "PHL"
        ],
        "status": "Enrolling",
        "target": 15,
        "enrolled": 0,
        "active": 0,
        "v1": 0,
        "screening": 0,
        "screened": 0,
        "screen_fail": 0,
        "screen_fail_pct": 0,
        "completed": 0,
        "discontinued": 0,
        "pct": 0,
        "remaining": 15,
        "over": 0,
        "upcoming": 0,
        "cancels": 0
    },
    {
        "study": "J3F-MC-EZCC",
        "full_name": "Eli Lilly and Company - J3F-MC-EZCC",
        "study_url": "https://app.clinicalresearch.io/clinical-research-philadelphia-crp/clinical-research-philadelphia-pennington/study/172389/subjects",
        "sites": [
            "PNJ"
        ],
        "status": "Enrolling",
        "target": 5,
        "enrolled": 0,
        "active": 0,
        "v1": 5,
        "screening": 1,
        "screened": 4,
        "screen_fail": 3,
        "screen_fail_pct": 75.0,
        "completed": 0,
        "discontinued": 0,
        "pct": 0,
        "remaining": 5,
        "over": 0,
        "upcoming": 1,
        "cancels": 5
    },
    {
        "study": "M20-465",
        "full_name": "Abbvie - M20-465",
        "study_url": "https://app.clinicalresearch.io/clinical-research-philadelphia-crp/philadelphia-pa/study/107641/subjects",
        "sites": [
            "PHL"
        ],
        "status": "Enrolling",
        "target": 5,
        "enrolled": 10,
        "active": 8,
        "v1": 5,
        "screening": 0,
        "screened": 17,
        "screen_fail": 7,
        "screen_fail_pct": 41.2,
        "completed": 0,
        "discontinued": 2,
        "pct": 200,
        "remaining": 0,
        "over": 5,
        "upcoming": 9,
        "cancels": 3
    },
    {
        "study": "M23-698",
        "full_name": "Abbvie - M23-698",
        "study_url": "https://app.clinicalresearch.io/clinical-research-philadelphia-crp/philadelphia-pa/study/67894/subjects",
        "sites": [
            "PHL"
        ],
        "status": "Enrolling",
        "target": 5,
        "enrolled": 6,
        "active": 2,
        "v1": 0,
        "screening": 0,
        "screened": 10,
        "screen_fail": 4,
        "screen_fail_pct": 40.0,
        "completed": 0,
        "discontinued": 4,
        "pct": 120,
        "remaining": 0,
        "over": 1,
        "upcoming": 3,
        "cancels": 1
    },
    {
        "study": "M23-714",
        "full_name": "Abbvie - M23-714",
        "study_url": "https://app.clinicalresearch.io/clinical-research-philadelphia-crp/philadelphia-pa/study/86826/subjects",
        "sites": [
            "PHL"
        ],
        "status": "Enrolling",
        "target": 6,
        "enrolled": 5,
        "active": 4,
        "v1": 2,
        "screening": 1,
        "screened": 36,
        "screen_fail": 30,
        "screen_fail_pct": 83.3,
        "completed": 1,
        "discontinued": 0,
        "pct": 83,
        "remaining": 1,
        "over": 0,
        "upcoming": 5,
        "cancels": 4
    },
    {
        "study": "MR-100A-01-TD-3001",
        "full_name": "Mylan Inc. - MR-100A-01-TD-3001",
        "study_url": "https://app.clinicalresearch.io/clinical-research-philadelphia-crp/philadelphia-pa/study/32653/subjects",
        "sites": [
            "PHL"
        ],
        "status": "Pre-Closed",
        "target": 25,
        "enrolled": 52,
        "active": 0,
        "v1": 3,
        "screening": 0,
        "screened": 66,
        "screen_fail": 14,
        "screen_fail_pct": 21.2,
        "completed": 19,
        "discontinued": 33,
        "pct": 208,
        "remaining": 0,
        "over": 27,
        "upcoming": 0,
        "cancels": 0
    },
    {
        "study": "MR-130A-01-TD-3001",
        "full_name": "Mylan Inc. - MR-130A-01-TD-3001",
        "study_url": "https://app.clinicalresearch.io/clinical-research-philadelphia-crp/philadelphia-pa/study/109260/subjects",
        "sites": [
            "PHL"
        ],
        "status": "Enrolling",
        "target": 15,
        "enrolled": 12,
        "active": 10,
        "v1": 0,
        "screening": 0,
        "screened": 21,
        "screen_fail": 9,
        "screen_fail_pct": 42.9,
        "completed": 0,
        "discontinued": 2,
        "pct": 80,
        "remaining": 3,
        "over": 0,
        "upcoming": 11,
        "cancels": 8
    },
    {
        "study": "N1T-MC-MALO",
        "full_name": "Eli Lilly and Company - N1T-MC-MALO",
        "study_url": "https://app.clinicalresearch.io/clinical-research-philadelphia-crp/clinical-research-philadelphia-pennington/study/167755/subjects",
        "sites": [
            "PNJ"
        ],
        "status": "Enrolling",
        "target": 15,
        "enrolled": 1,
        "active": 1,
        "v1": 4,
        "screening": 33,
        "screened": 59,
        "screen_fail": 25,
        "screen_fail_pct": 42.4,
        "completed": 0,
        "discontinued": 0,
        "pct": 7,
        "remaining": 14,
        "over": 0,
        "upcoming": 6,
        "cancels": 18
    },
    {
        "study": "J2A-MC-GZGS",
        "full_name": "Eli Lilly and Company - J2A-MC-GZGS",
        "study_url": "https://app.clinicalresearch.io/clinical-research-philadelphia-crp/philadelphia-pa/study/60296/subjects",
        "sites": [
            "PHL"
        ],
        "status": "Maintenance",
        "target": 4,
        "enrolled": 9,
        "active": 0,
        "v1": 2,
        "screening": 0,
        "screened": 25,
        "screen_fail": 16,
        "screen_fail_pct": 64.0,
        "completed": 6,
        "discontinued": 3,
        "pct": 225,
        "remaining": 0,
        "over": 5,
        "upcoming": 0,
        "cancels": 5
    },
    {
        "study": "J1G-MC-LAKI",
        "full_name": "Eli Lilly and Company - J1G-MC-LAKI",
        "study_url": "https://app.clinicalresearch.io/clinical-research-philadelphia-crp/philadelphia-pa/study/119640/subjects",
        "sites": [
            "PHL"
        ],
        "status": "Maintenance",
        "target": 4,
        "enrolled": 6,
        "active": 3,
        "v1": 4,
        "screening": 0,
        "screened": 147,
        "screen_fail": 141,
        "screen_fail_pct": 95.9,
        "completed": 0,
        "discontinued": 3,
        "pct": 150,
        "remaining": 0,
        "over": 2,
        "upcoming": 1,
        "cancels": 1
    },
    {
        "study": "J3L-MC-EZEF",
        "full_name": "Eli Lilly and Company - J3L-MC-EZEF",
        "study_url": "https://app.clinicalresearch.io/clinical-research-philadelphia-crp/philadelphia-pa/study/89175/subjects",
        "sites": [
            "PHL"
        ],
        "status": "Maintenance",
        "target": 15,
        "enrolled": 52,
        "active": 50,
        "v1": 2,
        "screening": 0,
        "screened": 262,
        "screen_fail": 210,
        "screen_fail_pct": 80.2,
        "completed": 0,
        "discontinued": 2,
        "pct": 347,
        "remaining": 0,
        "over": 37,
        "upcoming": 38,
        "cancels": 2
    },
    {
        "study": "LTS17367",
        "full_name": "Sanofi US Services Inc. - LTS17367",
        "study_url": "https://app.clinicalresearch.io/clinical-research-philadelphia-crp/philadelphia-pa/study/129137/subjects",
        "sites": [
            "PHL"
        ],
        "status": "Maintenance",
        "target": 1,
        "enrolled": 1,
        "active": 1,
        "v1": 0,
        "screening": 0,
        "screened": 1,
        "screen_fail": 0,
        "screen_fail_pct": 0.0,
        "completed": 0,
        "discontinued": 0,
        "pct": 100,
        "remaining": 0,
        "over": 0,
        "upcoming": 1,
        "cancels": 0
    },
    {
        "study": "77242113PSO3006",
        "full_name": "Johnson & Johnson - 77242113PSO3006",
        "study_url": "https://app.clinicalresearch.io/clinical-research-philadelphia-crp/philadelphia-pa/study/136289/subjects",
        "sites": [
            "PHL"
        ],
        "status": "Maintenance",
        "target": 5,
        "enrolled": 7,
        "active": 7,
        "v1": 0,
        "screening": 0,
        "screened": 10,
        "screen_fail": 3,
        "screen_fail_pct": 30.0,
        "completed": 0,
        "discontinued": 0,
        "pct": 140,
        "remaining": 0,
        "over": 2,
        "upcoming": 7,
        "cancels": 0
    },
    {
        "study": "ATD002",
        "full_name": "UCB Biopharma SRL - ATD002",
        "study_url": "https://app.clinicalresearch.io/clinical-research-philadelphia-crp/philadelphia-pa/study/163891/subjects",
        "sites": [
            "PHL"
        ],
        "status": "Enrolling",
        "target": 6,
        "enrolled": 0,
        "active": 0,
        "v1": 3,
        "screening": 0,
        "screened": 0,
        "screen_fail": 0,
        "screen_fail_pct": 0,
        "completed": 0,
        "discontinued": 0,
        "pct": 0,
        "remaining": 6,
        "over": 0,
        "upcoming": 0,
        "cancels": 0
    },
    {
        "study": "M24-601",
        "full_name": "Abbvie - M24-601",
        "study_url": "https://app.clinicalresearch.io/clinical-research-philadelphia-crp/philadelphia-pa/study/101728/subjects",
        "sites": [
            "PHL"
        ],
        "status": "Enrolling",
        "target": 5,
        "enrolled": 0,
        "active": 0,
        "v1": 0,
        "screening": 1,
        "screened": 4,
        "screen_fail": 3,
        "screen_fail_pct": 75.0,
        "completed": 0,
        "discontinued": 0,
        "pct": 0,
        "remaining": 5,
        "over": 0,
        "upcoming": 0,
        "cancels": 0
    }
],
  "cancelTrend": [
    {
      "week": "Feb 24",
      "count": 3
    },
    {
      "week": "Feb 25",
      "count": 3
    },
    {
      "week": "Feb 26",
      "count": 1
    },
    {
      "week": "Feb 27",
      "count": 1
    },
    {
      "week": "Mar 2",
      "count": 4
    },
    {
      "week": "Mar 3",
      "count": 7
    },
    {
      "week": "Mar 4",
      "count": 1
    },
    {
      "week": "Mar 5",
      "count": 2
    }
  ],
  "cancelReasons": [
    {
      "reason": "No Show",
      "count": 36
    },
    {
      "reason": "Other",
      "count": 23
    },
    {
      "reason": "Screen Fail/DNQ",
      "count": 17
    },
    {
      "reason": "Weather",
      "count": 8
    },
    {
      "reason": "Patient Withdrew",
      "count": 4
    },
    {
      "reason": "Not Documented",
      "count": 3
    },
    {
      "reason": "Discontinued",
      "count": 1
    },
    {
      "reason": "No Response",
      "count": 1
    }
  ],
  "riskFlags": [
    {
      "patient": "Kayla  Baresich",
      "patient_url": "https://app.clinicalresearch.io/clinical-research-philadelphia-crp/philadelphia-pa/study/135648/subjects",
      "study": "C4951063",
      "study_url": "https://app.clinicalresearch.io/clinical-research-philadelphia-crp/philadelphia-pa/study/135648/subjects",
      "cancels": 2,
      "next_visit": "Mar 18",
      "next_visit_iso": "2026-03-18",
      "coord": "Ruby Pereira",
      "last_cancel": "Feb 23"
    }
  ],
  "enrollSummary": {
    "totalEnrolled": 40,
    "totalTarget": 130,
    "overallPct": 31
  },
  "upcomingTotal": 106,
  "phillyTotal": 87,
  "pennTotal": 19,
  "marchTotal": 62,
  "aprilTotal": 39,
  "next14Total": 45,
  "cancelTotal": 93,
  "activeStudies": 17,
  "snapshotDate": "March 9, 2026",
  "cancelWeekly": [
    {
        "week": "Jan 5",
        "count": 11
    },
    {
        "week": "Jan 12",
        "count": 20
    },
    {
        "week": "Jan 19",
        "count": 10
    },
    {
        "week": "Jan 26",
        "count": 5
    },
    {
        "week": "Feb 2",
        "count": 10
    },
    {
        "week": "Feb 9",
        "count": 9
    },
    {
        "week": "Feb 16",
        "count": 8
    },
    {
        "week": "Feb 23",
        "count": 10
    },
    {
        "week": "Mar 2",
        "count": 10
    }
],
  "upcomingWeekly": [
    {
      "week": "Mar 9",
      "count": 6
    },
    {
      "week": "Mar 10",
      "count": 8
    },
    {
      "week": "Mar 11",
      "count": 7
    },
    {
      "week": "Mar 12",
      "count": 5
    },
    {
      "week": "Mar 13",
      "count": 1
    },
    {
      "week": "Mar 16",
      "count": 2
    },
    {
      "week": "Mar 17",
      "count": 6
    },
    {
      "week": "Mar 18",
      "count": 5
    },
    {
      "week": "Mar 19",
      "count": 2
    },
    {
      "week": "Mar 20",
      "count": 1
    },
    {
      "week": "Mar 23",
      "count": 2
    },
    {
      "week": "Mar 24",
      "count": 4
    },
    {
      "week": "Mar 25",
      "count": 2
    },
    {
      "week": "Mar 27",
      "count": 2
    },
    {
      "week": "Mar 30",
      "count": 5
    },
    {
      "week": "Mar 31",
      "count": 4
    },
    {
      "week": "Apr 1",
      "count": 1
    },
    {
      "week": "Apr 2",
      "count": 1
    },
    {
      "week": "Apr 3",
      "count": 1
    },
    {
      "week": "Apr 6",
      "count": 3
    },
    {
      "week": "Apr 7",
      "count": 6
    },
    {
      "week": "Apr 8",
      "count": 6
    },
    {
      "week": "Apr 9",
      "count": 1
    },
    {
      "week": "Apr 10",
      "count": 2
    },
    {
      "week": "Apr 13",
      "count": 1
    },
    {
      "week": "Apr 14",
      "count": 2
    },
    {
      "week": "Apr 15",
      "count": 1
    },
    {
      "week": "Apr 16",
      "count": 1
    },
    {
      "week": "Apr 20",
      "count": 3
    },
    {
      "week": "Apr 22",
      "count": 3
    },
    {
      "week": "Apr 23",
      "count": 2
    },
    {
      "week": "Apr 28",
      "count": 1
    },
    {
      "week": "Apr 29",
      "count": 1
    },
    {
      "week": "Apr 30",
      "count": 3
    },
    {
      "week": "May 5",
      "count": 1
    },
    {
      "week": "May 6",
      "count": 2
    },
    {
      "week": "May 7",
      "count": 2
    }
  ],
  "upcomingByStudy": [
    {
      "study": "J3L-MC-EZEF",
      "full": "J3L-MC-EZEF",
      "name": "J3L-MC-EZEF",
      "count": 38,
      "study_url": "https://app.clinicalresearch.io/clinical-research-philadelphia-crp/philadelphia-pa/study/89175/subjects"
    },
    {
      "study": "MR-130A-01-TD-3001",
      "full": "MR-130A-01-TD-3001",
      "name": "MR-130A-01-TD-3001",
      "count": 11,
      "study_url": "https://app.clinicalresearch.io/clinical-research-philadelphia-crp/philadelphia-pa/study/109260/subjects"
    },
    {
      "study": "M20-465",
      "full": "M20-465",
      "name": "M20-465",
      "count": 9,
      "study_url": "https://app.clinicalresearch.io/clinical-research-philadelphia-crp/philadelphia-pa/study/107641/subjects"
    },
    {
      "study": "20230222",
      "full": "20230222",
      "name": "20230222",
      "count": 7,
      "study_url": "https://app.clinicalresearch.io/clinical-research-philadelphia-crp/clinical-research-philadelphia-pennington/study/167794/subjects"
    },
    {
      "study": "77242113PSO3006",
      "full": "77242113PSO3006",
      "name": "77242113PSO3006",
      "count": 7,
      "study_url": "https://app.clinicalresearch.io/clinical-research-philadelphia-crp/philadelphia-pa/study/136289/subjects"
    },
    {
      "study": "N1T-MC-MALO",
      "full": "N1T-MC-MALO",
      "name": "N1T-MC-MALO",
      "count": 6,
      "study_url": "https://app.clinicalresearch.io/clinical-research-philadelphia-crp/clinical-research-philadelphia-pennington/study/167755/subjects"
    },
    {
      "study": "M23-714",
      "full": "M23-714",
      "name": "M23-714",
      "count": 5,
      "study_url": "https://app.clinicalresearch.io/clinical-research-philadelphia-crp/philadelphia-pa/study/86826/subjects"
    },
    {
      "study": "J2A-MC-GZPO",
      "full": "J2A-MC-GZPO",
      "name": "J2A-MC-GZPO",
      "count": 5,
      "study_url": "https://app.clinicalresearch.io/clinical-research-philadelphia-crp/philadelphia-pa/study/135157/subjects"
    },
    {
      "study": "80202135SJS3001",
      "full": "80202135SJS3001",
      "name": "80202135SJS3001",
      "count": 4,
      "study_url": "https://app.clinicalresearch.io/clinical-research-philadelphia-crp/clinical-research-philadelphia-pennington/study/150548/subjects"
    },
    {
      "study": "M23-698",
      "full": "M23-698",
      "name": "M23-698",
      "count": 3,
      "study_url": "https://app.clinicalresearch.io/clinical-research-philadelphia-crp/philadelphia-pa/study/67894/subjects"
    },
    {
      "study": "D6973C00001",
      "full": "D6973C00001",
      "name": "D6973C00001",
      "count": 3,
      "study_url": "https://app.clinicalresearch.io/clinical-research-philadelphia-crp/clinical-research-philadelphia-pennington/study/161619/subjects"
    },
    {
      "study": "C4951063",
      "full": "C4951063",
      "name": "C4951063",
      "count": 1,
      "study_url": "https://app.clinicalresearch.io/clinical-research-philadelphia-crp/philadelphia-pa/study/135648/subjects"
    },
    {
      "study": "LTS17367",
      "full": "LTS17367",
      "name": "LTS17367",
      "count": 1,
      "study_url": "https://app.clinicalresearch.io/clinical-research-philadelphia-crp/philadelphia-pa/study/129137/subjects"
    },
    {
      "study": "CDX0159-12",
      "full": "CDX0159-12",
      "name": "CDX0159-12",
      "count": 1,
      "study_url": "https://app.clinicalresearch.io/clinical-research-philadelphia-crp/philadelphia-pa/study/102540/subjects"
    },
    {
      "study": "EFC17600 (ESTUARY)",
      "full": "EFC17600 (ESTUARY)",
      "name": "EFC17600 (ESTUARY)",
      "count": 1,
      "study_url": "https://app.clinicalresearch.io/clinical-research-philadelphia-crp/philadelphia-pa/study/122602/subjects"
    },
    {
      "study": "EFC17599",
      "full": "EFC17599",
      "name": "EFC17599",
      "count": 1,
      "study_url": "https://app.clinicalresearch.io/clinical-research-philadelphia-crp/philadelphia-pa/study/97908/subjects"
    },
    {
      "study": "J1G-MC-LAKI",
      "full": "J1G-MC-LAKI",
      "name": "J1G-MC-LAKI",
      "count": 1,
      "study_url": "https://app.clinicalresearch.io/clinical-research-philadelphia-crp/philadelphia-pa/study/119640/subjects"
    },
    {
      "study": "J3F-MC-EZCC",
      "full": "J3F-MC-EZCC",
      "name": "J3F-MC-EZCC",
      "count": 1,
      "study_url": "https://app.clinicalresearch.io/clinical-research-philadelphia-crp/clinical-research-philadelphia-pennington/study/172389/subjects"
    },
    {
      "study": "D7960C00015",
      "full": "D7960C00015",
      "name": "D7960C00015",
      "count": 1,
      "study_url": "https://app.clinicalresearch.io/clinical-research-philadelphia-crp/philadelphia-pa/study/154462/subjects"
    }
  ],
  "next14Detail": [
    {
      "date": "Mar 9",
      "date_iso": "2026-03-09",
      "study": "J3L-MC-EZEF",
      "study_url": "https://app.clinicalresearch.io/clinical-research-philadelphia-crp/philadelphia-pa/study/89175/subjects",
      "visit": "V9-Treatment (T)",
      "patient": "Mathew  Samuel",
      "patient_url": "https://app.clinicalresearch.io/clinical-research-philadelphia-crp/philadelphia-pa/study/89175/subjects",
      "status": "Enrolled",
      "coord": "Stacey Scott",
      "site": "Philadelphia, PA"
    },
    {
      "date": "Mar 9",
      "date_iso": "2026-03-09",
      "study": "N1T-MC-MALO",
      "study_url": "https://app.clinicalresearch.io/clinical-research-philadelphia-crp/clinical-research-philadelphia-pennington/study/167755/subjects",
      "visit": "V1/OffsiteManagement",
      "patient": "Susan  Butch",
      "patient_url": "https://app.clinicalresearch.io/clinical-research-philadelphia-crp/clinical-research-philadelphia-pennington/study/167755/subjects",
      "status": "Screening",
      "coord": "Cady Chilensky",
      "site": "Pennington, NJ"
    },
    {
      "date": "Mar 9",
      "date_iso": "2026-03-09",
      "study": "MR-130A-01-TD-3001",
      "study_url": "https://app.clinicalresearch.io/clinical-research-philadelphia-crp/philadelphia-pa/study/109260/subjects",
      "visit": "Cycle 5",
      "patient": "Sinthia  Charels",
      "patient_url": "https://app.clinicalresearch.io/clinical-research-philadelphia-crp/philadelphia-pa/study/109260/subjects",
      "status": "Enrolled",
      "coord": "Ruby Pereira",
      "site": "Philadelphia, PA"
    },
    {
      "date": "Mar 9",
      "date_iso": "2026-03-09",
      "study": "J3L-MC-EZEF",
      "study_url": "https://app.clinicalresearch.io/clinical-research-philadelphia-crp/philadelphia-pa/study/89175/subjects",
      "visit": "V4-Treatment (W13)",
      "patient": "Mariano  perez",
      "patient_url": "https://app.clinicalresearch.io/clinical-research-philadelphia-crp/philadelphia-pa/study/89175/subjects",
      "status": "Enrolled",
      "coord": "Ruby Pereira",
      "site": "Philadelphia, PA"
    },
    {
      "date": "Mar 9",
      "date_iso": "2026-03-09",
      "study": "MR-130A-01-TD-3001",
      "study_url": "https://app.clinicalresearch.io/clinical-research-philadelphia-crp/philadelphia-pa/study/109260/subjects",
      "visit": "Cycle 12",
      "patient": "Bridney  Mumford",
      "patient_url": "https://app.clinicalresearch.io/clinical-research-philadelphia-crp/philadelphia-pa/study/109260/subjects",
      "status": "Enrolled",
      "coord": "Ruby Pereira",
      "site": "Philadelphia, PA"
    },
    {
      "date": "Mar 9",
      "date_iso": "2026-03-09",
      "study": "J3L-MC-EZEF",
      "study_url": "https://app.clinicalresearch.io/clinical-research-philadelphia-crp/philadelphia-pa/study/89175/subjects",
      "visit": "V4-Treatment (W13)",
      "patient": "Carol  Adonizio",
      "patient_url": "https://app.clinicalresearch.io/clinical-research-philadelphia-crp/philadelphia-pa/study/89175/subjects",
      "status": "Enrolled",
      "coord": "Stacey Scott",
      "site": "Philadelphia, PA"
    },
    {
      "date": "Mar 10",
      "date_iso": "2026-03-10",
      "study": "M20-465",
      "study_url": "https://app.clinicalresearch.io/clinical-research-philadelphia-crp/philadelphia-pa/study/107641/subjects",
      "visit": "Week 41",
      "patient": "Danai  Richards",
      "patient_url": "https://app.clinicalresearch.io/clinical-research-philadelphia-crp/philadelphia-pa/study/107641/subjects",
      "status": "Enrolled",
      "coord": "Mario Castellanos",
      "site": "Philadelphia, PA"
    },
    {
      "date": "Mar 10",
      "date_iso": "2026-03-10",
      "study": "20230222",
      "study_url": "https://app.clinicalresearch.io/clinical-research-philadelphia-crp/clinical-research-philadelphia-pennington/study/167794/subjects",
      "visit": "Main Screening",
      "patient": "Nafeesah Dennis",
      "patient_url": "https://app.clinicalresearch.io/clinical-research-philadelphia-crp/clinical-research-philadelphia-pennington/study/167794/subjects",
      "status": "Screening",
      "coord": "Cady Chilensky",
      "site": "Pennington, NJ"
    },
    {
      "date": "Mar 10",
      "date_iso": "2026-03-10",
      "study": "N1T-MC-MALO",
      "study_url": "https://app.clinicalresearch.io/clinical-research-philadelphia-crp/clinical-research-philadelphia-pennington/study/167755/subjects",
      "visit": "V1/Screening",
      "patient": "Andrew  M Shekhar",
      "patient_url": "https://app.clinicalresearch.io/clinical-research-philadelphia-crp/clinical-research-philadelphia-pennington/study/167755/subjects",
      "status": "Screening",
      "coord": "Mario Castellanos",
      "site": "Philadelphia, PA"
    },
    {
      "date": "Mar 10",
      "date_iso": "2026-03-10",
      "study": "J3L-MC-EZEF",
      "study_url": "https://app.clinicalresearch.io/clinical-research-philadelphia-crp/philadelphia-pa/study/89175/subjects",
      "visit": "V8-Treatment",
      "patient": "Marilin Walton",
      "patient_url": "https://app.clinicalresearch.io/clinical-research-philadelphia-crp/philadelphia-pa/study/89175/subjects",
      "status": "Enrolled",
      "coord": "Stacey Scott",
      "site": "Philadelphia, PA"
    },
    {
      "date": "Mar 10",
      "date_iso": "2026-03-10",
      "study": "M20-465",
      "study_url": "https://app.clinicalresearch.io/clinical-research-philadelphia-crp/philadelphia-pa/study/107641/subjects",
      "visit": "Week 8",
      "patient": "Daryl  Lloyd",
      "patient_url": "https://app.clinicalresearch.io/clinical-research-philadelphia-crp/philadelphia-pa/study/107641/subjects",
      "status": "Enrolled",
      "coord": "Mario Castellanos",
      "site": "Philadelphia, PA"
    },
    {
      "date": "Mar 10",
      "date_iso": "2026-03-10",
      "study": "20230222",
      "study_url": "https://app.clinicalresearch.io/clinical-research-philadelphia-crp/clinical-research-philadelphia-pennington/study/167794/subjects",
      "visit": "Main Screening",
      "patient": "Josephine  Cruz",
      "patient_url": "https://app.clinicalresearch.io/clinical-research-philadelphia-crp/clinical-research-philadelphia-pennington/study/167794/subjects",
      "status": "Screening",
      "coord": "Angelina Mcmullen",
      "site": "Pennington, NJ"
    },
    {
      "date": "Mar 10",
      "date_iso": "2026-03-10",
      "study": "J3L-MC-EZEF",
      "study_url": "https://app.clinicalresearch.io/clinical-research-philadelphia-crp/philadelphia-pa/study/89175/subjects",
      "visit": "V4-Treatment (W13)",
      "patient": "David  Garrett",
      "patient_url": "https://app.clinicalresearch.io/clinical-research-philadelphia-crp/philadelphia-pa/study/89175/subjects",
      "status": "Enrolled",
      "coord": "Stacey Scott",
      "site": "Philadelphia, PA"
    },
    {
      "date": "Mar 10",
      "date_iso": "2026-03-10",
      "study": "M23-714",
      "study_url": "https://app.clinicalresearch.io/clinical-research-philadelphia-crp/philadelphia-pa/study/86826/subjects",
      "visit": "V2-Randomization",
      "patient": "Lauren  BraunStrumfels",
      "patient_url": "https://app.clinicalresearch.io/clinical-research-philadelphia-crp/philadelphia-pa/study/86826/subjects",
      "status": "Screening",
      "coord": "Ruby Pereira",
      "site": "Philadelphia, PA"
    },
    {
      "date": "Mar 11",
      "date_iso": "2026-03-11",
      "study": "80202135SJS3001",
      "study_url": "https://app.clinicalresearch.io/clinical-research-philadelphia-crp/clinical-research-philadelphia-pennington/study/150548/subjects",
      "visit": "Week 16",
      "patient": "Marlyn  Wisnieski",
      "patient_url": "https://app.clinicalresearch.io/clinical-research-philadelphia-crp/clinical-research-philadelphia-pennington/study/150548/subjects",
      "status": "Enrolled",
      "coord": "Angelina Mcmullen",
      "site": "Pennington, NJ"
    },
    {
      "date": "Mar 11",
      "date_iso": "2026-03-11",
      "study": "N1T-MC-MALO",
      "study_url": "https://app.clinicalresearch.io/clinical-research-philadelphia-crp/clinical-research-philadelphia-pennington/study/167755/subjects",
      "visit": "V1/Screening",
      "patient": "Brittany  Daniel",
      "patient_url": "https://app.clinicalresearch.io/clinical-research-philadelphia-crp/clinical-research-philadelphia-pennington/study/167755/subjects",
      "status": "Screening",
      "coord": "Cady Chilensky",
      "site": "Pennington, NJ"
    },
    {
      "date": "Mar 11",
      "date_iso": "2026-03-11",
      "study": "M20-465",
      "study_url": "https://app.clinicalresearch.io/clinical-research-philadelphia-crp/philadelphia-pa/study/107641/subjects",
      "visit": "Week 19",
      "patient": "Jesse  Cummings",
      "patient_url": "https://app.clinicalresearch.io/clinical-research-philadelphia-crp/philadelphia-pa/study/107641/subjects",
      "status": "Enrolled",
      "coord": "Mario Castellanos",
      "site": "Philadelphia, PA"
    },
    {
      "date": "Mar 11",
      "date_iso": "2026-03-11",
      "study": "J2A-MC-GZPO",
      "study_url": "https://app.clinicalresearch.io/clinical-research-philadelphia-crp/philadelphia-pa/study/135157/subjects",
      "visit": "Treatment (V10)",
      "patient": "Jonathan  Freedman",
      "patient_url": "https://app.clinicalresearch.io/clinical-research-philadelphia-crp/philadelphia-pa/study/135157/subjects",
      "status": "Enrolled",
      "coord": "Stacey Scott",
      "site": "Philadelphia, PA"
    },
    {
      "date": "Mar 11",
      "date_iso": "2026-03-11",
      "study": "MR-130A-01-TD-3001",
      "study_url": "https://app.clinicalresearch.io/clinical-research-philadelphia-crp/philadelphia-pa/study/109260/subjects",
      "visit": "Cycle 13 / TFU",
      "patient": "Gladys  Cabon",
      "patient_url": "https://app.clinicalresearch.io/clinical-research-philadelphia-crp/philadelphia-pa/study/109260/subjects",
      "status": "Enrolled",
      "coord": "Ruby Pereira",
      "site": "Philadelphia, PA"
    },
    {
      "date": "Mar 11",
      "date_iso": "2026-03-11",
      "study": "J3L-MC-EZEF",
      "study_url": "https://app.clinicalresearch.io/clinical-research-philadelphia-crp/philadelphia-pa/study/89175/subjects",
      "visit": "V7-Treatment",
      "patient": "Jurdell Arnold Davis",
      "patient_url": "https://app.clinicalresearch.io/clinical-research-philadelphia-crp/philadelphia-pa/study/89175/subjects",
      "status": "Enrolled",
      "coord": "Stacey Scott",
      "site": "Philadelphia, PA"
    },
    {
      "date": "Mar 11",
      "date_iso": "2026-03-11",
      "study": "M23-698",
      "study_url": "https://app.clinicalresearch.io/clinical-research-philadelphia-crp/philadelphia-pa/study/67894/subjects",
      "visit": "Phone Call-U/A preg.",
      "patient": "Marquita  Thomas",
      "patient_url": "https://app.clinicalresearch.io/clinical-research-philadelphia-crp/philadelphia-pa/study/67894/subjects",
      "status": "Enrolled",
      "coord": "Mario Castellanos",
      "site": "Philadelphia, PA"
    },
    {
      "date": "Mar 12",
      "date_iso": "2026-03-12",
      "study": "J3L-MC-EZEF",
      "study_url": "https://app.clinicalresearch.io/clinical-research-philadelphia-crp/philadelphia-pa/study/89175/subjects",
      "visit": "V4-Treatment (W13)",
      "patient": "Rakesh  Joshi",
      "patient_url": "https://app.clinicalresearch.io/clinical-research-philadelphia-crp/philadelphia-pa/study/89175/subjects",
      "status": "Enrolled",
      "coord": "Stacey Scott",
      "site": "Philadelphia, PA"
    },
    {
      "date": "Mar 12",
      "date_iso": "2026-03-12",
      "study": "77242113PSO3006",
      "study_url": "https://app.clinicalresearch.io/clinical-research-philadelphia-crp/philadelphia-pa/study/136289/subjects",
      "visit": "Week 36",
      "patient": "Marissa Damico",
      "patient_url": "https://app.clinicalresearch.io/clinical-research-philadelphia-crp/philadelphia-pa/study/136289/subjects",
      "status": "Enrolled",
      "coord": "Mario Castellanos",
      "site": "Philadelphia, PA"
    },
    {
      "date": "Mar 12",
      "date_iso": "2026-03-12",
      "study": "J3L-MC-EZEF",
      "study_url": "https://app.clinicalresearch.io/clinical-research-philadelphia-crp/philadelphia-pa/study/89175/subjects",
      "visit": "V4-Treatment (W13)",
      "patient": "Grace  Henrie",
      "patient_url": "https://app.clinicalresearch.io/clinical-research-philadelphia-crp/philadelphia-pa/study/89175/subjects",
      "status": "Enrolled",
      "coord": "Stacey Scott",
      "site": "Philadelphia, PA"
    },
    {
      "date": "Mar 12",
      "date_iso": "2026-03-12",
      "study": "M20-465",
      "study_url": "https://app.clinicalresearch.io/clinical-research-philadelphia-crp/philadelphia-pa/study/107641/subjects",
      "visit": "Week 2",
      "patient": "Courtney  Campuzano",
      "patient_url": "https://app.clinicalresearch.io/clinical-research-philadelphia-crp/philadelphia-pa/study/107641/subjects",
      "status": "Enrolled",
      "coord": "Mario Castellanos",
      "site": "Philadelphia, PA"
    },
    {
      "date": "Mar 12",
      "date_iso": "2026-03-12",
      "study": "M20-465",
      "study_url": "https://app.clinicalresearch.io/clinical-research-philadelphia-crp/philadelphia-pa/study/107641/subjects",
      "visit": "Week 29",
      "patient": "Samantha  Jackson",
      "patient_url": "https://app.clinicalresearch.io/clinical-research-philadelphia-crp/philadelphia-pa/study/107641/subjects",
      "status": "Enrolled",
      "coord": "Mario Castellanos",
      "site": "Philadelphia, PA"
    },
    {
      "date": "Mar 13",
      "date_iso": "2026-03-13",
      "study": "D6973C00001",
      "study_url": "https://app.clinicalresearch.io/clinical-research-philadelphia-crp/clinical-research-philadelphia-pennington/study/161619/subjects",
      "visit": "Randomisation",
      "patient": "Brian  Hill",
      "patient_url": "https://app.clinicalresearch.io/clinical-research-philadelphia-crp/clinical-research-philadelphia-pennington/study/161619/subjects",
      "status": "Screening",
      "coord": "Angelina Mcmullen",
      "site": "Pennington, NJ"
    },
    {
      "date": "Mar 16",
      "date_iso": "2026-03-16",
      "study": "J2A-MC-GZPO",
      "study_url": "https://app.clinicalresearch.io/clinical-research-philadelphia-crp/philadelphia-pa/study/135157/subjects",
      "visit": "Treatment (V6)",
      "patient": "Cheryl Mosley",
      "patient_url": "https://app.clinicalresearch.io/clinical-research-philadelphia-crp/philadelphia-pa/study/135157/subjects",
      "status": "Enrolled",
      "coord": "Stacey Scott",
      "site": "Philadelphia, PA"
    },
    {
      "date": "Mar 16",
      "date_iso": "2026-03-16",
      "study": "M23-714",
      "study_url": "https://app.clinicalresearch.io/clinical-research-philadelphia-crp/philadelphia-pa/study/86826/subjects",
      "visit": "V13/Wk52 Final V/ET",
      "patient": "Annamarie  DeSantis",
      "patient_url": "https://app.clinicalresearch.io/clinical-research-philadelphia-crp/philadelphia-pa/study/86826/subjects",
      "status": "Enrolled",
      "coord": "Ruby Pereira",
      "site": "Philadelphia, PA"
    },
    {
      "date": "Mar 17",
      "date_iso": "2026-03-17",
      "study": "MR-130A-01-TD-3001",
      "study_url": "https://app.clinicalresearch.io/clinical-research-philadelphia-crp/philadelphia-pa/study/109260/subjects",
      "visit": "Cycle 10 / TFU",
      "patient": "Payton Newman",
      "patient_url": "https://app.clinicalresearch.io/clinical-research-philadelphia-crp/philadelphia-pa/study/109260/subjects",
      "status": "Enrolled",
      "coord": "Ruby Pereira",
      "site": "Philadelphia, PA"
    },
    {
      "date": "Mar 17",
      "date_iso": "2026-03-17",
      "study": "J3L-MC-EZEF",
      "study_url": "https://app.clinicalresearch.io/clinical-research-philadelphia-crp/philadelphia-pa/study/89175/subjects",
      "visit": "V4-Treatment (W13)",
      "patient": "Ernest Butts",
      "patient_url": "https://app.clinicalresearch.io/clinical-research-philadelphia-crp/philadelphia-pa/study/89175/subjects",
      "status": "Enrolled",
      "coord": "Stacey Scott",
      "site": "Philadelphia, PA"
    },
    {
      "date": "Mar 17",
      "date_iso": "2026-03-17",
      "study": "N1T-MC-MALO",
      "study_url": "https://app.clinicalresearch.io/clinical-research-philadelphia-crp/clinical-research-philadelphia-pennington/study/167755/subjects",
      "visit": "V4/W4",
      "patient": "Carmen  Rios",
      "patient_url": "https://app.clinicalresearch.io/clinical-research-philadelphia-crp/clinical-research-philadelphia-pennington/study/167755/subjects",
      "status": "Enrolled",
      "coord": "Cady Chilensky",
      "site": "Pennington, NJ"
    },
    {
      "date": "Mar 17",
      "date_iso": "2026-03-17",
      "study": "M20-465",
      "study_url": "https://app.clinicalresearch.io/clinical-research-philadelphia-crp/philadelphia-pa/study/107641/subjects",
      "visit": "Week 47",
      "patient": "Karen  Smith",
      "patient_url": "https://app.clinicalresearch.io/clinical-research-philadelphia-crp/philadelphia-pa/study/107641/subjects",
      "status": "Enrolled",
      "coord": "Mario Castellanos",
      "site": "Philadelphia, PA"
    },
    {
      "date": "Mar 17",
      "date_iso": "2026-03-17",
      "study": "M20-465",
      "study_url": "https://app.clinicalresearch.io/clinical-research-philadelphia-crp/philadelphia-pa/study/107641/subjects",
      "visit": "Week 39",
      "patient": "Jenelle  Luis",
      "patient_url": "https://app.clinicalresearch.io/clinical-research-philadelphia-crp/philadelphia-pa/study/107641/subjects",
      "status": "Enrolled",
      "coord": "Mario Castellanos",
      "site": "Philadelphia, PA"
    },
    {
      "date": "Mar 17",
      "date_iso": "2026-03-17",
      "study": "20230222",
      "study_url": "https://app.clinicalresearch.io/clinical-research-philadelphia-crp/clinical-research-philadelphia-pennington/study/167794/subjects",
      "visit": "Main Screening",
      "patient": "Darryl  Rice",
      "patient_url": "https://app.clinicalresearch.io/clinical-research-philadelphia-crp/clinical-research-philadelphia-pennington/study/167794/subjects",
      "status": "Screening",
      "coord": "Angelina Mcmullen",
      "site": "Pennington, NJ"
    },
    {
      "date": "Mar 18",
      "date_iso": "2026-03-18",
      "study": "C4951063",
      "study_url": "https://app.clinicalresearch.io/clinical-research-philadelphia-crp/philadelphia-pa/study/135648/subjects",
      "visit": "V2 - Obs Phase_MC2",
      "patient": "Kayla  Baresich",
      "patient_url": "https://app.clinicalresearch.io/clinical-research-philadelphia-crp/philadelphia-pa/study/135648/subjects",
      "status": "Screening",
      "coord": "Ruby Pereira",
      "site": "Philadelphia, PA"
    },
    {
      "date": "Mar 18",
      "date_iso": "2026-03-18",
      "study": "J3L-MC-EZEF",
      "study_url": "https://app.clinicalresearch.io/clinical-research-philadelphia-crp/philadelphia-pa/study/89175/subjects",
      "visit": "V9-Treatment (T)",
      "patient": "Ratna  Setiono",
      "patient_url": "https://app.clinicalresearch.io/clinical-research-philadelphia-crp/philadelphia-pa/study/89175/subjects",
      "status": "Enrolled",
      "coord": "Stacey Scott",
      "site": "Philadelphia, PA"
    },
    {
      "date": "Mar 18",
      "date_iso": "2026-03-18",
      "study": "J3L-MC-EZEF",
      "study_url": "https://app.clinicalresearch.io/clinical-research-philadelphia-crp/philadelphia-pa/study/89175/subjects",
      "visit": "V7-Treatment",
      "patient": "James  Clark",
      "patient_url": "https://app.clinicalresearch.io/clinical-research-philadelphia-crp/philadelphia-pa/study/89175/subjects",
      "status": "Enrolled",
      "coord": "Stacey Scott",
      "site": "Philadelphia, PA"
    },
    {
      "date": "Mar 18",
      "date_iso": "2026-03-18",
      "study": "MR-130A-01-TD-3001",
      "study_url": "https://app.clinicalresearch.io/clinical-research-philadelphia-crp/philadelphia-pa/study/109260/subjects",
      "visit": "Cycle 10 / TFU",
      "patient": "Eve Morris",
      "patient_url": "https://app.clinicalresearch.io/clinical-research-philadelphia-crp/philadelphia-pa/study/109260/subjects",
      "status": "Enrolled",
      "coord": "Ruby Pereira",
      "site": "Philadelphia, PA"
    },
    {
      "date": "Mar 18",
      "date_iso": "2026-03-18",
      "study": "LTS17367",
      "study_url": "https://app.clinicalresearch.io/clinical-research-philadelphia-crp/philadelphia-pa/study/129137/subjects",
      "visit": "Visit 13 - Week 36",
      "patient": "Taylor  Charles",
      "patient_url": "https://app.clinicalresearch.io/clinical-research-philadelphia-crp/philadelphia-pa/study/129137/subjects",
      "status": "Enrolled",
      "coord": "Mario Castellanos",
      "site": "Philadelphia, PA"
    },
    {
      "date": "Mar 19",
      "date_iso": "2026-03-19",
      "study": "80202135SJS3001",
      "study_url": "https://app.clinicalresearch.io/clinical-research-philadelphia-crp/clinical-research-philadelphia-pennington/study/150548/subjects",
      "visit": "Week 6 Call",
      "patient": "Melissa  Richards",
      "patient_url": "https://app.clinicalresearch.io/clinical-research-philadelphia-crp/clinical-research-philadelphia-pennington/study/150548/subjects",
      "status": "Enrolled",
      "coord": "Angelina Mcmullen",
      "site": "Pennington, NJ"
    },
    {
      "date": "Mar 19",
      "date_iso": "2026-03-19",
      "study": "M23-714",
      "study_url": "https://app.clinicalresearch.io/clinical-research-philadelphia-crp/philadelphia-pa/study/86826/subjects",
      "visit": "V5/DB-Cycle3/Pre.Dis",
      "patient": "Kerrie  Carvalho",
      "patient_url": "https://app.clinicalresearch.io/clinical-research-philadelphia-crp/philadelphia-pa/study/86826/subjects",
      "status": "Enrolled",
      "coord": "Ruby Pereira",
      "site": "Philadelphia, PA"
    },
    {
      "date": "Mar 20",
      "date_iso": "2026-03-20",
      "study": "80202135SJS3001",
      "study_url": "https://app.clinicalresearch.io/clinical-research-philadelphia-crp/clinical-research-philadelphia-pennington/study/150548/subjects",
      "visit": "Random nipo conc",
      "patient": "Melissa  Richards",
      "patient_url": "https://app.clinicalresearch.io/clinical-research-philadelphia-crp/clinical-research-philadelphia-pennington/study/150548/subjects",
      "status": "Enrolled",
      "coord": "Angelina Mcmullen",
      "site": "Pennington, NJ"
    },
    {
      "date": "Mar 23",
      "date_iso": "2026-03-23",
      "study": "MR-130A-01-TD-3001",
      "study_url": "https://app.clinicalresearch.io/clinical-research-philadelphia-crp/philadelphia-pa/study/109260/subjects",
      "visit": "Cycle 10 / TFU",
      "patient": "Janae  Rockemore",
      "patient_url": "https://app.clinicalresearch.io/clinical-research-philadelphia-crp/philadelphia-pa/study/109260/subjects",
      "status": "Enrolled",
      "coord": "Ruby Pereira",
      "site": "Philadelphia, PA"
    },
    {
      "date": "Mar 23",
      "date_iso": "2026-03-23",
      "study": "J2A-MC-GZPO",
      "study_url": "https://app.clinicalresearch.io/clinical-research-philadelphia-crp/philadelphia-pa/study/135157/subjects",
      "visit": "Treatment (V12)",
      "patient": "Linda  Cerino",
      "patient_url": "https://app.clinicalresearch.io/clinical-research-philadelphia-crp/philadelphia-pa/study/135157/subjects",
      "status": "Enrolled",
      "coord": "Ruby Pereira",
      "site": "Philadelphia, PA"
    }
  ],
  "sites": [
    {
      "site": "Philadelphia, PA",
      "upcoming": 87,
      "cancels": 110,
      "cancelRate": 56,
      "studies": 16
    },
    {
      "site": "Pennington, NJ",
      "upcoming": 19,
      "cancels": 10,
      "cancelRate": 34,
      "studies": 5
    }
  ],
  "subjectStatus": [
    {
      "status": "Enrolled",
      "count": 80
    },
    {
      "status": "Screening",
      "count": 14
    },
    {
      "status": "Scheduled V1",
      "count": 1
    }
  ],
  "weeklyBySite": [
    {
      "week": "Mar 9",
      "phl": 5,
      "pnj": 1
    },
    {
      "week": "Mar 10",
      "phl": 6,
      "pnj": 2
    },
    {
      "week": "Mar 11",
      "phl": 5,
      "pnj": 2
    },
    {
      "week": "Mar 12",
      "phl": 5,
      "pnj": 0
    },
    {
      "week": "Mar 13",
      "phl": 0,
      "pnj": 1
    },
    {
      "week": "Mar 16",
      "phl": 2,
      "pnj": 0
    },
    {
      "week": "Mar 17",
      "phl": 4,
      "pnj": 2
    },
    {
      "week": "Mar 18",
      "phl": 5,
      "pnj": 0
    },
    {
      "week": "Mar 19",
      "phl": 1,
      "pnj": 1
    },
    {
      "week": "Mar 20",
      "phl": 0,
      "pnj": 1
    },
    {
      "week": "Mar 23",
      "phl": 2,
      "pnj": 0
    },
    {
      "week": "Mar 24",
      "phl": 2,
      "pnj": 2
    },
    {
      "week": "Mar 25",
      "phl": 2,
      "pnj": 0
    },
    {
      "week": "Mar 27",
      "phl": 0,
      "pnj": 2
    },
    {
      "week": "Mar 30",
      "phl": 5,
      "pnj": 0
    },
    {
      "week": "Mar 31",
      "phl": 3,
      "pnj": 1
    },
    {
      "week": "Apr 1",
      "phl": 1,
      "pnj": 0
    },
    {
      "week": "Apr 2",
      "phl": 1,
      "pnj": 0
    },
    {
      "week": "Apr 3",
      "phl": 0,
      "pnj": 1
    },
    {
      "week": "Apr 6",
      "phl": 3,
      "pnj": 0
    },
    {
      "week": "Apr 7",
      "phl": 5,
      "pnj": 1
    },
    {
      "week": "Apr 8",
      "phl": 5,
      "pnj": 1
    },
    {
      "week": "Apr 9",
      "phl": 1,
      "pnj": 0
    },
    {
      "week": "Apr 10",
      "phl": 1,
      "pnj": 1
    },
    {
      "week": "Apr 13",
      "phl": 1,
      "pnj": 0
    },
    {
      "week": "Apr 14",
      "phl": 2,
      "pnj": 0
    },
    {
      "week": "Apr 15",
      "phl": 1,
      "pnj": 0
    },
    {
      "week": "Apr 16",
      "phl": 1,
      "pnj": 0
    },
    {
      "week": "Apr 20",
      "phl": 3,
      "pnj": 0
    },
    {
      "week": "Apr 22",
      "phl": 3,
      "pnj": 0
    },
    {
      "week": "Apr 23",
      "phl": 2,
      "pnj": 0
    },
    {
      "week": "Apr 28",
      "phl": 1,
      "pnj": 0
    },
    {
      "week": "Apr 29",
      "phl": 1,
      "pnj": 0
    },
    {
      "week": "Apr 30",
      "phl": 3,
      "pnj": 0
    },
    {
      "week": "May 5",
      "phl": 1,
      "pnj": 0
    },
    {
      "week": "May 6",
      "phl": 2,
      "pnj": 0
    },
    {
      "week": "May 7",
      "phl": 2,
      "pnj": 0
    }
  ],
  "visitTypes": [
    {
      "type": "Treatment",
      "count": 48
    },
    {
      "type": "Other",
      "count": 48
    },
    {
      "type": "Screening",
      "count": 10
    }
  ],
  "actionDetails": {
    "undocumented": [
      {
            "name": "Darryl  Pringle",
            "url": "https://app.clinicalresearch.io/clinical-research-philadelphia-crp/clinical-research-philadelphia-pennington/study/167755/subjects",
            "study": "N1T-MC-MALO",
            "study_url": "https://app.clinicalresearch.io/clinical-research-philadelphia-crp/clinical-research-philadelphia-pennington/study/167755/subjects",
            "coord": "Aneesh Vaze",
            "type": "Site Cancelled",
            "reason": "Site cancelled. No reasons noted",
            "cancel_date": "Jan 21",
            "category": "Not Documented"
      },
      {
            "name": "Veronica  Grant",
            "url": "https://app.clinicalresearch.io/clinical-research-philadelphia-crp/philadelphia-pa/study/135648/subjects",
            "study": "C4951063",
            "study_url": "https://app.clinicalresearch.io/clinical-research-philadelphia-crp/philadelphia-pa/study/135648/subjects",
            "coord": "Jana Milankovic",
            "type": "Patient Cancelled",
            "reason": "no reason provided",
            "cancel_date": "Jan 7",
            "category": "Not Documented"
      },
      {
            "name": "Vivienne Van Nguyen",
            "url": "https://app.clinicalresearch.io/clinical-research-philadelphia-crp/philadelphia-pa/study/102540/subjects",
            "study": "CDX0159-12",
            "study_url": "https://app.clinicalresearch.io/clinical-research-philadelphia-crp/philadelphia-pa/study/102540/subjects",
            "coord": "Mario Castellanos",
            "type": "Site Cancelled",
            "reason": "nan",
            "cancel_date": "Jan 6",
            "category": "Not Documented"
      }
],
    "protocol_updates": {},
    "screen_fail_groups": {
      "generic|MR-130A-01-TD-3001": {
        "patients": [
          {
            "name": "Haley  Robinson",
            "url": "https://app.clinicalresearch.io/clinical-research-philadelphia-crp/philadelphia-pa/study/109260/subjects",
            "study": "MR-130A-01-TD-3001",
            "study_url": "https://app.clinicalresearch.io/clinical-research-philadelphia-crp/philadelphia-pa/study/109260/subjects",
            "coord": "Jana Milankovic",
            "type": "Site Cancelled",
            "reason": "Due to changes in the protocol criteria, I need to cancel her appointment because her BMI is below the updated eligibility requirement.",
            "cancel_date": "Apr 27",
            "category": "Screen Fail/DNQ"
          },
          {
            "name": "Sofia  Retamal",
            "url": "https://app.clinicalresearch.io/clinical-research-philadelphia-crp/philadelphia-pa/study/109260/subjects",
            "study": "MR-130A-01-TD-3001",
            "study_url": "https://app.clinicalresearch.io/clinical-research-philadelphia-crp/philadelphia-pa/study/109260/subjects",
            "coord": "Jana Milankovic",
            "type": "Site Cancelled",
            "reason": "Due to changes in the protocol criteria, I need to cancel her appointment because her BMI is below the updated eligibility requirement.",
            "cancel_date": "Mar 10",
            "category": "Screen Fail/DNQ"
          },
          {
            "name": "Devon  Anthony",
            "url": "https://app.clinicalresearch.io/clinical-research-philadelphia-crp/philadelphia-pa/study/109260/subjects",
            "study": "MR-130A-01-TD-3001",
            "study_url": "https://app.clinicalresearch.io/clinical-research-philadelphia-crp/philadelphia-pa/study/109260/subjects",
            "coord": "Jana Milankovic",
            "type": "Site Cancelled",
            "reason": "Per Dr. A:  participant does not Qualify for the Contraceptive Patch Study. She is on topiramate (Topamax) and she has an IUD",
            "cancel_date": "Mar 4",
            "category": "Screen Fail/DNQ"
          }
        ],
        "study_url": "https://app.clinicalresearch.io/clinical-research-philadelphia-crp/philadelphia-pa/study/109260/subjects"
      },
      "generic|J2A-MC-GZPS": {
        "patients": [
          {
            "name": "Desiree Sommerville",
            "url": "https://app.clinicalresearch.io/clinical-research-philadelphia-crp/philadelphia-pa/study/162596/subjects",
            "study": "J2A-MC-GZPS",
            "study_url": "https://app.clinicalresearch.io/clinical-research-philadelphia-crp/philadelphia-pa/study/162596/subjects",
            "coord": "Ana Lambic",
            "type": "Site Cancelled",
            "reason": "Participant does not qualify for the study as she has Overactive bladder and pelvic floor dysfunction, which are exclusionary in the study",
            "cancel_date": "Mar 2",
            "category": "Screen Fail/DNQ"
          },
          {
            "name": "Sydney McMillan",
            "url": "https://app.clinicalresearch.io/clinical-research-philadelphia-crp/philadelphia-pa/study/162596/subjects",
            "study": "J2A-MC-GZPS",
            "study_url": "https://app.clinicalresearch.io/clinical-research-philadelphia-crp/philadelphia-pa/study/162596/subjects",
            "coord": "Jana Milankovic",
            "type": "Site Cancelled",
            "reason": "After reviewing her MR Lita told us she DNQ",
            "cancel_date": "Feb 26",
            "category": "Screen Fail/DNQ"
          },
          {
            "name": "Jacquelyn F Amer",
            "url": "https://app.clinicalresearch.io/clinical-research-philadelphia-crp/philadelphia-pa/study/162596/subjects",
            "study": "J2A-MC-GZPS",
            "study_url": "https://app.clinicalresearch.io/clinical-research-philadelphia-crp/philadelphia-pa/study/162596/subjects",
            "coord": "Ruby Pereira",
            "type": "No Show",
            "reason": "Participant does not qualify for the study",
            "cancel_date": "Jan 15",
            "category": "Screen Fail/DNQ"
          }
        ],
        "study_url": "https://app.clinicalresearch.io/clinical-research-philadelphia-crp/philadelphia-pa/study/162596/subjects"
      },
      "generic|C4951063": {
        "patients": [
          {
            "name": "Heidi  Mathis",
            "url": "https://app.clinicalresearch.io/clinical-research-philadelphia-crp/philadelphia-pa/study/135648/subjects",
            "study": "C4951063",
            "study_url": "https://app.clinicalresearch.io/clinical-research-philadelphia-crp/philadelphia-pa/study/135648/subjects",
            "coord": "Ruby Pereira",
            "type": "Site Cancelled",
            "reason": "Participant is a screen failure",
            "cancel_date": "Feb 26",
            "category": "Screen Fail/DNQ"
          },
          {
            "name": "Kimberly blossom",
            "url": "https://app.clinicalresearch.io/clinical-research-philadelphia-crp/philadelphia-pa/study/135648/subjects",
            "study": "C4951063",
            "study_url": "https://app.clinicalresearch.io/clinical-research-philadelphia-crp/philadelphia-pa/study/135648/subjects",
            "coord": "Jana Milankovic",
            "type": "Site Cancelled",
            "reason": "After reviewing MR she has autoimmune neurological disorder",
            "cancel_date": "Jan 22",
            "category": "Screen Fail/DNQ"
          }
        ],
        "study_url": "https://app.clinicalresearch.io/clinical-research-philadelphia-crp/philadelphia-pa/study/135648/subjects"
      },
      "generic|D7960C00015": {
        "patients": [
          {
            "name": "Gilbert Monte",
            "url": "https://app.clinicalresearch.io/clinical-research-philadelphia-crp/philadelphia-pa/study/154462/subjects",
            "study": "D7960C00015",
            "study_url": "https://app.clinicalresearch.io/clinical-research-philadelphia-crp/philadelphia-pa/study/154462/subjects",
            "coord": "Stacey Scott",
            "type": "Site Cancelled",
            "reason": "subject is a screen fail per PI inclusion 1A",
            "cancel_date": "Feb 23",
            "category": "Screen Fail/DNQ"
          },
          {
            "name": "David Rochlis",
            "url": "https://app.clinicalresearch.io/clinical-research-philadelphia-crp/philadelphia-pa/study/154462/subjects",
            "study": "D7960C00015",
            "study_url": "https://app.clinicalresearch.io/clinical-research-philadelphia-crp/philadelphia-pa/study/154462/subjects",
            "coord": "Stacey Scott",
            "type": "Site Cancelled",
            "reason": "SUBJECT IS A SCREEN FAIL",
            "cancel_date": "Feb 17",
            "category": "Screen Fail/DNQ"
          },
          {
            "name": "Bill Kaufman",
            "url": "https://app.clinicalresearch.io/clinical-research-philadelphia-crp/philadelphia-pa/study/154462/subjects",
            "study": "D7960C00015",
            "study_url": "https://app.clinicalresearch.io/clinical-research-philadelphia-crp/philadelphia-pa/study/154462/subjects",
            "coord": "Jana Milankovic",
            "type": "Site Cancelled",
            "reason": "Pt does not qualify",
            "cancel_date": "Jan 30",
            "category": "Screen Fail/DNQ"
          }
        ],
        "study_url": "https://app.clinicalresearch.io/clinical-research-philadelphia-crp/philadelphia-pa/study/154462/subjects"
      },
      "medication|J2A-MC-GZPS": {
        "patients": [
          {
            "name": "Julie Dowburd",
            "url": "https://app.clinicalresearch.io/clinical-research-philadelphia-crp/philadelphia-pa/study/162596/subjects",
            "study": "J2A-MC-GZPS",
            "study_url": "https://app.clinicalresearch.io/clinical-research-philadelphia-crp/philadelphia-pa/study/162596/subjects",
            "coord": "Jana Milankovic",
            "type": "Site Cancelled",
            "reason": "After reviewing her Med records Lita told us that she DNQ",
            "cancel_date": "Feb 19",
            "category": "Screen Fail/DNQ"
          }
        ],
        "study_url": "https://app.clinicalresearch.io/clinical-research-philadelphia-crp/philadelphia-pa/study/162596/subjects"
      },
      "generic|J2A-MC-GZPO": {
        "patients": [
          {
            "name": "JAMES Schwartz",
            "url": "https://app.clinicalresearch.io/clinical-research-philadelphia-crp/philadelphia-pa/study/135157/subjects",
            "study": "J2A-MC-GZPO",
            "study_url": "https://app.clinicalresearch.io/clinical-research-philadelphia-crp/philadelphia-pa/study/135157/subjects",
            "coord": "Stacey Scott",
            "type": "Site Cancelled",
            "reason": "screen fail inclusion 2007 per PI",
            "cancel_date": "Feb 5",
            "category": "Screen Fail/DNQ"
          },
          {
            "name": "Grace Hankinson",
            "url": "https://app.clinicalresearch.io/clinical-research-philadelphia-crp/philadelphia-pa/study/135157/subjects",
            "study": "J2A-MC-GZPO",
            "study_url": "https://app.clinicalresearch.io/clinical-research-philadelphia-crp/philadelphia-pa/study/135157/subjects",
            "coord": "Stacey Scott",
            "type": "Site Cancelled",
            "reason": "subject is a screenfail",
            "cancel_date": "Feb 3",
            "category": "Screen Fail/DNQ"
          }
        ],
        "study_url": "https://app.clinicalresearch.io/clinical-research-philadelphia-crp/philadelphia-pa/study/135157/subjects"
      },
      "consent|D7960C00015": {
        "patients": [
          {
            "name": "Mary DeAngelis",
            "url": "https://app.clinicalresearch.io/clinical-research-philadelphia-crp/philadelphia-pa/study/154462/subjects",
            "study": "D7960C00015",
            "study_url": "https://app.clinicalresearch.io/clinical-research-philadelphia-crp/philadelphia-pa/study/154462/subjects",
            "coord": "Gabrijela Ateljevic",
            "type": "Site Cancelled",
            "reason": "subject did not sign consent does not qualify for study per Dr Heether was not on maximum therapy 40 mh og a statin for 30 days",
            "cancel_date": "Jan 6",
            "category": "Screen Fail/DNQ"
          }
        ],
        "study_url": "https://app.clinicalresearch.io/clinical-research-philadelphia-crp/philadelphia-pa/study/154462/subjects"
      }
    },
    "open_reschedule_promises": [
      {
        "name": "John  Kenny",
        "url": "https://app.clinicalresearch.io/clinical-research-philadelphia-crp/clinical-research-philadelphia-pennington/study/167755/subjects",
        "study": "N1T-MC-MALO",
        "study_url": "https://app.clinicalresearch.io/clinical-research-philadelphia-crp/clinical-research-philadelphia-pennington/study/167755/subjects",
        "coord": "Angelina Mcmullen",
        "type": "Patient Cancelled",
        "reason": "patient left VM that they need to reschedule",
        "cancel_date": "Mar 5",
        "category": "Rescheduled"
      },
      {
        "name": "Rovshan  G Safarov",
        "url": "https://app.clinicalresearch.io/clinical-research-philadelphia-crp/clinical-research-philadelphia-pennington/study/172389/subjects",
        "study": "J3F-MC-EZCC",
        "study_url": "https://app.clinicalresearch.io/clinical-research-philadelphia-crp/clinical-research-philadelphia-pennington/study/172389/subjects",
        "coord": "Angelina Mcmullen",
        "type": "Patient Cancelled",
        "reason": "was unable to make it, will reach out to reschedule",
        "cancel_date": "Mar 5",
        "category": "Rescheduled"
      },
      {
        "name": "Kamela Green",
        "url": "https://app.clinicalresearch.io/clinical-research-philadelphia-crp/philadelphia-pa/study/162596/subjects",
        "study": "J2A-MC-GZPS",
        "study_url": "https://app.clinicalresearch.io/clinical-research-philadelphia-crp/philadelphia-pa/study/162596/subjects",
        "coord": "Jana Milankovic",
        "type": "Patient Cancelled",
        "reason": "Had emergency surgery last week, she will call us back when she's ready to reschedule.",
        "cancel_date": "Mar 4",
        "category": "Rescheduled"
      },
      {
        "name": "Anastasiia Oleksandruk",
        "url": "https://app.clinicalresearch.io/clinical-research-philadelphia-crp/philadelphia-pa/study/135648/subjects",
        "study": "C4951063",
        "study_url": "https://app.clinicalresearch.io/clinical-research-philadelphia-crp/philadelphia-pa/study/135648/subjects",
        "coord": "Jana Milankovic",
        "type": "Site Cancelled",
        "reason": "Due to snow on 2/23, but participant informed me that she will be moving out of the Philadelphia area so appt was not rescheduled",
        "cancel_date": "Feb 23",
        "category": "Rescheduled"
      },
      {
        "name": "Larry  King",
        "url": "https://app.clinicalresearch.io/clinical-research-philadelphia-crp/clinical-research-philadelphia-pennington/study/167755/subjects",
        "study": "N1T-MC-MALO",
        "study_url": "https://app.clinicalresearch.io/clinical-research-philadelphia-crp/clinical-research-philadelphia-pennington/study/167755/subjects",
        "coord": "Vlado Draganic",
        "type": "Patient Cancelled",
        "reason": "Patient would like to call back to reschedule.",
        "cancel_date": "Feb 20",
        "category": "Rescheduled"
      },
      {
        "name": "Michael  Kinsey",
        "url": "https://app.clinicalresearch.io/clinical-research-philadelphia-crp/clinical-research-philadelphia-pennington/study/167755/subjects",
        "study": "N1T-MC-MALO",
        "study_url": "https://app.clinicalresearch.io/clinical-research-philadelphia-crp/clinical-research-philadelphia-pennington/study/167755/subjects",
        "coord": "Vlado Draganic",
        "type": "Patient Cancelled",
        "reason": "cant make it, will call back to reschedule after talking with his doctor",
        "cancel_date": "Feb 11",
        "category": "Rescheduled"
      },
      {
        "name": "Katherine  Packel",
        "url": "https://app.clinicalresearch.io/clinical-research-philadelphia-crp/philadelphia-pa/study/109260/subjects",
        "study": "MR-130A-01-TD-3001",
        "study_url": "https://app.clinicalresearch.io/clinical-research-philadelphia-crp/philadelphia-pa/study/109260/subjects",
        "coord": "Jana Milankovic",
        "type": "Site Cancelled",
        "reason": "Need to Reschedule her but she is Unresponsive",
        "cancel_date": "Feb 11",
        "category": "Rescheduled"
      },
      {
        "name": "Dominique Levere",
        "url": "https://app.clinicalresearch.io/clinical-research-philadelphia-crp/philadelphia-pa/study/135648/subjects",
        "study": "C4951063",
        "study_url": "https://app.clinicalresearch.io/clinical-research-philadelphia-crp/philadelphia-pa/study/135648/subjects",
        "coord": "Jana Milankovic",
        "type": "Site Cancelled",
        "reason": "due to expected snow, will call participant next week to reschedule appt",
        "cancel_date": "Jan 26",
        "category": "Rescheduled"
      },
      {
        "name": "Erika Markowitz",
        "url": "https://app.clinicalresearch.io/clinical-research-philadelphia-crp/philadelphia-pa/study/162596/subjects",
        "study": "J2A-MC-GZPS",
        "study_url": "https://app.clinicalresearch.io/clinical-research-philadelphia-crp/philadelphia-pa/study/162596/subjects",
        "coord": "Jana Milankovic",
        "type": "Patient Cancelled",
        "reason": "She is sick and called to reschedule",
        "cancel_date": "Jan 20",
        "category": "Rescheduled"
      },
      {
        "name": "Ronald  Falconio",
        "url": "https://app.clinicalresearch.io/clinical-research-philadelphia-crp/clinical-research-philadelphia-pennington/study/167755/subjects",
        "study": "N1T-MC-MALO",
        "study_url": "https://app.clinicalresearch.io/clinical-research-philadelphia-crp/clinical-research-philadelphia-pennington/study/167755/subjects",
        "coord": "Cady Chilensky",
        "type": "Patient Cancelled",
        "reason": "Having car trouble - will call to reschedule",
        "cancel_date": "Jan 21",
        "category": "Rescheduled"
      }
    ],
    "no_show_unreachable": [],
    "reschedule_needed": [],
    "withdrew_recoverable": [
      {
        "name": "Bernice Oglesby",
        "url": "https://app.clinicalresearch.io/clinical-research-philadelphia-crp/philadelphia-pa/study/162596/subjects",
        "study": "J2A-MC-GZPS",
        "study_url": "https://app.clinicalresearch.io/clinical-research-philadelphia-crp/philadelphia-pa/study/162596/subjects",
        "coord": "Jana Milankovic",
        "type": "Patient Cancelled",
        "reason": "Patient cancelled, She is no longer interested in the study",
        "cancel_date": "Mar 31",
        "category": "Patient Withdrew"
      },
      {
        "name": "Shanan Olds",
        "url": "https://app.clinicalresearch.io/clinical-research-philadelphia-crp/philadelphia-pa/study/162596/subjects",
        "study": "J2A-MC-GZPS",
        "study_url": "https://app.clinicalresearch.io/clinical-research-philadelphia-crp/philadelphia-pa/study/162596/subjects",
        "coord": "Jana Milankovic",
        "type": "Patient Cancelled",
        "reason": "She is no longer interested",
        "cancel_date": "Mar 3",
        "category": "Patient Withdrew"
      },
      {
        "name": "Billy Stanley",
        "url": "https://app.clinicalresearch.io/clinical-research-philadelphia-crp/clinical-research-philadelphia-pennington/study/172389/subjects",
        "study": "J3F-MC-EZCC",
        "study_url": "https://app.clinicalresearch.io/clinical-research-philadelphia-crp/clinical-research-philadelphia-pennington/study/172389/subjects",
        "coord": "Ema Gunic",
        "type": "Patient Cancelled",
        "reason": "Patient is no longer interested in participation.",
        "cancel_date": "Feb 24",
        "category": "Patient Withdrew"
      },
      {
        "name": "Donald Garber",
        "url": "https://app.clinicalresearch.io/clinical-research-philadelphia-crp/clinical-research-philadelphia-pennington/study/161619/subjects",
        "study": "D6973C00001",
        "study_url": "https://app.clinicalresearch.io/clinical-research-philadelphia-crp/clinical-research-philadelphia-pennington/study/161619/subjects",
        "coord": "Stacey Scott",
        "type": "Patient Cancelled",
        "reason": "subject withdrew consent called site and stated he coukld not make study scheduled appointments and refuses to return study drug",
        "cancel_date": "Jan 19",
        "category": "Patient Withdrew"
      }
    ],
    "withdrew_final": [],
    "admin_fixes": [
      {
        "name": "Michael Rush",
        "url": "https://app.clinicalresearch.io/clinical-research-philadelphia-crp/philadelphia-pa/study/173860/subjects",
        "study": "88545223PSA2001",
        "study_url": "https://app.clinicalresearch.io/clinical-research-philadelphia-crp/philadelphia-pa/study/173860/subjects",
        "coord": "Gabrijela Ateljevic",
        "type": "Site Cancelled",
        "reason": "Wrong study",
        "cancel_date": "Mar 10",
        "category": "Admin Error"
      },
      {
        "name": "Victor Cantres",
        "url": "https://app.clinicalresearch.io/clinical-research-philadelphia-crp/philadelphia-pa/study/173860/subjects",
        "study": "88545223PSA2001",
        "study_url": "https://app.clinicalresearch.io/clinical-research-philadelphia-crp/philadelphia-pa/study/173860/subjects",
        "coord": "Gabrijela Ateljevic",
        "type": "Site Cancelled",
        "reason": "Wrong study",
        "cancel_date": "Feb 24",
        "category": "Admin Error"
      },
      {
        "name": "Debra  Feldman",
        "url": "https://app.clinicalresearch.io/clinical-research-philadelphia-crp/clinical-research-philadelphia-pennington/study/167755/subjects",
        "study": "N1T-MC-MALO",
        "study_url": "https://app.clinicalresearch.io/clinical-research-philadelphia-crp/clinical-research-philadelphia-pennington/study/167755/subjects",
        "coord": "Aneesh Vaze",
        "type": "Site Cancelled",
        "reason": "Entered in error",
        "cancel_date": "Jan 20",
        "category": "Admin Error"
      }
    ]
  }
}
let DATA = SAMPLE;


// ═══════════════════════════════════════════════════
// CHARTS — instantiated once, updated on data change
// ═══════════════════════════════════════════════════
let charts = {};

const COLORS = ['#072061','#059669','#d97706','#dc2626','#7c3aed',
                '#0ea5e9','#ff9933','#10b981','#ef4444','#8b5cf6',
                '#1843ad','#6366f1'];

function chartDefaults() {
  Chart.defaults.font.family = "'IBM Plex Sans', sans-serif";
  Chart.defaults.font.size = 11;
  Chart.defaults.color = '#64748b';
}

function mkChart(id, config) {
  var el = document.getElementById(id);
  if (!el) return;
  if (charts[id]) charts[id].destroy();
  charts[id] = new Chart(el, config);
}

function buildCancelTrend() {
  mkChart('cancelTrendChart', {
    type: 'bar',
    data: {
      labels: DATA.cancelWeekly.map(d => d.week),
      datasets: [{
        data: DATA.cancelWeekly.map(d => d.count),
        backgroundColor: DATA.cancelWeekly.map(d => d.count >= 30 ? '#fca5a5' : d.count >= 18 ? '#fde68a' : '#bfdbfe'),
        borderColor: DATA.cancelWeekly.map(d => d.count >= 30 ? '#dc2626' : d.count >= 18 ? '#d97706' : '#072061'),
        borderWidth: 1.5, borderRadius: 4,
      }]
    },
    options: {
      responsive: true, maintainAspectRatio: false,
      plugins: { legend: { display: false },
        tooltip: { callbacks: { title: (i) => 'Week of ' + i[0].label, label: (i) => i.raw + ' cancellations' } }
      },
      scales: {
        x: { grid: { display: false } },
        y: { grid: { color: '#f1f5f9' }, beginAtZero: true }
      }
    }
  });
}

function buildUpcomingTrend() {
  mkChart('upcomingTrendChart', {
    type: 'line',
    data: {
      labels: DATA.upcomingWeekly.map(d => d.week),
      datasets: [{
        data: DATA.upcomingWeekly.map(d => d.count),
        borderColor: '#072061', backgroundColor: 'rgba(37,99,235,0.08)',
        borderWidth: 2, pointRadius: 4, pointBackgroundColor: '#072061',
        fill: true, tension: 0.3,
      }]
    },
    options: {
      responsive: true, maintainAspectRatio: false,
      plugins: { legend: { display: false } },
      scales: {
        x: { grid: { display: false } },
        y: { grid: { color: '#f1f5f9' }, beginAtZero: true }
      }
    }
  });
}

function buildReasonChart() {
  const top6 = DATA.cancelReasons.slice(0, 6);
  mkChart('reasonChart', {
    type: 'doughnut',
    data: {
      labels: top6.map(d => d.reason),
      datasets: [{ data: top6.map(d => d.count), backgroundColor: COLORS, borderWidth: 2, borderColor: '#fff', hoverOffset: 8 }]
    },
    options: {
      responsive: true, maintainAspectRatio: false,
      cutout: '62%',
      onClick: (evt, elements) => {
        if (!elements.length) return;
        const d = top6[elements[0].index];
        showCancelsByReason(d.reason);
      },
      plugins: {
        legend: { display: false },
        tooltip: { callbacks: { label: ctx => ' ' + ctx.label + ': ' + ctx.raw } }
      }
    }
  });
  const leg = document.getElementById('reason-legend');
  leg.innerHTML = '';
  top6.forEach((d, i) => {
    const row = document.createElement('div');
    row.className = 'legend-row';
    row.style.cssText = 'cursor:pointer;transition:background .15s;border-radius:4px;padding:2px 4px;';
    row.onmouseenter = () => row.style.background = '#f1f5f9';
    row.onmouseleave = () => row.style.background = '';
    row.onclick = () => showCancelsByReason(d.reason);
    row.innerHTML = `<div class="legend-dot" style="background:${COLORS[i]}"></div><span class="legend-label" style="color:#1843ad;text-decoration:underline dotted;flex:1">${d.reason}</span><span class="legend-val">${d.count}</span>`;
    leg.appendChild(row);
  });
}

function buildSiteChart() {
  const s = DATA.sites;
  mkChart('siteChart', {
    type: 'bar',
    data: {
      labels: s.map(x => x.site),
      datasets: [
        { label: 'Upcoming Visits', data: s.map(x => x.upcoming), backgroundColor: '#bfdbfe', borderColor: '#072061', borderWidth: 1.5, borderRadius: 4, yAxisID: 'y' },
        { label: 'Cancellations',   data: s.map(x => x.cancels),  backgroundColor: '#fca5a5', borderColor: '#dc2626', borderWidth: 1.5, borderRadius: 4, yAxisID: 'y' },
        { label: 'Cancel Rate %',   data: s.map(x => x.cancelRate || 0), type: 'line', borderColor: '#7c3aed', backgroundColor: 'transparent', borderWidth: 2, pointRadius: 5, pointBackgroundColor: '#7c3aed', yAxisID: 'y2' }
      ]
    },
    options: {
      responsive: true, maintainAspectRatio: false,
      interaction: { mode: 'index', intersect: false },
      onClick: (evt, elements) => {
        if (!elements.length) return;
        const idx = elements[0].dataIndex;
        const site = DATA.sites[idx];
        const isPenn = site.site.toLowerCase().includes('penn');
        showCancels(r => {
          const cl = (r.coord||'').toLowerCase();
          const rPenn = ['angelina mcmullen','cady chilensky'].includes(cl);
          return isPenn ? rPenn : !rPenn;
        }, site.site + ' — Cancellations', site.cancels + ' records');
      },
      plugins: {
        legend: { position: 'top', labels: { usePointStyle: true, font: { size: 11 } } },
        tooltip: { callbacks: {
          afterBody: (items) => {
            const site = DATA.sites[items[0].dataIndex];
            return ['Studies: ' + (site.studies||'?'), 'Cancel Rate: ' + (site.cancelRate||0) + '%'];
          }
        }}
      },
      scales: {
        x: { grid: { display: false } },
        y: { grid: { color: '#f1f5f9' }, beginAtZero: true, title: { display: true, text: 'Visits', font: { size: 10 } } },
        y2: { position: 'right', beginAtZero: true, max: 100, grid: { display: false }, ticks: { callback: v => v + '%' }, title: { display: true, text: 'Cancel Rate', font: { size: 10 } } }
      }
    }
  });
  // Summary stat cards
  const wrap = document.getElementById('siteChart').closest('.card');
  let summaryEl = wrap.querySelector('.site-summary');
  if (!summaryEl) { summaryEl = document.createElement('div'); summaryEl.className = 'site-summary'; wrap.appendChild(summaryEl); }
  summaryEl.innerHTML = `<div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-top:14px;">
    ${DATA.sites.map(s => {
      const rateColor = (s.cancelRate||0) >= 50 ? 'var(--red)' : (s.cancelRate||0) >= 35 ? 'var(--yellow)' : 'var(--green)';
      return `<div style="padding:12px;background:var(--surface2);border-radius:8px;border:1px solid var(--border);cursor:pointer"
                   onclick="showCancels(r=>{const cl=(r.coord||'').toLowerCase();const ip=${s.site.includes('Penn') ? 'true' : 'false'};const rp=['angelina mcmullen','cady chilensky'].includes(cl);return ip?rp:!rp;},'${s.site} — Cancellations','${s.cancels} records')">
        <div style="font-size:11px;font-weight:700;color:var(--text);margin-bottom:8px">${s.site}</div>
        <div style="display:flex;gap:12px;">
          <div><div style="font-size:18px;font-weight:700;color:var(--blue)">${s.upcoming}</div><div style="font-size:10px;color:var(--muted)">Upcoming</div></div>
          <div><div style="font-size:18px;font-weight:700;color:var(--red)">${s.cancels}</div><div style="font-size:10px;color:var(--muted)">Canceled</div></div>
          <div><div style="font-size:18px;font-weight:700;color:${rateColor}">${s.cancelRate||0}%</div><div style="font-size:10px;color:var(--muted)">Cancel Rate</div></div>
          <div><div style="font-size:18px;font-weight:700;color:var(--purple)">${s.studies||'?'}</div><div style="font-size:10px;color:var(--muted)">Studies</div></div>
        </div>
      </div>`;
    }).join('')}
  </div>`;
}
function buildUpcomingStudyChart() {
  // kept for overview tab compatibility — use buildSchedStudyBars for schedule tab
  const d = DATA.upcomingByStudy || DATA.upcomingByStudyFull || [];
  mkChart('upcomingStudyChart', {
    type: 'bar',
    data: {
      labels: d.map(x => x.name),
      datasets: [{ data: d.map(x => x.count), backgroundColor: COLORS, borderWidth: 0, borderRadius: 4 }]
    },
    options: {
      indexAxis: 'y', responsive: true, maintainAspectRatio: false,
      plugins: { legend: { display: false } },
      scales: { x: { grid: { color: '#f1f5f9' }, beginAtZero: true }, y: { grid: { display: false } } }
    }
  });
}

function buildRiskFlagCards() {
  const el = document.getElementById('risk-flag-cards');
  if (!el) return;
  const flags = DATA.riskFlags || [];
  document.getElementById('risk-kpi-count').textContent = flags.length;
  const today = new Date();
  const urgent = flags.filter(f => {
    const parts = f.next_visit.split(' ');
    const monthMap = {Jan:0,Feb:1,Mar:2,Apr:3,May:4,Jun:5,Jul:6,Aug:7,Sep:8,Oct:9,Nov:10,Dec:11};
    const d = new Date(2026, monthMap[parts[0]], parseInt(parts[1]));
    return (d - today) / 86400000 <= 14;
  });
  document.getElementById('risk-kpi-urgent').textContent = urgent.length;
  const studies = new Set(flags.map(f => f.study));
  document.getElementById('risk-kpi-studies').textContent = studies.size;

  if (flags.length === 0) {
    el.innerHTML = '<div style="padding:24px;text-align:center;color:var(--muted);font-size:13px;">🟢 No patients with 2+ cancellations have upcoming visits — great retention!</div>';
    return;
  }

  el.innerHTML = flags.map(f => {
    const urgentFlag = urgent.some(u => u.patient === f.patient);
    const borderColor = urgentFlag ? '#dc2626' : '#d97706';
    const bgColor = urgentFlag ? '#fef2f2' : '#fffbeb';
    return `<div onclick="showRiskFlags('At-Risk Patients')" style="cursor:pointer;border:1.5px solid ${borderColor};border-radius:10px;padding:14px 16px;background:${bgColor};">
      <div style="display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:8px;">
        <div>
          <div style="font-size:14px;font-weight:700;color:#1e293b">${f.patient_url ? `<a href="${f.patient_url}" target="_blank" rel="noopener" onclick="event.stopPropagation()" title="Open ${f.patient} in CRIO" style="text-decoration:none;color:#1e293b;font-weight:700;">${f.patient}<svg xmlns="http://www.w3.org/2000/svg" width="9" height="9" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" style="margin-left:2px;opacity:0.4;vertical-align:middle"><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/><polyline points="15 3 21 3 21 9"/><line x1="10" y1="14" x2="21" y2="3"/></svg></a>` : f.patient}</div>
          <div style="font-size:11px;color:#64748b;margin-top:2px">${f.study_url ? `<a href="${f.study_url}" target="_blank" rel="noopener" onclick="event.stopPropagation()" style="text-decoration:none;font-size:11px;color:#64748b;">${f.study}<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" style="margin-left:3px;opacity:0.45;vertical-align:middle;flex-shrink:0"><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/><polyline points="15 3 21 3 21 9"/><line x1="10" y1="14" x2="21" y2="3"/></svg></a>` : f.study}</div>
        </div>
        <div style="text-align:right;">
          <span style="font-size:11px;font-weight:700;padding:3px 8px;border-radius:6px;background:${borderColor};color:#fff">${f.cancels}× cancelled</span>
        </div>
      </div>
      <div style="display:flex;gap:16px;font-size:12px;color:#475569;">
        <span>📅 Next visit: <strong style="color:#1e293b">${f.next_visit}</strong></span>
        <span>⏮ Last cancel: <strong style="color:#1e293b">${f.last_cancel}</strong></span>
      </div>
      ${urgentFlag ? '<div style="margin-top:8px;font-size:11px;font-weight:700;color:#dc2626;">🔴 CALL NOW — visit within 14 days</div>' : '<div style="margin-top:8px;font-size:11px;color:#d97706;">⚠️ Schedule proactive outreach call</div>'}
    </div>`;
  }).join('');
}

function buildWeeklyBySiteChart() {
  const d = DATA.weeklyBySite || [];
  if (!document.getElementById('weeklyBySiteChart')) return;
  mkChart('weeklyBySiteChart', {
    type: 'bar',
    data: {
      labels: d.map(x => x.week),
      datasets: [
        { label: 'Philadelphia', data: d.map(x => x.philly), backgroundColor: '#bfdbfe', borderColor: '#072061', borderWidth: 1.5, borderRadius: 4 },
        { label: 'Pennington', data: d.map(x => x.pennington), backgroundColor: '#bbf7d0', borderColor: '#059669', borderWidth: 1.5, borderRadius: 4 }
      ]
    },
    options: {
      responsive: true, maintainAspectRatio: false,
      plugins: { legend: { position: 'top', labels: { usePointStyle: true, font: { size: 11 } } },
        tooltip: { callbacks: { footer: (items) => 'Total: ' + (items[0].raw + (items[1]?.raw||0)) }}
      },
      scales: {
        x: { stacked: true, grid: { display: false } },
        y: { stacked: true, grid: { color: '#f1f5f9' }, beginAtZero: true }
      }
    }
  });
}

function buildVisitTypeChart() {
  const d = DATA.visitTypes || [];
  const colors = ['#072061','#059669','#94a3b8','#7c3aed','#d97706'];
  mkChart('visitTypeChart', {
    type: 'doughnut',
    data: {
      labels: d.map(x => x.type),
      datasets: [{ data: d.map(x => x.count), backgroundColor: colors, borderWidth: 2, borderColor: '#fff', hoverOffset: 6 }]
    },
    options: {
      responsive: true, maintainAspectRatio: false,
      plugins: { legend: { display: false } }
    }
  });
  const leg = document.getElementById('visit-type-legend');
  if (leg) leg.innerHTML = d.map((x,i) => `<div class="legend-row"><div class="legend-dot" style="background:${colors[i]}"></div><span class="legend-label">${x.type}</span><span class="legend-val">${x.count}</span></div>`).join('');
}

function buildSchedCoordList() {
  const el = document.getElementById('sched-coord-list');
  if (!el || el.innerHTML.trim()) return; // already populated statically
  const VALID = new Set(['Stacey Scott','Ruby Pereira','Mario Castellanos','Angelina McMullen','Cady Chilensky']);
  const coords = (DATA.coordinators || []).filter(c => VALID.has(c.name));
  const max = Math.max(...coords.map(c => c.upcoming), 1);
  el.innerHTML = coords.map(c => {
    const pct = Math.round(c.upcoming / max * 100);
    const color = c.site && c.site.includes('Penn') ? '#059669' : '#072061';
    return `<div style="padding:8px 0;border-bottom:1px solid #f1f5f9;cursor:pointer;" onclick="showCoordDetail('${c.name}')">
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:4px;">
        <span style="font-size:12px;font-weight:600">${c.name}</span>
        <span style="font-size:12px;font-weight:700;color:${color}">${c.upcoming} visits</span>
      </div>
      <div style="height:6px;background:var(--border);border-radius:3px;overflow:hidden;">
        <div style="width:${pct}%;height:100%;background:${color};border-radius:3px;"></div>
      </div>
    </div>`;
  }).join('');
}

function buildSchedStudyBars() {
  const el = document.getElementById('upcoming-study-bars');
  if (!el) return;
  const studies = DATA.upcomingByStudyFull || DATA.upcomingByStudy || [];
  const max = Math.max(...studies.map(s => s.count));
  el.innerHTML = studies.map((s, i) => {
    const pct = (s.count / max * 100).toFixed(0);
    const siteColor = (s.site||'').includes('Penn') ? '#059669' : '#072061';
    const siteShort = (s.site||'').includes('Penn') ? 'PNJ' : 'PHL';
    const safeStudy = (s.name||'').replace(/'/g,"\\'");
    return `<div style="display:grid;grid-template-columns:1fr 36px 36px;gap:4px 8px;align-items:center;padding:5px 0;border-bottom:1px solid #f8fafc;">
      <div>
        <div style="font-size:11px;font-weight:500;margin-bottom:3px">${s.study_url ? `<a href="${s.study_url}" target="_blank" rel="noopener" onclick="event.stopPropagation()" style="text-decoration:none;font-size:11px;font-weight:500;color:inherit;">${s.name}<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" style="margin-left:3px;opacity:0.45;vertical-align:middle;flex-shrink:0"><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/><polyline points="15 3 21 3 21 9"/><line x1="10" y1="14" x2="21" y2="3"/></svg></a>` : s.name}</div>
        <div style="height:5px;background:var(--border);border-radius:3px;overflow:hidden">
          <div style="width:${pct}%;height:100%;background:${siteColor};border-radius:3px;"></div>
        </div>
      </div>
      <span style="font-size:12px;font-weight:700;color:${siteColor};text-align:right;cursor:pointer;text-decoration:underline;text-decoration-style:dotted;" onclick="showUpcoming(r=>r.study==='${safeStudy}','${safeStudy} — Upcoming Visits')">${s.count}</span>
      <span style="font-size:9px;font-weight:700;padding:2px 4px;border-radius:3px;background:${siteColor}20;color:${siteColor};text-align:center">${siteShort}</span>
    </div>`;
  }).join('');
}

function buildStatusLegend() {
  const d = DATA.subjectStatus || [];
  const colors = ['#059669','#072061','#d97706','#7c3aed','#94a3b8'];
  const leg = document.getElementById('status-legend');
  if (leg) leg.innerHTML = d.map((x,i) => `<div class="legend-row"><div class="legend-dot" style="background:${colors[i]}"></div><span class="legend-label">${x.status}</span><span class="legend-val">${x.count}</span></div>`).join('');
}

function schedFilter(btn, filter) {
  document.querySelectorAll('.filter-btn').forEach(b => b.classList.remove('active'));
  if (btn) btn.classList.add('active');
  const today = new Date(); today.setHours(0,0,0,0);
  const rows = document.querySelectorAll('#upcoming-tbody .vis-row');
  let shown = 0;
  rows.forEach(row => {
    const d = new Date(row.dataset.date);
    const site = row.dataset.site || '';
    const days = (d - today) / 86400000;
    let vis = true;
    if (filter === '14')  vis = days <= 14;
    else if (filter === '30')  vis = days <= 30;
    else if (filter === 'phl') vis = !site.includes('Penn');
    else if (filter === 'pnj') vis = site.includes('Penn');
    row.style.display = vis ? '' : 'none';
    if (vis) shown++;
  });
  const badge = document.getElementById('sched-count');
  if (badge) badge.textContent = shown + ' visits';
}

function filterSchedTable(filter, btn) { schedFilter(btn, filter); }



function buildUpcomingDetailTable(rows) {
  if (!rows || typeof rows !== 'object' || !Array.isArray(rows)) {
    rows = DATA.allVisitDetail || DATA.next14Detail || [];
  }
  const tbody = document.getElementById('upcoming-tbody');
  if (!tbody) return;
  const statusColors = { 'Enrolled':'#059669','Scheduled V1':'#072061','Screening':'#d97706','Prequalified':'#7c3aed' };
  tbody.innerHTML = rows.map(r => {
    const sc = statusColors[r.status] || '#94a3b8';
    const siteShort = (r.site||'').includes('Penn') ? 'PNJ' : 'PHL';
    const siteColor = (r.site||'').includes('Penn') ? '#059669' : '#072061';
    const extIcon = `<svg xmlns="http://www.w3.org/2000/svg" width="9" height="9" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" style="margin-left:2px;opacity:0.4;vertical-align:middle"><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/><polyline points="15 3 21 3 21 9"/><line x1="10" y1="14" x2="21" y2="3"/></svg>`;
    const studyCell = r.study_url
      ? `<a href="${r.study_url}" target="_blank" rel="noopener" style="text-decoration:none;font-size:11px;color:var(--blue);">${r.study}${extIcon}</a>`
      : `<span style="font-size:11px">${r.study}</span>`;
    const patientCell = r.patient_url
      ? `<a href="${r.patient_url}" target="_blank" rel="noopener" style="text-decoration:none;color:var(--navy);font-weight:600;">${maskPHI(r.patient)}${extIcon}</a>`
      : `<strong>${maskPHI(r.patient)}</strong>`;
    let medDot = '';
    return `<tr>
      <td style="font-weight:600;color:var(--blue);white-space:nowrap">${r.date}</td>
      <td>${studyCell}</td>
      <td style="color:var(--muted);font-size:11px">${r.visit}</td>
      <td>${patientCell}${medDot}</td>
      <td><span style="font-size:10px;font-weight:700;padding:2px 6px;border-radius:4px;background:${sc}20;color:${sc}">${r.status}</span></td>
      <td style="font-size:11px">${r.coord}</td>
      <td style="font-size:11px;color:${r.investigator ? '#7c3aed' : '#cbd5e1'}">${r.investigator || '—'}</td>
      <td><span style="font-size:9px;font-weight:700;padding:2px 5px;border-radius:3px;background:${siteColor}20;color:${siteColor}">${siteShort}</span></td>
    </tr>`;
  }).join('');
}

function buildStatusChart() {
  const d = DATA.subjectStatus;
  mkChart('statusChart', {
    type: 'doughnut',
    data: {
      labels: d.map(x => x.status),
      datasets: [{ data: d.map(x => x.count), backgroundColor: ['#059669','#072061','#d97706','#10b981','#dc2626','#94a3b8'], borderWidth: 2, borderColor: '#fff' }]
    },
    options: {
      responsive: true, maintainAspectRatio: false,
      plugins: { legend: { position: 'right', labels: { usePointStyle: true, padding: 10, font: { size: 11 } } } }
    }
  });
}

// ═══════════════════════════════════════════════════
// DOM BUILDERS
// ═══════════════════════════════════════════════════
function buildHorizon() {
  const grid = document.getElementById('horizon-grid');
  const pastWeeks = DATA.cancelWeekly.slice(-4);
  const futureWeeks = DATA.upcomingWeekly.slice(0, 4);
  let html = '';

  pastWeeks.forEach(w => {
    html += `<div class="horizon-week hw-past" title="${w.count} cancellations week of ${w.week}" style="cursor:pointer" onclick="showHorizonDetail('cancel','${w.week}')">
      <div class="hw-date">${w.week}</div>
      <div class="hw-count">${w.count}</div>
      <div class="hw-type" style="color:var(--red)">canceled</div>
    </div>`;
  });

  const todayStr = new Date().toLocaleDateString('en-US',{month:'short',day:'numeric'});
  html += `<div class="horizon-week hw-today">
    <div class="hw-date" style="color:var(--green); font-weight:600">TODAY</div>
    <div class="hw-count" style="font-size:11px; color:var(--green);">${todayStr}</div>
    <div class="hw-type" style="color:var(--green);">★</div>
  </div>`;

  futureWeeks.forEach(w => {
    html += `<div class="horizon-week hw-future" title="${w.count} visits scheduled week of ${w.week}" style="cursor:pointer" onclick="showHorizonDetail('upcoming','${w.week}')">
      <div class="hw-date">${w.week}</div>
      <div class="hw-count">${w.count}</div>
      <div class="hw-type" style="color:#1843ad">visits</div>
    </div>`;
  });

  grid.innerHTML = html;
}

function showHorizonDetail(type, weekLabel) {
  // Parse the week label (e.g. "Feb 10") into a date range (Mon–Sun)
  const year = new Date().getFullYear();
  const parsed = new Date(weekLabel + ', ' + year);
  if (isNaN(parsed)) return;
  // Align to Monday of that week
  const day = parsed.getDay();
  const mon = new Date(parsed);
  mon.setDate(parsed.getDate() - (day === 0 ? 6 : day - 1));
  const sun = new Date(mon);
  sun.setDate(mon.getDate() + 6);
  const monISO = localISO(mon);
  const sunISO = localISO(sun);
  const monFmt = mon.toLocaleDateString('en-US',{month:'short',day:'numeric'});
  const sunFmt = sun.toLocaleDateString('en-US',{month:'short',day:'numeric'});

  let rows = [], title = '';
  if (type === 'cancel') {
    title = `Cancellations: ${monFmt} – ${sunFmt}`;
    rows = (DATA.allCancels || []).filter(r => {
      const d = new Date(r.cancel_date + ', ' + year);
      if (isNaN(d)) return false;
      const iso = localISO(d);
      return iso >= monISO && iso <= sunISO;
    });
  } else {
    title = `Upcoming Visits: ${monFmt} – ${sunFmt}`;
    rows = (DATA.allVisitDetail || []).filter(r => {
      return r.date_iso >= monISO && r.date_iso <= sunISO;
    });
  }

  const linkIcon = '<svg xmlns="http://www.w3.org/2000/svg" width="9" height="9" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" style="margin-left:2px;opacity:0.4;vertical-align:middle"><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/><polyline points="15 3 21 3 21 9"/><line x1="10" y1="14" x2="21" y2="3"/></svg>';

  let tableHTML = '';
  if (type === 'cancel') {
    tableHTML = `<table style="width:100%;border-collapse:collapse;font-size:12px">
      <thead><tr style="background:#f8fafc;border-bottom:2px solid #e2e8f0">
        <th style="padding:8px;text-align:left">Patient</th><th style="padding:8px;text-align:left">Study</th>
        <th style="padding:8px;text-align:left">Reason</th><th style="padding:8px;text-align:left">Date</th>
      </tr></thead><tbody>${rows.map(r => `<tr style="border-bottom:1px solid #f1f5f9">
        <td style="padding:6px 8px"><a href="${r.url}" target="_blank" style="text-decoration:none;color:var(--navy);font-weight:600">${maskPHI(r.name)}${linkIcon}</a></td>
        <td style="padding:6px 8px;font-size:11px">${r.study}</td>
        <td style="padding:6px 8px;font-size:11px;color:var(--muted)">${(r.reason||'').substring(0,50)}</td>
        <td style="padding:6px 8px;font-size:11px">${r.cancel_date}</td>
      </tr>`).join('')}</tbody></table>`;
  } else {
    tableHTML = `<table style="width:100%;border-collapse:collapse;font-size:12px">
      <thead><tr style="background:#f8fafc;border-bottom:2px solid #e2e8f0">
        <th style="padding:8px;text-align:left">Date</th><th style="padding:8px;text-align:left">Patient</th>
        <th style="padding:8px;text-align:left">Study</th><th style="padding:8px;text-align:left">Visit</th>
        <th style="padding:8px;text-align:left">Coordinator</th><th style="padding:8px;text-align:left">Investigator</th>
      </tr></thead><tbody>${rows.map(r => `<tr style="border-bottom:1px solid #f1f5f9">
        <td style="padding:6px 8px;font-weight:600;color:var(--blue)">${r.date}</td>
        <td style="padding:6px 8px"><a href="${r.patient_url}" target="_blank" style="text-decoration:none;color:var(--navy);font-weight:600">${maskPHI(r.patient)}${linkIcon}</a></td>
        <td style="padding:6px 8px;font-size:11px">${r.study}</td>
        <td style="padding:6px 8px;font-size:11px;color:var(--muted)">${r.visit}</td>
        <td style="padding:6px 8px;font-size:11px">${r.coord}</td>
        <td style="padding:6px 8px;font-size:11px;color:${r.investigator ? '#7c3aed' : '#cbd5e1'}">${r.investigator || '—'}</td>
      </tr>`).join('')}</tbody></table>`;
  }

  // Show in a modal/overlay
  let overlay = document.getElementById('horizon-overlay');
  if (!overlay) {
    overlay = document.createElement('div');
    overlay.id = 'horizon-overlay';
    overlay.style.cssText = 'position:fixed;top:0;left:0;right:0;bottom:0;background:rgba(0,0,0,0.5);z-index:9999;display:flex;align-items:center;justify-content:center;padding:24px';
    overlay.onclick = e => { if (e.target === overlay) overlay.remove(); };
    document.body.appendChild(overlay);
  }
  overlay.innerHTML = `<div style="background:#fff;border-radius:12px;max-width:800px;width:100%;max-height:80vh;overflow:auto;box-shadow:0 20px 60px rgba(0,0,0,0.3)">
    <div style="padding:16px 20px;border-bottom:1px solid #e2e8f0;display:flex;justify-content:space-between;align-items:center">
      <div style="font-size:15px;font-weight:700;color:#1a202c">${title} <span style="font-weight:400;color:#64748b;font-size:13px">(${rows.length} records)</span></div>
      <button onclick="document.getElementById('horizon-overlay').remove()" style="background:none;border:none;font-size:20px;cursor:pointer;color:#94a3b8;padding:4px 8px">✕</button>
    </div>
    <div style="padding:16px 20px">${rows.length ? tableHTML : '<div style="text-align:center;padding:24px;color:#94a3b8">No records for this week</div>'}</div>
  </div>`;
}

function buildCancelStudyBars() {
  const el = document.getElementById('cancel-study-bars');
  if (!el || !DATA.cancelByStudy || !DATA.cancelByStudy.length) return;
  const max = DATA.cancelByStudy[0].count;
  el.innerHTML = DATA.cancelByStudy.map(d => {
    const label = d.study || d.name || d.full || '—';
    const pct   = (d.count / max * 100).toFixed(0);
    const color = d.count >= 30 ? '#dc2626' : d.count >= 15 ? '#d97706' : '#072061';
    const linkIcon = `<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" style="margin-left:3px;opacity:0.45;vertical-align:middle;flex-shrink:0"><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/><polyline points="15 3 21 3 21 9"/><line x1="10" y1="14" x2="21" y2="3"/></svg>`;
    const labelHtml = d.study_url
      ? `<a href="${d.study_url}" target="_blank" rel="noopener" onclick="event.stopPropagation()" style="text-decoration:none;font-size:11px;color:var(--muted);">${label}${linkIcon}</a>`
      : label;
    return `<div style="display:flex;align-items:center;gap:10px;padding:7px 0;border-bottom:1px solid #f1f5f9;cursor:pointer;"
                 onclick="showCancels(r=>r.study==='${label.replace(/'/g,"\'")}','${label} — Cancellations','${d.count} records')">
      <span style="font-size:11px;color:var(--muted);width:180px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;" title="${label}">${labelHtml}</span>
      <div style="flex:1;height:8px;background:var(--border);border-radius:4px;overflow:hidden">
        <div style="width:${pct}%;height:100%;background:${color};border-radius:4px;"></div>
      </div>
      <span style="font-size:12px;font-weight:700;color:${color};width:24px;text-align:right">${d.count}</span>
    </div>`;
  }).join('');
}

function buildCoordList() {
  const el = document.getElementById('sched-coord-list') || document.getElementById('coord-list');
  if (!el) return;
  const coords = (DATA.coordinators||[]).filter(c =>
    ['stacey scott','ruby pereira','mario castellanos','angelina mcmullen','cady chilensky']
      .includes((c.name||'').toLowerCase())
  );
  if (!coords.length) { el.innerHTML = '<p style="color:#94a3b8;font-size:12px">No coordinator data</p>'; return; }
  const maxUp = Math.max(...coords.map(c => c.upcoming || 0), 1);
  const siteColors = { 'Philadelphia, PA': '#072061', 'Pennington, NJ': '#1843ad' };
  el.innerHTML = coords.map(c => {
    const pct = Math.round((c.upcoming||0) / maxUp * 100);
    const siteColor = siteColors[c.site] || '#072061';
    const cancelRate = c.upcoming ? Math.round((c.cancels||0)/(c.upcoming + (c.cancels||0))*100) : 0;
    const rateColor = cancelRate >= 40 ? '#dc2626' : cancelRate >= 25 ? '#d97706' : '#059669';
    return `<div class="coord-row" style="padding:10px 0;border-bottom:1px solid var(--border);cursor:pointer"
                 onclick="showCoordDetail('${c.name}')">
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:6px">
        <div>
          <span style="font-size:13px;font-weight:600;color:var(--text)">${c.name}</span>
          <span style="font-size:10px;background:${siteColor}18;color:${siteColor};border-radius:3px;padding:1px 5px;margin-left:6px;font-weight:600">${c.site.includes('Penn')?'PNJ':'PHL'}</span>
        </div>
        <div style="text-align:right">
          <span style="font-size:13px;font-weight:700;color:var(--blue)">${c.upcoming}</span>
          <span style="font-size:10px;color:var(--muted)"> visits</span>
          <span style="font-size:11px;font-weight:600;color:${rateColor};margin-left:8px">${cancelRate}% cancel</span>
        </div>
      </div>
      <div style="height:6px;background:#e2e8f0;border-radius:3px;overflow:hidden">
        <div style="height:100%;width:${pct}%;background:${siteColor};border-radius:3px;transition:width .4s"></div>
      </div>
    </div>`;
  }).join('');
}

function buildInvestigatorList() {
  const el = document.getElementById('sched-inv-list');
  if (!el) return;
  const invs = DATA.investigators || [];
  if (!invs.length) { el.innerHTML = '<p style="color:#94a3b8;font-size:12px">No investigator data</p>'; return; }
  const maxUp = Math.max(...invs.map(i => i.upcoming || 0), 1);
  el.innerHTML = invs.map(inv => {
    const pct = Math.round((inv.upcoming||0) / maxUp * 100);
    const color = '#7c3aed';
    return `<div style="padding:8px 0;border-bottom:1px solid var(--border);cursor:pointer"
                 onclick="showInvDetail('${inv.name.replace(/'/g,"\\'")}')">
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:5px">
        <span style="font-size:13px;font-weight:600;color:var(--text)">${inv.name}</span>
        <div style="text-align:right">
          <span style="font-size:13px;font-weight:700;color:${color}">${inv.upcoming}</span>
          <span style="font-size:10px;color:var(--muted)"> visits</span>
          <span style="font-size:10px;color:#94a3b8;margin-left:6px">${inv.studyCount} studies</span>
        </div>
      </div>
      <div style="height:5px;background:#e2e8f0;border-radius:3px;overflow:hidden">
        <div style="height:100%;width:${pct}%;background:${color};border-radius:3px;transition:width .4s"></div>
      </div>
    </div>`;
  }).join('');
}

function showInvDetail(invName) {
  const upcoming = (DATA.allVisitDetail||[]).filter(r => r.investigator === invName);
  let body = '';
  if (upcoming.length) {
    body += `<h4 style="font-size:12px;font-weight:700;color:#475569;margin:0 0 8px;text-transform:uppercase;letter-spacing:.5px;">📆 Upcoming Visits (${upcoming.length})</h4>
    <table class="detail-table" style="margin-bottom:20px"><thead><tr>
      <th>Date</th><th>Patient</th><th>Study</th><th>Visit</th><th>Coordinator</th>
    </tr></thead><tbody>` +
    upcoming.map(r=>`<tr>
      <td style="font-weight:600;color:#1843ad;white-space:nowrap">${r.date}</td>
      <td>${patientLink(r.patient,r.patient_url)}</td>
      <td style="font-size:11px">${extLink(r.study,r.study_url)}</td>
      <td style="font-size:11px;color:#64748b">${r.visit}</td>
      <td style="font-size:11px">${r.coord}</td>
    </tr>`).join('') + `</tbody></table>`;
  }
  if (!body) body = '<p style="color:#94a3b8;padding:20px;text-align:center">No upcoming visits found</p>';
  openModal(invName, upcoming.length + ' upcoming visits', body);
}

// ══════════ COORDINATOR VISIT TRACKER ══════════
/** Convert a Date to local YYYY-MM-DD (avoids UTC shift from toISOString) */
function localISO(d) {
  return d.getFullYear() + '-' + String(d.getMonth()+1).padStart(2,'0') + '-' + String(d.getDate()).padStart(2,'0');
}

/**
 * Persist coordinator visit counts to localStorage so past days survive
 * after the CRIO feed drops them. Each day's count is snapshotted once
 * and never overwritten with a lower value (handles partial data loads).
 */
var COORD_SNAPSHOT_KEY = 'crp_coord_snapshot_v1';
var COORD_FILE_HISTORY = {};  // loaded from coord-history.json

function loadCoordSnapshot() {
  try {
    var raw = localStorage.getItem(COORD_SNAPSHOT_KEY);
    return raw ? JSON.parse(raw) : {};
  } catch(e) { return {}; }
}

function saveCoordSnapshot(snapshot) {
  try { localStorage.setItem(COORD_SNAPSHOT_KEY, JSON.stringify(snapshot)); } catch(e) {}
}

/**
 * Fetch coord-history.json (permanent historical record in the repo).
 * Runs once on load. Data is merged into COORD_FILE_HISTORY global.
 */
function fetchCoordHistory() {
  var url = (window.location.protocol === 'file:' ? '' : '') + 'coord-history.json?t=' + Date.now();
  return fetch(url).then(function(r) {
    if (!r.ok) throw new Error('HTTP ' + r.status);
    return r.json();
  }).then(function(json) {
    COORD_FILE_HISTORY = (json && json.data) ? json.data : {};
    console.log('[CoordHistory] Loaded ' + Object.keys(COORD_FILE_HISTORY).length + ' coordinators from file');
  }).catch(function(e) {
    console.warn('[CoordHistory] Could not load coord-history.json:', e.message);
    COORD_FILE_HISTORY = {};
  });
}

/**
 * Export current coordinator history as a downloadable JSON file.
 * The user can then commit this file to the repo to update the permanent record.
 */
function exportCoordHistory() {
  var snapshot = loadCoordSnapshot();
  var COORDS = CRP_CONFIG.COORDINATORS || [];
  var today = localISO(new Date());

  // Merge: file history + localStorage snapshot + live data → combined
  var combined = {};
  COORDS.forEach(function(name) {
    combined[name] = {};
    // Layer 1: file history baseline
    var fileData = COORD_FILE_HISTORY[name] || {};
    Object.keys(fileData).forEach(function(d) {
      if (d <= today) combined[name][d] = fileData[d];
    });
    // Layer 2: localStorage snapshot
    var snapData = snapshot[name] || {};
    Object.keys(snapData).forEach(function(d) {
      if (d <= today) combined[name][d] = Math.max(combined[name][d] || 0, snapData[d]);
    });
    // Layer 3: live data
    var goals = computeCoordGoals();
    var liveData = (goals.byDay && goals.byDay[name]) ? goals.byDay[name] : {};
    Object.keys(liveData).forEach(function(d) {
      if (d <= today && liveData[d] > 0) {
        combined[name][d] = Math.max(combined[name][d] || 0, liveData[d]);
      }
    });
    // Sort keys chronologically
    var sorted = {};
    Object.keys(combined[name]).sort().forEach(function(d) { sorted[d] = combined[name][d]; });
    combined[name] = sorted;
  });

  var output = {
    description: 'Coordinator visit history — persistent record updated periodically',
    lastUpdated: today,
    data: combined
  };

  var blob = new Blob([JSON.stringify(output, null, 2)], { type: 'application/json' });
  var a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = 'coord-history.json';
  a.click();
  URL.revokeObjectURL(a.href);
}

/**
 * Merge live coordinator goals data with persisted snapshot.
 * For each coordinator+date: keep the HIGHER count (handles partial loads).
 * Returns merged goals object and saves snapshot.
 */
function mergeCoordGoalsWithSnapshot(goals) {
  var snapshot = loadCoordSnapshot();
  var COORDS = CRP_CONFIG.COORDINATORS || [];
  var now = new Date();
  var monthStart = now.getFullYear() + '-' + String(now.getMonth()+1).padStart(2,'0') + '-01';

  // Prune snapshot entries older than 45 days
  var cutoff = new Date(now); cutoff.setDate(cutoff.getDate() - 45);
  var cutoffISO = localISO(cutoff);
  Object.keys(snapshot).forEach(function(name) {
    Object.keys(snapshot[name] || {}).forEach(function(d) {
      if (d < cutoffISO) delete snapshot[name][d];
    });
  });

  // Layer 1: Start with file-based history (coord-history.json) as baseline
  COORDS.forEach(function(name) {
    if (!snapshot[name]) snapshot[name] = {};
    var fileData = COORD_FILE_HISTORY[name] || {};
    Object.keys(fileData).forEach(function(d) {
      if (d < cutoffISO) return; // skip very old entries
      snapshot[name][d] = Math.max(snapshot[name][d] || 0, fileData[d] || 0);
    });
  });

  // Layer 2: Merge live data on top (keep higher count)
  COORDS.forEach(function(name) {
    if (!snapshot[name]) snapshot[name] = {};
    var liveByDay = (goals.byDay && goals.byDay[name]) ? goals.byDay[name] : {};
    Object.keys(liveByDay).forEach(function(d) {
      var liveCount = liveByDay[d] || 0;
      var snapCount = snapshot[name][d] || 0;
      snapshot[name][d] = Math.max(liveCount, snapCount);
    });
    // Write merged snapshot back into goals.byDay
    if (!goals.byDay) goals.byDay = {};
    if (!goals.byDay[name]) goals.byDay[name] = {};
    Object.keys(snapshot[name]).forEach(function(d) {
      if (!goals.byDay[name][d] || snapshot[name][d] > goals.byDay[name][d]) {
        goals.byDay[name][d] = snapshot[name][d];
      }
    });
    // Recompute monthly total from merged byDay
    var monthTotal = 0;
    Object.keys(goals.byDay[name]).forEach(function(d) {
      if (d >= monthStart && d <= monthStart.substring(0,7) + '-31') {
        monthTotal += goals.byDay[name][d];
      }
    });
    goals.byMonth[name] = monthTotal;
  });

  saveCoordSnapshot(snapshot);
  return goals;
}

function computeCoordGoals() {
  // Compute from allVisitDetail if coordGoals not pre-computed
  var COORDS = CRP_CONFIG.COORDINATORS || [];
  var COORD_LOWER = COORDS.map(function(c) { return c.toLowerCase(); });
  var goals = { byDay: {}, byMonth: {} };
  COORDS.forEach(function(c) { goals.byDay[c] = {}; goals.byMonth[c] = 0; });
  var seen = new Set();
  var visits = DATA.allVisitDetail || [];
  var now = new Date();
  var mm = String(now.getMonth()+1).padStart(2,'0');
  var yy = now.getFullYear();
  visits.forEach(function(r) {
    var rawName = r.coord || '';
    var date = r.date_iso || '';
    var patient = r.patient || '';
    var dayOfWeek = new Date(date + 'T12:00:00').getDay();
    if (dayOfWeek === 0 || dayOfWeek === 6) return;
    var idx = COORD_LOWER.indexOf(rawName.toLowerCase());
    if (idx === -1) return;
    var name = COORDS[idx];
    var key = name + '|' + date + '|' + patient;
    if (seen.has(key)) return;
    seen.add(key);
    goals.byDay[name][date] = (goals.byDay[name][date]||0) + 1;
    if (date >= yy+'-'+mm+'-01' && date <= yy+'-'+mm+'-31') goals.byMonth[name]++;
  });
  return goals;
}

function renderCoordinatorGoals() {
  var goals = DATA.coordGoals || computeCoordGoals();
  // Merge with localStorage snapshot so past days are preserved
  goals = mergeCoordGoalsWithSnapshot(goals);
  if (!goals) return;
  const COORDS = CRP_CONFIG.COORDINATORS || [];
  const DAILY_GOAL = CRP_CONFIG.COORD_DAILY_GOAL || 2;
  const grid = document.getElementById('coordGoalsGrid');
  const monthBody = document.getElementById('coordMonthBody');
  if (!grid) return;

  const now = new Date();
  const todayISO = localISO(now);
  // Get this week Mon-Fri
  const dayOfWeek = now.getDay(); // 0=Sun, 1=Mon...
  const mondayOffset = dayOfWeek === 0 ? -6 : 1 - dayOfWeek;
  const monday = new Date(now); monday.setDate(now.getDate() + mondayOffset);
  const weekDays = [];
  for (let i = 0; i < 5; i++) {
    const d = new Date(monday); d.setDate(monday.getDate() + i);
    weekDays.push(localISO(d));
  }
  const dayLabels = ['Mon','Tue','Wed','Thu','Fri'];

  const weekLabel = document.getElementById('coord-week-label');
  if (weekLabel) weekLabel.textContent = 'Week of ' + monday.toLocaleDateString('en-US',{month:'short',day:'numeric'});

  const monthLabel = document.getElementById('coord-month-label');
  if (monthLabel) monthLabel.textContent = now.toLocaleDateString('en-US',{month:'long',year:'numeric'});

  // Working days elapsed this month
  let workDaysElapsed = 0, workDaysTotal = 0;
  const mm = now.getMonth(), yy = now.getFullYear();
  for (let d = 1; d <= 31; d++) {
    const dt = new Date(yy, mm, d);
    if (dt.getMonth() !== mm) break;
    if (dt.getDay() > 0 && dt.getDay() < 6) {
      workDaysTotal++;
      if (dt <= now) workDaysElapsed++;
    }
  }

  // Build coordinator cards — snapshot of actual visit counts
  // Find the max daily visits across all coordinators this week for relative bar scaling
  var weekMax = 1;
  COORDS.forEach(function(name) {
    var byDay = goals.byDay[name] || {};
    weekDays.forEach(function(d) { var v = byDay[d] || 0; if (v > weekMax) weekMax = v; });
  });

  grid.innerHTML = COORDS.map(name => {
    const byDay = goals.byDay[name] || {};
    const weekTotal = weekDays.reduce((s,d) => s + (byDay[d]||0), 0);

    const detail = goals.byDayDetail ? (goals.byDayDetail[name] || {}) : {};
    const dayBars = weekDays.map((d,i) => {
      const visits = byDay[d] || 0;
      const isToday = d === todayISO;
      const isPast = d < todayISO;
      const barColor = !isPast && !isToday ? '#E5E7EB' : visits > 0 ? '#1843AD' : '#E5E7EB';
      const barH = Math.min(100, Math.round((visits / (weekMax * 1.2)) * 100));
      const hasVisits = visits > 0 && (isPast || isToday);
      const cursor = hasVisits ? 'cursor:pointer;' : '';
      const clickAttr = hasVisits ? `onclick="toggleCoordDayDetail('${name}','${d}',this)"` : '';
      return `<div style="text-align:center;flex:1;${cursor}position:relative" ${clickAttr}>
        <div style="height:40px;display:flex;align-items:flex-end;justify-content:center">
          <div style="width:18px;height:${isPast || isToday ? Math.max(4,barH) : 4}%;background:${barColor};border-radius:3px 3px 0 0;transition:height 0.3s"></div>
        </div>
        <div style="font-size:10px;font-weight:${isToday?'700':'500'};color:${isToday?'#1843AD':'#9CA3AF'};margin-top:2px">${dayLabels[i]}</div>
        <div style="font-size:11px;font-weight:700;color:${isPast || isToday && visits > 0 ? '#1a202c' : '#D1D5DB'}">${visits}</div>
      </div>`;
    }).join('');

    const firstName = name.split(' ')[0];
    return `<div style="background:#F9FAFB;border-radius:10px;padding:14px;border:1px solid #E5E7EB">
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px">
        <span style="font-weight:700;font-size:13px;color:#1a202c">${firstName}</span>
        <span style="font-size:12px;font-weight:700;color:#1843AD">${weekTotal} this week</span>
      </div>
      <div style="display:flex;gap:4px;margin-bottom:8px">${dayBars}</div>
      <div class="coord-day-detail" data-coord="${name}" style="display:none;margin-bottom:8px;background:#fff;border:1px solid #E5E7EB;border-radius:6px;padding:8px;font-size:11px"></div>
    </div>`;
  }).join('');

  // Monthly summary table — snapshot of actual counts
  if (!monthBody) return;
  var monthMax = 1;
  COORDS.forEach(function(name) { var v = goals.byMonth[name] || 0; if (v > monthMax) monthMax = v; });
  var avgPerDay = {};
  COORDS.forEach(function(name) { avgPerDay[name] = workDaysElapsed > 0 ? (goals.byMonth[name] || 0) / workDaysElapsed : 0; });

  monthBody.innerHTML = COORDS.map(name => {
    const monthVisits = goals.byMonth[name] || 0;
    const barPct = Math.min(100, Math.round(monthVisits / (monthMax * 1.1) * 100));
    const avg = avgPerDay[name].toFixed(1);
    return `<tr style="border-bottom:1px solid var(--border)">
      <td style="padding:8px 12px;font-weight:600">${name}</td>
      <td style="padding:8px 8px;text-align:center;font-weight:700">${monthVisits}</td>
      <td style="padding:8px 8px;text-align:center;color:#6B7280">${avg}/day</td>
      <td style="padding:8px 12px"><div style="background:#E5E7EB;border-radius:6px;height:8px;overflow:hidden"><div style="background:#1843AD;height:100%;width:${barPct}%;border-radius:6px"></div></div></td>
      <td style="padding:8px 8px;text-align:center;color:#6B7280;font-size:11px">${workDaysElapsed} days tracked</td>
    </tr>`;
  }).join('');
}

function toggleCoordDayDetail(coordName, date, el) {
  const card = el.closest('.coord-day-detail')?.parentElement || el.closest('[style*="background:#F9FAFB"]');
  if (!card) return;
  const detailDiv = card.querySelector('.coord-day-detail');
  if (!detailDiv) return;
  const goals = DATA.coordGoals || {};
  const visits = goals.byDayDetail && goals.byDayDetail[coordName] && goals.byDayDetail[coordName][date];
  // Toggle: if already showing this date, hide it
  if (detailDiv.style.display !== 'none' && detailDiv.dataset.activeDate === date) {
    detailDiv.style.display = 'none';
    detailDiv.dataset.activeDate = '';
    return;
  }
  if (!visits || visits.length === 0) { detailDiv.style.display = 'none'; return; }
  const dayLabel = new Date(date + 'T12:00:00').toLocaleDateString('en-US',{weekday:'short',month:'short',day:'numeric'});
  const rows = visits.map(v => {
    const pLink = v.url ? `<a href="${v.url}" target="_blank" style="color:#1843AD;text-decoration:none;font-weight:600">${maskPHI(v.patient)}</a>` : `<span style="font-weight:600">${maskPHI(v.patient)}</span>`;
    return `<div style="display:flex;justify-content:space-between;align-items:center;padding:3px 0;border-bottom:1px solid #F3F4F6">
      ${pLink}<span style="color:#6B7280;font-size:10px;max-width:50%;text-align:right;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${v.study}</span>
    </div>`;
  }).join('');
  detailDiv.innerHTML = `<div style="font-weight:700;color:#374151;margin-bottom:4px;font-size:11px">${dayLabel} — ${visits.length} visit${visits.length>1?'s':''}</div>${rows}`;
  detailDiv.style.display = 'block';
  detailDiv.dataset.activeDate = date;
}

function buildInsights() {
  const flags    = DATA.riskFlags || [];
  const cancels  = DATA.cancelByStudy || [];
  const upcoming = DATA.upcomingByStudyFull || DATA.upcomingByStudy || [];
  const detail   = DATA.next14Detail || [];

  // ── Flags (warnings) ──
  const flagEl = document.getElementById('perf-insight-flags');
  if (!flagEl) return;

  const today = new Date();
  const flagItems = [];

  // Risk flag patients — urgent ones first
  flags.forEach(f => {
    const parts = f.next_visit.split(' ');
    const mMap = {Jan:0,Feb:1,Mar:2,Apr:3,May:4,Jun:5,Jul:6,Aug:7,Sep:8,Oct:9,Nov:10,Dec:11};
    const visitDate = new Date(2026, mMap[parts[0]], parseInt(parts[1]));
    const daysOut = Math.round((visitDate - today) / 86400000);
    const urgent = daysOut <= 14;
    const pLink = f.patient_url
      ? `<a href="${f.patient_url}" target="_blank" rel="noopener" onclick="event.stopPropagation()" style="color:inherit;font-weight:700;text-decoration:underline;text-decoration-style:dotted;">${maskPHI(f.patient)}</a>`
      : `<strong>${maskPHI(f.patient)}</strong>`;
    const sLink = f.study_url
      ? `<a href="${f.study_url}" target="_blank" rel="noopener" onclick="event.stopPropagation()" style="color:inherit;text-decoration:underline;text-decoration-style:dotted;">${f.study}</a>`
      : f.study;
    flagItems.push({
      urgent,
      html: `<div class="insight-item ${urgent ? 'danger' : 'warning'}">
        <span class="insight-icon">${urgent ? '🔴' : '⚠️'}</span>
        <div>
          <div class="insight-title">${pLink} — ${f.cancels}× cancelled</div>
          <div class="insight-desc">${sLink} · Next visit: <strong>${f.next_visit}</strong>${urgent ? ' <span style="color:#dc2626;font-weight:700;">— CALL NOW</span>' : ''}</div>
        </div>
      </div>`
    });
  });

  // High cancel studies
  cancels.filter(c => c.count >= 15).forEach(c => {
    const sLink = c.study_url
      ? `<a href="${c.study_url}" target="_blank" rel="noopener" onclick="event.stopPropagation()" style="color:inherit;font-weight:700;text-decoration:underline;text-decoration-style:dotted;">${c.name}</a>`
      : `<strong>${c.name}</strong>`;
    flagItems.push({
      urgent: false,
      html: `<div class="insight-item warning">
        <span class="insight-icon">📉</span>
        <div>
          <div class="insight-title">${sLink} — high cancellation volume</div>
          <div class="insight-desc">${c.count} cancelled visits in last 2 months · Review retention strategy</div>
        </div>
      </div>`
    });
  });

  // Upcoming visits this week with no-show history
  const thisWeek = detail.filter(d => {
    const parts = d.date.split(' ');
    const mMap = {Jan:0,Feb:1,Mar:2,Apr:3,May:4,Jun:5,Jul:6,Aug:7,Sep:8,Oct:9,Nov:10,Dec:11};
    const daysOut = Math.round((new Date(2026, mMap[parts[0]], parseInt(parts[1])) - today) / 86400000);
    return daysOut <= 7;
  });
  if (thisWeek.length > 0) {
    // Deduplicate patient names for display
    const seenPats = new Set();
    const uniqueThisWeek = thisWeek.filter(d => {
      const key = d.patient.toLowerCase().trim();
      if (seenPats.has(key)) return false;
      seenPats.add(key);
      return true;
    });
    flagItems.push({
      urgent: false,
      html: `<div class="insight-item warning">
        <span class="insight-icon">📅</span>
        <div>
          <div class="insight-title">${thisWeek.length} visits scheduled this week (${uniqueThisWeek.length} patients)</div>
          <div class="insight-desc">Confirm attendance — ${uniqueThisWeek.slice(0, 15).map(d => {
            var label = PHI_MASKED ? maskPHI(d.patient) : d.patient.split(' ')[0];
            return d.patient_url
              ? `<a href="${d.patient_url}" target="_blank" rel="noopener" onclick="event.stopPropagation()" style="color:inherit;text-decoration:underline;text-decoration-style:dotted;">${label}</a>`
              : label;
          }).join(', ')}${uniqueThisWeek.length > 15 ? ' +' + (uniqueThisWeek.length - 15) + ' more' : ''}</div>
        </div>
      </div>`
    });
  }

  // Cross-source: referrals without med records
  var refsNoMR = findReferralsWithoutMedRecords();
  if (refsNoMR.length > 0) {
    flagItems.push({
      urgent: false,
      html: `<div class="insight-item warning"><span class="insight-icon">📋</span><div>
        <div class="insight-title">${refsNoMR.length} active referrals have no medical records entry</div>
        <div class="insight-desc">Create medical records entries for these referrals to track their intake progress</div>
      </div></div>`
    });
  }

  // Cross-source: ready to schedule but no visit
  var readyNV = findReadyNoVisit();
  if (readyNV.length > 0) {
    flagItems.push({
      urgent: readyNV.length >= 3,
      html: `<div class="insight-item ${readyNV.length >= 3 ? 'danger' : 'warning'}"><span class="insight-icon">📅</span><div>
        <div class="insight-title">${readyNV.length} patient${readyNV.length>1?'s':''} ready to schedule but no upcoming visit</div>
        <div class="insight-desc">${readyNV.slice(0,3).map(r => maskPHI(r.name)).join(', ')}${readyNV.length>3 ? ' +' + (readyNV.length-3) + ' more' : ''} — schedule appointments now</div>
      </div></div>`
    });
  }

  // Cross-source: stale referrals
  var staleRefs = REFERRAL_DATA ? REFERRAL_DATA.filter(function(r) { return !r.is_closed && r.days_since_update >= 14; }).length : 0;
  if (staleRefs > 0) {
    flagItems.push({
      urgent: false,
      html: `<div class="insight-item warning"><span class="insight-icon">⏰</span><div>
        <div class="insight-title">${staleRefs} referrals stale for 14+ days</div>
        <div class="insight-desc">Review and update stale leads in the referral pipeline to prevent drop-off</div>
      </div></div>`
    });
  }

  // Sort urgent first
  flagItems.sort((a, b) => (b.urgent ? 1 : 0) - (a.urgent ? 1 : 0));
  flagEl.innerHTML = flagItems.length > 0 ? flagItems.map(f => f.html).join('') :
    '<div class="insight-item positive"><span class="insight-icon">✅</span><div><div class="insight-title">No critical flags</div></div></div>';

  // ── Positives ──
  const posEl = document.getElementById('perf-insight-positive');
  if (!posEl) return;

  const posItems = [];
  const cancelRate = Math.round(DATA.cancelTotal / (DATA.cancelTotal + DATA.upcomingTotal) * 100);
  if (cancelRate < 30) {
    posItems.push(`<div class="insight-item positive"><span class="insight-icon">📈</span><div>
      <div class="insight-title">Cancel rate at ${cancelRate}% — within target range</div>
      <div class="insight-desc">Retention is tracking well across active studies</div>
    </div></div>`);
  }

  const pnjStudies = upcoming.filter(s => (s.site||'').includes('Penn'));
  if (pnjStudies.length > 0) {
    const pnjTotal = pnjStudies.reduce((a,b) => a + b.count, 0);
    posItems.push(`<div class="insight-item positive"><span class="insight-icon">🏥</span><div>
      <div class="insight-title">Pennington pipeline strong — ${pnjTotal} upcoming visits</div>
      <div class="insight-desc">Across ${pnjStudies.length} active studies at PNJ</div>
    </div></div>`);
  }

  const highUp = upcoming.filter(s => s.count >= 15);
  highUp.forEach(s => {
    const sLink = s.study_url
      ? `<a href="${s.study_url}" target="_blank" rel="noopener" onclick="event.stopPropagation()" style="color:inherit;font-weight:700;text-decoration:underline;text-decoration-style:dotted;">${s.name}</a>`
      : `<strong>${s.name}</strong>`;
    posItems.push(`<div class="insight-item positive"><span class="insight-icon">⭐</span><div>
      <div class="insight-title">${sLink} — ${s.count} upcoming visits</div>
      <div class="insight-desc">Strong retention and scheduling momentum</div>
    </div></div>`);
  });

  // Cross-source: referral pipeline enrolled
  var enrolledRefs = REFERRAL_DATA ? REFERRAL_DATA.filter(function(r){ return r.stage === 'Enrolled' || r.stage === 'Screened'; }).length : 0;
  if (enrolledRefs > 0) {
    posItems.push(`<div class="insight-item positive"><span class="insight-icon">🎯</span><div>
      <div class="insight-title">${enrolledRefs} patients enrolled via referral pipeline</div>
      <div class="insight-desc">From ${REFERRAL_DATA.length} total referrals — ${REFERRAL_DATA.length > 0 ? Math.round(enrolledRefs/REFERRAL_DATA.length*100) : 0}% conversion rate</div>
    </div></div>`);
  }

  // Cross-source: medical records flowing
  var medActive = MED_RECORDS_DATA ? MED_RECORDS_DATA.filter(function(r){ return r.is_active; }).length : 0;
  if (medActive > 0) {
    posItems.push(`<div class="insight-item positive"><span class="insight-icon">🏥</span><div>
      <div class="insight-title">${medActive} patients active in medical records pipeline</div>
      <div class="insight-desc">Across ${MED_RECORDS_DATA.reduce(function(s,r){ s.add(r.study); return s; }, new Set()).size} studies — records intake tracking active</div>
    </div></div>`);
  }

  // Cross-source: campaign activity
  var campActive = CAMPAIGN_DATA ? CAMPAIGN_DATA.filter(function(c){ return c.first_contact > 0; }).length : 0;
  if (campActive > 0) {
    posItems.push(`<div class="insight-item positive"><span class="insight-icon">📣</span><div>
      <div class="insight-title">${campActive} active campaigns driving referrals</div>
      <div class="insight-desc">${FB_CRM_DATA.length > 0 ? FB_CRM_DATA.length + ' FB leads captured' : ''}</div>
    </div></div>`);
  }

  posEl.innerHTML = posItems.length > 0 ? posItems.join('') :
    '<div class="insight-item"><span class="insight-icon">📊</span><div><div class="insight-title">Connect live data to see trend insights</div></div></div>';
}

function buildRiskTable() {
  const tbody = document.getElementById('risk-tbody');
  tbody.innerHTML = DATA.riskMatrix.map(r => {
    const levelClass = r.level === 'critical' ? 'risk-critical' : r.level === 'high' ? 'risk-high' : r.level === 'medium' ? 'risk-medium' : 'risk-low';
    const levelLabel = r.level === 'critical' ? 'CRITICAL' : r.level === 'high' ? 'HIGH' : r.level === 'medium' ? 'MEDIUM' : 'LOW';
    const barColor = r.level === 'critical' ? '#dc2626' : r.level === 'high' ? '#d97706' : r.level === 'medium' ? '#f97316' : '#059669';
    const barPct = Math.min((r.score / 8 * 100), 100).toFixed(0);
    return `<tr style="cursor:pointer;" onclick="showStudyDetail('${r.study||r.name}','${r.study_url||''}')"><td style="font-weight:500;color:var(--text)">${r.study_url ? `<a href="${r.study_url}" target="_blank" rel="noopener" onclick="event.stopPropagation()" style="text-decoration:none;font-weight:500;color:var(--text);">${r.study}<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" style="margin-left:3px;opacity:0.45;vertical-align:middle;flex-shrink:0"><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/><polyline points="15 3 21 3 21 9"/><line x1="10" y1="14" x2="21" y2="3"/></svg></a>` : r.study}</td>
      <td><span class="risk-tag ${levelClass}">${levelLabel}</span></td>
      <td style="color:var(--red);font-weight:600;">${r.cancel}</td>
      <td style="color:var(--blue);font-weight:600;">${r.upcoming}</td>
      <td style="font-size:12px;font-weight:700;color:${(r.cancels||0)>=10?'var(--red)':(r.cancels||0)>=5?'var(--orange)':'var(--muted)'}">${r.cancels||0}</td>
      <td>
        <div class="risk-bar-wrap"><div class="risk-bar" style="width:${barPct}%;background:${barColor};"></div></div>
        <span style="font-size:11px;font-weight:600;">${r.score.toFixed(2)}</span>
      </td>
      <td style="font-size:11px;color:var(--muted);">${r.action}</td>
    </tr>`;
  }).join('');
}

function buildStudyCards() {
  const el = document.getElementById('study-cards');
  if (!el) return;
  const levelColor = { critical:'#dc2626', high:'#d97706', medium:'#f97316', low:'#059669' };
  const levelBg    = { critical:'#fee2e2', high:'#fff3e0', medium:'#ffedd5', low:'#dcfce7' };
  el.innerHTML = DATA.riskMatrix.map(r => {
    const lc = levelColor[r.level] || '#94a3b8';
    const lb = levelBg[r.level]   || '#f1f5f9';
    return `<div class="study-card" onclick="showStudyDetail('${r.study||r.name}','${r.study_url||''}');" style="cursor:pointer;border:1px solid ${lc}30;border-radius:10px;padding:14px 16px;background:#fff;">
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px;">
        <span style="font-weight:700;font-size:13px;color:var(--text)">${r.study}</span>
        <span style="font-size:10px;font-weight:700;padding:2px 8px;border-radius:4px;background:${lb};color:${lc}">${r.level.toUpperCase()}</span>
      </div>
      <div style="display:flex;gap:16px;font-size:12px;">
        <span style="color:var(--red)">✗ ${r.cancel} cancels</span>
        <span style="color:#1843ad">↑ ${r.upcoming} upcoming</span>
        <span style="color:var(--muted)">score: ${r.score.toFixed(1)}</span>
      </div>
      <div style="font-size:11px;color:var(--muted);margin-top:6px">${r.action}</div>
    </div>`;
  }).join('');
}

// ═══════════════════════════════════════════════════
// VIEW SWITCHING
// ═══════════════════════════════════════════════════
function switchView(name, el) {
  if (name === 'actions') {
    setTimeout(() => buildRiskFlagCards(), 50);
  }
  // Trends tab: show charts if data already loaded
  if (name === 'studies') {
    setTimeout(() => buildStudiesView(), 50);
  }
  if (name === 'admin') {
    setTimeout(() => switchAdmin('trends', document.querySelector('#admin-filter-bar .sched-filter')), 50);
  }
  if (name === 'referrals') {
    setTimeout(() => initReferrals(), 50);
  }
  if (name === 'trends' && typeof LONGITUDINAL !== 'undefined' && LONGITUDINAL) {
    setTimeout(() => renderTrendsCharts(), 50);
  }
  // Hide ALL views including finance + insights
  document.querySelectorAll('.view, [id^="view-fin-"], #view-insights').forEach(v => {
    v.style.display = 'none';
    v.classList.remove('active');
  });
  document.querySelectorAll('.nav-tab').forEach(t => t.classList.remove('active'));
  const targetView = document.getElementById('view-' + name);
  if (targetView) {
    targetView.style.display = 'block';
    targetView.classList.add('active');
  }
  if (el) el.classList.add('active');

  // Build charts lazily for schedule view
  if (name === 'schedule') {
    setTimeout(() => {
      safe(buildWeeklyBySiteChart,   'wkChart');
      safe(buildVisitTypeChart,      'visitChart');
      safe(buildStatusChart,         'statusChart');
      safe(buildStatusLegend,        'statusLegend');
      safe(buildSchedStudyBars,      'schedBars');
      safe(buildSchedCoordList,      'schedCoord');
      safe(() => filterSchedTable('all', document.querySelector('.filter-btn.active')), 'schedTable');
      // KPIs
      const d = DATA;
      const sk = (id, v) => { const e = document.getElementById(id); if(e && v != null) e.textContent = v; };
      sk('sched-kpi-philly', d.phillyTotal);
      sk('sched-kpi-penn',   d.pennTotal);
      sk('sched-kpi-march',  d.marchTotal);
      sk('sched-kpi-april',  d.aprilTotal);
      sk('sched-kpi-total',  d.upcomingTotal);
      sk('sched-count', (d.allVisitDetail || d.next14Detail || []).length + ' visits');
    }, 50);
  }
}

function filterTable(filter, btn) {
  document.querySelectorAll('.filter-btn').forEach(b => b.classList.remove('active'));
  btn.classList.add('active');
  buildUpcomingTable(filter);
}

// ═══════════════════════════════════════════════════
// GOOGLE SHEETS INTEGRATION
// ═══════════════════════════════════════════════════

// Detect Apps Script environment (google.script.run available)
var IS_APPS_SCRIPT = (typeof google !== 'undefined' && google.script && google.script.run);

/**
 * Fetch text from a URL. In Apps Script, uses server-side proxy to bypass
 * iframe CSP restrictions. On GitHub Pages, uses native fetch.
 */
async function fetchText(url) {
  if (IS_APPS_SCRIPT) {
    return new Promise(function(resolve, reject) {
      google.script.run
        .withSuccessHandler(function(result) {
          if (result.error) reject(new Error(result.error));
          else if (result.status !== 200) reject(new Error('HTTP ' + result.status));
          else resolve(result.text);
        })
        .withFailureHandler(function(err) { reject(err); })
        .proxyFetch(url);
    });
  } else {
    const bustUrl = url + (url.includes('?') ? '&' : '?') + '_cb=' + Date.now();
    const resp = await fetch(bustUrl, { cache: 'no-store' });
    if (!resp.ok) throw new Error('HTTP ' + resp.status + ' fetching: ' + url.slice(0, 80));
    return resp.text();
  }
}

async function fetchCSV(url) {
  const text = await fetchText(url);
  // Guard: Google Sheets sometimes returns an HTML error/captcha page with 200 status
  const trimmed = text.trimStart();
  if (trimmed.startsWith('<!') || trimmed.startsWith('<html') || trimmed.startsWith('<HTML')) {
    throw new Error('Received HTML instead of CSV (likely rate-limited) from: ' + url.slice(0, 80));
  }
  if (!trimmed || trimmed.length < 20) {
    throw new Error('Empty or invalid CSV response from: ' + url.slice(0, 80));
  }
  return parseCSV(text);
}

function parseCSV(text) {
  const lines = text.trim().split('\n');
  const headers = lines[0].split(',').map(h => h.replace(/^"|"$/g, '').trim());
  return lines.slice(1).map(line => {
    // Handle quoted commas
    const vals = [];
    let cur = '', inQ = false;
    for (let c of line) {
      if (c === '"') inQ = !inQ;
      else if (c === ',' && !inQ) { vals.push(cur.trim()); cur = ''; }
      else cur += c;
    }
    vals.push(cur.trim());
    const obj = {};
    headers.forEach((h, i) => obj[h] = vals[i] || '');
    return obj;
  });
}

// ═══════════════════════════════════════════════════
// LIVE FINANCE DATA — Auto-fetch from CRP Finance Master Sheet
// ═══════════════════════════════════════════════════
async function fetchFinanceTab(pubKey, gid) {
  const url = `https://docs.google.com/spreadsheets/d/e/${pubKey}/pub?gid=${gid}&single=true&output=csv&_cb=${Date.now()}`;
  const text = await fetchText(url);
  // Guard: reject HTML error pages from Google Sheets rate-limiting
  const trimmed = text.trimStart();
  if (trimmed.startsWith('<!') || trimmed.startsWith('<html') || trimmed.startsWith('<HTML')) {
    throw new Error('Received HTML instead of CSV for finance tab gid=' + gid);
  }
  return parseCSV(text);
}

function num(v) { const n = parseFloat(v); return isNaN(n) ? 0 : n; }

function parseAgingCSV(rows) {
  // CSV has duplicate empty-string header keys, so use r['Age Tier'] for study name
  // Filter: skip "Study Name" subheader row, skip Grand Total (study name is purely numeric)
  return rows.filter(r => {
    const s = (r['Age Tier'] || '').trim();
    return s && s.toLowerCase() !== 'study name' && s.toLowerCase() !== 'grand total' && !/^\d[\d,.]*$/.test(s);
  }).map(r => ({
    study: (r['Age Tier'] || '').trim(),
    current: num(r['1. Current']),
    d30_60: num(r['2. 30-60']),
    d61_90: num(r['3. 61-90']),
    d91_120: num(r['4. 91-120']),
    d121_150: num(r['5. 121-150']),
    d150plus: num(r['6. >150'])
  })).filter(r => r.study);
}

function parseUnpaidInvCSV(rows) {
  // Headers: [empty, Study Name, Invoice Number, Due Date, Sent Date, Days Overdue, Amount, Amount Paid, Amount Unpaid]
  return rows.filter(r => {
    const s = (r['Study Name'] || '').trim();
    return s && s.toLowerCase() !== 'study name';
  }).map(r => ({
    study: (r['Study Name'] || '').trim(),
    invoice: (r['Invoice Number'] || '').trim(),
    due: (r['Due Date'] || '').trim() || null,
    days: parseInt(r['Days Overdue'] || 0) || 0,
    amount: num(r['Amount']),
    unpaid: num(r['Amount Unpaid'])
  })).filter(r => r.study);
}

function parseUnpaidApCSV(rows) {
  // Headers: [empty, Study Name, Visit Number and Name, Subject ID, Visit Date, Revenue Type, Amount Upfront, Days Unpaid]
  const studies = {};
  rows.filter(r => {
    const s = (r['Study Name'] || '').trim();
    return s && s.toLowerCase() !== 'study name';
  }).forEach(r => {
    const study = (r['Study Name'] || '').trim();
    const revType = (r['Revenue Type'] || '').toLowerCase();
    const amount = num(r['Amount Upfront']);
    if (!studies[study]) studies[study] = { study, total: 0, visits: 0, procs: 0 };
    studies[study].total += amount;
    if (revType.includes('visit')) studies[study].visits += amount;
    else studies[study].procs += amount;
  });
  return Object.values(studies).sort((a, b) => b.total - a.total).map(s => ({
    study: s.study, total: Math.round(s.total * 100) / 100,
    visits: Math.round(s.visits * 100) / 100, procs: Math.round(s.procs * 100) / 100
  }));
}

function parseUninvoicedCSV(rows) {
  // Headers: [empty, Study Name, Name, Frequency Type, Amount Remaining]
  const studies = {};
  rows.filter(r => {
    const s = (r['Study Name'] || '').trim();
    return s && s.toLowerCase() !== 'study name';
  }).forEach(r => {
    const study = (r['Study Name'] || '').trim();
    const amount = num(r['Amount Remaining']);
    studies[study] = (studies[study] || 0) + amount;
  });
  return Object.entries(studies).filter(([, a]) => a > 0)
    .sort((a, b) => b[1] - a[1])
    .map(([study, amount]) => ({ study, amount: Math.round(amount * 100) / 100 }));
}

function parseRevenueCSV(rows) {
  // Headers: [empty, Revenue Group ID, Site Name, Study Name, Subject Patient ID, Subject Status, Revenue Payment Type, Revenue Type, Item, Service Date, Invoice Sent Date, Invoice Number, Type, Amount, ...]
  const months = {};
  rows.filter(r => {
    const s = (r['Study Name'] || '').trim();
    return s && s.toLowerCase() !== 'study name';
  }).forEach(r => {
    const dateStr = r['Service Date'] || '';
    if (!dateStr) return;
    const d = new Date(dateStr);
    if (isNaN(d)) return;
    const mk = d.toLocaleDateString('en-US', { month: 'short', year: '2-digit' }).replace(' ', " '");
    const payType = (r['Revenue Payment Type'] || '').toLowerCase();
    const amount = num(r['Amount']);
    if (!months[mk]) months[mk] = { autopay: 0, procedures: 0, invoicables: 0, sort: d };
    if (payType.includes('autopay') || payType.includes('auto')) months[mk].autopay += amount;
    else if (payType.includes('invoice')) months[mk].invoicables += amount;
    else months[mk].procedures += amount;
  });
  return Object.entries(months).sort((a, b) => a[1].sort - b[1].sort).map(([mk, m]) => ({
    month: mk, autopay: Math.round(m.autopay), procedures: Math.round(m.procedures), invoicables: Math.round(m.invoicables)
  }));
}

function parseStudyRevenue12mCSV(rows) {
  const studies = {};
  rows.filter(r => {
    const s = (r['Study Name'] || '').trim();
    return s && s.toLowerCase() !== 'study name';
  }).forEach(r => {
    const full = (r['Study Name'] || '').trim();
    const parts = full.split(' - ');
    const code = parts.length > 1 ? parts[parts.length - 1] : full;
    const amount = num(r['Amount']);
    studies[code] = (studies[code] || 0) + amount;
  });
  const result = {};
  Object.entries(studies).sort((a, b) => b[1] - a[1]).forEach(([k, v]) => result[k] = Math.round(v));
  return result;
}

function parsePaymentsCSV(rows) {
  // Headers: [empty, Study Name, Payment Type, Payment Number, Received Date, Amount, ...]
  const months = {};
  const monthOrder = [];
  rows.filter(r => {
    const s = (r['Study Name'] || '').trim();
    return s && s.toLowerCase() !== 'study name';
  }).forEach(r => {
    const dateStr = r['Received Date'] || '';
    if (!dateStr) return;
    const d = new Date(dateStr);
    if (isNaN(d)) return;
    const mk = d.toLocaleDateString('en-US', { month: 'short', year: '2-digit' }).replace(' ', " '");
    const amount = num(r['Amount']);
    if (!months[mk]) { months[mk] = 0; monthOrder.push({ month: mk, sort: d }); }
    months[mk] += amount;
  });
  monthOrder.sort((a, b) => a.sort - b.sort);
  return monthOrder.map(m => ({ month: m.month, amount: Math.round(months[m.month] * 100) / 100 }));
}

// ══════════ ENHANCED PARSERS ══════════

function parseRevenueByTypeCSV(rows) {
  const byType = {};
  const byPayType = {};
  const items = {};
  rows.filter(r => {
    const s = (r['Study Name'] || '').trim();
    return s && s.toLowerCase() !== 'study name';
  }).forEach(r => {
    const revType = (r['Revenue Type'] || '').trim();
    const payType = (r['Revenue Payment Type'] || '').trim();
    const item = (r['Item'] || '').trim();
    const amount = num(r['Amount']);
    if (revType) { byType[revType] = (byType[revType] || 0) + amount; }
    if (payType) { byPayType[payType] = (byPayType[payType] || 0) + amount; }
    if (item) {
      if (!items[item]) items[item] = { amount: 0, count: 0 };
      items[item].amount += amount;
      items[item].count++;
    }
  });
  // Group items into collapsed categories
  const ITEM_CAT_MAP = {
    'screen': 'Screening Visits', 'scrn': 'Screening Visits', 'prescreening': 'Pre-Screening',
    'treatment': 'Treatment Visits', 'infusion': 'Treatment Visits',
    'unscheduled': 'Unscheduled Visits', 'early term': 'Early Termination',
    'start-up': 'Start-Up / Site Fees', 'start up': 'Start-Up / Site Fees', 'site prep': 'Start-Up / Site Fees', 'initiation': 'Start-Up / Site Fees',
    'close-out': 'Close-Out Fees', 'close out': 'Close-Out Fees', 'closeout': 'Close-Out Fees',
    'follow-up': 'Follow-Up Visits', 'follow up': 'Follow-Up Visits',
  };
  function categorizeItem(name) {
    const lower = name.toLowerCase();
    // Treatment: any "V[N]-Treatment" or "Treatment" keyword
    if (/v\d+.*treatment|treatment.*v\d+|treatment/i.test(lower)) return 'Treatment Visits';
    for (const [key, cat] of Object.entries(ITEM_CAT_MAP)) {
      if (lower.includes(key)) return cat;
    }
    // Numbered visits that aren't screening or treatment → classify by pattern
    if (/^visit\s+\d/i.test(lower) && !lower.includes('screen') && !lower.includes('treatment')) return 'Other Study Visits';
    return 'Other';
  }
  const grouped = {};
  Object.entries(items).forEach(([item, d]) => {
    const cat = categorizeItem(item);
    if (!grouped[cat]) grouped[cat] = { amount: 0, count: 0 };
    grouped[cat].amount += d.amount;
    grouped[cat].count += d.count;
  });

  return {
    byType: Object.entries(byType).filter(([,a]) => a > 0).sort((a, b) => b[1] - a[1]).map(([type, amount]) => ({ type, amount: Math.round(amount) })),
    byPayType: Object.entries(byPayType).filter(([,a]) => a > 0).sort((a, b) => b[1] - a[1]).map(([type, amount]) => ({ type, amount: Math.round(amount) })),
    topItems: Object.entries(grouped).sort((a, b) => b[1].amount - a[1].amount).map(([item, d]) => ({ item, amount: Math.round(d.amount), count: d.count })),
  };
}

function parseUninvoicedDetailCSV(rows) {
  const CATEGORY_MAP = {
    'start-up': 'Start-Up Fees', 'start up': 'Start-Up Fees', 'site start': 'Start-Up Fees', 'accelerated': 'Start-Up Fees', 'site prep': 'Start-Up Fees',
    'close-out': 'Close-Out Fees', 'close out': 'Close-Out Fees', 'closeout': 'Close-Out Fees',
    'archiv': 'Archiving / Storage', 'document storage': 'Archiving / Storage', 'record retention': 'Archiving / Storage', 'storage': 'Archiving / Storage',
    'ethics': 'Ethics / IRB Fees', 'irb': 'Ethics / IRB Fees',
    'sae': 'SAE Reports', 'pharmacy': 'Pharmacy Fees',
  };
  function categorize(name) {
    const lower = name.toLowerCase();
    for (const [key, cat] of Object.entries(CATEGORY_MAP)) {
      if (lower.includes(key)) return cat;
    }
    return 'Other Fees';
  }

  const detail = [];
  const categories = {};
  rows.filter(r => {
    const s = (r['Study Name'] || '').trim();
    return s && s.toLowerCase() !== 'study name';
  }).forEach(r => {
    const study = (r['Study Name'] || '').trim();
    const name = (r['Name'] || '').trim();
    const amount = num(r['Amount Remaining']);
    if (amount <= 0) return;
    const cat = categorize(name);
    detail.push({ study, name, amount: Math.round(amount * 100) / 100, category: cat });
    if (!categories[cat]) categories[cat] = { amount: 0, count: 0, studies: new Set() };
    categories[cat].amount += amount;
    categories[cat].count++;
    categories[cat].studies.add(study);
  });
  return {
    detail: detail.sort((a, b) => b.amount - a.amount),
    byCategory: Object.entries(categories).sort((a, b) => b[1].amount - a[1].amount).map(([category, d]) => ({
      category, amount: Math.round(d.amount), count: d.count, studies: d.studies.size
    })),
  };
}

function parseUnpaidApDetailCSV(rows) {
  const detail = [];
  const byType = {};
  const agingBuckets = { '0-30': { amount: 0, count: 0 }, '31-60': { amount: 0, count: 0 }, '61-90': { amount: 0, count: 0 }, '91-120': { amount: 0, count: 0 }, '121+': { amount: 0, count: 0 } };
  rows.filter(r => {
    const s = (r['Study Name'] || '').trim();
    return s && s.toLowerCase() !== 'study name';
  }).forEach(r => {
    const study = (r['Study Name'] || '').trim();
    const visit = (r['Visit Number and Name'] || '').trim();
    const revType = (r['Revenue Type'] || '').trim();
    const amount = num(r['Amount Upfront']);
    const days = parseInt(r['Days Unpaid'] || '0') || 0;
    if (amount <= 0) return;
    detail.push({ study, visit, revType, amount: Math.round(amount * 100) / 100, daysUnpaid: days });
    if (revType) {
      if (!byType[revType]) byType[revType] = { amount: 0, count: 0 };
      byType[revType].amount += amount;
      byType[revType].count++;
    }
    // Aging bucket
    const bucket = days <= 30 ? '0-30' : days <= 60 ? '31-60' : days <= 90 ? '61-90' : days <= 120 ? '91-120' : '121+';
    agingBuckets[bucket].amount += amount;
    agingBuckets[bucket].count++;
  });
  return {
    detail: detail.sort((a, b) => b.daysUnpaid - a.daysUnpaid),
    byType: Object.entries(byType).sort((a, b) => b[1].amount - a[1].amount).map(([type, d]) => ({ type, amount: Math.round(d.amount), count: d.count })),
    aging: Object.entries(agingBuckets).map(([bucket, d]) => ({ bucket, amount: Math.round(d.amount), count: d.count })),
  };
}

function buildTopAR(agingInv, agingAp, paymentsData) {
  const collected = {};
  paymentsData.forEach(r => { collected[r.study] = (collected[r.study] || 0) + r.amount; });
  const studies = {};
  const sumBuckets = r => r.current + r.d30_60 + r.d61_90 + r.d91_120 + r.d121_150 + r.d150plus;
  agingInv.forEach(r => { studies[r.study] = { study: r.study, invAR: Math.round(sumBuckets(r) * 100) / 100, apAR: 0, total: 0, collected: Math.round((collected[r.study] || 0) * 100) / 100 }; });
  agingAp.forEach(r => { if (!studies[r.study]) studies[r.study] = { study: r.study, invAR: 0, apAR: 0, total: 0, collected: Math.round((collected[r.study] || 0) * 100) / 100 }; studies[r.study].apAR = Math.round(sumBuckets(r) * 100) / 100; });
  Object.values(studies).forEach(s => s.total = Math.round((s.invAR + s.apAR) * 100) / 100);
  return Object.values(studies).filter(s => s.total > 0).sort((a, b) => b.total - a.total);
}

function buildMergedStudies(agingInv, agingAp, uninvoiced) {
  const all = new Set();
  agingInv.forEach(r => all.add(r.study));
  agingAp.forEach(r => all.add(r.study));
  uninvoiced.forEach(r => all.add(r.study));
  const sumBuckets = r => r.current + r.d30_60 + r.d61_90 + r.d91_120 + r.d121_150 + r.d150plus;
  return [...all].sort().map(s => {
    const code = s.includes(' - ') ? s.split(' - ').pop() : s;
    const inv = agingInv.find(r => r.study === s);
    const ap = agingAp.find(r => r.study === s);
    const un = uninvoiced.find(r => r.study === s);
    return { study: code, full: s, invAR: inv ? Math.round(sumBuckets(inv) * 100) / 100 : 0, apAR: ap ? Math.round(sumBuckets(ap) * 100) / 100 : 0, uninvoiced: un ? un.amount : 0, status: 'Active' };
  });
}

async function fetchFinanceLive() {
  const pk = CRP_CONFIG.DATA_FEEDS.FINANCE_PUB_KEY;
  if (!pk) { console.log('CRP Finance: No published key configured'); return false; }
  const tabs = CRP_CONFIG.FINANCE_TABS;

  console.log('CRP Finance: Fetching live data from Master Sheet...');
  try {
    // Fetch all tabs in parallel
    const [agingInvRows, agingApRows, unpaidInvRows, unpaidApRows, uninvoicedRows, revenueRows, paymentsRows] = await Promise.all([
      fetchFinanceTab(pk, tabs.AGING_INV),
      fetchFinanceTab(pk, tabs.AGING_AP),
      fetchFinanceTab(pk, tabs.UNPAID_INV),
      fetchFinanceTab(pk, tabs.UNPAID_AP),
      fetchFinanceTab(pk, tabs.UNINVOICED),
      fetchFinanceTab(pk, tabs.REVENUE),
      fetchFinanceTab(pk, tabs.PAYMENTS),
    ]);

    // Parse into dashboard data structures
    const newAgingInv = parseAgingCSV(agingInvRows);
    const newAgingAp = parseAgingCSV(agingApRows);
    if (newAgingInv.length === 0 && newAgingAp.length === 0) {
      console.warn('CRP Finance: Master sheet returned empty data — keeping defaults');
      return false;
    }

    const newUnpaidInv = parseUnpaidInvCSV(unpaidInvRows);
    const newUnpaidAp = parseUnpaidApCSV(unpaidApRows);
    const newUninvoiced = parseUninvoicedCSV(uninvoicedRows);
    const newRevenue = parseRevenueCSV(revenueRows);
    const newRevenue12m = parseStudyRevenue12mCSV(revenueRows);
    const newPayments = parsePaymentsCSV(paymentsRows);
    const newTopAR = buildTopAR(newAgingInv, newAgingAp, paymentsRows.filter(r => {
      const s = (r['Study Name'] || '').trim();
      return s && s.toLowerCase() !== 'study name';
    }).map(r => ({ study: (r['Study Name']||'').trim(), amount: num(r['Amount']) })));
    const newMerged = buildMergedStudies(newAgingInv, newAgingAp, newUninvoiced);

    // Enhanced parsers
    const revBreakdown = parseRevenueByTypeCSV(revenueRows);
    const uninvDetail = parseUninvoicedDetailCSV(uninvoicedRows);
    const unpaidApDetail = parseUnpaidApDetailCSV(unpaidApRows);

    // Calculate totals
    const sumB = r => r.current + r.d30_60 + r.d61_90 + r.d91_120 + r.d121_150 + r.d150plus;
    const newTotalInvAR = Math.round(newAgingInv.reduce((s, r) => s + sumB(r), 0) * 100) / 100;
    const newTotalApAR = Math.round(newAgingAp.reduce((s, r) => s + sumB(r), 0) * 100) / 100;

    // Assign to global variables (replacing hardcoded defaults)
    AGING_INV = newAgingInv;
    AGING_AP = newAgingAp;
    UNPAID_INVOICES = newUnpaidInv;
    UNPAID_AP = newUnpaidAp;
    UNINVOICED = newUninvoiced;
    MONTHLY_REVENUE = newRevenue;
    STUDY_REVENUE_12M = newRevenue12m;
    MONTHLY_PAYMENTS = newPayments;
    TOP_AR_STUDIES = newTopAR;
    FIN_MERGED_STUDIES = newMerged;
    totalInvAR = newTotalInvAR;
    totalApAR = newTotalApAR;

    // Enhanced data
    REVENUE_BY_TYPE = revBreakdown.byType;
    REVENUE_BY_PAY_TYPE = revBreakdown.byPayType;
    REVENUE_ITEMS_TOP = revBreakdown.topItems;
    UNINVOICED_DETAIL = uninvDetail.detail;
    UNINVOICED_BY_CATEGORY = uninvDetail.byCategory;
    UNPAID_AP_DETAIL = unpaidApDetail.detail;
    UNPAID_AP_BY_TYPE = unpaidApDetail.byType;
    UNPAID_AP_AGING = unpaidApDetail.aging;

    console.log('CRP Finance: Live data loaded — ' + newAgingInv.length + ' invoice studies, ' + newAgingAp.length + ' autopay studies, $' + (newTotalInvAR + newTotalApAR).toLocaleString() + ' total AR');

    // Update hero values in the Finance overview
    const heroAR = document.querySelector('.hero-val[style*="8B5CF6"]');
    if (heroAR) heroAR.textContent = '$' + Math.round((newTotalInvAR + newTotalApAR) / 1000).toLocaleString() + 'K';
    const heroSub = heroAR ? heroAR.parentElement.querySelector('.hero-sub') : null;
    if (heroSub) heroSub.textContent = 'Invoice $' + Math.round(newTotalInvAR / 1000) + 'K + Autopay $' + Math.round(newTotalApAR / 1000) + 'K · click for breakdown';

    // Update payments hero
    const payTotal = newPayments.reduce((s, r) => s + r.amount, 0);
    const heroPay = document.querySelectorAll('.hero-val');
    heroPay.forEach(el => { if (el.textContent.includes('2,483')) el.textContent = '$' + Math.round(payTotal).toLocaleString(); });

    // Re-render finance charts if currently visible
    if (typeof renderForecast === 'function') try { renderForecast(); } catch(e) {}
    if (typeof drawPayChartOverview === 'function') try { drawPayChartOverview(); } catch(e) {}
    if (typeof drawRevChart === 'function') try { drawRevChart(); } catch(e) {}
    if (typeof renderRevenueTab === 'function') try { renderRevenueTab(); } catch(e) {}
    if (typeof renderAccruals === 'function') try { renderAccruals(); } catch(e) {}

    // Update the data source badge
    const badge = document.getElementById('data-source-badge');
    if (badge && badge.textContent.includes('Live')) {
      badge.textContent = badge.textContent; // keep as-is
    }
    const refreshBadge = document.getElementById('last-refresh-badge');
    if (refreshBadge) refreshBadge.textContent = 'Updated: ' + new Date().toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });

    return true;
  } catch (e) {
    console.warn('CRP Finance: Could not fetch live data — using defaults. Error:', e.message);
    return false;
  }
}

// ═══════════════════════════════════════════════════
// PATIENT DATABASE — Cross-reference with active study patients
// ═══════════════════════════════════════════════════
async function fetchPatientDB() {
  const url = CRP_CONFIG.PATIENT_DB_URL;
  if (!url) { console.log('CRP: No patient DB URL configured'); return false; }
  console.log('CRP: Fetching patient database...');
  try {
    const rows = await fetchCSV(url);
    PATIENT_DB = rows.map(r => ({
      name: (r['Patient Full Name']||'').trim(),
      name_lower: (r['Patient Full Name']||'').trim().toLowerCase(),
      status: (r['Patient Status']||'Available').trim(),
      email: (r['Email']||'').trim(),
      mobile: (r['Mobile Phone']||'').trim(),
      home_phone: (r['Home Phone']||'').trim(),
      work_phone: (r['Work Phone']||'').trim(),
      record: (r['Record Number']||'').trim(),
      site: (r['Site Name']||'').trim(),
      city: (r['City']||'').trim(),
      state: (r['State']||'').trim(),
    }));
    PATIENT_DB_MAP = new Map(PATIENT_DB.map(p => [p.name_lower, p]));
    console.log(`CRP: Patient DB loaded — ${PATIENT_DB.length} records`);

    // Run cross-reference against active patients
    crossReferencePatients();
    renderContactAlerts();
    return true;
  } catch(e) {
    console.warn('CRP: Patient DB fetch failed:', e.message);
    const el = document.getElementById('contact-alert-cards');
    if (el) el.innerHTML = '<div style="text-align:center;padding:20px;color:#94a3b8;font-size:13px;">⚠️ Could not load patient database — cross-reference unavailable</div>';
    const badge = document.getElementById('cq-badge');
    if (badge) { badge.textContent = 'Offline'; badge.className = 'badge badge-gray'; }
    return false;
  }
}

function crossReferencePatients() {
  CONTACT_ALERTS = [];

  // Build lookup map from patient DB (by normalized name)
  const dbMap = {};
  PATIENT_DB.forEach(p => {
    const key = p.name_lower;
    if (key && (!dbMap[key] || p.status !== 'Available')) dbMap[key] = p;
  });

  // Collect all active patients from upcoming visits + recent cancellations
  const activePatients = new Map(); // name_lower -> {patient, study, patient_url, study_url, has_upcoming, has_cancel}
  (DATA.allVisitDetail || []).forEach(v => {
    const key = (v.patient||'').toLowerCase().trim();
    if (!key) return;
    const existing = activePatients.get(key);
    if (!existing) {
      activePatients.set(key, {
        patient: v.patient, study: v.study, patient_url: v.patient_url, study_url: v.study_url,
        has_upcoming: true, has_cancel: false, studies: new Set([v.study])
      });
    } else {
      existing.studies.add(v.study);
      existing.has_upcoming = true;
    }
  });
  (DATA.allCancels || []).forEach(c => {
    const key = (c.name||'').toLowerCase().trim();
    if (!key) return;
    const existing = activePatients.get(key);
    if (!existing) {
      activePatients.set(key, {
        patient: c.name, study: c.study, patient_url: c.url, study_url: c.study_url,
        has_upcoming: false, has_cancel: true, studies: new Set([c.study])
      });
    } else {
      existing.studies.add(c.study);
      existing.has_cancel = true;
    }
  });

  let matched = 0, cleanCount = 0;

  activePatients.forEach((info, nameKey) => {
    const dbRecord = dbMap[nameKey];
    if (!dbRecord) return; // Not found in patient DB — skip (not flaggable)
    matched++;

    const status = dbRecord.status;
    const hasEmail = !!dbRecord.email;
    const hasPhone = !!(dbRecord.mobile || dbRecord.home_phone || dbRecord.work_phone);

    // RED FLAGS: Do Not Solicit, Do Not Enroll, Deceased — with active visits
    if (status === 'Do Not Solicit' || status === 'Do Not Enroll' || status === 'Deceased') {
      CONTACT_ALERTS.push({
        patient: info.patient, study: info.study, studies: [...info.studies],
        patient_url: info.patient_url, study_url: info.study_url,
        severity: 'red',
        alert_type: status,
        detail: info.has_upcoming
          ? `Patient marked "${status}" in recruitment DB but has upcoming visits`
          : `Patient marked "${status}" in recruitment DB with recent cancellations`,
        has_upcoming: info.has_upcoming, has_cancel: info.has_cancel,
        email: dbRecord.email, phone: dbRecord.mobile || dbRecord.home_phone || '',
      });
      return;
    }

    // RED FLAG: Bad Contact Info with upcoming visits
    if (status === 'Bad Contact Info' && info.has_upcoming) {
      CONTACT_ALERTS.push({
        patient: info.patient, study: info.study, studies: [...info.studies],
        patient_url: info.patient_url, study_url: info.study_url,
        severity: 'red',
        alert_type: 'Bad Contact Info',
        detail: 'Patient has bad contact info in recruitment DB but has upcoming visits — verify contact details in CRIO',
        has_upcoming: true, has_cancel: info.has_cancel,
        email: dbRecord.email, phone: dbRecord.mobile || dbRecord.home_phone || '',
      });
      return;
    }

    // YELLOW FLAGS: Missing email or phone
    if (!hasEmail && !hasPhone) {
      CONTACT_ALERTS.push({
        patient: info.patient, study: info.study, studies: [...info.studies],
        patient_url: info.patient_url, study_url: info.study_url,
        severity: 'yellow',
        alert_type: 'No Contact Info',
        detail: 'No email or phone number on file — unable to send reminders or reach patient',
        has_upcoming: info.has_upcoming, has_cancel: info.has_cancel,
        email: '', phone: '',
      });
    } else if (!hasEmail) {
      CONTACT_ALERTS.push({
        patient: info.patient, study: info.study, studies: [...info.studies],
        patient_url: info.patient_url, study_url: info.study_url,
        severity: 'yellow',
        alert_type: 'Missing Email',
        detail: 'No email address on file — cannot send visit reminders or study communications',
        has_upcoming: info.has_upcoming, has_cancel: info.has_cancel,
        email: '', phone: dbRecord.mobile || dbRecord.home_phone || '',
      });
    } else if (!hasPhone) {
      CONTACT_ALERTS.push({
        patient: info.patient, study: info.study, studies: [...info.studies],
        patient_url: info.patient_url, study_url: info.study_url,
        severity: 'yellow',
        alert_type: 'Missing Phone',
        detail: 'No phone number on file — cannot call for appointment confirmations',
        has_upcoming: info.has_upcoming, has_cancel: info.has_cancel,
        email: dbRecord.email, phone: '',
      });
    } else {
      cleanCount++;
    }
  });

  // Sort: red first, then yellow; within each, upcoming first
  CONTACT_ALERTS.sort((a,b) => {
    if (a.severity !== b.severity) return a.severity === 'red' ? -1 : 1;
    if (a.has_upcoming !== b.has_upcoming) return a.has_upcoming ? -1 : 1;
    return a.patient.localeCompare(b.patient);
  });

  // Update KPIs
  const redCount = CONTACT_ALERTS.filter(a => a.severity === 'red').length;
  const yellowCount = CONTACT_ALERTS.filter(a => a.severity === 'yellow').length;
  const el = id => document.getElementById(id);
  if (el('cq-kpi-red')) el('cq-kpi-red').textContent = redCount;
  if (el('cq-kpi-yellow')) el('cq-kpi-yellow').textContent = yellowCount;
  if (el('cq-kpi-clean')) el('cq-kpi-clean').textContent = cleanCount;
  if (el('cq-kpi-db-total')) el('cq-kpi-db-total').textContent = PATIENT_DB.length.toLocaleString();
  if (el('cq-kpi-db-sub')) el('cq-kpi-db-sub').textContent = `${matched} matched to active patients`;

  console.log(`CRP: Contact cross-ref — ${redCount} red, ${yellowCount} yellow, ${cleanCount} clean out of ${matched} matched`);
}

function renderContactAlerts() {
  const el = document.getElementById('contact-alert-cards');
  const badge = document.getElementById('cq-badge');
  if (!el) return;

  if (CONTACT_ALERTS.length === 0) {
    el.innerHTML = '<div style="padding:24px;text-align:center;color:var(--muted);font-size:13px;">🟢 All active patients have clean contact data — no flags found</div>';
    if (badge) { badge.textContent = 'All clear'; badge.className = 'badge badge-green'; }
    return;
  }

  const redAlerts = CONTACT_ALERTS.filter(a => a.severity === 'red');
  const yellowAlerts = CONTACT_ALERTS.filter(a => a.severity === 'yellow');
  if (badge) {
    badge.textContent = `${redAlerts.length} red · ${yellowAlerts.length} yellow`;
    badge.className = redAlerts.length ? 'badge badge-red' : 'badge badge-yellow';
  }

  function alertCard(a) {
    const isRed = a.severity === 'red';
    const border = isRed ? '#dc2626' : '#d97706';
    const bg = isRed ? '#fef2f2' : '#fffbeb';
    const icon = isRed ? '🔴' : '🟡';
    const typeLabel = a.alert_type;
    const typeBg = isRed ? '#dc2626' : '#d97706';
    const pLink = a.patient_url
      ? `<a href="${a.patient_url}" target="_blank" rel="noopener" style="text-decoration:none;color:#1e293b;font-weight:700;">${maskPHI(a.patient)}<svg xmlns="http://www.w3.org/2000/svg" width="9" height="9" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" style="margin-left:2px;opacity:0.4;vertical-align:middle"><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/><polyline points="15 3 21 3 21 9"/><line x1="10" y1="14" x2="21" y2="3"/></svg></a>`
      : `<strong style="color:#1e293b">${maskPHI(a.patient)}</strong>`;
    const studyList = (a.studies||[a.study]).join(', ');
    const contactLine = [];
    if (a.email) contactLine.push(`📧 ${a.email}`);
    if (a.phone) contactLine.push(`📱 ${a.phone}`);
    if (!a.email && !a.phone) contactLine.push('❌ No contact info on file');

    return `<div style="border:1.5px solid ${border};border-radius:10px;padding:14px 16px;background:${bg};">
      <div style="display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:6px;">
        <div>
          <div style="font-size:14px;font-weight:700;color:#1e293b">${pLink}</div>
          <div style="font-size:11px;color:#64748b;margin-top:2px">${studyList}</div>
        </div>
        <span style="font-size:10px;font-weight:700;padding:3px 8px;border-radius:6px;background:${typeBg};color:#fff;white-space:nowrap;">${icon} ${typeLabel}</span>
      </div>
      <div style="font-size:12px;color:#475569;margin-bottom:6px;">${a.detail}</div>
      <div style="font-size:11px;color:#94a3b8;display:flex;gap:12px;flex-wrap:wrap;">
        ${contactLine.map(c => `<span>${c}</span>`).join('')}
        ${a.has_upcoming ? '<span style="color:#dc2626;font-weight:600;">📅 Has upcoming visits</span>' : ''}
      </div>
    </div>`;
  }

  let html = '';

  if (redAlerts.length > 0) {
    html += `<div style="margin-bottom:12px;">
      <div style="font-size:12px;font-weight:700;color:#dc2626;margin-bottom:8px;">🔴 Immediate Action Required (${redAlerts.length})</div>
      <div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(340px,1fr));gap:10px;">
        ${redAlerts.map(alertCard).join('')}
      </div>
    </div>`;
  }

  if (yellowAlerts.length > 0) {
    // Show first 10 yellow alerts, with expand option if more
    const showCount = 10;
    const visibleYellow = yellowAlerts.slice(0, showCount);
    const hiddenYellow = yellowAlerts.slice(showCount);
    html += `<div>
      <div style="font-size:12px;font-weight:700;color:#d97706;margin-bottom:8px;">🟡 Contact Data Gaps (${yellowAlerts.length})</div>
      <div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(340px,1fr));gap:10px;" id="cq-yellow-grid">
        ${visibleYellow.map(alertCard).join('')}
      </div>
      ${hiddenYellow.length > 0 ? `
        <div id="cq-yellow-more" style="text-align:center;margin-top:10px;">
          <button onclick="document.getElementById('cq-yellow-hidden').style.display='grid';this.parentElement.style.display='none';"
            style="font-size:12px;color:#1843ad;background:#e8eeff;border:1px solid #1843ad;border-radius:8px;padding:6px 16px;cursor:pointer;font-weight:600;">
            Show ${hiddenYellow.length} more yellow alerts
          </button>
        </div>
        <div id="cq-yellow-hidden" style="display:none;grid-template-columns:repeat(auto-fill,minmax(340px,1fr));gap:10px;margin-top:10px;">
          ${hiddenYellow.map(alertCard).join('')}
        </div>
      ` : ''}
    </div>`;
  }

  el.innerHTML = html;
}

async function connectSheets() {
  const url1 = document.getElementById('url1-input').value.trim();
  const url2 = document.getElementById('url2-input').value.trim();
  if (!url1 || !url2) { alert('Please paste both CSV URLs.'); return; }

  document.getElementById('setup-overlay').innerHTML = `
    <div style="color:#fff;text-align:center">
      <div class="loading" style="color:#7dd3fc; flex-direction:column; gap:12px">
        <div style="font-size:24px" class="spin">↻</div>
        <div>Loading your live data...</div>
      </div>
    </div>`;

  try {
    const [rows1, legacyCancels, auditRows] = await Promise.all([fetchCSV(url1), fetchCSV(url2).catch(() => []), fetchCSV(AUDIT_LOG_URL).catch(() => [])]);
    DATA = processLiveData(rows1, legacyCancels, auditRows);
    document.getElementById('data-source-badge').textContent = '🔗 Live Google Sheets';
    document.getElementById('last-refresh-badge').textContent = 'Updated: ' + new Date().toLocaleDateString('en-US', {month:'short',day:'numeric',year:'numeric'});
    closeSetup();
    renderAll();
    CRP.emit('dataLoaded', { source: 'google-sheets', timestamp: new Date() });
    console.log('CRP: Live data loaded from setup (audit log rows: ' + auditRows.length + ')');
  } catch(e) {
    alert('Could not load data: ' + e.message + '\n\nMake sure the sheet is published as CSV (File → Share → Publish to web → CSV format).');
    location.reload();
  }
}

async function connectFromGuide() {
  document.getElementById('url1-input').value = document.getElementById('url1-connect').value;
  document.getElementById('url2-input').value = document.getElementById('url2-connect').value;
  document.getElementById('setup-overlay').style.display = 'flex';
  connectSheets();
}

function processLiveData(allRows, legacyCancels, auditLog) {
  const today = new Date();
  today.setHours(0,0,0,0);
  const twoMonthsAgo   = new Date(today); twoMonthsAgo.setDate(today.getDate() - 61);
  const twoMonthsAhead = new Date(today); twoMonthsAhead.setDate(today.getDate() + 61);
  const next14End      = new Date(today); next14End.setDate(today.getDate() + 14);

  // ── Snapshot dedup: keep only the latest snapshot_date from each sheet ──
  const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
  function latestSnapshotOnly(rows) {
    let maxSnap = '';
    rows.forEach(r => {
      const s = (r.snapshot_date || '').trim();
      if (DATE_RE.test(s) && s > maxSnap) maxSnap = s;
    });
    if (!maxSnap) return rows;                         // no snapshot col → pass through
    return rows.filter(r => (r.snapshot_date || '').trim() === maxSnap);
  }

  // ── Single-report split: upcoming report includes cancelled visits ──
  // Split by Appointment Status into upcoming (active) vs cancels.
  // Map field names so downstream code works: Full Name → Staff Full Name, Scheduled Date → Cancel Date
  const upcomingAllSnapshots = allRows;   // keep full history for coord daily goals
  const allLatest = latestSnapshotOnly(allRows);
  let upcoming = allLatest.filter(r => {
    const status = (r['Appointment Status'] || '').trim().toLowerCase();
    return status !== 'cancelled' && status !== 'canceled';
  });
  // Extract cancels from the unified report
  const derivedCancels = allLatest.filter(r => {
    const status = (r['Appointment Status'] || '').trim().toLowerCase();
    return status === 'cancelled' || status === 'canceled';
  }).map(r => {
    // Map fields so downstream cancel processing code works
    // (it expects 'Staff Full Name', 'Cancel Date', 'Site Name')
    r['Staff Full Name'] = r['Staff Full Name'] || r['Full Name'] || '';
    r['Cancel Date'] = r['Cancel Date'] || r['Scheduled Date'] || '';
    r['Site Name'] = r['Site Name'] || '';
    return r;
  });
  // Merge with legacy cancels (if available) for richer history, dedup by patient+study+date
  const _cancelSeen = new Set();
  const allCancelSources = [...derivedCancels];
  if (legacyCancels && legacyCancels.length) {
    const legacyLatest = latestSnapshotOnly(legacyCancels);
    legacyLatest.forEach(r => allCancelSources.push(r));
  }
  let cancels = [];
  allCancelSources.forEach(r => {
    const key = ((r['Subject Full Name']||'').trim().toLowerCase()) + '|' +
                ((r['Study Name']||'').trim().toLowerCase()) + '|' +
                ((r['Cancel Date']||r['Scheduled Date']||'').trim());
    if (!_cancelSeen.has(key)) { _cancelSeen.add(key); cancels.push(r); }
  });
  console.log('CRP: Split report → upcoming', upcoming.length, ', derived cancels', derivedCancels.length, ', total cancels (merged+deduped)', cancels.length);

  // ── Coordinator definitions (must be before audit log resolution) ──
  const EXCLUDE_STUDIES = new Set([]);
  const isExcludedStudy = (name) => EXCLUDE_STUDIES.has(name) || /pre-screening/i.test(name);
  const FIBRO = /fibroscan|fibrosan|fibro scan|scan only|scan visit/i;
  const EXCL_COORD = new Set(['jana milankovic','ema gunic','gabrijela ateljevic','ana lambic','vlado draganic']);
  const COORD_MAP = {
    'stacey scott':'Stacey Scott','ruby pereira':'Ruby Pereira',
    'mario castellanos':'Mario Castellanos','angelina mcmullen':'Angelina McMullen',
    'cady chilensky':'Cady Chilensky','eugene andruczyk':'Eugene Andruczyk',
    'lolita vaughan':'Lolita Vaughan','michael tomeo':'Michael Tomeo',
    'joseph heether':'Joseph Heether','brian shaffer':'Brian Shaffer',
    'taher modarressi':'Taher Modarressi'
  };
  function normName(n)   { return (n||'').trim().replace(/\s+/g,' '); }
  function cleanCoord(n) { return COORD_MAP[normName(n).toLowerCase()] || normName(n); }
  function isCoord(n)    { return !EXCL_COORD.has(normName(n).toLowerCase()); }

  // ── Audit Log Coordinator Resolution ──
  // Build lookup maps from audit log to resolve the actual clinical coordinator
  // when the upcoming report shows a scheduler/study coordinator instead.
  // Join on Calendar Appointment Key (precise) with Subject Key fallback.
  const _auditByApptKey = {};   // Calendar Appointment Key → Set of "Appointment For User"
  const _auditBySubjKey = {};   // Subject Key → Set of "Appointment For User"
  (auditLog || []).forEach(r => {
    const apptFor = (r['Appointment For User'] || '').trim();
    const changeType = (r['Appointment Change Type'] || '').trim();
    if (!apptFor || changeType !== 'User Added') return;
    const apptKey = (r['Calendar Appointment Key (back end)'] || '').toString().trim();
    const subjKey = (r['Subject Key (Back End)'] || '').toString().trim();
    if (apptKey) {
      if (!_auditByApptKey[apptKey]) _auditByApptKey[apptKey] = new Set();
      _auditByApptKey[apptKey].add(apptFor);
    }
    if (subjKey) {
      if (!_auditBySubjKey[subjKey]) _auditBySubjKey[subjKey] = new Set();
      _auditBySubjKey[subjKey].add(apptFor);
    }
  });
  // Build investigator lookup — keyed by apptKey and subjKey → Set of investigator names
  // Strategy: any "Appointment For User" that is NOT a coordinator and NOT excluded is an investigator
  const COORD_SET = new Set((CRP_CONFIG.COORDINATORS || []).map(n => n.toLowerCase().replace(/\s+/g, ' ')));
  const _invByApptKey = {};
  const _invBySubjKey = {};
  const _allAuditUsers = new Set();
  (auditLog || []).forEach(r => {
    const apptFor = (r['Appointment For User'] || '').trim();
    const changeType = (r['Appointment Change Type'] || '').trim();
    if (!apptFor || changeType !== 'User Added') return;
    const apptForLower = apptFor.toLowerCase().replace(/\s+/g, ' ');
    _allAuditUsers.add(apptForLower);
    // Skip if this person is a coordinator or an excluded scheduler — they're not an investigator
    if (COORD_SET.has(apptForLower) || EXCL_COORD.has(apptForLower)) return;
    const apptKey = (r['Calendar Appointment Key (back end)'] || '').toString().trim();
    const subjKey = (r['Subject Key (Back End)'] || '').toString().trim();
    if (apptKey) {
      if (!_invByApptKey[apptKey]) _invByApptKey[apptKey] = new Set();
      _invByApptKey[apptKey].add(apptFor);
    }
    if (subjKey) {
      if (!_invBySubjKey[subjKey]) _invBySubjKey[subjKey] = new Set();
      _invBySubjKey[subjKey].add(apptFor);
    }
  });
  console.log('CRP: Audit log —', (auditLog||[]).length, 'rows, coord keys:', Object.keys(_auditByApptKey).length, ', inv keys:', Object.keys(_invByApptKey).length, ', inv subjKeys:', Object.keys(_invBySubjKey).length);

  // Resolve investigator for a row from the audit log
  function resolveInvestigator(row) {
    const apptKey = (row['Calendar Appointment Key (back end)'] || row['Calendar Appointment Key'] || '').toString().trim();
    if (apptKey && _invByApptKey[apptKey]) {
      for (const name of _invByApptKey[apptKey]) return name;
    }
    const subjKey = (row['Subject Key (Back End)'] || '').toString().trim();
    if (subjKey && _invBySubjKey[subjKey]) {
      for (const name of _invBySubjKey[subjKey]) return name;
    }
    return '';
  }

  // Debug: log first 5 upcoming rows' investigator resolution (uses allRows before filter)
  let _invDebugCount = 0;
  (allRows || []).slice(0, 5).forEach(r => {
    const ak = (r['Calendar Appointment Key (back end)'] || r['Calendar Appointment Key'] || '').toString().trim();
    const sk = (r['Subject Key (Back End)'] || '').toString().trim();
    const inv = resolveInvestigator(r);
    console.log(`CRP INV DEBUG row ${_invDebugCount++}: apptKey="${ak}" subjKey="${sk}" → inv="${inv}" | row keys: ${Object.keys(r).filter(k=>k.toLowerCase().includes('key')||k.toLowerCase().includes('subject')).join(', ')}`);
  });

  // Resolve actual coordinator for a row: if Full Name is an excluded coordinator,
  // look up the real coordinator from the audit log.
  // Returns the first non-excluded coordinator found, or original Full Name as fallback.
  function resolveCoordinator(row) {
    const origName = (row['Full Name'] || '').trim();
    const origLower = origName.toLowerCase().replace(/\s+/g, ' ');
    // If already a real coordinator, no resolution needed
    if (!EXCL_COORD.has(origLower)) return origName;
    // Try Calendar Appointment Key first (most precise)
    const apptKey = (row['Calendar Appointment Key (back end)'] || row['Calendar Appointment Key'] || '').toString().trim();
    if (apptKey && _auditByApptKey[apptKey]) {
      for (const name of _auditByApptKey[apptKey]) {
        if (!EXCL_COORD.has(name.toLowerCase().replace(/\s+/g, ' '))) return name;
      }
    }
    // Fall back to Subject Key
    const subjKey = (row['Subject Key (Back End)'] || '').toString().trim();
    if (subjKey && _auditBySubjKey[subjKey]) {
      for (const name of _auditBySubjKey[subjKey]) {
        if (!EXCL_COORD.has(name.toLowerCase().replace(/\s+/g, ' '))) return name;
      }
    }
    return origName; // no resolution found, keep original
  }

  // Enrich all upcoming rows with resolved coordinator
  let _resolvedCount = 0;
  [...upcoming, ...upcomingAllSnapshots].forEach(r => {
    const orig = (r['Full Name'] || '').trim();
    const resolved = resolveCoordinator(r);
    if (resolved !== orig) {
      r['_Resolved Coordinator'] = resolved;
      r['Full Name'] = resolved;
      _resolvedCount++;
    }
  });
  // Also enrich cancels rows
  cancels.forEach(r => {
    const origStaff = (r['Staff Full Name'] || r['Full Name'] || '').trim();
    const origLower = origStaff.toLowerCase().replace(/\s+/g, ' ');
    if (EXCL_COORD.has(origLower)) {
      const resolved = resolveCoordinator(r);
      if (resolved !== origStaff) {
        r['_Resolved Coordinator'] = resolved;
        if (r['Staff Full Name']) r['Staff Full Name'] = resolved;
        if (r['Full Name']) r['Full Name'] = resolved;
      }
    }
  });
  console.log('CRP: Coordinator resolution — resolved', _resolvedCount, 'rows via audit log');

  const BASE = 'https://app.clinicalresearch.io/clinical-research-philadelphia-crp';
  const PHL  = 'philadelphia-pa';
  const PNJ  = 'clinical-research-philadelphia-pennington';
  const PENNINGTON_KEYS = new Set([161619, 162446, 167755, 167794, 172389, 173164]);

  function siteSlug(studyKey, siteName) {
    const k = parseInt(studyKey);
    if (!isNaN(k) && PENNINGTON_KEYS.has(k)) return PNJ;
    if ((siteName||'').includes('Penn')) return PNJ;
    return PHL;
  }
  function studyUrl(studyKey, siteName) {
    const k = parseInt(studyKey);
    if (isNaN(k)) return null;
    return `${BASE}/${siteSlug(k, siteName)}/study/${k}/subjects`;
  }
  function patientUrl(studyKey, subjectKey, siteName) {
    const sk = parseInt(studyKey), pk = parseInt(subjectKey);
    if (isNaN(sk) || isNaN(pk)) return null;
    return `${BASE}/${siteSlug(sk, siteName)}/study/${sk}/subject/${pk}`;
  }

  function parseDate(s) {
    if (!s) return null;
    // Force local-time parsing: 'YYYY-MM-DD' → 'YYYY-MM-DDT00:00:00' (local, not UTC)
    const t = String(s).trim();
    const d = /^\d{4}-\d{2}-\d{2}$/.test(t) ? new Date(t + 'T00:00:00') : new Date(t);
    return isNaN(d) ? null : d;
  }
  function isBetween(d, a, b) { return d && d >= a && d <= b; }

  // ── Filter rows ──
  const activeUpcoming = upcoming.filter(r => {
    const d = parseDate(r['Scheduled Date'] || r['snapshot_date']);
    return d && d >= today && d <= twoMonthsAhead
      && !isExcludedStudy(r['Study Name'])
      && !FIBRO.test(r['Cancel Reason'] || '')
      && isCoord(r['Full Name']);
  });

  // Step 1: Basic date/study filter
  const rawCancels = cancels.filter(r => {
    const d = parseDate(r['Cancel Date'] || r['Scheduled Date'] || r['snapshot_date']);
    return d && d >= twoMonthsAgo && d <= today
      && !isExcludedStudy(r['Study Name']);
  });

  // Step 2: Deduplicate (same patient + study + cancel date)
  const seenCancels = new Set();
  const dedupedCancels = rawCancels.filter(r => {
    const key = ((r['Subject Full Name']||'').trim().toLowerCase()) + '|' +
                ((r['Study Name']||'').trim().toLowerCase()) + '|' +
                ((r['Cancel Date']||r['Scheduled Date']||'').trim());
    if (seenCancels.has(key)) return false;
    seenCancels.add(key);
    return true;
  });

  // Categories that should NOT count as true cancellations
  const EXCLUDED_CANCEL_CATS = new Set(['Rescheduled','Completed','Admin Error','FibroScan Only','Study Closed']);

  // Step 3: Categorize and split into true cancellations vs excluded
  const allCategorized = dedupedCancels.map(r => {
    r._category = categorizeReason(r['Cancel Reason'], r['Appointment Cancellation Type']);
    return r;
  });

  // recentCancels = only TRUE cancellations (excludes rescheduled, completed, admin error, fibroscan, study closed)
  const recentCancels = allCategorized.filter(r => !EXCLUDED_CANCEL_CATS.has(r._category));

  // Keep all categorized for the full allCancels detail view (including excluded categories, marked as such)
  const allCategorizedForDetail = allCategorized;

  // ── Helpers ──
  function weekBucket(rows, dateField) {
    const b = {};
    rows.forEach(r => {
      const d = parseDate(r[dateField]); if (!d) return;
      const mon = new Date(d); mon.setDate(d.getDate() - ((d.getDay()+6)%7));
      const k = mon.toLocaleDateString('en-US',{month:'short',day:'numeric'});
      b[k] = (b[k]||0) + 1;
    });
    return Object.entries(b).map(([week,count])=>({week,count}))
      .sort((a,b) => new Date(new Date().getFullYear()+' '+a.week) - new Date(new Date().getFullYear()+' '+b.week));
  }

  function groupBy(rows, field) {
    const m = {};
    rows.forEach(r => { const v=r[field]||'Unknown'; m[v]=(m[v]||0)+1; });
    return Object.entries(m).map(([name,count])=>({name,count})).sort((a,b)=>b.count-a.count);
  }

  function categorizeReason(reason, apptType) {
    const r = (reason||'').toLowerCase(); const t = (apptType||'').toLowerCase();
    if (/\bcompleted?\b/.test(r) && !/not completed|never completed/.test(r)) return 'Completed';
    if (/fibroscan|fibrosan|fibro scan|scan only|scan visit/i.test(r) || /fibroscan|fibrosan|fibro scan|scan only|scan visit/i.test(t)) return 'FibroScan Only';
    if (/discontinu/i.test(r)) return 'Discontinued';
    if (t === 'no show') return 'No Show';
    if (/screen.?fail|screenfail|dnq|does not qualify|not qualify|protocol criteria|excluded medication|autoimmune|bmi/.test(r)) return 'Screen Fail / DNQ';
    if (/reschedul|will call back|call back|reach out/.test(r) && !r.includes('no show')) return 'Rescheduled';
    if (/no.?show|didn.t answer|did not answer|no answer|mailbox|left text|left vm|text sent|unresponsive|lost to follow|never reached/.test(r)) return 'No Show';
    if (/withdrew|no longer interested|not interested|refuses to return|do not solicit|not comfortable/.test(r)) return 'Patient Withdrew';
    if (/weather|snow|storm/.test(r)) return 'Weather';
    if (/study.?clos|visit.*clos.*study/.test(r)) return 'Study Closed';
    if (/wrong study|entered in error|scheduled in error|\bltv\b|scheduled under|demo/.test(r)) return 'Admin Error';
    if (!r || r === 'nan') return 'Not Documented';
    return 'Other';
  }

  // ── cancelByStudy with CRIO links ──
  const cancelStudyMap = {};
  recentCancels.forEach(r => {
    const sn = r['Study Name'];
    if (!cancelStudyMap[sn]) cancelStudyMap[sn] = {count:0, study_url: studyUrl(r['Study Key'], r['Site Name'])};
    cancelStudyMap[sn].count++;
    if (!cancelStudyMap[sn].study_url) cancelStudyMap[sn].study_url = studyUrl(r['Study Key'], r['Site Name']);
  });
  const cancelByStudy = Object.entries(cancelStudyMap)
    .map(([full,v]) => ({name: full.split(' - ').pop(), full, count: v.count, study_url: v.study_url}))
    .sort((a,b) => b.count - a.count);

  // ── upcomingByStudy with CRIO links ──
  const upStudyMap = {};
  activeUpcoming.forEach(r => {
    const sn = r['Study Name'];
    if (!upStudyMap[sn]) upStudyMap[sn] = {count:0, study_url: studyUrl(r['Study Key'], r['Site Name']),
      site: siteSlug(r['Study Key'], r['Site Name'])===PNJ ? 'Pennington, NJ' : 'Philadelphia, PA'};
    upStudyMap[sn].count++;
    if (!upStudyMap[sn].study_url) upStudyMap[sn].study_url = studyUrl(r['Study Key'], r['Site Name']);
  });
  const upcomingByStudy = Object.entries(upStudyMap)
    .map(([full,v]) => ({name: full.split(' - ').pop(), full, count: v.count, site: v.site, study_url: v.study_url}))
    .sort((a,b) => b.count - a.count);

  // ── riskMatrix with CRIO links ──
  const riskMap = {};
  recentCancels.forEach(r => {
    const s=r['Study Name']; if (!riskMap[s]) riskMap[s]={study:s.split(' - ').pop(),full:s,cancel:0,upcoming:0,study_url:studyUrl(r['Study Key'],r['Site Name'])};
    riskMap[s].cancel++;
  });
  activeUpcoming.forEach(r => {
    const s=r['Study Name']; if (!riskMap[s]) riskMap[s]={study:s.split(' - ').pop(),full:s,cancel:0,upcoming:0,study_url:studyUrl(r['Study Key'],r['Site Name'])};
    riskMap[s].upcoming++;
  });
  const riskMatrix = Object.values(riskMap).map(r => {
    // Only apply risk scoring to actively enrolling studies
    const enrollStatus = (() => {
      const ed = (DATA.enrollmentData||[]).find(e=>e.study===r.study);
      return ed ? ed.status : 'Enrolling';
    })();
    if (enrollStatus !== 'Enrolling') {
      const lvl = enrollStatus === 'Maintenance' ? 'maintenance' : 'closed';
      return { study: r.study, full: r.full, study_url: r.study_url,
               cancels: r.cancel, upcoming: r.upcoming,
               score: 0, level: 'n/a', action: '—' };
    }
    const score = r.cancel * 0.6 + (1/(r.upcoming+1)) * 3;
    const level = score > 4 ? 'critical' : score > 2.5 ? 'high' : score > 1 ? 'medium' : 'low';
    return {...r, score: Math.round(score*100)/100, level,
      action: level==='critical'?'Immediate review':level==='high'?'Monitor closely':level==='medium'?'Watch':'On track'};
  }).sort((a,b) => b.score - a.score);

  // ── next14Detail with full patient links ──
  const next14Detail = activeUpcoming
    .filter(r => { const d=parseDate(r['Scheduled Date']); return d && d <= next14End; })
    .sort((a,b) => parseDate(a['Scheduled Date']) - parseDate(b['Scheduled Date']))
    .map(r => ({
      date: parseDate(r['Scheduled Date']).toLocaleDateString('en-US',{month:'short',day:'numeric'}),
      study: r['Study Name'] || '',
      study_url: studyUrl(r['Study Key'], r['Site Name']),
      visit: r['Name'] || '',
      patient: (r['Subject Full Name']||r['patient']||'').trim(),
      patient_url: patientUrl(r['Study Key'], r['Subject Key (Back End)'], r['Site Name']),
      status: r['Subject Status'] || '',
      coord: cleanCoord(r['Full Name']),
      site: siteSlug(r['Study Key'], r['Site Name'])===PNJ ? 'Pennington, NJ' : 'Philadelphia, PA'
    }));

  // ── riskFlags: 2+ cancels + upcoming visit ──
  // Event-based cancel counting: group by patient+study+cancel_date
  // Prevents bulk-cancelled visits (same cancel date) from inflating counts
  const cancelEventMap = {};  // key -> Set of cancel dates
  const cancelMeta = {};
  recentCancels.forEach(r => {
    const p=(r['Subject Full Name']||'').trim(), s=r['Study Name'], key=p+'|'+s;
    const cd = (r['Cancel Date']||'').substring(0,10);
    if (!cancelEventMap[key]) cancelEventMap[key] = new Set();
    cancelEventMap[key].add(cd);
    if (!cancelMeta[key] || cd > (cancelMeta[key].last_cancel||'')) {
      cancelMeta[key] = { last_cancel: cd,
        patient_url: patientUrl(r['Study Key'], r['Subject Key (Back End)'], r['Site Name']),
        study_url:   studyUrl(r['Study Key'], r['Site Name'])
      };
    }
  });
  const cancelCounts = {};
  Object.entries(cancelEventMap).forEach(([k, dates]) => { cancelCounts[k] = dates.size; });
  const upcomingPats = {};
  activeUpcoming.forEach(r => {
    const p=(r['Subject Full Name']||'').trim(), s=r['Study Name'], key=p+'|'+s;
    const d = parseDate(r['Scheduled Date']);
    if (!upcomingPats[key] || d < upcomingPats[key].date) {
      upcomingPats[key] = { date: d,
        date_str: d.toLocaleDateString('en-US',{month:'short',day:'numeric'}),
        patient_url: patientUrl(r['Study Key'], r['Subject Key (Back End)'], r['Site Name']),
        study_url:   studyUrl(r['Study Key'], r['Site Name'])
      };
    }
  });
  const riskFlags = Object.entries(cancelCounts)
    .filter(([k,c]) => c >= 2 && upcomingPats[k])
    .map(([k,c]) => {
      const [patient, study] = k.split('|');
      const meta = cancelMeta[k]||{}, up = upcomingPats[k];
      return { patient, study: study.split(' - ').pop(),
        patient_url: up.patient_url || meta.patient_url,
        study_url:   up.study_url   || meta.study_url,
        cancels: c, next_visit: up.date_str, last_cancel: meta.last_cancel||'' };
    }).sort((a,b) => new Date(new Date().getFullYear()+' '+a.next_visit) - new Date(new Date().getFullYear()+' '+b.next_visit));

  // ── coordinators ──
  const coordMap2 = {};
  activeUpcoming.forEach(r => {
    const cn = cleanCoord(r['Full Name']); if (!isCoord(r['Full Name'])) return;
    if (!coordMap2[cn]) coordMap2[cn] = {name:cn, upcoming:0, cancels:0, undoc:0,
      site: siteSlug(r['Study Key'],r['Site Name'])===PNJ?'Pennington, NJ':'Philadelphia, PA'};
    coordMap2[cn].upcoming++;
  });
  recentCancels.forEach(r => {
    const cn = cleanCoord(r['Staff Full Name']); if (!isCoord(r['Staff Full Name'])) return;
    if (!coordMap2[cn]) coordMap2[cn] = {name:cn, upcoming:0, cancels:0, undoc:0, site:'Philadelphia, PA'};
    coordMap2[cn].cancels++;
    if (!(r['Cancel Reason']||'').trim()) coordMap2[cn].undoc++;
  });
  const coordinators = Object.values(coordMap2).sort((a,b) => b.upcoming - a.upcoming);

  // ── investigators (from resolved investigator field) ──
  const invMap2 = {};
  activeUpcoming.forEach(r => {
    const inv = resolveInvestigator(r);
    if (!inv) return;
    const cn = cleanCoord(inv);
    if (!invMap2[cn]) invMap2[cn] = {name:cn, upcoming:0, cancels:0, studies: new Set()};
    invMap2[cn].upcoming++;
    invMap2[cn].studies.add((r['Study Name']||'').split(' - ').pop().trim());
  });
  const investigators = Object.values(invMap2).map(v => ({...v, studyCount: v.studies.size, studies: [...v.studies]})).sort((a,b) => b.upcoming - a.upcoming);

  // ── coordinator daily goals (weekdays only) ──
  // Use upcomingAllSnapshots (all daily CRIO snapshots) so past visits are included.
  // The seenCoordVisits set deduplicates by coord+date+subjectId across snapshots.
  const COORD_NAMES = CRP_CONFIG.COORDINATORS || [];
  const COORD_LOWER = COORD_NAMES.map(c => c.toLowerCase());
  const coordGoals = { byDay: {}, byMonth: {}, byDayDetail: {} };
  const seenCoordVisits = new Set();
  COORD_NAMES.forEach(c => { coordGoals.byDay[c] = {}; coordGoals.byMonth[c] = 0; coordGoals.byDayDetail[c] = {}; });
  const _cgNow = new Date();
  const _cgMM = String(_cgNow.getMonth()+1).padStart(2,'0');
  const _cgYY = _cgNow.getFullYear();
  const _cgMonthStart = `${_cgYY}-${_cgMM}-01`;
  upcomingAllSnapshots.forEach(r => {
    const rawName = normName(r['Full Name']);
    const date = (r['Scheduled Date']||'').trim();
    const subjectId = (r['Subject ID']||'').trim();
    if (!date || date < _cgMonthStart) return; // only this month onward
    // Skip weekend visits (Sat=6, Sun=0)
    const dayOfWeek = new Date(date + 'T12:00:00').getDay();
    if (dayOfWeek === 0 || dayOfWeek === 6) return;
    if (isExcludedStudy(r['Study Name'])) return;
    const idx = COORD_LOWER.indexOf(rawName.toLowerCase());
    if (idx === -1) return;
    const name = COORD_NAMES[idx]; // use canonical name
    const key = name + '|' + date + '|' + subjectId;
    if (seenCoordVisits.has(key)) return;
    seenCoordVisits.add(key);
    coordGoals.byDay[name][date] = (coordGoals.byDay[name][date]||0) + 1;
    if (!coordGoals.byDayDetail[name][date]) coordGoals.byDayDetail[name][date] = [];
    const _ptName = normName(r['Subject Full Name']);
    const _ptStudy = (r['Study Name']||'').split(' - ').pop().trim();
    const _ptUrl = patientUrl(r['Study Key'], r['Subject Key (Back End)'], r['Site Name']);
    coordGoals.byDayDetail[name][date].push({ patient: _ptName, study: _ptStudy, url: _ptUrl });
    if (date >= _cgMonthStart && date <= `${_cgYY}-${_cgMM}-31`) coordGoals.byMonth[name]++;
  });

  // ── cancelReasons (only true cancellations — excludes rescheduled, completed, admin error, fibroscan, study closed) ──
  const rb = {};
  recentCancels.forEach(r => {
    const cat = r._category || categorizeReason(r['Cancel Reason'], r['Appointment Cancellation Type']);
    rb[cat] = (rb[cat]||0) + 1;
  });
  const cancelReasons = Object.entries(rb).map(([reason,count])=>({reason,count})).sort((a,b)=>b.count-a.count);

  // ── site totals ──
  const phillyUp     = activeUpcoming.filter(r => siteSlug(r['Study Key'],r['Site Name'])===PHL).length;
  const pennUp       = activeUpcoming.filter(r => siteSlug(r['Study Key'],r['Site Name'])===PNJ).length;
  const phillyCancel = recentCancels.filter(r  => (r['Site Name']||'').includes('Phila')).length;
  const pennCancel   = recentCancels.filter(r  => (r['Site Name']||'').includes('Penn')).length;
  const phillySt     = new Set(activeUpcoming.filter(r=>siteSlug(r['Study Key'],r['Site Name'])===PHL).map(r=>r['Study Name']));
  const pennSt       = new Set(activeUpcoming.filter(r=>siteSlug(r['Study Key'],r['Site Name'])===PNJ).map(r=>r['Study Name']));

  const subjectStatus = groupBy(activeUpcoming, 'Subject Status').slice(0,6)
    .map(x => ({status:x.name, count:x.count}));

  const marchTotal = activeUpcoming.filter(r => parseDate(r['Scheduled Date'])?.getMonth()===2).length;
  const aprilTotal = activeUpcoming.filter(r => parseDate(r['Scheduled Date'])?.getMonth()===3).length;


  // ── actionDetails from live CSV ──
  const sfGroups = {}, protoUpdates = {}, reschedPromises = [], noShowUnreach = [];
  const reschedNeeded = [], wdrRecoverable = [], wdrFinal = [], adminFixes = [];
  const undocumentedList = [];

  const SF_CONCURRENT  = /enrolled in|concurrent|other (study|trial)/i;
  const SF_MED         = /excluded medication|on an excluded/i;
  const SF_PROTOCOL    = /changes in the protocol/i;
  const SF_CONDITION   = /autoimmune|overactive|does not qualify|dnq|screen.?fail|screenfail/i;
  const RESCHEDULE_PAT = /will call back|call back|reach out to reschedul|left vm|needs to reschedul|patient left vm|will reach out|cant make it/i;
  const NS_UNREACH     = /mailbox full|unable to (lm|get in contact|reach)|never reached|unresponsive/i;
  const WITHDREW_PRIV  = /not comfortable|medical records/i;
  const WITHDREW_COMP  = /compensation|not satisfied/i;
  const WITHDREW_FINAL = /no longer interested|not interested|withdrew consent|withdrew|do not solicit/i;
  const ADMIN_ERR      = /entered in error|scheduled in error|wrong study|scheduled under/i;
  const STUDY_CLOSE    = /study.?clos|clos.*study/i;
  const FIBRO_PAT      = /fibroscan|fibrosan|fibro scan|scan only|scan visit/i;

  function sfKey(sub, study) { return sub + '|' + study; }

  // Use allCategorizedForDetail for actionDetails (includes all categories for routing)
  allCategorizedForDetail.forEach(r => {
    const reason = r['Cancel Reason']||'', atype = r['Appointment Cancellation Type']||'';
    const patient = (r['Subject Full Name']||'').trim(), study = (r['Study Name']||'').split(' - ').pop();
    const pu = patientUrl(r['Study Key'], r['Subject Key (Back End)'], r['Site Name']);
    const su = studyUrl(r['Study Key'], r['Site Name']);
    const coord = cleanCoord(r['Staff Full Name']||r['Full Name']||'');
    const cancelDate = (() => { try { const d=new Date(r['Cancel Date']); return d.toLocaleDateString('en-US',{month:'short',day:'numeric'}); } catch(e) { return ''; } })();
    const row = {name: patient, patient, study, url: pu, study_url: su, reason: reason.substring(0,80), coord, cancel_date: cancelDate};
    const cat = r._category;

    // Skip excluded categories from action routing (they're not real cancellations)
    if (cat === 'Completed' || cat === 'FibroScan Only' || cat === 'Study Closed' || cat === 'Admin Error') return;
    // Rescheduled: route to reschedule promises for follow-up only
    if (cat === 'Rescheduled') {
      reschedPromises.push({...row, still_upcoming: false});
      return;
    }

    // Truly undocumented: no reason at all
    if (cat === 'Not Documented') {
      undocumentedList.push({name:patient, url:pu, study, study_url:su, coord, type:atype, reason:reason||'', cancel_date:cancelDate, category:'Not Documented'});
    }

    if (SF_PROTOCOL.test(reason)) {
      if (!protoUpdates[study]) protoUpdates[study] = {patients:[],study_url:su};
      protoUpdates[study].patients.push({name:patient,url:pu});
    } else if (SF_CONCURRENT.test(reason)) {
      const k = sfKey('concurrent',study);
      if (!sfGroups[k]) sfGroups[k] = {patients:[],reasons:[],study_url:su};
      sfGroups[k].patients.push({name:patient,url:pu}); sfGroups[k].reasons.push(reason);
    } else if (SF_MED.test(reason)) {
      const k = sfKey('medication',study);
      if (!sfGroups[k]) sfGroups[k] = {patients:[],reasons:[],study_url:su};
      sfGroups[k].patients.push({name:patient,url:pu}); sfGroups[k].reasons.push(reason);
    } else if (SF_CONDITION.test(reason) || /per pi|per dr|inclusion \d|screen.?fail|does not qualify|dnq|pt does not qualify/i.test(reason)) {
      const sub = /autoimmune|overactive/i.test(reason)?'condition':/inclusion \d{4}/i.test(reason)?'age_inclusion':/inclusion \d[a-z]/i.test(reason)?'inclusion_criterion':/consent|did not sign/i.test(reason)?'consent':'generic';
      const k = sfKey(sub,study);
      if (!sfGroups[k]) sfGroups[k] = {patients:[],reasons:[],study_url:su};
      sfGroups[k].patients.push({name:patient,url:pu}); sfGroups[k].reasons.push(reason);
    } else if (RESCHEDULE_PAT.test(reason) && atype !== 'No Show') {
      reschedPromises.push({...row, still_upcoming: false});
    } else if (atype === 'No Show') {
      if (NS_UNREACH.test(reason)) noShowUnreach.push(row);
      else reschedNeeded.push({...row, still_upcoming: true});
    } else if (WITHDREW_PRIV.test(reason)) {
      wdrRecoverable.push({...row, sub:'privacy'});
    } else if (WITHDREW_COMP.test(reason)) {
      wdrRecoverable.push({...row, sub:'compensation'});
    } else if (WITHDREW_FINAL.test(reason)) {
      wdrFinal.push(row);
    } else if (ADMIN_ERR.test(reason)) {
      adminFixes.push(row);
    }
  });

  const actionDetails = {
    undocumented: undocumentedList,
    screen_fail_groups: sfGroups,
    protocol_updates: protoUpdates,
    open_reschedule_promises: reschedPromises,
    no_show_unreachable: noShowUnreach,
    reschedule_needed: reschedNeeded,
    withdrew_recoverable: wdrRecoverable,
    withdrew_final: wdrFinal,
    admin_fixes: adminFixes
  };

  // ── Build visitTypes from upcoming visits ──
  const _vtCounts = {};
  activeUpcoming.forEach(r => {
    const visit = (r['Name'] || r['Appointment Type'] || '').trim();
    let vType = 'Other';
    const vl = visit.toLowerCase();
    if (/screen|v1\/screen|main screen/i.test(vl)) vType = 'Screening';
    else if (/treatment|cycle|week|v\d|visit\s*\d|infusion|injection|dose/i.test(vl)) vType = 'Treatment';
    else if (/follow.?up|end.?of.?study|eos|final|completion|closeout/i.test(vl)) vType = 'Follow-Up';
    else if (/random|baseline/i.test(vl)) vType = 'Randomization';
    _vtCounts[vType] = (_vtCounts[vType] || 0) + 1;
  });
  const visitTypes = Object.entries(_vtCounts)
    .map(([type, count]) => ({ type, count }))
    .sort((a, b) => b.count - a.count);

  return {
    actionDetails,
    visitTypes,
    today: today.toLocaleDateString('en-US',{month:'short',day:'numeric',year:'numeric'}),
    upcomingTotal: activeUpcoming.length,
    cancelTotal: recentCancels.length,
    next14: next14Detail.length,
    atRisk: riskMatrix.filter(r=>r.level==='critical'||r.level==='high').length,
    activeStudies: upcomingByStudy.length,
    cancelWeekly: weekBucket(recentCancels,'Cancel Date'),
    upcomingWeekly: weekBucket(activeUpcoming,'Scheduled Date'),
    cancelByStudy,
    upcomingByStudy,
    upcomingByStudyFull: upcomingByStudy,
    cancelReasons,
    riskMatrix,
    subjectStatus,
    coordinators,
    investigators,
    coordGoals,
    next14Detail,
    riskFlags,
    sites: [
      {site:'Philadelphia, PA',cancels:phillyCancel,upcoming:phillyUp,studies:phillySt.size,
       cancelRate:+((phillyCancel/(phillyUp+phillyCancel||1))*100).toFixed(1)},
      {site:'Pennington, NJ',  cancels:pennCancel,  upcoming:pennUp,  studies:pennSt.size,
       cancelRate:+((pennCancel/(pennUp+pennCancel||1))*100).toFixed(1)},
    ],
    phillyTotal: phillyUp,
    pennTotal: pennUp,
    marchTotal,
    aprilTotal,
    allVisitDetail: activeUpcoming.sort((a,b) => {
      const da = parseDate(a['Scheduled Date']||''), db = parseDate(b['Scheduled Date']||'');
      return (da||0) - (db||0);
    }).map(r => {
      const sk = r['Study Key'], subk = r['Subject Key (Back End)'];
      const pnj = [161619,162446,167755,167794,172389,173164];
      const site = pnj.includes(+sk) ? 'clinical-research-philadelphia-pennington' : 'philadelphia-pa';
      const base = `https://app.clinicalresearch.io/clinical-research-philadelphia-crp/${site}`;
      const d = parseDate(r['Scheduled Date']||'');
      return {
        date: d ? d.toLocaleDateString('en-US',{month:'short',day:'numeric'}) : '—',
        date_iso: r['Scheduled Date']||'',
        study: (r['Study Name']||'').split(' - ').pop().trim(),
        study_url: `${base}/study/${+sk}/subjects`,
        visit: r['Name']||r['Appointment Type']||'',
        patient: (r['Subject Full Name']||'').replace(/\s{2,}/g,' ').trim(),
        patient_url: `${base}/study/${+sk}/subject/${+subk}`,
        status: r['Subject Status']||'',
        coord: cleanCoord(r['Full Name']),
        investigator: cleanCoord(resolveInvestigator(r)),
        site: r['Site Name']||'',
      };
    }),
    allCancels: recentCancels.map(r => ({
      name: (r['Subject Full Name']||'').replace(/\s{2,}/g,' ').trim(),
      url: (() => { try { const sk=r['Study Key'],subk=r['Subject Key (Back End)'],pnj=[161619,162446,167755,167794,172389,173164];const site=pnj.includes(+sk)?'clinical-research-philadelphia-pennington':'philadelphia-pa';return `https://app.clinicalresearch.io/clinical-research-philadelphia-crp/${site}/study/${+sk}/subject/${+subk}`;}catch(e){return '';}})(),
      study: (r['Study Name']||'').split(' - ').pop().trim(),
      study_url: (() => { try { const sk=r['Study Key'],pnj=[161619,162446,167755,167794,172389,173164];const site=pnj.includes(+sk)?'clinical-research-philadelphia-pennington':'philadelphia-pa';return `https://app.clinicalresearch.io/clinical-research-philadelphia-crp/${site}/study/${+sk}/subjects`;}catch(e){return '';}})(),
      coord: cleanCoord(r['Staff Full Name'] || r['Full Name']),
      type: r['Appointment Cancellation Type']||'',
      reason: r['Cancel Reason']||'',
      category: r._category || categorizeReason(r['Cancel Reason'], r['Appointment Cancellation Type']),
      cancel_date: (() => { try { const d=new Date(r['Cancel Date']);return d.toLocaleDateString('en-US',{month:'short',day:'numeric'});}catch(e){return '';}})()
    })),
    // ── Preserve enrollmentData from SAMPLE and rebuild mergedStudies with live counts ──
    enrollmentData: (typeof DATA !== 'undefined' ? DATA.enrollmentData : null) || SAMPLE.enrollmentData || [],
    mergedStudies: (() => {
      const ed = (typeof DATA !== 'undefined' && DATA.enrollmentData) ? DATA.enrollmentData : (SAMPLE.enrollmentData || []);
      // Build study-level cancel/upcoming counts from live data
      const liveCancels = {};
      cancelByStudy.forEach(s => { liveCancels[s.name] = s.count; liveCancels[s.full] = s.count; });
      const liveUpcoming = {};
      const liveStudyUrl = {};
      const liveSites = {};
      upcomingByStudy.forEach(s => {
        liveUpcoming[s.name] = s.count; liveUpcoming[s.full] = s.count;
        liveStudyUrl[s.name] = s.study_url; liveStudyUrl[s.full] = s.study_url;
        if (s.site) { if (!liveSites[s.name]) liveSites[s.name] = new Set(); liveSites[s.name].add(s.site.includes('Penn') ? 'PNJ' : 'PHL'); }
      });
      const riskLookup = {};
      riskMatrix.forEach(r => { riskLookup[r.study] = r; riskLookup[r.full] = r; });
      return ed.map(e => {
        const shortName = e.study;
        const c = liveCancels[shortName] || 0;
        const u = liveUpcoming[shortName] || 0;
        const rm = riskLookup[shortName] || {};
        return {
          study: shortName,
          study_url: liveStudyUrl[shortName] || e.study_url || '',
          sites: e.sites || (liveSites[shortName] ? [...liveSites[shortName]] : ['PHL']),
          enroll_status: e.status || 'Enrolling',
          cancels: c,
          upcoming: u,
          risk_score: rm.score || 0,
          risk_level: rm.level || (e.status !== 'Enrolling' ? 'n/a' : 'low'),
          target: e.target,
          enrolled: e.enrolled || 0,
          pct: e.pct || 0,
          remaining: e.remaining || 0,
          over: e.over || 0,
          screening: e.screening || 0,
          screened: e.screened || 0,
          screen_fail: e.screen_fail || 0,
          screen_fail_pct: e.screen_fail_pct || 0,
          active: e.active || 0,
          completed: e.completed || 0
        };
      }).sort((a,b) => b.risk_score - a.risk_score);
    })(),
  };
}

async function refreshData() {
  const badge = document.getElementById('last-refresh-badge');
  if (badge) badge.textContent = 'Refreshing...';
  try {
    // Phase 1: CRIO data
    const [rows1, legacyCancels, auditRows] = await Promise.all([
      fetchCSV(LIVE_URL1),
      fetchCSV(LIVE_URL2_LEGACY).catch(() => []),
      fetchCSV(AUDIT_LOG_URL).catch(() => [])
    ]);
    const newData = processLiveData(rows1, legacyCancels, auditRows);
    if ((newData.upcomingTotal || 0) < 5 && (DATA.upcomingTotal || 0) > 5) {
      console.warn('CRP Refresh: new data looks empty — keeping previous data');
      if (badge) badge.textContent = 'Refresh returned empty data';
    } else {
      DATA = newData;
      renderAll();
      if (badge) badge.textContent = 'Updated: ' + new Date().toLocaleTimeString();
    }
    // Phase 2: Finance (staggered)
    fetchFinanceLive().then(ok => {
      if (ok) {
        if (typeof renderForecast === 'function') try { renderForecast(); } catch(e) {}
        if (typeof drawPayChartOverview === 'function') try { drawPayChartOverview(); } catch(e) {}
      }
    }).catch(() => {});
    // Phase 3: Supplemental (staggered)
    setTimeout(() => {
      fetchPatientDB().catch(e => console.warn('Patient DB refresh failed:', e));
      fetchFacebookCRM().catch(() => {});
    }, 1500);
  } catch(e) {
    if (badge) badge.textContent = 'Refresh failed — click to retry';
    console.error(e);
  }
}

// ═══════════════════════════════════════════════════
// RENDER ALL
// ═══════════════════════════════════════════════════
// ── Dismissed actions persistence ──
var DISMISSED_ACTIONS_KEY = 'crp_dismissed_actions_v1';

function loadDismissedActions() {
  try { return JSON.parse(localStorage.getItem(DISMISSED_ACTIONS_KEY) || '{}'); } catch(e) { return {}; }
}
function saveDismissedActions(map) {
  try { localStorage.setItem(DISMISSED_ACTIONS_KEY, JSON.stringify(map)); } catch(e) {}
}
function dismissAction(actionId, reason) {
  var map = loadDismissedActions();
  map[actionId] = { reason: reason || 'dismissed', date: localISO(new Date()) };
  // Auto-prune entries older than 60 days
  var cutoff = new Date(); cutoff.setDate(cutoff.getDate() - 60);
  var cutISO = localISO(cutoff);
  Object.keys(map).forEach(function(k) { if (map[k].date < cutISO) delete map[k]; });
  saveDismissedActions(map);
  buildActionSteps(); // re-render
}
function undismissAction(actionId) {
  var map = loadDismissedActions();
  delete map[actionId];
  saveDismissedActions(map);
  buildActionSteps();
}

function buildActionSteps() {
  const el     = document.getElementById('action-steps');
  const dormEl = document.getElementById('dormant-list');
  if (!el) return;

  const dismissed = loadDismissedActions();
  const flags  = DATA.riskFlags || [];
  const ad     = DATA.actionDetails || {};
  const today  = new Date(); today.setHours(0,0,0,0);

  function daysUntil(dateStr) {
    const m={Jan:0,Feb:1,Mar:2,Apr:3,May:4,Jun:5,Jul:6,Aug:7,Sep:8,Oct:9,Nov:10,Dec:11};
    const p=dateStr.split(' ');
    return Math.round((new Date(today.getFullYear(),m[p[0]],parseInt(p[1]))-today)/86400000);
  }
  function pLink(name,url,color){
    color=color||'#072061';
    var masked = maskPHI(name);
    return url?`<a href="${url}" target="_blank" rel="noopener" onclick="event.stopPropagation()" style="color:${color};font-weight:700;text-decoration:underline;text-decoration-style:dotted;">${masked}</a>`:`<strong style="color:${color}">${masked}</strong>`;
  }
  function sLink(name,url){
    return url?`<a href="${url}" target="_blank" rel="noopener" onclick="event.stopPropagation()" style="color:inherit;font-weight:600;text-decoration:underline;text-decoration-style:dotted;">${name}</a>`:`<span style="font-weight:600">${name}</span>`;
  }
  function typeBadge(type){
    const map={'No Show':['#fef2f2','#dc2626'],'Patient Cancelled':['#fff7ed','#c2410c'],'Site Cancelled':['#eff6ff','#1843ad']};
    const [bg,col]=map[type]||['#f8fafc','#64748b'];
    return type?`<span style="font-size:9px;padding:1px 5px;border-radius:3px;background:${bg};color:${col};font-weight:700;">${type}</span>`:'';
  }
  function coordChip(name){
    if(!name||name==='nan'||name==='Automated System') return '';
    return `<span style="font-size:10px;background:#f1f5f9;border-radius:4px;padding:1px 6px;color:#475569;font-weight:600;">👤 ${name}</span>`;
  }

  // ── Patient table row ──
  function patRow(p, showReason){
    const reasonCell = showReason!==false && p.reason
      ? `<span style="font-size:10px;color:#94a3b8;font-style:italic;flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;" title="${p.reason}">"${p.reason}"</span>`
      : '';
    const typeCell = typeBadge(p.type||'');
    const coordCell = coordChip(p.coord);
    return `<div style="display:grid;grid-template-columns:160px 120px auto;gap:4px 10px;align-items:center;padding:5px 0;border-bottom:1px solid #f8fafc;font-size:12px;">
      <span style="font-weight:600;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${pLink(p.name,p.url)}</span>
      <span style="font-size:11px;color:#64748b;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${p.study||''}</span>
      <div style="display:flex;gap:6px;align-items:center;flex-wrap:wrap;">${typeCell}${coordCell}${reasonCell}</div>
    </div>`;
  }

  // ── Undocumented table ── grouped by coordinator
  function undocTable(rows){
    const byCoord={};
    rows.forEach(p=>{
      const c=p.coord||'Unknown';
      if(!byCoord[c]) byCoord[c]=[];
      byCoord[c].push(p);
    });
    return Object.entries(byCoord).sort((a,b)=>b[1].length-a[1].length).map(([coord,pts])=>`
      <div style="margin-bottom:10px;">
        <div style="font-size:11px;font-weight:700;color:#475569;margin-bottom:4px;padding:4px 8px;background:#f8fafc;border-radius:4px;">
          👤 ${coord} <span style="font-weight:400;color:#94a3b8;">(${pts.length} missing)</span>
        </div>
        ${pts.map(p=>`<div style="display:grid;grid-template-columns:160px 120px 90px 1fr;gap:4px 10px;align-items:center;padding:5px 8px;font-size:12px;border-bottom:1px solid #f8fafc;">
          <span style="font-weight:600;">${pLink(p.name,p.url)}</span>
          <span style="font-size:11px;color:#64748b;">${p.study||''}</span>
          <span style="font-size:10px;color:#94a3b8;">${p.cancel_date||''}</span>
          ${typeBadge(p.type||'')}
        </div>`).join('')}
      </div>`).join('');
  }

  const steps=[];

  // ═══ 1. URGENT CALLS ════════════════════════════════
  flags.filter(f=>daysUntil(f.next_visit)<=14).forEach(f=>{
    const d=daysUntil(f.next_visit);
    const urgency=d===0?'🔴 TODAY':d===1?'🔴 TOMORROW':`🔴 in ${d} days`;
    steps.push({pri:1,id:'urgent-'+(f.patient||'').replace(/\s+/g,'-').toLowerCase(),icon:'📞',tag:'URGENT CALL',tagBg:'#fef2f2',tagColor:'#dc2626',
      title:`Call ${pLink(f.patient,f.patient_url,'#dc2626')} — next visit ${f.next_visit} <strong style="color:#dc2626">${urgency}</strong>`,
      body:`<div style="display:flex;gap:8px;align-items:center;margin-top:4px;flex-wrap:wrap;">
        ${sLink(f.study,f.study_url)}
        <span style="color:#94a3b8">·</span>
        <span style="font-size:11px;color:#94a3b8">${f.cancels} prior cancel${f.cancels>1?'s':''}</span>
      </div>`,
      action:'Call before visit. Confirm attendance, surface barriers. If no answer: try alternate contact, note attempt in CRIO, flag coordinator.'
    });
  });

  // ═══ 2. UNDOCUMENTED ════════════════════════════════
  const undoc=ad.undocumented||[];
  if(undoc.length>0){
    steps.push({pri:2,id:'undoc-'+undoc.length,icon:'📝',tag:'DOCUMENTATION REQUIRED',tagBg:'#fef3c7',tagColor:'#92400e',
      title:`${undoc.length} cancellations missing a reason — CRIO records incomplete`,
      body:`<div style="margin-top:8px;">${undocTable(undoc)}</div>`,
      action:'Each coordinator must log into CRIO and add the cancellation reason for their patients above. Undocumented visits skew all reporting and risk scoring.'
    });
  }

  // ═══ 3. PRE-SCREENER UPDATE ════════════════════════
  const pu=ad.protocol_updates||{};
  Object.entries(pu).forEach(([study,v])=>{
    const pts=v.patients||[];
    steps.push({pri:3,id:'prescr-'+study.replace(/\s+/g,'-').toLowerCase(),icon:'📋',tag:'PRE-SCREENER UPDATE',tagBg:'#fef3c7',tagColor:'#b45309',
      title:`Protocol criteria changed · ${sLink(study,v.study_url)}`,
      body:`<div style="padding:8px 10px;background:#fef3c7;border-radius:6px;border-left:3px solid #f59e0b;font-size:11px;margin:6px 0;">
        ➤ Revise pre-screening script to reflect updated inclusion/exclusion criteria before booking new patients
      </div><div style="margin-top:4px;">${pts.map(p=>patRow(p,true)).join('')}</div>`,
      action:''
    });
  });

  // ═══ 4. SCREEN FAILS ════════════════════════════════
  const sfGroups=ad.screen_fail_groups||{};
  const sfByStudy={};
  Object.entries(sfGroups).forEach(([key,v])=>{
    const [sub,study]=key.split('|');
    if(!sfByStudy[study]) sfByStudy[study]={groups:[],url:v.study_url};
    sfByStudy[study].groups.push({sub,patients:v.patients});
  });
  Object.entries(sfByStudy).forEach(([study,data])=>{
    const allPts=data.groups.flatMap(g=>g.patients);
    const subs=data.groups.map(g=>g.sub);
    const fixes=[];
    if(subs.includes('concurrent'))    fixes.push('Add <em>"Are you currently enrolled in another trial?"</em> to your first call');
    if(subs.includes('medication'))    fixes.push('Add excluded medications checklist — ask about current meds before booking');
    if(subs.includes('age_inclusion')||subs.includes('inclusion_criterion')) fixes.push('Verify inclusion criteria verbally during pre-screen — do not leave for visit day');
    if(subs.includes('consent'))       fixes.push('Confirm willingness to sign consent before scheduling');
    if(subs.includes('condition'))     fixes.push('Add targeted medical history questions for this study\'s key exclusion conditions');
    if(subs.includes('generic'))       fixes.push('Review full eligibility checklist — multiple DNQs suggest a pre-screening gap');
    const fixHTML=fixes.length?`<div style="padding:8px 10px;background:#fff7ed;border-radius:6px;border-left:3px solid #f97316;font-size:11px;line-height:1.9;margin:6px 0;">${fixes.map(f=>'➤ '+f).join('<br>')}</div>`:'';
    steps.push({pri:4,id:'sf-'+study.replace(/\s+/g,'-').toLowerCase(),icon:'🔍',tag:'SCREEN FAIL',tagBg:'#fff7ed',tagColor:'#c2410c',
      title:`${allPts.length} screen fail${allPts.length>1?'s':''} · ${sLink(study,data.url)}`,
      body:fixHTML+`<div style="margin-top:4px;">${allPts.map(p=>patRow(p,true)).join('')}</div>`,
      action:''
    });
  });

  // ═══ 5. RESCHEDULE PROMISES ═════════════════════════
  const rp=ad.open_reschedule_promises||[];
  if(rp.length>0) steps.push({pri:5,id:'followup-'+rp.length,icon:'📅',tag:'FOLLOW UP',tagBg:'#eff6ff',tagColor:'#1843ad',
    title:`${rp.length} patient${rp.length>1?'s':''} said they'd call back — no confirmed date yet`,
    body:`<div style="margin-top:6px;">${rp.map(p=>patRow(p,true)).join('')}</div>`,
    action:'Do not wait for them to call. Reach out today — patients who say they\'ll call back rarely do without a prompt.'
  });

  // ═══ 6. UNREACHABLE ═════════════════════════════════
  const nsu=ad.no_show_unreachable||[];
  if(nsu.length>0) steps.push({pri:6,id:'unreach-'+nsu.length,icon:'🔇',tag:'UNREACHABLE',tagBg:'#fef2f2',tagColor:'#dc2626',
    title:`${nsu.length} patient${nsu.length>1?'s':''} — voicemail full or no response to multiple attempts`,
    body:`<div style="margin-top:6px;">${nsu.map(p=>patRow(p,true)).join('')}</div>`,
    action:'Try one alternate contact method (email, alternate number). If still no response in 5 business days: document as Lost to Follow-Up in CRIO and remove from active pipeline.'
  });

  // ═══ 7. NO SHOW FOLLOW-UP ═══════════════════════════
  const ns=(ad.reschedule_needed||[]);
  const nsWithUpcoming=ns.filter(p=>p.still_upcoming);
  const nsNoUpcoming=ns.filter(p=>!p.still_upcoming);
  if(nsWithUpcoming.length>0) steps.push({pri:7,id:'ns-upcoming-'+nsWithUpcoming.length,icon:'📱',tag:'NO SHOW — UPCOMING VISIT',tagBg:'#fdf4ff',tagColor:'#7e22ce',
    title:`${nsWithUpcoming.length} patients no-showed but still have visits on the books`,
    body:`<div style="padding:6px 10px;background:#fdf4ff;border-radius:6px;border-left:3px solid #a855f7;font-size:11px;margin:6px 0;">
      ⚠️ These patients did not show — but future visits are still scheduled. Confirm attendance now or reschedule.
    </div><div style="margin-top:4px;">${nsWithUpcoming.map(p=>patRow(p,true)).join('')}</div>`,
    action:'Text + call each patient today. Confirm the upcoming visit explicitly. Log all contact attempts in CRIO.'
  });
  if(nsNoUpcoming.length>0) steps.push({pri:8,id:'ns-resched-'+nsNoUpcoming.length,icon:'📋',tag:'NO SHOW — RESCHEDULE',tagBg:'#f5f3ff','tagColor':'#5b21b6',
    title:`${nsNoUpcoming.length} no-shows with no future visit scheduled`,
    body:`<div style="margin-top:6px;">${nsNoUpcoming.slice(0,6).map(p=>patRow(p,true)).join('')}${nsNoUpcoming.length>6?`<div style="padding:4px 0;color:#94a3b8;font-size:11px;">+${nsNoUpcoming.length-6} more</div>`:''}</div>`,
    action:'Reach out to reschedule. If no response in 5 days: document as LTF.'
  });

  // ═══ 8. RETENTION ═══════════════════════════════════
  const wr=ad.withdrew_recoverable||[];
  wr.forEach(p=>{
    const action=p.sub==='privacy'?'Patient concerned about releasing medical records — call to clarify what is actually needed. Often resolvable.'
      :p.sub==='compensation'?'Patient withdrew over compensation — review how it is communicated during consent. May be a realistic expectation mismatch.'
      :'Follow up to understand the barrier and attempt recovery.';
    steps.push({pri:9,id:'retain-'+(p.name||'').replace(/\s+/g,'-').toLowerCase(),icon:'💬',tag:'RETENTION CALL',tagBg:'#f0fdf4',tagColor:'#15803d',
      title:`Recovery call · ${pLink(p.name,p.url)} · ${sLink(p.study,p.study_url)}`,
      body:`<div style="margin-top:4px;">${patRow(p,true)}</div>`,action
    });
  });

  // ═══ 9. PROACTIVE (risk flags >14d) ═════════════════
  flags.filter(f=>daysUntil(f.next_visit)>14).forEach(f=>{
    steps.push({pri:10,id:'proactive-'+(f.patient||'').replace(/\s+/g,'-').toLowerCase(),icon:'⚠️',tag:'PROACTIVE OUTREACH',tagBg:'#fffbeb',tagColor:'#d97706',
      title:`Pre-call ${pLink(f.patient,f.patient_url)} — ${f.cancels}× cancelled, next visit ${f.next_visit} (${daysUntil(f.next_visit)} days)`,
      body:`${sLink(f.study,f.study_url)}`,
      action:"Don't wait for another no-show. Call now — confirm intent, ask about barriers, lock in the date."
    });
  });

  // ═══ 10. ADMIN FIXES ════════════════════════════════
  const ae=ad.admin_fixes||[];
  if(ae.length>0) steps.push({pri:11,id:'admin-'+ae.length,icon:'🛠',tag:'ADMIN FIX',tagBg:'#f8fafc',tagColor:'#475569',
    title:`${ae.length} scheduling error${ae.length>1?'s':''} — correct in CRIO`,
    body:`<div style="margin-top:6px;">${ae.map(p=>patRow(p,true)).join('')}</div>`,
    action:'Entries logged in error, wrong study, or duplicate records. Fix now to keep downstream reporting clean.'
  });

  // ═══ 11. CLOSE RECORDS ══════════════════════════════
  const wf=ad.withdrew_final||[];
  if(wf.length>0) steps.push({pri:12,id:'close-'+wf.length,icon:'📁',tag:'CLOSE RECORDS',tagBg:'#f8fafc',tagColor:'#64748b',
    title:`${wf.length} final withdrawal${wf.length>1?'s':''} — ensure CRIO updated`,
    body:`<div style="margin-top:6px;">${wf.map(p=>patRow(p,true)).join('')}</div>`,
    action:'Update subject status to Withdrawn in CRIO. Add withdrawal reason if missing. Remove from active pipeline and close any future visits.'
  });

  // ── Render ──
  steps.sort((a,b)=>a.pri-b.pri);

  // Split into active vs dismissed
  var activeSteps = steps.filter(s => !dismissed[s.id]);
  var dismissedSteps = steps.filter(s => dismissed[s.id]);

  var dismissBtnStyle = 'background:none;border:1px solid #e2e8f0;border-radius:5px;padding:3px 10px;font-size:10px;cursor:pointer;color:#94a3b8;transition:all .15s;';

  el.innerHTML = activeSteps.map(s=>`
    <div style="display:flex;gap:14px;padding:20px 0;border-bottom:1px solid #f1f5f9;align-items:flex-start;" id="action-${s.id}">
      <div style="font-size:22px;flex-shrink:0;width:32px;text-align:center;padding-top:2px;">${s.icon}</div>
      <div style="flex:1;min-width:0;">
        <div style="margin-bottom:7px;display:flex;justify-content:space-between;align-items:center;">
          <span style="font-size:10px;font-weight:800;letter-spacing:.5px;padding:3px 10px;border-radius:4px;background:${s.tagBg};color:${s.tagColor};">${s.tag}</span>
          <div style="display:flex;gap:6px;flex-shrink:0;">
            <button onclick="dismissAction('${s.id}','done')" style="${dismissBtnStyle}" onmouseover="this.style.borderColor='#16a34a';this.style.color='#16a34a'" onmouseout="this.style.borderColor='#e2e8f0';this.style.color='#94a3b8'" title="Mark as done">&#x2713; Done</button>
            <button onclick="dismissAction('${s.id}','skip')" style="${dismissBtnStyle}" onmouseover="this.style.borderColor='#94a3b8';this.style.color='#64748b'" onmouseout="this.style.borderColor='#e2e8f0';this.style.color='#94a3b8'" title="Dismiss / not applicable">&#x2715; Skip</button>
          </div>
        </div>
        <div style="font-size:13px;font-weight:700;color:#1e293b;margin-bottom:6px;line-height:1.4;">${s.title}</div>
        <div style="font-size:12px;color:#475569;line-height:1.5;">${s.body}</div>
        ${s.action?`<div style="margin-top:8px;padding:6px 10px;background:#f8fafc;border-radius:6px;border-left:2px solid #cbd5e1;font-size:11px;color:#64748b;line-height:1.5;">
          <strong style="color:#475569;">What to do:</strong> ${s.action}</div>`:''}
      </div>
    </div>`).join('');

  // Show dismissed count with undo option
  if (dismissedSteps.length > 0) {
    el.innerHTML += `<div style="padding:16px 0;text-align:center;">
      <button onclick="document.getElementById('dismissed-actions-list').style.display=document.getElementById('dismissed-actions-list').style.display==='none'?'block':'none'" style="background:none;border:none;font-size:12px;color:#94a3b8;cursor:pointer;text-decoration:underline;text-decoration-style:dotted;">
        ${dismissedSteps.length} cleared action${dismissedSteps.length>1?'s':''} — click to show
      </button>
      <div id="dismissed-actions-list" style="display:none;margin-top:12px;text-align:left;">
        ${dismissedSteps.map(s=>`<div style="display:flex;gap:10px;padding:10px 0;border-bottom:1px solid #f8fafc;align-items:center;opacity:0.5;">
          <span style="font-size:16px;width:24px;text-align:center;">${s.icon}</span>
          <div style="flex:1;min-width:0;">
            <span style="font-size:10px;font-weight:700;padding:2px 6px;border-radius:3px;background:${s.tagBg};color:${s.tagColor};">${s.tag}</span>
            <span style="font-size:12px;color:#94a3b8;margin-left:6px;text-decoration:line-through;">${s.title.replace(/<[^>]*>/g,'').substring(0,80)}</span>
          </div>
          <button onclick="undismissAction('${s.id}')" style="background:none;border:1px solid #e2e8f0;border-radius:4px;padding:2px 8px;font-size:10px;color:#94a3b8;cursor:pointer;" title="Restore this action">Undo</button>
        </div>`).join('')}
      </div>
    </div>`;
  }

  // ── Dormant ──
  if(dormEl){
    const dormant=(DATA.cancelByStudy||[]).filter(c=>{
      const cName=c.name||c.study||c.full||'Unknown';
      const up=((DATA.upcomingByStudyFull||DATA.upcomingByStudy||[]).find(u=>u.full===c.full||u.name===cName||u.study===c.study)||{}).count||0;
      return c.count>=5&&up<5;
    });
    dormEl.innerHTML=dormant.length>0
      ?dormant.map(c=>{const label=c.name||c.study||c.full||'Unknown';return c.study_url
        ?`<div style="padding:8px 12px;border-left:3px solid #dc2626;margin-bottom:6px;background:#fef2f2;border-radius:0 6px 6px 0;font-size:12px;"><a href="${c.study_url}" target="_blank" rel="noopener" style="color:#dc2626;font-weight:600;text-decoration:underline;text-decoration-style:dotted;">${label}</a> — ${c.count} cancels, low upcoming pipeline</div>`
        :`<div style="padding:8px 12px;border-left:3px solid #dc2626;margin-bottom:6px;background:#fef2f2;border-radius:0 6px 6px 0;font-size:12px;"><span style="color:#dc2626;font-weight:600;">${label}</span> — ${c.count} cancels, low upcoming pipeline</div>`}
      ).join('')
      :'<div style="padding:12px;color:#94a3b8;font-size:12px;">No dormant studies detected</div>';
  }
}


// ═══════════════════════════════════════════════════
// RENDER ALL + INIT
// ═══════════════════════════════════════════════════

function safe(fn, name) {
  try { fn(); } catch(e) {
    console.error('renderAll: ' + (name||'?') + ' failed —', e.message, e.stack);
  }
}

// ══════════════════════════════════════════════════════════════
// PATIENT PIPELINE BY SITE (PHL vs PNJ)
// ══════════════════════════════════════════════════════════════
function buildPatientPipelineBySite() {
  var container = document.getElementById('pipeline-site-content');
  var badge = document.getElementById('pipeline-site-badge');
  var kpiEl = document.getElementById('ov-kpi-sites');

  // Use allVisitDetail for active patient data
  var visits = (DATA && DATA.allVisitDetail) ? DATA.allVisitDetail : [];
  if (!visits.length) {
    if (container) container.innerHTML = '<div style="text-align:center;padding:20px;color:var(--muted);font-size:13px;">No visit data loaded yet</div>';
    return;
  }

  // Get unique patients with their latest status, grouped by site
  var patientMap = {}; // key: patientName -> {status, site, study, date}
  visits.forEach(function(v) {
    var key = (v.patient || '').toLowerCase().trim();
    if (!key) return;
    var isPNJ = (v.patient_url || '').includes('pennington');
    var siteLabel = isPNJ ? 'PNJ' : 'PHL';
    // Keep the latest visit per patient
    if (!patientMap[key] || (v.date_iso && v.date_iso > (patientMap[key].date_iso || ''))) {
      patientMap[key] = { name: v.patient, status: v.status || 'Unknown', site: siteLabel, study: v.study, date_iso: v.date_iso, url: v.patient_url };
    }
  });

  var patients = Object.values(patientMap);
  var stages = ['Screening', 'Enrolled', 'Randomization', 'Treatment', 'Follow-Up'];

  function classifyStage(status) {
    var s = (status || '').toLowerCase();
    if (s.includes('screen') && !s.includes('fail')) return 'Screening';
    if (s.includes('enrolled') || s.includes('active')) return 'Enrolled';
    if (s.includes('random')) return 'Randomization';
    if (s.includes('treatment') || s.includes('dosing') || s.includes('cycle') || s.includes('week')) return 'Treatment';
    if (s.includes('follow') || s.includes('maintenance') || s.includes('complete')) return 'Follow-Up';
    if (s.includes('schedule')) return 'Enrolled';
    return 'Enrolled'; // default
  }

  // Count by site and stage
  var phl = {}, pnj = {}, phlTotal = 0, pnjTotal = 0;
  stages.forEach(function(st) { phl[st] = 0; pnj[st] = 0; });
  patients.forEach(function(p) {
    var stage = classifyStage(p.status);
    if (p.site === 'PNJ') { pnj[stage]++; pnjTotal++; }
    else { phl[stage]++; phlTotal++; }
  });

  // Update Overview KPI
  if (kpiEl) kpiEl.textContent = phlTotal + ' + ' + pnjTotal;

  // Build pipeline bars for a site
  function buildSitePipeline(siteName, counts, total, color) {
    var html = '<div style="flex:1;min-width:280px;">';
    html += '<div style="font-size:14px;font-weight:700;color:var(--navy);margin-bottom:10px;">' + siteName + ' <span style="font-size:12px;font-weight:400;color:var(--muted);">' + total + ' patients</span></div>';
    stages.forEach(function(stage) {
      var count = counts[stage] || 0;
      var pct = total > 0 ? Math.round(count / total * 100) : 0;
      var barColor = STAGE_COLORS[stage] || '#94a3b8';
      html += '<div style="margin-bottom:8px;">';
      html += '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:3px;">';
      html += '<span style="font-size:11px;font-weight:600;color:var(--text);">' + stage + '</span>';
      html += '<span style="font-size:12px;font-weight:700;color:' + barColor + ';">' + count + '</span>';
      html += '</div>';
      html += '<div style="height:8px;background:#f1f5f9;border-radius:4px;overflow:hidden;">';
      html += '<div style="height:100%;width:' + pct + '%;background:' + barColor + ';border-radius:4px;transition:width 0.5s;"></div>';
      html += '</div></div>';
    });
    html += '</div>';
    return html;
  }

  var html = '<div style="display:flex;gap:24px;flex-wrap:wrap;">';
  html += buildSitePipeline('📍 Philadelphia (PHL)', phl, phlTotal, '#1843ad');
  html += buildSitePipeline('🌿 Pennington (PNJ)', pnj, pnjTotal, '#059669');
  html += '</div>';

  if (container) container.innerHTML = html;
  if (badge) badge.textContent = (phlTotal + pnjTotal) + ' patients';
}

// ══════════════════════════════════════════════════════════════
// CROSS-SOURCE: OVERVIEW RECRUITMENT KPIs
// ══════════════════════════════════════════════════════════════
function buildRecruitmentKPIs() {
  var el = function(id) { return document.getElementById(id); };
  // Active referrals (show 0 as a real value, only dash if data not loaded)
  var hasRefData = REFERRAL_DATA && REFERRAL_DATA.length > 0;
  var activeRefs = hasRefData ? REFERRAL_DATA.filter(function(r){ return !r.is_closed; }).length : null;
  if (el('ov-kpi-refs')) el('ov-kpi-refs').textContent = activeRefs !== null ? activeRefs : '--';
  // FB leads (30 days)
  var now = Date.now();
  var hasFBData = FB_CRM_DATA && FB_CRM_DATA.length > 0;
  var fbRecent = hasFBData ? FB_CRM_DATA.filter(function(f) {
    var d = f['Date Created'] || '';
    if (!d) return false;
    try { return (now - new Date(d).getTime()) < 30 * 86400000; } catch(e) { return false; }
  }).length : null;
  if (el('ov-kpi-fb')) el('ov-kpi-fb').textContent = fbRecent !== null ? fbRecent : '--';
  // Conversion rate
  var totalRefs = REFERRAL_DATA ? REFERRAL_DATA.length : 0;
  var enrolledRefs = REFERRAL_DATA ? REFERRAL_DATA.filter(function(r){ return r.stage === 'Enrolled' || r.stage === 'Screened'; }).length : 0;
  var convRate = totalRefs > 0 ? Math.round(enrolledRefs / totalRefs * 100) + '%' : '--';
  if (el('ov-kpi-conv')) el('ov-kpi-conv').textContent = convRate;
}

// ══════════════════════════════════════════════════════════════
// CROSS-SOURCE: MEDICAL RECORDS ALERTS (Actions Tab)
// ══════════════════════════════════════════════════════════════
function buildMedRecAlerts() {
  return;
}

function renderAll() {
  document.getElementById('kpi-cancels').textContent  = DATA.cancelTotal  || 0;
  document.getElementById('kpi-upcoming').textContent = DATA.upcomingTotal || 0;
  document.getElementById('kpi-next14').textContent   = DATA.next14        || 0;
  document.getElementById('kpi-risk').textContent     = (DATA.riskMatrix||[]).filter(r=>r.level==='critical').length;
  const _studiesEl = document.getElementById('kpi-studies');
  if (_studiesEl) _studiesEl.textContent = DATA.activeStudies || (DATA.riskMatrix||[]).length || 0;
  if (document.getElementById('sched-count'))
    document.getElementById('sched-count').textContent = (DATA.upcomingTotal||0) + ' visits';

  safe(buildHorizon,         'buildHorizon');
  safe(buildCancelTrend,     'buildCancelTrend');
  safe(buildUpcomingTrend,   'buildUpcomingTrend');
  safe(buildReasonChart,     'buildReasonChart');
  safe(buildSiteChart,       'buildSiteChart');
  safe(buildCancelStudyBars, 'buildCancelStudyBars');
  safe(buildCoordList,       'buildCoordList');
  safe(buildInvestigatorList, 'buildInvestigatorList');
  safe(renderCoordinatorGoals, 'renderCoordinatorGoals');
  safe(buildActionSteps,     'buildActionSteps');
  safe(buildInsights,        'buildInsights');
  safe(buildRecruitmentKPIs, 'buildRecruitmentKPIs');
  safe(buildPatientPipelineBySite, 'buildPatientPipelineBySite');
  safe(buildMedRecAlerts,    'buildMedRecAlerts');
  // Note: buildRiskTable/buildStudyCards removed — Studies tab now uses buildStudiesView (lazy-loaded on tab click)
  if (typeof buildRiskFlagCards === 'function')     safe(buildRiskFlagCards,     'buildRiskFlagCards');
  // Pre-build schedule so it's ready when tab is clicked
  safe(buildWeeklyBySiteChart,   'buildWeeklyBySiteChart');
  safe(buildVisitTypeChart,      'buildVisitTypeChart');
  safe(buildStatusChart,         'buildStatusChart');
  safe(buildStatusLegend,        'buildStatusLegend');
  safe(buildSchedStudyBars,      'buildSchedStudyBars');
  safe(buildSchedCoordList,      'buildSchedCoordList');
  safe(() => filterSchedTable('all', null), 'buildUpcomingDetailTable');
  safe(backfillInvestigators, 'backfillInvestigators');
}

function closeSetup() {
  const ov = document.getElementById('setup-overlay');
  if (ov) ov.style.display = 'none';
}


function sortTable(th, tbodyId) {
  const tbody = tbodyId ? document.getElementById(tbodyId) : th.closest('table').querySelector('tbody');
  if (!tbody) return;
  const table = th.closest('table');
  const ths = Array.from(th.closest('tr').querySelectorAll('th'));
  const col = ths.indexOf(th);
  const asc = th.classList.contains('sort-asc') ? false : true;

  ths.forEach(t => t.classList.remove('sort-asc','sort-desc'));
  th.classList.add(asc ? 'sort-asc' : 'sort-desc');

  const rows = Array.from(tbody.querySelectorAll('tr'));
  rows.sort((a, b) => {
    const aText = (a.cells[col] ? a.cells[col].textContent : '').trim();
    const bText = (b.cells[col] ? b.cells[col].textContent : '').trim();
    // Try numeric sort first
    const aNum = parseFloat(aText.replace(/[^0-9.-]/g,''));
    const bNum = parseFloat(bText.replace(/[^0-9.-]/g,''));
    // Try date sort (Mon D format)
    const months = {Jan:0,Feb:1,Mar:2,Apr:3,May:4,Jun:5,Jul:6,Aug:7,Sep:8,Oct:9,Nov:10,Dec:11};
    const aDateM = aText.match(/^([A-Za-z]{3})\s+(\d+)$/);
    const bDateM = bText.match(/^([A-Za-z]{3})\s+(\d+)$/);
    let cmp = 0;
    if (aDateM && bDateM) {
      cmp = (months[aDateM[1]]*100+parseInt(aDateM[2])) - (months[bDateM[1]]*100+parseInt(bDateM[2]));
    } else if (!isNaN(aNum) && !isNaN(bNum)) {
      cmp = aNum - bNum;
    } else {
      cmp = aText.localeCompare(bText);
    }
    return asc ? cmp : -cmp;
  });
  rows.forEach(r => tbody.appendChild(r));
}


// ── Modal engine ──────────────────────────────────────────────────────
function openModal(title, sub, bodyHtml) {
  document.getElementById('detail-panel-title').textContent = title;
  document.getElementById('detail-panel-sub').textContent   = sub || '';
  document.getElementById('detail-panel-body').innerHTML    = bodyHtml;
  document.getElementById('detail-modal').classList.add('open');
  // Make inner table sortable
  document.getElementById('detail-panel-body').querySelectorAll('.detail-table th').forEach(th => {
    th.onclick = () => sortDetailTable(th);
  });
  document.addEventListener('keydown', _escClose);
}
function closeModal() {
  document.getElementById('detail-modal').classList.remove('open');
  document.removeEventListener('keydown', _escClose);
}
function _escClose(e){ if(e.key==='Escape') closeModal(); }

function sortDetailTable(th) {
  const tbody = th.closest('table').querySelector('tbody');
  const ths   = Array.from(th.closest('tr').querySelectorAll('th'));
  const col   = ths.indexOf(th);
  const asc   = th.classList.contains('sort-asc') ? false : true;
  ths.forEach(t => t.classList.remove('sort-asc','sort-desc'));
  th.classList.add(asc ? 'sort-asc' : 'sort-desc');
  const rows = Array.from(tbody.querySelectorAll('tr'));
  const months={Jan:0,Feb:1,Mar:2,Apr:3,May:4,Jun:5,Jul:6,Aug:7,Sep:8,Oct:9,Nov:10,Dec:11};
  rows.sort((a,b) => {
    const at = (a.cells[col]?.textContent||'').trim();
    const bt = (b.cells[col]?.textContent||'').trim();
    const am = at.match(/^([A-Za-z]{3})\s+(\d+)$/), bm = bt.match(/^([A-Za-z]{3})\s+(\d+)$/);
    const an = parseFloat(at), bn = parseFloat(bt);
    let cmp = am&&bm ? (months[am[1]]*100+parseInt(am[2]))-(months[bm[1]]*100+parseInt(bm[2]))
            : !isNaN(an)&&!isNaN(bn) ? an-bn : at.localeCompare(bt);
    return asc ? cmp : -cmp;
  });
  rows.forEach(r => tbody.appendChild(r));
}

// ── Ext icon ──────────────────────────────────────────────────────────
const EXT_ICO = `<svg xmlns="http://www.w3.org/2000/svg" width="9" height="9" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" style="margin-left:2px;opacity:.4;vertical-align:middle"><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/><polyline points="15 3 21 3 21 9"/><line x1="10" y1="14" x2="21" y2="3"/></svg>`;
function extLink(text, url, style) {
  style = style || '';
  return url ? `<a href="${url}" target="_blank" rel="noopener" style="color:#1843ad;font-weight:600;text-decoration:none;${style}">${text}${EXT_ICO}</a>` : `<span>${text}</span>`;
}
function patientLink(name, url, style) {
  return extLink(maskPHI(name), url, style);
}
function siteBadge(site){
  const pnj = (site||'').includes('Penn');
  return `<span style="font-size:9px;font-weight:700;padding:2px 5px;border-radius:3px;background:${pnj?'#059669':'#072061'}20;color:${pnj?'#059669':'#072061'}">${pnj?'PNJ':'PHL'}</span>`;
}
function statusBadge(s){
  const map={'Enrolled':['#059669',''],'Screening':['#d97706',''],'Screen Fail':['#dc2626',''],'Prequalified':['#7c3aed','']};
  const [col]=map[s]||['#94a3b8'];
  return `<span style="font-size:10px;font-weight:700;padding:2px 6px;border-radius:4px;background:${col}20;color:${col}">${s||'—'}</span>`;
}
function typeBadge2(t){
  const map={'No Show':['#dc2626','#fef2f2'],'Patient Cancelled':['#c2410c','#fff7ed'],'Site Cancelled':['#1843ad','#eff6ff']};
  const [col,bg]=map[t]||['#64748b','#f8fafc'];
  return `<span style="font-size:9px;font-weight:700;padding:2px 5px;border-radius:3px;background:${bg};color:${col}">${t||'—'}</span>`;
}

// ── Detail builders ───────────────────────────────────────────────────

function showCancels(filterFn, title, sub) {
  const rows = (DATA.allCancels||[]).filter(filterFn || (()=>true));
  const body = `<table class="detail-table sortable"><thead><tr>
    <th onclick="sortDetailTable(this)">Patient</th>
    <th onclick="sortDetailTable(this)">Study</th>
    <th onclick="sortDetailTable(this)">Type</th>
    <th onclick="sortDetailTable(this)">Sched Date</th>
    <th onclick="sortDetailTable(this)">Reason</th>
    <th onclick="sortDetailTable(this)">Coordinator</th>
  </tr></thead><tbody>` +
  rows.map(r => `<tr>
    <td>${extLink(r.name, r.study_url||r.url||'')}</td>
    <td style="font-size:11px">${extLink(r.study, r.study_url||'')}</td>
    <td>${typeBadge2(r.type)}</td>
    <td style="color:#64748b;font-size:11px;white-space:nowrap">${r.date||r.cancel_date||'—'}</td>
    <td style="font-size:11px;color:#64748b;max-width:180px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap"
        title="${(r.reason||'').replace(/"/g,"'")}">${r.reason||'<em style="color:#dc2626">Missing</em>'}</td>
    <td style="font-size:11px">${r.coord||'—'}</td>
  </tr>`).join('') + `</tbody></table>`;
  openModal(title, sub || rows.length + ' records', body);
}

function showUpcoming(filterFn, title, sub) {
  const rows = (DATA.allVisitDetail||DATA.next14Detail||[]).filter(filterFn||(()=>true));
  const body = `<table class="detail-table"><thead><tr>
    <th>Date</th><th>Patient</th><th>Study</th><th>Visit</th><th>Status</th><th>Coordinator</th><th>Investigator</th><th>Site</th>
  </tr></thead><tbody>` +
  rows.map(r=>`<tr>
    <td style="font-weight:600;color:#1843ad;white-space:nowrap">${r.date}</td>
    <td>${patientLink(r.patient,r.patient_url)}</td>
    <td style="font-size:11px">${extLink(r.study,r.study_url)}</td>
    <td style="font-size:11px;color:#64748b">${r.visit||'—'}</td>
    <td>${statusBadge(r.status)}</td>
    <td style="font-size:11px">${r.coord||'—'}</td>
    <td style="font-size:11px;color:${r.investigator?'#7c3aed':'#cbd5e1'}">${r.investigator||'—'}</td>
    <td>${siteBadge(r.site)}</td>
  </tr>`).join('') +
  `</tbody></table>`;
  openModal(title, sub || rows.length + ' visits', body);
}

function showRiskFlags(title) {
  const flags = DATA.riskFlags||[];
  const body = `<table class="detail-table"><thead><tr>
    <th>Patient</th><th>Study</th><th>Cancel Events</th><th>Next Visit</th><th>Last Cancel</th>
  </tr></thead><tbody>` +
  flags.map(f=>`<tr>
    <td>${patientLink(f.patient,f.patient_url,'color:#dc2626;')}</td>
    <td>${extLink(f.study,f.study_url)}</td>
    <td style="text-align:center"><span style="background:#fef2f2;color:#dc2626;font-weight:700;padding:2px 8px;border-radius:4px">${f.cancels}×</span></td>
    <td style="font-weight:600;color:#dc2626">${f.next_visit}</td>
    <td style="font-size:11px;color:#64748b">${f.last_cancel||'—'}</td>
  </tr>`).join('') +
  `</tbody></table>`;
  openModal(title||'At-Risk Patients', flags.length + ' patients with 2+ cancel events & upcoming visit', body);
}

function showStudyDetail(studyName, studyUrl) {
  const cancels = (DATA.cancelByStudy||[]).find(s=>s.name===studyName||s.full===studyName);
  const upcoming = (DATA.allVisitDetail||[]).filter(r=>r.study===studyName);
    const allCancelRows = (DATA.allCancels||[]).filter(r=>r.study===studyName);

  let body = '';
  if(upcoming.length) {
    body += `<h4 style="font-size:12px;font-weight:700;color:#475569;margin:0 0 8px;text-transform:uppercase;letter-spacing:.5px;">📆 Upcoming Visits (${upcoming.length})</h4>
    <table class="detail-table" style="margin-bottom:20px"><thead><tr>
      <th>Date</th><th>Patient</th><th>Visit</th><th>Status</th><th>Coordinator</th><th>Investigator</th>
    </tr></thead><tbody>` +
    upcoming.map(r=>`<tr>
      <td style="font-weight:600;color:#1843ad">${r.date}</td>
      <td>${patientLink(r.patient,r.patient_url)}</td>
      <td style="font-size:11px;color:#64748b">${r.visit}</td>
      <td>${statusBadge(r.status)}</td>
      <td style="font-size:11px">${r.coord}</td>
      <td style="font-size:11px;color:${r.investigator?'#7c3aed':'#cbd5e1'}">${r.investigator||'—'}</td>
    </tr>`).join('') + `</tbody></table>`;
  }
  if(allCancelRows.length) {
    body += `<h4 style="font-size:12px;font-weight:700;color:#475569;margin:0 0 8px;text-transform:uppercase;letter-spacing:.5px;">❌ Recent Cancellations (${allCancelRows.length})</h4>
    <table class="detail-table"><thead><tr>
      <th>Patient</th><th>Type</th><th>Cancel Date</th><th>Reason</th><th>Coordinator</th>
    </tr></thead><tbody>` +
    allCancelRows.map(r=>`<tr>
      <td>${extLink(r.name,r.url)}</td>
      <td>${typeBadge2(r.type)}</td>
      <td style="font-size:11px;color:#64748b">${r.cancel_date||'—'}</td>
      <td style="font-size:11px;color:#64748b;max-width:200px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap" title="${(r.reason||'').replace(/"/g,"'")}">${r.reason||'<em style="color:#dc2626">Missing</em>'}</td>
      <td style="font-size:11px">${r.coord||'—'}</td>
    </tr>`).join('') + `</tbody></table>`;
  }
  if(!body) body = '<p style="color:#94a3b8;padding:20px;text-align:center">No detail data available</p>';
  openModal(studyName, (cancels?cancels.count+' cancels · ':'') + upcoming.length+' upcoming', body);
}

/* ── Unified Study Drill-Down Modal ────────────────────── */
function showStudyUnifiedModal(studyName) {
  var sectionStyle = 'font-size:12px;font-weight:700;color:#475569;margin:16px 0 8px 0;text-transform:uppercase;letter-spacing:.5px;border-bottom:1px solid #e2e8f0;padding-bottom:4px;';
  var body = '';

  /* 1 — Enrollment & Visits (from CRIO DATA) */
  var cancels = (DATA.cancelByStudy||[]).find(function(s){ return s.name===studyName||s.full===studyName; });
  var upcoming = (DATA.allVisitDetail||[]).filter(function(r){ return r.study===studyName; });
  var allCancelRows = (DATA.allCancels||[]).filter(function(r){ return r.study===studyName; });
  var riskEntry = (DATA.riskMatrix||[]).find(function(r){ return r.study===studyName; });

  body += '<h4 style="' + sectionStyle + '">📆 Enrollment & Visits</h4>';
  if (riskEntry) {
    var pct = riskEntry.target > 0 ? Math.round(riskEntry.enrolled / riskEntry.target * 100) : 0;
    body += '<div style="display:flex;gap:16px;flex-wrap:wrap;margin-bottom:10px;">';
    body += '<div style="font-size:11px;"><strong>Enrolled:</strong> ' + riskEntry.enrolled + (riskEntry.target > 0 ? '/' + riskEntry.target + ' (' + pct + '%)' : '') + '</div>';
    body += '<div style="font-size:11px;"><strong>Screening:</strong> ' + (riskEntry.screening||0) + '</div>';
    body += '<div style="font-size:11px;"><strong>Screen Fail:</strong> ' + (riskEntry.screen_fail_pct||0) + '%</div>';
    body += '<div style="font-size:11px;"><strong>Upcoming:</strong> ' + upcoming.length + '</div>';
    body += '<div style="font-size:11px;"><strong>Cancels:</strong> ' + (cancels?cancels.count:0) + '</div>';
    body += '</div>';
  }
  if (upcoming.length) {
    body += '<table class="detail-table" style="margin-bottom:12px;"><thead><tr><th>Date</th><th>Patient</th><th>Visit</th><th>Status</th><th>Coordinator</th></tr></thead><tbody>';
    upcoming.slice(0,10).forEach(function(r) {
      body += '<tr><td style="font-weight:600;color:#1843ad">' + r.date + '</td>';
      body += '<td>' + patientLink(r.patient, r.patient_url) + '</td>';
      body += '<td style="font-size:11px;color:#64748b">' + r.visit + '</td>';
      body += '<td>' + statusBadge(r.status) + '</td>';
      body += '<td style="font-size:11px">' + r.coord + '</td></tr>';
    });
    body += '</tbody></table>';
    if (upcoming.length > 10) body += '<div style="font-size:10px;color:#94a3b8;margin-bottom:8px;">+' + (upcoming.length - 10) + ' more visits</div>';
  }
  if (allCancelRows.length) {
    body += '<details style="margin-bottom:12px;"><summary style="font-size:11px;cursor:pointer;color:#dc2626;font-weight:600;">' + allCancelRows.length + ' Recent Cancellations</summary>';
    body += '<table class="detail-table" style="margin-top:6px;"><thead><tr><th>Patient</th><th>Type</th><th>Date</th><th>Reason</th></tr></thead><tbody>';
    allCancelRows.slice(0,10).forEach(function(r) {
      body += '<tr><td>' + patientLink(r.name, r.url) + '</td><td>' + typeBadge2(r.type) + '</td>';
      body += '<td style="font-size:11px;color:#64748b">' + (r.cancel_date||'—') + '</td>';
      body += '<td style="font-size:11px;color:#64748b;max-width:180px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap" title="' + (r.reason||'').replace(/"/g,"'") + '">' + (r.reason||'—') + '</td></tr>';
    });
    body += '</tbody></table></details>';
  }

  /* 2 — Referral Pipeline (from REFERRAL_DATA) */
  var refs = REFERRAL_DATA.filter(function(r) { return matchesStudy(r.study, studyName); });
  if (refs.length > 0) {
    body += '<h4 style="' + sectionStyle + '">🔄 Referral Pipeline (' + refs.length + ')</h4>';
    var stages = {};
    refs.forEach(function(r) { var s = r.stage || 'Unknown'; stages[s] = (stages[s]||0) + 1; });
    body += '<div style="display:flex;gap:8px;flex-wrap:wrap;margin-bottom:8px;">';
    Object.keys(stages).forEach(function(stage) {
      var sc = STAGE_COLORS[stage] || '#94a3b8';
      body += '<span style="font-size:10px;padding:3px 8px;border-radius:4px;background:' + sc + '20;color:' + sc + ';font-weight:600;">' + stage + ': ' + stages[stage] + '</span>';
    });
    body += '</div>';
    var activeRefs = refs.filter(function(r) { return !r.is_closed; });
    if (activeRefs.length > 0) {
      body += '<table class="detail-table" style="margin-bottom:12px;"><thead><tr><th>Patient</th><th>Stage</th><th>Source</th><th>Days</th></tr></thead><tbody>';
      activeRefs.slice(0,8).forEach(function(r) {
        var sc = STAGE_COLORS[r.stage] || '#94a3b8';
        body += '<tr><td><a href="' + r.url + '" target="_blank" style="color:#1e293b;text-decoration:none;font-weight:600;">' + maskPHI(r.name) + '</a></td>';
        body += '<td><span style="font-size:10px;padding:2px 6px;border-radius:4px;background:' + sc + '20;color:' + sc + ';font-weight:600;">' + r.stage + '</span></td>';
        body += '<td style="font-size:11px;color:#64748b">' + (r.source||'—') + '</td>';
        body += '<td style="font-size:11px;color:' + (r.days_since_update > 14 ? '#dc2626' : '#64748b') + ';">' + (r.days_since_update||'—') + 'd</td></tr>';
      });
      body += '</tbody></table>';
      if (activeRefs.length > 8) body += '<div style="font-size:10px;color:#94a3b8;margin-bottom:8px;">+' + (activeRefs.length - 8) + ' more active referrals</div>';
    }
  }

  /* 3 — Medical Records (from MED_RECORDS_DATA) */
  var medRec = getStudyMedRecords(studyName);
  if (medRec && medRec.total > 0) {
    body += '<h4 style="' + sectionStyle + '">🏥 Medical Records (' + medRec.total + ')</h4>';
    body += '<div style="display:flex;gap:16px;flex-wrap:wrap;margin-bottom:8px;">';
    body += '<div style="font-size:11px;"><span style="color:#8b5cf6;font-weight:700;">' + medRec.active + '</span> active</div>';
    body += '<div style="font-size:11px;"><span style="color:#059669;font-weight:700;">' + medRec.enrolled + '</span> enrolled</div>';
    body += '<div style="font-size:11px;"><span style="color:#d97706;font-weight:700;">' + medRec.screening + '</span> screening</div>';
    body += '<div style="font-size:11px;"><span style="color:#f59e0b;font-weight:700;">' + medRec.readySched + '</span> ready to schedule</div>';
    if (medRec.dnq > 0) body += '<div style="font-size:11px;"><span style="color:#dc2626;font-weight:700;">' + medRec.dnq + '</span> DNQ</div>';
    body += '</div>';
    if (medRec.patients && medRec.patients.length > 0) {
      var activePatients = medRec.patients.filter(function(p){ return p.is_active; });
      if (activePatients.length > 0) {
        body += '<table class="detail-table" style="margin-bottom:12px;"><thead><tr><th>Patient</th><th>Status</th><th>Records</th><th>Approval</th></tr></thead><tbody>';
        activePatients.slice(0,8).forEach(function(p) {
          var statusColors = {'Enrolled':'#059669','In Screening':'#8b5cf6','Visit Scheduled':'#06b6d4','Ready to Schedule':'#f59e0b','Pending Release':'#94a3b8','Under Review':'#64748b'};
          var sc = statusColors[p.status] || '#94a3b8';
          var recBadge = p.records_received === 'Yes' ? '<span style="color:#059669;font-weight:700;">✓</span>' : '<span style="color:#dc2626;">✗</span>';
          var appBadge = p.investigator_approval === 'Approved' ? '<span style="color:#059669;">✓</span>' : (p.investigator_approval ? '<span style="color:#f59e0b;">' + p.investigator_approval + '</span>' : '—');
          body += '<tr><td><a href="' + p.url + '" target="_blank" style="color:#1e293b;text-decoration:none;font-weight:600;">' + p.name + '</a></td>';
          body += '<td><span style="font-size:10px;padding:2px 6px;border-radius:4px;background:' + sc + '22;color:' + sc + ';font-weight:600;">' + p.status + '</span></td>';
          body += '<td style="text-align:center;">' + recBadge + '</td>';
          body += '<td style="text-align:center;">' + appBadge + '</td></tr>';
        });
        body += '</tbody></table>';
        if (activePatients.length > 8) body += '<div style="font-size:10px;color:#94a3b8;margin-bottom:8px;">+' + (activePatients.length - 8) + ' more active patients</div>';
      }
    }
  }

  /* 4 — Campaign Activity (from CAMPAIGN_DATA) */
  var campaigns = CAMPAIGN_DATA.filter(function(c) { return matchesStudy(c.study||c.campaign, studyName); });
  if (campaigns.length > 0) {
    var totalContacts = campaigns.reduce(function(sum, c) { return sum + (c.contacts||0); }, 0);
    var totalConversions = campaigns.reduce(function(sum, c) { return sum + (c.conversions||0); }, 0);
    body += '<h4 style="' + sectionStyle + '">📊 Campaign Activity (' + campaigns.length + ' campaigns)</h4>';
    body += '<div style="display:flex;gap:16px;flex-wrap:wrap;margin-bottom:8px;">';
    body += '<div style="font-size:11px;"><strong>Contacts:</strong> ' + totalContacts + '</div>';
    body += '<div style="font-size:11px;"><strong>Conversions:</strong> ' + totalConversions + '</div>';
    body += '<div style="font-size:11px;"><strong>Rate:</strong> ' + (totalContacts > 0 ? Math.round(totalConversions / totalContacts * 100) : 0) + '%</div>';
    body += '</div>';
  }

  /* 5 — FB/Meta Leads (from FB_CRM_DATA) */
  var fbData = getStudyFBLeads(studyName);
  if (fbData.count > 0) {
    body += '<h4 style="' + sectionStyle + '">📱 Facebook/Meta Leads (' + fbData.count + ')</h4>';
    if (fbData.recent > 0) body += '<div style="font-size:11px;margin-bottom:6px;color:#3b82f6;font-weight:600;">' + fbData.recent + ' new leads in last 30 days</div>';
    if (fbData.leads && fbData.leads.length > 0) {
      body += '<table class="detail-table" style="margin-bottom:12px;"><thead><tr><th>Name</th><th>Phone</th><th>Created</th></tr></thead><tbody>';
      fbData.leads.slice(0,6).forEach(function(l) {
        body += '<tr><td style="font-weight:600;">' + (l.name||'—') + '</td>';
        body += '<td style="font-size:11px;color:#64748b">' + (l.phone||'—') + '</td>';
        body += '<td style="font-size:11px;color:#64748b">' + (l.created||'—') + '</td></tr>';
      });
      body += '</tbody></table>';
      if (fbData.leads.length > 6) body += '<div style="font-size:10px;color:#94a3b8;margin-bottom:8px;">+' + (fbData.leads.length - 6) + ' more leads</div>';
    }
  }

  /* 6 — Integration Alerts (cross-source flags) */
  var alerts = [];
  if (refs.length > 0 && medRec) {
    var refsNoMed = refs.filter(function(r) {
      if (r.is_closed) return false;
      return !MED_RECORDS_DATA.some(function(m) {
        return matchesStudy(m.study, studyName) && m.name.toLowerCase().trim() === r.name.toLowerCase().trim();
      });
    });
    if (refsNoMed.length > 0) alerts.push({icon: '⚠️', text: refsNoMed.length + ' referral(s) with no medical records entry', color: '#d97706'});
  }
  if (medRec && medRec.readySched > 0) {
    var readyNoVisit = MED_RECORDS_DATA.filter(function(m) {
      return matchesStudy(m.study, studyName) && m.status === 'Ready to Schedule';
    }).filter(function(m) {
      return !(DATA.allVisitDetail||[]).some(function(v) {
        return v.patient.toLowerCase().trim() === m.name.toLowerCase().trim();
      });
    });
    if (readyNoVisit.length > 0) alerts.push({icon: '🔔', text: readyNoVisit.length + ' patient(s) ready to schedule but no upcoming visit', color: '#dc2626'});
  }
  if (medRec) {
    var pendingApproval = MED_RECORDS_DATA.filter(function(m) {
      return matchesStudy(m.study, studyName) && m.is_active && m.investigator_approval && m.investigator_approval !== 'Approved';
    });
    if (pendingApproval.length > 0) alerts.push({icon: '📋', text: pendingApproval.length + ' patient(s) pending investigator approval', color: '#f59e0b'});
  }
  if (alerts.length > 0) {
    body += '<h4 style="' + sectionStyle + '">🚨 Integration Alerts</h4>';
    alerts.forEach(function(a) {
      body += '<div style="font-size:11px;padding:6px 10px;margin-bottom:4px;border-radius:6px;background:' + a.color + '12;border-left:3px solid ' + a.color + ';color:' + a.color + ';">' + a.icon + ' ' + a.text + '</div>';
    });
  }

  if (!body) body = '<p style="color:#94a3b8;padding:20px;text-align:center">No data available for this study across any source.</p>';

  var subtitle = '';
  if (riskEntry) subtitle += (riskEntry.enroll_status||'') + ' · ';
  subtitle += upcoming.length + ' upcoming · ' + refs.length + ' referrals · ' + (medRec ? medRec.total : 0) + ' med records';

  openModal('🔬 ' + studyName, subtitle, body);
}

function showCancelsByReason(reason) {
  showCancels(
    r => (r.category||r.reason||'') === reason,
    reason + ' — Cancellations',
    (DATA.allCancels||[]).filter(r=>(r.category||r.reason||'')===reason).length + ' records'
  );
}

function showCoordDetail(coordName) {
  const upcoming = (DATA.allVisitDetail||[]).filter(r=>r.coord===coordName);
  const allCancelRows = (DATA.allCancels||[]).filter(r=>r.coord===coordName);

  let body = '';
  if(upcoming.length) {
    body += `<h4 style="font-size:12px;font-weight:700;color:#475569;margin:0 0 8px;text-transform:uppercase;letter-spacing:.5px;">📆 Upcoming Visits (${upcoming.length})</h4>
    <table class="detail-table" style="margin-bottom:20px"><thead><tr>
      <th>Date</th><th>Patient</th><th>Study</th><th>Visit</th><th>Status</th><th>Investigator</th>
    </tr></thead><tbody>` +
    upcoming.map(r=>`<tr>
      <td style="font-weight:600;color:#1843ad;white-space:nowrap">${r.date}</td>
      <td>${patientLink(r.patient,r.patient_url)}</td>
      <td style="font-size:11px">${extLink(r.study,r.study_url)}</td>
      <td style="font-size:11px;color:#64748b">${r.visit}</td>
      <td>${statusBadge(r.status)}</td>
      <td style="font-size:11px;color:${r.investigator?'#7c3aed':'#cbd5e1'}">${r.investigator||'—'}</td>
    </tr>`).join('') + `</tbody></table>`;
  }
  if(allCancelRows.length) {
    body += `<h4 style="font-size:12px;font-weight:700;color:#475569;margin:0 0 8px;text-transform:uppercase;letter-spacing:.5px;">❌ Cancellations (${allCancelRows.length})</h4>
    <table class="detail-table"><thead><tr>
      <th>Patient</th><th>Study</th><th>Type</th><th>Date</th><th>Reason</th>
    </tr></thead><tbody>` +
    allCancelRows.map(r=>`<tr>
      <td>${extLink(r.name,r.url)}</td>
      <td style="font-size:11px">${extLink(r.study,r.study_url)}</td>
      <td>${typeBadge2(r.type)}</td>
      <td style="font-size:11px;color:#64748b">${r.cancel_date||'—'}</td>
      <td style="font-size:11px;color:#64748b;max-width:180px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap" title="${(r.reason||'').replace(/"/g,"'")}">${r.reason||'<em style="color:#dc2626">Missing</em>'}</td>
    </tr>`).join('') + `</tbody></table>`;
  }
  if(!body) body = '<p style="color:#94a3b8;padding:20px;text-align:center">No records found</p>';
  openModal(coordName, upcoming.length+' upcoming · '+allCancelRows.length+' cancellations', body);
}


// ═══════════════════════════════════════════════════
// CLICKUP REFERRAL PIPELINE INTEGRATION
// ═══════════════════════════════════════════════════
let REFERRAL_DATA = [];        // all referral tasks normalized
let CAMPAIGN_DATA = [];        // central campaign aggregates
let FB_CRM_DATA = [];          // Facebook CRM leads from Google Sheet
let MED_RECORDS_DATA = [];     // Medical Records & Patient's Path (per-study patient tracking)
let PATIENT_NJ_DATA = [];      // Patient tracker NJ (Pennington site)
let _referralsLoaded = false;

function getClickUpToken() { return localStorage.getItem('crp_clickup_token') || ''; }
function saveClickUpToken() {
  const token = document.getElementById('clickup-token-input').value.trim();
  if (!token) return;
  localStorage.setItem('crp_clickup_token', token);
  initReferrals();
}
function disconnectClickUp() {
  localStorage.removeItem('crp_clickup_token');
  _referralsLoaded = false;
  REFERRAL_DATA = [];
  CAMPAIGN_DATA = [];
  document.getElementById('referral-setup').style.display = 'block';
  document.getElementById('referral-dashboard').style.display = 'none';
}

function initReferrals() {
  const token = getClickUpToken();
  if (!token) {
    document.getElementById('referral-setup').style.display = 'block';
    document.getElementById('referral-dashboard').style.display = 'none';
    // Still load Facebook CRM even without ClickUp token
    if (FB_CRM_DATA.length === 0) fetchFacebookCRM().catch(e => console.warn('FB CRM:', e));
    return;
  }
  document.getElementById('referral-setup').style.display = 'none';
  document.getElementById('referral-dashboard').style.display = 'block';
  if (!_referralsLoaded) refreshReferrals();
}

async function refreshReferrals() {
  const token = getClickUpToken();
  if (!token) return;
  const badge = document.getElementById('ref-status-badge');
  if (badge) badge.textContent = '⏳ Fetching...';

  const CU = CRP_CONFIG.CLICKUP;
  const H = { 'Authorization': token };
  const API = 'https://api.clickup.com/api/v2';

  try {
    // 1. Fetch all referral tracker lists in parallel
    const allLists = [...CU.REFERRAL_LISTS, ...CU.EXTRA_LISTS];
    const taskPromises = allLists.map(async (list) => {
      const tasks = [];
      let page = 0;
      let hasMore = true;
      while (hasMore) {
        const resp = await fetch(`${API}/list/${list.id}/task?page=${page}&subtasks=false&include_closed=true&limit=100`, { headers: H });
        if (!resp.ok) { hasMore = false; break; }
        const data = await resp.json();
        if (data.tasks && data.tasks.length > 0) {
          tasks.push(...data.tasks);
          page++;
          if (data.tasks.length < 100) hasMore = false;
        } else { hasMore = false; }
      }
      return { list, tasks };
    });

    // 2. Fetch Central Campaigns
    const campaignPromise = (async () => {
      const resp = await fetch(`${API}/list/${CU.CAMPAIGN_LIST}/task?page=0&subtasks=false&include_closed=true&limit=100`, { headers: H });
      if (!resp.ok) return [];
      const data = await resp.json();
      return data.tasks || [];
    })();

    const [listResults, campaignTasks] = await Promise.all([
      Promise.all(taskPromises),
      campaignPromise
    ]);

    // 3. Normalize referral data
    REFERRAL_DATA = [];
    listResults.forEach(({ list, tasks }) => {
      tasks.forEach(t => {
        const fields = {};
        (t.custom_fields || []).forEach(f => {
          if (f.value === null || f.value === undefined) return;
          if (f.type === 'drop_down') {
            const opt = (f.type_config?.options || []).find(o => o.orderindex === f.value);
            fields[f.name] = opt ? opt.name : String(f.value);
          } else if (f.type === 'date') {
            fields[f.name] = f.value ? new Date(parseInt(f.value)).toISOString().split('T')[0] : null;
          } else if (f.type === 'phone') {
            fields[f.name] = typeof f.value === 'object' ? f.value.phone_number || '' : String(f.value);
          } else {
            fields[f.name] = String(f.value);
          }
        });

        const status = (t.status?.status || '').toLowerCase();
        const stage = CU.PIPELINE_MAP[status] || 'Other';

        REFERRAL_DATA.push({
          id: t.id,
          name: t.name,
          tracker: list.name,
          source_type: list.source_type,
          source: CU.SOURCE_RENAME[fields['Source']] || fields['Source'] || list.name,
          study: fields['Study'] || '',
          status_raw: t.status?.status || '',
          stage,
          phone: fields['Phone #'] || '',
          dob: fields['Patient DOB'] || '',
          referring_physician: fields['Referring Physician'] || '',
          next_appt: fields['Next Appointment Date'] || '',
          date_created: t.date_created ? new Date(parseInt(t.date_created)).toISOString().split('T')[0] : '',
          date_updated: t.date_updated ? new Date(parseInt(t.date_updated)).toISOString().split('T')[0] : '',
          days_since_update: t.date_updated ? Math.floor((Date.now() - parseInt(t.date_updated)) / 86400000) : 999,
          url: t.url || `https://app.clickup.com/t/${t.id}`,
          is_closed: CU.CLOSED_STAGES.includes(stage) || t.status?.type === 'closed' || t.status?.type === 'done',
        });
      });
    });

    // 4. Normalize campaign data
    CAMPAIGN_DATA = campaignTasks.map(t => {
      const fields = {};
      (t.custom_fields || []).forEach(f => {
        if (f.value === null || f.value === undefined) return;
        fields[f.name] = String(f.value);
      });
      return {
        study: t.name,
        vendor: (t.status?.status || '').trim(),
        first_contact: parseInt(fields['FIRST CONTACT'] || '0') || 0,
        second_contact: parseInt(fields['SECOND CONTACT'] || '0') || 0,
        third_contact: parseInt(fields['THIRD CONTACT'] || '0') || 0,
        new_referrals: parseInt(fields['New Referrals'] || '0') || 0,
        scheduled: parseInt(fields['Scheduled'] || fields['SCHEDULED'] || '0') || 0,
        url: t.url || `https://app.clickup.com/t/${t.id}`,
      };
    });

    _referralsLoaded = true;
    if (badge) badge.textContent = `✅ ${REFERRAL_DATA.length} referrals · ${new Date().toLocaleTimeString()}`;
    console.log(`CRP Referrals: Loaded ${REFERRAL_DATA.length} referrals from ${allLists.length} lists, ${CAMPAIGN_DATA.length} campaigns`);

    renderReferralDashboard();

    // Refresh cross-source KPIs now that referral data is loaded
    safe(buildRecruitmentKPIs, 'buildRecruitmentKPIs');
    safe(buildInsights, 'buildInsights');
    if (typeof renderStudiesTable === 'function') try { renderStudiesTable(); } catch(e) {}

    // Also fetch additional ClickUp sources + Facebook CRM (non-blocking)
    fetchFacebookCRM().then(function() {
      safe(buildRecruitmentKPIs, 'buildRecruitmentKPIs');
      if (typeof renderStudiesTable === 'function') try { renderStudiesTable(); } catch(e) {}
    }).catch(e => console.warn('FB CRM fetch failed:', e));
    safe(buildRecruitmentKPIs, 'buildRecruitmentKPIs');
  } catch(e) {
    console.error('CRP Referrals: Fetch failed', e);
    if (badge) badge.textContent = '❌ Fetch failed — check API token';
  }
}

function renderReferralDashboard() {
  const CU = CRP_CONFIG.CLICKUP;
  const active = REFERRAL_DATA.filter(r => !r.is_closed);
  const all = REFERRAL_DATA;

  // ── KPIs ──
  const stageCounts = {};
  CU.PIPELINE_ORDER.forEach(s => stageCounts[s] = 0);
  CU.CLOSED_STAGES.forEach(s => stageCounts[s] = 0);
  all.forEach(r => { stageCounts[r.stage] = (stageCounts[r.stage] || 0) + 1; });

  const el = id => document.getElementById(id);
  el('ref-kpi-leads').textContent = stageCounts['New Lead'] || 0;
  el('ref-kpi-contact').textContent = stageCounts['Contacted'] || 0;
  el('ref-kpi-screening').textContent = (stageCounts['Pre-Screening'] || 0) + (stageCounts['Screening'] || 0);
  el('ref-kpi-enrolled').textContent = (stageCounts['Screened'] || 0) + (stageCounts['Enrolled'] || 0);
  const totalIn = all.length;
  const totalEnrolled = (stageCounts['Screened'] || 0) + (stageCounts['Enrolled'] || 0);
  el('ref-kpi-conversion').textContent = totalIn ? Math.round(totalEnrolled / totalIn * 100) + '%' : '—';
  el('ref-total-badge').textContent = all.length + ' total referrals';

  // ── Pipeline Funnel ──
  const funnelEl = el('ref-funnel-chart');
  const maxCount = Math.max(...CU.PIPELINE_ORDER.map(s => stageCounts[s] || 0), 1);

  let funnelHtml = CU.PIPELINE_ORDER.map(stage => {
    const count = stageCounts[stage] || 0;
    const pct = maxCount ? Math.max(count / maxCount * 100, 4) : 4;
    const color = STAGE_COLORS[stage] || '#94a3b8';
    const safeStage = stage.replace(/'/g,"\\'");
    return `<div style="display:flex;align-items:center;gap:10px;margin-bottom:6px;cursor:pointer;" onclick="showReferralDetailModal(r=>r.stage==='${safeStage}','${safeStage} Referrals','${count} referrals in this stage')">
      <div style="width:100px;font-size:11px;font-weight:600;color:#475569;text-align:right;">${stage}</div>
      <div style="flex:1;background:#f1f5f9;border-radius:4px;height:28px;position:relative;overflow:hidden;">
        <div style="width:${pct}%;background:${color};height:100%;border-radius:4px;transition:width 0.5s;display:flex;align-items:center;justify-content:center;">
          <span style="font-size:11px;font-weight:700;color:#fff;text-shadow:0 1px 2px rgba(0,0,0,0.3);">${count}</span>
        </div>
      </div>
    </div>`;
  }).join('');

  // Add closed stages as smaller bars below
  const closedHtml = CU.CLOSED_STAGES.filter(s => stageCounts[s] > 0).map(stage => {
    const count = stageCounts[stage] || 0;
    const pct = maxCount ? Math.max(count / maxCount * 100, 4) : 4;
    const color = STAGE_COLORS[stage] || '#94a3b8';
    return `<div style="display:flex;align-items:center;gap:10px;margin-bottom:4px;">
      <div style="width:100px;font-size:10px;color:#94a3b8;text-align:right;">${stage}</div>
      <div style="flex:1;background:#f8fafc;border-radius:3px;height:20px;position:relative;overflow:hidden;">
        <div style="width:${pct}%;background:${color};height:100%;border-radius:3px;display:flex;align-items:center;justify-content:center;">
          <span style="font-size:10px;font-weight:600;color:#fff;">${count}</span>
        </div>
      </div>
    </div>`;
  }).join('');

  funnelEl.innerHTML = funnelHtml + (closedHtml ? '<div style="margin-top:10px;padding-top:8px;border-top:1px solid #f1f5f9;"><div style="font-size:10px;color:#94a3b8;margin-bottom:4px;text-align:right;width:100px;display:inline-block;">Closed</div></div>' + closedHtml : '');

  // ── Source Breakdown ──
  const sourceEl = el('ref-source-chart');
  const sourceCounts = {};
  all.forEach(r => { const s = r.source || 'Unknown'; sourceCounts[s] = (sourceCounts[s] || 0) + 1; });
  const sources = Object.entries(sourceCounts).sort((a,b) => b[1] - a[1]);
  const srcColors = ['#3b82f6','#f59e0b','#10b981','#8b5cf6','#ef4444','#06b6d4','#f97316','#ec4899'];
  sourceEl.innerHTML = sources.map(([name,count], i) => {
    const pct = Math.round(count / all.length * 100);
    const color = srcColors[i % srcColors.length];
    return `<div style="display:flex;align-items:center;gap:10px;margin-bottom:6px;">
      <div style="width:8px;height:8px;border-radius:50%;background:${color};flex-shrink:0;"></div>
      <div style="width:120px;font-size:12px;font-weight:600;color:#334155;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;" title="${name}">${name}</div>
      <div style="flex:1;background:#f1f5f9;border-radius:3px;height:20px;overflow:hidden;">
        <div style="width:${Math.max(pct,3)}%;background:${color};height:100%;border-radius:3px;"></div>
      </div>
      <div style="font-size:12px;font-weight:700;color:#1e293b;min-width:40px;text-align:right;">${count} <span style="font-size:10px;color:#94a3b8;">(${pct}%)</span></div>
    </div>`;
  }).join('') || '<div style="color:#94a3b8;text-align:center;padding:20px;">No source data</div>';

  // ── Pipeline by Study ──
  const studyEl = el('ref-study-table');
  const studyMap = {};
  all.forEach(r => {
    const s = r.study || 'Unassigned';
    if (!studyMap[s]) studyMap[s] = { total: 0, active: 0, enrolled: 0, dnq: 0, stages: {} };
    studyMap[s].total++;
    if (!r.is_closed) studyMap[s].active++;
    if (r.stage === 'Enrolled' || r.stage === 'Screened') studyMap[s].enrolled++;
    if (r.stage === 'DNQ' || r.stage === 'Screen Fail') studyMap[s].dnq++;
    studyMap[s].stages[r.stage] = (studyMap[s].stages[r.stage] || 0) + 1;
  });
  const studyRows = Object.entries(studyMap).sort((a,b) => b[1].total - a[1].total);
  studyEl.innerHTML = `<table class="fin-table" style="width:100%;font-size:12px;">
    <thead><tr>
      <th style="text-align:left;padding:10px 12px;">Study</th>
      <th style="text-align:center;">Total</th>
      <th style="text-align:center;">Active</th>
      <th style="text-align:center;">Enrolled</th>
      <th style="text-align:center;">DNQ/SF</th>
      <th style="text-align:center;">Conv %</th>
    </tr></thead>
    <tbody>${studyRows.map(([name, d]) => {
      const conv = d.total ? Math.round(d.enrolled / d.total * 100) : 0;
      const convColor = conv >= 30 ? '#059669' : conv >= 15 ? '#d97706' : '#dc2626';
      const safeName = name.replace(/'/g,"\\'");
      return `<tr style="cursor:pointer;transition:background .1s" onmouseover="this.style.background='#f8fafc'" onmouseout="this.style.background=''" onclick="showStudyPipelineModal('${safeName}')">
        <td style="padding:8px 12px;font-weight:600;max-width:180px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;" title="${name}">${name}</td>
        <td style="text-align:center;font-weight:700;">${d.total}</td>
        <td style="text-align:center;color:#3b82f6;">${d.active}</td>
        <td style="text-align:center;color:#059669;font-weight:700;">${d.enrolled}</td>
        <td style="text-align:center;color:#dc2626;">${d.dnq}</td>
        <td style="text-align:center;font-weight:700;color:${convColor};">${conv}%</td>
      </tr>`;
    }).join('')}</tbody>
  </table>`;

  // ── Stale Leads (active, not updated in 7+ days) ──
  const staleEl = el('ref-stale-list');
  const staleBadge = el('ref-stale-badge');
  const staleLeads = active.filter(r => r.days_since_update >= 7)
    .sort((a,b) => b.days_since_update - a.days_since_update);
  if (staleBadge) staleBadge.textContent = staleLeads.length + ' stale';

  if (staleLeads.length === 0) {
    staleEl.innerHTML = '<div style="text-align:center;padding:20px;color:var(--muted);font-size:13px;">🟢 No stale leads — all active referrals updated within 7 days</div>';
  } else {
    staleEl.innerHTML = staleLeads.slice(0, 15).map(r => {
      const urgency = r.days_since_update >= 14 ? '#dc2626' : '#d97706';
      return `<div style="display:flex;justify-content:space-between;align-items:center;padding:8px 0;border-bottom:1px solid #f1f5f9;">
        <div>
          <a href="${r.url}" target="_blank" style="font-size:12px;font-weight:600;color:#1e293b;text-decoration:none;">${maskPHI(r.name)}</a>
          <div style="font-size:10px;color:#94a3b8;">${r.study || 'No study'} · ${r.tracker} · ${r.stage}</div>
        </div>
        <span style="font-size:10px;font-weight:700;padding:2px 8px;border-radius:4px;background:${urgency}22;color:${urgency};">${r.days_since_update}d ago</span>
      </div>`;
    }).join('') + (staleLeads.length > 15 ? `<div style="text-align:center;padding:8px;font-size:11px;color:#94a3b8;">+${staleLeads.length - 15} more</div>` : '');
  }

  // ── Tracker Detail ──
  const trackerEl = el('ref-tracker-detail');
  const trackerMap = {};
  all.forEach(r => {
    if (!trackerMap[r.tracker]) trackerMap[r.tracker] = [];
    trackerMap[r.tracker].push(r);
  });
  const trackerRows = Object.entries(trackerMap).sort((a,b) => b[1].length - a[1].length);
  trackerEl.innerHTML = `<table class="fin-table" style="width:100%;font-size:12px;">
    <thead><tr>
      <th style="text-align:left;padding:10px 12px;">Tracker</th>
      <th style="text-align:center;">Total</th>
      <th style="text-align:center;">New Lead</th>
      <th style="text-align:center;">Contacted</th>
      <th style="text-align:center;">Pre-Screen</th>
      <th style="text-align:center;">Screening</th>
      <th style="text-align:center;">Enrolled</th>
      <th style="text-align:center;">DNQ/Lost</th>
    </tr></thead>
    <tbody>${trackerRows.map(([name, tasks]) => {
      const sc = {};
      tasks.forEach(t => { sc[t.stage] = (sc[t.stage] || 0) + 1; });
      return `<tr>
        <td style="padding:8px 12px;font-weight:600;">${name}</td>
        <td style="text-align:center;font-weight:700;">${tasks.length}</td>
        <td style="text-align:center;">${sc['New Lead']||0}</td>
        <td style="text-align:center;">${sc['Contacted']||0}</td>
        <td style="text-align:center;">${sc['Pre-Screening']||0}</td>
        <td style="text-align:center;">${sc['Screening']||0}</td>
        <td style="text-align:center;color:#059669;font-weight:700;">${(sc['Screened']||0)+(sc['Enrolled']||0)}</td>
        <td style="text-align:center;color:#dc2626;">${(sc['DNQ']||0)+(sc['Screen Fail']||0)+(sc['Lost']||0)}</td>
      </tr>`;
    }).join('')}</tbody>
  </table>`;

  // ── Central Campaigns (merged with cross-reference) ──
  const campEl = el('ref-campaigns-table');
  const campBadge = el('ref-camp-badge');
  if (CAMPAIGN_DATA.length === 0) {
    campEl.innerHTML = '<div style="text-align:center;padding:20px;color:var(--muted);font-size:13px;">No campaign data available</div>';
    if (campBadge) campBadge.textContent = '—';
  } else {
    const campaigns = CAMPAIGN_DATA.filter(c => c.first_contact > 0 || c.new_referrals > 0)
      .sort((a,b) => b.first_contact - a.first_contact);
    if (campBadge) campBadge.textContent = campaigns.length + ' active campaigns';

    // Enrich each campaign with cross-reference data
    const enriched = campaigns.map(c => {
      const sn = c.study.toLowerCase().trim();
      const referrals = REFERRAL_DATA.filter(r => {
        const rs = (r.study||'').toLowerCase().trim();
        return rs === sn || rs.includes(sn) || sn.includes(rs);
      });
      const upcoming = (DATA.allVisitDetail || []).filter(v =>
        v.study.toLowerCase().includes(sn) || sn.includes(v.study.toLowerCase())
      );
      // Count scheduled from referral pipeline (Pre-Screening + Screening + Screened stages) OR from ClickUp field
      const pipelineScheduled = referrals.filter(r =>
        ['Pre-Screening','Screening','Screened','Enrolled'].includes(r.stage)
      ).length;
      const scheduledCount = c.scheduled > 0 ? c.scheduled : pipelineScheduled;
      const convRate = c.new_referrals > 0 ? Math.round(scheduledCount / c.new_referrals * 100) : (scheduledCount > 0 ? 100 : 0);
      let flagged = 0;
      referrals.forEach(r => {
        const dbMatch = PATIENT_DB_MAP.get(r.name.toLowerCase().trim());
        if (dbMatch && dbMatch.status !== 'Available') flagged++;
      });
      return { ...c, scheduledCount, convRate, pipeline: referrals.length, active: referrals.filter(r=>!r.is_closed).length, upcomingVisits: upcoming.length, flagged };
    });

    // KPI summary bar
    const totalContacts = enriched.reduce((s,c) => s + c.first_contact, 0);
    const totalReferrals = enriched.reduce((s,c) => s + c.new_referrals, 0);
    const totalScheduled = enriched.reduce((s,c) => s + c.scheduledCount, 0);
    const totalPipeline = enriched.reduce((s,c) => s + c.pipeline, 0);
    const totalUpcoming = enriched.reduce((s,c) => s + c.upcomingVisits, 0);
    const overallConv = totalReferrals > 0 ? Math.round(totalScheduled / totalReferrals * 100) : 0;

    let campHtml = `<div style="display:flex;gap:12px;flex-wrap:wrap;padding:12px 16px;border-bottom:1px solid #f1f5f9;">
      <div style="text-align:center;min-width:70px;"><div style="font-size:18px;font-weight:800;color:#3b82f6;">${totalContacts.toLocaleString()}</div><div style="font-size:10px;color:#94a3b8;">Total Contacts</div></div>
      <div style="text-align:center;min-width:70px;"><div style="font-size:18px;font-weight:800;color:#059669;">${totalReferrals}</div><div style="font-size:10px;color:#94a3b8;">New Referrals</div></div>
      <div style="text-align:center;min-width:70px;"><div style="font-size:18px;font-weight:800;color:#8b5cf6;">${totalScheduled}</div><div style="font-size:10px;color:#94a3b8;">Scheduled</div></div>
      <div style="text-align:center;min-width:70px;"><div style="font-size:18px;font-weight:800;color:${overallConv>=20?'#059669':overallConv>=10?'#d97706':'#dc2626'};">${overallConv}%</div><div style="font-size:10px;color:#94a3b8;">Conv. Rate</div></div>
      <div style="text-align:center;min-width:70px;"><div style="font-size:18px;font-weight:800;color:#1843ad;">${totalPipeline}</div><div style="font-size:10px;color:#94a3b8;">In Pipeline</div></div>
      <div style="text-align:center;min-width:70px;"><div style="font-size:18px;font-weight:800;color:#06b6d4;">${totalUpcoming}</div><div style="font-size:10px;color:#94a3b8;">Upcoming Visits</div></div>
    </div>`;

    campHtml += `<div style="overflow-x:auto;"><table class="fin-table" style="width:100%;font-size:11px;">
      <thead><tr>
        <th style="text-align:left;padding:8px 12px;">Campaign / Study</th>
        <th style="text-align:center;">Vendor</th>
        <th style="text-align:center;">1st Contact</th>
        <th style="text-align:center;">2nd</th>
        <th style="text-align:center;">3rd</th>
        <th style="text-align:center;">Referrals</th>
        <th style="text-align:center;">Scheduled</th>
        <th style="text-align:center;">Conv %</th>
        <th style="text-align:center;">Pipeline</th>
        <th style="text-align:center;">Upcoming</th>
        <th style="text-align:center;">Flags</th>
      </tr></thead>
      <tbody>${enriched.map(c => {
        const crColor = c.convRate >= 20 ? '#059669' : c.convRate >= 10 ? '#d97706' : '#dc2626';
        const safeName = c.study.replace(/'/g,"\\'");
        return `<tr style="cursor:pointer;transition:background .1s" onmouseover="this.style.background='#f8fafc'" onmouseout="this.style.background=''" onclick="showCampaignDetailModal('${safeName}')">
          <td style="padding:7px 12px;font-weight:600;"><a href="${c.url}" target="_blank" onclick="event.stopPropagation()" style="color:#1e293b;text-decoration:none;">${c.study}</a></td>
          <td style="text-align:center;"><span style="font-size:10px;padding:2px 6px;border-radius:4px;background:#e8eeff;color:#1843ad;font-weight:600;">${c.vendor}</span></td>
          <td style="text-align:center;font-weight:700;">${c.first_contact.toLocaleString()}</td>
          <td style="text-align:center;">${c.second_contact.toLocaleString()}</td>
          <td style="text-align:center;">${c.third_contact.toLocaleString()}</td>
          <td style="text-align:center;color:#059669;font-weight:700;">${c.new_referrals}</td>
          <td style="text-align:center;color:#8b5cf6;font-weight:700;">${c.scheduledCount}</td>
          <td style="text-align:center;font-weight:700;color:${crColor};">${c.convRate}%</td>
          <td style="text-align:center;color:#1843ad;">${c.pipeline > 0 ? c.active+'/'+c.pipeline : '—'}</td>
          <td style="text-align:center;color:#06b6d4;font-weight:600;">${c.upcomingVisits || '—'}</td>
          <td style="text-align:center;color:${c.flagged>0?'#dc2626':'#059669'};font-weight:${c.flagged>0?'700':'400'};">${c.flagged>0?'⚠ '+c.flagged:'✓'}</td>
        </tr>`;
      }).join('')}</tbody>
    </table></div>`;

    campEl.innerHTML = campHtml;
  }

  // Render the cross-reference detail section
  renderCampaignXRef();

  // Render cross-source patient journey funnel
  buildPatientJourneyFunnel();
}

function buildPatientJourneyFunnel() {
  var container = document.getElementById('ref-journey-funnel');
  if (!container) return;

  // Cross-source funnel stages
  var totalLeads = (REFERRAL_DATA ? REFERRAL_DATA.length : 0) + (FB_CRM_DATA ? FB_CRM_DATA.length : 0);
  var contacted = REFERRAL_DATA ? REFERRAL_DATA.filter(function(r){ return r.stage === 'Contacted' || r.stage === 'Pre-Screening'; }).length : 0;
  var medRecsCreated = MED_RECORDS_DATA ? MED_RECORDS_DATA.length : 0;
  var inScreening = (MED_RECORDS_DATA ? MED_RECORDS_DATA.filter(function(r){ return r.status === 'In Screening' || r.status === 'Visit Scheduled'; }).length : 0);
  var enrolled = (MED_RECORDS_DATA ? MED_RECORDS_DATA.filter(function(r){ return r.status === 'Enrolled' || r.status === 'Complete'; }).length : 0);

  if (totalLeads === 0 && medRecsCreated === 0) {
    container.innerHTML = '<div style="text-align:center;padding:20px;color:var(--muted);font-size:13px;">No cross-source data available yet</div>';
    return;
  }

  var stages = [
    { label: 'Total Leads', count: totalLeads, color: '#3b82f6', sources: 'Referrals + FB CRM' },
    { label: 'Contacted / Pre-Screen', count: contacted, color: '#f59e0b', sources: 'Referral Pipeline' },
    { label: 'Medical Records Created', count: medRecsCreated, color: '#8b5cf6', sources: 'Med Records System' },
    { label: 'In Screening / Scheduled', count: inScreening, color: '#06b6d4', sources: 'Med Records + Referrals' },
    { label: 'Enrolled / Complete', count: enrolled, color: '#059669', sources: 'Med Records System' },
  ];

  var maxCount = Math.max.apply(null, stages.map(function(s){ return s.count; })) || 1;

  var html = '';

  // Funnel bars
  stages.forEach(function(stage, i) {
    var pct = Math.max(stage.count / maxCount * 100, 3);
    var convPct = i > 0 && stages[i-1].count > 0 ? Math.round(stage.count / stages[i-1].count * 100) : 0;
    html += '<div style="display:flex;align-items:center;gap:12px;margin-bottom:8px;">';
    html += '<div style="width:180px;text-align:right;"><div style="font-size:12px;font-weight:600;color:#1e293b;">' + stage.label + '</div><div style="font-size:9px;color:#94a3b8;">' + stage.sources + '</div></div>';
    html += '<div style="flex:1;background:#f1f5f9;border-radius:6px;height:32px;overflow:hidden;position:relative;">';
    html += '<div style="width:' + pct + '%;background:' + stage.color + ';height:100%;border-radius:6px;display:flex;align-items:center;justify-content:center;transition:width 0.5s;">';
    html += '<span style="font-size:12px;font-weight:800;color:#fff;text-shadow:0 1px 2px rgba(0,0,0,.3);">' + stage.count + '</span>';
    html += '</div></div>';
    if (i > 0 && convPct > 0) {
      html += '<div style="min-width:50px;text-align:center;"><span style="font-size:10px;font-weight:700;color:' + (convPct >= 50 ? '#059669' : convPct >= 20 ? '#d97706' : '#dc2626') + ';">' + convPct + '%</span></div>';
    } else {
      html += '<div style="min-width:50px;"></div>';
    }
    html += '</div>';
  });

  // Overall conversion
  if (totalLeads > 0 && enrolled > 0) {
    var overallConv = Math.round(enrolled / totalLeads * 100);
    html += '<div style="margin-top:12px;text-align:center;padding:8px;background:#e8eeff;border-radius:8px;">';
    html += '<span style="font-size:12px;color:#1843ad;font-weight:600;">Overall Lead → Enrolled: <span style="font-size:16px;font-weight:800;">' + overallConv + '%</span></span>';
    html += '</div>';
  }

  container.innerHTML = html;
}


// ── Study ↔ Referral Pipeline helper (for Studies tab) ──────────────
function getStudyReferralPipeline(studyName) {
  if (!REFERRAL_DATA || REFERRAL_DATA.length === 0) return null;
  const sn = studyName.toLowerCase().trim();
  const matches = REFERRAL_DATA.filter(r => {
    const rs = (r.study||'').toLowerCase().trim();
    return rs === sn || rs.includes(sn) || sn.includes(rs);
  });
  if (matches.length === 0) return null;
  const stages = {};
  let active = 0;
  matches.forEach(r => {
    stages[r.stage] = (stages[r.stage] || 0) + 1;
    if (!r.is_closed) active++;
  });
  return { total: matches.length, active, stages, referrals: matches };
}

// ── Study Pipeline Modal (click from Studies tab) ───────────────────
function showStudyPipelineModal(studyName) {
  const ref = getStudyReferralPipeline(studyName);
  if (!ref) { openModal(studyName + ' — Referral Pipeline', '', '<div style="text-align:center;padding:30px;color:#94a3b8;">No referral data found for this study</div>'); return; }

  const CU = CRP_CONFIG.CLICKUP;

  // Funnel bars
  let funnel = '<div style="margin-bottom:16px;">';
  [...CU.PIPELINE_ORDER, ...CU.CLOSED_STAGES].forEach(stage => {
    const count = ref.stages[stage] || 0;
    if (count === 0) return;
    const pct = Math.max(count / ref.total * 100, 5);
    const color = STAGE_COLORS[stage] || '#94a3b8';
    funnel += `<div style="display:flex;align-items:center;gap:8px;margin-bottom:4px;">
      <div style="width:90px;font-size:11px;font-weight:600;color:#475569;text-align:right;">${stage}</div>
      <div style="flex:1;background:#f1f5f9;border-radius:3px;height:22px;overflow:hidden;">
        <div style="width:${pct}%;background:${color};height:100%;border-radius:3px;display:flex;align-items:center;padding-left:6px;">
          <span style="font-size:11px;font-weight:700;color:#fff;">${count}</span>
        </div>
      </div>
    </div>`;
  });
  funnel += '</div>';

  // Detail table
  const rows = ref.referrals.sort((a,b) => {
    const order = [...CU.PIPELINE_ORDER, ...CU.CLOSED_STAGES];
    return order.indexOf(a.stage) - order.indexOf(b.stage);
  });
  let table = `<table class="detail-table" style="width:100%;font-size:11px;"><thead><tr>
    <th>Name</th><th>Stage</th><th>Source</th><th>Next Appt</th><th>Days Since Update</th><th>Patient DB</th>
  </tr></thead><tbody>`;
  rows.forEach(r => {
    // Cross-reference with patient DB
    const nameKey = r.name.toLowerCase().trim();
    const dbMatch = PATIENT_DB_MAP.get(nameKey);
    const dbStatus = dbMatch ? `<span style="padding:2px 6px;border-radius:3px;font-size:10px;font-weight:600;background:${dbMatch.status==='Available'?'#dcfce7':'#fef2f2'};color:${dbMatch.status==='Available'?'#059669':'#dc2626'}">${dbMatch.status}</span>` : '<span style="color:#cbd5e1;font-size:10px;">Not found</span>';

    // Check upcoming appointments
    const upcoming = (DATA.allVisitDetail || []).filter(v => v.patient.toLowerCase().trim() === nameKey);
    const nextApptDisplay = upcoming.length > 0
      ? `<span style="color:#059669;font-weight:600;">${upcoming[0].date}</span> <span style="font-size:9px;color:#94a3b8;">${upcoming[0].visit}</span>`
      : r.next_appt ? `<span style="color:#3b82f6;">${r.next_appt}</span>` : '<span style="color:#cbd5e1;">—</span>';

    const staleColor = r.days_since_update >= 14 ? '#dc2626' : r.days_since_update >= 7 ? '#d97706' : '#059669';
    table += `<tr>
      <td style="padding:6px 8px;"><a href="${r.url}" target="_blank" style="font-weight:600;color:#1e293b;text-decoration:none;">${maskPHI(r.name)}</a></td>
      <td style="padding:6px 8px;text-align:center;"><span style="padding:2px 6px;border-radius:3px;font-size:10px;font-weight:600;background:${(STAGE_COLORS[r.stage]||'#94a3b8')}22;color:${STAGE_COLORS[r.stage]||'#94a3b8'}">${r.stage}</span></td>
      <td style="padding:6px 8px;font-size:10px;color:#475569;">${r.source}</td>
      <td style="padding:6px 8px;">${nextApptDisplay}</td>
      <td style="padding:6px 8px;text-align:center;"><span style="font-weight:600;color:${staleColor};">${r.days_since_update}d</span></td>
      <td style="padding:6px 8px;">${dbStatus}</td>
    </tr>`;
  });
  table += '</tbody></table>';

  openModal(studyName + ' — Referral Pipeline', `${ref.total} total referrals · ${ref.active} active`, funnel + table);
}

// ── Campaign Detail Modal (click from campaign row) ─────────────────
function showCampaignDetailModal(studyName) {
  // Cross-reference this campaign's study name against:
  // 1. REFERRAL_DATA (individual referrals for this study)
  // 2. PATIENT_DB (status of participants)
  // 3. DATA.allVisitDetail (upcoming appointments)
  const sn = studyName.toLowerCase().trim();

  // Find referrals matching this campaign study
  const referrals = REFERRAL_DATA.filter(r => {
    const rs = (r.study||'').toLowerCase().trim();
    return rs === sn || rs.includes(sn) || sn.includes(rs);
  });

  // Find upcoming visits for this study
  const upcoming = (DATA.allVisitDetail || []).filter(v =>
    v.study.toLowerCase().includes(sn) || sn.includes(v.study.toLowerCase())
  );

  // Campaign metadata
  const campaign = CAMPAIGN_DATA.find(c => c.study === studyName);

  let html = '';

  // Campaign Summary KPIs
  if (campaign) {
    html += `<div style="display:flex;gap:12px;flex-wrap:wrap;margin-bottom:16px;padding:12px;background:#f8fafc;border-radius:8px;">
      <div style="text-align:center;min-width:80px;"><div style="font-size:20px;font-weight:800;color:#3b82f6;">${campaign.first_contact.toLocaleString()}</div><div style="font-size:10px;color:#94a3b8;">1st Contact</div></div>
      <div style="text-align:center;min-width:80px;"><div style="font-size:20px;font-weight:800;color:#f59e0b;">${campaign.second_contact.toLocaleString()}</div><div style="font-size:10px;color:#94a3b8;">2nd Contact</div></div>
      <div style="text-align:center;min-width:80px;"><div style="font-size:20px;font-weight:800;color:#8b5cf6;">${campaign.third_contact.toLocaleString()}</div><div style="font-size:10px;color:#94a3b8;">3rd Contact</div></div>
      <div style="text-align:center;min-width:80px;"><div style="font-size:20px;font-weight:800;color:#059669;">${campaign.new_referrals}</div><div style="font-size:10px;color:#94a3b8;">New Referrals</div></div>
      <div style="text-align:center;min-width:80px;"><div style="font-size:20px;font-weight:800;color:#1843ad;">${referrals.length}</div><div style="font-size:10px;color:#94a3b8;">In Pipeline</div></div>
      <div style="text-align:center;min-width:80px;"><div style="font-size:20px;font-weight:800;color:#06b6d4;">${upcoming.length}</div><div style="font-size:10px;color:#94a3b8;">Upcoming Visits</div></div>
    </div>`;
  }

  // Referral Pipeline Participants with cross-reference
  if (referrals.length > 0) {
    html += `<div style="font-size:12px;font-weight:700;color:var(--navy);margin-bottom:8px;">📋 Referral Pipeline Participants</div>`;
    html += `<table class="detail-table" style="width:100%;font-size:11px;margin-bottom:16px;"><thead><tr>
      <th>Participant</th><th>Stage</th><th>Source</th><th>Appt Booked</th><th>Patient Status</th><th>Last Updated</th>
    </tr></thead><tbody>`;
    referrals.sort((a,b) => a.days_since_update - b.days_since_update).forEach(r => {
      const nameKey = r.name.toLowerCase().trim();
      const dbMatch = PATIENT_DB_MAP.get(nameKey);
      const pVisits = (DATA.allVisitDetail || []).filter(v => v.patient.toLowerCase().trim() === nameKey);
      const apptBooked = pVisits.length > 0
        ? `<span style="color:#059669;font-weight:700;">✓ ${pVisits[0].date}</span><div style="font-size:9px;color:#94a3b8;">${pVisits[0].visit}</div>`
        : r.next_appt ? `<span style="color:#3b82f6;">${r.next_appt}</span>` : '<span style="color:#ef4444;font-size:10px;">No appt</span>';
      const pStatus = dbMatch
        ? `<span style="padding:2px 6px;border-radius:3px;font-size:10px;font-weight:600;background:${dbMatch.status==='Available'?'#dcfce7':dbMatch.status==='Do Not Solicit'||dbMatch.status==='Deceased'?'#fef2f2':'#fffbeb'};color:${dbMatch.status==='Available'?'#059669':dbMatch.status==='Do Not Solicit'||dbMatch.status==='Deceased'?'#dc2626':'#d97706'}">${dbMatch.status}</span>`
        : '<span style="color:#94a3b8;font-size:10px;">Not in DB</span>';
      const staleColor = r.days_since_update >= 14 ? '#dc2626' : r.days_since_update >= 7 ? '#d97706' : '#059669';
      html += `<tr>
        <td style="padding:6px 8px;"><a href="${r.url}" target="_blank" style="font-weight:600;color:#1e293b;text-decoration:none;">${maskPHI(r.name)}</a></td>
        <td style="padding:6px 8px;text-align:center;"><span style="padding:2px 6px;border-radius:3px;font-size:10px;font-weight:600;background:${(STAGE_COLORS[r.stage]||'#94a3b8')}22;color:${STAGE_COLORS[r.stage]||'#94a3b8'}">${r.stage}</span></td>
        <td style="padding:6px 8px;font-size:10px;color:#475569;">${r.source}</td>
        <td style="padding:6px 8px;">${apptBooked}</td>
        <td style="padding:6px 8px;">${pStatus}</td>
        <td style="padding:6px 8px;text-align:center;font-weight:600;color:${staleColor};">${r.days_since_update}d ago</td>
      </tr>`;
    });
    html += '</tbody></table>';
  } else {
    html += `<div style="padding:16px;color:#94a3b8;text-align:center;font-size:12px;">No individual referrals tracked for this campaign in ClickUp</div>`;
  }

  // Upcoming visits for this study
  if (upcoming.length > 0) {
    html += `<div style="font-size:12px;font-weight:700;color:var(--navy);margin-bottom:8px;">📅 Upcoming Appointments (${upcoming.length})</div>`;
    html += `<table class="detail-table" style="width:100%;font-size:11px;"><thead><tr>
      <th>Date</th><th>Patient</th><th>Visit</th><th>Status</th><th>Coordinator</th>
    </tr></thead><tbody>`;
    upcoming.slice(0, 20).forEach(v => {
      html += `<tr>
        <td style="padding:5px 8px;font-weight:600;color:#1843ad;">${v.date}</td>
        <td style="padding:5px 8px;"><a href="${v.patient_url}" target="_blank" style="color:#1e293b;text-decoration:none;font-weight:600;">${maskPHI(v.patient)}</a></td>
        <td style="padding:5px 8px;font-size:10px;color:#475569;">${v.visit}</td>
        <td style="padding:5px 8px;font-size:10px;">${v.status}</td>
        <td style="padding:5px 8px;font-size:10px;color:#475569;">${v.coord}</td>
      </tr>`;
    });
    html += '</tbody></table>';
    if (upcoming.length > 20) html += `<div style="text-align:center;padding:6px;font-size:10px;color:#94a3b8;">+${upcoming.length - 20} more visits</div>`;
  }

  if (!html) html = '<div style="text-align:center;padding:30px;color:#94a3b8;">No cross-reference data available for this campaign</div>';

  openModal('📣 ' + studyName, campaign ? `Vendor: ${campaign.vendor} · ${campaign.first_contact} total contacts` : '', html);
}

// ── Campaign ↔ Patient DB Cross-Reference Renderer ──────────────────
function renderCampaignXRef() {
  const el = document.getElementById('ref-campaign-xref');
  const badge = document.getElementById('ref-xref-badge');
  if (!el) return;

  // Collect ALL referral participants that match any campaign study
  const allParticipants = [];
  const studiesChecked = new Set();

  CAMPAIGN_DATA.forEach(c => {
    const sn = c.study.toLowerCase().trim();
    if (studiesChecked.has(sn)) return;
    studiesChecked.add(sn);

    REFERRAL_DATA.filter(r => {
      const rs = (r.study||'').toLowerCase().trim();
      return rs === sn || rs.includes(sn) || sn.includes(rs);
    }).forEach(r => {
      const nameKey = r.name.toLowerCase().trim();
      const dbMatch = PATIENT_DB_MAP.get(nameKey);
      const pVisits = (DATA.allVisitDetail || []).filter(v => v.patient.toLowerCase().trim() === nameKey);
      allParticipants.push({ ...r, campaign: c.study, dbMatch, pVisits });
    });
  });

  if (badge) badge.textContent = allParticipants.length + ' participants';

  if (allParticipants.length === 0) {
    el.innerHTML = `<div style="padding:8px 16px;background:#f8fafc;"><span style="font-size:12px;font-weight:700;color:var(--navy);">🔗 Participant Status & Appointments</span> <span class="badge badge-purple" style="margin-left:6px;">0</span></div>
    <div style="text-align:center;padding:16px;color:#94a3b8;font-size:12px;">No individual participants to cross-reference — click any campaign row above for details</div>`;
    return;
  }

  // Show participants needing attention first (no appt, flagged, stale)
  const sorted = allParticipants.sort((a,b) => {
    const aUrgent = (a.pVisits.length === 0 && !a.next_appt ? 2 : 0) + (a.dbMatch && a.dbMatch.status !== 'Available' ? 3 : 0) + (a.days_since_update >= 7 ? 1 : 0);
    const bUrgent = (b.pVisits.length === 0 && !b.next_appt ? 2 : 0) + (b.dbMatch && b.dbMatch.status !== 'Available' ? 3 : 0) + (b.days_since_update >= 7 ? 1 : 0);
    return bUrgent - aUrgent || a.days_since_update - b.days_since_update;
  });

  let html = `<div style="padding:8px 16px;background:#f8fafc;border-bottom:1px solid #f1f5f9;"><span style="font-size:12px;font-weight:700;color:var(--navy);">🔗 Participant Status & Appointments</span> <span class="badge badge-purple" style="margin-left:6px;">${allParticipants.length}</span></div>`;
  html += `<div style="overflow-x:auto;max-height:400px;overflow-y:auto;"><table class="fin-table" style="width:100%;font-size:11px;">
    <thead style="position:sticky;top:0;background:#fff;z-index:1;"><tr>
      <th style="text-align:left;padding:6px 10px;">Participant</th>
      <th style="text-align:left;">Campaign</th>
      <th style="text-align:center;">Stage</th>
      <th style="text-align:center;">Appt Booked</th>
      <th style="text-align:center;">Patient Status</th>
      <th style="text-align:center;">Updated</th>
    </tr></thead>
    <tbody>${sorted.slice(0, 40).map(r => {
      const apptCell = r.pVisits.length > 0
        ? `<span style="color:#059669;font-weight:700;">✓ ${r.pVisits[0].date}</span><div style="font-size:9px;color:#94a3b8;">${r.pVisits[0].visit}</div>`
        : r.next_appt ? `<span style="color:#3b82f6;">${r.next_appt}</span>` : `<span style="color:#ef4444;font-size:10px;">No appt</span>`;
      const pStatus = r.dbMatch
        ? `<span style="padding:2px 5px;border-radius:3px;font-size:10px;font-weight:600;background:${r.dbMatch.status==='Available'?'#dcfce7':'#fef2f2'};color:${r.dbMatch.status==='Available'?'#059669':'#dc2626'}">${r.dbMatch.status}</span>`
        : '<span style="color:#94a3b8;font-size:10px;">Not in DB</span>';
      const staleColor = r.days_since_update >= 14 ? '#dc2626' : r.days_since_update >= 7 ? '#d97706' : '#059669';
      return `<tr>
        <td style="padding:5px 10px;"><a href="${r.url}" target="_blank" style="font-weight:600;color:#1e293b;text-decoration:none;">${maskPHI(r.name)}</a></td>
        <td style="padding:5px 8px;font-size:10px;color:#475569;max-width:130px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;" title="${r.campaign}">${r.campaign}</td>
        <td style="padding:5px 8px;text-align:center;"><span style="padding:2px 5px;border-radius:3px;font-size:10px;font-weight:600;background:${(STAGE_COLORS[r.stage]||'#94a3b8')}22;color:${STAGE_COLORS[r.stage]||'#94a3b8'}">${r.stage}</span></td>
        <td style="padding:5px 8px;">${apptCell}</td>
        <td style="padding:5px 8px;">${pStatus}</td>
        <td style="padding:5px 8px;text-align:center;font-weight:600;color:${staleColor};">${r.days_since_update}d</td>
      </tr>`;
    }).join('')}</tbody>
  </table></div>`;
  if (allParticipants.length > 40) html += `<div style="text-align:center;padding:6px;font-size:10px;color:#94a3b8;">Showing 40 of ${allParticipants.length} — click campaign rows for full details</div>`;

  el.innerHTML = html;
}

// ── Referral detail modal (click from funnel, tracker rows, stale leads) ──
function showReferralDetailModal(filterFn, title, subtitle) {
  const refs = REFERRAL_DATA.filter(filterFn);

  let html = `<table class="detail-table" style="width:100%;font-size:11px;"><thead><tr>
    <th>Name</th><th>Study</th><th>Stage</th><th>Source</th><th>Appt</th><th>Patient Status</th><th>Updated</th>
  </tr></thead><tbody>`;
  refs.slice(0, 50).forEach(r => {
    const nameKey = r.name.toLowerCase().trim();
    const dbMatch = PATIENT_DB_MAP.get(nameKey);
    const pVisits = (DATA.allVisitDetail || []).filter(v => v.patient.toLowerCase().trim() === nameKey);
    const apptCell = pVisits.length > 0 ? `<span style="color:#059669;font-weight:600;">${pVisits[0].date}</span>` : r.next_appt || '<span style="color:#cbd5e1;">—</span>';
    const dbCell = dbMatch ? `<span style="font-size:10px;font-weight:600;color:${dbMatch.status==='Available'?'#059669':'#dc2626'}">${dbMatch.status}</span>` : '<span style="color:#cbd5e1;font-size:10px;">—</span>';
    const staleColor = r.days_since_update >= 14 ? '#dc2626' : r.days_since_update >= 7 ? '#d97706' : '#059669';
    html += `<tr>
      <td style="padding:5px 8px;"><a href="${r.url}" target="_blank" style="font-weight:600;color:#1e293b;text-decoration:none;">${maskPHI(r.name)}</a></td>
      <td style="padding:5px 8px;font-size:10px;max-width:120px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${r.study||'—'}</td>
      <td style="padding:5px 8px;text-align:center;"><span style="padding:2px 6px;border-radius:3px;font-size:10px;font-weight:600;background:${(STAGE_COLORS[r.stage]||'#94a3b8')}22;color:${STAGE_COLORS[r.stage]||'#94a3b8'}">${r.stage}</span></td>
      <td style="padding:5px 8px;font-size:10px;color:#475569;">${r.source}</td>
      <td style="padding:5px 8px;">${apptCell}</td>
      <td style="padding:5px 8px;">${dbCell}</td>
      <td style="padding:5px 8px;text-align:center;font-weight:600;color:${staleColor};">${r.days_since_update}d</td>
    </tr>`;
  });
  html += '</tbody></table>';
  if (refs.length > 50) html += `<div style="text-align:center;padding:8px;font-size:11px;color:#94a3b8;">Showing 50 of ${refs.length}</div>`;
  if (refs.length === 0) html = '<div style="text-align:center;padding:30px;color:#94a3b8;">No referrals match this filter</div>';

  openModal(title, subtitle || `${refs.length} referrals`, html);
}


// ══════════════════════════════════════════════════════════════
// MEDICAL RECORDS & PATIENT'S PATH
// ══════════════════════════════════════════════════════════════
async function fetchMedicalRecords() {
  return;
}

let _medRecFilter = 'upcoming'; // 'upcoming' or 'all'

function renderMedicalRecords() {
  return;
}

function showMedRecDetailModal(studyName) {
  return;
}


// ══════════════════════════════════════════════════════════════
// PATIENT TRACKER NJ (PENNINGTON)
// ══════════════════════════════════════════════════════════════
async function fetchPatientTrackerNJ() {
  return;
}

function renderPatientTrackerNJ() {
  return;
}





async function fetchFacebookCRM() {
  const url = CRP_CONFIG.CLICKUP.FACEBOOK_CRM_URL;
  if (!url) return;
  try {
    // Fetch raw CSV text (may not have headers)
    const text = await fetchText(url);
    const lines = text.split('\n').filter(l => l.trim());

    // Detect if first row is headers or data
    const firstLine = lines[0] || '';
    const hasHeaders = /^(name|email|phone|status|lead|campaign)/i.test(firstLine.split(',')[0]);

    if (hasHeaders) {
      // Standard CSV with headers — use fetchCSV approach
      const rows = await fetchCSV(url);
      FB_CRM_DATA = rows;
    } else {
      // Headerless Facebook Leads CSV — map by position
      // Known format: LeadID, Timestamp, AdGroupID, Campaign, AdSetID, AdSetName, CampaignID,
      //   CampaignName, FormID, FormName, IsOrganic, Platform, Q1, Q2, Q3,
      //   Email, Name, Phone, Zip, DOB, ..., Status(last non-empty)
      FB_CRM_DATA = lines.map(line => {
        const cols = line.split(',').map(c => c.replace(/\r/g, '').trim());
        // Find last non-empty column for status
        let status = '';
        for (let i = cols.length - 1; i >= 20; i--) {
          if (cols[i] && cols[i] !== '') { status = cols[i]; break; }
        }
        return {
          'Lead ID': cols[0] || '',
          'Date Created': cols[1] || '',
          'Study Campaign': cols[3] || cols[5] || '',
          'Platform': cols[11] || '',
          'Email': cols[15] || '',
          'Full Name': cols[16] || '',
          'Phone': (cols[17] || '').replace(/^p:\+?/, ''),
          'Zip': (cols[18] || '').replace(/^z:/, ''),
          'DOB': cols[19] || '',
          'Status': status,
          'Delfa': cols[12] === 'yes' ? 'Yes' : '',
        };
      });
    }

    console.log(`CRP: Facebook CRM loaded — ${FB_CRM_DATA.length} rows`);
    renderFacebookCRM();
  } catch(e) {
    console.warn('CRP: Facebook CRM fetch failed:', e.message);
    const el = document.getElementById('ref-fb-table');
    if (el) el.innerHTML = '<div style="text-align:center;padding:20px;color:#94a3b8;font-size:13px;">⚠️ Could not load Facebook CRM sheet</div>';
  }
}

function renderFacebookCRM() {
  const el = document.getElementById('ref-fb-table');
  const badge = document.getElementById('ref-fb-badge');
  if (!el || FB_CRM_DATA.length === 0) return;

  // Detect columns dynamically
  const cols = Object.keys(FB_CRM_DATA[0] || {});
  if (badge) badge.textContent = `${FB_CRM_DATA.length} leads`;

  // Try to identify key columns (name, phone, email, study, status, notes, etc.)
  const findCol = (...patterns) => cols.find(c => patterns.some(p => c.toLowerCase().includes(p)));
  const nameCol = findCol('name', 'full name', 'patient');
  const phoneCol = findCol('phone', 'mobile', 'cell');
  const emailCol = findCol('email');
  const studyCol = findCol('study', 'campaign', 'indication', 'condition');
  const statusCol = findCol('status', 'disposition', 'outcome');
  const notesCol = findCol('notes', 'comment', 'recruiter', 'response');
  const dateCol = findCol('date', 'created', 'submitted', 'timestamp');
  const delfaCol = findCol('delfa', 'ai', 'pre-screen', 'prescreen');

  // Calculate summary stats
  const statusCounts = {};
  const studyCounts = {};
  let delfaCount = 0;
  FB_CRM_DATA.forEach(r => {
    const status = statusCol ? (r[statusCol] || '').trim() : '';
    if (status) statusCounts[status] = (statusCounts[status] || 0) + 1;
    const study = studyCol ? (r[studyCol] || '').trim() : '';
    if (study) studyCounts[study] = (studyCounts[study] || 0) + 1;
    // Check if Delfa (AI pre-screener) was involved
    if (delfaCol && r[delfaCol]) delfaCount++;
    // Also check notes for Delfa mention
    if (notesCol && (r[notesCol] || '').toLowerCase().includes('delfa')) delfaCount++;
  });

  // Build summary bar
  const topStatuses = Object.entries(statusCounts).sort((a,b) => b[1] - a[1]).slice(0, 6);
  const topStudies = Object.entries(studyCounts).sort((a,b) => b[1] - a[1]).slice(0, 8);

  let html = '';

  // Summary stats row
  html += `<div style="padding:12px 16px;display:flex;gap:16px;flex-wrap:wrap;border-bottom:1px solid #f1f5f9;">`;
  if (topStatuses.length > 0) {
    html += `<div style="flex:1;min-width:280px;">
      <div style="font-size:11px;font-weight:700;color:var(--navy);margin-bottom:8px;">Status Distribution</div>
      ${topStatuses.map(([status, count]) => {
        const pct = Math.round(count / FB_CRM_DATA.length * 100);
        const colors = {'scheduled':'#059669','contacted':'#3b82f6','no answer':'#f59e0b','not interested':'#94a3b8','voicemail':'#d97706','dnq':'#ef4444'};
        const matched = Object.keys(colors).find(k => status.toLowerCase().includes(k));
        const color = matched ? colors[matched] : '#6366f1';
        return `<div style="display:flex;align-items:center;gap:6px;margin-bottom:3px;">
          <div style="width:80px;font-size:11px;color:#475569;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;" title="${status}">${status}</div>
          <div style="flex:1;background:#f1f5f9;border-radius:3px;height:16px;overflow:hidden;">
            <div style="width:${Math.max(pct,3)}%;background:${color};height:100%;border-radius:3px;"></div>
          </div>
          <div style="font-size:10px;font-weight:600;color:#1e293b;min-width:35px;text-align:right;">${count}</div>
        </div>`;
      }).join('')}
    </div>`;
  }
  if (topStudies.length > 0) {
    html += `<div style="flex:1;min-width:280px;">
      <div style="font-size:11px;font-weight:700;color:var(--navy);margin-bottom:8px;">By Campaign / Study</div>
      ${topStudies.map(([study, count]) => {
        const pct = Math.round(count / FB_CRM_DATA.length * 100);
        return `<div style="display:flex;align-items:center;gap:6px;margin-bottom:3px;">
          <div style="width:100px;font-size:11px;color:#475569;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;" title="${study}">${study}</div>
          <div style="flex:1;background:#f1f5f9;border-radius:3px;height:16px;overflow:hidden;">
            <div style="width:${Math.max(pct,3)}%;background:#3b82f6;height:100%;border-radius:3px;"></div>
          </div>
          <div style="font-size:10px;font-weight:600;color:#1e293b;min-width:35px;text-align:right;">${count}</div>
        </div>`;
      }).join('')}
    </div>`;
  }
  if (delfaCount > 0) {
    html += `<div style="min-width:120px;text-align:center;padding:8px;">
      <div style="font-size:11px;font-weight:700;color:var(--navy);margin-bottom:4px;">🤖 Delfa AI</div>
      <div style="font-size:24px;font-weight:800;color:#7C3AED;">${delfaCount}</div>
      <div style="font-size:10px;color:#94a3b8;">AI pre-screened</div>
    </div>`;
  }
  html += `</div>`;

  // Recent 30d count
  const now = Date.now();
  const recent30 = FB_CRM_DATA.filter(r => {
    const d = dateCol ? (r[dateCol] || '') : '';
    if (!d) return false;
    try { return (now - new Date(d).getTime()) < 30 * 86400000; } catch(e) { return false; }
  }).length;
  html += `<div style="padding:10px 16px;font-size:11px;color:#64748b;border-top:1px solid #f1f5f9;">
    <strong>${FB_CRM_DATA.length}</strong> total leads · <strong>${recent30}</strong> in last 30 days
  </div>`;

  el.innerHTML = html;
}


// ── Data Source URLs (Looker → Google Sheets, auto-pushed every 15 min) ──
const LIVE_URL1 = 'https://docs.google.com/spreadsheets/d/e/2PACX-1vSQJ_QKC-ttmVuaYZokhz6NPNsMUpMe262mqAXbLocxOgGqbxHIMschUhE6FERyYwJfARhVg3wppBZS/pub?output=csv';
const LIVE_URL2_LEGACY = 'https://docs.google.com/spreadsheets/d/e/2PACX-1vRUXJxTDsr5IRByMfuLF0P3hVq_QuEw6M1MPNDwd1CaV2UZ9tnFflUwsmUKAd3xeX3_esn0c4YlrV0q/pub?gid=1487298034&single=true&output=csv';
const AUDIT_LOG_URL = 'https://docs.google.com/spreadsheets/d/e/2PACX-1vRpPUZFSyW0rrx2yQdqYPyccRZC0wqUCWyCfX_n2XTMPyKQr9da4jl1jMbZ5_KKFkYZjJiNl_ClYbXk/pub?output=csv';

function loadLongitudinalData() {
  // Longitudinal/trends data loads from Master Sheet
  // This requires the Apps Script to have been running and building history
  const trendsMsg = document.getElementById('trends-no-data-msg');
  if (trendsMsg) {
    trendsMsg.innerHTML = `<div style="text-align:center;padding:40px">
      <div style="font-size:32px;margin-bottom:12px;">📊</div>
      <div style="font-size:15px;font-weight:700;color:var(--navy);margin-bottom:8px;">Connect live data to unlock Trends</div>
      <div style="font-size:12px;color:var(--muted);max-width:440px;margin:0 auto;">
        Trends are populated automatically once the Apps Script consolidator has been running for 2+ weeks.
        Use the <strong>⚙ Connect</strong> tab to link your Master Google Sheet.
      </div>
      <button onclick="switchTab('admin',null)" class="btn btn-blue" style="margin-top:16px;">Go to Connect tab →</button>
    </div>`;
  }
}


// Alias for backward compatibility
function buildWeeklyTrendChart() { 
  try { buildCancelTrend(); } catch(e) {} 
  try { buildUpcomingTrend(); } catch(e) {} 
}


// ══════════════════════════════════════════════════════════════
// ENROLLMENT TAB
// ══════════════════════════════════════════════════════════════
let _enrollFilter = 'all';

function filterEnroll(type, btn) {
  _enrollFilter = type;
  document.querySelectorAll('#enroll-filter-bar .sched-filter').forEach(b => {
    b.style.background = 'var(--surface)';
    b.style.color = 'var(--muted)';
    b.style.borderColor = 'var(--border)';
  });
  btn.style.background = '#e8eeff';
  btn.style.color = '#1843ad';
  btn.style.borderColor = '#1843ad';
  renderEnrollCards();
}

function renderEnrollCards() {
  const studies = DATA.enrollmentData || [];
  const el = document.getElementById('enroll-cards-grid');
  if (!el) return;

  const filtered = studies.filter(s => {
    if (_enrollFilter === 'all') return true;
    if (_enrollFilter === 'enrolling') return s.status === 'Enrolling' && s.target;
    if (_enrollFilter === 'on_track') return s.pct !== null && s.pct >= 50 && s.pct < 100;
    if (_enrollFilter === 'behind') return s.status === 'Enrolling' && s.target && s.pct !== null && s.pct < 50;
    if (_enrollFilter === 'maintenance') return s.status === 'Maintenance';
    return true;
  });

  el.innerHTML = filtered.map(s => {
    const hasTarget = s.target !== null && s.target !== undefined;
    const pct = hasTarget ? (s.pct || 0) : null;
    const barColor = !hasTarget ? '#94a3b8' :
      s.pct >= 100 ? '#059669' : s.pct >= 75 ? '#1843ad' : s.pct >= 50 ? '#d97706' : s.pct >= 25 ? '#f97316' : '#dc2626';
    const statusColor = s.status === 'Enrolling' ? '#1843ad' : s.status === 'Maintenance' ? '#059669' : '#94a3b8';
    const statusBg = s.status === 'Enrolling' ? '#e8eeff' : s.status === 'Maintenance' ? '#f0fdf4' : '#f1f5f9';
    const siteTag = (s.sites||[]).map(st =>
      `<span style="font-size:9px;font-weight:700;padding:1px 5px;border-radius:3px;background:${st==='PNJ'?'#05996920':'#07206120'};color:${st==='PNJ'?'#059669':'#072061'}">${st}</span>`
    ).join(' ');

    const studyLink = s.study_url
      ? `<a href="${s.study_url}" target="_blank" rel="noopener" onclick="event.stopPropagation()" style="text-decoration:none;color:var(--navy);font-weight:700;font-size:13px">${s.study}<svg xmlns="http://www.w3.org/2000/svg" width="9" height="9" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="margin-left:3px;opacity:0.4;vertical-align:middle"><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/><polyline points="15 3 21 3 21 9"/><line x1="10" y1="14" x2="21" y2="3"/></svg></a>`
      : `<span style="font-weight:700;font-size:13px;color:var(--navy)">${s.study}</span>`;

    // Progress bar section
    const progressSection = hasTarget ? `
      <div style="margin:10px 0 4px;">
        <div style="display:flex;justify-content:space-between;align-items:baseline;margin-bottom:4px;">
          <span style="font-size:11px;color:var(--muted)">Enrollment Goal</span>
          <span style="font-size:13px;font-weight:700;color:${barColor}">${s.enrolled} <span style="font-size:11px;color:var(--muted);font-weight:400">/ ${s.target}</span> <span style="font-size:11px;font-weight:700;color:${barColor}">(${pct}%)</span></span>
        </div>
        <div style="height:10px;background:var(--border);border-radius:6px;overflow:hidden;">
          <div style="height:100%;background:${barColor};border-radius:6px;width:${Math.min(pct,100)}%;transition:width .5s ease;"></div>
        </div>
        <div style="margin-top:4px;font-size:10px;color:${pct>=100?'#059669':'#f97316'};font-weight:600;">
          ${pct >= 100 ? `✓ Goal reached${s.over>0?' · '+s.over+' over target':''}` : `${s.remaining} more needed`}
        </div>
      </div>` : `
      <div style="margin:10px 0 4px;">
        <div style="display:flex;justify-content:space-between;align-items:baseline;margin-bottom:4px;">
          <span style="font-size:11px;color:var(--muted)">Enrolled to Date</span>
          <span style="font-size:13px;font-weight:700;color:var(--navy)">${s.enrolled} <span style="font-size:11px;color:var(--muted);font-weight:400">no target set</span></span>
        </div>
      </div>`;

    // Stats grid
    const stat = (label, val, color='var(--text)') =>
      `<div style="text-align:center;padding:6px 4px;background:var(--surface2);border-radius:6px;">
        <div style="font-size:14px;font-weight:700;color:${color}">${val}</div>
        <div style="font-size:9px;color:var(--muted);margin-top:1px;white-space:nowrap">${label}</div>
      </div>`;

    const statsGrid = `<div style="display:grid;grid-template-columns:repeat(5,1fr);gap:4px;margin-top:8px;">
      ${stat('Screened', s.screened || 0, '#1843ad')}
      ${stat('In Screen', s.screening || 0, '#7c3aed')}
      ${stat('Enrolled', s.enrolled || 0, '#059669')}
      ${stat('Screen Fail', s.screen_fail || 0, s.screen_fail > 10 ? '#dc2626' : 'var(--text)')}
      ${stat('SF Rate', s.screen_fail_pct ? s.screen_fail_pct+'%' : '0%', s.screen_fail_pct > 50 ? '#dc2626' : s.screen_fail_pct > 30 ? '#d97706' : 'var(--text)')}
    </div>
    <div style="display:grid;grid-template-columns:repeat(3,1fr);gap:4px;margin-top:4px;">
      ${stat('Active', s.active || 0, '#059669')}
      ${stat('Completed', s.completed || 0, '#64748b')}
      ${stat('Discontinued', s.discontinued || 0, s.discontinued > 0 ? '#d97706' : 'var(--text)')}
    </div>`;

    return `<div style="background:var(--surface);border:1px solid var(--border);border-radius:10px;padding:14px;border-top:3px solid ${barColor};">
      <div style="display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:4px;">
        <div style="flex:1;min-width:0;">${studyLink}</div>
        <span style="font-size:10px;font-weight:700;padding:2px 7px;border-radius:4px;background:${statusBg};color:${statusColor};margin-left:6px;white-space:nowrap">${s.status}</span>
      </div>
      <div style="display:flex;gap:4px;align-items:center;margin-bottom:2px;">${siteTag}</div>
      ${progressSection}
      ${statsGrid}
    </div>`;
  }).join('');

  if (filtered.length === 0) {
    el.innerHTML = '<div style="color:var(--muted);padding:20px;text-align:center;grid-column:1/-1">No studies match this filter</div>';
  }
}

function buildEnrollmentView() {
  const d = DATA.enrollSummary || {};
  const pct = d.overallPct || 0;
  const completePct = d.totalTarget ? Math.round(d.complete / d.studies * 100) : 0;

  safe(() => {
    document.getElementById('enroll-kpi-enrolled').textContent = d.totalEnrolled ?? '—';
    document.getElementById('enroll-kpi-target').textContent = `of ${d.totalTarget} goal`;
    document.getElementById('enroll-kpi-pct').textContent = (d.overallPct ?? '—') + '%';
    document.getElementById('enroll-kpi-remaining').textContent = d.totalRemaining ?? '—';
    document.getElementById('enroll-kpi-screening').textContent = d.totalScreening ?? '—';
    document.getElementById('enroll-kpi-complete').innerHTML = `${d.complete ?? '—'} <span style="font-size:14px;font-weight:400;color:var(--muted)">of</span> ${d.studies ?? '—'}`;
    document.getElementById('enroll-overall-bar').style.width = pct + '%';
    document.getElementById('enroll-overall-bar-complete').style.width = (d.totalTarget ? Math.round(d.totalEnrolled/d.totalTarget*100) : 0) + '%';
    document.getElementById('enroll-overall-label').textContent = `${d.totalEnrolled} enrolled · ${d.totalRemaining} remaining · ${d.totalScreening} in screening`;
    document.getElementById('enroll-overall-target').textContent = `Portfolio target: ${d.totalTarget}`;
    document.getElementById('enroll-overall-badge').textContent = `${pct}% complete · ${d.complete} of ${d.studies} goals reached`;
  }, 'enroll-kpis');

  renderEnrollCards();
}



// ══════════════════════════════════════════════════════════════
// MERGED STUDIES TABLE
// ══════════════════════════════════════════════════════════════
let _studyFilter = 'all';
let _studySortCol = -1, _studySortAsc = false;

function filterStudies(type, btn) {
  _studyFilter = type;
  document.querySelectorAll('#studies-filter-bar .sched-filter').forEach(b => {
    b.style.background = 'var(--surface)'; b.style.color = 'var(--muted)'; b.style.borderColor = 'var(--border)';
  });
  btn.style.background = '#e8eeff'; btn.style.color = '#1843ad'; btn.style.borderColor = '#1843ad';
  renderStudiesTable();
}

function sortMergedTable(th, col) {
  if (_studySortCol === col) _studySortAsc = !_studySortAsc;
  else { _studySortCol = col; _studySortAsc = col === 0; }
  renderStudiesTable();
}

// ══════════════════════════════════════════════════════════════
// CROSS-SOURCE ENRICHMENT UTILITIES
// ══════════════════════════════════════════════════════════════
function matchesStudy(a, b) {
  var n1 = (a || '').toLowerCase().trim();
  var n2 = (b || '').toLowerCase().trim();
  if (!n1 || !n2) return false;
  return n1 === n2 || n1.includes(n2) || n2.includes(n1);
}

function getStudyMedRecords(studyName) {
  if (!MED_RECORDS_DATA || MED_RECORDS_DATA.length === 0) return null;
  var patients = MED_RECORDS_DATA.filter(function(r) { return matchesStudy(r.study, studyName); });
  if (patients.length === 0) return null;
  return {
    total: patients.length,
    active: patients.filter(function(r){ return r.is_active; }).length,
    enrolled: patients.filter(function(r){ return r.status === 'Enrolled' || r.status === 'Complete'; }).length,
    screening: patients.filter(function(r){ return r.status === 'In Screening'; }).length,
    readySched: patients.filter(function(r){ return r.status === 'Ready to Schedule'; }).length,
    visitSched: patients.filter(function(r){ return r.status === 'Visit Scheduled'; }).length,
    pendingRecords: patients.filter(function(r){ return r.status === 'Pending Release' || r.status === 'Under Review'; }).length,
    dnq: patients.filter(function(r){ return r.status === 'DNQ' || r.status === 'Screen Fail'; }).length,
    noRecords: patients.filter(function(r){ return r.records_received === 'No' || !r.records_received; }).length,
    patients: patients,
  };
}

function getStudyFBLeads(studyName) {
  if (!FB_CRM_DATA || FB_CRM_DATA.length === 0) return { count: 0, recent: 0 };
  var sn = (studyName || '').toLowerCase().trim();
  // Use FB_CAMPAIGN_MAP to match campaign names to studies.
  // For each lead, find the longest (most specific) matching keyword.
  // The lead belongs to whichever study that keyword maps to.
  var campaignMap = (CRP_CONFIG.CLICKUP || {}).FB_CAMPAIGN_MAP || {};
  // Pre-sort all keywords longest-first for best-match priority
  var allKeywords = Object.keys(campaignMap).map(function(k) { return k.toLowerCase(); });
  allKeywords.sort(function(a, b) { return b.length - a.length; });
  var leads = FB_CRM_DATA.filter(function(f) {
    var campaign = (f['Study Campaign'] || f['Campaign'] || f['campaign'] || '').toLowerCase().trim();
    if (!campaign) return false;
    // Direct match (original fuzzy logic — protocol ID in campaign name)
    if (campaign.includes(sn) || sn.includes(campaign)) return true;
    // Campaign map: find longest matching keyword, check if it maps to this study
    for (var i = 0; i < allKeywords.length; i++) {
      if (campaign.includes(allKeywords[i])) {
        // This is the best (most specific) match — does it map to our study?
        var mapped = campaignMap[allKeywords[i]] || [];
        return mapped.some(function(s) { return s.toLowerCase() === sn; });
      }
    }
    return false;
  });
  var now = Date.now();
  var recent = leads.filter(function(f) {
    var d = f['Date Created'] || '';
    if (!d) return false;
    try { return (now - new Date(d).getTime()) < 30 * 86400000; } catch(e) { return false; }
  }).length;
  return { count: leads.length, recent: recent, leads: leads };
}

// Cross-source: find referrals with no medical records entry
function findReferralsWithoutMedRecords() {
  if (!REFERRAL_DATA || REFERRAL_DATA.length === 0 || !MED_RECORDS_DATA || MED_RECORDS_DATA.length === 0) return [];
  var medNames = {};
  MED_RECORDS_DATA.forEach(function(m) { medNames[(m.name||'').toLowerCase().trim()] = true; });
  return REFERRAL_DATA.filter(function(r) {
    if (r.is_closed) return false;
    var key = (r.name||'').toLowerCase().trim();
    return !medNames[key];
  });
}

// Cross-source: find med records ready to schedule with no upcoming visit
function findReadyNoVisit() {
  if (!MED_RECORDS_DATA || MED_RECORDS_DATA.length === 0) return [];
  var visitPatients = {};
  (DATA.allVisitDetail || []).forEach(function(v) { visitPatients[(v.patient||'').toLowerCase().trim()] = true; });
  return MED_RECORDS_DATA.filter(function(r) {
    if (r.status !== 'Ready to Schedule') return false;
    return !visitPatients[(r.name||'').toLowerCase().trim()];
  });
}

function buildPipelineCell(studyName, safeStudy) {
  const refData = getStudyReferralPipeline(studyName);
  if (!refData || refData.total === 0) return '<span style="font-size:10px;color:#cbd5e1;">\u2014</span>';
  const activeColor = refData.active > 5 ? '#059669' : refData.active > 0 ? '#3b82f6' : '#94a3b8';
  return '<div style="cursor:pointer;text-align:center;" onclick="showStudyPipelineModal(\''+safeStudy+'\')">' +
    '<div style="font-size:12px;font-weight:700;color:'+activeColor+';">'+refData.active+'</div>' +
    '<div style="font-size:9px;color:#94a3b8;">'+refData.total+' total</div>' +
    '</div>';
}

function buildMedRecCell(studyName, safeStudy) {
  return '';
}

function buildFBLeadCell(studyName) {
  var d = getStudyFBLeads(studyName);
  if (d.count === 0) return '<span style="font-size:10px;color:#cbd5e1;">\u2014</span>';
  var color = d.recent > 0 ? '#3b82f6' : '#94a3b8';
  return '<div style="text-align:center;">' +
    '<div style="font-size:11px;font-weight:700;color:' + color + ';">' + d.count + '</div>' +
    (d.recent > 0 ? '<div style="font-size:9px;color:#3b82f6;">' + d.recent + ' new</div>' : '') +
    '</div>';
}

function buildTotalLeadsCell(studyName, safeStudy) {
  var refData = getStudyReferralPipeline(studyName);
  var fbData = getStudyFBLeads(studyName);
  var refCount = refData ? refData.total : 0;
  var fbCount = fbData ? fbData.count : 0;
  var total = refCount + fbCount;
  if (total === 0) return '<span style="font-size:10px;color:#cbd5e1;">\u2014</span>';
  var color = total > 5 ? '#059669' : total > 0 ? '#3b82f6' : '#94a3b8';
  return '<div style="text-align:center;">' +
    '<div style="font-size:12px;font-weight:700;color:' + color + ';">' + total + '</div>' +
    '<div style="font-size:9px;color:#94a3b8;">' + refCount + ' ref + ' + fbCount + ' FB</div>' +
    '</div>';
}

function renderStudiesTable() {
  const studies = (DATA.mergedStudies || []).filter(s => {
    if (_studyFilter === 'all') return true;
    if (_studyFilter === 'critical') return s.risk_level === 'critical';
    if (_studyFilter === 'high') return s.risk_level === 'high';
    if (_studyFilter === 'enrolling') return s.enroll_status === 'Enrolling';
    if (_studyFilter === 'goal_met') return s.pct !== null && s.pct >= 100;
    if (_studyFilter === 'behind') return s.enroll_status === 'Enrolling' && s.target && s.pct !== null && s.pct < 50;
    return true;
  });

  // Sort
  if (_studySortCol >= 0) {
    const keys = ['study','risk_score','cancels','upcoming','pct','screened','screening','screen_fail_pct'];
    const key = keys[_studySortCol] || 'risk_score';
    studies.sort((a,b) => {
      const va = a[key] ?? (_studySortAsc ? 'zzz' : -999);
      const vb = b[key] ?? (_studySortAsc ? 'zzz' : -999);
      return _studySortAsc ? (va > vb ? 1 : -1) : (va < vb ? 1 : -1);
    });
  }

  const badge = document.getElementById('studies-count-badge');
  if (badge) badge.textContent = studies.length + ' studies';

  const tbody = document.getElementById('merged-study-tbody');
  if (!tbody) return;

  const LEVEL_COLOR = {critical:'#dc2626',high:'#d97706',medium:'#2563eb',low:'#059669','n/a':'#94a3b8',''  :'#94a3b8'};
  const LEVEL_BG    = {critical:'#fef2f2',high:'#fffbeb',medium:'#eff6ff',low:'#f0fdf4','n/a':'#f8fafc',''  :'#f8fafc'};

  tbody.innerHTML = studies.map(s => {
    const lc = LEVEL_COLOR[s.risk_level] || '#94a3b8';
    const lb = LEVEL_BG[s.risk_level] || '#f8fafc';
    const hasTarget = s.target !== null && s.target !== undefined;
    const pct = hasTarget ? (s.pct || 0) : null;
    const barColor = !hasTarget ? '#94a3b8' :
      pct >= 100 ? '#059669' : pct >= 75 ? '#1843ad' : pct >= 50 ? '#d97706' : pct >= 25 ? '#f97316' : '#dc2626';

    const safeStudy = s.study.replace(/'/g,"\\'");
    const studyCell = `<span style="font-weight:700;color:var(--navy);cursor:pointer;text-decoration:underline;text-decoration-style:dotted;text-underline-offset:3px;" onclick="showStudyUnifiedModal('${safeStudy}')">${s.study}</span>` +
      (s.study_url ? `<a href="${s.study_url}" target="_blank" rel="noopener" onclick="event.stopPropagation()" style="margin-left:4px;opacity:0.4;vertical-align:middle"><svg xmlns="http://www.w3.org/2000/svg" width="9" height="9" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/><polyline points="15 3 21 3 21 9"/><line x1="10" y1="14" x2="21" y2="3"/></svg></a>` : '');
    const statusBadge = s.enroll_status
      ? `<span style="font-size:9px;font-weight:700;padding:1px 5px;border-radius:3px;margin-left:5px;background:${s.enroll_status==='Enrolling'?'#e8eeff':s.enroll_status==='Maintenance'?'#f0fdf4':'#f1f5f9'};color:${s.enroll_status==='Enrolling'?'#1843ad':s.enroll_status==='Maintenance'?'#059669':'#94a3b8'}">${s.enroll_status}</span>` : '';

    const enrollCell = hasTarget
      ? `<div style="min-width:140px">
          <div style="display:flex;justify-content:space-between;align-items:baseline;margin-bottom:3px">
            <span style="font-size:11px;font-weight:700;color:${barColor}">${s.enrolled}<span style="color:var(--muted);font-weight:400">/${s.target}</span></span>
            <span style="font-size:11px;font-weight:700;color:${barColor}">${pct}%</span>
          </div>
          <div style="height:6px;background:var(--border);border-radius:3px;overflow:hidden">
            <div style="height:100%;background:${barColor};width:${Math.min(pct,100)}%;border-radius:3px"></div>
          </div>
          <div style="font-size:9px;color:${pct>=100?'#059669':'#94a3b8'};margin-top:2px">${pct>=100?'✓ Goal reached':`${s.remaining} needed`}</div>
        </div>`
      : `<span style="font-size:11px;color:var(--muted)">${s.enrolled > 0 ? s.enrolled+' enrolled' : '—'}</span>`;

    const siteTags = (s.sites||[]).map(st =>
      `<span style="font-size:9px;font-weight:700;padding:1px 4px;border-radius:3px;background:${st==='PNJ'?'#05996920':'#07206120'};color:${st==='PNJ'?'#059669':'#072061'}">${st}</span>`
    ).join(' ');

    const riskScoreCell = (s.risk_level === 'n/a' || s.enroll_status !== 'Enrolling')
      ? `<span style="font-size:10px;color:#94a3b8;font-style:italic">N/A</span>`
      : s.risk_score > 0
        ? `<span style="font-size:11px;font-weight:700;padding:3px 7px;border-radius:5px;background:${lb};color:${lc};cursor:pointer" onclick="showStudyDetail('${safeStudy}')">${s.risk_score}</span>`
        : `<span style="font-size:11px;color:var(--muted)">—</span>`;

    const isEnrolling = s.enroll_status === 'Enrolling';
    const cancelsCell = s.cancels > 0
      ? `<div style="display:flex;flex-direction:column;gap:2px">
           <span style="font-size:12px;font-weight:700;color:#dc2626;cursor:pointer" onclick="showStudyDetail('${safeStudy}')">${s.cancels}</span>
           ${!isEnrolling ? `<span style="font-size:9px;color:#94a3b8;font-style:italic">${s.enroll_status} — not actively enrolling</span>` : ''}
         </div>`
      : `<span style="font-size:11px;color:var(--muted)">0</span>`;

    const upcomingCell = s.upcoming > 0
      ? `<span style="font-size:12px;font-weight:700;color:#1843ad;cursor:pointer" onclick="showUpcoming(r=>r.study==='${safeStudy}','${safeStudy} — Upcoming Visits')">${s.upcoming}</span>`
      : `<span style="font-size:11px;color:var(--muted)">0</span>`;

    const sfColor = s.screen_fail_pct > 60 ? '#dc2626' : s.screen_fail_pct > 40 ? '#d97706' : 'var(--muted)';

    return `<tr style="border-bottom:1px solid var(--border);transition:background .1s" onmouseover="this.style.background='var(--surface2)'" onmouseout="this.style.background=''">
      <td style="padding:10px 12px;min-width:160px">${studyCell}${statusBadge}</td>
      <td style="padding:10px 8px;text-align:center">${riskScoreCell}</td>
      <td style="padding:10px 8px;text-align:center">${cancelsCell}</td>
      <td style="padding:10px 8px;text-align:center">${upcomingCell}</td>
      <td style="padding:10px 8px;min-width:160px">${enrollCell}</td>
      <td style="padding:10px 8px;text-align:center;font-size:11px;color:var(--muted)">${s.screened||0}</td>
      <td style="padding:10px 8px;text-align:center;font-size:11px;color:${s.screening>0?'#7c3aed':'var(--muted)'};font-weight:${s.screening>0?'700':'400'}">${s.screening||0}</td>
      <td style="padding:10px 8px;text-align:center;font-size:11px;color:${sfColor};font-weight:600">${s.screen_fail_pct > 0 ? s.screen_fail_pct+'%' : '—'}</td>
      <td style="padding:10px 8px;text-align:center">${siteTags}</td>
      <td style="padding:10px 8px;text-align:center">${buildPipelineCell(s.study, safeStudy)}</td>
      <td style="padding:10px 8px;text-align:center">${buildFBLeadCell(s.study)}</td>
      <td style="padding:10px 8px;text-align:center">${buildTotalLeadsCell(s.study, safeStudy)}</td>
    </tr>`;
  }).join('');
}

function buildStudiesView() {
  renderStudiesTable();
}

// ══════════════════════════════════════════════════════════════
// ADMIN TAB SUB-NAVIGATION
// ══════════════════════════════════════════════════════════════
function switchAdmin(section, btn) {
  ['trends','connect'].forEach(s => {
    const el = document.getElementById('admin-'+s);
    if (el) el.style.display = s === section ? '' : 'none';
  });
  document.querySelectorAll('#admin-filter-bar .sched-filter').forEach(b => {
    b.style.background = 'var(--surface)'; b.style.color = 'var(--muted)'; b.style.borderColor = 'var(--border)';
  });
  if (btn) { btn.style.background = '#e8eeff'; btn.style.color = '#1843ad'; btn.style.borderColor = '#1843ad'; }
  if (section === 'trends' && typeof renderTrendsCharts === 'function') {
    try { renderTrendsCharts(); } catch(e) {}
  }
}

function _crpInit() {
  renderAll();
  // Set schedule KPIs immediately
  const d = SAMPLE;
  const skpi = (id, val) => { const e = document.getElementById(id); if(e && val) e.textContent = val; };
  skpi('sched-kpi-philly', d.phillyTotal);
  skpi('sched-kpi-penn',   d.pennTotal);
  skpi('sched-kpi-march',  d.marchTotal);
  skpi('sched-kpi-april',  d.aprilTotal);
  skpi('sched-kpi-total',  d.upcomingTotal);
  skpi('sched-count',      (d.next14Detail||[]).length + ' visits');
  if (typeof switchView === 'function') switchView('overview');
  CRP.emit('init', { version: CRP_CONFIG.VERSION, timestamp: new Date() });
  console.log(`CRP Dashboard v${CRP_CONFIG.VERSION} initialized`);

  // ═══ STAGGERED DATA LOADING ═══
  // Google Sheets rate-limits when 12+ CSV requests fire simultaneously.
  // Phase 1: Critical CRIO data (upcoming + cancels + audit) — loads first, renders immediately
  // Phase 2: Finance data — loads after Phase 1 completes (or after 2s timeout)
  // Phase 3: Supplemental data (Patient DB, Facebook CRM) — loads last, non-blocking
  // ═══ DATA HEALTH MONITORING ═══
  function setHealthChip(id, status, label) {
    const el = document.getElementById(id);
    if (!el) return;
    el.className = 'dh-chip ' + status;
    const icon = status === 'ok' ? '✓' : status === 'warn' ? '⚠' : status === 'fail' ? '✗' : '⏳';
    el.textContent = icon + ' ' + label;
  }

  function showHealthStrip() {
    const strip = document.getElementById('data-health-strip');
    if (strip) strip.style.display = 'flex';
  }

  function checkDataFreshness(rows) {
    // Check snapshot_date from CRIO data to detect stale Looker exports
    const freshEl = document.getElementById('dh-freshness');
    if (!freshEl || !rows || rows.length === 0) return;
    const snapDates = rows.map(r => (r['snapshot_date'] || r['Scheduled Date'] || '').trim()).filter(Boolean).sort();
    if (snapDates.length === 0) return;
    // Find the most recent snapshot_date
    const latestSnap = snapDates[snapDates.length - 1];
    const today = new Date(); today.setHours(0,0,0,0);
    const snapDate = new Date(latestSnap); snapDate.setHours(0,0,0,0);
    const ageMs = today - snapDate;
    const ageDays = Math.floor(ageMs / 86400000);
    if (ageDays <= 0) {
      freshEl.textContent = 'Data from today';
      freshEl.style.color = '#065F46';
    } else if (ageDays === 1) {
      freshEl.textContent = 'Data from yesterday';
      freshEl.style.color = '#92400E';
    } else if (ageDays <= 3) {
      freshEl.textContent = 'Data is ' + ageDays + ' days old';
      freshEl.style.color = '#92400E';
    } else {
      freshEl.textContent = '⚠ Data is ' + ageDays + ' days old — Looker may have stopped pushing';
      freshEl.style.color = '#991B1B';
    }
  }

  async function loadAllData() {
    const badge = document.getElementById('last-refresh-badge');
    const srcBadge = document.getElementById('data-source-badge');
    showHealthStrip();

    // Fire-and-forget: load coordinator history baseline (fast, non-blocking)
    fetchCoordHistory();

    // ── Phase 1: CRIO data (most critical — drives Overview, Studies, Schedule, Actions) ──
    console.log('CRP: Phase 1 — loading CRIO data...');
    let crioOk = false;
    let _lastCrioRows = [];
    let _lastAuditRows = [];
    try {
      const [rows1, legacyCancels, auditRows] = await Promise.all([
        fetchCSV(LIVE_URL1),
        fetchCSV(LIVE_URL2_LEGACY).catch(() => []),
        fetchCSV(AUDIT_LOG_URL).catch(e => { console.warn('CRP: Audit log fetch failed, continuing without:', e.message); setHealthChip('dh-audit','fail','Audit Log'); return []; })
      ]);
      _lastCrioRows = rows1;
      _lastAuditRows = auditRows;
      const newData = processLiveData(rows1, legacyCancels, auditRows);
      if ((newData.upcomingTotal || 0) < 5 && rows1.length > 10) {
        console.warn('CRP: processLiveData returned suspiciously low upcomingTotal (' + (newData.upcomingTotal||0) + ') from ' + rows1.length + ' rows — skipping');
        setHealthChip('dh-crio','warn','CRIO (' + rows1.length + ' rows, low upcoming)');
      } else {
        DATA = newData;
        if (srcBadge) srcBadge.textContent = '🔗 Live Google Sheets';
        if (badge) { badge.textContent = 'Updated: ' + new Date().toLocaleDateString('en-US', {month:'short',day:'numeric',year:'numeric'}); badge.style.color = ''; }
        renderAll();
        console.log('CRP: Phase 1 complete — upcoming:', rows1.length, 'audit:', auditRows.length);
        crioOk = true;
        setHealthChip('dh-crio','ok','CRIO (' + rows1.length + ')');
        setHealthChip('dh-audit', auditRows.length > 0 ? 'ok' : 'warn', 'Audit Log (' + auditRows.length + ')');
        checkDataFreshness(rows1);
      }
    } catch(e) {
      console.warn('CRP: Phase 1 failed:', e.message, '— retrying in 5s...');
      setHealthChip('dh-crio','warn','CRIO (retrying...)');
      if (badge) { badge.textContent = '⚠️ Fetch failed — retrying...'; badge.style.color = '#dc2626'; }
      await new Promise(r => setTimeout(r, 5000));
      try {
        const [rows1b, legacyB, auditB] = await Promise.all([
          fetchCSV(LIVE_URL1),
          fetchCSV(LIVE_URL2_LEGACY).catch(() => []),
          fetchCSV(AUDIT_LOG_URL).catch(() => [])
        ]);
        _lastCrioRows = rows1b;
        _lastAuditRows = auditB;
        const retryData = processLiveData(rows1b, legacyB, auditB);
        if ((retryData.upcomingTotal || 0) >= 5) {
          DATA = retryData;
          if (srcBadge) srcBadge.textContent = '🔗 Live Google Sheets';
          if (badge) { badge.textContent = 'Updated: ' + new Date().toLocaleDateString('en-US', {month:'short',day:'numeric',year:'numeric'}); badge.style.color = ''; }
          renderAll();
          console.log('CRP: Phase 1 retry succeeded — upcoming:', rows1b.length);
          crioOk = true;
          setHealthChip('dh-crio','ok','CRIO (' + rows1b.length + ')');
          setHealthChip('dh-audit', auditB.length > 0 ? 'ok' : 'warn', 'Audit Log (' + auditB.length + ')');
          checkDataFreshness(rows1b);
        } else {
          console.warn('CRP: Phase 1 retry also returned low data — staying on SAMPLE');
          if (badge) badge.textContent = '⚠️ Live data unavailable';
          setHealthChip('dh-crio','fail','CRIO (failed)');
          setHealthChip('dh-audit','fail','Audit Log');
        }
      } catch(e2) {
        console.warn('CRP: Phase 1 retry failed:', e2.message);
        if (badge) badge.textContent = '⚠️ Live data unavailable — click Refresh';
        setHealthChip('dh-crio','fail','CRIO (failed)');
        setHealthChip('dh-audit','fail','Audit Log');
      }
    }

    // ── Phase 2: Finance data (staggered — waits for Phase 1 to finish) ──
    console.log('CRP: Phase 2 — loading finance data...');
    try {
      const ok = await fetchFinanceLive();
      if (ok) {
        console.log('CRP Finance: Live data applied — re-rendering finance views');
        setHealthChip('dh-finance','ok','Finance');
        if (typeof renderForecast === 'function') try { renderForecast(); } catch(e) {}
        if (typeof drawPayChartOverview === 'function') try { drawPayChartOverview(); } catch(e) {}
        if (typeof drawRevChart === 'function') try { drawRevChart(); } catch(e) {}
        if (typeof drawAgingChart === 'function') try { drawAgingChart(); } catch(e) {}
        if (typeof renderAccruals === 'function') try { renderAccruals(); } catch(e) {}
        if (typeof renderStudiesTable === 'function') try { renderStudiesTable(); } catch(e) {}
      } else {
        setHealthChip('dh-finance','warn','Finance (no data)');
      }
    } catch(e) {
      console.warn('CRP Finance fetch failed:', e);
      setHealthChip('dh-finance','fail','Finance (failed)');
    }

    // ── Phase 3: Supplemental data (Patient DB + Facebook CRM — lowest priority) ──
    console.log('CRP: Phase 3 — loading supplemental data...');
    fetchPatientDB().then(ok => {
      if (ok) {
        console.log('CRP: Patient DB cross-reference complete');
        setHealthChip('dh-patientdb','ok','Patient DB');
        // Re-render views that depend on Patient DB
        if (typeof renderStudiesTable === 'function') try { renderStudiesTable(); } catch(e) {}
      }
      else setHealthChip('dh-patientdb','warn','Patient DB (empty)');
    }).catch(e => { console.warn('CRP: Patient DB fetch failed:', e); setHealthChip('dh-patientdb','fail','Patient DB (failed)'); });

    setTimeout(() => {
      fetchFacebookCRM().then(() => {
        setHealthChip('dh-fbcrm','ok','FB CRM (' + (FB_CRM_DATA||[]).length + ')');
        // Re-render views that depend on FB CRM data
        safe(buildRecruitmentKPIs, 'buildRecruitmentKPIs');
        if (typeof renderStudiesTable === 'function') try { renderStudiesTable(); } catch(e) {}
      }).catch(e => { console.warn('CRP: Facebook CRM initial load failed:', e); setHealthChip('dh-fbcrm','fail','FB CRM (failed)'); });
    }, 1500);

    // ── Phase 4: ClickUp Referral data (if token exists) — populates Overview KPIs ──
    var _cuToken = typeof getClickUpToken === 'function' ? getClickUpToken() : '';
    if (_cuToken && !_referralsLoaded) {
      setTimeout(() => {
        console.log('CRP: Phase 4 — auto-loading ClickUp referrals (token detected)...');
        try { initReferrals(); } catch(e) { console.warn('CRP: Auto-init referrals failed:', e); }
      }, 3000);
    }
  }

  // Kick off staggered loading
  loadAllData();

  // Apply PHI masking to pre-rendered static tables on page load
  if (PHI_MASKED && typeof maskStaticPHI === 'function') {
    setTimeout(() => { try { maskStaticPHI(); } catch(e) {} }, 100);
  }

  // Self-heal: if insights are still empty after render, retry once
  setTimeout(() => {
    const flagEl = document.getElementById('perf-insight-flags');
    const posEl  = document.getElementById('perf-insight-positive');
    if (flagEl && !flagEl.innerHTML.trim()) {
      console.warn('perf-insight-flags empty after render — retrying buildInsights');
      try { buildInsights(); } catch(e) { console.error('buildInsights retry failed:', e); }
    }
    if (posEl && !posEl.innerHTML.trim()) {
      try { buildInsights(); } catch(e) {}
    }
    const stepsEl = document.getElementById('action-steps');
    if (stepsEl && !stepsEl.innerHTML.trim()) {
      console.warn('action-steps empty — retrying buildActionSteps');
      try { buildActionSteps(); } catch(e) { console.error('buildActionSteps retry failed:', e); }
    }
  }, 300);

  // ══════════ AUTO-REFRESH TIMER ══════════
  const AUTO_REFRESH_MS = CRP_CONFIG.REFRESH_INTERVAL || 0;
  let _autoRefreshId = null;
  let _lastRefreshTime = Date.now();

  async function autoRefreshAll() {
    const badge = document.getElementById('last-refresh-badge');
    const now = new Date();
    console.log(`CRP Auto-Refresh: triggered at ${now.toLocaleTimeString()}`);

    // Phase 1: CRIO data (critical)
    try {
      const [rows1, legacyCancels, auditRows] = await Promise.all([
        fetchCSV(LIVE_URL1),
        fetchCSV(LIVE_URL2_LEGACY).catch(() => []),
        fetchCSV(AUDIT_LOG_URL).catch(() => [])
      ]);
      const newData = processLiveData(rows1, legacyCancels, auditRows);
      if ((newData.upcomingTotal || 0) < 5 && (DATA.upcomingTotal || 0) > 5) {
        console.warn('CRP Auto-Refresh: new data looks empty (' + (newData.upcomingTotal||0) + ' upcoming) — keeping previous data');
      } else {
        DATA = newData;
        renderAll();
        console.log('CRP Auto-Refresh: CRIO refreshed — upcoming:', rows1.length, 'audit:', auditRows.length);
      }
    } catch(e) { console.warn('CRP Auto-Refresh: CRIO refresh failed:', e.message); }

    // Phase 2: Finance (staggered after CRIO)
    try {
      const ok = await fetchFinanceLive();
      if (ok) {
        if (typeof renderForecast === 'function') try { renderForecast(); } catch(e) {}
        if (typeof drawPayChartOverview === 'function') try { drawPayChartOverview(); } catch(e) {}
      }
    } catch(e) { /* silent */ }

    // Phase 3: Supplemental (staggered after finance)
    fetchPatientDB().catch(() => {});
    setTimeout(() => {
      if (getClickUpToken() && _referralsLoaded) refreshReferrals().catch(() => {});
      fetchFacebookCRM().catch(() => {});
    }, 2000);

    if (badge) badge.textContent = `Auto-updated: ${now.toLocaleTimeString()}`;
    _lastRefreshTime = Date.now();
  }

  // Start auto-refresh cycle (only if REFRESH_INTERVAL > 0)
  if (AUTO_REFRESH_MS > 0) {
    _autoRefreshId = setInterval(autoRefreshAll, AUTO_REFRESH_MS);
    console.log(`CRP: Auto-refresh enabled — every ${AUTO_REFRESH_MS / 60000} minutes`);
  } else {
    console.log('CRP: Auto-refresh disabled (REFRESH_INTERVAL is 0)');
  }

  // Also refresh when tab becomes visible again (user returns to browser)
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden) {
      const FIVE_MINUTES = 5 * 60 * 1000;
      const elapsed = Date.now() - _lastRefreshTime;
      if (elapsed >= FIVE_MINUTES) {
        console.log(`CRP: Tab visible again — ${Math.round(elapsed / 60000)}m since last refresh, refreshing`);
        setTimeout(autoRefreshAll, 1000);
      } else {
        console.log(`CRP: Tab visible again — only ${Math.round(elapsed / 60000)}m since last refresh, skipping`);
      }
    }
  });
}

// Run init immediately if DOM is already loaded (Apps Script async chunk injection),
// otherwise wait for DOMContentLoaded (GitHub Pages normal load)
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', _crpInit);
} else {
  _crpInit();
}

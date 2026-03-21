// ============================================================
// CLICKUP → GOOGLE SHEETS SYNC
// ============================================================
// Standalone Apps Script that fetches referral pipeline and
// campaign data from ClickUp, normalizes it, and writes to a
// Google Spreadsheet.  The spreadsheet is published as CSV so
// the dashboard can consume it without any API token.
//
// Setup:
//   1. Create a new Google Spreadsheet (the "sync sheet").
//   2. File > Share > Publish to web — publish each tab as CSV.
//   3. In this script's Project Settings > Script Properties, set:
//        CLICKUP_TOKEN   — your ClickUp API token (pk_...)
//        SPREADSHEET_ID  — the ID of the sync sheet
//   4. Add a time-based trigger: syncAll(), every 15 minutes.
// ============================================================

var API_BASE = 'https://api.clickup.com/api/v2';

// ── ClickUp list config (mirrors CRP_CONFIG.CLICKUP in dashboard.js) ──
var REFERRAL_LISTS = [
  { id: '901413202462', name: 'Dr. Modarressi',                  source_type: 'physician' },
  { id: '901413613356', name: 'Connolly Dermatology',            source_type: 'physician' },
  { id: '901413613360', name: 'Dr. Savita Singh',                source_type: 'physician' },
  { id: '901414013590', name: 'Center for Primary Care Medicine', source_type: 'physician' },
];
var CAMPAIGN_LIST_ID = '901407896291';

var PIPELINE_MAP = {
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
  'pending release':          'New Lead',
  'under review':             'New Lead',
  'not interested':           'Lost',
  'ready to schedule':        'Contacted',
  'no show':                  'Lost',
  'in screening':             'Screening',
  'scheduled':                'Screening',
  'enrolled':                 'Enrolled',
};
var CLOSED_STAGES = ['DNQ', 'Screen Fail', 'Lost'];
var SOURCE_RENAME = { 'Practice': 'Princeton CardioMetabolic' };


// ============================================================
// ONE-TIME SETUP — run setupCrioToken() once from the Script Editor
// ============================================================
// setupCrioToken() — already run, token stored in Script Properties. Removed for security.

// ============================================================
// DISABLE: Run this once to delete all triggers (sync replaced by Cloud Function)
// ============================================================
function disableSync() {
  var triggers = ScriptApp.getProjectTriggers();
  triggers.forEach(function(t) { ScriptApp.deleteTrigger(t); });
  Logger.log('Deleted ' + triggers.length + ' triggers. ClickUp sync is now disabled.');
  Logger.log('Data is served by Cloud Function: https://us-east1-crio-468120.cloudfunctions.net/crp-bq-api');
}

// MAIN ENTRY POINT — call this from a 15-min trigger
// ============================================================
function syncAll() {
  var props = PropertiesService.getScriptProperties();
  var token = props.getProperty('CLICKUP_TOKEN');
  var ssId  = props.getProperty('SPREADSHEET_ID');
  if (!token || !ssId) {
    Logger.log('ERROR: Missing CLICKUP_TOKEN or SPREADSHEET_ID in Script Properties');
    return;
  }
  var ss = SpreadsheetApp.openById(ssId);

  Logger.log('=== ClickUp Sync: ' + new Date().toISOString() + ' ===');

  var refRows = syncReferrals(token);
  writeSheet(ss, 'Referrals', REFERRAL_HEADERS, refRows);
  Logger.log('Referrals: ' + refRows.length + ' rows');

  var campRows = syncCampaigns(token);
  writeSheet(ss, 'Campaigns', CAMPAIGN_HEADERS, campRows);
  Logger.log('Campaigns: ' + campRows.length + ' rows');

  var medRows = syncMedicalRecords(token);
  writeSheet(ss, 'MedicalRecords', MED_RECORDS_HEADERS, medRows);
  Logger.log('MedicalRecords: ' + medRows.length + ' rows');

  // ── CRIO API Sync ──
  var crioToken = props.getProperty('CRIO_TOKEN');
  var crioData = syncCrioData(crioToken);
  writeSheet(ss, 'CRIO_Studies', CRIO_STUDIES_HEADERS, crioData.studies);
  Logger.log('CRIO_Studies: ' + crioData.studies.length + ' rows');
  writeSheet(ss, 'CRIO_Subjects', CRIO_SUBJECTS_HEADERS, crioData.subjects);
  Logger.log('CRIO_Subjects: ' + crioData.subjects.length + ' rows');

  // Write a sync timestamp to a metadata sheet
  var metaSheet = getOrCreateSheet(ss, '_SyncMeta');
  metaSheet.getRange('A1').setValue('last_sync');
  metaSheet.getRange('B1').setValue(new Date().toISOString());
  metaSheet.getRange('A2').setValue('referral_count');
  metaSheet.getRange('B2').setValue(refRows.length);
  metaSheet.getRange('A3').setValue('campaign_count');
  metaSheet.getRange('B3').setValue(campRows.length);
  metaSheet.getRange('A4').setValue('medrec_count');
  metaSheet.getRange('B4').setValue(medRows.length);
  metaSheet.getRange('A5').setValue('crio_study_count');
  metaSheet.getRange('B5').setValue(crioData.studies.length);
  metaSheet.getRange('A6').setValue('crio_subject_count');
  metaSheet.getRange('B6').setValue(crioData.subjects.length);
}


// ============================================================
// REFERRAL SYNC
// ============================================================
var REFERRAL_HEADERS = [
  'id','name','tracker','source_type','source','study','status_raw',
  'stage','phone','dob','referring_physician','next_appt',
  'date_created','date_updated','days_since_update','url','is_closed'
];

function syncReferrals(token) {
  var allRows = [];
  for (var i = 0; i < REFERRAL_LISTS.length; i++) {
    var list = REFERRAL_LISTS[i];
    var tasks = fetchAllTasks(token, list.id);
    for (var j = 0; j < tasks.length; j++) {
      allRows.push(normalizeReferral(tasks[j], list));
    }
  }
  return allRows;
}

function normalizeReferral(t, list) {
  var fields = parseCustomFields(t.custom_fields || []);
  var status = ((t.status || {}).status || '').toLowerCase();
  var stage = PIPELINE_MAP[status] || 'Other';
  var source = SOURCE_RENAME[fields['Source']] || fields['Source'] || list.name;

  var dateCreated = t.date_created
    ? new Date(parseInt(t.date_created)).toISOString().split('T')[0] : '';
  var dateUpdated = t.date_updated
    ? new Date(parseInt(t.date_updated)).toISOString().split('T')[0] : '';
  var daysSinceUpdate = t.date_updated
    ? Math.floor((Date.now() - parseInt(t.date_updated)) / 86400000) : 999;
  var isClosed = CLOSED_STAGES.indexOf(stage) !== -1
    || (t.status || {}).type === 'closed'
    || (t.status || {}).type === 'done';

  return [
    t.id,
    t.name || '',
    list.name,
    list.source_type,
    source,
    fields['Study'] || '',
    (t.status || {}).status || '',
    stage,
    fields['Phone #'] || '',
    fields['Patient DOB'] || '',
    fields['Referring Physician'] || '',
    fields['Next Appointment Date'] || '',
    dateCreated,
    dateUpdated,
    daysSinceUpdate,
    t.url || 'https://app.clickup.com/t/' + t.id,
    isClosed ? 'TRUE' : 'FALSE',
  ];
}


// ============================================================
// CAMPAIGN SYNC
// ============================================================
var CAMPAIGN_HEADERS = [
  'study','vendor','first_contact','second_contact','third_contact',
  'new_referrals','scheduled','url'
];

function syncCampaigns(token) {
  var tasks = fetchAllTasks(token, CAMPAIGN_LIST_ID);
  return tasks.map(function(t) {
    var fields = {};
    (t.custom_fields || []).forEach(function(f) {
      if (f.value === null || f.value === undefined) return;
      fields[f.name] = String(f.value);
    });
    return [
      t.name || '',
      ((t.status || {}).status || '').trim(),
      parseInt(fields['FIRST CONTACT'] || '0') || 0,
      parseInt(fields['SECOND CONTACT'] || '0') || 0,
      parseInt(fields['THIRD CONTACT'] || '0') || 0,
      parseInt(fields['New Referrals'] || '0') || 0,
      parseInt(fields['Scheduled'] || fields['SCHEDULED'] || '0') || 0,
      t.url || 'https://app.clickup.com/t/' + t.id,
    ];
  });
}


// ============================================================
// MEDICAL RECORDS SYNC (folder 90147290121 — one list per study)
// ============================================================
var MED_RECORDS_FOLDER_ID = '90147290121';

var MED_RECORDS_HEADERS = [
  'id','name','study','status_raw','status','assignee',
  'phone','dob','crio_link',
  'records_received','medical_release','records_in_crio','records_portal','retrieval_deadline',
  'investigator_approval',
  'pre_screening_date','screening_date','randomization_date','next_visit_date','next_appointment',
  'last_contact_date','same_day_cancel',
  'notes','ops_notes',
  'date_created','date_updated','days_since_update','url',
  'is_active','is_closed'
];

var MED_STATUS_MAP = {
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
  'no show not rescheduled': 'No Show',
  'complete':         'Complete',
  'discontinued':     'Discontinued',
  'cancelled':        'Cancelled',
  'in another study': 'In Another Study',
  'withdrawn':        'Withdrawn',
};

var MED_ACTIVE_STATUSES = ['Pending Release','Under Review','Ready to Schedule','Visit Scheduled','In Screening','Enrolled'];
var MED_CLOSED_STATUSES = ['DNQ','Screen Fail','Not Interested','Unable to Reach','No Show','Complete','Discontinued','Cancelled','In Another Study','Withdrawn'];

function syncMedicalRecords(token) {
  // Fetch all lists in the Medical Records folder
  var url = API_BASE + '/folder/' + MED_RECORDS_FOLDER_ID + '/list';
  var resp = UrlFetchApp.fetch(url, {
    headers: { 'Authorization': token },
    muteHttpExceptions: true,
  });
  if (resp.getResponseCode() !== 200) {
    Logger.log('ClickUp API error fetching MedRecords folder: ' + resp.getContentText().slice(0, 200));
    return [];
  }
  var lists = JSON.parse(resp.getContentText()).lists || [];
  var allRows = [];
  for (var i = 0; i < lists.length; i++) {
    var list = lists[i];
    var studyName = list.name || '';
    var tasks = fetchAllTasks(token, list.id);
    for (var j = 0; j < tasks.length; j++) {
      allRows.push(normalizeMedRecord(tasks[j], studyName));
    }
  }
  return allRows;
}

function normalizeMedRecord(t, studyName) {
  var fields = parseCustomFields(t.custom_fields || []);
  var statusRaw = ((t.status || {}).status || '').toLowerCase();
  var status = MED_STATUS_MAP[statusRaw] || statusRaw || 'Unknown';
  var isActive = MED_ACTIVE_STATUSES.indexOf(status) !== -1;
  var isClosed = MED_CLOSED_STATUSES.indexOf(status) !== -1
    || (t.status || {}).type === 'closed'
    || (t.status || {}).type === 'done';

  var dateCreated = t.date_created
    ? new Date(parseInt(t.date_created)).toISOString().split('T')[0] : '';
  var dateUpdated = t.date_updated
    ? new Date(parseInt(t.date_updated)).toISOString().split('T')[0] : '';
  var daysSinceUpdate = t.date_updated
    ? Math.floor((Date.now() - parseInt(t.date_updated)) / 86400000) : 999;

  // Assignees
  var assignees = (t.assignees || []).map(function(a) { return a.username || ''; }).join(', ');

  // Checkbox field — value is "true"/"false" string
  var recordsInCrio = '';
  (t.custom_fields || []).forEach(function(f) {
    if (f.name === 'Medical records added to CRIO' && f.type === 'checkbox') {
      recordsInCrio = f.value === 'true' || f.value === true ? 'Yes' : 'No';
    }
  });

  return [
    t.id,
    t.name || '',
    studyName,
    (t.status || {}).status || '',
    status,
    assignees,
    fields['Phone #'] || fields['Phone'] || '',
    fields['Patient DOB'] || fields['DOB'] || '',
    fields['CRIO Link'] || '',
    fields['Medical records received?'] || '',
    fields['Medical release (Jotform)'] || '',
    recordsInCrio,
    fields['Medical Records Portal'] || '',
    fields['Retrieval Deadline'] || '',
    fields['Investigator Approval'] || fields['PI Approval'] || '',
    fields['Pre-Screening Visit (Date)'] || '',
    fields['Screening Visit (Date)'] || '',
    fields['Randomization Visit (Date)'] || '',
    fields['Next Visit'] || fields['Next visit date'] || '',
    fields['Next Appointment Date'] || fields['Next Appointment'] || '',
    fields['Last Contact Date'] || '',
    fields['Same day cancellation?'] || '',
    fields['Notes'] || '',
    fields['Operations Team Notes'] || '',
    dateCreated,
    dateUpdated,
    daysSinceUpdate,
    t.url || 'https://app.clickup.com/t/' + t.id,
    isActive ? 'TRUE' : 'FALSE',
    isClosed ? 'TRUE' : 'FALSE',
  ];
}


// ============================================================
// CRIO API SYNC — Studies & Subjects from CRIO Recruitment API
// ============================================================
var CRIO_API_BASE = 'https://api.clinicalresearch.io';
var CRIO_SITE_IDS = ['1679', '5545'];  // 1679=Philadelphia, 5545=Pennington
var CRIO_CLIENT_ID = '1329';  // CRP org ID

var CRIO_STUDIES_HEADERS = [
  'study_key','protocol_number','study_name','status','coordinator','investigator',
  'indication','subject_count','target_enrollment','sponsor','phase',
  'date_created','last_updated','last_updated_ts','start_date','end_date',
  'external_study_number','specialty','trial_id','site_name','site_key','study_arms',
  'total_revenue','revenue_subjects'
];

var CRIO_SUBJECTS_HEADERS = [
  'subject_id','study_key','protocol_number','status'
];

// Discovery function: run once to find all site IDs for your CRIO client
function listCrioSites() {
  var props = PropertiesService.getScriptProperties();
  var token = props.getProperty('CRIO_TOKEN');
  if (!token) { Logger.log('No CRIO_TOKEN'); return; }
  // Try site IDs 1 through 5000 in batches (or use a known range)
  // Alternative: if CRIO has a /sites endpoint, use that
  // Try client endpoint first
  try {
    var clientResp = UrlFetchApp.fetch(CRIO_API_BASE + '/api/v1/client/' + CRIO_CLIENT_ID, {
      method: 'get', headers: { 'Authorization': 'Bearer ' + token, 'Accept': 'application/json' }, muteHttpExceptions: true
    });
    Logger.log('Client endpoint (' + clientResp.getResponseCode() + '): ' + clientResp.getContentText().slice(0, 1000));
  } catch(e) { Logger.log('Client endpoint failed: ' + e.message); }
  // Try sites list endpoint
  try {
    var sitesResp = UrlFetchApp.fetch(CRIO_API_BASE + '/api/v1/sites?client_id=' + CRIO_CLIENT_ID, {
      method: 'get', headers: { 'Authorization': 'Bearer ' + token, 'Accept': 'application/json' }, muteHttpExceptions: true
    });
    Logger.log('Sites endpoint (' + sitesResp.getResponseCode() + '): ' + sitesResp.getContentText().slice(0, 1000));
  } catch(e) { Logger.log('Sites endpoint failed: ' + e.message); }
  // Scan a range of IDs around known site 1679
  var ranges = [[1,50],[100,200],[500,600],[1000,1100],[1600,1750],[1800,2000],[2500,2600],[3000,3100]];
  for (var ri = 0; ri < ranges.length; ri++) {
    for (var id = ranges[ri][0]; id <= ranges[ri][1]; id++) {
      try {
        var resp = UrlFetchApp.fetch(CRIO_API_BASE + '/api/v1/site/' + id + '?client_id=' + CRIO_CLIENT_ID, {
          method: 'get', headers: { 'Authorization': 'Bearer ' + token, 'Accept': 'application/json' }, muteHttpExceptions: true
        });
        if (resp.getResponseCode() === 200) {
          var data = JSON.parse(resp.getContentText());
          Logger.log('FOUND Site ' + id + ': ' + (data.siteName || data.name || 'unnamed') + ' — ' + (data.studies || []).length + ' studies');
        }
      } catch(e) {}
      Utilities.sleep(50);
    }
  }
}

function syncCrioData(crioToken) {
  if (!crioToken) {
    Logger.log('CRIO: No token, skipping');
    return { studies: [], subjects: [] };
  }

  // 1. Fetch all sites via /sites endpoint, then supplement with individual site details
  var studies = [];
  var studySiteMap = {};  // studyKey → siteId
  var siteNames = {};     // siteId → name

  // Try bulk /sites endpoint first (returns all sites for this client)
  var bulkOk = false;
  try {
    var sitesResp = UrlFetchApp.fetch(CRIO_API_BASE + '/api/v1/sites?client_id=' + CRIO_CLIENT_ID, {
      method: 'get',
      headers: { 'Authorization': 'Bearer ' + crioToken, 'Accept': 'application/json' },
      muteHttpExceptions: true,
    });
    if (sitesResp.getResponseCode() === 200) {
      var allSites = JSON.parse(sitesResp.getContentText());
      allSites.forEach(function(site) {
        var sid = String(site.siteId);
        siteNames[sid] = site.name || '';
        var siteStudies = site.studies || [];
        Logger.log('CRIO: Found ' + siteStudies.length + ' studies at site ' + sid + ' (' + siteNames[sid] + ')');
        siteStudies.forEach(function(s) { studySiteMap[s.studyKey] = sid; });
        studies = studies.concat(siteStudies);
      });
      bulkOk = true;
    }
  } catch(e) { Logger.log('CRIO /sites failed: ' + e.message); }

  // Fallback: fetch each site individually
  if (!bulkOk) {
    for (var si = 0; si < CRIO_SITE_IDS.length; si++) {
      var siteId = CRIO_SITE_IDS[si];
      try {
        var siteResp = UrlFetchApp.fetch(CRIO_API_BASE + '/api/v1/site/' + siteId + '?client_id=' + CRIO_CLIENT_ID, {
          method: 'get',
          headers: { 'Authorization': 'Bearer ' + crioToken, 'Content-Type': 'application/json', 'Accept': 'application/json' },
          muteHttpExceptions: true,
        });
        if (siteResp.getResponseCode() === 200) {
          var site = JSON.parse(siteResp.getContentText());
          var siteStudies = site.studies || [];
          siteNames[siteId] = site.siteName || site.name || '';
          Logger.log('CRIO: Found ' + siteStudies.length + ' studies at site ' + siteId + ' (' + siteNames[siteId] + ')');
          siteStudies.forEach(function(s) { studySiteMap[s.studyKey] = siteId; });
          studies = studies.concat(siteStudies);
        }
      } catch(e) { Logger.log('CRIO site ' + siteId + ' failed: ' + e.message); }
    }
  }
  Logger.log('CRIO: ' + studies.length + ' total studies across ' + Object.keys(siteNames).length + ' sites');

  // 2. For each enrolling/maintenance study, fetch subject details
  var studyRows = [];
  var subjectRows = [];
  var ACTIVE_STATUSES = ['ENROLLING', 'MAINTENANCE', 'STARTUP', 'PRECLOSED'];

  for (var i = 0; i < studies.length; i++) {
    var s = studies[i];
    var isActive = ACTIVE_STATUSES.indexOf(s.status) !== -1;

    // Only fetch full detail for active studies (to stay within rate limits)
    var coordinator = '';
    var investigator = '';
    var indication = '';
    var subjectCount = 0;
    var targetEnrollment = '';
    var sponsor = '';
    var phase = '';
    var dateCreated = '';
    var lastUpdated = '';
    var lastUpdatedTs = '';
    var startDate = '';
    var endDate = '';
    var studyName = s.name || s.protocolNumber || '';
    var externalStudyNumber = '';
    var specialty = '';
    var trialId = '';
    var siteName = '';
    var siteKey = '';
    var studyArmsStr = '';
    var totalRevenue = 0;
    var revenueSubjects = 0;

    if (isActive) {
      var studySiteId = studySiteMap[s.studyKey] || CRIO_SITE_IDS[0];
      var studyUrl = CRIO_API_BASE + '/api/v1/study/' + s.studyKey
        + '/site/' + studySiteId + '?client_id=' + CRIO_CLIENT_ID;
      var studyResp = UrlFetchApp.fetch(studyUrl, {
        method: 'get',
        headers: {
          'Authorization': 'Bearer ' + crioToken,
          'Content-Type': 'application/json',
          'Accept': 'application/json',
        },
        muteHttpExceptions: true,
      });
      if (studyResp.getResponseCode() === 200) {
        var detail = JSON.parse(studyResp.getContentText());

        var roles = detail.roles || [];
        for (var r = 0; r < roles.length; r++) {
          var contact = roles[r].contact || {};
          var fullName = ((contact.firstName || '') + ' ' + (contact.lastName || '')).trim();
          if (roles[r].role === 'coordinator') coordinator = fullName;
          if (roles[r].role === 'investigator') investigator = fullName;
        }
        indication = (detail.indication || {}).name || '';
        studyName = detail.protocolNumber || studyName;
        sponsor = (typeof detail.sponsor === 'object' && detail.sponsor !== null) ? (detail.sponsor.name || '') : (detail.sponsor || '');
        phase = detail.phase || '';
        targetEnrollment = detail.targetEnrollment || '';
        startDate = detail.startDate || '';
        endDate = detail.endDate || '';
        dateCreated = detail.dateCreated || '';
        lastUpdated = detail.lastUpdated || '';
        lastUpdatedTs = detail.lastUpdatedTS ? String(detail.lastUpdatedTS) : '';
        externalStudyNumber = detail.externalStudyNumber || '';
        specialty = (typeof detail.specialty === 'object' && detail.specialty) ? (detail.specialty.name || JSON.stringify(detail.specialty)) : (detail.specialty || '');
        trialId = detail.trialId || '';
        siteName = detail.siteName || '';
        siteKey = detail.siteKey || '';
        if (detail.studyArms && detail.studyArms.length) {
          studyArmsStr = detail.studyArms.map(function(a) { return a.name || a.armName || JSON.stringify(a); }).join(' | ');
        }

        // Extract per-subject revenue from finances array
        var finances = detail.finances || [];
        for (var f = 0; f < finances.length; f++) {
          if (finances[f].amount) {
            totalRevenue += finances[f].amount;
            revenueSubjects++;
          }
        }

        var subjects = detail.subjects || [];
        subjectCount = subjects.length;
        for (var j = 0; j < subjects.length; j++) {
          var subj = subjects[j];
          subjectRows.push([
            subj.id || '',
            s.studyKey,
            s.protocolNumber || '',
            subj.status || '',
          ]);
        }
      } else {
        Logger.log('CRIO study ' + s.studyKey + ' error: '
          + studyResp.getContentText().slice(0, 100));
      }
      // Rate limit: 200ms between requests
      Utilities.sleep(200);
    }

    studyRows.push([
      s.studyKey,
      s.protocolNumber || '',
      studyName,
      s.status || '',
      coordinator,
      investigator,
      indication,
      String(subjectCount),
      targetEnrollment ? String(targetEnrollment) : '',
      typeof sponsor === 'object' && sponsor !== null ? (sponsor.name || JSON.stringify(sponsor)) : (sponsor || ''),
      phase,
      dateCreated,
      lastUpdated,
      lastUpdatedTs,
      startDate,
      endDate,
      externalStudyNumber,
      specialty,
      trialId,
      siteName,
      siteKey,
      studyArmsStr,
      totalRevenue ? totalRevenue.toFixed(2) : '',
      revenueSubjects ? String(revenueSubjects) : '',
    ]);
  }

  Logger.log('CRIO: ' + studyRows.length + ' studies, ' + subjectRows.length + ' subjects');
  return { studies: studyRows, subjects: subjectRows };
}


// ============================================================
// CLICKUP API HELPERS
// ============================================================
function fetchAllTasks(token, listId) {
  var tasks = [];
  var page = 0;
  while (true) {
    var url = API_BASE + '/list/' + listId + '/task?page=' + page
      + '&subtasks=false&include_closed=true&limit=100';
    var resp = UrlFetchApp.fetch(url, {
      headers: { 'Authorization': token },
      muteHttpExceptions: true,
    });
    if (resp.getResponseCode() !== 200) {
      Logger.log('ClickUp API error for list ' + listId + ': ' + resp.getContentText().slice(0, 200));
      break;
    }
    var data = JSON.parse(resp.getContentText());
    if (data.tasks && data.tasks.length > 0) {
      tasks = tasks.concat(data.tasks);
      if (data.tasks.length < 100) break;
      page++;
    } else {
      break;
    }
    // Small delay to respect rate limits
    Utilities.sleep(200);
  }
  return tasks;
}

function parseCustomFields(customFields) {
  var fields = {};
  for (var i = 0; i < customFields.length; i++) {
    var f = customFields[i];
    if (f.value === null || f.value === undefined) continue;
    if (f.type === 'drop_down') {
      var options = (f.type_config || {}).options || [];
      var match = null;
      for (var j = 0; j < options.length; j++) {
        if (options[j].orderindex === f.value) { match = options[j]; break; }
      }
      fields[f.name] = match ? match.name : String(f.value);
    } else if (f.type === 'date') {
      fields[f.name] = f.value ? new Date(parseInt(f.value)).toISOString().split('T')[0] : '';
    } else if (f.type === 'phone') {
      fields[f.name] = typeof f.value === 'object' ? (f.value.phone_number || '') : String(f.value);
    } else {
      fields[f.name] = String(f.value);
    }
  }
  return fields;
}


// ============================================================
// SHEET HELPERS
// ============================================================
function getOrCreateSheet(ss, name) {
  var sheet = ss.getSheetByName(name);
  if (!sheet) sheet = ss.insertSheet(name);
  return sheet;
}

function writeSheet(ss, sheetName, headers, rows) {
  var sheet = getOrCreateSheet(ss, sheetName);
  sheet.clear();
  if (rows.length === 0) {
    sheet.getRange(1, 1, 1, headers.length).setValues([headers]);
    return;
  }
  var allData = [headers].concat(rows);
  sheet.getRange(1, 1, allData.length, headers.length).setValues(allData);
}

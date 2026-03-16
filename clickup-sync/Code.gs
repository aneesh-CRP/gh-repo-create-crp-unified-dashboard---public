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

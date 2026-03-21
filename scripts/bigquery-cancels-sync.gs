/**
 * CRP Dashboard — BigQuery Data Sync
 *
 * Sync functions (all write to same Google Sheet, different tabs):
 *   syncBigQueryCancels()     — appointment_audit_log (change_type=4) → BQ_Cancellations
 *   syncBigQueryVisits()      — calendar_appointment (all statuses)   → BQ_Visits
 *   syncBigQueryStudies()     — study + study_details + study_finance → BQ_Studies
 *   syncBigQuerySubjects()    — subject enrollment statuses           → BQ_Subjects
 *   syncBigQueryStudyStatus() — study_details milestone dates         → BQ_StudyStatus
 *   syncBigQueryAuditLog()    — appointment_audit_log (all changes)   → BQ_AuditLog
 *   syncBigQueryPatientDB()   — patient demographics                  → BQ_PatientDB
 *
 * Self-bootstrapping: first manual run auto-creates 15-minute trigger.
 */

var BQ_CONFIG = {
  PROJECT_ID: 'crio-468120',
  DATASET: 'crio_data',
  SHEET_ID: '1p-igO6CFkciRvJ16pUhZ3ket0WDpkhNA3d7N2AD5rcY',
  TAB_NAME: 'BQ_Cancellations',
  LOOKBACK_DAYS: 90,
  MAX_ROWS: 50000
};

// Minimum expected rows per tab — if BQ returns fewer, something is wrong
var MIN_ROWS = {
  'BQ_Cancellations': 50, 'BQ_Visits': 50, 'BQ_Studies': 20,
  'BQ_Subjects': 1000, 'BQ_StudyStatus': 20, 'BQ_AuditLog': 100,
  'BQ_PatientDB': 5000
};

/** Generic: run query, write to sheet tab, return row count */
function _syncQueryToSheet(query, tabName, label, headerMap) {
  Logger.log('Running ' + label + '...');
  var result;
  try {
    result = BigQuery.Jobs.query({ query: query, useLegacySql: false, maxResults: BQ_CONFIG.MAX_ROWS, timeoutMs: 120000 }, BQ_CONFIG.PROJECT_ID);
  } catch (e) {
    Logger.log(label + ' query failed: ' + e.message);
    _logSyncHealth(tabName, 'FAIL', 0, e.message);
    throw e;
  }
  var allRows = result.rows || [];
  while (result.pageToken) {
    result = BigQuery.Jobs.getQueryResults(BQ_CONFIG.PROJECT_ID, result.jobReference.jobId, { pageToken: result.pageToken, maxResults: BQ_CONFIG.MAX_ROWS });
    allRows = allRows.concat(result.rows || []);
  }
  var schema = result.schema.fields.map(function(f) { return f.name; });
  var headers = headerMap ? schema.map(function(n) { return headerMap[n] || n; }) : schema;
  var data = allRows.map(function(row) { return row.f.map(function(cell) { return cell.v || ''; }); });
  Logger.log(label + ' returned ' + data.length + ' rows');

  // Safety check: don't overwrite good data with empty/tiny results
  var minExpected = MIN_ROWS[tabName] || 5;
  if (data.length < minExpected) {
    var msg = tabName + ': only ' + data.length + ' rows (min ' + minExpected + ') — keeping previous data';
    Logger.log('WARNING: ' + msg);
    _logSyncHealth(tabName, 'WARN', data.length, msg);
    return -1;  // Signal: don't overwrite
  }

  var ss = SpreadsheetApp.openById(BQ_CONFIG.SHEET_ID);
  var sheet = ss.getSheetByName(tabName);
  if (!sheet) sheet = ss.insertSheet(tabName);
  var neededRows = Math.max(data.length + 2, 2);
  var neededCols = headers.length;
  if (sheet.getMaxRows() > neededRows) sheet.deleteRows(neededRows + 1, sheet.getMaxRows() - neededRows);
  if (sheet.getMaxColumns() > neededCols) sheet.deleteColumns(neededCols + 1, sheet.getMaxColumns() - neededCols);
  sheet.clear();
  sheet.getRange(1, 1, neededRows, neededCols).setNumberFormat('@');
  sheet.getRange(1, 1, 1, headers.length).setValues([headers]);
  if (data.length > 0) sheet.getRange(2, 1, data.length, headers.length).setValues(data);
  sheet.getRange(1, 1).setNote('Last synced: ' + new Date().toISOString());

  Logger.log(tabName + ' synced: ' + data.length + ' rows, ' + headers.length + ' columns');
  Logger.log('Sheet URL: ' + ss.getUrl());
  _logSyncHealth(tabName, 'OK', data.length, '');
  return data.length;
}

/** Log sync health to BQ_SyncHealth tab for monitoring */
function _logSyncHealth(tabName, status, rows, error) {
  try {
    var ss = SpreadsheetApp.openById(BQ_CONFIG.SHEET_ID);
    var sheet = ss.getSheetByName('BQ_SyncHealth');
    if (!sheet) {
      sheet = ss.insertSheet('BQ_SyncHealth');
      sheet.getRange(1, 1, 1, 5).setValues([['Timestamp', 'Tab', 'Status', 'Rows', 'Error']]);
    }
    var lastRow = Math.min(sheet.getLastRow(), 500); // Cap at 500 rows
    if (lastRow >= 500) {
      // Trim old entries — keep last 400
      sheet.deleteRows(2, 100);
      lastRow = sheet.getLastRow();
    }
    sheet.getRange(lastRow + 1, 1, 1, 5).setValues([
      [new Date().toISOString(), tabName, status, rows, error || '']
    ]);
  } catch (e) {
    Logger.log('SyncHealth log failed: ' + e.message);
  }
}

function syncBigQueryCancels() {
  _ensureSyncTrigger();
  var query = _buildCancelQuery();
  Logger.log('Running BigQuery cancel sync...');

  var request = {
    query: query,
    useLegacySql: false,
    maxResults: BQ_CONFIG.MAX_ROWS,
    timeoutMs: 30000
  };

  var result;
  try {
    result = BigQuery.Jobs.query(request, BQ_CONFIG.PROJECT_ID);
  } catch (e) {
    Logger.log('BigQuery query failed: ' + e.message);
    throw e;
  }

  var allRows = result.rows || [];
  while (result.pageToken) {
    result = BigQuery.Jobs.getQueryResults(BQ_CONFIG.PROJECT_ID, result.jobReference.jobId, {
      pageToken: result.pageToken,
      maxResults: BQ_CONFIG.MAX_ROWS
    });
    allRows = allRows.concat(result.rows || []);
  }

  var HEADER_MAP = {
    'subject_full_name': 'Subject Full Name',
    'study_name': 'Study Name',
    'study_key': 'Study Key',
    'site_name': 'Site Name',
    'cancel_date': 'Cancel Date',
    'scheduled_date': 'Scheduled Date',
    'subject_key_back_end': 'Subject Key (Back End)',
    'staff_full_name': 'Staff Full Name',
    'cancel_reason': 'Cancel Reason',
    'appointment_cancellation_type': 'Appointment Cancellation Type',
    'subject_status': 'Subject Status',
    'visit_name': 'Name',
    'appointment_type': 'Appointment Type',
    'appointment_status': 'Appointment Status',
    'calendar_appointment_key': 'Calendar Appointment Key (back end)',
    'investigator': 'Investigator',
    'snapshot_date': 'snapshot_date'
  };
  var headers = result.schema.fields.map(function(f) { return HEADER_MAP[f.name] || f.name; });

  var data = allRows.map(function(row) {
    return row.f.map(function(cell) { return cell.v || ''; });
  });

  Logger.log('Query returned ' + data.length + ' rows');

  var ss = SpreadsheetApp.openById(BQ_CONFIG.SHEET_ID);
  var sheet = ss.getSheetByName(BQ_CONFIG.TAB_NAME);
  if (!sheet) {
    sheet = ss.getSheets()[0];
    sheet.setName(BQ_CONFIG.TAB_NAME);
  }

  var neededRows = Math.max(data.length + 4, 2);
  var neededCols = headers.length;
  if (sheet.getMaxRows() > neededRows) {
    sheet.deleteRows(neededRows + 1, sheet.getMaxRows() - neededRows);
  }
  if (sheet.getMaxColumns() > neededCols) {
    sheet.deleteColumns(neededCols + 1, sheet.getMaxColumns() - neededCols);
  }

  sheet.clear();
  sheet.getRange(1, 1, neededRows, neededCols).setNumberFormat('@');
  sheet.getRange(1, 1, 1, headers.length).setValues([headers]);

  if (data.length > 0) {
    sheet.getRange(2, 1, data.length, headers.length).setValues(data);
  }

  // Store timestamp as a note on A1 instead of a data row (avoids polluting CSV)
  sheet.getRange(1, 1).setNote('Last synced: ' + new Date().toISOString());

  Logger.log('BQ Cancellations synced: ' + data.length + ' rows, ' + headers.length + ' columns');
  Logger.log('Sheet URL: ' + ss.getUrl());
  return data.length;
}

function _buildCancelQuery() {
  var project = BQ_CONFIG.PROJECT_ID;
  var ds = BQ_CONFIG.DATASET;
  var days = BQ_CONFIG.LOOKBACK_DAYS;

  return 'SELECT ' +
    'CONCAT(sub.first_name, \' \', sub.last_name) AS subject_full_name, ' +
    'CASE ' +
    '  WHEN COALESCE(st.nickname, \'\') != \'\' THEN st.nickname ' +
    '  WHEN spon.name IS NOT NULL AND COALESCE(st.protocol_number, \'\') != \'\' THEN CONCAT(spon.name, \' - \', st.protocol_number) ' +
    '  WHEN COALESCE(st.protocol_number, \'\') != \'\' THEN st.protocol_number ' +
    '  ELSE \'\' ' +
    'END AS study_name, ' +
    'aal.study_key AS study_key, ' +
    'COALESCE(si.name, \'\') AS site_name, ' +
    'FORMAT_DATETIME(\'%Y-%m-%d\', aal.date_created) AS cancel_date, ' +
    'FORMAT_DATETIME(\'%Y-%m-%d\', COALESCE(aal.old_start, aal.date_created)) AS scheduled_date, ' +
    'aal.subject_key AS subject_key_back_end, ' +
    'CONCAT(COALESCE(coord.first_name, by_user.first_name, \'\'), \' \', COALESCE(coord.last_name, by_user.last_name, \'\')) AS staff_full_name, ' +
    'COALESCE(aal.cancel_reason, \'\') AS cancel_reason, ' +
    'CASE aal.cancel_type ' +
    '  WHEN 1 THEN \'No Show\' ' +
    '  WHEN 2 THEN \'Site Cancelled\' ' +
    '  WHEN 3 THEN \'Patient Cancelled\' ' +
    '  ELSE \'\' ' +
    'END AS appointment_cancellation_type, ' +
    'CASE sub.status ' +
    '  WHEN 1 THEN \'Interested\' ' +
    '  WHEN 2 THEN \'Prequalified\' ' +
    '  WHEN 3 THEN \'No Show/Cancelled V1\' ' +
    '  WHEN 4 THEN \'Scheduled V1\' ' +
    '  WHEN 10 THEN \'Screening\' ' +
    '  WHEN 11 THEN \'Enrolled\' ' +
    '  WHEN 12 THEN \'Screen Fail\' ' +
    '  WHEN 13 THEN \'Discontinued\' ' +
    '  WHEN 20 THEN \'Completed\' ' +
    '  ELSE \'\' ' +
    'END AS subject_status, ' +
    'COALESCE(sv.name, \'\') AS visit_name, ' +
    'CASE aal.appointment_type ' +
    '  WHEN 0 THEN \'Regular Visit\' ' +
    '  WHEN 1 THEN \'Ad Hoc Visit\' ' +
    '  WHEN 2 THEN \'General Appointment\' ' +
    '  WHEN 3 THEN \'Block\' ' +
    '  ELSE \'\' ' +
    'END AS appointment_type, ' +
    '\'cancelled\' AS appointment_status, ' +
    'CAST(aal.calendar_appointment_key AS STRING) AS calendar_appointment_key, ' +
    'COALESCE(CONCAT(pi_u.first_name, \' \', pi_u.last_name), \'\') AS investigator, ' +
    'FORMAT_DATETIME(\'%Y-%m-%d\', CURRENT_DATETIME()) AS snapshot_date ' +
    'FROM `' + project + '.' + ds + '.appointment_audit_log` aal ' +
    'LEFT JOIN `' + project + '.' + ds + '.calendar_appointment` ca ON aal.calendar_appointment_key = ca.calendar_appointment_key ' +
    'LEFT JOIN `' + project + '.' + ds + '.subject` sub ON aal.subject_key = sub.subject_key ' +
    'LEFT JOIN `' + project + '.' + ds + '.study` st ON aal.study_key = st.study_key ' +
    'LEFT JOIN `' + project + '.' + ds + '.sponsor` spon ON st.sponsor_key = spon.sponsor_key ' +
    'LEFT JOIN `' + project + '.' + ds + '.site` si ON aal.site_key = si.site_key ' +
    'LEFT JOIN `' + project + '.' + ds + '.study_visit` sv ON aal.study_visit_key = sv.study_visit_key ' +
    'LEFT JOIN `' + project + '.' + ds + '.user` coord ON ca.creator_key = coord.user_key ' +
    'LEFT JOIN `' + project + '.' + ds + '.user` by_user ON aal.by_user_key = by_user.user_key ' +
    'LEFT JOIN `' + project + '.' + ds + '.study_user` pi_su ON aal.study_key = pi_su.study_key AND pi_su.role = 1 AND pi_su.is_role_leader = 1 AND pi_su._fivetran_deleted = false ' +
    'LEFT JOIN `' + project + '.' + ds + '.user` pi_u ON pi_su.user_key = pi_u.user_key ' +
    'WHERE aal.change_type = 4 ' +
    'AND aal.date_created >= DATETIME_SUB(CURRENT_DATETIME(), INTERVAL ' + days + ' DAY) ' +
    'AND aal.subject_key IS NOT NULL ' +
    'AND st.is_active = 1 ' +
    'AND LOWER(COALESCE(st.nickname, st.protocol_number, \'\')) NOT LIKE \'%test%\' ' +
    'AND LOWER(COALESCE(st.nickname, st.protocol_number, \'\')) NOT LIKE \'%demo%\' ' +
    'AND LOWER(COALESCE(st.nickname, st.protocol_number, \'\')) NOT LIKE \'%sandbox%\' ' +
    'ORDER BY aal.date_created DESC';
}

function testQueryPreview() {
  Logger.log(_buildCancelQuery());
  Logger.log('---');
  Logger.log(_buildVisitsQuery());
}

// ═══════════════════════════════════════════════════════════════════
// VISITS SYNC — replaces LIVE_URL1 (Looker upcoming visits CSV)
// ═══════════════════════════════════════════════════════════════════

function syncBigQueryVisits() {
  _ensureVisitsTrigger();
  var query = _buildVisitsQuery();
  Logger.log('Running BigQuery visits sync...');

  var request = {
    query: query,
    useLegacySql: false,
    maxResults: BQ_CONFIG.MAX_ROWS,
    timeoutMs: 60000
  };

  var result;
  try {
    result = BigQuery.Jobs.query(request, BQ_CONFIG.PROJECT_ID);
  } catch (e) {
    Logger.log('BigQuery visits query failed: ' + e.message);
    throw e;
  }

  var allRows = result.rows || [];
  while (result.pageToken) {
    result = BigQuery.Jobs.getQueryResults(BQ_CONFIG.PROJECT_ID, result.jobReference.jobId, {
      pageToken: result.pageToken,
      maxResults: BQ_CONFIG.MAX_ROWS
    });
    allRows = allRows.concat(result.rows || []);
  }

  var HEADER_MAP = {
    'study_name': 'Study Name',
    'study_key': 'Study Key',
    'scheduled_date': 'Scheduled Date',
    'subject_full_name': 'Subject Full Name',
    'subject_key_back_end': 'Subject Key (Back End)',
    'full_name': 'Full Name',
    'appointment_status': 'Appointment Status',
    'visit_name': 'Name',
    'subject_status': 'Subject Status',
    'subject_id': 'Subject ID',
    'cancel_date': 'Cancel Date',
    'cancel_reason': 'Cancel Reason',
    'appointment_cancellation_type': 'Appointment Cancellation Type',
    'staff_full_name': 'Staff Full Name',
    'site_name': 'Site Name',
    'mobile_phone': 'Mobile Phone',
    'calendar_appointment_key': 'Calendar Appointment Key (back end)',
    'appointment_type': 'Appointment Type',
    'investigator': 'Investigator',
    'snapshot_date': 'snapshot_date'
  };
  var headers = result.schema.fields.map(function(f) { return HEADER_MAP[f.name] || f.name; });

  var data = allRows.map(function(row) {
    return row.f.map(function(cell) { return cell.v || ''; });
  });

  Logger.log('Visits query returned ' + data.length + ' rows');

  var ss = SpreadsheetApp.openById(BQ_CONFIG.SHEET_ID);
  var sheet = ss.getSheetByName('BQ_Visits');
  if (!sheet) {
    sheet = ss.insertSheet('BQ_Visits');
  }

  var neededRows = Math.max(data.length + 4, 2);
  var neededCols = headers.length;
  if (sheet.getMaxRows() > neededRows) {
    sheet.deleteRows(neededRows + 1, sheet.getMaxRows() - neededRows);
  }
  if (sheet.getMaxColumns() > neededCols) {
    sheet.deleteColumns(neededCols + 1, sheet.getMaxColumns() - neededCols);
  }

  sheet.clear();
  sheet.getRange(1, 1, neededRows, neededCols).setNumberFormat('@');
  sheet.getRange(1, 1, 1, headers.length).setValues([headers]);

  if (data.length > 0) {
    sheet.getRange(2, 1, data.length, headers.length).setValues(data);
  }

  // Store timestamp as a note on A1 instead of a data row (avoids polluting CSV)
  sheet.getRange(1, 1).setNote('Last synced: ' + new Date().toISOString());

  Logger.log('BQ Visits synced: ' + data.length + ' rows, ' + headers.length + ' columns');
  Logger.log('Sheet URL: ' + ss.getUrl());
  return data.length;
}

function _buildVisitsQuery() {
  var project = BQ_CONFIG.PROJECT_ID;
  var ds = BQ_CONFIG.DATASET;

  return 'SELECT ' +
    // Study Name — same logic as cancels
    'CASE ' +
    '  WHEN COALESCE(st.nickname, \'\') != \'\' THEN st.nickname ' +
    '  WHEN spon.name IS NOT NULL AND COALESCE(st.protocol_number, \'\') != \'\' THEN CONCAT(spon.name, \' - \', st.protocol_number) ' +
    '  WHEN COALESCE(st.protocol_number, \'\') != \'\' THEN st.protocol_number ' +
    '  ELSE \'\' ' +
    'END AS study_name, ' +
    'ca.study_key AS study_key, ' +
    // Scheduled Date
    'FORMAT_DATETIME(\'%Y-%m-%d\', ca.start) AS scheduled_date, ' +
    // Subject Full Name (first + middle + last, matching Looker format)
    'REGEXP_REPLACE(TRIM(CONCAT(COALESCE(sub.first_name, \'\'), \' \', COALESCE(sub.middle_name, \'\'), \' \', COALESCE(sub.last_name, \'\'))), r\'\\s+\', \' \') AS subject_full_name, ' +
    'ca.subject_key AS subject_key_back_end, ' +
    // Full Name = coordinator (creator of the appointment)
    'CONCAT(COALESCE(coord.first_name, \'\'), \' \', COALESCE(coord.last_name, \'\')) AS full_name, ' +
    // Appointment Status
    'CASE ca.status ' +
    '  WHEN 0 THEN \'Cancelled\' ' +
    '  WHEN -1 THEN \'Active\' ' +
    '  WHEN 1 THEN \'Active\' ' +
    '  WHEN 10 THEN \'Active\' ' +
    '  WHEN 12 THEN \'Active\' ' +
    '  WHEN 20 THEN \'Active\' ' +
    '  ELSE \'Active\' ' +
    'END AS appointment_status, ' +
    // Visit Name (= "Name" header in Looker CSV)
    'COALESCE(sv.name, \'\') AS visit_name, ' +
    // Subject Status
    'CASE sub.status ' +
    '  WHEN 1 THEN \'Interested\' ' +
    '  WHEN 2 THEN \'Prequalified\' ' +
    '  WHEN 3 THEN \'No Show/Cancelled V1\' ' +
    '  WHEN 4 THEN \'Scheduled V1\' ' +
    '  WHEN 10 THEN \'Screening\' ' +
    '  WHEN 11 THEN \'Enrolled\' ' +
    '  WHEN 12 THEN \'Screen Fail\' ' +
    '  WHEN 13 THEN \'Discontinued\' ' +
    '  WHEN 20 THEN \'Completed\' ' +
    '  ELSE \'\' ' +
    'END AS subject_status, ' +
    // Subject ID (CRIO patient_id on subject table)
    'COALESCE(sub.patient_id, \'\') AS subject_id, ' +
    // Cancel fields — populated only for cancelled appointments
    'CASE WHEN ca.status = 0 THEN FORMAT_DATETIME(\'%Y-%m-%d\', ca.cancel_date) ELSE \'\' END AS cancel_date, ' +
    'CASE WHEN ca.status = 0 THEN COALESCE(REGEXP_REPLACE(ca.cancel_reason, r\'[\\x00-\\x1f]\', \' \'), \'\') ELSE \'\' END AS cancel_reason, ' +
    'CASE WHEN ca.status = 0 THEN ' +
    '  CASE ca.cancel_type ' +
    '    WHEN 1 THEN \'No Show\' ' +
    '    WHEN 2 THEN \'Site Cancelled\' ' +
    '    WHEN 3 THEN \'Patient Cancelled\' ' +
    '    ELSE \'\' ' +
    '  END ' +
    'ELSE \'\' END AS appointment_cancellation_type, ' +
    // Staff Full Name (same as Full Name for visits)
    'CONCAT(COALESCE(coord.first_name, \'\'), \' \', COALESCE(coord.last_name, \'\')) AS staff_full_name, ' +
    // Site Name
    'COALESCE(si.name, \'\') AS site_name, ' +
    // Mobile Phone
    'COALESCE(sub.mobile_phone, \'\') AS mobile_phone, ' +
    // Calendar Appointment Key
    'CAST(ca.calendar_appointment_key AS STRING) AS calendar_appointment_key, ' +
    // Appointment Type
    'CASE ca.type ' +
    '  WHEN 0 THEN \'Regular Visit\' ' +
    '  WHEN 1 THEN \'Ad Hoc Visit\' ' +
    '  WHEN 2 THEN \'General Appointment\' ' +
    '  WHEN 3 THEN \'Block\' ' +
    '  ELSE \'\' ' +
    'END AS appointment_type, ' +
    // Investigator (PI from study_user role=1 via JOIN)
    'COALESCE(CONCAT(pi_u.first_name, \' \', pi_u.last_name), \'\') AS investigator, ' +
    // Snapshot date
    'FORMAT_DATETIME(\'%Y-%m-%d\', CURRENT_DATETIME()) AS snapshot_date ' +
    // FROM + JOINs
    'FROM `' + project + '.' + ds + '.calendar_appointment` ca ' +
    'LEFT JOIN `' + project + '.' + ds + '.subject` sub ON ca.subject_key = sub.subject_key ' +
    'LEFT JOIN `' + project + '.' + ds + '.study` st ON ca.study_key = st.study_key ' +
    'LEFT JOIN `' + project + '.' + ds + '.sponsor` spon ON st.sponsor_key = spon.sponsor_key ' +
    'LEFT JOIN `' + project + '.' + ds + '.site` si ON ca.site_key = si.site_key ' +
    'LEFT JOIN `' + project + '.' + ds + '.study_visit` sv ON ca.study_visit_key = sv.study_visit_key ' +
    'LEFT JOIN `' + project + '.' + ds + '.user` coord ON ca.creator_key = coord.user_key ' +
    'LEFT JOIN `' + project + '.' + ds + '.study_user` pi_su ON ca.study_key = pi_su.study_key AND pi_su.role = 1 AND pi_su.is_role_leader = 1 AND pi_su._fivetran_deleted = false ' +
    'LEFT JOIN `' + project + '.' + ds + '.user` pi_u ON pi_su.user_key = pi_u.user_key ' +
    // WHERE — active studies, date range, non-test
    'WHERE ca.subject_key IS NOT NULL ' +
    'AND st.is_active = 1 ' +
    'AND ca.start >= DATETIME_SUB(CURRENT_DATETIME(), INTERVAL 7 DAY) ' +
    'AND ca.start <= DATETIME_ADD(CURRENT_DATETIME(), INTERVAL 365 DAY) ' +
    'AND LOWER(COALESCE(st.nickname, st.protocol_number, \'\')) NOT LIKE \'%test%\' ' +
    'AND LOWER(COALESCE(st.nickname, st.protocol_number, \'\')) NOT LIKE \'%demo%\' ' +
    'AND LOWER(COALESCE(st.nickname, st.protocol_number, \'\')) NOT LIKE \'%sandbox%\' ' +
    'ORDER BY ca.start ASC';
}

// ═══════════════════════════════════════════════════════════════════
// CRIO STUDIES SYNC — replaces ClickUp CRIO_STUDIES_CSV
// Includes study_details for milestone dates + study_finance for revenue
// ═══════════════════════════════════════════════════════════════════

function syncBigQueryStudies() {
  return _syncQueryToSheet(_buildStudiesQuery(), 'BQ_Studies', 'BigQuery studies sync', null);
}

function _buildStudiesQuery() {
  var project = BQ_CONFIG.PROJECT_ID;
  var ds = BQ_CONFIG.DATASET;
  var t = '`' + project + '.' + ds + '.';

  // Pre-aggregate coordinator (most active by appt count), PI, and subject counts
  return 'WITH ' +
    'active_coords AS (SELECT ca.study_key, ca.creator_key, COUNT(*) AS appt_count FROM ' + t + 'calendar_appointment` ca WHERE ca.start >= DATETIME_SUB(CURRENT_DATETIME(), INTERVAL 90 DAY) AND ca.subject_key IS NOT NULL AND ca.creator_key IS NOT NULL GROUP BY ca.study_key, ca.creator_key), ' +
    'ranked_coords AS (SELECT study_key, creator_key, ROW_NUMBER() OVER (PARTITION BY study_key ORDER BY appt_count DESC) AS rn FROM active_coords), ' +
    'coord_best AS (SELECT study_key, creator_key AS user_key FROM ranked_coords WHERE rn = 1), ' +
    'pi_leaders AS (SELECT study_key, MIN(user_key) AS user_key FROM ' + t + 'study_user` WHERE role = 1 AND is_role_leader = 1 AND _fivetran_deleted = false GROUP BY study_key), ' +
    'sub_counts AS (SELECT study_key, COUNT(*) AS cnt FROM ' + t + 'subject` WHERE _fivetran_deleted = false GROUP BY study_key) ' +
    'SELECT ' +
    'CAST(st.study_key AS STRING) AS study_key, ' +
    'COALESCE(st.protocol_number, \'\') AS protocol_number, ' +
    'CASE WHEN COALESCE(st.nickname, \'\') != \'\' THEN st.nickname ' +
    '  WHEN spon.name IS NOT NULL AND COALESCE(st.protocol_number, \'\') != \'\' THEN CONCAT(spon.name, \' - \', st.protocol_number) ' +
    '  WHEN COALESCE(st.protocol_number, \'\') != \'\' THEN st.protocol_number ELSE \'\' END AS study_name, ' +
    'CASE st.status WHEN 0 THEN \'Pre-Site Qualification\' WHEN 1 THEN \'Site Qualification\' WHEN 2 THEN \'Start Up\' WHEN 3 THEN \'Enrolling\' WHEN 4 THEN \'Maintenance\' WHEN 5 THEN \'Closeout\' WHEN 6 THEN \'Closed\' ELSE CAST(st.status AS STRING) END AS status, ' +
    'COALESCE(CONCAT(coord_u.first_name, \' \', coord_u.last_name), \'\') AS coordinator, ' +
    'COALESCE(CONCAT(pi_u.first_name, \' \', pi_u.last_name), sd.investigator_name, \'\') AS investigator, ' +
    'COALESCE(st.indications, sd.primary_indication, \'\') AS indication, ' +
    'COALESCE(sd.specialty, \'\') AS specialty, ' +
    'COALESCE(sc.cnt, 0) AS subject_count, ' +
    'COALESCE(CAST(st.target_enrollment AS STRING), \'\') AS target_enrollment, ' +
    'COALESCE(spon.name, \'\') AS sponsor, ' +
    'CASE ct.phase WHEN 1 THEN \'Phase I\' WHEN 2 THEN \'Phase II\' WHEN 3 THEN \'Phase III\' WHEN 4 THEN \'Phase IV\' ELSE \'\' END AS phase, ' +
    'FORMAT_DATETIME(\'%Y-%m-%d\', st.date_created) AS date_created, ' +
    'FORMAT_DATETIME(\'%Y-%m-%d\', st.last_updated) AS last_updated, ' +
    'COALESCE(FORMAT_DATE(\'%Y-%m-%d\', DATE_SUB(DATE(sd.enrollment_start_date), INTERVAL 1 DAY)), \'\') AS start_date, ' +
    'COALESCE(FORMAT_DATE(\'%Y-%m-%d\', DATE_SUB(DATE(sd.enrollment_close_date), INTERVAL 1 DAY)), \'\') AS end_date, ' +
    'COALESCE(st.external_id, \'\') AS external_study_number, ' +
    'COALESCE(si.name, \'\') AS site_name, ' +
    'CAST(st.site_key AS STRING) AS site_key, ' +
    'COALESCE(CAST(sf.total_revenue AS STRING), \'0\') AS total_revenue, ' +
    'COALESCE(CAST(sf.total_randomized AS STRING), \'0\') AS revenue_subjects, ' +
    'FORMAT_DATETIME(\'%Y-%m-%d\', CURRENT_DATETIME()) AS snapshot_date ' +
    'FROM ' + t + 'study` st ' +
    'LEFT JOIN ' + t + 'sponsor` spon ON st.sponsor_key = spon.sponsor_key ' +
    'LEFT JOIN ' + t + 'site` si ON st.site_key = si.site_key ' +
    'LEFT JOIN ' + t + 'clinical_trial` ct ON st.clinical_trial_key = ct.clinical_trial_key ' +
    'LEFT JOIN ' + t + 'study_details` sd ON st.study_key = sd.study_key ' +
    'LEFT JOIN ' + t + 'study_finance` sf ON st.study_key = sf.study_key ' +
    'LEFT JOIN coord_best cb ON st.study_key = cb.study_key ' +
    'LEFT JOIN ' + t + 'user` coord_u ON cb.user_key = coord_u.user_key ' +
    'LEFT JOIN pi_leaders pl ON st.study_key = pl.study_key ' +
    'LEFT JOIN ' + t + 'user` pi_u ON pl.user_key = pi_u.user_key ' +
    'LEFT JOIN sub_counts sc ON st.study_key = sc.study_key ' +
    'WHERE st._fivetran_deleted = false AND st.is_active = 1 ' +
    'ORDER BY st.study_key';
}

// ═══════════════════════════════════════════════════════════════════
// CRIO SUBJECTS SYNC — replaces ClickUp CRIO_SUBJECTS_CSV
// ═══════════════════════════════════════════════════════════════════

function syncBigQuerySubjects() {
  return _syncQueryToSheet(_buildSubjectsQuery(), 'BQ_Subjects', 'BigQuery subjects sync', null);
}

function _buildSubjectsQuery() {
  var project = BQ_CONFIG.PROJECT_ID;
  var ds = BQ_CONFIG.DATASET;

  return 'SELECT ' +
    'CAST(sub.subject_key AS STRING) AS subject_id, ' +
    'CAST(sub.study_key AS STRING) AS study_key, ' +
    'COALESCE(st.protocol_number, \'\') AS protocol_number, ' +
    'CASE sub.status ' +
    '  WHEN 1 THEN \'Interested\' ' +
    '  WHEN 2 THEN \'Prequalified\' ' +
    '  WHEN 3 THEN \'No Show/Cancelled V1\' ' +
    '  WHEN 4 THEN \'Scheduled V1\' ' +
    '  WHEN 10 THEN \'Screening\' ' +
    '  WHEN 11 THEN \'Enrolled\' ' +
    '  WHEN 12 THEN \'Screen Fail\' ' +
    '  WHEN 13 THEN \'Discontinued\' ' +
    '  WHEN 20 THEN \'Completed\' ' +
    '  ELSE CAST(sub.status AS STRING) ' +
    'END AS status ' +
    'FROM `' + project + '.' + ds + '.subject` sub ' +
    'JOIN `' + project + '.' + ds + '.study` st ON sub.study_key = st.study_key ' +
    'WHERE sub._fivetran_deleted = false ' +
    'AND st.is_active = 1 ' +
    'ORDER BY sub.study_key, sub.subject_key';
}

// ═══════════════════════════════════════════════════════════════════
// STUDY STATUS SYNC — replaces Looker Study Status CSV
// study_details has ALL milestone dates: IRB, SIV, enrollment, etc.
// ═══════════════════════════════════════════════════════════════════

function syncBigQueryStudyStatus() {
  var HEADER_MAP = {
    'study_key': 'Study Key (Back End)', 'study_name': 'Study Name',
    'phase': 'Phase', 'status': 'Study Status',
    'enrollment_start': 'Enrollment Start Date', 'enrollment_close': 'Enrollment Close Date',
    'first_patient_screened': 'First Patient Screened Date', 'first_patient_randomized': 'First Patient Randomized Date',
    'site_initiation': 'Site Initiation Date', 'irb_approval': 'Irb Approval Date',
    'irb_renewal': 'Irb Renewal Date', 'contract_signed': 'Contract Signed Date',
    'regulatory_confirmed': 'Regulatory Confirmed Date', 'closeout': 'Closeout Date',
    'last_updated': 'Last Updated Date', 'investigator_meeting': 'Investigator Meeting Date',
    'presite_selection': 'Presite Selection Date', 'snapshot_date': 'snapshot_date'
  };
  return _syncQueryToSheet(_buildStudyStatusQuery(), 'BQ_StudyStatus', 'BigQuery study status sync', HEADER_MAP);
}

function _buildStudyStatusQuery() {
  var project = BQ_CONFIG.PROJECT_ID;
  var ds = BQ_CONFIG.DATASET;
  var t = '`' + project + '.' + ds + '.';

  return 'SELECT ' +
    'CAST(st.study_key AS STRING) AS study_key, ' +
    'CASE WHEN COALESCE(st.nickname, \'\') != \'\' THEN st.nickname ' +
    '  WHEN spon.name IS NOT NULL AND COALESCE(st.protocol_number, \'\') != \'\' THEN CONCAT(spon.name, \' - \', st.protocol_number) ' +
    '  WHEN COALESCE(st.protocol_number, \'\') != \'\' THEN st.protocol_number ELSE \'\' END AS study_name, ' +
    'CASE ct.phase WHEN 1 THEN \'Phase I\' WHEN 2 THEN \'Phase II\' WHEN 3 THEN \'Phase III\' WHEN 4 THEN \'Phase IV\' ELSE \'\' END AS phase, ' +
    'CASE st.status WHEN 0 THEN \'Pre-Site Qualification\' WHEN 1 THEN \'Site Qualification\' WHEN 2 THEN \'Start Up\' WHEN 3 THEN \'Enrolling\' WHEN 4 THEN \'Maintenance\' WHEN 5 THEN \'Closeout\' WHEN 6 THEN \'Closed\' ELSE \'\' END AS status, ' +
    // CRIO stores dates as next-day midnight UTC (e.g. Sept 19 ET → Sept 20 00:00 UTC)
    // Subtract 1 day to get the actual local date matching Looker/CRIO UI
    'COALESCE(FORMAT_DATE(\'%Y-%m-%d\', DATE_SUB(DATE(sd.enrollment_start_date), INTERVAL 1 DAY)), \'\') AS enrollment_start, ' +
    'COALESCE(FORMAT_DATE(\'%Y-%m-%d\', DATE_SUB(DATE(sd.enrollment_close_date), INTERVAL 1 DAY)), \'\') AS enrollment_close, ' +
    'COALESCE(FORMAT_DATE(\'%Y-%m-%d\', DATE_SUB(DATE(sd.first_patient_screened_date), INTERVAL 1 DAY)), \'\') AS first_patient_screened, ' +
    'COALESCE(FORMAT_DATE(\'%Y-%m-%d\', DATE_SUB(DATE(sd.first_patient_randomized_date), INTERVAL 1 DAY)), \'\') AS first_patient_randomized, ' +
    'COALESCE(FORMAT_DATE(\'%Y-%m-%d\', DATE_SUB(DATE(sd.site_initiation_date), INTERVAL 1 DAY)), \'\') AS site_initiation, ' +
    'COALESCE(FORMAT_DATE(\'%Y-%m-%d\', DATE_SUB(DATE(sd.irb_approval_date), INTERVAL 1 DAY)), \'\') AS irb_approval, ' +
    'COALESCE(FORMAT_DATE(\'%Y-%m-%d\', DATE_SUB(DATE(sd.irb_renewal_date), INTERVAL 1 DAY)), \'\') AS irb_renewal, ' +
    'COALESCE(FORMAT_DATE(\'%Y-%m-%d\', DATE_SUB(DATE(sd.contract_signed_date), INTERVAL 1 DAY)), \'\') AS contract_signed, ' +
    'COALESCE(FORMAT_DATE(\'%Y-%m-%d\', DATE_SUB(DATE(sd.regulatory_confirmed_date), INTERVAL 1 DAY)), \'\') AS regulatory_confirmed, ' +
    'COALESCE(FORMAT_DATE(\'%Y-%m-%d\', DATE_SUB(DATE(sd.closeout_date), INTERVAL 1 DAY)), \'\') AS closeout, ' +
    'COALESCE(FORMAT_DATE(\'%Y-%m-%d\', DATE(sd.last_updated)), FORMAT_DATE(\'%Y-%m-%d\', DATE(st.last_updated)), \'\') AS last_updated, ' +
    'COALESCE(FORMAT_DATE(\'%Y-%m-%d\', DATE_SUB(DATE(sd.investigator_meeting_date), INTERVAL 1 DAY)), \'\') AS investigator_meeting, ' +
    'COALESCE(FORMAT_DATE(\'%Y-%m-%d\', DATE_SUB(DATE(sd.presite_selection_date), INTERVAL 1 DAY)), \'\') AS presite_selection, ' +
    'FORMAT_DATETIME(\'%Y-%m-%d\', CURRENT_DATETIME()) AS snapshot_date ' +
    'FROM ' + t + 'study` st ' +
    'LEFT JOIN ' + t + 'study_details` sd ON st.study_key = sd.study_key ' +
    'LEFT JOIN ' + t + 'sponsor` spon ON st.sponsor_key = spon.sponsor_key ' +
    'LEFT JOIN ' + t + 'clinical_trial` ct ON st.clinical_trial_key = ct.clinical_trial_key ' +
    'WHERE st._fivetran_deleted = false AND st.is_active = 1 ' +
    'ORDER BY st.study_key';
}

// ═══════════════════════════════════════════════════════════════════
// AUDIT LOG SYNC — replaces Audit Log Google Sheet
// appointment_audit_log has all appointment changes (not just cancels)
// ═══════════════════════════════════════════════════════════════════

function syncBigQueryAuditLog() {
  var HEADER_MAP = {
    'site_name': 'Site Name', 'study_key': 'Study Key (Back End)', 'study_name': 'Study Name',
    'subject_key': 'Subject Key (Back End)', 'subject_full_name': 'Subject Full Name',
    'calendar_appointment_key': 'Calendar Appointment Key (back end)',
    'visit_name': 'Name', 'date_changed': 'Date Changed',
    'old_start': 'Old Start Time', 'new_start': 'New Start Time',
    'old_end': 'Old End Time', 'new_end': 'New End Time',
    'modified_by': 'Modified by user', 'affected_user': 'Affected user',
    'appointment_for': 'Appointment For User', 'appointment_type': 'Appointment Type',
    'change_type': 'Appointment Change Type', 'cancel_type': 'Appointment Cancellation Type',
    'cancel_reason': 'Cancel Reason'
  };
  return _syncQueryToSheet(_buildAuditLogQuery(), 'BQ_AuditLog', 'BigQuery audit log sync', HEADER_MAP);
}

function _buildAuditLogQuery() {
  var project = BQ_CONFIG.PROJECT_ID;
  var ds = BQ_CONFIG.DATASET;
  var t = '`' + project + '.' + ds + '.';

  return 'SELECT ' +
    'COALESCE(si.name, \'\') AS site_name, ' +
    'CAST(aal.study_key AS STRING) AS study_key, ' +
    'CASE WHEN COALESCE(st.nickname, \'\') != \'\' THEN st.nickname ' +
    '  WHEN spon.name IS NOT NULL AND COALESCE(st.protocol_number, \'\') != \'\' THEN CONCAT(spon.name, \' - \', st.protocol_number) ' +
    '  WHEN COALESCE(st.protocol_number, \'\') != \'\' THEN st.protocol_number ELSE \'\' END AS study_name, ' +
    'CAST(aal.subject_key AS STRING) AS subject_key, ' +
    'REGEXP_REPLACE(TRIM(CONCAT(COALESCE(sub.first_name, \'\'), \' \', COALESCE(sub.middle_name, \'\'), \' \', COALESCE(sub.last_name, \'\'))), r\'\\s+\', \' \') AS subject_full_name, ' +
    'CAST(aal.calendar_appointment_key AS STRING) AS calendar_appointment_key, ' +
    'COALESCE(sv.name, \'\') AS visit_name, ' +
    'FORMAT_DATETIME(\'%Y-%m-%d %H:%M:%S\', aal.date_created) AS date_changed, ' +
    'COALESCE(FORMAT_DATETIME(\'%Y-%m-%d %H:%M\', aal.old_start), \'\') AS old_start, ' +
    'COALESCE(FORMAT_DATETIME(\'%Y-%m-%d %H:%M\', aal.new_start), \'\') AS new_start, ' +
    'COALESCE(FORMAT_DATETIME(\'%Y-%m-%d %H:%M\', aal.old_end), \'\') AS old_end, ' +
    'COALESCE(FORMAT_DATETIME(\'%Y-%m-%d %H:%M\', aal.new_end), \'\') AS new_end, ' +
    'CONCAT(COALESCE(mod_u.first_name, \'\'), \' \', COALESCE(mod_u.last_name, \'\')) AS modified_by, ' +
    'CONCAT(COALESCE(by_u.first_name, \'\'), \' \', COALESCE(by_u.last_name, \'\')) AS affected_user, ' +
    'CONCAT(COALESCE(coord.first_name, \'\'), \' \', COALESCE(coord.last_name, \'\')) AS appointment_for, ' +
    'CASE aal.appointment_type WHEN 0 THEN \'Regular Visit\' WHEN 1 THEN \'Ad Hoc Visit\' WHEN 2 THEN \'General Appointment\' WHEN 3 THEN \'Block\' ELSE \'\' END AS appointment_type, ' +
    'CASE aal.change_type WHEN 0 THEN \'User Added\' WHEN 1 THEN \'Created\' WHEN 2 THEN \'Rescheduled\' WHEN 3 THEN \'Modified\' WHEN 4 THEN \'Cancelled\' WHEN 5 THEN \'Restored\' ELSE CAST(aal.change_type AS STRING) END AS change_type, ' +
    'CASE aal.cancel_type WHEN 1 THEN \'No Show\' WHEN 2 THEN \'Site Cancelled\' WHEN 3 THEN \'Patient Cancelled\' ELSE \'\' END AS cancel_type, ' +
    'COALESCE(REGEXP_REPLACE(aal.cancel_reason, r\'[\\x00-\\x1f]\', \' \'), \'\') AS cancel_reason ' +
    'FROM ' + t + 'appointment_audit_log` aal ' +
    'LEFT JOIN ' + t + 'study` st ON aal.study_key = st.study_key ' +
    'LEFT JOIN ' + t + 'sponsor` spon ON st.sponsor_key = spon.sponsor_key ' +
    'LEFT JOIN ' + t + 'site` si ON aal.site_key = si.site_key ' +
    'LEFT JOIN ' + t + 'subject` sub ON aal.subject_key = sub.subject_key ' +
    'LEFT JOIN ' + t + 'study_visit` sv ON aal.study_visit_key = sv.study_visit_key ' +
    'LEFT JOIN ' + t + 'user` mod_u ON aal.by_user_key = mod_u.user_key ' +
    'LEFT JOIN ' + t + 'user` by_u ON aal.by_user_key = by_u.user_key ' +
    'LEFT JOIN ' + t + 'calendar_appointment` ca ON aal.calendar_appointment_key = ca.calendar_appointment_key ' +
    'LEFT JOIN ' + t + 'user` coord ON ca.creator_key = coord.user_key ' +
    'WHERE aal.date_created >= DATETIME_SUB(CURRENT_DATETIME(), INTERVAL ' + BQ_CONFIG.LOOKBACK_DAYS + ' DAY) ' +
    'AND st.is_active = 1 ' +
    'ORDER BY aal.date_created DESC';
}

// ═══════════════════════════════════════════════════════════════════
// PATIENT DB SYNC — replaces CRIO Patient DB daily export
// patient table has full demographics + contact info
// ═══════════════════════════════════════════════════════════════════

function syncBigQueryPatientDB() {
  var HEADER_MAP = {
    'patient_full_name': 'Patient Full Name', 'patient_status': 'Patient Status',
    'email': 'Email', 'mobile_phone': 'Mobile Phone', 'home_phone': 'Home Phone',
    'work_phone': 'Work Phone', 'record_number': 'Record Number',
    'site_name': 'Site Name', 'city': 'City', 'state': 'State',
    'gender': 'Gender', 'birth_date': 'Birth Date', 'patient_key': 'Patient Key',
    'last_interaction_date': 'Last Interaction Date', 'rating': 'Rating',
    'snapshot_date': 'snapshot_date'
  };
  return _syncQueryToSheet(_buildPatientDBQuery(), 'BQ_PatientDB', 'BigQuery patient DB sync', HEADER_MAP);
}

function _buildPatientDBQuery() {
  var project = BQ_CONFIG.PROJECT_ID;
  var ds = BQ_CONFIG.DATASET;
  var t = '`' + project + '.' + ds + '.';

  return 'SELECT ' +
    'REGEXP_REPLACE(TRIM(CONCAT(COALESCE(p.first_name, \'\'), \' \', COALESCE(p.middle_name, \'\'), \' \', COALESCE(p.last_name, \'\'))), r\'\\s+\', \' \') AS patient_full_name, ' +
    'CASE p.status WHEN 0 THEN \'Available\' WHEN 1 THEN \'Not Available\' WHEN 2 THEN \'Active\' WHEN 3 THEN \'Do Not Contact\' ELSE \'Available\' END AS patient_status, ' +
    'COALESCE(p.email, \'\') AS email, ' +
    'COALESCE(p.mobile_phone, \'\') AS mobile_phone, ' +
    'COALESCE(p.home_phone, \'\') AS home_phone, ' +
    'COALESCE(p.work_phone, \'\') AS work_phone, ' +
    'COALESCE(p.patient_id, CAST(p.patient_key AS STRING)) AS record_number, ' +
    'COALESCE(si.name, \'\') AS site_name, ' +
    'COALESCE(p.city, \'\') AS city, ' +
    'COALESCE(p.state, \'\') AS state, ' +
    'CASE p.gender WHEN 0 THEN \'Unknown\' WHEN 1 THEN \'Male\' WHEN 2 THEN \'Female\' WHEN 3 THEN \'Other\' ELSE \'\' END AS gender, ' +
    'COALESCE(FORMAT_DATETIME(\'%Y-%m-%d\', p.birth_date), \'\') AS birth_date, ' +
    'CAST(p.patient_key AS STRING) AS patient_key, ' +
    'COALESCE(FORMAT_DATETIME(\'%Y-%m-%d\', p.last_interaction_date), \'\') AS last_interaction_date, ' +
    'CAST(COALESCE(p.rating, 0) AS STRING) AS rating, ' +
    'FORMAT_DATETIME(\'%Y-%m-%d\', CURRENT_DATETIME()) AS snapshot_date ' +
    'FROM ' + t + 'patient` p ' +
    'LEFT JOIN ' + t + 'site` si ON p.site_key = si.site_key ' +
    'WHERE p._fivetran_deleted = false ' +
    'AND p.status != 3 ' +  // Exclude "Do Not Contact"
    'ORDER BY p.last_name, p.first_name';
}

/**
 * Runs all syncs in sequence. Use this as the single trigger target.
 */
function syncAllBigQuery() {
  _ensureAllTriggers();
  var syncs = [
    ['Cancels', syncBigQueryCancels],
    ['Visits', syncBigQueryVisits],
    ['Studies', syncBigQueryStudies],
    ['Subjects', syncBigQuerySubjects],
    ['StudyStatus', syncBigQueryStudyStatus],
    ['AuditLog', syncBigQueryAuditLog],
    ['PatientDB', syncBigQueryPatientDB]
  ];
  var ok = 0, fail = 0;
  syncs.forEach(function(s) {
    try { s[1](); ok++; }
    catch (e) { fail++; Logger.log('SYNC FAILED: ' + s[0] + ' — ' + e.message); }
  });
  Logger.log('BQ sync complete: ' + ok + '/7 OK' + (fail ? ', ' + fail + ' failed' : ''));
}

/**
 * Auto-creates the 15-minute trigger if it doesn't exist.
 * Called at the start of syncBigQueryCancels so the trigger
 * bootstraps itself on first manual run.
 */
function _ensureSyncTrigger() {
  _ensureTriggerFor('syncBigQueryCancels');
}

function _ensureVisitsTrigger() {
  _ensureTriggerFor('syncBigQueryVisits');
}

function _ensureAllTriggers() {
  _ensureTriggerFor('syncAllBigQuery');
}

function _ensureTriggerFor(funcName) {
  try {
    var triggers = ScriptApp.getProjectTriggers();
    var hasTrigger = triggers.some(function(t) {
      return t.getHandlerFunction() === funcName;
    });
    if (!hasTrigger) {
      ScriptApp.newTrigger(funcName)
        .timeBased()
        .everyMinutes(15)
        .create();
      Logger.log('Auto-created 15-minute trigger for ' + funcName);
    }
  } catch (e) {
    Logger.log('Trigger check skipped for ' + funcName + ': ' + e.message);
  }
}

function createSyncTrigger() {
  // Remove ALL old sync triggers
  ScriptApp.getProjectTriggers().forEach(function(t) {
    var fn = t.getHandlerFunction();
    if (fn.indexOf('syncBigQuery') === 0 || fn === 'syncAllBigQuery') {
      ScriptApp.deleteTrigger(t);
    }
  });
  ScriptApp.newTrigger('syncAllBigQuery')
    .timeBased()
    .everyMinutes(15)
    .create();
  Logger.log('Trigger created: syncAllBigQuery every 15 minutes');
}

/** Check sync health — run from Apps Script editor to see status of all tabs */
function getSyncStatus() {
  var ss = SpreadsheetApp.openById(BQ_CONFIG.SHEET_ID);
  var tabs = ['BQ_Cancellations','BQ_Visits','BQ_Studies','BQ_Subjects','BQ_StudyStatus','BQ_AuditLog','BQ_PatientDB'];
  Logger.log('═══ BQ SYNC STATUS ═══');
  tabs.forEach(function(name) {
    var sheet = ss.getSheetByName(name);
    if (!sheet) { Logger.log('  ✗ ' + name + ': TAB MISSING'); return; }
    var rows = Math.max(sheet.getLastRow() - 1, 0);
    var note = sheet.getRange(1, 1).getNote() || '';
    var lastSync = note.replace('Last synced: ', '');
    var age = lastSync ? Math.round((Date.now() - new Date(lastSync).getTime()) / 60000) : '?';
    var min = MIN_ROWS[name] || 5;
    var status = rows >= min ? '✓' : '⚠';
    Logger.log('  ' + status + ' ' + name + ': ' + rows + ' rows, synced ' + age + ' min ago');
  });
  // Show triggers
  var triggers = ScriptApp.getProjectTriggers();
  var syncTriggers = triggers.filter(function(t) { return t.getHandlerFunction().indexOf('sync') >= 0; });
  Logger.log('\n  Triggers: ' + syncTriggers.length);
  syncTriggers.forEach(function(t) {
    Logger.log('    ' + t.getHandlerFunction() + ' every ' + t.getEventType());
  });
}

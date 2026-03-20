/**
 * CRP Dashboard — BigQuery Data Sync
 *
 * Two sync functions:
 *   syncBigQueryCancels()  — appointment_audit_log (change_type=4) → BQ_Cancellations tab
 *   syncBigQueryVisits()   — calendar_appointment (all statuses)   → BQ_Visits tab
 *
 * Both write to the same Google Sheet with headers matching the Looker CSV format.
 * Self-bootstrapping: first manual run auto-creates 15-minute triggers for both.
 */

var BQ_CONFIG = {
  PROJECT_ID: 'crio-468120',
  DATASET: 'crio_data',
  SHEET_ID: '1p-igO6CFkciRvJ16pUhZ3ket0WDpkhNA3d7N2AD5rcY',
  TAB_NAME: 'BQ_Cancellations',
  LOOKBACK_DAYS: 90,
  MAX_ROWS: 10000
};

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

  var tsRow = data.length + 3;
  sheet.getRange(tsRow, 1).setValue('Last synced: ' + new Date().toISOString());

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
    'CONCAT(inv.first_name, \' \', inv.last_name) AS investigator, ' +
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
    'LEFT JOIN `' + project + '.' + ds + '.user` inv ON aal.by_user_key = inv.user_key ' +
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

  var tsRow = data.length + 3;
  sheet.getRange(tsRow, 1).setValue('Last synced: ' + new Date().toISOString());

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
    // Subject Full Name
    'CONCAT(sub.first_name, \' \', sub.last_name) AS subject_full_name, ' +
    'ca.subject_key AS subject_key_back_end, ' +
    // Full Name = coordinator (creator of the appointment)
    'CONCAT(COALESCE(coord.first_name, \'\'), \' \', COALESCE(coord.last_name, \'\')) AS full_name, ' +
    // Appointment Status
    'CASE ca.status ' +
    '  WHEN 0 THEN \'Cancelled\' ' +
    '  WHEN 1 THEN \'Active\' ' +
    '  ELSE \'\' ' +
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
    // Subject ID (CRIO subject_id, not subject_key)
    'COALESCE(CAST(sub.subject_id AS STRING), \'\') AS subject_id, ' +
    // Cancel fields — populated only for cancelled appointments
    'CASE WHEN ca.status = 0 THEN FORMAT_DATETIME(\'%Y-%m-%d\', ca.date_modified) ELSE \'\' END AS cancel_date, ' +
    'CASE WHEN ca.status = 0 THEN COALESCE(REGEXP_REPLACE(ca.notes, r\'[\\x00-\\x1f]\', \' \'), \'\') ELSE \'\' END AS cancel_reason, ' +
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
    'CASE ca.appointment_type ' +
    '  WHEN 0 THEN \'Regular Visit\' ' +
    '  WHEN 1 THEN \'Ad Hoc Visit\' ' +
    '  WHEN 2 THEN \'General Appointment\' ' +
    '  WHEN 3 THEN \'Block\' ' +
    '  ELSE \'\' ' +
    'END AS appointment_type, ' +
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

/**
 * Runs both syncs in sequence. Use this as the single trigger target.
 */
function syncAllBigQuery() {
  _ensureAllTriggers();
  syncBigQueryCancels();
  syncBigQueryVisits();
  Logger.log('All BQ syncs complete');
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
  var triggers = ScriptApp.getProjectTriggers();
  triggers.forEach(function(t) {
    var fn = t.getHandlerFunction();
    if (fn === 'syncBigQueryCancels' || fn === 'syncBigQueryVisits' || fn === 'syncAllBigQuery') {
      ScriptApp.deleteTrigger(t);
    }
  });

  ScriptApp.newTrigger('syncAllBigQuery')
    .timeBased()
    .everyMinutes(15)
    .create();

  Logger.log('Trigger created: syncAllBigQuery every 15 minutes');
}

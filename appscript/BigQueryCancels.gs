/**
 * CRP Dashboard — BigQuery Cancellation Data Sync
 *
 * Queries CRIO's BigQuery dataset (appointment_audit_log table) for
 * cancellation/no-show data and writes it to a Google Sheet with the
 * SAME column headers as the existing Looker CSV.
 *
 * Data source: appointment_audit_log.change_type = 4 (Cancelled)
 * Study name: nickname if set, else sponsor.name + " - " + protocol_number
 * Staff name: calendar_appointment.creator_key → user table (fallback: aal.by_user_key)
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
}

/**
 * Auto-creates the 15-minute trigger if it doesn't exist.
 * Called at the start of syncBigQueryCancels so the trigger
 * bootstraps itself on first manual run.
 */
function _ensureSyncTrigger() {
  try {
    var triggers = ScriptApp.getProjectTriggers();
    var hasTrigger = triggers.some(function(t) {
      return t.getHandlerFunction() === 'syncBigQueryCancels';
    });
    if (!hasTrigger) {
      ScriptApp.newTrigger('syncBigQueryCancels')
        .timeBased()
        .everyMinutes(15)
        .create();
      Logger.log('Auto-created 15-minute sync trigger');
    }
  } catch (e) {
    Logger.log('Trigger check skipped: ' + e.message);
  }
}

function createSyncTrigger() {
  var triggers = ScriptApp.getProjectTriggers();
  triggers.forEach(function(t) {
    if (t.getHandlerFunction() === 'syncBigQueryCancels') {
      ScriptApp.deleteTrigger(t);
    }
  });

  ScriptApp.newTrigger('syncBigQueryCancels')
    .timeBased()
    .everyMinutes(15)
    .create();

  Logger.log('Trigger created: syncBigQueryCancels every 15 minutes');
}

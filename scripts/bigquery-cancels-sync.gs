/**
 * CRP Dashboard — BigQuery Cancellation Data Sync
 *
 * Queries CRIO's BigQuery dataset for cancellation/no-show data and writes
 * it to a Google Sheet with the SAME column headers as the existing Looker CSV.
 * This makes it a drop-in replacement — the dashboard can switch between
 * the legacy Sheet and the BQ Sheet with a single config toggle.
 *
 * SETUP:
 * 1. Open your Apps Script project (or create a new one)
 * 2. Paste this file's contents into a new .gs file
 * 3. Go to Services (+) → Add "BigQuery API" (v2)
 * 4. Set BQ_CONFIG.SHEET_ID to your target Google Sheet ID
 * 5. Run syncBigQueryCancels() manually to test
 * 6. Add a time-based trigger: Edit → Triggers → Add → syncBigQueryCancels → every 15 min
 *
 * REQUIREMENTS:
 * - The script owner must have BigQuery Reader access on project crio-468120
 * - The BigQuery API must be enabled in the linked GCP project
 * - The target Sheet must be published to web (File → Share → Publish to web)
 *
 * OUTPUT COLUMNS (matches existing Looker CSV exactly):
 *   Subject Full Name, Study Name, Study Key, Site Name, Cancel Date,
 *   Scheduled Date, Subject Key (Back End), Staff Full Name, Cancel Reason,
 *   Appointment Cancellation Type, Subject Status, Name, Appointment Type,
 *   Appointment Status, Investigator, snapshot_date
 */

var BQ_CONFIG = {
  PROJECT_ID: 'crio-468120',
  DATASET: 'crio_data',
  SHEET_ID: '', // ← SET THIS to your Google Sheet ID
  TAB_NAME: 'BQ_Cancellations',
  LOOKBACK_DAYS: 90,  // Dashboard uses 61 days, pull 90 for safety buffer
  MAX_ROWS: 10000
};

/**
 * Main sync function — call this from a trigger or manually.
 */
function syncBigQueryCancels() {
  if (!BQ_CONFIG.SHEET_ID) {
    throw new Error('BQ_CONFIG.SHEET_ID is not set. Edit the script and add your Sheet ID.');
  }

  var query = _buildCancelQuery();
  Logger.log('Running BigQuery cancel sync...');

  // Execute query
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

  // Handle pagination for large result sets
  var allRows = result.rows || [];
  while (result.pageToken) {
    result = BigQuery.Jobs.getQueryResults(BQ_CONFIG.PROJECT_ID, result.jobReference.jobId, {
      pageToken: result.pageToken,
      maxResults: BQ_CONFIG.MAX_ROWS
    });
    allRows = allRows.concat(result.rows || []);
  }

  // Get headers from schema
  var headers = result.schema.fields.map(function(f) { return f.name; });

  // Convert rows to 2D array
  var data = allRows.map(function(row) {
    return row.f.map(function(cell) { return cell.v || ''; });
  });

  // Write to Sheet
  var ss = SpreadsheetApp.openById(BQ_CONFIG.SHEET_ID);
  var sheet = ss.getSheetByName(BQ_CONFIG.TAB_NAME);
  if (!sheet) {
    sheet = ss.insertSheet(BQ_CONFIG.TAB_NAME);
  }

  sheet.clear();
  sheet.getRange(1, 1, 1, headers.length).setValues([headers]);

  if (data.length > 0) {
    sheet.getRange(2, 1, data.length, headers.length).setValues(data);
  }

  // Add sync timestamp in cell after data
  var tsRow = data.length + 3;
  sheet.getRange(tsRow, 1).setValue('Last synced: ' + new Date().toISOString());

  Logger.log('BQ Cancellations synced: ' + data.length + ' rows, ' + headers.length + ' columns');
  return data.length;
}

/**
 * Builds the BigQuery SQL query for cancellation data.
 * Uses fact_subject_visit (denormalized) joined with dimension tables for names.
 * Output columns match the existing Looker CSV headers exactly.
 */
function _buildCancelQuery() {
  var project = BQ_CONFIG.PROJECT_ID;
  var ds = BQ_CONFIG.DATASET;
  var days = BQ_CONFIG.LOOKBACK_DAYS;

  return [
    'SELECT',
    '  CONCAT(sub.first_name, \' \', sub.last_name) AS `Subject Full Name`,',
    '  st.nickname AS `Study Name`,',
    '  fsv.study_key AS `Study Key`,',
    '  si.name AS `Site Name`,',
    '',
    '  -- Cancel date: prefer appointment-level, fall back to visit-level',
    '  FORMAT_DATETIME(\'%b %e\',',
    '    COALESCE(fsv.cancel_date, fsv.subject_visit_cancel_date)',
    '  ) AS `Cancel Date`,',
    '',
    '  FORMAT_DATETIME(\'%Y-%m-%d\',',
    '    fsv.calendar_appointment_scheduled_date',
    '  ) AS `Scheduled Date`,',
    '',
    '  fsv.subject_key AS `Subject Key (Back End)`,',
    '',
    '  -- Coordinator assigned to the visit',
    '  CONCAT(coord.first_name, \' \', coord.last_name) AS `Staff Full Name`,',
    '',
    '  COALESCE(fsv.cancel_reason, fsv.subject_visit_cancel_reason, \'\') AS `Cancel Reason`,',
    '',
    '  -- Structured cancel type → matches existing CSV values',
    '  CASE COALESCE(fsv.cancel_type, fsv.subject_visit_cancel_type)',
    '    WHEN 1 THEN \'No Show\'',
    '    WHEN 2 THEN \'Site Cancelled\'',
    '    WHEN 3 THEN \'Patient Cancelled\'',
    '    ELSE \'\'',
    '  END AS `Appointment Cancellation Type`,',
    '',
    '  -- Subject enrollment status',
    '  CASE sub.status',
    '    WHEN 1  THEN \'Interested\'',
    '    WHEN 2  THEN \'Prequalified\'',
    '    WHEN 3  THEN \'No Show/Cancelled V1\'',
    '    WHEN 4  THEN \'Scheduled V1\'',
    '    WHEN 10 THEN \'Screening\'',
    '    WHEN 11 THEN \'Enrolled\'',
    '    WHEN 12 THEN \'Screen Fail\'',
    '    WHEN 13 THEN \'Discontinued\'',
    '    WHEN 20 THEN \'Completed\'',
    '    ELSE \'\'',
    '  END AS `Subject Status`,',
    '',
    '  -- Visit name (e.g. "V1/Screening", "V2/Treatment")',
    '  COALESCE(fsv.visit_name, fsv.study_visit_name, fsv.calendar_appointment_name, \'\') AS `Name`,',
    '',
    '  -- Appointment type label for categorization',
    '  CASE fsv.calendar_appointment_type',
    '    WHEN 0 THEN \'Regular Visit\'',
    '    WHEN 1 THEN \'Ad Hoc Visit\'',
    '    WHEN 2 THEN \'General Appointment\'',
    '    WHEN 3 THEN \'Block\'',
    '    ELSE \'\'',
    '  END AS `Appointment Type`,',
    '',
    '  \'cancelled\' AS `Appointment Status`,',
    '',
    '  -- Investigator assigned (bonus: not in legacy CSV)',
    '  CONCAT(inv.first_name, \' \', inv.last_name) AS `Investigator`,',
    '',
    '  FORMAT_DATETIME(\'%Y-%m-%d\', CURRENT_DATETIME()) AS `snapshot_date`',
    '',
    'FROM `' + project + '.' + ds + '.fact_subject_visit` fsv',
    '',
    'LEFT JOIN `' + project + '.' + ds + '.subject` sub',
    '  ON fsv.subject_key = sub.subject_key',
    '',
    'LEFT JOIN `' + project + '.' + ds + '.study` st',
    '  ON fsv.study_key = st.study_key',
    '',
    'LEFT JOIN `' + project + '.' + ds + '.site` si',
    '  ON fsv.site_key = si.site_key',
    '',
    'LEFT JOIN `' + project + '.' + ds + '.user` coord',
    '  ON fsv.stats_coordinator_user_key = coord.user_key',
    '',
    'LEFT JOIN `' + project + '.' + ds + '.user` inv',
    '  ON fsv.stats_investigator_user_key = inv.user_key',
    '',
    'WHERE',
    '  -- Only cancelled visits (appointment or visit-level)',
    '  (fsv.calendar_appointment_status = 0',
    '   OR fsv.subject_visit_status = 20',
    '   OR fsv.cancel_type IS NOT NULL',
    '   OR fsv.subject_visit_cancel_type IS NOT NULL)',
    '',
    '  -- Lookback window',
    '  AND COALESCE(fsv.cancel_date, fsv.subject_visit_cancel_date, fsv.calendar_appointment_scheduled_date)',
    '      >= DATETIME_SUB(CURRENT_DATETIME(), INTERVAL ' + days + ' DAY)',
    '',
    '  -- Active, real studies only',
    '  AND st.is_active = 1',
    '  AND LOWER(st.nickname) NOT LIKE \'%test%\'',
    '  AND LOWER(st.nickname) NOT LIKE \'%demo%\'',
    '  AND LOWER(st.nickname) NOT LIKE \'%sandbox%\'',
    '  AND LOWER(st.nickname) NOT LIKE \'%pre-screen%\'',
    '',
    'ORDER BY COALESCE(fsv.cancel_date, fsv.subject_visit_cancel_date) DESC'
  ].join('\n');
}

/**
 * Quick test — logs the query without running it.
 */
function testQueryPreview() {
  Logger.log(_buildCancelQuery());
}

/**
 * Setup helper — creates a time-based trigger to run every 15 minutes.
 * Run this once manually.
 */
function createSyncTrigger() {
  // Remove existing triggers for this function
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

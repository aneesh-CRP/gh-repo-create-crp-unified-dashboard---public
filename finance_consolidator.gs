// ============================================================
// CRP FINANCE DASHBOARD — Daily Data Consolidator
// ============================================================
// Folder:  Finance > Reports (updated daily)
//          Shared Drive folder ID: 1HLCDqvfhNpsm0Vcvt7yt3YgMgdlNfz3q
//
// This script finds the LATEST version of each finance report
// in the Shared Drive folder, reads its data, and writes it
// to a "CRP Finance Master" Google Sheet — one tab per report.
//
// The master sheet is published to web as CSV. The dashboard
// fetches it live on every page load.
//
// Schedule: Daily trigger at 7:30 AM EDT (after files drop)
// ============================================================

// ── CONFIGURATION ──────────────────────────────────────────
var FINANCE_FOLDER_ID = '1HLCDqvfhNpsm0Vcvt7yt3YgMgdlNfz3q';

// Map: base filename prefix → tab name in the master sheet
var REPORT_MAP = {
  'Aging_Invoices':                       'Aging_Invoices',
  'Aging_Autopay':                        'Aging_Autopay',
  'Open Accrual Unpaid Invoices':         'Unpaid_Invoices',
  'Open Accruals_Unpaid Autopay':         'Unpaid_Autopay',
  'Open Accrual Uninvoiced Invoicables':  'Uninvoiced',
  'Revenue Details':                      'Revenue',
  'Historical Payments':                  'Payments',
  'Payment Details':                      'Payment_Details',
  'Unpaid Autopay with visit date':       'Unpaid_AP_Visits',
  'Transaction Details':                  'Transactions'
};

// ── IMPORTANT: Set this to YOUR master sheet ID after creating it ──
// Create a new Google Sheet called "CRP Finance Master", then paste its ID here.
// The ID is the long string in the URL: https://docs.google.com/spreadsheets/d/YOUR_ID_HERE/edit
var MASTER_SHEET_ID = 'PASTE_YOUR_MASTER_SHEET_ID_HERE';


// ============================================================
// MAIN — runs daily via time-driven trigger
// ============================================================
function consolidateFinance() {
  Logger.log('=== CRP Finance Consolidation: ' + new Date() + ' ===');

  var folder;
  try {
    folder = DriveApp.getFolderById(FINANCE_FOLDER_ID);
    Logger.log('Folder: ' + folder.getName());
  } catch(e) {
    Logger.log('ERROR accessing folder: ' + e);
    return;
  }

  var master;
  try {
    master = SpreadsheetApp.openById(MASTER_SHEET_ID);
    Logger.log('Master sheet: ' + master.getName());
  } catch(e) {
    Logger.log('ERROR opening master sheet: ' + e);
    Logger.log('Make sure MASTER_SHEET_ID is set correctly.');
    return;
  }

  // Process each report type
  var reportNames = Object.keys(REPORT_MAP);
  var summary = [];

  for (var i = 0; i < reportNames.length; i++) {
    var baseName = reportNames[i];
    var tabName = REPORT_MAP[baseName];

    try {
      var latestFile = findLatestFile_(folder, baseName);
      if (!latestFile) {
        Logger.log('SKIP: No file found for "' + baseName + '"');
        summary.push(tabName + ': SKIPPED (no file)');
        continue;
      }

      Logger.log('Processing: ' + latestFile.getName() + ' → ' + tabName);

      var sourceSheet = SpreadsheetApp.open(latestFile);
      var sourceData = sourceSheet.getSheets()[0].getDataRange().getValues();

      if (sourceData.length === 0) {
        Logger.log('SKIP: Empty data for "' + baseName + '"');
        summary.push(tabName + ': SKIPPED (empty)');
        continue;
      }

      // Get or create the tab in master sheet
      var destSheet = master.getSheetByName(tabName);
      if (!destSheet) {
        destSheet = master.insertSheet(tabName);
        Logger.log('Created new tab: ' + tabName);
      }

      // Clear existing data and write new
      destSheet.clearContents();
      destSheet.getRange(1, 1, sourceData.length, sourceData[0].length).setValues(sourceData);

      // Add metadata in row 1 of a "meta" column
      var metaCol = sourceData[0].length + 2;
      destSheet.getRange(1, metaCol).setValue('Last Updated');
      destSheet.getRange(2, metaCol).setValue(new Date());
      destSheet.getRange(1, metaCol + 1).setValue('Source File');
      destSheet.getRange(2, metaCol + 1).setValue(latestFile.getName());

      var rowCount = sourceData.length - 1; // minus header
      Logger.log('  → ' + rowCount + ' rows written to ' + tabName);
      summary.push(tabName + ': ' + rowCount + ' rows (' + latestFile.getName() + ')');

    } catch(e) {
      Logger.log('ERROR processing "' + baseName + '": ' + e);
      summary.push(tabName + ': ERROR - ' + e.message);
    }
  }

  // Write summary to a _Log tab
  updateLog_(master, summary);

  Logger.log('=== Consolidation complete ===');
}


// ============================================================
// Find the latest file matching a base name pattern
// ============================================================
function findLatestFile_(folder, baseName) {
  // Files are named like "Aging_Invoices.csv" or "Aging_Invoices (65).csv"
  // We want the one with the highest number, or the base name if no number

  var files = folder.getFiles();
  var bestFile = null;
  var bestNum = -1;

  while (files.hasNext()) {
    var file = files.next();
    var name = file.getName();

    // Check if this file matches our base name
    // Handle: "Aging_Invoices.csv", "Aging_Invoices (65).csv",
    //         "Aging_Invoices.csv.gsheet" etc.
    if (!name.startsWith(baseName)) continue;

    // Extract the number from parentheses, if any
    var match = name.match(/\((\d+)\)/);
    var num = match ? parseInt(match[1], 10) : 0;

    if (num > bestNum) {
      bestNum = num;
      bestFile = file;
    }
  }

  return bestFile;
}


// ============================================================
// Update the log tab with run summary
// ============================================================
function updateLog_(master, summary) {
  var logSheet = master.getSheetByName('_Log');
  if (!logSheet) {
    logSheet = master.insertSheet('_Log');
    logSheet.getRange(1, 1).setValue('Run Date');
    logSheet.getRange(1, 2).setValue('Summary');
  }

  var lastRow = logSheet.getLastRow() + 1;
  logSheet.getRange(lastRow, 1).setValue(new Date());
  logSheet.getRange(lastRow, 2).setValue(summary.join('\n'));
}


// ============================================================
// ONE-TIME SETUP — Run this once to create the daily trigger
// ============================================================
function setupDailyTrigger() {
  // Delete any existing triggers for this function
  var triggers = ScriptApp.getProjectTriggers();
  for (var i = 0; i < triggers.length; i++) {
    if (triggers[i].getHandlerFunction() === 'consolidateFinance') {
      ScriptApp.deleteTrigger(triggers[i]);
    }
  }

  // Create new daily trigger at 7:30 AM
  ScriptApp.newTrigger('consolidateFinance')
    .timeBased()
    .everyDays(1)
    .atHour(7)
    .nearMinute(30)
    .inTimezone('America/New_York')
    .create();

  Logger.log('Daily trigger set for 7:30 AM EDT');
}


// ============================================================
// MANUAL RUN — Test the consolidation immediately
// ============================================================
function testRun() {
  consolidateFinance();
}

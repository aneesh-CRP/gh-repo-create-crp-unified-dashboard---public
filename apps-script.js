// ============================================================
// CLINICAL TRIAL DASHBOARD -- Daily Data Consolidator
// ============================================================
// Folder:  Automations > Looker Reports (ID hardcoded below)
// File 1:  "Upcoming scheduled appointments.csv"
// File 2:  "No show and Canceled Visits in the last 2 months.csv"
// File 3:  "Appointment Audit Log.csv"
// v7:      Column-pruning + row-filtering for Audit Log to avoid
//          Google Sheets' 10M cell limit. Only keeps the 4 columns
//          the dashboard actually uses, and only "User Added" rows.
//          Content-based dedup -- prevents duplicate rows even when
//          multiple files (PHL + PNJ) are appended on the same day.
//          Dedup keys:
//            Upcoming:      snapshot_date + Subject Full Name + Study Name + Scheduled Date
//            Cancellations: snapshot_date + Subject Full Name + Study Name + Cancel Date
//            Audit Log:     Calendar Appointment Key (back end) + Appointment For User + Appointment Change Type (GLOBAL -- no snapshot_date)
// ============================================================

var FOLDER_ID           = "13-pkMP-OK_EdPJecPRvTKpKFUv0Z-4sC";
var UPCOMING_SHEET_NAME = "Master - Upcoming";
var CANCEL_SHEET_NAME   = "Master - Cancellations";
var AUDIT_SHEET_NAME    = "Appointment Audit Log";
var UPCOMING_FILENAME   = "Upcoming scheduled appointments";
var CANCEL_FILENAME     = "No show and Canceled Visits in the last 2 months";
var AUDIT_FILENAME      = "Appointment Audit Log";
var LOG_SHEET_NAME      = "_ProcessedLog";

var EXCLUDE_STUDIES = [
  "Cardiology Pre-Scheduling",
  "MASH Pre-Screening",
  "Stress Urinary Incontinence Pre-Screening",
  "Alzheimer's disease Pre-Screening",
  "J2A-MC-GZGS",
  "J1G-MC-LAKI",
  "J3L-MC-EZEF",
  "LTS17367",
  "ATD002",
  "77242113PSO3006"
];
var FIBROSCAN_PATTERN = /fibroscan|fibrosan|fibro scan|scan only|scan visit/i;


// ============================================================
// VISIT CATEGORY
// ============================================================
function categorizeVisit(reason, apptType) {
  var r = String(reason || "").toLowerCase();
  var t = String(apptType || "").toLowerCase();

  if (t === "screen fail" || t === "screen failure")     return "Screen Fail / DNQ";
  if (t === "cancelled"   || t === "canceled")           return "Cancelled";
  if (t === "rescheduled" || t === "reschedule")         return "Rescheduled";
  if (t === "no show"     || t === "no-show")            return "No Show";

  if (/screen.?fail|screenfail|dnq|does not qualify|do not qualify|doesnt qualify|bmi|exclusion|inclusion criterion|excluded medication|not on maximum therapy|protocol criteria|autoimmune|re.screening|not qualify|doesn.t qualify/.test(r))
    return "Screen Fail / DNQ";
  if (/reschedule|will call back|call back|call us back|reach out to reschedule/.test(r) && !/no show|no-show|didn.t show/.test(r))
    return "Rescheduled";
  if (/no.?show|didn.t show|did not show|didn.t answer|didnt answer|did not answer|did not respond|no answer|mailbox full|left text|left vm|lm about|text message sent|text sent|sent text|sent a text|booked call.*no answer|delfa scheduled/.test(r))
    return "No Show";
  if (/withdrew|no longer interested|not interested|refuses to return|not satisfied|not comfortable|do not solicit|lost to follow/.test(r))
    return "Patient Withdrew";
  if (/weather|snow|\bdelay\b/.test(r))
    return "Weather";
  if (/study.?clos|visit.*clos.*study/.test(r))
    return "Study Closed";
  if (/wrong study|entered in error|scheduled in error|demo|\bltv\b|scheduled under/.test(r))
    return "Admin Error";
  if (r === "" || r === "nan" || r === "no reason provided")
    return "Not Documented";
  return "Other";
}


// ============================================================
// MAIN -- runs daily via trigger
// ============================================================
function consolidateAll() {
  Logger.log("=== CT Dashboard Consolidation: " + new Date() + " ===");

  var folder;
  try {
    folder = DriveApp.getFolderById(FOLDER_ID);
    Logger.log("Folder: " + folder.getName());
  } catch(e) {
    Logger.log("ERROR accessing folder: " + e);
    return;
  }

  var processedIds = getProcessedFileIds();
  Logger.log("Already processed: " + processedIds.size + " files");

  var allFiles = getAllSpreadsheetFiles(folder);
  Logger.log("Total files in folder: " + allFiles.length);

  var newUpcoming = [];
  var newCancels  = [];
  var newAudit    = [];
  var skipped     = 0;

  allFiles.forEach(function(file) {
    if (processedIds.has(fileCompositeKey(file))) {
      skipped++;
      return;
    }
    var baseName = file.getName().replace(/\.(csv|xlsx|xls)$/i, "").trim();
    if (baseName === UPCOMING_FILENAME) {
      newUpcoming.push(file);
    } else if (baseName === CANCEL_FILENAME) {
      newCancels.push(file);
    } else if (baseName === AUDIT_FILENAME) {
      newAudit.push(file);
    } else {
      Logger.log("Unrecognized (skipping): " + file.getName());
      markFileProcessed(file.getId(), file.getName(), "unrecognized", "");
    }
  });

  Logger.log("Skipped (already processed): " + skipped);
  Logger.log("New upcoming files: "    + newUpcoming.length);
  Logger.log("New cancellation files: " + newCancels.length);
  Logger.log("New audit log files: "   + newAudit.length);

  if (newUpcoming.length === 0 && newCancels.length === 0 && newAudit.length === 0) {
    Logger.log("Nothing new to process. Done.");
    return;
  }

  newUpcoming.forEach(function(file) { processFile(file, UPCOMING_SHEET_NAME); });
  newCancels.forEach(function(file)  { processFile(file, CANCEL_SHEET_NAME);   });
  // NOTE: Audit log is TOO LARGE for this spreadsheet (exceeds 10M cell limit).
  // The dashboard reads the audit log directly from its own published CSV.
  // Audit files are marked as processed so they don't re-appear each run.
  newAudit.forEach(function(file) {
    markFileProcessed(file.getId(), file.getName(), "skipped:audit-too-large-for-master",
      Utilities.formatDate(file.getLastUpdated(), Session.getScriptTimeZone(), "yyyy-MM-dd"));
  });

  Logger.log("=== Consolidation complete ===");
}


// ============================================================
// PROCESS ONE FILE
// ============================================================
function processFile(file, masterSheetName) {
  Logger.log("Processing: " + file.getName() + " (" + file.getId() + ")");

  var snapshotDate = Utilities.formatDate(
    file.getLastUpdated(), Session.getScriptTimeZone(), "yyyy-MM-dd"
  );
  Logger.log("Snapshot date: " + snapshotDate);

  var rows = [];
  try {
    // Audit log files skip study exclusions and visit categorization
    var isAudit = (masterSheetName === AUDIT_SHEET_NAME);
    rows = readFileRows(file, isAudit);
  } catch(e) {
    Logger.log("ERROR reading: " + e);
    markFileProcessed(file.getId(), file.getName(), "error: " + e, snapshotDate);
    return;
  }

  if (rows.length === 0) {
    Logger.log("No rows after exclusions.");
    markFileProcessed(file.getId(), file.getName(), "empty", snapshotDate);
    return;
  }

  var appended = appendRowsToMaster(masterSheetName, rows, snapshotDate);
  markFileProcessed(file.getId(), file.getName(), "ok:" + appended + " rows (+" + (rows.length - appended) + " skipped as dups)", snapshotDate);
  Logger.log("Done: " + appended + " new rows appended, " + (rows.length - appended) + " duplicates skipped.");
}


// ============================================================
// READ ROWS FROM FILE
// ============================================================
function readFileRows(file, skipExclusions) {
  var ss;
  var tempId = null;

  try {
    var mime = file.getMimeType();

    if (mime === MimeType.GOOGLE_SHEETS) {
      ss = SpreadsheetApp.openById(file.getId());
    } else {
      var meta = { title: "_ct_temp_" + file.getId(), mimeType: MimeType.GOOGLE_SHEETS };
      var converted = Drive.Files.copy(meta, file.getId());
      tempId = converted.id;
      Utilities.sleep(3000);
      ss = SpreadsheetApp.openById(tempId);
    }

    var sheet   = ss.getSheets()[0];
    var data    = sheet.getDataRange().getValues();
    if (data.length < 2) return [];

    var headers = data[0].map(function(h) { return String(h).trim(); });
    var rows    = [];

    for (var i = 1; i < data.length; i++) {
      var row = {};
      var hasData = false;
      headers.forEach(function(h, idx) {
        var val = data[i][idx];
        row[h] = (val instanceof Date)
          ? Utilities.formatDate(val, Session.getScriptTimeZone(), "yyyy-MM-dd")
          : (val !== null && val !== undefined ? String(val) : "");
        if (row[h]) hasData = true;
      });
      if (!hasData) continue;

      // Audit log rows: prune to only columns the dashboard needs
      // and pre-filter to "User Added" rows (the only change type used)
      if (skipExclusions) {
        var changeType = (row["Appointment Change Type"] || "").trim();
        if (changeType !== "User Added") continue; // dashboard only uses "User Added"
        // Keep only the 4 columns the dashboard actually reads
        var prunedRow = {
          "Calendar Appointment Key (back end)": row["Calendar Appointment Key (back end)"] || "",
          "Subject Key (Back End)": row["Subject Key (Back End)"] || "",
          "Appointment For User": row["Appointment For User"] || "",
          "Appointment Change Type": changeType
        };
        rows.push(prunedRow);
        continue;
      }

      var studyName    = row["Study Name"]    || "";
      var cancelReason = row["Cancel Reason"] || "";
      var cancelType   = row["Appointment Cancellation Type"] || "";
      if (EXCLUDE_STUDIES.indexOf(studyName) !== -1) continue;
      if (FIBROSCAN_PATTERN.test(cancelReason)) continue;
      if (FIBROSCAN_PATTERN.test(cancelType))   continue;

      if (cancelReason || cancelType) {
        row["visit_category"] = categorizeVisit(cancelReason, cancelType);
      }

      rows.push(row);
    }
    return rows;

  } finally {
    if (tempId) {
      try { DriveApp.getFileById(tempId).setTrashed(true); } catch(e) {}
    }
  }
}


// ============================================================
// APPEND TO MASTER SHEET -- with content-based dedup
// ============================================================
function appendRowsToMaster(sheetName, rows, snapshotDate) {
  var ss    = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = ss.getSheetByName(sheetName);

  if (!sheet) {
    sheet = ss.insertSheet(sheetName);
    Logger.log("Created sheet: " + sheetName);
  }

  var allHeaders = ["snapshot_date"].concat(Object.keys(rows[0]));

  if (sheet.getLastRow() === 0) {
    sheet.appendRow(allHeaders);
    var hRange = sheet.getRange(1, 1, 1, allHeaders.length);
    hRange.setFontWeight("bold").setBackground("#1e3a5f").setFontColor("#ffffff");
    sheet.setFrozenRows(1);
  }

  var sheetHeaders = sheet.getRange(1, 1, 1, sheet.getLastColumn())
                          .getValues()[0].map(String);

  // --Build existing dedup key set ------------------------------
  // Upcoming key:      snapshot_date + Subject Full Name + Study Name + Scheduled Date
  // Cancellations key: snapshot_date + Subject Full Name + Study Name + Cancel Date
  // Audit Log key:     Calendar Appointment Key (back end) + Appointment For User + Appointment Change Type
  //                    (GLOBAL dedup -- audit entries are immutable, no snapshot_date prefix)
  var isUpcoming     = sheetName === UPCOMING_SHEET_NAME;
  var isAudit        = sheetName === AUDIT_SHEET_NAME;

  var dedupCols;
  if (isAudit) {
    dedupCols = ["Calendar Appointment Key (back end)", "Appointment For User", "Appointment Change Type"];
  } else if (isUpcoming) {
    dedupCols = ["Subject Full Name", "Study Name", "Scheduled Date"];
  } else {
    dedupCols = ["Subject Full Name", "Study Name", "Cancel Date"];
  }

  var existingKeys = new Set();
  var lastRow = sheet.getLastRow();

  if (lastRow > 1) {
    var snapCol  = sheetHeaders.indexOf("snapshot_date") + 1;
    var colIdxs  = dedupCols.map(function(c) { return sheetHeaders.indexOf(c) + 1; });
    var allFound = colIdxs.every(function(idx) { return idx > 0; });

    if (allFound) {
      var existingData = sheet.getRange(2, 1, lastRow - 1, sheetHeaders.length).getValues();
      existingData.forEach(function(r) {
        // Audit log: global dedup (no snapshot_date filter -- same entry never duplicated)
        // Upcoming/Cancels: dedup within same snapshot_date only
        if (!isAudit && String(r[snapCol - 1]) !== snapshotDate) return;

        var key = isAudit ? "" : String(r[snapCol - 1]);
        colIdxs.forEach(function(idx) {
          key += "|" + String(r[idx - 1]).trim().toLowerCase();
        });
        existingKeys.add(key);
      });
    }
  }

  Logger.log("Existing dedup keys (" + (isAudit ? "global" : snapshotDate) + "): " + existingKeys.size);

  // --Filter out rows that already exist -----------------------
  var outputRows = [];
  var dupCount   = 0;

  rows.forEach(function(row) {
    var key = isAudit ? "" : snapshotDate;
    dedupCols.forEach(function(c) {
      key += "|" + String(row[c] || "").trim().toLowerCase();
    });

    if (existingKeys.has(key)) {
      dupCount++;
      return;
    }

    existingKeys.add(key); // prevent duplicates within the same batch

    outputRows.push(sheetHeaders.map(function(h) {
      if (h === "snapshot_date") return snapshotDate;
      return row[h] !== undefined ? row[h] : "";
    }));
  });

  Logger.log("Rows to append: " + outputRows.length + " | Duplicates skipped: " + dupCount);

  if (outputRows.length > 0) {
    sheet.getRange(sheet.getLastRow() + 1, 1, outputRows.length, outputRows[0].length)
         .setValues(outputRows);
  }

  return outputRows.length;
}


// ============================================================
// PROCESSED FILE LOG
// ============================================================
function getProcessedFileIds() {
  var log  = getOrCreateLogSheet();
  var ids  = new Set();
  if (log.getLastRow() < 2) return ids;
  var data = log.getRange(2, 1, log.getLastRow() - 1, 5).getValues();
  data.forEach(function(r) {
    if (r[0]) {
      var key = r[4] ? String(r[0]) + "|" + String(r[4]) : String(r[0]);
      ids.add(key);
    }
  });
  return ids;
}

function fileCompositeKey(file) {
  var modDate = Utilities.formatDate(
    file.getLastUpdated(), Session.getScriptTimeZone(), "yyyy-MM-dd"
  );
  return file.getId() + "|" + modDate;
}

function markFileProcessed(fileId, fileName, status, modifiedDate) {
  var now = Utilities.formatDate(new Date(), Session.getScriptTimeZone(), "yyyy-MM-dd HH:mm:ss");
  getOrCreateLogSheet().appendRow([fileId, fileName, now, status, modifiedDate || ""]);
}

function getOrCreateLogSheet() {
  var ss    = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = ss.getSheetByName(LOG_SHEET_NAME);
  if (!sheet) {
    sheet = ss.insertSheet(LOG_SHEET_NAME);
    sheet.appendRow(["file_id", "file_name", "processed_at", "status", "file_modified_date"]);
    sheet.getRange(1, 1, 1, 5).setFontWeight("bold")
         .setBackground("#334155").setFontColor("#ffffff");
    sheet.setColumnWidth(1, 240);
    sheet.setColumnWidth(2, 320);
    sheet.setColumnWidth(3, 160);
    sheet.setColumnWidth(4, 280);
    sheet.setColumnWidth(5, 160);
    sheet.hideSheet();
  }
  return sheet;
}


// ============================================================
// GET ALL SPREADSHEET FILES IN FOLDER
// ============================================================
function getAllSpreadsheetFiles(folder) {
  var validMimes = [
    MimeType.GOOGLE_SHEETS,
    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    "text/csv",
    "application/vnd.ms-excel"
  ];
  var files   = folder.getFiles();
  var results = [];
  while (files.hasNext()) {
    var f = files.next();
    if (validMimes.indexOf(f.getMimeType()) !== -1) results.push(f);
  }
  return results;
}


// ============================================================
// ONE-TIME CLEANUP -- removes duplicate rows from existing master
// Run this ONCE manually to clean up the historical bloat.
// Safe to run multiple times -- idempotent.
// ============================================================
function deduplicateMasterSheets() {
  var ui = SpreadsheetApp.getUi();
  var res = ui.alert(
    "[Cleanup] Deduplicate Master Sheets?",
    "This will remove duplicate rows from Master - Upcoming, Master - Cancellations, and Appointment Audit Log.\n\nThis is safe and reversible (make a backup copy first if you prefer).\n\nContinue?",
    ui.ButtonSet.YES_NO
  );
  if (res !== ui.Button.YES) return;

  _deduplicateSheet(UPCOMING_SHEET_NAME,  "Subject Full Name", "Study Name", "Scheduled Date");
  _deduplicateSheet(CANCEL_SHEET_NAME,    "Subject Full Name", "Study Name", "Cancel Date");
  _deduplicateSheet(AUDIT_SHEET_NAME,     "Calendar Appointment Key (back end)", "Appointment For User", "Appointment Change Type");

  ui.alert("[OK] Done", "Duplicate rows have been removed from all master sheets.", ui.ButtonSet.OK);
}

function _deduplicateSheet(sheetName, col1, col2, col3) {
  var ss    = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = ss.getSheetByName(sheetName);
  if (!sheet || sheet.getLastRow() < 2) {
    Logger.log(sheetName + ": nothing to deduplicate");
    return;
  }

  var data    = sheet.getDataRange().getValues();
  var headers = data[0].map(String);

  var snapIdx = headers.indexOf("snapshot_date");
  var c1Idx   = headers.indexOf(col1);
  var c2Idx   = headers.indexOf(col2);
  var c3Idx   = headers.indexOf(col3);

  var isAudit = sheetName === AUDIT_SHEET_NAME;

  // Audit log doesn't require snapshot_date for dedup (global dedup)
  if (!isAudit && snapIdx < 0) {
    Logger.log(sheetName + ": snapshot_date column not found -- skipping");
    return;
  }
  if (c1Idx < 0 || c2Idx < 0 || c3Idx < 0) {
    Logger.log(sheetName + ": required columns not found -- skipping");
    return;
  }

  var seen      = new Set();
  var keepRows  = [data[0]]; // always keep header
  var dupCount  = 0;

  for (var i = 1; i < data.length; i++) {
    var r   = data[i];
    // Audit log: global dedup without snapshot_date
    // Others: include snapshot_date in key
    var key = (isAudit ? "" : String(r[snapIdx]) + "|") +
              String(r[c1Idx]).trim().toLowerCase() + "|" +
              String(r[c2Idx]).trim().toLowerCase() + "|" +
              String(r[c3Idx]);
    if (seen.has(key)) {
      dupCount++;
    } else {
      seen.add(key);
      keepRows.push(r);
    }
  }

  Logger.log(sheetName + ": " + dupCount + " duplicates removed, " + (keepRows.length - 1) + " rows kept");

  // Clear and rewrite
  sheet.clearContents();
  sheet.getRange(1, 1, keepRows.length, keepRows[0].length).setValues(keepRows);

  // Re-apply header formatting
  sheet.getRange(1, 1, 1, headers.length)
       .setFontWeight("bold").setBackground("#1e3a5f").setFontColor("#ffffff");
  sheet.setFrozenRows(1);
}


// ============================================================
// MIGRATE AUDIT LOG -- prune columns + filter to "User Added"
// Run ONCE if the Audit Log sheet already has wide-format data.
// ============================================================
function migrateAuditLog() {
  var ss    = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = ss.getSheetByName(AUDIT_SHEET_NAME);
  if (!sheet || sheet.getLastRow() < 2) {
    Logger.log("Audit log sheet not found or empty -- nothing to migrate.");
    return;
  }

  var data    = sheet.getDataRange().getValues();
  var headers = data[0].map(String);

  var KEEP_COLS = [
    "snapshot_date",
    "Calendar Appointment Key (back end)",
    "Subject Key (Back End)",
    "Appointment For User",
    "Appointment Change Type"
  ];

  var colIdxs = KEEP_COLS.map(function(c) { return headers.indexOf(c); });
  var changeTypeIdx = headers.indexOf("Appointment Change Type");

  // If already migrated (only 5 columns), skip
  if (headers.length <= 5) {
    Logger.log("Audit log already has " + headers.length + " columns -- appears migrated.");
    return;
  }

  var keepRows = [KEEP_COLS]; // new header row
  var filtered = 0;

  for (var i = 1; i < data.length; i++) {
    var changeType = (changeTypeIdx >= 0) ? String(data[i][changeTypeIdx]).trim() : "";
    if (changeType !== "User Added") { filtered++; continue; }
    var newRow = colIdxs.map(function(idx) {
      return idx >= 0 ? data[i][idx] : "";
    });
    keepRows.push(newRow);
  }

  Logger.log("Audit migration: " + data.length + " -> " + keepRows.length + " rows (" + filtered + " non-User-Added filtered out), " + headers.length + " -> " + KEEP_COLS.length + " columns");

  // Clear and rewrite
  sheet.clearContents();
  if (keepRows.length > 0) {
    sheet.getRange(1, 1, keepRows.length, KEEP_COLS.length).setValues(keepRows);
  }
  sheet.getRange(1, 1, 1, KEEP_COLS.length)
       .setFontWeight("bold").setBackground("#1e3a5f").setFontColor("#ffffff");
  sheet.setFrozenRows(1);

  Logger.log("Audit log migration complete.");
}


// ============================================================
// DIAGNOSTIC
// ============================================================
function diagnose() {
  var ss    = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = ss.getSheetByName("Diagnosis") || ss.insertSheet("Diagnosis");
  sheet.clearContents();
  sheet.appendRow(["Check", "Result"]);
  sheet.getRange(1,1,1,2).setFontWeight("bold").setBackground("#1e3a5f").setFontColor("#ffffff");

  try {
    var folder = DriveApp.getFolderById(FOLDER_ID);
    sheet.appendRow(["Folder access", "[OK] " + folder.getName()]);

    var files = folder.getFiles();
    var count = 0;
    while (files.hasNext()) {
      var f = files.next();
      count++;
      sheet.appendRow([f.getName(), f.getMimeType() + "  |  modified: " + f.getLastUpdated()]);
    }
    sheet.appendRow(["TOTAL FILES FOUND", count]);
  } catch(e) {
    sheet.appendRow(["Folder ERROR", e.toString()]);
  }

  [UPCOMING_SHEET_NAME, CANCEL_SHEET_NAME, AUDIT_SHEET_NAME].forEach(function(name) {
    var s = ss.getSheetByName(name);
    sheet.appendRow([name, s ? s.getLastRow() + " rows" : "SHEET NOT FOUND"]);
  });

  var log = ss.getSheetByName(LOG_SHEET_NAME);
  sheet.appendRow(["_ProcessedLog", log ? log.getLastRow() + " entries" : "not created yet"]);
  sheet.autoResizeColumns(1, 2);
}


// ============================================================
// UTILITIES
// ============================================================
function showProcessedLog() { getOrCreateLogSheet().showSheet(); }

function showSummary() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  [UPCOMING_SHEET_NAME, CANCEL_SHEET_NAME, AUDIT_SHEET_NAME].forEach(function(name) {
    var s = ss.getSheetByName(name);
    if (!s || s.getLastRow() < 2) { Logger.log(name + ": no data"); return; }
    var dates  = s.getRange(2, 1, s.getLastRow()-1, 1).getValues();
    var unique = {};
    dates.forEach(function(r) { if (r[0]) unique[r[0]] = true; });
    var sorted = Object.keys(unique).sort();
    Logger.log(name + ": " + (s.getLastRow()-1) + " rows | " + sorted.length + " snapshots | " + sorted.join(", "));
  });
}

function reprocessFile(fileId, type) {
  var log  = getOrCreateLogSheet();
  var data = log.getDataRange().getValues();
  for (var i = data.length - 1; i >= 1; i--) {
    if (String(data[i][0]) === fileId) log.deleteRow(i + 1);
  }
  var sheetName = type === "cancel" ? CANCEL_SHEET_NAME :
                  type === "audit"  ? AUDIT_SHEET_NAME  :
                  UPCOMING_SHEET_NAME;
  processFile(
    DriveApp.getFileById(fileId),
    sheetName
  );
}

// Reset audit log and re-import with pruned columns
// Run this after updating the script to v7 to fix the 10M cell limit error.
function resetAndReprocessAudit() {
  var ui  = SpreadsheetApp.getUi();
  var res = ui.alert("Reset Audit Log?",
    "This will:\n1. Clear the Appointment Audit Log sheet\n2. Remove audit entries from the processed log\n3. Re-import all audit files with pruned columns (only 4 columns + snapshot_date)\n\nContinue?",
    ui.ButtonSet.YES_NO);
  if (res !== ui.Button.YES) return;

  var ss = SpreadsheetApp.getActiveSpreadsheet();

  // 1. Clear audit sheet
  var auditSheet = ss.getSheetByName(AUDIT_SHEET_NAME);
  if (auditSheet) { auditSheet.clearContents(); Logger.log("Cleared audit sheet"); }

  // 2. Remove audit entries from processed log
  var log = ss.getSheetByName(LOG_SHEET_NAME);
  if (log && log.getLastRow() > 1) {
    var logData = log.getRange(2, 1, log.getLastRow() - 1, 5).getValues();
    // Delete from bottom up so row indices stay valid
    for (var i = logData.length - 1; i >= 0; i--) {
      var fileName = String(logData[i][1] || "");
      if (fileName.indexOf(AUDIT_FILENAME) !== -1) {
        log.deleteRow(i + 2);
      }
    }
    Logger.log("Removed audit entries from processed log");
  }

  // 3. Re-run consolidateAll (will only pick up audit files now)
  consolidateAll();
  ui.alert("Done", "Audit log has been re-imported with pruned columns.", ui.ButtonSet.OK);
}

function DANGER_resetEverything() {
  var ui  = SpreadsheetApp.getUi();
  var res = ui.alert("[WARNING] RESET?", "Delete ALL data from master sheets and log?", ui.ButtonSet.YES_NO);
  if (res !== ui.Button.YES) return;
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  [UPCOMING_SHEET_NAME, CANCEL_SHEET_NAME, AUDIT_SHEET_NAME, LOG_SHEET_NAME].forEach(function(name) {
    var s = ss.getSheetByName(name);
    if (s) { s.clearContents(); Logger.log("Cleared: " + name); }
  });
  Logger.log("Reset done. Run consolidateAll() to re-import everything.");
}

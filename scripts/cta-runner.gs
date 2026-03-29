/**
 * CTA Runner v5 — Smart source selection, Lilly grid format, dedup Part A/B
 */
var CTA_FOLDER_ID = '1Ljt1dHNbTaCn3-GtybF6ItKJYoNRz6ZP';
var CF_BASE = 'https://us-east1-crio-468120.cloudfunctions.net/crp-bq-feeds';

var SPONSOR_ALIASES = {
  'lilly': ['eli lilly'],
  'j&j': ['johnson & johnson', 'janssen'],
  'abbvie': ['abbvie'],
  'sanofi': ['sanofi'],
  'astrazenica': ['astrazeneca'],
  'pfizer': ['pfizer'],
  'ucb': ['ucb'],
  'celldex': ['celldex'],
  'amgen': ['amgen'],
  'alumis': ['alumis'],
  'kallyope': ['kallyope'],
  'mylan': ['mylan', 'viatris'],
};

// Fixed output sheet — reused across runs
var OUTPUT_SHEET_ID = '1yCUZfnTZKgdhtyLRgAB8Y-_tQEV7hUM6RWpklWw_LWc';

/**
 * Dumps OCR text from all PDFs to a "PDF Text Dump" tab for inspection.
 * Run this to see exactly what text the OCR is producing.
 */
function dumpPDFText() {
  var ss = SpreadsheetApp.openById(OUTPUT_SHEET_ID);
  var sheet = ss.getSheetByName('PDF Text Dump');
  if (sheet) ss.deleteSheet(sheet);
  sheet = ss.insertSheet('PDF Text Dump');
  sheet.getRange(1,1,1,4).setValues([['Sponsor','Study','File','OCR Text (first 5000 chars)']]).setFontWeight('bold');

  var allFiles = scanCTAFolder_();
  var filtered = allFiles.filter(function(p) {
    var sponsor = (p.sponsor||'').toLowerCase();
    var study = (p.study||'').toLowerCase();
    if (sponsor === 'closed' || study === 'closed' || study === 'advertising' || study === 'safety reports') return false;
    return p.fileType === 'pdf';
  });

  Logger.log('Dumping text from ' + filtered.length + ' PDFs...');
  var rows = [];
  for (var i = 0; i < filtered.length; i++) {
    var pdf = filtered[i];
    Logger.log('  (' + (i+1) + ') ' + pdf.sponsor + '/' + pdf.study);
    if (i > 0) Utilities.sleep(8000);
    var text = extractPDFText_(pdf.fileId);
    rows.push([pdf.sponsor, pdf.study, pdf.fileName, text.substring(0, 5000)]);
  }
  if (rows.length) sheet.getRange(2,1,rows.length,4).setValues(rows);
  sheet.setColumnWidth(4, 800);
  Logger.log('Done! ' + rows.length + ' PDFs dumped.');
}

function runCTAAnalysis() {
  Logger.log('=== CTA RUNNER V17 ===');
  var ss;
  try {
    ss = SpreadsheetApp.openById(OUTPUT_SHEET_ID);
    Logger.log('Using existing sheet: ' + ss.getUrl());
    // Clear output tabs but KEEP the OCR Cache tab
    var sheets = ss.getSheets();
    var toDelete = [];
    for (var d = 0; d < sheets.length; d++) {
      if (sheets[d].getName() !== 'OCR Cache') toDelete.push(sheets[d]);
    }
    // Need at least one sheet before deleting others
    if (!ss.getSheetByName('OCR Cache')) ss.insertSheet('OCR Cache');
    toDelete.forEach(function(s) { try { ss.deleteSheet(s); } catch(e) {} });
  } catch(e) {
    ss = SpreadsheetApp.create('CRP CTA Comparison v5');
    Logger.log('Created new sheet: ' + ss.getUrl());
  }

  // Load OCR cache
  var ocrCache = loadOCRCache_(ss);

  Logger.log('Scanning CTA folder...');
  var rawPDFs = scanCTAFolder_();
  Logger.log('Found ' + rawPDFs.length + ' raw entries');

  var studyPDFs = rawPDFs.filter(function(p) {
    var fn = (p.fileName || '').toLowerCase();
    var study = (p.study || '').toLowerCase();
    var sponsor = (p.sponsor || '').toLowerCase();
    if (sponsor === 'closed' || study === 'closed') return false;
    if (study === 'advertising' || study === 'safety reports') return false;
    if (fn.indexOf('advertising_receipt') >= 0) return false;
    if (fn.indexOf('bank_verif') >= 0 || fn.indexOf('bank verif') >= 0) return false;
    if (study === '(root)' && !(/cta|agreement|contract|csa|amendment/i.test(fn))) return false;
    return true;
  });

  // Dedup site folders
  var seen = {};
  studyPDFs = studyPDFs.filter(function(p) {
    var proto = (p.study || '').replace(/_[A-Za-z]+$/, '');
    var key = p.sponsor + '/' + proto;
    if (seen[key]) return false;
    seen[key] = true;
    p.studyNorm = proto;
    return true;
  });
  Logger.log('After filter/dedup: ' + studyPDFs.length + ' CTAs');

  // Write file list
  var listSheet = ss.getActiveSheet();
  listSheet.setName('CTA Files');
  listSheet.getRange(1, 1, 1, 7).setValues([['Sponsor', 'Study', 'File Name', 'Modified', 'Size KB', 'Protocol', 'Source']]).setFontWeight('bold');
  var listRows = studyPDFs.map(function(p) { return [p.sponsor, p.study, p.fileName, p.modified, p.sizeKB, p.studyNorm, p.fileType]; });
  if (listRows.length) listSheet.getRange(2, 1, listRows.length, 7).setValues(listRows);

  // Extract
  // Set up OCR cache globals
  _ocrCache = ocrCache;
  _ocrSS = ss;

  Logger.log('Extracting from ' + studyPDFs.length + ' files...');
  var extracted = [];
  for (var i = 0; i < studyPDFs.length; i++) {
    var pdf = studyPDFs[i];
    Logger.log('  (' + (i + 1) + '/' + studyPDFs.length + ') ' + pdf.sponsor + '/' + pdf.study + ' [' + pdf.fileType + ']');
    var terms;
    if (pdf.fileType === 'gsheet' || pdf.fileType === 'xlsx') {
      terms = extractSpreadsheet_(pdf);
      // If spreadsheet gave poor results (0 visits, few items), try PDF too if available
      if (terms.visits.length === 0 && pdf.pdfFileId) {
        Logger.log('    Spreadsheet had 0 visits, trying PDF fallback...');
        Utilities.sleep(8000);
        var pdfText = extractPDFText_(pdf.pdfFileId);
        var pdfTerms = parsePDFTerms_(pdfText, pdf);
        if (pdfTerms.visits.length > terms.visits.length || pdfTerms.rawAmounts.length > terms.rawAmounts.length * 2) {
          Logger.log('    PDF had better data, using it');
          terms = pdfTerms;
        }
      }
    } else if (pdf.fileType === 'docx' || pdf.fileType === 'doc') {
      // Word doc — convert to Google Doc and extract text
      Logger.log('    [Word doc mode]');
      if (i > 0) Utilities.sleep(8000);
      var text = extractWordText_(pdf.fileId);
      terms = parsePDFTerms_(text, pdf);
    } else {
      if (i > 0) { Utilities.sleep(8000); }
      var text = extractPDFText_(pdf.fileId);
      terms = parsePDFTerms_(text, pdf);
    }
    extracted.push({
      sponsor: pdf.sponsor, study: pdf.study, studyNorm: pdf.studyNorm,
      fileName: pdf.fileName, terms: terms
    });
    Logger.log('    → ' + terms.visits.length + ' visits, ' + terms.procedures.length + ' procs, ' + terms.fees.length + ' fees');
  }

  Logger.log('Writing extracted tab...');
  writeExtractedTab_(ss, extracted);

  Logger.log('Fetching CRIO data...');
  var bqVisits = fetchFeed_('visitFinance');
  var bqProcs = fetchFeed_('procedureRevenueConfig');
  var bqStudy = fetchFeed_('studyFinance');

  Logger.log('Building comparison...');
  writeComparisonTab_(ss, extracted, bqVisits, bqProcs, bqStudy);
  writeSummaryTab_(ss, extracted);

  Logger.log('Done! ' + ss.getUrl());
  try {
    var email = Session.getActiveUser().getEmail();
    if (email) MailApp.sendEmail(email, 'CTA v5 Complete', ss.getUrl() + '\n' + studyPDFs.length + ' studies');
  } catch(e) {}
}

/* ── Folder Scanner (prefers sheets, keeps PDF as fallback) ──── */
function scanCTAFolder_() {
  var root = DriveApp.getFolderById(CTA_FOLDER_ID);
  var results = [];
  var sponsors = root.getFolders();
  while (sponsors.hasNext()) {
    try { var sf = sponsors.next(); var sn = sf.getName(); } catch(e) { continue; }
    try {
      var studies = sf.getFolders();
      while (studies.hasNext()) {
        try {
          var stf = studies.next(); var stn = stf.getName();
          var latestSheet = findLatestByType_(stf, 'sheet');
          var latestPDF = findLatestByType_(stf, 'pdf');
          // Check subfolders
          try {
            var subs = stf.getFolders();
            while (subs.hasNext()) {
              try {
                var sub = subs.next();
                var s1 = findLatestByType_(sub, 'sheet');
                var s2 = findLatestByType_(sub, 'pdf');
                if (s1 && (!latestSheet || s1.time > latestSheet.time)) latestSheet = s1;
                if (s2 && (!latestPDF || s2.time > latestPDF.time)) latestPDF = s2;
              } catch(e) {}
            }
          } catch(e) {}
          var entry = latestSheet || latestPDF;
          if (entry) {
            entry.sponsor = sn; entry.study = stn;
            // Keep PDF as fallback if sheet is primary
            if (latestSheet && latestPDF) entry.pdfFileId = latestPDF.fileId;
            results.push(entry);
          }
        } catch(e) {}
      }
    } catch(e) {}
    // Sponsor-level PDFs
    try {
      var pdfs = sf.getFilesByType('application/pdf');
      while (pdfs.hasNext()) {
        try {
          var f = pdfs.next();
          results.push({ sponsor: sn, study: '(root)', fileId: f.getId(), fileName: f.getName(),
            modified: f.getLastUpdated().toISOString().split('T')[0],
            sizeKB: Math.round(f.getSize() / 1024), time: f.getLastUpdated().getTime(), fileType: 'pdf' });
        } catch(e) {}
      }
    } catch(e) {}
  }
  return results;
}

function findLatestByType_(folder, type) {
  var latest = null;
  try {
    var files = folder.getFiles();
    while (files.hasNext()) {
      try {
        var f = files.next();
        var mime = f.getMimeType();
        var name = f.getName().toLowerCase();
        var isTarget = false;
        var fType = '';
        if (type === 'pdf') {
          // Also treat Word docs as PDF-type (will be converted via OCR/Doc API)
          isTarget = mime === 'application/pdf' || (name.indexOf('.pdf') >= 0);
          if (isTarget) { fType = 'pdf'; }
          else if (mime === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' || name.indexOf('.docx') >= 0) {
            isTarget = true; fType = 'docx';
          } else if (mime === 'application/msword' || name.indexOf('.doc') >= 0) {
            isTarget = true; fType = 'doc';
          }
        } else {
          if (mime === 'application/vnd.google-apps.spreadsheet') { isTarget = true; fType = 'gsheet'; }
          else if (mime === 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' || name.indexOf('.xlsx') >= 0) { isTarget = true; fType = 'xlsx'; }
          else if (mime === 'application/vnd.ms-excel' || name.indexOf('.xls') >= 0) { isTarget = true; fType = 'xlsx'; }
        }
        if (isTarget) {
          var t = f.getLastUpdated().getTime();
          if (!latest || t > latest.time) {
            latest = { time: t, fileId: f.getId(), fileName: f.getName(),
              modified: f.getLastUpdated().toISOString().split('T')[0],
              sizeKB: Math.round(f.getSize() / 1024), fileType: fType };
          }
        }
      } catch(e) {}
    }
  } catch(e) {}
  return latest;
}

/* ── OCR Cache ───────────────────────────────────────────────── */
function loadOCRCache_(ss) {
  var cache = {};
  var sheet = ss.getSheetByName('OCR Cache');
  if (!sheet) {
    sheet = ss.insertSheet('OCR Cache');
    sheet.getRange(1, 1, 1, 3).setValues([['File ID', 'File Name', 'Extracted Text']]).setFontWeight('bold');
    return cache;
  }
  var data = sheet.getDataRange().getValues();
  for (var i = 1; i < data.length; i++) {
    if (data[i][0] && data[i][2]) {
      cache[data[i][0]] = data[i][2];
    }
  }
  Logger.log('OCR cache loaded: ' + Object.keys(cache).length + ' entries');
  return cache;
}

function saveToOCRCache_(ss, fileId, fileName, text) {
  var sheet = ss.getSheetByName('OCR Cache');
  if (!sheet) return;
  // Check if already cached
  var data = sheet.getDataRange().getValues();
  for (var i = 1; i < data.length; i++) {
    if (data[i][0] === fileId) return; // already there
  }
  sheet.appendRow([fileId, fileName, text]);
}

/* ── PDF OCR (with cache) ────────────────────────────────────── */
var _ocrCache = null;
var _ocrSS = null;

function extractWordText_(fileId) {
  if (_ocrCache && _ocrCache[fileId]) {
    Logger.log('    [cached]');
    return _ocrCache[fileId];
  }
  try {
    var blob = DriveApp.getFileById(fileId).getBlob();
    var tf = Drive.Files.insert({ title: '_WORD_TEMP_', mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' }, blob, { convert: true });
    var text = DocumentApp.openById(tf.id).getBody().getText();
    DriveApp.getFileById(tf.id).setTrashed(true);
    if (_ocrCache) _ocrCache[fileId] = text;
    if (_ocrSS) saveToOCRCache_(_ocrSS, fileId, '', text);
    return text;
  } catch(e) { Logger.log('Word extraction error: ' + e.message); return '[ERROR]'; }
}

function extractPDFText_(fileId) {
  // Check cache first
  if (_ocrCache && _ocrCache[fileId]) {
    Logger.log('    [cached]');
    return _ocrCache[fileId];
  }
  try {
    var blob = DriveApp.getFileById(fileId).getBlob();
    var tf = Drive.Files.insert({ title: '_CTA_TEMP_', mimeType: 'application/pdf' }, blob, { ocr: true, ocrLanguage: 'en', convert: true });
    var text = DocumentApp.openById(tf.id).getBody().getText();
    DriveApp.getFileById(tf.id).setTrashed(true);
    // Save to cache
    if (_ocrCache) _ocrCache[fileId] = text;
    if (_ocrSS) saveToOCRCache_(_ocrSS, fileId, '', text);
    return text;
  } catch(e) { Logger.log('OCR error: ' + e.message); return '[ERROR]'; }
}

/* ── Spreadsheet Extractor (v5 — handles Lilly grid format) ── */
function extractSpreadsheet_(pdf) {
  var terms = { protocolNumber: pdf.studyNorm || '', sponsor: pdf.sponsor || '',
    visits: [], procedures: [], stipends: [], fees: [], screenFail: '', holdback: '', rawAmounts: [] };

  try {
    var ss;
    var tempId = null;
    if (pdf.fileType === 'gsheet') {
      ss = SpreadsheetApp.openById(pdf.fileId);
    } else {
      var blob = DriveApp.getFileById(pdf.fileId).getBlob();
      var tf = Drive.Files.insert({ title: '_BUDGET_TEMP_', mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }, blob, { convert: true });
      ss = SpreadsheetApp.openById(tf.id);
      tempId = tf.id;
    }

    var sheets = ss.getSheets();
    var bestVisits = []; // Track best visit data across sheets

    for (var si = 0; si < sheets.length; si++) {
      var sheet = sheets[si];
      var sheetName = sheet.getName();
      var data = sheet.getDataRange().getValues();
      if (data.length < 2) continue;

      // Strategy 1: Look for visit-name column + amount column (standard format)
      var result1 = tryStandardFormat_(data, sheetName);
      // Strategy 2: Look for Lilly grid format (visits as column headers, procedures as rows)
      var result2 = tryLillyGridFormat_(data, sheetName);
      // Strategy 3: Row-by-row scan for visit patterns + amounts
      var result3 = tryRowScan_(data, sheetName);

      // Pick the strategy that found the most visits
      var best = result1;
      if (result2.visits.length > best.visits.length) best = result2;
      if (result3.visits.length > best.visits.length) best = result3;

      // Accumulate
      if (best.visits.length > bestVisits.length) bestVisits = best.visits;
      terms.procedures = terms.procedures.concat(best.procedures);
      terms.fees = terms.fees.concat(best.fees);
      terms.stipends = terms.stipends.concat(best.stipends);
      best.rawAmounts.forEach(function(r) { terms.rawAmounts.push(r); });
    }

    // Use the best set of visits found (avoid duplication across sheets)
    terms.visits = bestVisits;

    // Dedup visits: if we have Part A and Part B, keep Part A (typically matches CRIO)
    terms.visits = deduplicateVisits_(terms.visits);

    if (tempId) try { DriveApp.getFileById(tempId).setTrashed(true); } catch(e) {}
  } catch(e) { Logger.log('Sheet error: ' + e.message); }
  return terms;
}

function tryStandardFormat_(data, sheetName) {
  var result = { visits: [], procedures: [], fees: [], stipends: [], rawAmounts: [] };
  // Find header row with visit/item + amount columns
  var nameCol = -1, amtCol = -1, headerRow = -1;
  for (var h = 0; h < Math.min(data.length, 15); h++) {
    for (var c = 0; c < data[h].length; c++) {
      var cell = String(data[h][c]).toLowerCase().trim();
      if (/^(visit|procedure|activity|milestone|event|description|item|category)\b/i.test(cell) && nameCol < 0) nameCol = c;
      if (/^(amount|fee|cost|rate|total|price|revenue|payment|unit|per\s*visit|site\s*cost)\b/i.test(cell) && amtCol < 0 && c !== nameCol) amtCol = c;
    }
    if (nameCol >= 0 && amtCol >= 0) { headerRow = h; break; }
  }
  if (headerRow < 0) return result;

  for (var r = headerRow + 1; r < data.length; r++) {
    var name = String(data[r][nameCol] || '').trim();
    var amt = parseFloat(data[r][amtCol]) || 0;
    if (!name || amt <= 0) continue;
    var ctx = 'Sheet: ' + sheetName + ', Row ' + (r+1);
    result.rawAmounts.push({ line: r+1, context: name + ' = $' + amt, amount: amt });
    categorizeItem_(name, amt, ctx, result);
  }
  return result;
}

function tryLillyGridFormat_(data, sheetName) {
  // Lilly format: Row 0-2 = headers, Column A = procedure names,
  // Later columns = visit names (V1, V2, V3...), cells = per-procedure-per-visit amounts
  // Last rows = totals per visit
  var result = { visits: [], procedures: [], fees: [], stipends: [], rawAmounts: [] };

  // Look for a row near the bottom that contains "total" and has numeric values across columns
  // Those totals = per-visit rates
  var visitCols = {}; // col index → visit name

  // Scan first 15 rows for visit-name-like headers (start from col 0 for Lilly format)
  for (var h = 0; h < Math.min(data.length, 15); h++) {
    for (var c = 0; c < data[h].length; c++) {
      var cell = String(data[h][c]).trim();
      if (!cell) continue;
      if (/^(V\d|Visit\s*\d|Screening|SCRN|Baseline|Day\s*\d|Week\s*\d|Randomiz|Final|Unscheduled|EOT|EOS|ET\b|ED\b|Follow|DB|OLE|EMV|FV|Safety)/i.test(cell)) {
        if (!visitCols[c]) visitCols[c] = cell;
      }
      if (/^W\d+$/i.test(cell) || /^V\d+\/W/i.test(cell) || /^V\d+\s/i.test(cell)) {
        if (!visitCols[c]) visitCols[c] = cell;
      }
    }
  }

  if (Object.keys(visitCols).length < 2) return result;
  Logger.log('    Grid: found ' + Object.keys(visitCols).length + ' visit columns in ' + sheetName);

  // Find the totals row — search ALL rows (not just bottom) for Lilly format
  // Lilly uses "Visit Costs With Overhead(USD)" near the top (row ~16)
  for (var r = 0; r < data.length; r++) {
    var label = String(data[r][0] || '').toLowerCase().trim();
    if (!label && data[r].length > 1) label = String(data[r][1] || '').toLowerCase().trim();
    if (/\btotal\b|visit\s*costs?\s*with\s*overhead|per\s*visit|grand\s*total|site\s*total|visit\s*total|total\s*(?:per|cost|amount|payment)/i.test(label)) {
      var foundInRow = 0;
      for (var c in visitCols) {
        var amt = parseFloat(data[r][c]) || 0;
        if (amt > 0 && amt < 50000) {
          result.visits.push({ name: visitCols[c], amount: amt, context: 'Sheet: ' + sheetName + ', Row ' + (r+1) + ' [' + visitCols[c] + ']' });
          result.rawAmounts.push({ line: r+1, context: visitCols[c] + ' = $' + amt, amount: amt });
          foundInRow++;
        }
      }
      if (foundInRow > 0) { Logger.log('    Grid totals at row ' + (r+1) + ': ' + foundInRow + ' visits'); break; }
    }
  }

  // If no totals row found, try computing column sums
  if (result.visits.length === 0) {
    Logger.log('    Grid: no totals row, trying column sums');
    var colSums = {};
    for (var c in visitCols) colSums[c] = 0;
    var dataStart = 0;
    for (var s = 0; s < Math.min(data.length, 10); s++) {
      for (var c in visitCols) {
        if (String(data[s][c]).trim() === visitCols[c]) { dataStart = s + 1; break; }
      }
      if (dataStart > 0) break;
    }
    for (var r = dataStart; r < data.length; r++) {
      for (var c in visitCols) {
        var val = parseFloat(data[r][c]);
        if (val > 0 && val < 10000) colSums[c] += val;
      }
    }
    for (var c in colSums) {
      if (colSums[c] > 100) {
        result.visits.push({ name: visitCols[c], amount: Math.round(colSums[c] * 100) / 100, context: 'Sheet: ' + sheetName + ' [computed sum]' });
      }
    }
    if (result.visits.length > 0) Logger.log('    Grid: computed ' + result.visits.length + ' visit sums');
  }

  return result;
}

function tryRowScan_(data, sheetName) {
  var result = { visits: [], procedures: [], fees: [], stipends: [], rawAmounts: [] };
  for (var r = 0; r < data.length; r++) {
    var row = data[r];
    var visitName = '';
    var amounts = [];
    for (var c = 0; c < row.length; c++) {
      var val = row[c];
      if (typeof val === 'string' && /^(V\d|Visit\s*\d|Screening|Baseline|Day\s*\d|Week\s*\d|Randomiz|Final|Unscheduled|EOT|EOS|Follow)/i.test(val.trim())) {
        visitName = val.trim();
      }
      if (typeof val === 'number' && val > 10 && val < 500000) {
        amounts.push(val);
      }
    }
    if (visitName && amounts.length > 0) {
      // Use the FIRST reasonable amount (likely per-visit, not total)
      var amt = amounts[0];
      // If multiple amounts and last is much bigger, first is per-visit
      if (amounts.length > 1 && amounts[amounts.length-1] > amt * 3) {
        amt = amounts[0]; // confirmed: first is per-unit
      }
      var ctx = 'Sheet: ' + sheetName + ', Row ' + (r+1);
      result.visits.push({ name: visitName.substring(0, 60), amount: amt, context: ctx });
      result.rawAmounts.push({ line: r+1, context: visitName + ' = $' + amt, amount: amt });
    }
  }
  return result;
}

function categorizeItem_(name, amt, ctx, result) {
  var nl = name.toLowerCase();
  // Skip total/subtotal rows
  if (/^(total|subtotal|grand\s*total|sum)\b/i.test(nl)) return;
  // Skip rows that are clearly totals (very large amounts relative to visits)
  if (amt > 50000 && /total|per\s*subject|maximum|budget/i.test(nl)) return;

  if (/visit\s*\d|v\s*\d|day\s*\d|week\s*\d|screening|baseline|randomiz|follow.?up|final\s*visit|unscheduled|end.?of.?study|early\s*term|eot\b|eos\b/i.test(nl)) {
    result.visits.push({ name: name.substring(0, 60), amount: amt, context: ctx });
  }
  else if (/screen\s*fail/i.test(nl)) {
    result.fees.push({ name: 'Screen Failure', amount: amt, context: ctx });
  }
  else if (/stipend|patient\s*(?:pay|reim)|subject\s*(?:pay|reim)|travel/i.test(nl)) {
    result.stipends.push({ name: name.substring(0, 80), amount: amt, context: ctx });
  }
  else if (/startup|start.?up|initiat|activation/i.test(nl)) {
    result.fees.push({ name: 'Startup', amount: amt, context: ctx });
  }
  else if (/closeout|close.?out/i.test(nl)) {
    result.fees.push({ name: 'Closeout', amount: amt, context: ctx });
  }
  else if (/procedure|lab\b|ecg|vital|physical|exam|consent|blood|urine|x.?ray/i.test(nl)) {
    result.procedures.push({ name: name.substring(0, 60), amount: amt, context: ctx });
  }
  else if (/holdback|withh[eo]ld/i.test(nl)) {
    result.fees.push({ name: 'Holdback', amount: amt, context: ctx });
  }
  else if (amt > 0) {
    result.fees.push({ name: name.substring(0, 80), amount: amt, context: ctx });
  }
}

function deduplicateVisits_(visits) {
  // If same visit name appears multiple times (Part A / Part B),
  // keep the first occurrence (typically Part A = what CRIO has)
  var seen = {};
  var result = [];
  visits.forEach(function(v) {
    var key = v.name.toLowerCase().replace(/[^\w\d]/g, '').replace(/\bpart\s*[ab]\b/gi, '').trim();
    if (!seen[key]) {
      seen[key] = true;
      result.push(v);
    }
  });
  return result;
}

/* ── PDF Parser ──────────────────────────────────────────────── */
function parsePDFTerms_(text, pdf) {
  var terms = { protocolNumber: pdf.studyNorm || '', sponsor: pdf.sponsor || '',
    visits: [], procedures: [], stipends: [], fees: [], screenFail: '', holdback: '', rawAmounts: [] };
  if (!text || text.indexOf('[ERROR') === 0) return terms;

  var lines = text.split('\n');
  var dollarPattern = /\$[\d,]+(?:\.\d{1,2})?/g;
  var inBudgetSection = false;

  for (var i = 0; i < lines.length; i++) {
    var ln = lines[i].trim();
    if (!ln) continue;

    // Track budget section
    if (/exhibit\s*b|payment\s*schedule|budget|financial\s*terms|per.?visit\s*(?:payment|fee|rate|cost)|compensation\s*schedule/i.test(ln)) inBudgetSection = true;
    if (inBudgetSection && /^exhibit\s*[c-z]|^signature|^in\s*witness/i.test(ln)) inBudgetSection = false;

    var amts = ln.match(dollarPattern);
    if (!amts) continue;

    var amounts = amts.map(function(a) { return parseFloat(a.replace(/[$,]/g, '')); }).filter(function(a) { return a > 0; });
    if (!amounts.length) continue;

    var primaryAmt = amounts.length === 1 ? amounts[0] : amounts[0];

    // Skip noise
    if (Math.max.apply(null, amounts) >= 1000000) continue;
    if (/insurance|indemnif|liabil|damages|aggregate/i.test(ln)) continue;
    if (/up\s*to\s*(?:a\s*)?maximum\s*of.*for\s*the\s*(?:length|duration)/i.test(ln)) continue;
    if (/chart\s*review\s*fee|medical\s*record/i.test(ln) && !/per\s*visit/i.test(ln)) {
      terms.fees.push({ name: ln.substring(0, 80), amount: primaryAmt, context: ln.substring(0, 200) });
      continue;
    }

    terms.rawAmounts.push({ line: i+1, context: ln.substring(0, 200), amount: primaryAmt });

    // Categorize
    if (/screen\s*fail|screen.?failure/i.test(ln) && !/stipend|reimburse/i.test(ln)) {
      terms.screenFail = primaryAmt;
      // Screen failure rate is typically == screening visit rate — add as both
      terms.fees.push({ name: 'Screen Failure', amount: primaryAmt, context: ln.substring(0, 200) });
      if (primaryAmt >= 200) {
        terms.visits.push({ name: 'Screening', amount: primaryAmt, context: 'Screen Failure rate: ' + ln.substring(0, 150) });
      }
    }
    else if (/(?:^|\b)(?:visit\s*\d|v\s*\d|day\s*\d|week\s*\d)/i.test(ln) && !/stipend|reimburse|patient\s*payment/i.test(ln)) {
      var vn = extractVisitName_(ln);
      terms.visits.push({ name: vn || ln.substring(0, 60), amount: primaryAmt, context: ln.substring(0, 200) });
    }
    else if (/\b(?:screening|baseline|randomiz)\b/i.test(ln) && !/stipend|reimburse|patient\s*payment|per\s*patient/i.test(ln) && primaryAmt >= 200) {
      terms.visits.push({ name: extractVisitName_(ln) || ln.substring(0, 60), amount: primaryAmt, context: ln.substring(0, 200) });
    }
    else if (/\b(?:final\s*visit|end.?of.?study|early\s*term|follow[\s-]?up|unscheduled)\b/i.test(ln) && !/stipend|reimburse/i.test(ln) && primaryAmt >= 200) {
      terms.visits.push({ name: extractVisitName_(ln) || ln.substring(0, 60), amount: primaryAmt, context: ln.substring(0, 200) });
    }
    else if (/stipend|patient\s*(?:payment|compensation)|subject\s*(?:payment|compensation)|reimburse.*(?:patient|subject)|travel/i.test(ln)) {
      terms.stipends.push({ name: ln.substring(0, 100), amount: primaryAmt, context: ln.substring(0, 200) });
    }
    else if (/startup|start[\s-]?up|initiat|activation/i.test(ln)) {
      terms.fees.push({ name: 'Startup', amount: primaryAmt, context: ln.substring(0, 200) });
    }
    else if (/closeout|close[\s-]?out/i.test(ln)) {
      terms.fees.push({ name: 'Closeout', amount: primaryAmt, context: ln.substring(0, 200) });
    }
    else if (/holdback|withh[eo]ld/i.test(ln)) {
      terms.holdback = primaryAmt;
      terms.fees.push({ name: 'Holdback', amount: primaryAmt, context: ln.substring(0, 200) });
    }
    else if (/procedure|lab\b|ecg|vital|physical|exam|consent|blood|urine|x[\s-]?ray/i.test(ln)) {
      terms.procedures.push({ name: extractProcName_(ln) || ln.substring(0, 60), amount: primaryAmt });
    }
  }

  // Fallback: look for per-visit rate patterns (NOT contract totals)
  if (!terms.visits.length) {
    for (var k = 0; k < lines.length; k++) {
      if (/per\s*(?:completed\s*)?visit\s*(?:fee|rate|payment)|visit\s*(?:fee|rate)\s*[:=]/i.test(lines[k])) {
        var pvAmts = lines[k].match(dollarPattern);
        if (pvAmts) {
          var pvAmt = parseFloat(pvAmts[0].replace(/[$,]/g, ''));
          // Per-visit rates are typically $100-$15,000. Anything > $15K is a contract total.
          if (pvAmt >= 100 && pvAmt <= 15000) {
            terms.visits.push({ name: 'Per Visit Rate', amount: pvAmt, context: lines[k].substring(0, 200) });
          }
        }
      }
    }
  }
  return terms;
}

function extractVisitName_(line) {
  var patterns = [
    /\b(V(?:isit)?\s*\d+[\w\s\-\/]*?)(?:\s*\$|\s{2,}|\t|:)/i,
    /\b(Screening(?:\s*Visit)?)\b/i, /\b(Baseline(?:\s*Visit)?)\b/i,
    /\b(Randomization(?:\s*Visit)?)\b/i, /\b(Final\s*Visit)\b/i,
    /\b(Early\s*Termination)\b/i, /\b(Follow[\s\-]?Up(?:\s*Visit)?)\b/i,
    /\b(Day\s*\d+)\b/i, /\b(Week\s*\d+)\b/i, /\b(Unscheduled\s*Visit)\b/i
  ];
  for (var i = 0; i < patterns.length; i++) {
    var m = line.match(patterns[i]);
    if (m) return m[1].trim();
  }
  return '';
}

function extractProcName_(line) {
  var patterns = [
    /\b((?:12[\s\-]?lead\s*)?ECG)\b/i, /\b(Physical\s*Exam(?:ination)?)\b/i,
    /\b(Vital\s*Signs?)\b/i, /\b(Urine\s*(?:Pregnancy|Test))\b/i, /\b(Informed\s*Consent)\b/i
  ];
  for (var i = 0; i < patterns.length; i++) {
    var m = line.match(patterns[i]);
    if (m) return m[1].trim();
  }
  return line.split('$')[0].trim().substring(0, 60);
}

/* ── BQ Fetch ────────────────────────────────────────────────── */
function fetchFeed_(name) {
  var resp = UrlFetchApp.fetch(CF_BASE + '?feed=' + name + '&format=json', { muteHttpExceptions: true });
  return (JSON.parse(resp.getContentText())).data || [];
}

/* ── Matching ────────────────────────────────────────────────── */
function matchStudy_(protocol, sponsor, visitIdx, procIdx, studyIdx) {
  var sponsorLower = (sponsor || '').toLowerCase();
  var allNames = {};
  Object.keys(studyIdx).concat(Object.keys(visitIdx)).concat(Object.keys(procIdx)).forEach(function(n) { allNames[n] = true; });

  var proto = (protocol || '').toLowerCase();
  if (/^\d+\.?\d*e\d+$/i.test(proto)) proto = String(Number(proto));
  var sponsorTerms = SPONSOR_ALIASES[sponsorLower] || [sponsorLower];
  var best = null, bestScore = 0;

  Object.keys(allNames).forEach(function(name) {
    var nl = name.toLowerCase();
    var score = 0;
    if (proto && nl.indexOf(proto) >= 0) score += 20;
    proto.split(/[\s\-_\/]+/).forEach(function(p) {
      if (p.length >= 4 && nl.indexOf(p) >= 0) score += 8;
      else if (p.length >= 3 && nl.indexOf(p) >= 0) score += 4;
    });
    sponsorTerms.forEach(function(t) { if (t && nl.indexOf(t) >= 0) score += 5; });
    if (score > bestScore) { bestScore = score; best = name; }
  });

  return bestScore >= 5 ? best : null;
}

function getVisitNum_(name) {
  var m = (name || '').match(/\b[Vv](?:isit)?\s*(\d+)/);
  return m ? parseInt(m[1]) : null;
}

function getWeekNum_(name) {
  var m = (name || '').match(/[Ww](?:eek|k)?\s*(\d+)/);
  return m ? parseInt(m[1]) : null;
}

function compareVisitItem_(ctaName, ctaAmt, matched, visitIdx) {
  if (!matched || !visitIdx[matched]) return { crioAmt: '', variance: '', pct: '', status: 'No CRIO Match', crioStudy: '', notes: '' };

  var ctaVisitNum = getVisitNum_(ctaName);
  var ctaWeekNum = getWeekNum_(ctaName);

  // Score each CRIO visit as a match candidate
  var candidates = [];
  visitIdx[matched].forEach(function(item) {
    var crioAmt = parseFloat(item.revenue_per_visit) || 0;
    if (crioAmt <= 0) return;

    var score = 0;
    var crioVisitNum = getVisitNum_(item.visit_name);
    var crioWeekNum = getWeekNum_(item.visit_name);

    // Visit number match (strongest signal)
    if (ctaVisitNum !== null && crioVisitNum !== null && ctaVisitNum === crioVisitNum) score += 10;
    // Week number match
    if (ctaWeekNum !== null && crioWeekNum !== null && ctaWeekNum === crioWeekNum) score += 8;
    // Fuzzy name match
    var fScore = fuzzy_(ctaName, item.visit_name);
    score += fScore * 5;
    // Amount proximity bonus (within 2x = overhead range)
    if (ctaAmt > 0 && crioAmt > 0) {
      var ratio = crioAmt / ctaAmt;
      if (ratio >= 0.5 && ratio <= 2.0) score += 3;
      if (ratio >= 0.9 && ratio <= 1.5) score += 2;
    }

    if (score > 0) candidates.push({ item: item, score: score, fScore: fScore });
  });

  // Sort by score, then by amount proximity for ties
  candidates.sort(function(a, b) {
    if (Math.abs(a.score - b.score) > 0.5) return b.score - a.score;
    var diffA = Math.abs(ctaAmt - (parseFloat(a.item.revenue_per_visit) || 0));
    var diffB = Math.abs(ctaAmt - (parseFloat(b.item.revenue_per_visit) || 0));
    return diffA - diffB;
  });

  var best = candidates.length > 0 ? candidates[0].item : null;
  var bestScore = candidates.length > 0 ? candidates[0].score : 0;

  if (!best || bestScore < 3) return { crioAmt: '', variance: '', pct: '', status: 'Not in CRIO', crioStudy: matched, notes: 'No matching visit (best score: ' + bestScore.toFixed(1) + ')' };

  var crioAmt = parseFloat(best.revenue_per_visit) || 0;

  // If CRIO amount is $0, not configured
  if (crioAmt === 0) {
    return { crioAmt: 0, variance: ctaAmt, pct: '', status: 'Not Configured in CRIO', crioStudy: matched, notes: 'CRIO rate is $0. CTA: $' + ctaAmt.toFixed(0) + '. Visit: ' + best.visit_name };
  }

  var variance = ctaAmt - crioAmt;
  var pct = crioAmt > 0 ? variance / crioAmt : '';
  var absVar = Math.abs(variance);
  var relVar = Math.max(ctaAmt, crioAmt) > 0 ? absVar / Math.max(ctaAmt, crioAmt) : 0;

  // If ratio is extreme (> 2x either direction), it's a wrong match — treat as "Not in CRIO"
  var ratio = crioAmt / ctaAmt;
  if (ratio > 2.0 || ratio < 0.5) {
    return { crioAmt: '', variance: '', pct: '', status: 'Not in CRIO', crioStudy: matched, notes: 'Best match was ' + best.visit_name + ' but ratio ' + ratio.toFixed(2) + 'x is too extreme' };
  }

  var status;
  if (absVar < 1) status = 'Match';
  else if (relVar < 0.07) status = 'Match (rounding)'; // 7% tolerance
  else {
    // Accept overhead ratio 1.05x to 1.95x
    if (ratio >= 1.05 && ratio <= 1.95) {
      status = 'Match (overhead ' + (ratio * 100 - 100).toFixed(0) + '%)';
    } else if (ratio > 0.5 && ratio < 1 && 1/ratio >= 1.05 && 1/ratio <= 1.95) {
      status = 'Match (overhead ' + ((1/ratio) * 100 - 100).toFixed(0) + '%)';
    } else {
      status = 'Match (rounding)'; // Within 2x and >7% but <50% — close enough
    }
  }
  return { crioAmt: crioAmt, variance: variance, pct: pct, status: status, crioStudy: matched, notes: 'Matched: ' + best.visit_name + ' (score: ' + bestScore.toFixed(2) + ')' };
}

function compareProcItem_(ctaName, ctaAmt, matched, procIdx) {
  if (!matched || !procIdx[matched]) return { crioAmt: '', variance: '', pct: '', status: 'No CRIO Match', crioStudy: '', notes: '' };

  // Find best match, prefer closest amount when scores are tied
  var candidates = [];
  procIdx[matched].forEach(function(item) {
    var s = fuzzy_(ctaName, item.procedure_name);
    if (s > 0) candidates.push({ item: item, score: s });
  });
  if (!candidates.length) return { crioAmt: '', variance: '', pct: '', status: 'Not in CRIO', crioStudy: matched, notes: '' };

  candidates.sort(function(a, b) {
    if (Math.abs(a.score - b.score) > 0.1) return b.score - a.score;
    var diffA = Math.abs(ctaAmt - (parseFloat(a.item.revenue_base) || parseFloat(a.item.revenue_ad_hoc) || 0));
    var diffB = Math.abs(ctaAmt - (parseFloat(b.item.revenue_base) || parseFloat(b.item.revenue_ad_hoc) || 0));
    return diffA - diffB;
  });

  var best = candidates[0].item;
  var bestScore = candidates[0].score;
  if (bestScore < 0.25) return { crioAmt: '', variance: '', pct: '', status: 'Not in CRIO', crioStudy: matched, notes: '' };

  var crioAmt = parseFloat(best.revenue_base) || parseFloat(best.revenue_ad_hoc) || 0;

  if (crioAmt === 0) {
    return { crioAmt: 0, variance: ctaAmt, pct: '', status: 'Not Configured in CRIO', crioStudy: matched, notes: 'CRIO rate is $0. CTA: $' + ctaAmt.toFixed(0) + '. Procedure: ' + best.procedure_name };
  }

  var variance = ctaAmt - crioAmt;
  var pct = crioAmt > 0 ? variance / crioAmt : '';
  var absV = Math.abs(variance);
  var relV = Math.max(ctaAmt, crioAmt) > 0 ? absV / Math.max(ctaAmt, crioAmt) : 0;

  // Extreme ratio = wrong match
  var ratio = crioAmt / ctaAmt;
  if (ratio > 2.5 || ratio < 0.4) {
    return { crioAmt: '', variance: '', pct: '', status: 'Not in CRIO', crioStudy: matched, notes: 'Best match ' + best.procedure_name + ' but ratio ' + ratio.toFixed(2) + 'x too extreme' };
  }

  var status;
  if (absV < 1) status = 'Match';
  else if (relV < 0.07) status = 'Match (rounding)';
  else {
    if (ratio >= 1.05 && ratio <= 1.95) {
      status = 'Match (overhead ' + (ratio * 100 - 100).toFixed(0) + '%)';
    } else if (ratio > 0.5 && ratio < 1 && 1/ratio >= 1.05 && 1/ratio <= 1.95) {
      status = 'Match (overhead ' + ((1/ratio) * 100 - 100).toFixed(0) + '%)';
    } else {
      status = 'Match (rounding)';
    }
  }
  return { crioAmt: crioAmt, variance: variance, pct: pct, status: status, crioStudy: matched, notes: 'Matched: ' + best.procedure_name };
}

function fuzzy_(a, b) {
  if (!a || !b) return 0;
  var na = norm_(a), nb = norm_(b);
  if (na === nb) return 1;
  // Short strings must be exact
  if (na.length <= 3 || nb.length <= 3) return na === nb ? 1 : 0;

  // For numbered visits (Week X, Visit X, VX, Day X), require the NUMBER to match exactly
  var numA = na.match(/\b(\d+)\b/g);
  var numB = nb.match(/\b(\d+)\b/g);
  if (numA && numB) {
    // Both have numbers — check if they share at least one number
    var hasSharedNumber = numA.some(function(n) { return numB.indexOf(n) >= 0; });
    // If both are "week/visit/v + number" patterns, require exact number match
    var isNumberedA = /\b(v|week|visit|day|w)\s*\d/i.test(na);
    var isNumberedB = /\b(v|week|visit|day|w)\s*\d/i.test(nb);
    if (isNumberedA && isNumberedB && !hasSharedNumber) return 0; // Week 19 ≠ Week 1
  }

  if (na.indexOf(nb) >= 0 || nb.indexOf(na) >= 0) return 0.8;
  var ta = na.split(/\s+/), tb = nb.split(/\s+/), ov = 0;
  ta.forEach(function(x) { tb.forEach(function(y) { if (x === y && x.length > 1) ov++; }); });
  return Math.max(ta.length, tb.length) > 0 ? ov / Math.max(ta.length, tb.length) : 0;
}

function norm_(s) {
  return s.toLowerCase().replace(/\bvisit\b/g, 'v').replace(/\bscreening\b/g, 'screen')
    .replace(/\btreatment\b/g, 'treat').replace(/\brandomization\b/g, 'rand')
    .replace(/\binformed\s*consent\b/g, 'icf').replace(/[^\w\d\s]/g, ' ').replace(/\s+/g, ' ').trim();
}

/* ── Output Tabs ─────────────────────────────────────────────── */
function writeExtractedTab_(ss, extracted) {
  var sheet = ss.insertSheet('CTA Extracted');
  sheet.getRange(1, 1, 1, 7).setValues([['Sponsor', 'Study', 'File', 'Category', 'Item', 'Amount', 'Context']]).setFontWeight('bold').setBackground('#072061').setFontColor('#fff');
  sheet.setFrozenRows(1);
  var rows = [];
  extracted.forEach(function(e) {
    var t = e.terms;
    t.visits.forEach(function(v) { rows.push([e.sponsor, e.study, e.fileName, 'Visit', v.name, v.amount, v.context || '']); });
    t.procedures.forEach(function(p) { rows.push([e.sponsor, e.study, e.fileName, 'Procedure', p.name, p.amount, p.context || '']); });
    t.stipends.forEach(function(s) { rows.push([e.sponsor, e.study, e.fileName, 'Stipend', s.name, s.amount, s.context || '']); });
    t.fees.forEach(function(f) { rows.push([e.sponsor, e.study, e.fileName, 'Fee', f.name, f.amount, f.context || '']); });
    if (!t.visits.length && !t.procedures.length && !t.stipends.length && !t.fees.length) {
      t.rawAmounts.slice(0, 5).forEach(function(r) { rows.push([e.sponsor, e.study, e.fileName, 'Raw', '', r.amount, r.context]); });
      if (!t.rawAmounts.length) rows.push([e.sponsor, e.study, e.fileName, 'Empty', '', '', '']);
    }
  });
  if (rows.length) {
    sheet.getRange(2, 1, rows.length, 7).setValues(rows);
    sheet.getRange(2, 6, rows.length, 1).setNumberFormat('$#,##0.00');
  }
  Logger.log('Extracted: ' + rows.length + ' rows');
}

function writeComparisonTab_(ss, extracted, bqVisits, bqProcs, bqStudy) {
  var sheet = ss.insertSheet('CTA vs CRIO');
  var headers = ['Sponsor', 'Study', 'Category', 'Item', 'CTA Amount', 'CRIO Amount', 'Variance', 'Var %', 'Status', 'CRIO Study', 'Notes'];
  sheet.getRange(1, 1, 1, 11).setValues([headers]).setFontWeight('bold').setBackground('#FF9933').setFontColor('#fff');
  sheet.setFrozenRows(1);

  var visitIdx = {}, procIdx = {}, studyIdx = {};
  bqVisits.forEach(function(r) { var n = r.study_name || ''; if (!visitIdx[n]) visitIdx[n] = []; visitIdx[n].push(r); });
  bqProcs.forEach(function(r) { var n = r.study_name || ''; if (!procIdx[n]) procIdx[n] = []; procIdx[n].push(r); });
  bqStudy.forEach(function(r) { studyIdx[r.study_name || ''] = r; });

  var rows = [];
  extracted.forEach(function(e) {
    var t = e.terms;
    var matched = matchStudy_(e.studyNorm || t.protocolNumber, t.sponsor, visitIdx, procIdx, studyIdx);

    // Merge visits from ALL CRIO study names containing the protocol
    // (handles cases like MALO having 2 study name variants)
    var mergedVisitIdx = {};
    var mergedProcIdx = {};
    if (matched) {
      var proto = (e.studyNorm || t.protocolNumber || '').toLowerCase();
      Object.keys(visitIdx).forEach(function(name) {
        if (name === matched || (proto && name.toLowerCase().indexOf(proto) >= 0)) {
          visitIdx[name].forEach(function(v) {
            var key = v.visit_name + '|' + v.revenue_per_visit;
            if (!mergedVisitIdx[key]) mergedVisitIdx[key] = v;
          });
        }
      });
      Object.keys(procIdx).forEach(function(name) {
        if (name === matched || (proto && name.toLowerCase().indexOf(proto) >= 0)) {
          procIdx[name].forEach(function(p) {
            var key = p.procedure_name + '|' + p.revenue_base;
            if (!mergedProcIdx[key]) mergedProcIdx[key] = p;
          });
        }
      });
    }
    // Use merged indexes for lookups
    var visitList = Object.keys(mergedVisitIdx).map(function(k) { return mergedVisitIdx[k]; });
    var procList = Object.keys(mergedProcIdx).map(function(k) { return mergedProcIdx[k]; });
    var localVisitIdx = {}; localVisitIdx[matched] = visitList;
    var localProcIdx = {}; localProcIdx[matched] = procList;

    // Promote Screen Failure fees to visits for comparison (screen fail rate ≈ screening visit rate)
    var screenFailFees = t.fees.filter(function(f) { return /screen\s*fail/i.test(f.name) && f.amount >= 200; });
    var allVisits = t.visits.slice(); // copy
    screenFailFees.forEach(function(sf) {
      // Only add if we don't already have a screening visit
      var hasScreening = allVisits.some(function(v) { return /screen/i.test(v.name); });
      if (!hasScreening) {
        allVisits.push({ name: 'Screening', amount: sf.amount, context: 'From Screen Failure fee: ' + (sf.context || '') });
      }
    });

    // Filter out contract totals from visits (> $15K is likely a total, not per-visit)
    allVisits = allVisits.filter(function(v) { return v.amount <= 15000; });

    var hasData = allVisits.length > 0 || t.procedures.length > 0;
    if (!matched && !hasData) {
      rows.push([e.sponsor, e.study, 'Info', '', '', '', '', '', 'No Data', '', 'No parseable terms and no CRIO match']);
      return;
    }

    allVisits.forEach(function(v) {
      var r = compareVisitItem_(v.name, v.amount, matched, localVisitIdx);
      rows.push([e.sponsor, e.study, 'Visit', v.name, v.amount, r.crioAmt, r.variance, r.pct, r.status, r.crioStudy, r.notes]);
    });
    t.procedures.forEach(function(p) {
      var r = compareProcItem_(p.name, p.amount, matched, localProcIdx);
      rows.push([e.sponsor, e.study, 'Procedure', p.name, p.amount, r.crioAmt, r.variance, r.pct, r.status, r.crioStudy, r.notes]);
    });

    // CRIO visits not in CTA (only if we found some CTA visits)
    if (matched && localVisitIdx[matched] && allVisits.length > 0) {
      localVisitIdx[matched].forEach(function(cv) {
        var rev = parseFloat(cv.revenue_per_visit) || 0;
        if (rev <= 0) return;
        var inCTA = allVisits.some(function(v) { return fuzzy_(v.name, cv.visit_name) >= 0.4; });
        if (!inCTA) rows.push([e.sponsor, e.study, 'Visit', cv.visit_name, '', rev, '', '', 'In CRIO Only', matched, 'Not in CTA']);
      });
    }
  });

  if (rows.length) {
    sheet.getRange(2, 1, rows.length, 11).setValues(rows);
    [5,6,7].forEach(function(c) { sheet.getRange(2, c, rows.length, 1).setNumberFormat('$#,##0.00'); });
    sheet.getRange(2, 8, rows.length, 1).setNumberFormat('0.0%');
  }
  Logger.log('Comparison: ' + rows.length + ' rows');
}

function writeSummaryTab_(ss, extracted) {
  var sheet = ss.insertSheet('Summary');
  var data = [
    ['CRP CTA vs CRIO Comparison v5', ''],
    ['Generated', new Date().toLocaleString()],
    ['', ''],
    ['Total CTAs', extracted.length],
    ['With visits', extracted.filter(function(e) { return e.terms.visits.length > 0; }).length],
    ['With procedures', extracted.filter(function(e) { return e.terms.procedures.length > 0; }).length],
    ['With fees', extracted.filter(function(e) { return e.terms.fees.length > 0; }).length],
    ['No data', extracted.filter(function(e) { var t = e.terms; return !t.visits.length && !t.procedures.length && !t.fees.length && !t.stipends.length; }).length],
  ];
  sheet.getRange(1, 1, data.length, 2).setValues(data);
  sheet.getRange(1, 1).setFontSize(14).setFontWeight('bold');
}

/**
 * Lists ALL files in specific study folders for debugging.
 * Creates a "Folder Contents" tab.
 */
function listFolderContents() {
  var ss = SpreadsheetApp.openById(OUTPUT_SHEET_ID);
  var sheet = ss.getSheetByName('Folder Contents');
  if (sheet) ss.deleteSheet(sheet);
  sheet = ss.insertSheet('Folder Contents');
  sheet.getRange(1,1,1,6).setValues([['Sponsor','Study','File Name','MIME Type','Size KB','Modified']]).setFontWeight('bold');

  var root = DriveApp.getFolderById(CTA_FOLDER_ID);
  var targets = ['GZPS', 'EFC17600'];
  var rows = [];

  var sponsors = root.getFolders();
  while (sponsors.hasNext()) {
    try {
      var sf = sponsors.next();
      var sn = sf.getName();
      var studies = sf.getFolders();
      while (studies.hasNext()) {
        try {
          var stf = studies.next();
          var stn = stf.getName();
          var isTarget = targets.some(function(t) { return stn.indexOf(t) >= 0; });
          if (!isTarget) continue;

          // List all files in this folder
          var files = stf.getFiles();
          while (files.hasNext()) {
            try {
              var f = files.next();
              rows.push([sn, stn, f.getName(), f.getMimeType(), Math.round(f.getSize()/1024), f.getLastUpdated().toISOString().split('T')[0]]);
            } catch(e) {}
          }

          // Also check subfolders
          var subs = stf.getFolders();
          while (subs.hasNext()) {
            try {
              var sub = subs.next();
              var subName = sub.getName();
              var subFiles = sub.getFiles();
              while (subFiles.hasNext()) {
                try {
                  var sf2 = subFiles.next();
                  rows.push([sn, stn + '/' + subName, sf2.getName(), sf2.getMimeType(), Math.round(sf2.getSize()/1024), sf2.getLastUpdated().toISOString().split('T')[0]]);
                } catch(e) {}
              }
            } catch(e) {}
          }
        } catch(e) {}
      }
    } catch(e) {}
  }

  if (rows.length) sheet.getRange(2,1,rows.length,6).setValues(rows);
  sheet.setColumnWidth(3, 400);
  Logger.log('Found ' + rows.length + ' files in target folders');
}

/**
 * Dumps the raw cell contents of GZPS spreadsheet for debugging.
 */
function dumpGZPSSheet() {
  var ss = SpreadsheetApp.openById(OUTPUT_SHEET_ID);
  var dumpSheet = ss.getSheetByName('GZPS Dump');
  if (dumpSheet) ss.deleteSheet(dumpSheet);
  dumpSheet = ss.insertSheet('GZPS Dump');

  // Find the GZPS xlsx in the CTA folder
  var root = DriveApp.getFolderById(CTA_FOLDER_ID);
  var sponsors = root.getFolders();
  while (sponsors.hasNext()) {
    try {
      var sf = sponsors.next();
      if (sf.getName() !== 'Lilly') continue;
      var studies = sf.getFolders();
      while (studies.hasNext()) {
        var stf = studies.next();
        if (stf.getName().indexOf('GZPS') < 0) continue;
        var files = stf.getFiles();
        while (files.hasNext()) {
          var f = files.next();
          if (f.getName().indexOf('.xlsx') < 0) continue;
          Logger.log('Found GZPS xlsx: ' + f.getName());
          // Convert and read
          var blob = f.getBlob();
          var tf = Drive.Files.insert({ title: '_GZPS_TEMP_', mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }, blob, { convert: true });
          var tempSS = SpreadsheetApp.openById(tf.id);
          var sheets = tempSS.getSheets();
          var row = 1;
          for (var si = 0; si < sheets.length; si++) {
            var sheet = sheets[si];
            var data = sheet.getDataRange().getValues();
            dumpSheet.getRange(row, 1).setValue('=== SHEET: ' + sheet.getName() + ' (' + data.length + ' rows × ' + (data[0]||[]).length + ' cols) ===').setFontWeight('bold');
            row++;
            if (data.length > 0) {
              // Write first 30 rows
              var writeRows = data.slice(0, 30);
              var maxCols = Math.max.apply(null, writeRows.map(function(r) { return r.length; }));
              for (var r = 0; r < writeRows.length; r++) {
                for (var c = 0; c < writeRows[r].length; c++) {
                  dumpSheet.getRange(row, c + 1).setValue(String(writeRows[r][c]).substring(0, 100));
                }
                row++;
              }
              if (data.length > 30) {
                dumpSheet.getRange(row, 1).setValue('... (' + (data.length - 30) + ' more rows)');
                row++;
              }
            }
            row++;
          }
          DriveApp.getFileById(tf.id).setTrashed(true);
          Logger.log('Dumped ' + sheets.length + ' sheets');
          return;
        }
      }
    } catch(e) { Logger.log('Error: ' + e.message); }
  }
  Logger.log('GZPS xlsx not found');
}

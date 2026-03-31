/**
 * Scans Completed Studies folder — resolves shortcuts via REST API
 * Run: scanCompletedStudies()
 * No Advanced Services required
 */

function scanCompletedStudies() {
  var targetFolder = DriveApp.getFolderById('198OI9SQbLbjcUqFCqhicDGEajVgrbqzx');
  Logger.log('Found folder: ' + targetFolder.getName());

  var allFiles = [];
  var files = targetFolder.getFiles();
  var token = ScriptApp.getOAuthToken();

  while (files.hasNext()) {
    var file = files.next();
    var mime = file.getMimeType();
    var fileId = file.getId();
    var fileName = file.getName();

    // Resolve shortcuts using REST API
    if (mime === 'application/vnd.google-apps.shortcut') {
      try {
        var resp = UrlFetchApp.fetch(
          'https://www.googleapis.com/drive/v3/files/' + fileId + '?fields=shortcutDetails,name',
          { headers: { 'Authorization': 'Bearer ' + token }, muteHttpExceptions: true }
        );
        var meta = JSON.parse(resp.getContentText());
        if (meta.shortcutDetails && meta.shortcutDetails.targetId) {
          var targetId = meta.shortcutDetails.targetId;
          // Get target file info
          var resp2 = UrlFetchApp.fetch(
            'https://www.googleapis.com/drive/v3/files/' + targetId + '?fields=name,mimeType',
            { headers: { 'Authorization': 'Bearer ' + token }, muteHttpExceptions: true }
          );
          var targetMeta = JSON.parse(resp2.getContentText());
          fileId = targetId;
          mime = targetMeta.mimeType || 'unknown';
          fileName = targetMeta.name || fileName;
          Logger.log('Resolved: ' + file.getName() + ' -> ' + fileName + ' (' + mime + ')');
        }
      } catch(e) {
        Logger.log('Shortcut failed: ' + fileName + ' — ' + e.message);
        allFiles.push({ name: fileName, type: 'shortcut-failed', id: fileId, error: e.message });
        continue;
      }
    }

    allFiles.push({ name: fileName, type: mime, id: fileId });
  }

  Logger.log('Resolved ' + allFiles.length + ' files');
  var typeMap = {};
  allFiles.forEach(function(f) { typeMap[f.type] = (typeMap[f.type]||0) + 1; });
  Logger.log('Types: ' + JSON.stringify(typeMap));

  // Create output
  var ss = SpreadsheetApp.create('CRP — Master Study Config (' + new Date().toLocaleDateString() + ')');
  var listSheet = ss.getActiveSheet();
  listSheet.setName('Files');
  var listRows = [['File Name', 'MIME Type', 'ID']];
  allFiles.forEach(function(f) { listRows.push([f.name, f.type, f.id]); });
  listSheet.getRange(1, 1, listRows.length, 3).setValues(listRows);
  listSheet.getRange(1, 1, 1, 3).setFontWeight('bold').setBackground('#072061').setFontColor('#fff');

  // Read Google Sheets + Google Docs
  var defSheet = ss.insertSheet('Study Data');
  var defRows = [['Source File', 'Study Code', 'Tab', 'Row', 'Content']];

  allFiles.forEach(function(f) {
    if (f.type === 'shortcut-failed') return;

    var studyCode = f.name
      .replace(/^CRP[\s\-]*/i, '')
      .replace(/[\s\-]*study definition.*$/i, '')
      .replace(/[\s\-]*Stitch.*$/i, '')
      .replace(/^Clinical Research Philadelphia[\s\-]*/i, '')
      .replace(/[\s\-]*\d{1,2}\s+\w+\s+\d{4}.*$/i, '')
      .replace(/[\s\-]*queries.*$/i, '')
      .replace(/[\s\-]*survey.*$/i, '')
      .replace(/\.xlsx?$/i, '')
      .replace(/\s*\(.*\)\s*$/, '')
      .trim();

    try {
      if (f.type === 'application/vnd.google-apps.spreadsheet') {
        var wb = SpreadsheetApp.openById(f.id);
        wb.getSheets().forEach(function(tab) {
          var data = tab.getDataRange().getValues();
          for (var r = 0; r < Math.min(data.length, 200); r++) {
            var rowStr = data[r].map(function(c) { return String(c||'').trim(); }).filter(function(c) { return c; }).join(' | ');
            if (rowStr) defRows.push([f.name, studyCode, tab.getName(), r+1, rowStr]);
          }
        });
        Logger.log('Read Sheet: ' + f.name);
      }
      else if (f.type === 'application/vnd.google-apps.document') {
        var doc = DocumentApp.openById(f.id);
        var lines = doc.getBody().getText().split('\n').filter(function(l) { return l.trim(); });
        for (var r = 0; r < Math.min(lines.length, 300); r++) {
          defRows.push([f.name, studyCode, 'Doc', r+1, lines[r].trim()]);
        }
        Logger.log('Read Doc: ' + f.name);
      }
      else {
        Logger.log('Skipped: ' + f.name + ' (' + f.type + ')');
      }
    } catch(e) {
      Logger.log('ERROR reading: ' + f.name + ' — ' + e.message);
      defRows.push([f.name, studyCode, 'ERROR', 0, e.message]);
    }
  });

  if (defRows.length > 1) {
    defSheet.getRange(1, 1, defRows.length, defRows[0].length).setValues(defRows);
  }
  defSheet.getRange(1, 1, 1, defRows[0].length).setFontWeight('bold').setBackground('#072061').setFontColor('#fff');
  defSheet.setFrozenRows(1);

  // Keyword detection
  var kwSheet = ss.insertSheet('Keywords');
  var kwRows = [['Source File', 'Study Code', 'Row', 'Keyword', 'Content']];
  var keywords = {
    'fasting': ['fasting','fasted','fast ','npo','nil per os','empty stomach','hour fast'],
    'lab/blood': ['blood draw','blood sample','central lab','clinical lab','phlebotomy','hba1c','lipid','glucose','metabolic'],
    'stipend': ['stipend','reimburs','compensation','payment to patient','gift card'],
    'visit window': ['visit window','window of','days before','days after','plus or minus','+/-'],
    'diet': ['diet','meal','food restriction','eat','water only','clear liquid'],
    'drug/dosing': ['study drug','investigational product','ip admin','dosing','injection site'],
    'washout': ['washout','wash-out','run-in','lead-in'],
  };

  defRows.forEach(function(row) {
    if (row[0] === 'Source File') return;
    var lo = (row[4]||'').toLowerCase();
    for (var cat in keywords) {
      for (var k = 0; k < keywords[cat].length; k++) {
        if (lo.indexOf(keywords[cat][k]) >= 0) {
          kwRows.push([row[0], row[1], row[3], cat, row[4].substring(0, 300)]);
          break;
        }
      }
    }
  });

  if (kwRows.length > 1) {
    kwSheet.getRange(1, 1, kwRows.length, kwRows[0].length).setValues(kwRows);
  }
  kwSheet.getRange(1, 1, 1, kwRows[0].length).setFontWeight('bold').setBackground('#dc2626').setFontColor('#fff');
  kwSheet.setFrozenRows(1);

  ss.getSheets().forEach(function(s) {
    for (var i = 1; i <= 5; i++) try { s.autoResizeColumn(i); } catch(e) {}
  });

  Logger.log('DONE! ' + ss.getUrl());
  Logger.log('Files: ' + allFiles.length + ' | Content rows: ' + (defRows.length-1) + ' | Keyword matches: ' + (kwRows.length-1));
}

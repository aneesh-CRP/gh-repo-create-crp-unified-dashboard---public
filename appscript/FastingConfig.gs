/**
 * Creates a Google Sheet with all study visits for fasting configuration.
 * Run this once from the Apps Script editor: Extensions > Apps Script > Run createFastingConfigSheet
 */
function createFastingConfigSheet() {
  var ss = SpreadsheetApp.create('CRP — Fasting Visit Configuration');
  var sheet = ss.getActiveSheet();
  sheet.setName('Fasting Config');

  // Fetch visit finance data from cloud function
  var url = 'https://us-east1-crio-468120.cloudfunctions.net/crp-bq-feeds?feed=visitFinance&format=json';
  var response = UrlFetchApp.fetch(url);
  var data = JSON.parse(response.getContentText()).data || [];

  // Build rows
  var rows = [['Study Code', 'Sponsor', 'Visit Name', 'Revenue/Visit', 'Patient Stipend', 'Fasting Required?', 'Notes']];
  var studies = {};

  data.forEach(function(r) {
    var name = r.study_name || '';
    var parts = name.split(' - ');
    var code = parts.length > 1 ? parts[parts.length - 1].trim() : name;
    var sponsor = parts.length > 1 ? parts[0].trim() : '';
    var visit = r.visit_name || '';
    var rpv = parseFloat(r.revenue_per_visit) || 0;
    var stip = parseFloat(r.patient_stipend) || 0;
    if (!code || !visit || rpv <= 0) return;
    var key = code + '|' + visit;
    if (studies[key]) return; // dedup
    studies[key] = true;
    rows.push([code, sponsor, visit, Math.round(rpv), Math.round(stip), '', '']);
  });

  // Sort by study code then visit name
  var header = rows.shift();
  rows.sort(function(a, b) { return (a[0] + a[2]).localeCompare(b[0] + b[2]); });
  rows.unshift(header);

  // Write to sheet
  sheet.getRange(1, 1, rows.length, rows[0].length).setValues(rows);

  // Format header
  var headerRange = sheet.getRange(1, 1, 1, rows[0].length);
  headerRange.setFontWeight('bold');
  headerRange.setBackground('#072061');
  headerRange.setFontColor('#FFFFFF');
  sheet.setFrozenRows(1);

  // Format Fasting column with dropdown validation
  var fastingRange = sheet.getRange(2, 6, rows.length - 1, 1);
  var rule = SpreadsheetApp.newDataValidation()
    .requireValueInList(['Yes', 'No', ''], true)
    .build();
  fastingRange.setDataValidation(rule);

  // Conditional formatting: green for Yes, red for blank with revenue > $1000
  var greenRule = SpreadsheetApp.newConditionalFormatRule()
    .whenTextEqualTo('Yes')
    .setBackground('#dcfce7')
    .setRanges([fastingRange])
    .build();
  var noRule = SpreadsheetApp.newConditionalFormatRule()
    .whenTextEqualTo('No')
    .setBackground('#fee2e2')
    .setRanges([fastingRange])
    .build();
  sheet.setConditionalFormatRules([greenRule, noRule]);

  // Auto-resize columns
  for (var i = 1; i <= rows[0].length; i++) {
    sheet.autoResizeColumn(i);
  }

  // Add instructions sheet
  var instrSheet = ss.insertSheet('Instructions');
  instrSheet.getRange('A1').setValue('CRP Fasting Visit Configuration');
  instrSheet.getRange('A1').setFontSize(16).setFontWeight('bold');
  instrSheet.getRange('A3').setValue('How to use:');
  instrSheet.getRange('A4').setValue('1. Go to the "Fasting Config" tab');
  instrSheet.getRange('A5').setValue('2. For each visit, set "Fasting Required?" to Yes or No');
  instrSheet.getRange('A6').setValue('3. Only visits marked "Yes" will show a fasting badge on the dashboard schedule');
  instrSheet.getRange('A7').setValue('4. Publish this sheet: File → Share → Publish to web → CSV format');
  instrSheet.getRange('A8').setValue('5. Copy the published URL and add it to the dashboard config');
  instrSheet.getRange('A10').setValue('The dashboard will check this sheet and show a 🩸 Fasting badge next to matching visits.');

  Logger.log('Created fasting config sheet: ' + ss.getUrl());
  SpreadsheetApp.getUi().alert('Fasting Config Sheet Created!\n\n' + ss.getUrl());
}

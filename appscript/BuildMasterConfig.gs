/**
 * Builds a Master Study Configuration sheet from:
 * 1. Scanned study definitions (Google Sheets + Docs)
 * 2. CRIO BQ data (visitFinance, procedureRevenue, fasting config)
 * 3. ClickUp study master list
 *
 * Run: buildMasterStudyConfig()
 */

function buildMasterStudyConfig() {
  var CF_BASE = 'https://us-east1-crio-468120.cloudfunctions.net/crp-bq-feeds';

  // Fetch all data sources
  Logger.log('Fetching data sources...');

  var visitFinance = JSON.parse(UrlFetchApp.fetch(CF_BASE + '?feed=visitFinance&format=json').getContentText()).data || [];
  Logger.log('visitFinance: ' + visitFinance.length + ' rows');

  var procRevenue = JSON.parse(UrlFetchApp.fetch(CF_BASE + '?feed=procedureRevenue&format=json').getContentText()).data || [];
  Logger.log('procedureRevenue: ' + procRevenue.length + ' rows');

  var studyFinance = JSON.parse(UrlFetchApp.fetch(CF_BASE + '?feed=studyFinance&format=json').getContentText()).data || [];
  Logger.log('studyFinance: ' + studyFinance.length + ' rows');

  var masterList = JSON.parse(UrlFetchApp.fetch(CF_BASE + '?feed=studyMasterList&format=json').getContentText()).data || [];
  Logger.log('studyMasterList: ' + masterList.length + ' rows');

  var revenue = JSON.parse(UrlFetchApp.fetch(CF_BASE + '?feed=revenue&format=json').getContentText()).data || [];
  Logger.log('revenue: ' + revenue.length + ' rows');

  // Fasting config (hardcoded in dashboard — replicate here)
  var FASTING = {
    'D7960C00015': { hours: 8, visits: 'ALL', note: 'AZURE-Outcomes' },
    'J3F-MC-EZCC': { hours: 8, visits: 'ALL', note: 'SOLARIS-1' },
    'C4951063': { hours: 8, visits: 'ALL', note: 'Rimegepant' },
    'M23-714': { hours: 8, visits: 'ALL', note: 'Ubrogepant' },
    '20230222': { hours: 9, visits: 'SPECIFIC', note: 'OCEAN(a) — not Lp(a)' },
    'N1T-MC-MALO': { hours: 8, visits: 'SPECIFIC', note: 'SYNERGY — 8hr blood, 4hr FibroScan' },
    'M23-698': { hours: 8, visits: 'SPECIFIC', note: 'Upadacitinib HS — lipid panels' },
    'M20-465': { hours: 8, visits: 'SPECIFIC', note: 'Lutikizumab HS — lipid panels' },
    'M24-601': { hours: 8, visits: 'SPECIFIC', note: 'SWITCH-UP AD' },
    'J2A-MC-GZPS': { hours: 8, visits: 'SPECIFIC', note: 'Orforglipron SUI' },
    'MR-130A': { hours: 8, visits: 'SPECIFIC', note: 'Birth Control Patch — Screening + EOS' },
    '88545223PSA2001': { hours: 8, visits: 'SPECIFIC', note: 'VELOTA — W0/W12/W16 lipids' },
  };
  var NO_FASTING = ['EFC17599','J3L-MC-EZEF','D6973C00001','ATD002','K-304'];

  // Build study map
  var studies = {};

  // From studyMasterList (ClickUp)
  masterList.forEach(function(r) {
    var code = r.study || '';
    if (!code) return;
    studies[code] = {
      code: code,
      status: r.status || '',
      sponsor: r.sponsor || '',
      pi: r.pi || '',
      coordinator: r.primary_coordinator || '',
      backup_coordinator: r.backup_coordinator || '',
      site: r.site || '',
      therapeutic_area: r.therapeutic_area || '',
      start_date: r.start_date || '',
      esource: r.crio_esource || '',
    };
  });

  // From revenue (CRIO)
  revenue.forEach(function(r) {
    var name = (r.study_name || '').trim();
    var parts = name.split(' - ');
    var code = parts.length > 1 ? parts[parts.length-1].trim() : name;
    if (!studies[code]) studies[code] = { code: code };
    studies[code].crio_name = name;
    studies[code].total_revenue = parseFloat(r.total_revenue) || 0;
    studies[code].total_paid = parseFloat(r.total_revenue_paid) || 0;
    studies[code].projected = parseFloat(r.projected_revenue) || 0;
  });

  // From studyFinance
  studyFinance.forEach(function(r) {
    var name = (r.study_name || '').trim();
    var parts = name.split(' - ');
    var code = parts.length > 1 ? parts[parts.length-1].trim() : name;
    if (!studies[code]) studies[code] = { code: code };
    studies[code].invoice_count = parseInt(r.invoice_count) || 0;
    studies[code].invoice_unpaid = parseFloat(r.invoice_unpaid) || 0;
    studies[code].stipend_per_patient = parseFloat(r.stipend_per_patient) || 0;
    studies[code].revenue_per_visit = parseFloat(r.revenue_per_visit) || 0;
  });

  // Fasting
  Object.keys(studies).forEach(function(code) {
    var s = studies[code];
    var fc = null;
    for (var fk in FASTING) {
      if (code.indexOf(fk) >= 0) { fc = FASTING[fk]; break; }
    }
    var noFast = NO_FASTING.some(function(nf) { return code.indexOf(nf) >= 0; });
    s.fasting = fc ? fc.hours + 'hr (' + fc.visits + ')' : noFast ? 'No' : '';
    s.fasting_note = fc ? fc.note : '';
  });

  // Visit counts and stipend info from visitFinance
  var visitsByStudy = {};
  visitFinance.forEach(function(r) {
    var name = (r.study_name || '').trim();
    var parts = name.split(' - ');
    var code = parts.length > 1 ? parts[parts.length-1].trim() : name;
    if (!visitsByStudy[code]) visitsByStudy[code] = { total: 0, with_revenue: 0, with_stipend: 0, max_stipend: 0, max_revenue: 0 };
    var vs = visitsByStudy[code];
    var rev = parseFloat(r.revenue_per_visit) || 0;
    var stip = parseFloat(r.patient_stipend) || 0;
    vs.total++;
    if (rev > 0) vs.with_revenue++;
    if (stip > 0) vs.with_stipend++;
    if (stip > vs.max_stipend) vs.max_stipend = stip;
    if (rev > vs.max_revenue) vs.max_revenue = rev;
  });
  Object.keys(visitsByStudy).forEach(function(code) {
    if (!studies[code]) studies[code] = { code: code };
    var vs = visitsByStudy[code];
    studies[code].visit_types = vs.total;
    studies[code].visits_with_revenue = vs.with_revenue;
    studies[code].visits_with_stipend = vs.with_stipend;
    studies[code].max_stipend = vs.max_stipend;
    studies[code].max_revenue = vs.max_revenue;
  });

  // Procedures from procedureRevenue
  var procByStudy = {};
  procRevenue.forEach(function(r) {
    var name = (r.study_name || '').trim();
    var parts = name.split(' - ');
    var code = parts.length > 1 ? parts[parts.length-1].trim() : name;
    if (!procByStudy[code]) procByStudy[code] = [];
    procByStudy[code].push(r.procedure_name || '');
  });
  Object.keys(procByStudy).forEach(function(code) {
    if (!studies[code]) studies[code] = { code: code };
    studies[code].procedures = procByStudy[code].join(', ');
    studies[code].procedure_count = procByStudy[code].length;
  });

  // Create output sheet
  var ss = SpreadsheetApp.create('CRP — Master Study Config');
  var sheet = ss.getActiveSheet();
  sheet.setName('Study Config');

  var headers = ['Study Code','Status','Sponsor','PI','Coordinator','Backup Coord','Site','Therapeutic Area','Est. Start','eSource',
    'Fasting','Fasting Note','Total Revenue','Total Paid','Projected Revenue','Revenue/Visit (max)','Stipend/Visit (max)',
    'Visit Types','Visits w/ Revenue','Visits w/ Stipend','Invoice Count','Invoice Unpaid','Procedures','Procedure Count'];

  var rows = [headers];
  Object.keys(studies).sort().forEach(function(code) {
    var s = studies[code];
    rows.push([
      s.code || code, s.status||'', s.sponsor||'', s.pi||'', s.coordinator||'', s.backup_coordinator||'',
      s.site||'', s.therapeutic_area||'', s.start_date||'', s.esource||'',
      s.fasting||'', s.fasting_note||'',
      s.total_revenue||0, s.total_paid||0, s.projected||0, s.max_revenue||0, s.max_stipend||0,
      s.visit_types||0, s.visits_with_revenue||0, s.visits_with_stipend||0,
      s.invoice_count||0, s.invoice_unpaid||0, s.procedures||'', s.procedure_count||0
    ]);
  });

  sheet.getRange(1, 1, rows.length, headers.length).setValues(rows);
  sheet.getRange(1, 1, 1, headers.length).setFontWeight('bold').setBackground('#072061').setFontColor('#fff');
  sheet.setFrozenRows(1);

  // Format currency columns
  [13,14,15,16,17,22].forEach(function(col) {
    sheet.getRange(2, col, rows.length-1, 1).setNumberFormat('$#,##0');
  });

  // Conditional formatting: fasting column
  var fastRange = sheet.getRange(2, 11, rows.length-1, 1);
  sheet.setConditionalFormatRules([
    SpreadsheetApp.newConditionalFormatRule().whenTextContains('hr').setBackground('#fef2f2').setFontColor('#dc2626').setRanges([fastRange]).build(),
    SpreadsheetApp.newConditionalFormatRule().whenTextEqualTo('No').setBackground('#ecfdf5').setFontColor('#059669').setRanges([fastRange]).build(),
  ]);

  // Auto-resize
  for (var i = 1; i <= headers.length; i++) sheet.autoResizeColumn(i);

  // Visit Detail tab
  var visitSheet = ss.insertSheet('Visit Detail');
  var vHeaders = ['Study Code','Visit Name','Revenue/Visit','Patient Stipend','Fasting?','Duration Estimate'];
  var vRows = [vHeaders];

  visitFinance.forEach(function(r) {
    var name = (r.study_name || '').trim();
    var parts = name.split(' - ');
    var code = parts.length > 1 ? parts[parts.length-1].trim() : name;
    var rev = parseFloat(r.revenue_per_visit) || 0;
    if (rev <= 0) return;
    var stip = parseFloat(r.patient_stipend) || 0;
    // Check fasting
    var fast = '';
    for (var fk in FASTING) {
      if (code.indexOf(fk) >= 0) {
        var cfg = FASTING[fk];
        if (cfg.visits === 'ALL') fast = cfg.hours + 'hr';
        else fast = 'Check';
        break;
      }
    }
    vRows.push([code, r.visit_name||'', rev, stip, fast, '']);
  });

  visitSheet.getRange(1, 1, vRows.length, vHeaders.length).setValues(vRows);
  visitSheet.getRange(1, 1, 1, vHeaders.length).setFontWeight('bold').setBackground('#072061').setFontColor('#fff');
  visitSheet.setFrozenRows(1);
  [3,4].forEach(function(col) { visitSheet.getRange(2, col, vRows.length-1, 1).setNumberFormat('$#,##0'); });
  for (var i = 1; i <= vHeaders.length; i++) visitSheet.autoResizeColumn(i);

  Logger.log('DONE! ' + ss.getUrl());
  Logger.log('Studies: ' + (rows.length-1) + ', Visit details: ' + (vRows.length-1));
}

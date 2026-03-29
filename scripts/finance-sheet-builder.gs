/**
 * Finance Configuration Sheet Builder
 *
 * Creates a comprehensive Google Sheet with all study finance data
 * from the CRP BQ cloud function. Run buildFinanceSheet() to populate.
 *
 * Tabs:
 *   1. Study Summary    — studyFinance feed (per-study totals)
 *   2. Visit Finance    — visitFinance feed (per-visit revenue/cost)
 *   3. Procedure Revenue — procedureRevenueConfig feed
 *   4. Procedure Cost   — procedureCostConfig feed
 *   5. Invoices         — agingInvoices feed (all invoice detail)
 *   6. Dashboard        — cross-tab summary with formulas
 */

var CF_BASE = 'https://us-east1-crio-468120.cloudfunctions.net/crp-bq-feeds';

/* ── Entry Point ─────────────────────────────────────────────── */

function buildFinanceSheet() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var ui = SpreadsheetApp.getUi();

  ui.alert('Building Finance Sheet',
    'This will fetch data from 6 BQ feeds and populate tabs.\nThis may take 30-60 seconds.',
    ui.ButtonSet.OK);

  // Fetch all feeds
  var feeds = {
    studies:                fetchFeed_('studies'),
    studyFinance:           fetchFeed_('studyFinance'),
    visitFinance:           fetchFeed_('visitFinance'),
    procedureRevenueConfig: fetchFeed_('procedureRevenueConfig'),
    procedureCostConfig:    fetchFeed_('procedureCostConfig'),
    agingInvoices:          fetchFeed_('agingInvoices')
  };

  // Build each tab
  buildStudySummaryTab_(ss, feeds.studies, feeds.studyFinance);
  buildVisitFinanceTab_(ss, feeds.visitFinance);
  buildProcedureRevenueTab_(ss, feeds.procedureRevenueConfig);
  buildProcedureCostTab_(ss, feeds.procedureCostConfig);
  buildInvoicesTab_(ss, feeds.agingInvoices);
  buildDashboardTab_(ss, feeds.studies, feeds.studyFinance);

  // Activate summary tab
  ss.getSheetByName('Study Summary').activate();
  ui.alert('Done!',
    'Finance sheet built with ' +
    feeds.studies.length + ' studies (' + feeds.studyFinance.length + ' with finance config), ' +
    feeds.visitFinance.length + ' visit configs, ' +
    feeds.procedureRevenueConfig.length + ' procedure revenue configs, ' +
    feeds.procedureCostConfig.length + ' procedure cost configs, ' +
    feeds.agingInvoices.length + ' invoices.',
    ui.ButtonSet.OK);
}

/* ── Fetch Helper ────────────────────────────────────────────── */

function fetchFeed_(feedName) {
  var url = CF_BASE + '?feed=' + feedName + '&format=json';
  var resp = UrlFetchApp.fetch(url, { muteHttpExceptions: true });
  var json = JSON.parse(resp.getContentText());
  return json.data || [];
}

/* ── Sheet Helpers ───────────────────────────────────────────── */

function getOrCreateSheet_(ss, name) {
  var sheet = ss.getSheetByName(name);
  if (!sheet) {
    sheet = ss.insertSheet(name);
  } else {
    sheet.clear();
    sheet.clearFormats();
  }
  return sheet;
}

function writeHeader_(sheet, headers, color) {
  var range = sheet.getRange(1, 1, 1, headers.length);
  range.setValues([headers]);
  range.setFontWeight('bold');
  range.setBackground(color || '#072061');
  range.setFontColor('#ffffff');
  range.setHorizontalAlignment('center');
  sheet.setFrozenRows(1);
}

function autoResize_(sheet, numCols) {
  for (var i = 1; i <= numCols; i++) {
    sheet.autoResizeColumn(i);
  }
}

function applyNumberFormat_(sheet, col, numRows, fmt) {
  if (numRows < 1) return;
  sheet.getRange(2, col, numRows, 1).setNumberFormat(fmt);
}

function num_(val) {
  if (val === '' || val === null || val === undefined) return '';
  var n = parseFloat(val);
  return isNaN(n) ? '' : n;
}

function sumNum_(a, b) {
  var va = num_(a), vb = num_(b);
  if (va === '' && vb === '') return '';
  return (va || 0) + (vb || 0);
}

/* ── Dedup Helpers ───────────────────────────────────────────── */

/**
 * Deduplicates studies by study_name.
 * For each protocol, picks the "primary" study record (non-Publisher site,
 * or the one with the most finance data) and collects all sites/keys.
 */
function deduplicateStudies_(studiesData) {
  var groups = {};
  var order = [];
  studiesData.forEach(function(s) {
    var name = s.study_name || '';
    if (!groups[name]) {
      groups[name] = [];
      order.push(name);
    }
    groups[name].push(s);
  });

  return order.map(function(name) {
    var members = groups[name];
    // Pick primary: prefer non-Publisher site, then first
    var primary = members[0];
    for (var i = 0; i < members.length; i++) {
      if (members[i].site_name && members[i].site_name !== 'Publisher Site') {
        primary = members[i];
        break;
      }
    }
    // Collect all keys and sites
    var allKeys = members.map(function(m) { return m.study_key; });
    var allSites = [];
    var seenSites = {};
    members.forEach(function(m) {
      var site = m.site_name || '';
      if (site && !seenSites[site]) {
        seenSites[site] = true;
        allSites.push(site);
      }
    });
    return {
      primary: primary,
      allKeys: allKeys,
      allSites: allSites,
      count: members.length
    };
  });
}

/**
 * Merges finance records for a set of study_keys belonging to the same protocol.
 * Picks the record with the most data as base; sums additive fields from others.
 */
function mergeFinanceForKeys_(allKeys, finMap) {
  var records = [];
  allKeys.forEach(function(k) {
    if (finMap[k]) records.push(finMap[k]);
  });
  if (!records.length) return null;

  // Sort: pick the one with the highest total_revenue as primary
  records.sort(function(a, b) {
    return (num_(b.total_revenue) || 0) - (num_(a.total_revenue) || 0);
  });
  var base = records[0];

  // Sum additive fields from all records
  var sumFields = [
    'total_revenue', 'projected_revenue', 'total_cost',
    'total_receivable', 'total_invoice_receivable', 'total_holdback',
    'total_revenue_paid', 'total_patient_stipend',
    'total_randomized', 'total_screen_fails', 'total_screen_fails_allocated',
    'invoice_count', 'invoice_total', 'invoice_unpaid',
    'invoices_unpaid', 'invoices_partial', 'invoices_paid',
    'payment_count', 'payment_total',
    'stipend_count', 'stipend_total', 'stipends_paid'
  ];
  // Per-unit rates come from primary only (not summed)
  if (records.length > 1) {
    var merged = {};
    // Copy base
    for (var k in base) merged[k] = base[k];
    // Sum additive fields across all records
    sumFields.forEach(function(field) {
      var total = 0;
      var hasAny = false;
      records.forEach(function(r) {
        var v = num_(r[field]);
        if (v !== '') { total += v; hasAny = true; }
      });
      merged[field] = hasAny ? String(total) : '';
    });
    return merged;
  }
  return base;
}

/**
 * Deduplicates detail-tab rows (visitFinance, procedureRevenue, procedureCost)
 * by study_name + item_name. Keeps one row per unique combo, flags duplicates.
 */
function deduplicateDetailRows_(data, itemField) {
  var seen = {};
  var result = [];
  data.forEach(function(r) {
    var key = (r.study_name || '') + '|||' + (r[itemField] || '');
    if (!seen[key]) {
      seen[key] = { row: r, count: 1 };
      result.push(r);
    } else {
      seen[key].count++;
      // Keep the record with more data
      var existing = seen[key].row;
      var existingVal = num_(existing.revenue_per_visit || existing.revenue_base || existing.cost_base || 0) || 0;
      var newVal = num_(r.revenue_per_visit || r.revenue_base || r.cost_base || 0) || 0;
      if (newVal > existingVal) {
        // Replace in result
        var idx = result.indexOf(existing);
        if (idx >= 0) result[idx] = r;
        seen[key].row = r;
      }
    }
  });
  return result;
}

/* ── Tab 1: Study Summary ────────────────────────────────────── */

function buildStudySummaryTab_(ss, studiesData, financeData) {
  var sheet = getOrCreateSheet_(ss, 'Study Summary');
  var headers = [
    'Study Keys', 'Study Name', 'Sponsor', 'Status',
    'Coordinator', 'Investigator', 'Indication', 'Phase', 'Sites',
    '# Keys', 'Has Finance Config',
    'Total Revenue', 'Projected Revenue', 'Total Cost',
    'Total Receivable', 'Invoice Receivable', 'Total Holdback',
    'Revenue Paid', 'Patient Stipend',
    'Randomized', 'Screen Fails', 'SF Allocated',
    'Rev/Visit', 'Rev/Screen Fail', 'Stipend/Patient',
    'Invoices', 'Invoice Total', 'Invoice Unpaid',
    '# Unpaid', '# Partial', '# Paid',
    'Payments', 'Payment Total',
    'Stipends', 'Stipend Total', '# Stipends Paid'
  ];
  writeHeader_(sheet, headers);

  // Index finance data by study_key
  var finMap = {};
  financeData.forEach(function(r) { finMap[r.study_key] = r; });

  // Deduplicate studies by study_name
  var dedupedStudies = deduplicateStudies_(studiesData);

  // Merge finance data per protocol and build rows
  var merged = dedupedStudies.map(function(group) {
    var s = group.primary;
    var f = mergeFinanceForKeys_(group.allKeys, finMap);
    return { study: s, finance: f, group: group };
  });

  // Sort: studies with finance first (by revenue desc), then the rest by name
  merged.sort(function(a, b) {
    var hasA = a.finance ? 1 : 0, hasB = b.finance ? 1 : 0;
    if (hasA !== hasB) return hasB - hasA;
    if (a.finance && b.finance) {
      return (num_(b.finance.total_revenue) || 0) - (num_(a.finance.total_revenue) || 0);
    }
    return (a.study.study_name || '').localeCompare(b.study.study_name || '');
  });

  var rows = merged.map(function(m) {
    var s = m.study, f = m.finance || {}, g = m.group;
    var hasFin = m.finance ? 'Yes' : 'No';
    return [
      g.allKeys.join(', '), s.study_name, s.sponsor || f.sponsor || '', s.status || '',
      s.coordinator || '', s.investigator || '', s.indication || '', s.phase || '',
      g.allSites.join(', '), g.count, hasFin,
      num_(f.total_revenue), num_(f.projected_revenue), num_(f.total_cost),
      num_(f.total_receivable), num_(f.total_invoice_receivable), num_(f.total_holdback),
      num_(f.total_revenue_paid), num_(f.total_patient_stipend),
      num_(f.total_randomized), num_(f.total_screen_fails), num_(f.total_screen_fails_allocated),
      num_(f.revenue_per_visit), num_(f.revenue_per_screen_fail), num_(f.stipend_per_patient),
      num_(f.invoice_count), num_(f.invoice_total), num_(f.invoice_unpaid),
      num_(f.invoices_unpaid), num_(f.invoices_partial), num_(f.invoices_paid),
      num_(f.payment_count), num_(f.payment_total),
      num_(f.stipend_count), num_(f.stipend_total), num_(f.stipends_paid)
    ];
  });

  if (rows.length) {
    sheet.getRange(2, 1, rows.length, headers.length).setValues(rows);
  }

  // Currency formatting (col positions shifted for new # Keys col)
  var currCols = [12,13,14,15,16,17,18,19,23,24,25,27,28,33,35];
  currCols.forEach(function(c) { applyNumberFormat_(sheet, c, rows.length, '$#,##0.00'); });

  // Integer formatting
  var intCols = [10,20,21,22,26,29,30,31,32,34,36];
  intCols.forEach(function(c) { applyNumberFormat_(sheet, c, rows.length, '#,##0'); });

  // Conditional formatting
  var rules = [];

  // Highlight unpaid > 0
  var unpaidRange = sheet.getRange(2, 29, Math.max(rows.length, 1), 1);
  rules.push(SpreadsheetApp.newConditionalFormatRule()
    .whenNumberGreaterThan(0)
    .setBackground('#fce4ec')
    .setRanges([unpaidRange])
    .build());

  // "Has Finance Config" column
  var finConfigRange = sheet.getRange(2, 11, Math.max(rows.length, 1), 1);
  rules.push(SpreadsheetApp.newConditionalFormatRule()
    .whenTextEqualTo('No')
    .setBackground('#fff3e0')
    .setFontColor('#e65100')
    .setRanges([finConfigRange])
    .build());
  rules.push(SpreadsheetApp.newConditionalFormatRule()
    .whenTextEqualTo('Yes')
    .setBackground('#e8f5e9')
    .setFontColor('#2e7d32')
    .setRanges([finConfigRange])
    .build());

  // # Keys > 1 → highlight to flag multi-key protocols
  var keysRange = sheet.getRange(2, 10, Math.max(rows.length, 1), 1);
  rules.push(SpreadsheetApp.newConditionalFormatRule()
    .whenNumberGreaterThan(1)
    .setBackground('#e3f2fd')
    .setFontColor('#1565c0')
    .setRanges([keysRange])
    .build());

  // Status color coding
  var statusRange = sheet.getRange(2, 4, Math.max(rows.length, 1), 1);
  rules.push(SpreadsheetApp.newConditionalFormatRule()
    .whenTextEqualTo('Enrolling')
    .setBackground('#c8e6c9')
    .setRanges([statusRange])
    .build());
  rules.push(SpreadsheetApp.newConditionalFormatRule()
    .whenTextEqualTo('Startup')
    .setBackground('#bbdefb')
    .setRanges([statusRange])
    .build());
  rules.push(SpreadsheetApp.newConditionalFormatRule()
    .whenTextEqualTo('Maintenance')
    .setBackground('#fff9c4')
    .setRanges([statusRange])
    .build());
  rules.push(SpreadsheetApp.newConditionalFormatRule()
    .whenTextContains('Closed')
    .setBackground('#e0e0e0')
    .setRanges([statusRange])
    .build());

  sheet.setConditionalFormatRules(rules);

  autoResize_(sheet, headers.length);
  sheet.setColumnWidth(1, 180); // study keys
  sheet.setColumnWidth(2, 320); // study name
  sheet.setColumnWidth(7, 200); // indication
  sheet.setColumnWidth(9, 200); // sites
}

/* ── Tab 2: Visit Finance ────────────────────────────────────── */

function buildVisitFinanceTab_(ss, data) {
  var sheet = getOrCreateSheet_(ss, 'Visit Finance');
  var headers = [
    'Study Key', 'Study Name', 'Visit Name',
    'Revenue/Visit', 'Cost/Visit', 'Patient Stipend',
    'Rev Screen Fail', 'Cost Screen Fail',
    'Total Revenue', 'Total Paid', 'Total Holdback', 'Total Cost'
  ];
  writeHeader_(sheet, headers, '#1843AD');

  // Deduplicate by study_name + visit_name
  data = deduplicateDetailRows_(data, 'visit_name');

  // Sort by study name, then revenue desc
  data.sort(function(a, b) {
    var cmp = (a.study_name || '').localeCompare(b.study_name || '');
    if (cmp !== 0) return cmp;
    return (num_(b.revenue_per_visit) || 0) - (num_(a.revenue_per_visit) || 0);
  });

  var rows = data.map(function(r) {
    return [
      r.study_key, r.study_name, r.visit_name,
      num_(r.revenue_per_visit), num_(r.cost_per_visit), num_(r.patient_stipend),
      num_(r.revenue_screen_fail), num_(r.cost_screen_fail),
      num_(r.total_revenue), num_(r.total_paid), num_(r.total_holdback), num_(r.total_cost)
    ];
  });

  if (rows.length) {
    sheet.getRange(2, 1, rows.length, headers.length).setValues(rows);
  }

  var currCols = [4,5,6,7,8,9,10,11,12];
  currCols.forEach(function(c) { applyNumberFormat_(sheet, c, rows.length, '$#,##0.00'); });

  // Alternate row banding by study
  applyStudyBanding_(sheet, rows, 1);

  autoResize_(sheet, headers.length);
  sheet.setColumnWidth(2, 320);
  sheet.setColumnWidth(3, 250);
}

/* ── Tab 3: Procedure Revenue ────────────────────────────────── */

function buildProcedureRevenueTab_(ss, data) {
  var sheet = getOrCreateSheet_(ss, 'Procedure Revenue');
  var headers = [
    'Study Key', 'Study Name', 'Procedure Name',
    'Revenue Base', 'Revenue Screen Fail', 'Revenue Ad Hoc',
    'Patient Stipend',
    'Total Holdbacks', 'Total Receivable', 'Total Revenue', 'Total Paid'
  ];
  writeHeader_(sheet, headers, '#1843AD');

  // Deduplicate by study_name + procedure_name
  data = deduplicateDetailRows_(data, 'procedure_name');

  data.sort(function(a, b) {
    var cmp = (a.study_name || '').localeCompare(b.study_name || '');
    if (cmp !== 0) return cmp;
    return (num_(b.revenue_base) || 0) - (num_(a.revenue_base) || 0);
  });

  var rows = data.map(function(r) {
    return [
      r.study_key, r.study_name, r.procedure_name,
      num_(r.revenue_base), num_(r.revenue_screen_fail), num_(r.revenue_ad_hoc),
      num_(r.patient_stipend),
      num_(r.total_holdbacks), num_(r.total_receivable), num_(r.total_revenue), num_(r.total_paid)
    ];
  });

  if (rows.length) {
    sheet.getRange(2, 1, rows.length, headers.length).setValues(rows);
  }

  var currCols = [4,5,6,7,8,9,10,11];
  currCols.forEach(function(c) { applyNumberFormat_(sheet, c, rows.length, '$#,##0.00'); });

  applyStudyBanding_(sheet, rows, 1);
  autoResize_(sheet, headers.length);
  sheet.setColumnWidth(2, 320);
  sheet.setColumnWidth(3, 300);
}

/* ── Tab 4: Procedure Cost ───────────────────────────────────── */

function buildProcedureCostTab_(ss, data) {
  var sheet = getOrCreateSheet_(ss, 'Procedure Cost');
  var headers = [
    'Study Key', 'Study Name', 'Procedure Name',
    'Cost Base', 'Cost Screen Fail', 'Cost Ad Hoc',
    'Total Costs', 'Total Paid', 'Vendor'
  ];
  writeHeader_(sheet, headers, '#1843AD');

  // Deduplicate by study_name + procedure_name
  data = deduplicateDetailRows_(data, 'procedure_name');

  data.sort(function(a, b) {
    var cmp = (a.study_name || '').localeCompare(b.study_name || '');
    if (cmp !== 0) return cmp;
    return (num_(b.cost_base) || 0) - (num_(a.cost_base) || 0);
  });

  var rows = data.map(function(r) {
    return [
      r.study_key, r.study_name, r.procedure_name,
      num_(r.cost_base), num_(r.cost_screen_fail), num_(r.cost_ad_hoc),
      num_(r.total_costs), num_(r.total_paid), r.vendor || ''
    ];
  });

  if (rows.length) {
    sheet.getRange(2, 1, rows.length, headers.length).setValues(rows);
  }

  var currCols = [4,5,6,7,8];
  currCols.forEach(function(c) { applyNumberFormat_(sheet, c, rows.length, '$#,##0.00'); });

  applyStudyBanding_(sheet, rows, 1);
  autoResize_(sheet, headers.length);
  sheet.setColumnWidth(2, 320);
  sheet.setColumnWidth(3, 300);
}

/* ── Tab 5: Invoices ─────────────────────────────────────────── */

function buildInvoicesTab_(ss, data) {
  var sheet = getOrCreateSheet_(ss, 'Invoices');
  var headers = [
    'Invoice #', 'Invoice Key', 'Study Name', 'Study Key', 'Sponsor',
    'Amount', 'Amount Paid', 'Amount Unpaid',
    'Date Created', 'Date Due', 'Date Sent',
    'Days Until Due', 'Status', 'Days Overdue'
  ];
  writeHeader_(sheet, headers, '#FF9933');

  // Sort: unpaid first, then by days overdue desc
  var statusOrder = { 'Unpaid': 0, 'Partially Paid': 1, 'Draft': 2, 'Paid': 3 };
  data.sort(function(a, b) {
    var sa = statusOrder[a.status] !== undefined ? statusOrder[a.status] : 9;
    var sb = statusOrder[b.status] !== undefined ? statusOrder[b.status] : 9;
    if (sa !== sb) return sa - sb;
    return (num_(b.days_overdue) || 0) - (num_(a.days_overdue) || 0);
  });

  var rows = data.map(function(r) {
    return [
      r.invoice_number, r.invoice_key, r.study_name, r.study_key, r.sponsor,
      num_(r.amount), num_(r.amount_paid), num_(r.amount_unpaid),
      r.date_created || '', r.date_due || '', r.date_sent || '',
      num_(r.days_until_due), r.status, num_(r.days_overdue)
    ];
  });

  if (rows.length) {
    sheet.getRange(2, 1, rows.length, headers.length).setValues(rows);
  }

  var currCols = [6,7,8];
  currCols.forEach(function(c) { applyNumberFormat_(sheet, c, rows.length, '$#,##0.00'); });

  // Conditional formatting: red for Unpaid, orange for Partial, green for Paid
  var statusRange = sheet.getRange(2, 13, Math.max(rows.length, 1), 1);
  var rules = [];
  rules.push(SpreadsheetApp.newConditionalFormatRule()
    .whenTextEqualTo('Unpaid').setBackground('#ffcdd2').setRanges([statusRange]).build());
  rules.push(SpreadsheetApp.newConditionalFormatRule()
    .whenTextEqualTo('Partially Paid').setBackground('#fff9c4').setRanges([statusRange]).build());
  rules.push(SpreadsheetApp.newConditionalFormatRule()
    .whenTextEqualTo('Paid').setBackground('#c8e6c9').setRanges([statusRange]).build());
  rules.push(SpreadsheetApp.newConditionalFormatRule()
    .whenTextEqualTo('Draft').setBackground('#e0e0e0').setRanges([statusRange]).build());

  // Red for days overdue > 90
  var overdueRange = sheet.getRange(2, 14, Math.max(rows.length, 1), 1);
  rules.push(SpreadsheetApp.newConditionalFormatRule()
    .whenNumberGreaterThan(90).setBackground('#ffcdd2').setRanges([overdueRange]).build());

  sheet.setConditionalFormatRules(rules);

  autoResize_(sheet, headers.length);
  sheet.setColumnWidth(1, 280);
  sheet.setColumnWidth(3, 320);
}

/* ── Tab 6: Dashboard ────────────────────────────────────────── */

function buildDashboardTab_(ss, studiesData, studyFinData) {
  var studyData = studyFinData;
  var dedupedCount = deduplicateStudies_(studiesData).length;
  var sheet = getOrCreateSheet_(ss, 'Dashboard');

  // Title
  sheet.getRange('A1').setValue('CRP Finance Configuration Dashboard')
    .setFontSize(16).setFontWeight('bold').setFontColor('#072061');
  sheet.getRange('A2').setValue('Last refreshed: ' + new Date().toLocaleString())
    .setFontColor('#666666');

  // Summary KPIs
  var totalRevenue = 0, totalCost = 0, totalReceivable = 0, totalUnpaid = 0;
  var totalRandomized = 0, totalSF = 0, totalStipends = 0;
  studyData.forEach(function(r) {
    totalRevenue     += num_(r.total_revenue) || 0;
    totalCost        += num_(r.total_cost) || 0;
    totalReceivable  += num_(r.total_receivable) || 0;
    totalUnpaid      += num_(r.invoice_unpaid) || 0;
    totalRandomized  += num_(r.total_randomized) || 0;
    totalSF          += num_(r.total_screen_fails) || 0;
    totalStipends    += num_(r.stipend_total) || 0;
  });

  var kpis = [
    ['', '', ''],
    ['PORTFOLIO SUMMARY', '', ''],
    ['Total Protocols (deduped)', dedupedCount, ''],
    ['Total Revenue', totalRevenue, '$#,##0'],
    ['Total Cost', totalCost, '$#,##0'],
    ['Total Receivable', totalReceivable, '$#,##0'],
    ['Unpaid Invoices', totalUnpaid, '$#,##0'],
    ['Total Randomized', totalRandomized, '#,##0'],
    ['Total Screen Fails', totalSF, '#,##0'],
    ['Total Stipends', totalStipends, '$#,##0'],
    ['', '', ''],
    ['TOP 10 STUDIES BY REVENUE', '', '']
  ];

  // Top 10 studies
  var sorted = studyData.slice().sort(function(a, b) {
    return (num_(b.total_revenue) || 0) - (num_(a.total_revenue) || 0);
  });

  kpis.push(['Study', 'Revenue', 'Unpaid Invoices']);
  sorted.slice(0, 10).forEach(function(r) {
    kpis.push([r.study_name, num_(r.total_revenue) || 0, num_(r.invoice_unpaid) || 0]);
  });

  sheet.getRange(1, 1, kpis.length, 3).setValues(kpis.map(function(r) {
    return [r[0] || '', r[1] !== undefined ? r[1] : '', r[2] || ''];
  }));

  // Format section headers
  sheet.getRange('A4').setFontWeight('bold').setFontSize(12).setFontColor('#072061');
  sheet.getRange('A14').setFontWeight('bold').setFontSize(12).setFontColor('#072061');
  sheet.getRange('A15').setFontWeight('bold');

  // Format currency cells
  for (var i = 6; i <= 12; i++) {
    var fmt = kpis[i - 1][2];
    if (fmt) sheet.getRange(i, 2).setNumberFormat(fmt);
  }

  // Format top 10
  for (var j = 16; j <= 25; j++) {
    sheet.getRange(j, 2).setNumberFormat('$#,##0');
    sheet.getRange(j, 3).setNumberFormat('$#,##0');
  }

  // Label column width
  sheet.setColumnWidth(1, 400);
  sheet.setColumnWidth(2, 180);
  sheet.setColumnWidth(3, 180);
}

/* ── Banding Helper ──────────────────────────────────────────── */

function applyStudyBanding_(sheet, rows, studyKeyCol) {
  if (!rows.length) return;
  var even = true;
  var prevKey = rows[0][studyKeyCol - 1];
  for (var i = 0; i < rows.length; i++) {
    var key = rows[i][studyKeyCol - 1];
    if (key !== prevKey) {
      even = !even;
      prevKey = key;
    }
    if (even) {
      sheet.getRange(i + 2, 1, 1, rows[i].length).setBackground('#f0f4ff');
    }
  }
}

/* ── Custom Menu ─────────────────────────────────────────────── */

/* ══════════════════════════════════════════════════════════════
   CTA COMPARISON MODULE
   Reads PDFs from Drive, extracts financial terms via OCR,
   compares against CRIO/BQ visit & procedure finance config.
   ══════════════════════════════════════════════════════════════ */

var CTA_FOLDER_ID = '1Ljt1dHNbTaCn3-GtybF6ItKJYoNRz6ZP';

/* ── CTA Entry Point ─────────────────────────────────────────── */

var BATCH_SIZE = 10; // PDFs per run

function buildCTAComparison() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var ui = SpreadsheetApp.getUi();

  // Use Drive API search instead of recursive folder walk — avoids permission errors
  var allFiles = findAllPDFsViaSearch_(CTA_FOLDER_ID);

  if (!allFiles.length) { ui.alert('No PDFs found.'); return; }

  // Check progress: which files have we already processed?
  var progressSheet = ss.getSheetByName('CTA Progress');
  var doneIds = {};
  if (progressSheet) {
    var progData = progressSheet.getDataRange().getValues();
    for (var i = 1; i < progData.length; i++) {
      if (progData[i][0]) doneIds[progData[i][0]] = true;
    }
  } else {
    progressSheet = ss.insertSheet('CTA Progress');
    progressSheet.getRange(1, 1, 1, 5).setValues([['File ID', 'Folder', 'File Name', 'Text Length', 'Status']]);
    progressSheet.getRange(1, 1, 1, 5).setFontWeight('bold');
  }

  // Find remaining files
  var remaining = allFiles.filter(function(f) { return !doneIds[f.file.getId()]; });
  var batch = remaining.slice(0, BATCH_SIZE);

  if (!batch.length) {
    // All done — build comparison tabs
    ui.alert('All ' + allFiles.length + ' PDFs already extracted.\nBuilding comparison tabs now...');
    buildComparisonFromProgress_(ss);
    return;
  }

  ui.alert('CTA Batch',
    'Processing batch of ' + batch.length + ' PDFs.\n' +
    (Object.keys(doneIds).length) + ' already done, ' + remaining.length + ' remaining.\n\n' +
    'Run again after this batch completes to continue.',
    ui.ButtonSet.OK);

  // Process this batch
  var progressRows = [];
  var extractSheet = getOrCreateExtractAppend_(ss);

  for (var j = 0; j < batch.length; j++) {
    var file = batch[j].file;
    var folderPath = batch[j].folder;
    var fileName = file.getName();
    var fileId = file.getId();
    var text = '';
    var status = 'OK';

    try {
      var blob = file.getBlob();
      var resource = { title: '_CTA_TEMP_' + fileName, mimeType: 'application/pdf' };
      var tempFile = Drive.Files.insert(resource, blob, { ocr: true, ocrLanguage: 'en', convert: true });
      var tempDoc = DocumentApp.openById(tempFile.id);
      text = tempDoc.getBody().getText();
      DriveApp.getFileById(tempFile.id).setTrashed(true);
    } catch (e) {
      text = '[ERROR: ' + e.message + ']';
      status = 'ERROR';
    }

    // Parse and append to CTA Extracted
    var terms = parseCTAFinancialTerms_(text, fileName, folderPath);
    appendExtractedRows_(extractSheet, folderPath, fileName, terms);

    // Record progress
    progressRows.push([fileId, folderPath, fileName, text.length, status]);
  }

  // Write progress
  if (progressRows.length) {
    var lastRow = progressSheet.getLastRow();
    progressSheet.getRange(lastRow + 1, 1, progressRows.length, 5).setValues(progressRows);
  }

  var totalDone = Object.keys(doneIds).length + batch.length;
  var totalRemaining = allFiles.length - totalDone;

  if (totalRemaining > 0) {
    ui.alert('Batch Complete',
      'Processed ' + batch.length + ' PDFs this run.\n' +
      totalDone + ' / ' + allFiles.length + ' total done.\n' +
      totalRemaining + ' remaining.\n\n' +
      'Run "CTA Comparison" again to process the next batch.',
      ui.ButtonSet.OK);
  } else {
    ui.alert('Extraction Complete',
      'All ' + allFiles.length + ' PDFs extracted!\nBuilding comparison tabs now...',
      ui.ButtonSet.OK);
    buildComparisonFromProgress_(ss);
  }
}

/**
 * Gets or creates the CTA Extracted sheet, preserving existing rows (append mode).
 */
function getOrCreateExtractAppend_(ss) {
  var sheet = ss.getSheetByName('CTA Extracted');
  if (!sheet) {
    sheet = ss.insertSheet('CTA Extracted');
    var headers = ['Folder', 'CTA File', 'Protocol', 'Sponsor', 'Category',
      'Item Name', 'CTA Amount', 'Line #', 'Context'];
    writeHeader_(sheet, headers, '#072061');
  }
  return sheet;
}

/**
 * Appends parsed rows to the CTA Extracted sheet.
 */
function appendExtractedRows_(sheet, folderPath, fileName, terms) {
  var t = terms;
  var fp = folderPath || '';
  var rows = [];

  t.visits.forEach(function(v) {
    rows.push([fp, fileName, t.protocolNumber, t.sponsor, 'Visit',
      v.name, v.amount, v.line, v.context || '']);
  });
  t.procedures.forEach(function(p) {
    rows.push([fp, fileName, t.protocolNumber, t.sponsor, 'Procedure',
      p.name, p.amount, p.line, p.context || '']);
  });
  t.stipends.forEach(function(s) {
    rows.push([fp, fileName, t.protocolNumber, t.sponsor, 'Stipend',
      s.description, s.amount, s.line, '']);
  });
  t.fees.forEach(function(f) {
    rows.push([fp, fileName, t.protocolNumber, t.sponsor, 'Fee',
      f.description, f.amount, f.line, '']);
  });
  if (!t.visits.length && !t.procedures.length && !t.stipends.length && !t.fees.length) {
    t.rawAmounts.forEach(function(r) {
      rows.push([fp, fileName, t.protocolNumber, t.sponsor, 'Uncategorized',
        '', r.amount, r.line, r.context]);
    });
    // If truly nothing found, still log the file
    if (!t.rawAmounts.length) {
      rows.push([fp, fileName, t.protocolNumber, t.sponsor, 'Empty',
        '(no dollar amounts found)', '', '', '']);
    }
  }

  if (rows.length) {
    var lastRow = sheet.getLastRow();
    sheet.getRange(lastRow + 1, 1, rows.length, 9).setValues(rows);
  }
}

/**
 * After all batches complete, reads CTA Extracted and builds comparison tab.
 */
function buildComparisonFromProgress_(ss) {
  var extractSheet = ss.getSheetByName('CTA Extracted');
  if (!extractSheet) return;

  var data = extractSheet.getDataRange().getValues();
  if (data.length < 2) return;

  // Rebuild ctaParsed from the extracted sheet data
  var byFile = {};
  for (var i = 1; i < data.length; i++) {
    var row = data[i];
    var key = (row[0] || '') + '|||' + (row[1] || '');
    if (!byFile[key]) {
      byFile[key] = {
        fileName: row[1], folderPath: row[0],
        terms: { protocolNumber: row[2], sponsor: row[3], studyName: row[1],
          visits: [], procedures: [], stipends: [], fees: [], rawAmounts: [] }
      };
    }
    var cat = row[4];
    var item = { name: row[5], description: row[5], amount: row[6], line: row[7], context: row[8] };
    if (cat === 'Visit') byFile[key].terms.visits.push(item);
    else if (cat === 'Procedure') byFile[key].terms.procedures.push(item);
    else if (cat === 'Stipend') byFile[key].terms.stipends.push(item);
    else if (cat === 'Fee') byFile[key].terms.fees.push(item);
  }

  var ctaParsed = Object.keys(byFile).map(function(k) { return byFile[k]; });

  // Fetch BQ data and build comparison
  var bqData = {
    visitFinance: fetchFeed_('visitFinance'),
    procedureRevenueConfig: fetchFeed_('procedureRevenueConfig'),
    studyFinance: fetchFeed_('studyFinance')
  };

  buildCTAComparisonTab_(ss, ctaParsed, bqData);

  // Format CTA Extracted
  var numRows = extractSheet.getLastRow() - 1;
  if (numRows > 0) {
    applyNumberFormat_(extractSheet, 7, numRows, '$#,##0.00');
    var catRange = extractSheet.getRange(2, 5, numRows, 1);
    var rules = [];
    rules.push(SpreadsheetApp.newConditionalFormatRule()
      .whenTextEqualTo('Visit').setBackground('#c8e6c9').setRanges([catRange]).build());
    rules.push(SpreadsheetApp.newConditionalFormatRule()
      .whenTextEqualTo('Procedure').setBackground('#bbdefb').setRanges([catRange]).build());
    rules.push(SpreadsheetApp.newConditionalFormatRule()
      .whenTextEqualTo('Stipend').setBackground('#fff9c4').setRanges([catRange]).build());
    rules.push(SpreadsheetApp.newConditionalFormatRule()
      .whenTextEqualTo('Fee').setBackground('#e1bee7').setRanges([catRange]).build());
    rules.push(SpreadsheetApp.newConditionalFormatRule()
      .whenTextEqualTo('Uncategorized').setBackground('#ffccbc').setRanges([catRange]).build());
    rules.push(SpreadsheetApp.newConditionalFormatRule()
      .whenTextEqualTo('Empty').setBackground('#ffcdd2').setRanges([catRange]).build());
    extractSheet.setConditionalFormatRules(rules);
  }

  ss.getSheetByName('CTA vs CRIO').activate();
  SpreadsheetApp.getUi().alert('Comparison built!\nCheck "CTA vs CRIO" tab for results.');
}

/**
 * Resets CTA progress to start fresh. Run this if you want to re-extract all PDFs.
 */
function resetCTAProgress() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var progress = ss.getSheetByName('CTA Progress');
  if (progress) ss.deleteSheet(progress);
  var extracted = ss.getSheetByName('CTA Extracted');
  if (extracted) ss.deleteSheet(extracted);
  var comparison = ss.getSheetByName('CTA vs CRIO');
  if (comparison) ss.deleteSheet(comparison);
  SpreadsheetApp.getUi().alert('CTA progress reset. Run "CTA Comparison" to start fresh.');
}

/* ── PDF Discovery (non-recursive, uses Drive API search) ────── */

/**
 * Finds ALL PDFs anywhere under the root folder using Drive API search.
 * Then deduplicates to keep only the latest PDF per study folder.
 * Returns array of { file, folder, sponsor, studyFolder }.
 */
function findAllPDFsViaSearch_(rootFolderId) {
  // Step 1: Find all PDFs under the root using Drive search
  // Drive search doesn't support "in subtree", so we find ALL our PDFs
  // and filter by building the folder ancestry
  var allPDFs = [];
  var pageToken = null;

  do {
    var params = {
      q: "mimeType='application/pdf' and trashed=false",
      fields: 'nextPageToken, files(id, name, parents, modifiedTime)',
      pageSize: 200,
      orderBy: 'modifiedTime desc'
    };
    if (pageToken) params.pageToken = pageToken;

    var response = Drive.Files.list(params);
    var files = response.files || [];
    files.forEach(function(f) { allPDFs.push(f); });
    pageToken = response.nextPageToken;
  } while (pageToken);

  Logger.log('Total PDFs in Drive: ' + allPDFs.length);

  // Step 2: Build folder path cache — map folder ID → { name, parentId }
  var folderCache = {};
  folderCache[rootFolderId] = { name: '(root)', parentId: null };

  // Collect all unique parent IDs we need to resolve
  var parentIds = {};
  allPDFs.forEach(function(f) {
    if (f.parents) f.parents.forEach(function(p) { parentIds[p] = true; });
  });

  // Resolve parent folders (may need multiple passes for deep nesting)
  for (var pass = 0; pass < 5; pass++) {
    var unknownIds = Object.keys(parentIds).filter(function(id) { return !folderCache[id]; });
    if (!unknownIds.length) break;

    // Batch lookup in chunks of 50
    for (var c = 0; c < unknownIds.length; c += 50) {
      var chunk = unknownIds.slice(c, c + 50);
      var query = chunk.map(function(id) { return "id='" + id + "'"; }).join(' or ');
      try {
        var fResp = Drive.Files.list({
          q: '(' + query + ') and mimeType = \'application/vnd.google-apps.folder\'',
          fields: 'files(id, name, parents)',
          pageSize: 50
        });
        (fResp.files || []).forEach(function(folder) {
          folderCache[folder.id] = { name: folder.name, parentId: (folder.parents || [])[0] || null };
          if (folder.parents) folder.parents.forEach(function(p) { parentIds[p] = true; });
        });
      } catch (e) {
        Logger.log('Folder lookup error: ' + e.message);
      }
    }
  }

  // Step 3: For each PDF, build the full folder path and check if it's under rootFolderId
  var pdfUnderRoot = [];
  allPDFs.forEach(function(f) {
    var parentId = (f.parents || [])[0];
    var pathParts = [];
    var current = parentId;
    var isUnderRoot = false;

    for (var i = 0; i < 10; i++) { // max 10 levels deep
      if (!current) break;
      if (current === rootFolderId) { isUnderRoot = true; break; }
      var info = folderCache[current];
      if (!info) break;
      pathParts.unshift(info.name);
      current = info.parentId;
    }

    if (isUnderRoot) {
      var folderPath = pathParts.join('/');
      // pathParts[0] = sponsor, pathParts[1] = study (if depth >= 2)
      pdfUnderRoot.push({
        fileId: f.id,
        fileName: f.name,
        modifiedTime: f.modifiedTime,
        folder: folderPath,
        sponsor: pathParts.length >= 1 ? pathParts[0] : '',
        studyFolder: pathParts.length >= 2 ? pathParts[1] : ''
      });
    }
  });

  Logger.log('PDFs under CTA root folder: ' + pdfUnderRoot.length);

  // Step 4: Deduplicate — keep only the latest PDF per study folder
  var byStudy = {};
  pdfUnderRoot.forEach(function(pdf) {
    var key = pdf.sponsor + '/' + pdf.studyFolder;
    if (!pdf.studyFolder) key = '__top__/' + pdf.fileName; // top-level files get their own key
    if (!byStudy[key] || pdf.modifiedTime > byStudy[key].modifiedTime) {
      byStudy[key] = pdf;
    }
  });

  var deduped = Object.keys(byStudy).map(function(k) { return byStudy[k]; });
  Logger.log('After dedup (latest per study): ' + deduped.length + ' PDFs');

  // Step 5: Convert to DriveApp file objects
  var result = [];
  deduped.forEach(function(pdf) {
    try {
      var file = DriveApp.getFileById(pdf.fileId);
      result.push({
        file: file,
        folder: pdf.folder + '/',
        sponsor: pdf.sponsor,
        studyFolder: pdf.studyFolder
      });
    } catch (e) {
      Logger.log('Cannot access file: ' + pdf.fileName + ' — ' + e.message);
    }
  });

  return result;
}

/* ── PDF Text Extraction ─────────────────────────────────────── */

/**
 * Reads all PDFs from a Drive folder, converts each to a temp Google Doc
 * via OCR, extracts the text, then deletes the temp doc.
 */
function extractCTATexts_(folderId) {
  var rootFolder = DriveApp.getFolderById(folderId);
  var allFiles = [];

  // Recursively collect all PDF files from folder and subfolders
  collectPDFs_(rootFolder, '', allFiles);

  Logger.log('Found ' + allFiles.length + ' PDF files across all subfolders');

  var results = [];
  for (var i = 0; i < allFiles.length; i++) {
    var file = allFiles[i].file;
    var folderPath = allFiles[i].folder;
    var fileName = file.getName();
    Logger.log('Processing (' + (i + 1) + '/' + allFiles.length + '): ' + folderPath + fileName);

    try {
      // Create a temporary Google Doc from the PDF using Drive API OCR
      var blob = file.getBlob();
      var resource = {
        title: '_CTA_TEMP_' + fileName,
        mimeType: 'application/pdf'
      };

      // Use Drive API v2 to insert with OCR
      var tempFile = Drive.Files.insert(resource, blob, {
        ocr: true,
        ocrLanguage: 'en',
        convert: true
      });

      // Read the text from the created Google Doc
      var tempDoc = DocumentApp.openById(tempFile.id);
      var text = tempDoc.getBody().getText();

      // Clean up temp doc
      DriveApp.getFileById(tempFile.id).setTrashed(true);

      results.push({
        fileName: fileName,
        folderPath: folderPath,
        text: text
      });
    } catch (e) {
      Logger.log('Error processing ' + fileName + ': ' + e.message);
      results.push({
        fileName: fileName,
        folderPath: folderPath,
        text: '[ERROR: ' + e.message + ']'
      });
    }
  }
  return results;
}

/**
 * Recursively collects PDF files from folder tree.
 * Structure: Root / Sponsor / Study / [multiple CTA versions]
 * Only keeps the LATEST modified PDF per study subfolder.
 */
function collectPDFs_(folder, path, results) {
  try {
    var folderName = folder.getName();
  } catch (e) {
    Logger.log('Cannot access folder at path: ' + path + ' — ' + e.message);
    return;
  }
  var currentPath = path ? path + folderName + '/' : '';

  // Collect PDFs at this level
  var localPDFs = [];
  try {
    var pdfFiles = folder.getFilesByType('application/pdf');
    while (pdfFiles.hasNext()) {
      try {
        var pf = pdfFiles.next();
        pf.getName(); // test access
        localPDFs.push({ file: pf, folder: currentPath });
      } catch (fe) {
        Logger.log('Cannot access file in ' + currentPath + ': ' + fe.message);
      }
    }
  } catch (e1) {
    Logger.log('Error listing PDFs in ' + currentPath + ': ' + e1.message);
  }

  // Also non-standard MIME .pdf files
  try {
    var allFiles = folder.getFiles();
    while (allFiles.hasNext()) {
      try {
        var f = allFiles.next();
        var name = f.getName().toLowerCase();
        if (name.indexOf('.pdf') >= 0 && f.getMimeType() !== 'application/pdf') {
          localPDFs.push({ file: f, folder: currentPath });
        }
      } catch (fe2) {
        Logger.log('Cannot access file in ' + currentPath + ': ' + fe2.message);
      }
    }
  } catch (e2) {
    Logger.log('Error listing files in ' + currentPath + ': ' + e2.message);
  }

  // Check if this is a study-level folder (has PDFs and is at depth >= 2)
  var depth = (currentPath.match(/\//g) || []).length;
  if (localPDFs.length > 0 && depth >= 2) {
    // This is a study folder — keep only the latest modified PDF
    localPDFs.sort(function(a, b) {
      try {
        return b.file.getLastUpdated().getTime() - a.file.getLastUpdated().getTime();
      } catch (se) { return 0; }
    });
    var latest = localPDFs[0];
    latest.sponsor = path.split('/').filter(Boolean).pop() || '';
    latest.studyFolder = folderName;
    results.push(latest);
    Logger.log('Study folder: ' + currentPath + ' → keeping: ' + latest.file.getName() +
      ' (latest of ' + localPDFs.length + ')');
  } else if (localPDFs.length > 0) {
    localPDFs.forEach(function(p) { results.push(p); });
  }

  // Recurse into subfolders
  try {
    var subfolders = folder.getFolders();
    while (subfolders.hasNext()) {
      try {
        collectPDFs_(subfolders.next(), currentPath, results);
      } catch (sf) {
        Logger.log('Cannot access subfolder in ' + currentPath + ': ' + sf.message);
      }
    }
  } catch (e3) {
    Logger.log('Error listing subfolders in ' + currentPath + ': ' + e3.message);
  }
}

/* ── CTA Financial Term Parser ───────────────────────────────── */

/**
 * Parses financial terms from CTA text. Looks for:
 * - Per-visit rates (visit name + dollar amount)
 * - Procedure fees
 * - Screen fail fees
 * - Patient stipends
 * - Startup/closeout fees
 * - Holdback percentages
 */
function parseCTAFinancialTerms_(text, fileName, folderPath) {
  var terms = {
    studyName: '',
    protocolNumber: '',
    sponsor: '',
    visits: [],        // { name, amount, type }
    procedures: [],    // { name, amount, type }
    stipends: [],      // { description, amount }
    fees: [],          // { description, amount } — startup, closeout, amendment, etc.
    holdback: '',      // percentage or amount
    screenFail: '',    // screen fail rate
    rawAmounts: []     // all dollar amounts found with context
  };

  // Try to extract protocol number from folder path, filename, or text
  // Folder structure: Root/Sponsor/StudyProtocol/file.pdf
  var folderParts = (folderPath || '').split('/').filter(Boolean);
  if (folderParts.length >= 2) {
    terms.sponsor = folderParts[folderParts.length - 2] || '';
    terms.protocolNumber = folderParts[folderParts.length - 1] || '';
  } else if (folderParts.length === 1) {
    terms.protocolNumber = folderParts[0] || '';
  }
  // Fallback to text parsing if folder didn't provide
  if (!terms.protocolNumber) {
    var protoMatch = text.match(/Protocol\s*(?:#|Number|No\.?)?[\s:]*([A-Z0-9][\w\-]+)/i)
      || fileName.match(/([A-Z0-9]{2,}[\-_][A-Z0-9\-_]+)/i);
    if (protoMatch) terms.protocolNumber = protoMatch[1].trim();
  }
  if (!terms.sponsor) {
    var sponsorMatch = text.match(/(?:Sponsor|Company|between.*and)\s*[:.]?\s*([A-Z][A-Za-z\s&,\.]+?)(?:\n|,\s*a\s|\.)/);
    if (sponsorMatch) terms.sponsor = sponsorMatch[1].trim();
  }

  // Study name from filename
  terms.studyName = fileName.replace(/\.pdf$/i, '').replace(/_/g, ' ');

  var lines = text.split('\n');

  // Pass 1: Find all dollar amounts with surrounding context
  var dollarPattern = /\$[\d,]+(?:\.\d{1,2})?/g;
  for (var i = 0; i < lines.length; i++) {
    var line = lines[i].trim();
    if (!line) continue;

    var matches = line.match(dollarPattern);
    if (matches) {
      matches.forEach(function(amt) {
        var amount = parseFloat(amt.replace(/[$,]/g, ''));
        if (amount > 0) {
          terms.rawAmounts.push({
            line: i + 1,
            context: line.substring(0, 200),
            amount: amount,
            raw: amt
          });
        }
      });
    }
  }

  // Pass 2: Categorize amounts by context
  for (var j = 0; j < lines.length; j++) {
    var ln = lines[j].trim();
    if (!ln) continue;
    var lnLower = ln.toLowerCase();

    var amts = ln.match(dollarPattern);
    if (!amts) continue;

    amts.forEach(function(amt) {
      var amount = parseFloat(amt.replace(/[$,]/g, ''));
      if (amount <= 0) return;

      var item = { context: ln.substring(0, 200), amount: amount, line: j + 1 };

      // Categorize by keywords
      if (/visit\s*\d|v\d|day\s*\d|week\s*\d|screening|baseline|randomiz|follow.?up|final\s*visit|end.?of.?study|early\s*term/i.test(ln)) {
        // Extract visit name
        var visitName = extractVisitName_(ln);
        terms.visits.push({ name: visitName || ln.substring(0, 60), amount: amount, type: 'visit', line: j + 1 });
      }
      else if (/screen\s*fail|screen.?failure/i.test(ln)) {
        terms.screenFail = amount;
        terms.fees.push({ description: 'Screen Failure', amount: amount, line: j + 1 });
      }
      else if (/stipend|patient\s*payment|subject\s*payment|reimburs|travel|compensation/i.test(ln)) {
        terms.stipends.push({ description: ln.substring(0, 100), amount: amount, line: j + 1 });
      }
      else if (/startup|start.?up|initiat|activation/i.test(ln)) {
        terms.fees.push({ description: 'Startup', amount: amount, line: j + 1 });
      }
      else if (/closeout|close.?out|termination/i.test(ln)) {
        terms.fees.push({ description: 'Closeout', amount: amount, line: j + 1 });
      }
      else if (/amendment|amd\b/i.test(ln)) {
        terms.fees.push({ description: 'Amendment Fee', amount: amount, line: j + 1 });
      }
      else if (/holdback|withh[eo]ld|retainer/i.test(ln)) {
        terms.holdback = amount;
        terms.fees.push({ description: 'Holdback', amount: amount, line: j + 1 });
      }
      else if (/procedure|lab\b|ecg|ekg|x.?ray|ct\b|mri|blood|urine|vital|physical|exam|consent|icf\b|biopsy|spirom/i.test(ln)) {
        var procName = extractProcedureName_(ln);
        terms.procedures.push({ name: procName || ln.substring(0, 60), amount: amount, type: 'procedure', line: j + 1 });
      }
      else if (/per\s*(?:visit|patient|subject|procedure)|total|budget|cost|fee|rate|payment/i.test(ln)) {
        terms.fees.push({ description: ln.substring(0, 100), amount: amount, line: j + 1 });
      }
    });
  }

  // Pass 3: Look for holdback percentage
  var holdbackPct = text.match(/holdback.*?(\d+)\s*%|(\d+)\s*%\s*holdback/i);
  if (holdbackPct) terms.holdback = (holdbackPct[1] || holdbackPct[2]) + '%';

  return terms;
}

function extractVisitName_(line) {
  // Try to extract a visit name like "Visit 3", "V3-Treatment", "Day 15", "Screening", etc.
  var patterns = [
    /\b(V(?:isit)?\s*\d+[\w\s\-\/]*?)(?:\s*\$|\s{2,}|\t)/i,
    /\b(Screening(?:\s*Visit)?)\b/i,
    /\b(Baseline(?:\s*Visit)?)\b/i,
    /\b(Randomization(?:\s*Visit)?)\b/i,
    /\b(Final\s*Visit)\b/i,
    /\b(End\s*of\s*(?:Study|Treatment)\s*Visit)\b/i,
    /\b(Early\s*Termination)\b/i,
    /\b(Follow[\s\-]?Up(?:\s*Visit)?(?:\s*\d*)?)\b/i,
    /\b(Day\s*\d+)\b/i,
    /\b(Week\s*\d+)\b/i,
    /\b(Unscheduled\s*Visit)\b/i
  ];
  for (var i = 0; i < patterns.length; i++) {
    var m = line.match(patterns[i]);
    if (m) return m[1].trim();
  }
  return '';
}

function extractProcedureName_(line) {
  var patterns = [
    /\b((?:12[\s\-]?lead\s*)?ECG)\b/i,
    /\b(Physical\s*Exam(?:ination)?)\b/i,
    /\b(Vital\s*Signs?)\b/i,
    /\b(Clinical\s*Labs?)\b/i,
    /\b(Blood\s*(?:Draw|Collection|Sample))\b/i,
    /\b(Urine\s*(?:Pregnancy|Collection|Sample|Test))\b/i,
    /\b(Informed\s*Consent)\b/i,
    /\b(X[\s\-]?[Rr]ay)\b/i,
    /\b(CT\s*Scan)\b/i,
    /\b(MRI)\b/i,
    /\b(Biopsy)\b/i,
    /\b(Spirometry)\b/i,
    /\b(HbA1[Cc])\b/i,
    /\b(DEXA\s*Scan)\b/i,
    /\b(Biomarker\s*Sample)\b/i,
    /\b(PK\s*(?:Sample|Collection))\b/i
  ];
  for (var i = 0; i < patterns.length; i++) {
    var m = line.match(patterns[i]);
    if (m) return m[1].trim();
  }
  // Fallback: take text before the dollar sign
  var beforeDollar = line.split('$')[0].trim();
  if (beforeDollar.length > 5 && beforeDollar.length < 80) return beforeDollar;
  return '';
}

/* ── Tab: CTA Extracted ──────────────────────────────────────── */

function buildCTAExtractTab_(ss, ctaParsed) {
  var sheet = getOrCreateSheet_(ss, 'CTA Extracted');
  var headers = [
    'Folder', 'CTA File', 'Protocol', 'Sponsor', 'Category',
    'Item Name', 'CTA Amount', 'Line #', 'Context'
  ];
  writeHeader_(sheet, headers, '#072061');

  var rows = [];
  ctaParsed.forEach(function(cta) {
    var t = cta.terms;

    var fp = cta.folderPath || '';

    // Visits
    t.visits.forEach(function(v) {
      rows.push([fp, cta.fileName, t.protocolNumber, t.sponsor, 'Visit',
        v.name, v.amount, v.line, v.context || '']);
    });

    // Procedures
    t.procedures.forEach(function(p) {
      rows.push([fp, cta.fileName, t.protocolNumber, t.sponsor, 'Procedure',
        p.name, p.amount, p.line, p.context || '']);
    });

    // Stipends
    t.stipends.forEach(function(s) {
      rows.push([fp, cta.fileName, t.protocolNumber, t.sponsor, 'Stipend',
        s.description, s.amount, s.line, '']);
    });

    // Fees
    t.fees.forEach(function(f) {
      rows.push([fp, cta.fileName, t.protocolNumber, t.sponsor, 'Fee',
        f.description, f.amount, f.line, '']);
    });

    // If nothing was categorized, dump raw amounts
    if (!t.visits.length && !t.procedures.length && !t.stipends.length && !t.fees.length) {
      t.rawAmounts.forEach(function(r) {
        rows.push([fp, cta.fileName, t.protocolNumber, t.sponsor, 'Uncategorized',
          '', r.amount, r.line, r.context]);
      });
    }
  });

  if (rows.length) {
    sheet.getRange(2, 1, rows.length, headers.length).setValues(rows);
  }
  applyNumberFormat_(sheet, 7, rows.length, '$#,##0.00');

  // Color by category
  var catRange = sheet.getRange(2, 5, Math.max(rows.length, 1), 1);
  var rules = [];
  rules.push(SpreadsheetApp.newConditionalFormatRule()
    .whenTextEqualTo('Visit').setBackground('#c8e6c9').setRanges([catRange]).build());
  rules.push(SpreadsheetApp.newConditionalFormatRule()
    .whenTextEqualTo('Procedure').setBackground('#bbdefb').setRanges([catRange]).build());
  rules.push(SpreadsheetApp.newConditionalFormatRule()
    .whenTextEqualTo('Stipend').setBackground('#fff9c4').setRanges([catRange]).build());
  rules.push(SpreadsheetApp.newConditionalFormatRule()
    .whenTextEqualTo('Fee').setBackground('#e1bee7').setRanges([catRange]).build());
  rules.push(SpreadsheetApp.newConditionalFormatRule()
    .whenTextEqualTo('Uncategorized').setBackground('#ffccbc').setRanges([catRange]).build());
  sheet.setConditionalFormatRules(rules);

  autoResize_(sheet, headers.length);
  sheet.setColumnWidth(1, 200); // folder path
  sheet.setColumnWidth(2, 280); // file name
  sheet.setColumnWidth(9, 400); // context
}

/* ── Tab: CTA vs CRIO Comparison ─────────────────────────────── */

function buildCTAComparisonTab_(ss, ctaParsed, bqData) {
  var sheet = getOrCreateSheet_(ss, 'CTA vs CRIO');
  var headers = [
    'CTA File', 'Protocol', 'Category', 'Item Name',
    'CTA Amount', 'CRIO Amount', 'Variance', 'Variance %',
    'Match Status', 'CRIO Study Name', 'Notes'
  ];
  writeHeader_(sheet, headers, '#FF9933');

  // Build lookup indexes from BQ data
  var visitIndex = buildVisitIndex_(bqData.visitFinance);
  var procIndex = buildProcedureIndex_(bqData.procedureRevenueConfig);
  var studyIndex = buildStudyIndex_(bqData.studyFinance);

  var rows = [];

  ctaParsed.forEach(function(cta) {
    var t = cta.terms;

    // Try to match CTA to a CRIO study by protocol number
    var matchedStudy = matchCTAToStudy_(t, studyIndex, visitIndex, procIndex);

    // Compare visits
    t.visits.forEach(function(v) {
      var result = compareVisit_(v, matchedStudy, visitIndex);
      rows.push([
        cta.fileName, t.protocolNumber, 'Visit', v.name,
        v.amount, result.crioAmount, result.variance, result.variancePct,
        result.status, result.crioStudyName, result.notes
      ]);
    });

    // Compare procedures
    t.procedures.forEach(function(p) {
      var result = compareProcedure_(p, matchedStudy, procIndex);
      rows.push([
        cta.fileName, t.protocolNumber, 'Procedure', p.name,
        p.amount, result.crioAmount, result.variance, result.variancePct,
        result.status, result.crioStudyName, result.notes
      ]);
    });

    // Stipends — compare against studyFinance stipend_per_patient
    t.stipends.forEach(function(s) {
      var result = compareStipend_(s, matchedStudy, studyIndex);
      rows.push([
        cta.fileName, t.protocolNumber, 'Stipend', s.description,
        s.amount, result.crioAmount, result.variance, result.variancePct,
        result.status, result.crioStudyName, result.notes
      ]);
    });

    // Fees — no direct CRIO equivalent, just list them
    t.fees.forEach(function(f) {
      rows.push([
        cta.fileName, t.protocolNumber, 'Fee', f.description,
        f.amount, '', '', '',
        'No CRIO Equivalent', matchedStudy ? matchedStudy.study_name : '', 'Manual review needed'
      ]);
    });

    // If CTA matched a study, check for CRIO items NOT in CTA
    if (matchedStudy) {
      var crioVisits = getVisitsForStudy_(matchedStudy.study_name, visitIndex);
      crioVisits.forEach(function(cv) {
        var inCTA = t.visits.some(function(v) {
          return fuzzyMatch_(v.name, cv.visit_name) >= 0.5;
        });
        if (!inCTA && (num_(cv.revenue_per_visit) || 0) > 0) {
          rows.push([
            cta.fileName, t.protocolNumber, 'Visit', cv.visit_name,
            '', num_(cv.revenue_per_visit), '', '',
            'In CRIO Only', matchedStudy.study_name, 'Not found in CTA'
          ]);
        }
      });
    }
  });

  if (rows.length) {
    sheet.getRange(2, 1, rows.length, headers.length).setValues(rows);
  }

  applyNumberFormat_(sheet, 5, rows.length, '$#,##0.00');
  applyNumberFormat_(sheet, 6, rows.length, '$#,##0.00');
  applyNumberFormat_(sheet, 7, rows.length, '$#,##0.00');
  applyNumberFormat_(sheet, 8, rows.length, '0.0%');

  // Status color coding
  var statusRange = sheet.getRange(2, 9, Math.max(rows.length, 1), 1);
  var rules = [];
  rules.push(SpreadsheetApp.newConditionalFormatRule()
    .whenTextEqualTo('Match').setBackground('#c8e6c9').setRanges([statusRange]).build());
  rules.push(SpreadsheetApp.newConditionalFormatRule()
    .whenTextContains('Mismatch').setBackground('#ffcdd2').setRanges([statusRange]).build());
  rules.push(SpreadsheetApp.newConditionalFormatRule()
    .whenTextEqualTo('In CRIO Only').setBackground('#fff9c4').setRanges([statusRange]).build());
  rules.push(SpreadsheetApp.newConditionalFormatRule()
    .whenTextEqualTo('Not in CRIO').setBackground('#ffccbc').setRanges([statusRange]).build());
  rules.push(SpreadsheetApp.newConditionalFormatRule()
    .whenTextEqualTo('No CRIO Equivalent').setBackground('#e0e0e0').setRanges([statusRange]).build());

  // Highlight variance > 0
  var varRange = sheet.getRange(2, 7, Math.max(rows.length, 1), 1);
  rules.push(SpreadsheetApp.newConditionalFormatRule()
    .whenNumberGreaterThan(0).setBackground('#ffcdd2').setRanges([varRange]).build());
  rules.push(SpreadsheetApp.newConditionalFormatRule()
    .whenNumberLessThan(0).setBackground('#ffcdd2').setRanges([varRange]).build());

  sheet.setConditionalFormatRules(rules);

  autoResize_(sheet, headers.length);
  sheet.setColumnWidth(1, 280);
  sheet.setColumnWidth(4, 250);
  sheet.setColumnWidth(10, 320);
  sheet.setColumnWidth(11, 250);
}

/* ── Matching & Comparison Helpers ────────────────────────────── */

function buildVisitIndex_(visitData) {
  var index = {}; // studyName -> [{ visit_name, revenue_per_visit, ... }]
  visitData.forEach(function(r) {
    var name = r.study_name || '';
    if (!index[name]) index[name] = [];
    index[name].push(r);
  });
  return index;
}

function buildProcedureIndex_(procData) {
  var index = {};
  procData.forEach(function(r) {
    var name = r.study_name || '';
    if (!index[name]) index[name] = [];
    index[name].push(r);
  });
  return index;
}

function buildStudyIndex_(studyFinData) {
  var index = {};
  studyFinData.forEach(function(r) {
    var name = r.study_name || '';
    if (!index[name]) index[name] = r;
  });
  return index;
}

function getVisitsForStudy_(studyName, visitIndex) {
  return visitIndex[studyName] || [];
}

/**
 * Tries to match a CTA to a CRIO study using protocol number and sponsor.
 */
function matchCTAToStudy_(ctaTerms, studyIndex, visitIndex, procIndex) {
  var proto = (ctaTerms.protocolNumber || '').toLowerCase();
  var sponsor = (ctaTerms.sponsor || '').toLowerCase();
  var fileName = (ctaTerms.studyName || '').toLowerCase();

  // Try exact protocol match in study names
  var allStudyNames = Object.keys(studyIndex).concat(Object.keys(visitIndex)).concat(Object.keys(procIndex));
  var uniqueNames = {};
  allStudyNames.forEach(function(n) { uniqueNames[n] = true; });

  var bestMatch = null;
  var bestScore = 0;

  Object.keys(uniqueNames).forEach(function(studyName) {
    var nameLower = studyName.toLowerCase();
    var score = 0;

    // Protocol number in study name (from folder name — most reliable)
    if (proto) {
      if (nameLower.indexOf(proto) >= 0) score += 10;
      // Also try partial protocol match (e.g., folder "EZEF" matching "J3L-MC-EZEF")
      var protoParts = proto.split(/[\s\-_]+/);
      protoParts.forEach(function(pp) {
        if (pp.length >= 3 && nameLower.indexOf(pp.toLowerCase()) >= 0) score += 5;
      });
    }

    // Sponsor in study name (from folder name)
    if (sponsor) {
      var sponsorWords = sponsor.split(/[\s,]+/);
      sponsorWords.forEach(function(w) {
        if (w.length > 3 && nameLower.indexOf(w.toLowerCase()) >= 0) score += 3;
      });
    }

    // Filename match
    if (fileName) {
      var fileWords = fileName.split(/[\s\-_]+/);
      fileWords.forEach(function(w) {
        if (w.length > 3 && nameLower.indexOf(w.toLowerCase()) >= 0) score += 1;
      });
    }

    if (score > bestScore) {
      bestScore = score;
      bestMatch = studyIndex[studyName] || { study_name: studyName };
    }
  });

  if (bestScore >= 3) return bestMatch;
  return null;
}

function compareVisit_(ctaVisit, matchedStudy, visitIndex) {
  if (!matchedStudy) {
    return { crioAmount: '', variance: '', variancePct: '', status: 'Not in CRIO', crioStudyName: '', notes: 'No matching study found' };
  }

  var crioVisits = visitIndex[matchedStudy.study_name] || [];
  var bestMatch = null;
  var bestScore = 0;

  crioVisits.forEach(function(cv) {
    var score = fuzzyMatch_(ctaVisit.name, cv.visit_name);
    if (score > bestScore) {
      bestScore = score;
      bestMatch = cv;
    }
  });

  if (!bestMatch || bestScore < 0.3) {
    return { crioAmount: '', variance: '', variancePct: '', status: 'Not in CRIO', crioStudyName: matchedStudy.study_name, notes: 'Visit not found in CRIO config' };
  }

  var crioAmt = num_(bestMatch.revenue_per_visit) || 0;
  var ctaAmt = ctaVisit.amount;
  var variance = ctaAmt - crioAmt;
  var variancePct = crioAmt > 0 ? variance / crioAmt : '';

  var status;
  if (Math.abs(variance) < 0.01) status = 'Match';
  else if (Math.abs(variance) < 1) status = 'Match (rounding)';
  else status = 'Mismatch ($' + Math.abs(variance).toFixed(2) + ')';

  return {
    crioAmount: crioAmt,
    variance: variance,
    variancePct: variancePct,
    status: status,
    crioStudyName: matchedStudy.study_name,
    notes: 'Matched to: ' + bestMatch.visit_name + ' (score: ' + bestScore.toFixed(2) + ')'
  };
}

function compareProcedure_(ctaProc, matchedStudy, procIndex) {
  if (!matchedStudy) {
    return { crioAmount: '', variance: '', variancePct: '', status: 'Not in CRIO', crioStudyName: '', notes: 'No matching study found' };
  }

  var crioProcs = procIndex[matchedStudy.study_name] || [];
  var bestMatch = null;
  var bestScore = 0;

  crioProcs.forEach(function(cp) {
    var score = fuzzyMatch_(ctaProc.name, cp.procedure_name);
    if (score > bestScore) {
      bestScore = score;
      bestMatch = cp;
    }
  });

  if (!bestMatch || bestScore < 0.3) {
    return { crioAmount: '', variance: '', variancePct: '', status: 'Not in CRIO', crioStudyName: matchedStudy.study_name, notes: 'Procedure not found in CRIO config' };
  }

  // Use the highest non-zero revenue: base > ad_hoc > screen_fail
  var crioAmt = num_(bestMatch.revenue_base) || num_(bestMatch.revenue_ad_hoc) || num_(bestMatch.revenue_screen_fail) || 0;
  var ctaAmt = ctaProc.amount;
  var variance = ctaAmt - crioAmt;
  var variancePct = crioAmt > 0 ? variance / crioAmt : '';

  var status;
  if (Math.abs(variance) < 0.01) status = 'Match';
  else if (Math.abs(variance) < 1) status = 'Match (rounding)';
  else status = 'Mismatch ($' + Math.abs(variance).toFixed(2) + ')';

  return {
    crioAmount: crioAmt,
    variance: variance,
    variancePct: variancePct,
    status: status,
    crioStudyName: matchedStudy.study_name,
    notes: 'Matched to: ' + bestMatch.procedure_name + ' (score: ' + bestScore.toFixed(2) + ')'
  };
}

function compareStipend_(ctaStipend, matchedStudy, studyIndex) {
  if (!matchedStudy) {
    return { crioAmount: '', variance: '', variancePct: '', status: 'Not in CRIO', crioStudyName: '', notes: 'No matching study found' };
  }

  var studyFin = studyIndex[matchedStudy.study_name];
  if (!studyFin) {
    return { crioAmount: '', variance: '', variancePct: '', status: 'Not in CRIO', crioStudyName: matchedStudy.study_name, notes: 'No finance config' };
  }

  var crioAmt = num_(studyFin.stipend_per_patient) || 0;
  var ctaAmt = ctaStipend.amount;
  var variance = ctaAmt - crioAmt;
  var variancePct = crioAmt > 0 ? variance / crioAmt : '';

  var status;
  if (crioAmt === 0 && ctaAmt > 0) status = 'Not in CRIO';
  else if (Math.abs(variance) < 0.01) status = 'Match';
  else status = 'Mismatch ($' + Math.abs(variance).toFixed(2) + ')';

  return {
    crioAmount: crioAmt,
    variance: variance,
    variancePct: variancePct,
    status: status,
    crioStudyName: matchedStudy.study_name,
    notes: 'Compared to stipend_per_patient'
  };
}

/**
 * Simple fuzzy string matching. Returns a score 0-1.
 * Handles visit/procedure name variations (V3 vs Visit 3, etc.)
 */
function fuzzyMatch_(a, b) {
  if (!a || !b) return 0;

  // Normalize both strings
  var na = normalizeForMatch_(a);
  var nb = normalizeForMatch_(b);

  // Exact match after normalization
  if (na === nb) return 1.0;

  // One contains the other
  if (na.indexOf(nb) >= 0 || nb.indexOf(na) >= 0) return 0.8;

  // Token overlap
  var tokensA = na.split(/\s+/);
  var tokensB = nb.split(/\s+/);
  var overlap = 0;
  tokensA.forEach(function(ta) {
    tokensB.forEach(function(tb) {
      if (ta === tb && ta.length > 1) overlap++;
    });
  });
  var maxTokens = Math.max(tokensA.length, tokensB.length);
  if (maxTokens > 0) return overlap / maxTokens;

  return 0;
}

function normalizeForMatch_(s) {
  return s.toLowerCase()
    .replace(/\bvisit\b/g, 'v')
    .replace(/\bscreening\b/g, 'screen')
    .replace(/\btreatment\b/g, 'treat')
    .replace(/\brandomization\b/g, 'rand')
    .replace(/\bphysical\s*exam(?:ination)?\b/g, 'pe')
    .replace(/\binformed\s*consent\b/g, 'icf')
    .replace(/\b12[\s\-]?lead\b/g, '12lead')
    .replace(/[^\w\d\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/* ── Custom Menu (updated) ───────────────────────────────────── */

function onOpen() {
  SpreadsheetApp.getUi()
    .createMenu('CRP Finance')
    .addItem('Refresh All Data', 'buildFinanceSheet')
    .addItem('Refresh Invoices Only', 'refreshInvoicesOnly')
    .addSeparator()
    .addItem('CTA: Run Next Batch', 'buildCTAComparison')
    .addItem('CTA: Reset & Start Over', 'resetCTAProgress')
    .addSeparator()
    .addItem('CTA: List Files (fast)', 'listCTAFiles')
    .addItem('CTA: Debug Extraction', 'debugCTAExtraction')
    .addToUi();
}

function refreshInvoicesOnly() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var data = fetchFeed_('agingInvoices');
  buildInvoicesTab_(ss, data);
  SpreadsheetApp.getUi().alert('Invoices refreshed: ' + data.length + ' rows.');
}

/* ── CTA Diagnostics ─────────────────────────────────────────── */

/**
 * Run this to dump raw CTA extraction diagnostics to a "CTA Debug" tab.
 * Shows: file name, folder, text length, # dollar amounts found,
 * first 500 chars of extracted text, protocol detected, sponsor detected.
 */
function debugCTAExtraction() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var ui = SpreadsheetApp.getUi();

  ui.alert('CTA Debug', 'Scanning folder and extracting text from all PDFs.\nThis may take a few minutes.', ui.ButtonSet.OK);

  var ctaDocs = extractCTATexts_(CTA_FOLDER_ID);

  var sheet = getOrCreateSheet_(ss, 'CTA Debug');
  var headers = [
    'Folder', 'File Name', 'Text Length', '# Dollar Amounts',
    '# Visits Found', '# Procedures Found', '# Stipends Found', '# Fees Found',
    'Protocol Detected', 'Sponsor Detected',
    'First 1000 chars of text'
  ];
  writeHeader_(sheet, headers, '#072061');

  var rows = ctaDocs.map(function(doc) {
    var terms = parseCTAFinancialTerms_(doc.text, doc.fileName, doc.folderPath);
    return [
      doc.folderPath || '',
      doc.fileName,
      doc.text.length,
      terms.rawAmounts.length,
      terms.visits.length,
      terms.procedures.length,
      terms.stipends.length,
      terms.fees.length,
      terms.protocolNumber || '(none)',
      terms.sponsor || '(none)',
      doc.text.substring(0, 1000)
    ];
  });

  if (rows.length) {
    sheet.getRange(2, 1, rows.length, headers.length).setValues(rows);
  }

  // Highlight files with no dollar amounts found
  var amtRange = sheet.getRange(2, 4, Math.max(rows.length, 1), 1);
  var rules = [];
  rules.push(SpreadsheetApp.newConditionalFormatRule()
    .whenNumberEqualTo(0).setBackground('#ffcdd2').setRanges([amtRange]).build());
  rules.push(SpreadsheetApp.newConditionalFormatRule()
    .whenNumberGreaterThan(0).setBackground('#c8e6c9').setRanges([amtRange]).build());
  sheet.setConditionalFormatRules(rules);

  autoResize_(sheet, 10);
  sheet.setColumnWidth(1, 200);
  sheet.setColumnWidth(2, 300);
  sheet.setColumnWidth(11, 600);

  sheet.activate();
  ui.alert('Debug complete: ' + rows.length + ' files analyzed.\nCheck text samples and detection counts.');
}

/**
 * Quick scan: just lists all files found in the CTA folder tree.
 * No OCR, just file names/types/sizes. Fast.
 */
function listCTAFiles() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();

  // Use search API — no recursive walk needed
  var allFiles = findAllPDFsViaSearch_(CTA_FOLDER_ID);

  var sheet = getOrCreateSheet_(ss, 'CTA File List');
  var headers = ['Folder', 'Sponsor', 'Study', 'File Name', 'Size (KB)', 'Last Updated', 'SELECTED (latest)'];
  writeHeader_(sheet, headers, '#072061');

  var rows = allFiles.map(function(f) {
    return [
      f.folder,
      f.sponsor,
      f.studyFolder,
      f.file.getName(),
      Math.round(f.file.getSize() / 1024),
      f.file.getLastUpdated(),
      'Yes'
    ];
  });

  if (rows.length) {
    sheet.getRange(2, 1, rows.length, headers.length).setValues(rows);
  }

  autoResize_(sheet, headers.length);
  sheet.setColumnWidth(1, 300);
  sheet.setColumnWidth(4, 350);
  sheet.activate();
  SpreadsheetApp.getUi().alert('Found ' + rows.length + ' PDFs (latest per study, deduped from all versions).');
}

function collectAllFiles_(folder, path, results) {
  try {
    var folderName = folder.getName();
    var currentPath = path ? path + folderName + '/' : '';
    var files = folder.getFiles();
    while (files.hasNext()) {
      try { results.push({ file: files.next(), folder: currentPath }); }
      catch (e) { /* skip inaccessible file */ }
    }
    var subfolders = folder.getFolders();
    while (subfolders.hasNext()) {
      try { collectAllFiles_(subfolders.next(), currentPath, results); }
      catch (e) { /* skip inaccessible subfolder */ }
    }
  } catch (e) {
    Logger.log('Cannot access folder: ' + path + ' — ' + e.message);
  }
}

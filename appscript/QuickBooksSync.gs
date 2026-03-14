/**
 * CRP Dashboard — QuickBooks Online Integration
 *
 * Syncs financial data from QuickBooks to Google Sheets on a schedule.
 * The dashboard reads from these sheets via existing CSV feed mechanism.
 *
 * SETUP:
 *   1. Create an app at https://developer.intuit.com
 *   2. Fill in QB_CONFIG below with your Client ID, Client Secret, and Company ID
 *   3. Add the OAuth2 library: 1B7FSrk5Zi6L1rSxxTDgDEUsPzlukDsi4KGuTMorsTQHhGBzBkMun4iDF
 *      (Resources → Libraries → paste ID → Add → select latest version)
 *   4. Run authorizeQuickBooks() and follow the URL to grant access
 *   5. Add redirect URI to your Intuit app: run logRedirectUri() to get it
 *   6. Run setupQBSyncTrigger() to enable automatic sync every 4 hours
 *   7. Run syncAllQuickBooks() manually to test
 */

// ═══════════════════════════════════════════
// CONFIGURATION — edit these values
// ═══════════════════════════════════════════
var QB_CONFIG = {
  CLIENT_ID:     'YOUR_CLIENT_ID_HERE',       // From Intuit Developer Dashboard
  CLIENT_SECRET: 'YOUR_CLIENT_SECRET_HERE',   // From Intuit Developer Dashboard
  COMPANY_ID:    'YOUR_COMPANY_ID_HERE',      // Your QuickBooks Company/Realm ID

  // Set to true when ready to use production (live) data
  USE_PRODUCTION: false,

  // Google Sheet to write data into (uses the same spreadsheet as the dashboard)
  // Leave blank to auto-create tabs in the active spreadsheet
  SPREADSHEET_ID: '',

  // How far back to pull data
  START_DATE: '2025-01-01',

  // Sync schedule (hours between syncs)
  SYNC_INTERVAL_HOURS: 4,
};

// ═══════════════════════════════════════════
// QUICKBOOKS API URLS
// ═══════════════════════════════════════════
var QB_SANDBOX_URL = 'https://sandbox-quickbooks.api.intuit.com/v3/company/';
var QB_PRODUCTION_URL = 'https://quickbooks.api.intuit.com/v3/company/';

function _qbBaseUrl() {
  var base = QB_CONFIG.USE_PRODUCTION ? QB_PRODUCTION_URL : QB_SANDBOX_URL;
  return base + QB_CONFIG.COMPANY_ID;
}

// ═══════════════════════════════════════════
// OAUTH 2.0 SETUP (uses apps-script-oauth2 library)
// ═══════════════════════════════════════════

/**
 * Create the OAuth2 service for QuickBooks.
 * Library ID: 1B7FSrk5Zi6L1rSxxTDgDEUsPzlukDsi4KGuTMorsTQHhGBzBkMun4iDF
 */
function getQBService() {
  return OAuth2.createService('QuickBooks')
    .setAuthorizationBaseUrl('https://appcenter.intuit.com/connect/oauth2')
    .setTokenUrl('https://oauth.platform.intuit.com/oauth2/v1/tokens/bearer')
    .setClientId(QB_CONFIG.CLIENT_ID)
    .setClientSecret(QB_CONFIG.CLIENT_SECRET)
    .setCallbackFunction('qbAuthCallback')
    .setPropertyStore(PropertiesService.getUserProperties())
    .setScope('com.intuit.quickbooks.accounting')
    .setParam('response_type', 'code')
    .setTokenHeaders({
      'Authorization': 'Basic ' + Utilities.base64Encode(QB_CONFIG.CLIENT_ID + ':' + QB_CONFIG.CLIENT_SECRET),
      'Content-Type': 'application/x-www-form-urlencoded'
    });
}

/**
 * Step 1: Run this function, then visit the logged URL to authorize.
 */
function authorizeQuickBooks() {
  var service = getQBService();
  if (service.hasAccess()) {
    Logger.log('✅ Already authorized! Access token is valid.');
    Logger.log('Company ID: ' + QB_CONFIG.COMPANY_ID);
    return;
  }
  var authUrl = service.getAuthorizationUrl();
  Logger.log('🔗 Open this URL to authorize QuickBooks:');
  Logger.log(authUrl);
  Logger.log('');
  Logger.log('After authorizing, the callback will store your tokens automatically.');
}

/**
 * OAuth callback handler — called automatically after user authorizes.
 */
function qbAuthCallback(request) {
  var service = getQBService();
  var authorized = service.handleCallback(request);
  if (authorized) {
    return HtmlService.createHtmlOutput(
      '<h2 style="color:#059669">✅ QuickBooks Connected!</h2>' +
      '<p>You can close this tab and return to Apps Script.</p>' +
      '<p>Run <code>syncAllQuickBooks()</code> to start syncing data.</p>'
    );
  } else {
    return HtmlService.createHtmlOutput(
      '<h2 style="color:#dc2626">❌ Authorization Failed</h2>' +
      '<p>Please try again. Check that your Client ID and Secret are correct.</p>'
    );
  }
}

/**
 * Log the redirect URI — add this to your Intuit app's Redirect URIs.
 */
function logRedirectUri() {
  var service = getQBService();
  Logger.log('📋 Add this Redirect URI to your Intuit Developer app:');
  Logger.log(ScriptApp.getService().getUrl() + '?state=' + service.getServiceName());
  // Simpler: the OAuth2 library generates the correct callback URL
  Logger.log('');
  Logger.log('Or use this format:');
  Logger.log('https://script.google.com/macros/d/' + ScriptApp.getScriptId() + '/usercallback');
}

/**
 * Disconnect QuickBooks (revoke tokens).
 */
function disconnectQuickBooks() {
  getQBService().reset();
  Logger.log('🔓 QuickBooks disconnected. Run authorizeQuickBooks() to reconnect.');
}

/**
 * Check connection status.
 */
function checkQBStatus() {
  var service = getQBService();
  if (service.hasAccess()) {
    Logger.log('✅ Connected to QuickBooks');
    Logger.log('Company ID: ' + QB_CONFIG.COMPANY_ID);
    Logger.log('Environment: ' + (QB_CONFIG.USE_PRODUCTION ? 'PRODUCTION' : 'SANDBOX'));
    // Test with a simple API call
    try {
      var resp = _qbFetch('/companyinfo/' + QB_CONFIG.COMPANY_ID);
      var info = JSON.parse(resp);
      Logger.log('Company Name: ' + info.CompanyInfo.CompanyName);
      Logger.log('Country: ' + info.CompanyInfo.Country);
    } catch(e) {
      Logger.log('⚠ Connected but API test failed: ' + e.message);
    }
  } else {
    Logger.log('❌ Not connected. Run authorizeQuickBooks() first.');
  }
}

// ═══════════════════════════════════════════
// API HELPERS
// ═══════════════════════════════════════════

function _qbFetch(endpoint, params) {
  var service = getQBService();
  if (!service.hasAccess()) {
    throw new Error('QuickBooks not authorized. Run authorizeQuickBooks() first.');
  }

  var url = _qbBaseUrl() + endpoint;
  if (params) {
    var qs = Object.keys(params).map(function(k) {
      return encodeURIComponent(k) + '=' + encodeURIComponent(params[k]);
    }).join('&');
    url += (url.indexOf('?') >= 0 ? '&' : '?') + qs;
  }
  url += (url.indexOf('?') >= 0 ? '&' : '?') + 'minorversion=75';

  var options = {
    method: 'get',
    headers: {
      'Authorization': 'Bearer ' + service.getAccessToken(),
      'Accept': 'application/json'
    },
    muteHttpExceptions: true
  };

  var response = UrlFetchApp.fetch(url, options);
  var code = response.getResponseCode();

  if (code === 401) {
    // Token expired — try refresh
    service.refresh();
    options.headers.Authorization = 'Bearer ' + service.getAccessToken();
    response = UrlFetchApp.fetch(url, options);
    code = response.getResponseCode();
  }

  if (code !== 200) {
    throw new Error('QuickBooks API error ' + code + ': ' + response.getContentText().substring(0, 500));
  }

  return response.getContentText();
}

function _qbQuery(entity, where, maxResults) {
  var query = 'SELECT * FROM ' + entity;
  if (where) query += ' WHERE ' + where;
  if (maxResults) query += ' MAXRESULTS ' + maxResults;

  var all = [];
  var startPos = 1;
  var pageSize = maxResults || 1000;

  while (true) {
    var pageQuery = query + (maxResults ? '' : ' STARTPOSITION ' + startPos + ' MAXRESULTS 1000');
    var resp = _qbFetch('/query', { query: pageQuery });
    var data = JSON.parse(resp);

    var rows = data.QueryResponse[entity] || [];
    all = all.concat(rows);

    if (rows.length < 1000 || maxResults) break;
    startPos += 1000;

    // Safety: max 10 pages = 10,000 rows
    if (startPos > 10000) break;
  }

  return all;
}

// ═══════════════════════════════════════════
// SHEET HELPERS
// ═══════════════════════════════════════════

function _getSpreadsheet() {
  if (QB_CONFIG.SPREADSHEET_ID) {
    return SpreadsheetApp.openById(QB_CONFIG.SPREADSHEET_ID);
  }
  return SpreadsheetApp.getActiveSpreadsheet();
}

function _getOrCreateSheet(name) {
  var ss = _getSpreadsheet();
  var sheet = ss.getSheetByName(name);
  if (!sheet) {
    sheet = ss.insertSheet(name);
  }
  return sheet;
}

function _writeToSheet(sheetName, headers, rows) {
  var sheet = _getOrCreateSheet(sheetName);
  sheet.clearContents();

  if (rows.length === 0) {
    sheet.getRange(1, 1, 1, headers.length).setValues([headers]);
    Logger.log('  ' + sheetName + ': 0 rows (headers only)');
    return;
  }

  var data = [headers].concat(rows);
  sheet.getRange(1, 1, data.length, headers.length).setValues(data);
  Logger.log('  ' + sheetName + ': ' + rows.length + ' rows written');
}

// ═══════════════════════════════════════════
// SYNC FUNCTIONS — one per data type
// ═══════════════════════════════════════════

/**
 * Sync P&L Monthly Report
 * → Sheet: QB_PnL_Monthly
 */
function syncPnLMonthly() {
  Logger.log('📊 Syncing P&L Monthly...');

  var endDate = Utilities.formatDate(new Date(), 'America/New_York', 'yyyy-MM-dd');
  var resp = _qbFetch('/reports/ProfitAndLoss', {
    start_date: QB_CONFIG.START_DATE,
    end_date: endDate,
    summarize_column_by: 'Month',
    accounting_method: 'Accrual'
  });

  var report = JSON.parse(resp);
  var columns = report.Columns.Column;
  var headers = columns.map(function(c) { return c.ColTitle || 'Account'; });

  var rows = [];
  _flattenReportRows(report.Rows, rows, 0);

  _writeToSheet('QB_PnL_Monthly', headers, rows);
}

/** Recursively flatten QuickBooks report row structure */
function _flattenReportRows(rowGroup, output, depth) {
  if (!rowGroup || !rowGroup.Row) return;
  rowGroup.Row.forEach(function(row) {
    if (row.type === 'Data' && row.ColData) {
      output.push(row.ColData.map(function(c) { return c.value || ''; }));
    }
    if (row.Rows) {
      _flattenReportRows(row.Rows, output, depth + 1);
    }
    // Summary rows
    if (row.Summary && row.Summary.ColData) {
      output.push(row.Summary.ColData.map(function(c) { return c.value || ''; }));
    }
  });
}

/**
 * Sync Revenue by Customer (monthly breakdown)
 * → Sheet: QB_Revenue_By_Customer
 */
function syncRevenueByCustomer() {
  Logger.log('💰 Syncing Revenue by Customer...');

  var endDate = Utilities.formatDate(new Date(), 'America/New_York', 'yyyy-MM-dd');
  var resp = _qbFetch('/reports/CustomerSales', {
    start_date: QB_CONFIG.START_DATE,
    end_date: endDate,
    summarize_column_by: 'Month'
  });

  var report = JSON.parse(resp);
  var columns = report.Columns.Column;
  var headers = columns.map(function(c) { return c.ColTitle || 'Customer'; });

  var rows = [];
  _flattenReportRows(report.Rows, rows, 0);

  _writeToSheet('QB_Revenue_By_Customer', headers, rows);
}

/**
 * Sync Invoices with status (paid/unpaid/overdue)
 * → Sheet: QB_Invoices
 */
function syncInvoices() {
  Logger.log('📄 Syncing Invoices...');

  var invoices = _qbQuery('Invoice', "TxnDate >= '" + QB_CONFIG.START_DATE + "'");

  var today = Utilities.formatDate(new Date(), 'America/New_York', 'yyyy-MM-dd');
  var headers = ['Invoice #', 'Date', 'Due Date', 'Customer', 'Amount', 'Balance', 'Status', 'Days Overdue', 'Memo'];

  var rows = invoices.map(function(inv) {
    var balance = parseFloat(inv.Balance) || 0;
    var total = parseFloat(inv.TotalAmt) || 0;
    var dueDate = inv.DueDate || '';

    var status = 'Paid';
    var daysOverdue = 0;
    if (balance > 0) {
      if (dueDate && dueDate < today) {
        status = 'Overdue';
        daysOverdue = Math.floor((new Date(today) - new Date(dueDate)) / 86400000);
      } else {
        status = 'Open';
      }
    } else if (balance === 0 && total > 0) {
      status = 'Paid';
    }

    return [
      inv.DocNumber || '',
      inv.TxnDate || '',
      dueDate,
      (inv.CustomerRef ? inv.CustomerRef.name : '') || '',
      total,
      balance,
      status,
      daysOverdue,
      inv.PrivateNote || ''
    ];
  });

  // Sort by date descending
  rows.sort(function(a, b) { return (b[1] || '').localeCompare(a[1] || ''); });

  _writeToSheet('QB_Invoices', headers, rows);

  // Log summary
  var paid = rows.filter(function(r) { return r[6] === 'Paid'; }).length;
  var open = rows.filter(function(r) { return r[6] === 'Open'; }).length;
  var overdue = rows.filter(function(r) { return r[6] === 'Overdue'; }).length;
  Logger.log('  Summary: ' + paid + ' paid, ' + open + ' open, ' + overdue + ' overdue');
}

/**
 * Sync Payments (collection receipts)
 * → Sheet: QB_Payments
 */
function syncPayments() {
  Logger.log('💵 Syncing Payments...');

  var payments = _qbQuery('Payment', "TxnDate >= '" + QB_CONFIG.START_DATE + "'");

  var headers = ['Payment ID', 'Date', 'Customer', 'Amount', 'Method', 'Memo', 'Linked Invoices'];

  var rows = payments.map(function(pmt) {
    // Extract linked invoice numbers
    var linkedInvoices = '';
    if (pmt.Line) {
      linkedInvoices = pmt.Line.filter(function(l) {
        return l.LinkedTxn && l.LinkedTxn.length > 0;
      }).map(function(l) {
        return l.LinkedTxn.map(function(t) { return t.TxnType + ' #' + t.TxnId; }).join(', ');
      }).join('; ');
    }

    return [
      pmt.Id || '',
      pmt.TxnDate || '',
      (pmt.CustomerRef ? pmt.CustomerRef.name : '') || '',
      parseFloat(pmt.TotalAmt) || 0,
      (pmt.PaymentMethodRef ? pmt.PaymentMethodRef.name : '') || '',
      pmt.PrivateNote || '',
      linkedInvoices
    ];
  });

  rows.sort(function(a, b) { return (b[1] || '').localeCompare(a[1] || ''); });

  _writeToSheet('QB_Payments', headers, rows);
}

/**
 * Sync Aged Receivables report
 * → Sheet: QB_Aged_Receivables
 */
function syncAgedReceivables() {
  Logger.log('📊 Syncing Aged Receivables...');

  var resp = _qbFetch('/reports/AgedReceivables', {});

  var report = JSON.parse(resp);
  var columns = report.Columns.Column;
  var headers = columns.map(function(c) { return c.ColTitle || 'Customer'; });

  var rows = [];
  _flattenReportRows(report.Rows, rows, 0);

  _writeToSheet('QB_Aged_Receivables', headers, rows);
}

/**
 * Sync Income Gap Analysis — compares invoiced vs collected by customer
 * → Sheet: QB_Income_Gaps
 */
function syncIncomeGaps() {
  Logger.log('🔍 Computing Income Gaps...');

  // Get all invoices and payments from 2025+
  var invoices = _qbQuery('Invoice', "TxnDate >= '" + QB_CONFIG.START_DATE + "'");
  var payments = _qbQuery('Payment', "TxnDate >= '" + QB_CONFIG.START_DATE + "'");

  // Aggregate by customer
  var customerMap = {};

  invoices.forEach(function(inv) {
    var name = (inv.CustomerRef ? inv.CustomerRef.name : 'Unknown') || 'Unknown';
    if (!customerMap[name]) customerMap[name] = { invoiced: 0, collected: 0, outstanding: 0, overdueCount: 0, invoiceCount: 0 };
    customerMap[name].invoiced += parseFloat(inv.TotalAmt) || 0;
    customerMap[name].outstanding += parseFloat(inv.Balance) || 0;
    customerMap[name].invoiceCount++;
    if (inv.Balance > 0 && inv.DueDate && inv.DueDate < Utilities.formatDate(new Date(), 'America/New_York', 'yyyy-MM-dd')) {
      customerMap[name].overdueCount++;
    }
  });

  payments.forEach(function(pmt) {
    var name = (pmt.CustomerRef ? pmt.CustomerRef.name : 'Unknown') || 'Unknown';
    if (!customerMap[name]) customerMap[name] = { invoiced: 0, collected: 0, outstanding: 0, overdueCount: 0, invoiceCount: 0 };
    customerMap[name].collected += parseFloat(pmt.TotalAmt) || 0;
  });

  var headers = ['Customer', 'Total Invoiced', 'Total Collected', 'Outstanding', 'Collection Rate %', 'Gap Amount', 'Invoices', 'Overdue Count', 'Risk Level'];

  var rows = Object.keys(customerMap).map(function(name) {
    var c = customerMap[name];
    var collRate = c.invoiced > 0 ? Math.round(c.collected / c.invoiced * 100) : 0;
    var gap = c.invoiced - c.collected;
    var risk = collRate >= 90 ? 'Low' : collRate >= 70 ? 'Medium' : collRate >= 50 ? 'High' : 'Critical';

    return [name, c.invoiced, c.collected, c.outstanding, collRate, gap, c.invoiceCount, c.overdueCount, risk];
  });

  // Sort by gap amount descending (biggest gaps first)
  rows.sort(function(a, b) { return b[5] - a[5]; });

  _writeToSheet('QB_Income_Gaps', headers, rows);

  // Log top gaps
  var topGaps = rows.slice(0, 5);
  Logger.log('  Top income gaps:');
  topGaps.forEach(function(r) {
    Logger.log('    ' + r[0] + ': $' + r[5].toLocaleString() + ' gap (' + r[4] + '% collected)');
  });
}

// ═══════════════════════════════════════════
// MASTER SYNC — runs all sync functions
// ═══════════════════════════════════════════

function syncAllQuickBooks() {
  Logger.log('═══════════════════════════════════════');
  Logger.log('CRP Dashboard — QuickBooks Sync');
  Logger.log('Started: ' + new Date().toLocaleString('en-US', { timeZone: 'America/New_York' }));
  Logger.log('Environment: ' + (QB_CONFIG.USE_PRODUCTION ? 'PRODUCTION' : 'SANDBOX'));
  Logger.log('═══════════════════════════════════════');

  var service = getQBService();
  if (!service.hasAccess()) {
    Logger.log('❌ Not authorized. Run authorizeQuickBooks() first.');
    return;
  }

  var errors = [];

  try { syncPnLMonthly(); } catch(e) { Logger.log('❌ P&L Monthly failed: ' + e.message); errors.push('P&L: ' + e.message); }
  try { syncRevenueByCustomer(); } catch(e) { Logger.log('❌ Revenue by Customer failed: ' + e.message); errors.push('Revenue: ' + e.message); }
  try { syncInvoices(); } catch(e) { Logger.log('❌ Invoices failed: ' + e.message); errors.push('Invoices: ' + e.message); }
  try { syncPayments(); } catch(e) { Logger.log('❌ Payments failed: ' + e.message); errors.push('Payments: ' + e.message); }
  try { syncAgedReceivables(); } catch(e) { Logger.log('❌ Aged Receivables failed: ' + e.message); errors.push('AR: ' + e.message); }
  try { syncIncomeGaps(); } catch(e) { Logger.log('❌ Income Gaps failed: ' + e.message); errors.push('Gaps: ' + e.message); }

  Logger.log('');
  Logger.log('═══════════════════════════════════════');
  if (errors.length === 0) {
    Logger.log('✅ All syncs completed successfully!');
  } else {
    Logger.log('⚠ Completed with ' + errors.length + ' error(s):');
    errors.forEach(function(e) { Logger.log('  - ' + e); });
  }
  Logger.log('Finished: ' + new Date().toLocaleString('en-US', { timeZone: 'America/New_York' }));
  Logger.log('═══════════════════════════════════════');
}

// ═══════════════════════════════════════════
// TRIGGER MANAGEMENT
// ═══════════════════════════════════════════

function setupQBSyncTrigger() {
  // Remove existing triggers
  removeQBSyncTrigger();

  ScriptApp.newTrigger('syncAllQuickBooks')
    .timeBased()
    .everyHours(QB_CONFIG.SYNC_INTERVAL_HOURS)
    .create();

  Logger.log('✅ QuickBooks sync trigger created — runs every ' + QB_CONFIG.SYNC_INTERVAL_HOURS + ' hours');
  Logger.log('To change: edit QB_CONFIG.SYNC_INTERVAL_HOURS and run setupQBSyncTrigger() again');
}

function removeQBSyncTrigger() {
  ScriptApp.getProjectTriggers().forEach(function(t) {
    if (t.getHandlerFunction() === 'syncAllQuickBooks') {
      ScriptApp.deleteTrigger(t);
    }
  });
  Logger.log('🗑️ Removed existing QuickBooks sync triggers');
}

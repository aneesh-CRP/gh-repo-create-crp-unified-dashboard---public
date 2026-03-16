/**
 * CRP Daily Email Report — Automated via Apps Script Trigger
 *
 * Setup:
 *   1. In Apps Script editor, run setupDailyEmailTrigger() once
 *   2. Edit EMAIL_CONFIG below with your recipients
 *   3. The trigger will fire every weekday at 7am ET
 *
 * To test: run sendDailyOpsEmail() or sendDailyFullEmail() manually
 */

var EMAIL_CONFIG = {
  // Add recipient emails here
  OPS_RECIPIENTS: ['aneesh@phillyresearch.com'],
  FINANCE_RECIPIENTS: ['aneesh@phillyresearch.com'],
  TIMEZONE: 'America/New_York',
  DASHBOARD_URL: 'https://aneesh-crp.github.io/gh-repo-create-crp-unified-dashboard---public/',
  // Data source URLs (same as dashboard)
  CRIO_URL: 'https://docs.google.com/spreadsheets/d/e/2PACX-1vSQJ_QKC-ttmVuaYZokhz6NPNsMUpMe262mqAXbLocxOgGqbxHIMschUhE6FERyYwJfARhVg3wppBZS/pub?output=csv',
  LEGACY_CANCEL_URL: 'https://docs.google.com/spreadsheets/d/e/2PACX-1vRUXJxTDsr5IRByMfuLF0P3hVq_QuEw6M1MPNDwd1CaV2UZ9tnFflUwsmUKAd3xeX3_esn0c4YlrV0q/pub?gid=1487298034&single=true&output=csv'
};

/** Parse CSV text into array of objects */
function _parseCSV(text) {
  if (!text || !text.trim()) return [];
  var lines = text.replace(/\r\n/g, '\n').replace(/\r/g, '\n').split('\n').filter(function(l) { return l.trim(); });
  if (lines.length < 2) return [];
  // Handle BOM
  if (lines[0].charCodeAt(0) === 0xFEFF) lines[0] = lines[0].substring(1);
  var headers = _splitCSVLine(lines[0]);
  var rows = [];
  for (var i = 1; i < lines.length; i++) {
    var vals = _splitCSVLine(lines[i]);
    var obj = {};
    for (var j = 0; j < headers.length; j++) {
      obj[headers[j]] = (vals[j] || '').trim();
    }
    rows.push(obj);
  }
  return rows;
}

function _splitCSVLine(line) {
  var result = [], current = '', inQuote = false;
  for (var i = 0; i < line.length; i++) {
    var c = line[i];
    if (inQuote) {
      if (c === '"') {
        if (i + 1 < line.length && line[i + 1] === '"') { current += '"'; i++; }
        else inQuote = false;
      } else current += c;
    } else {
      if (c === '"') inQuote = true;
      else if (c === ',') { result.push(current); current = ''; }
      else current += c;
    }
  }
  result.push(current);
  return result;
}

/** Fetch and process dashboard data for email */
function _fetchDashboardData() {
  var crioResp = UrlFetchApp.fetch(EMAIL_CONFIG.CRIO_URL, { muteHttpExceptions: true });
  var cancelResp = UrlFetchApp.fetch(EMAIL_CONFIG.LEGACY_CANCEL_URL, { muteHttpExceptions: true });

  var allRows = _parseCSV(crioResp.getContentText());
  var legacyCancels = _parseCSV(cancelResp.getContentText());

  var today = new Date(); today.setHours(0, 0, 0, 0);
  var twoMonthsAgo = new Date(today); twoMonthsAgo.setDate(today.getDate() - 61);
  var twoMonthsAhead = new Date(today); twoMonthsAhead.setDate(today.getDate() + 61);

  // Split into upcoming vs cancelled
  var upcoming = [], cancelled = [];
  allRows.forEach(function(r) {
    var status = (r['Appointment Status'] || '').trim().toLowerCase();
    if (status === 'cancelled' || status === 'canceled') cancelled.push(r);
    else upcoming.push(r);
  });

  // Filter to active window
  var activeUpcoming = upcoming.filter(function(r) {
    var d = _parseDate(r['Scheduled Date']);
    return d && d >= today && d <= twoMonthsAhead;
  });

  // Merge cancels
  var allCancels = cancelled.slice();
  legacyCancels.forEach(function(r) { allCancels.push(r); });

  // Dedup and filter cancels to past 2 months
  var seenCancel = {};
  var recentCancels = [];
  allCancels.forEach(function(r) {
    var d = _parseDate(r['Cancel Date'] || r['Scheduled Date']);
    if (!d || d < twoMonthsAgo || d > today) return;
    var key = _normName(r['Subject Full Name']) + '|' + (r['Study Name'] || '').trim().toLowerCase() + '|' + (r['Cancel Date'] || r['Scheduled Date'] || '').trim();
    if (!seenCancel[key]) { seenCancel[key] = true; recentCancels.push(r); }
  });

  // Site breakdown
  var PENN_KEYS = { 161619:1, 162446:1, 167755:1, 167794:1, 172389:1, 173164:1 };
  function isPenn(r) {
    var k = parseInt(r['Study Key']);
    if (!isNaN(k) && PENN_KEYS[k]) return true;
    return (r['Site Name'] || '').indexOf('Penn') >= 0;
  }
  var phillyUp = 0, pennUp = 0, phillyCancel = 0, pennCancel = 0;
  activeUpcoming.forEach(function(r) { if (isPenn(r)) pennUp++; else phillyUp++; });
  recentCancels.forEach(function(r) { if (isPenn(r)) pennCancel++; else phillyCancel++; });

  // Risk flags: 2+ cancel events + upcoming visit
  var cancelEventMap = {}, cancelMeta = {};
  recentCancels.forEach(function(r) {
    var key = _normName(r['Subject Full Name']) + '|' + (r['Study Name'] || '').trim().toLowerCase();
    var cd = (r['Cancel Date'] || '').substring(0, 10);
    if (!cancelEventMap[key]) cancelEventMap[key] = {};
    cancelEventMap[key][cd] = true;
    if (!cancelMeta[key] || cd > (cancelMeta[key].last || '')) {
      cancelMeta[key] = { last: cd, patient: (r['Subject Full Name'] || '').trim(), study: (r['Study Name'] || '').split(' - ').pop().trim() };
    }
  });
  var upcomingPats = {};
  activeUpcoming.forEach(function(r) {
    var key = _normName(r['Subject Full Name']) + '|' + (r['Study Name'] || '').trim().toLowerCase();
    var d = _parseDate(r['Scheduled Date']);
    if (!upcomingPats[key] || d < upcomingPats[key].date) {
      upcomingPats[key] = { date: d, dateStr: d ? Utilities.formatDate(d, EMAIL_CONFIG.TIMEZONE, 'MMM d') : '' };
    }
  });
  var riskFlags = [];
  for (var k in cancelEventMap) {
    var count = Object.keys(cancelEventMap[k]).length;
    if (count >= 2 && upcomingPats[k]) {
      var meta = cancelMeta[k] || {};
      riskFlags.push({ patient: meta.patient || k.split('|')[0], study: meta.study || k.split('|')[1], cancels: count, nextVisit: upcomingPats[k].dateStr, lastCancel: meta.last || '' });
    }
  }
  riskFlags.sort(function(a, b) { return (upcomingPats[_normName(a.patient) + '|' + a.study.toLowerCase()] || {}).date - (upcomingPats[_normName(b.patient) + '|' + b.study.toLowerCase()] || {}).date; });

  // Undocumented cancellations
  var undocumented = recentCancels.filter(function(r) { return !(r['Cancel Reason'] || '').trim(); });

  // No-shows
  var noShows = recentCancels.filter(function(r) { return (r['Appointment Cancellation Type'] || '').trim() === 'No Show'; });

  // Coordinator workload
  var coordMap = {};
  activeUpcoming.forEach(function(r) {
    var c = (r['Full Name'] || '').trim();
    if (!c) return;
    if (!coordMap[c]) coordMap[c] = { name: c, upcoming: 0, cancels: 0 };
    coordMap[c].upcoming++;
  });
  recentCancels.forEach(function(r) {
    var c = (r['Staff Full Name'] || r['Full Name'] || '').trim();
    if (!c) return;
    if (!coordMap[c]) coordMap[c] = { name: c, upcoming: 0, cancels: 0 };
    coordMap[c].cancels++;
  });
  var coordinators = [];
  for (var cn in coordMap) coordinators.push(coordMap[cn]);
  coordinators.sort(function(a, b) { return b.upcoming - a.upcoming; });

  return {
    upcomingTotal: activeUpcoming.length,
    cancelTotal: recentCancels.length,
    cancelRate: activeUpcoming.length ? ((recentCancels.length / (activeUpcoming.length + recentCancels.length)) * 100).toFixed(1) : '0',
    phillyUp: phillyUp, pennUp: pennUp,
    phillyCancel: phillyCancel, pennCancel: pennCancel,
    riskFlags: riskFlags,
    undocumented: undocumented.length,
    noShows: noShows.length,
    coordinators: coordinators
  };
}

function _normName(n) { return (n || '').replace(/\s{2,}/g, ' ').trim().toLowerCase(); }

function _parseDate(s) {
  if (!s) return null;
  var t = s.trim();
  var d = /^\d{4}-\d{2}-\d{2}$/.test(t) ? new Date(t + 'T00:00:00') : new Date(t);
  return isNaN(d.getTime()) ? null : d;
}

/** Generate operations email HTML (no financials) */
function _buildOpsEmailHTML(data) {
  var today = new Date();
  var dateStr = Utilities.formatDate(today, EMAIL_CONFIG.TIMEZONE, 'EEEE, MMMM d, yyyy');
  var url = EMAIL_CONFIG.DASHBOARD_URL;
  var cr = parseFloat(data.cancelRate);

  var html = '<div style="font-family:Arial,Helvetica,sans-serif;max-width:700px;margin:0 auto;color:#1e293b;">';

  // Header
  html += '<div style="background:#072061;color:white;padding:20px 24px;border-radius:8px 8px 0 0;">';
  html += '<h1 style="margin:0;font-size:20px;">CRP Daily Operations Brief</h1>';
  html += '<p style="margin:4px 0 0;font-size:13px;opacity:0.8;">' + dateStr + '</p>';
  html += '</div>';

  // KPI Summary
  html += '<div style="background:#f8fafc;padding:16px 24px;border-bottom:2px solid #e2e8f0;">';
  html += '<table style="width:100%;border-collapse:collapse;text-align:center;"><tr>';
  html += '<td style="padding:8px;"><div style="font-size:24px;font-weight:700;color:#072061;">' + data.upcomingTotal + '</div><div style="font-size:11px;color:#64748b;">Upcoming</div></td>';
  html += '<td style="padding:8px;"><div style="font-size:24px;font-weight:700;color:#dc2626;">' + data.cancelTotal + '</div><div style="font-size:11px;color:#64748b;">Cancellations</div></td>';
  html += '<td style="padding:8px;"><div style="font-size:24px;font-weight:700;color:' + (cr > 15 ? '#dc2626' : '#059669') + ';">' + data.cancelRate + '%</div><div style="font-size:11px;color:#64748b;">Cancel Rate</div></td>';
  html += '<td style="padding:8px;"><div style="font-size:24px;font-weight:700;color:#d97706;">' + data.riskFlags.length + '</div><div style="font-size:11px;color:#64748b;">At-Risk</div></td>';
  html += '</tr></table></div>';

  // Site Breakdown
  html += '<div style="padding:16px 24px;border-bottom:1px solid #e2e8f0;">';
  html += '<h3 style="margin:0 0 8px;font-size:14px;color:#072061;">Site Breakdown</h3>';
  html += '<table style="width:100%;border-collapse:collapse;font-size:12px;">';
  html += '<tr style="background:#f1f5f9;"><th style="padding:6px 10px;text-align:left;">Site</th><th style="text-align:right;padding:6px 10px;">Upcoming</th><th style="text-align:right;padding:6px 10px;">Cancels</th><th style="text-align:right;padding:6px 10px;">Cancel Rate</th></tr>';
  var phlRate = ((data.phillyCancel / (data.phillyUp + data.phillyCancel || 1)) * 100).toFixed(1);
  var pnjRate = ((data.pennCancel / (data.pennUp + data.pennCancel || 1)) * 100).toFixed(1);
  html += '<tr><td style="padding:6px 10px;">Philadelphia, PA</td><td style="text-align:right;padding:6px 10px;">' + data.phillyUp + '</td><td style="text-align:right;padding:6px 10px;">' + data.phillyCancel + '</td><td style="text-align:right;padding:6px 10px;">' + phlRate + '%</td></tr>';
  html += '<tr><td style="padding:6px 10px;">Pennington, NJ</td><td style="text-align:right;padding:6px 10px;">' + data.pennUp + '</td><td style="text-align:right;padding:6px 10px;">' + data.pennCancel + '</td><td style="text-align:right;padding:6px 10px;">' + pnjRate + '%</td></tr>';
  html += '</table></div>';

  // Action Items
  html += '<div style="padding:16px 24px;">';
  html += '<h2 style="margin:0 0 16px;font-size:16px;color:#072061;border-bottom:2px solid #072061;padding-bottom:6px;">Action Items</h2>';

  // Urgent calls
  var urgentFlags = data.riskFlags.filter(function(f) { return true; }); // all risk flags are actionable
  if (urgentFlags.length) {
    html += '<div style="background:#fef2f2;border-left:4px solid #dc2626;padding:12px 16px;margin-bottom:12px;border-radius:0 6px 6px 0;">';
    html += '<h4 style="margin:0 0 8px;color:#dc2626;font-size:13px;">AT-RISK PATIENTS — ' + urgentFlags.length + ' with 2+ cancellations</h4>';
    html += '<table style="width:100%;border-collapse:collapse;font-size:12px;">';
    html += '<tr style="border-bottom:1px solid #fecaca;"><th style="text-align:left;padding:4px 6px;">Patient</th><th style="text-align:left;padding:4px 6px;">Study</th><th style="text-align:right;padding:4px 6px;">Cancels</th><th style="text-align:right;padding:4px 6px;">Next Visit</th></tr>';
    urgentFlags.slice(0, 20).forEach(function(f) {
      html += '<tr style="border-bottom:1px solid #fef2f2;"><td style="padding:4px 6px;font-weight:600;">' + _esc(f.patient) + '</td><td style="padding:4px 6px;">' + _esc(f.study) + '</td><td style="text-align:right;padding:4px 6px;color:#dc2626;font-weight:700;">' + f.cancels + '</td><td style="text-align:right;padding:4px 6px;">' + f.nextVisit + '</td></tr>';
    });
    if (urgentFlags.length > 20) html += '<tr><td colspan="4" style="padding:4px 6px;color:#94a3b8;">+' + (urgentFlags.length - 20) + ' more</td></tr>';
    html += '</table>';
    html += '<p style="font-size:11px;color:#991b1b;margin:8px 0 0;font-style:italic;">Call each patient before their next visit. Confirm attendance and surface barriers.</p>';
    html += '</div>';
  }

  // Undocumented
  if (data.undocumented > 0) {
    html += '<div style="background:#fef3c7;border-left:4px solid #f59e0b;padding:12px 16px;margin-bottom:12px;border-radius:0 6px 6px 0;">';
    html += '<h4 style="margin:0 0 4px;color:#92400e;font-size:13px;">DOCUMENTATION REQUIRED — ' + data.undocumented + ' cancellation' + (data.undocumented > 1 ? 's' : '') + ' missing reasons</h4>';
    html += '<p style="font-size:11px;color:#92400e;margin:4px 0 0;font-style:italic;">Coordinators: log into CRIO and add the cancellation reason for each patient.</p>';
    html += '</div>';
  }

  // No-shows
  if (data.noShows > 0) {
    html += '<div style="background:#fdf4ff;border-left:4px solid #7c3aed;padding:12px 16px;margin-bottom:12px;border-radius:0 6px 6px 0;">';
    html += '<h4 style="margin:0 0 4px;color:#5b21b6;font-size:13px;">NO-SHOWS — ' + data.noShows + ' patient' + (data.noShows > 1 ? 's' : '') + '</h4>';
    html += '<p style="font-size:11px;color:#5b21b6;margin:4px 0 0;font-style:italic;">Text + call each patient. Confirm upcoming visits or reschedule. Log all attempts in CRIO.</p>';
    html += '</div>';
  }

  // Coordinator workload
  if (data.coordinators.length) {
    html += '<div style="background:#f8fafc;border-left:4px solid #475569;padding:12px 16px;margin-bottom:12px;border-radius:0 6px 6px 0;">';
    html += '<h4 style="margin:0 0 8px;color:#475569;font-size:13px;">COORDINATOR WORKLOAD</h4>';
    html += '<table style="width:100%;border-collapse:collapse;font-size:12px;">';
    html += '<tr style="background:#f1f5f9;"><th style="text-align:left;padding:4px 6px;">Coordinator</th><th style="text-align:right;padding:4px 6px;">Upcoming</th><th style="text-align:right;padding:4px 6px;">Cancels</th><th style="text-align:right;padding:4px 6px;">Cancel Rate</th></tr>';
    data.coordinators.slice(0, 15).forEach(function(c) {
      var rate = ((c.cancels / (c.upcoming + c.cancels || 1)) * 100).toFixed(1);
      html += '<tr style="border-bottom:1px solid #f1f5f9;"><td style="padding:4px 6px;">' + _esc(c.name) + '</td><td style="text-align:right;padding:4px 6px;">' + c.upcoming + '</td><td style="text-align:right;padding:4px 6px;">' + c.cancels + '</td><td style="text-align:right;padding:4px 6px;color:' + (parseFloat(rate) > 20 ? '#dc2626' : '#059669') + ';font-weight:600;">' + rate + '%</td></tr>';
    });
    html += '</table></div>';
  }

  html += '</div>';

  // Footer
  html += '<div style="background:#f1f5f9;padding:12px 24px;border-radius:0 0 8px 8px;font-size:11px;color:#64748b;text-align:center;">';
  html += '<a href="' + url + '" style="color:#2563eb;font-weight:600;">Open Live Dashboard</a>';
  html += ' · Auto-generated ' + Utilities.formatDate(today, EMAIL_CONFIG.TIMEZONE, 'h:mm a z');
  html += '</div></div>';

  return html;
}

function _esc(s) { return (s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'); }

/** Send the daily operations email (no financials) */
function sendDailyOpsEmail() {
  var data = _fetchDashboardData();
  var html = _buildOpsEmailHTML(data);
  var today = new Date();
  var dateStr = Utilities.formatDate(today, EMAIL_CONFIG.TIMEZONE, 'MMM d');
  var subject = 'CRP Daily Ops Brief — ' + dateStr + ' | ' + data.upcomingTotal + ' upcoming, ' + data.cancelTotal + ' cancels (' + data.cancelRate + '%)';

  EMAIL_CONFIG.OPS_RECIPIENTS.forEach(function(email) {
    MailApp.sendEmail({
      to: email,
      subject: subject,
      htmlBody: html
    });
  });

  Logger.log('Daily ops email sent to: ' + EMAIL_CONFIG.OPS_RECIPIENTS.join(', '));
}

/** Send the full report email (with financial summary) */
function sendDailyFullEmail() {
  var data = _fetchDashboardData();
  var html = _buildOpsEmailHTML(data);
  // Note: Finance data requires separate fetch — add when finance CSV URLs are configured
  var today = new Date();
  var dateStr = Utilities.formatDate(today, EMAIL_CONFIG.TIMEZONE, 'MMM d');
  var subject = 'CRP Full Daily Report — ' + dateStr + ' | ' + data.upcomingTotal + ' upcoming, ' + data.cancelTotal + ' cancels (' + data.cancelRate + '%)';

  EMAIL_CONFIG.FINANCE_RECIPIENTS.forEach(function(email) {
    MailApp.sendEmail({
      to: email,
      subject: subject,
      htmlBody: html
    });
  });

  Logger.log('Daily full email sent to: ' + EMAIL_CONFIG.FINANCE_RECIPIENTS.join(', '));
}

/** Set up the daily email trigger (run this once manually) */
function setupDailyEmailTrigger() {
  // Remove existing triggers for this function
  ScriptApp.getProjectTriggers().forEach(function(t) {
    if (t.getHandlerFunction() === 'sendDailyOpsEmail') ScriptApp.deleteTrigger(t);
  });

  // Create weekday 7am ET trigger
  ScriptApp.newTrigger('sendDailyOpsEmail')
    .timeBased()
    .everyDays(1)
    .atHour(7)
    .nearMinute(0)
    .inTimezone(EMAIL_CONFIG.TIMEZONE)
    .create();

  Logger.log('Daily email trigger created: sendDailyOpsEmail at 7am ' + EMAIL_CONFIG.TIMEZONE + ' every day');
}

/** Remove the daily email trigger */
function removeDailyEmailTrigger() {
  ScriptApp.getProjectTriggers().forEach(function(t) {
    if (t.getHandlerFunction() === 'sendDailyOpsEmail') {
      ScriptApp.deleteTrigger(t);
      Logger.log('Removed trigger: ' + t.getHandlerFunction());
    }
  });
}

/**
 * CRP Unified Intelligence Dashboard — Web App Handler
 *
 * This file serves the dashboard HTML as a Google Apps Script web app.
 * Deploy with: Execute as "Me", Access "Anyone within phillyresearch.com"
 *
 * This provides automatic Google Workspace SSO authentication,
 * restricting access to your organization's domain only.
 */

function include(filename) {
  return HtmlService.createHtmlOutputFromFile(filename).getContent();
}

function doGet(e) {
  var html = HtmlService.createHtmlOutputFromFile('Dashboard')
    .setTitle('CRP · Unified Intelligence Dashboard')
    .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL)
    .addMetaTag('viewport', 'width=device-width, initial-scale=1')
    .setWidth(1600)
    .setHeight(10000);
  return html;
}

/**
 * Returns a specific chunk of the dashboard JavaScript.
 * JS is split into multiple chunks (<200KB each) to stay under
 * google.script.run's return value size limit (~256KB).
 * Called from client-side async loader to reassemble and execute.
 */
function getDashboardJSChunk(index) {
  var filename = 'DashboardJS_' + index;
  return HtmlService.createHtmlOutputFromFile(filename).getContent();
}

/**
 * Server-side URL fetch proxy.
 * Called from client-side via google.script.run to bypass iframe CSP restrictions.
 * Fetches a URL using UrlFetchApp and returns the text content.
 */
function proxyFetch(url) {
  try {
    var response = UrlFetchApp.fetch(url, {
      muteHttpExceptions: true,
      followRedirects: true
    });
    return {
      status: response.getResponseCode(),
      text: response.getContentText()
    };
  } catch (e) {
    return { status: 0, text: '', error: e.message };
  }
}

/**
 * Batch fetch multiple URLs at once (reduces round-trips).
 * Returns an array of {status, text} in the same order as input URLs.
 */
function proxyFetchBatch(urls) {
  return urls.map(function(url) {
    return proxyFetch(url);
  });
}

/**
 * Returns the email of the currently authenticated user.
 * Can be called from client-side JS via google.script.run
 * to display who is logged in or for audit logging.
 */
function getCurrentUserEmail() {
  return Session.getActiveUser().getEmail();
}

/**
 * Returns basic session info for audit/logging purposes.
 */
function getSessionInfo() {
  return {
    user: Session.getActiveUser().getEmail(),
    effectiveUser: Session.getEffectiveUser().getEmail(),
    timestamp: new Date().toISOString(),
    timezone: Session.getScriptTimeZone()
  };
}

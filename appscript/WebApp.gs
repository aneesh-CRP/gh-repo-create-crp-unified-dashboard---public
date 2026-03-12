/**
 * CRP Unified Intelligence Dashboard — Web App Handler
 *
 * This file serves the dashboard HTML as a Google Apps Script web app.
 * Deploy with: Execute as "Me", Access "Anyone within phillyresearch.com"
 *
 * This provides automatic Google Workspace SSO authentication,
 * restricting access to your organization's domain only.
 */

function doGet(e) {
  var html = HtmlService.createHtmlOutputFromFile('Dashboard')
    .setTitle('CRP · Unified Intelligence Dashboard')
    .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL)
    .addMetaTag('viewport', 'width=device-width, initial-scale=1');
  return html;
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

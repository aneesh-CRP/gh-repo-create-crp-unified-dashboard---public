/**
 * CRP Dashboard — BigQuery Direct API
 *
 * Cloud Function that queries CRIO BigQuery and returns CSV/JSON.
 * Replaces the Google Sheets CSV pipeline for sub-second data freshness.
 *
 * Usage: GET /?feed=visits&format=csv
 * Feeds: visits, cancels, studies, subjects, studyStatus, auditLog, patientDB
 *
 * Adding a new feed:
 *   1. Add a new entry to FEEDS with { query: 'SELECT ...', headers: {...} }
 *   2. Deploy: gcloud functions deploy crp-bq-api --trigger-http --allow-unauthenticated
 *   3. Dashboard: add URL to CRP_CONFIG.DATA_FEEDS
 */

const { BigQuery } = require('@google-cloud/bigquery');
const functions = require('@google-cloud/functions-framework');
const https = require('https');

const PROJECT = 'crio-468120';
const DATASET = 'crio_data';
function tbl(name) { return '`' + PROJECT + '.' + DATASET + '.' + name + '`'; }

// Use user credentials (refresh token) to access Fivetran-managed authorized views
// The default service account can't read through authorized views — only the user who
// set up Fivetran has access. We use the clasp OAuth refresh token to get access tokens.
const OAUTH = {
  clientId: process.env.OAUTH_CLIENT_ID || '',
  clientSecret: process.env.OAUTH_CLIENT_SECRET || '',
  refreshToken: process.env.OAUTH_REFRESH_TOKEN || '',
};

let _cachedToken = null;
let _tokenExpiry = 0;

async function getAccessToken() {
  if (_cachedToken && Date.now() < _tokenExpiry - 60000) return _cachedToken;
  const params = new URLSearchParams({
    client_id: OAUTH.clientId, client_secret: OAUTH.clientSecret,
    refresh_token: OAUTH.refreshToken, grant_type: 'refresh_token'
  });
  return new Promise((resolve, reject) => {
    const req = https.request('https://oauth2.googleapis.com/token', {
      method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }
    }, res => {
      let d = ''; res.on('data', c => d += c);
      res.on('end', () => {
        try {
          const j = JSON.parse(d);
          _cachedToken = j.access_token;
          _tokenExpiry = Date.now() + (j.expires_in || 3600) * 1000;
          resolve(_cachedToken);
        } catch (e) { reject(new Error('Token refresh failed: ' + d)); }
      });
    });
    req.on('error', reject);
    req.write(params.toString());
    req.end();
  });
}

// Create BQ client — uses user token if OAuth env vars are set, otherwise default SA
function getBqClient() {
  if (OAUTH.refreshToken) {
    return { userAuth: true };
  }
  return { client: new BigQuery({ projectId: PROJECT }) };
}

function httpPost(url, body, token) {
  return new Promise((resolve, reject) => {
    const u = new URL(url);
    const req = https.request({ hostname: u.hostname, path: u.pathname + u.search, method: 'POST',
      headers: { 'Authorization': 'Bearer ' + token, 'Content-Type': 'application/json' }
    }, res => { let d = ''; res.on('data', c => d += c); res.on('end', () => resolve(d)); });
    req.on('error', reject); req.write(body); req.end();
  });
}

function httpGet(url, token) {
  return new Promise((resolve, reject) => {
    const u = new URL(url);
    const req = https.request({ hostname: u.hostname, path: u.pathname + u.search, method: 'GET',
      headers: { 'Authorization': 'Bearer ' + token }
    }, res => { let d = ''; res.on('data', c => d += c); res.on('end', () => resolve(d)); });
    req.on('error', reject); req.end();
  });
}

// In-memory query cache (2-min TTL, max 100 entries)
const _queryCache = new Map();
const _CACHE_TTL = 300000; // 5 min cache — BQ data doesn't change minute-to-minute
function _cachePrune() { if (_queryCache.size > 100) { const oldest = [..._queryCache.entries()].sort((a,b) => a[1].t - b[1].t); for (let i = 0; i < 20; i++) _queryCache.delete(oldest[i][0]); } }

async function runQuery(sql) {
  const cacheKey = sql.trim();
  const cached = _queryCache.get(cacheKey);
  if (cached && Date.now() - cached.t < _CACHE_TTL) return cached.rows;
  if (OAUTH.refreshToken) {
    // Use REST API with user token + pagination
    const token = await getAccessToken();
    const body = JSON.stringify({ query: sql, useLegacySql: false, maxResults: 50000, timeoutMs: 60000 });
    const firstResult = await httpPost(`https://bigquery.googleapis.com/bigquery/v2/projects/${PROJECT}/queries`, body, token);
    const j = JSON.parse(firstResult);
    if (j.error) throw new Error(j.error.message);
    const schema = (j.schema?.fields || []).map(f => f.name);
    const parseRows = (rows) => (rows || []).map(r => {
      const obj = {};
      r.f.forEach((c, i) => { obj[schema[i]] = c.v || ''; });
      return obj;
    });
    let allRows = parseRows(j.rows);
    // Paginate if needed
    let pageToken = j.pageToken;
    const jobId = j.jobReference?.jobId;
    while (pageToken && jobId) {
      const url = `https://bigquery.googleapis.com/bigquery/v2/projects/${PROJECT}/queries/${jobId}?pageToken=${pageToken}&maxResults=50000`;
      const pageResult = await httpGet(url, token);
      const p = JSON.parse(pageResult);
      allRows = allRows.concat(parseRows(p.rows));
      pageToken = p.pageToken;
    }
    _queryCache.set(cacheKey, { rows: allRows, t: Date.now() }); _cachePrune();
    return allRows;
  }
  // Fallback: use default SA
  const bq = new BigQuery({ projectId: PROJECT });
  const [rows] = await bq.query({ query: sql, location: 'US' });
  _queryCache.set(cacheKey, { rows, t: Date.now() }); _cachePrune();
  return rows;
}

// ═══════════════════════════════════════════════════════════
// QUERY REGISTRY — add new feeds here
// ═══════════════════════════════════════════════════════════

const STUDY_NAME_SQL = `CASE
  WHEN COALESCE(st.nickname, '') != '' THEN st.nickname
  WHEN spon.name IS NOT NULL AND COALESCE(st.protocol_number, '') != '' THEN CONCAT(spon.name, ' - ', st.protocol_number)
  WHEN COALESCE(st.protocol_number, '') != '' THEN st.protocol_number
  ELSE '' END`;

const SUBJECT_NAME_SQL = `REGEXP_REPLACE(TRIM(CONCAT(COALESCE(sub.first_name, ''), ' ', COALESCE(sub.middle_name, ''), ' ', COALESCE(sub.last_name, ''))), r'\\s+', ' ')`;

// Reusable filter: exclude test/config/event studies from all feeds
const STUDY_FILTER_SQL = `AND LOWER(CONCAT(COALESCE(st.nickname, ''), ' ', COALESCE(st.protocol_number, ''))) NOT LIKE '%test%'
      AND LOWER(CONCAT(COALESCE(st.nickname, ''), ' ', COALESCE(st.protocol_number, ''))) NOT LIKE '%demo%'
      AND LOWER(CONCAT(COALESCE(st.nickname, ''), ' ', COALESCE(st.protocol_number, ''))) NOT LIKE '%sandbox%'
      AND LOWER(CONCAT(COALESCE(st.nickname, ''), ' ', COALESCE(st.protocol_number, ''))) NOT LIKE '%config study%'
      AND LOWER(CONCAT(COALESCE(st.nickname, ''), ' ', COALESCE(st.protocol_number, ''))) NOT LIKE '%covid_flu_rsv%'
      AND LOWER(COALESCE(st.protocol_number, '')) NOT IN ('event', 'j2a-mc-gzps')
      AND LOWER(CONCAT(COALESCE(st.nickname, ''), ' ', COALESCE(st.protocol_number, ''))) NOT LIKE '%pre-screen%'
      AND st.status != 0`;

const SUBJECT_STATUS_SQL = `CASE sub.status
  WHEN -2 THEN 'Not Interested' WHEN -1 THEN 'Not Eligible'
  WHEN 1 THEN 'Interested' WHEN 2 THEN 'Prequalified'
  WHEN 3 THEN 'No Show/Cancelled V1' WHEN 4 THEN 'Scheduled V1'
  WHEN 10 THEN 'Screening' WHEN 11 THEN 'Enrolled'
  WHEN 12 THEN 'Screen Fail' WHEN 13 THEN 'Discontinued'
  WHEN 20 THEN 'Completed' ELSE CAST(sub.status AS STRING) END`;

const STUDY_STATUS_SQL = `CASE st.status
  WHEN 0 THEN 'Configuring' WHEN 1 THEN 'Startup'
  WHEN 2 THEN 'Enrolling' WHEN 3 THEN 'Maintenance'
  WHEN 4 THEN 'Pre-Closed' WHEN 10 THEN 'Closed'
  WHEN 11 THEN 'Suspended' WHEN 12 THEN 'Withdrawn'
  ELSE CAST(st.status AS STRING) END`;

const PHASE_SQL = `CASE ct.phase
  WHEN 1 THEN 'Phase I' WHEN 2 THEN 'Phase II'
  WHEN 3 THEN 'Phase III' WHEN 4 THEN 'Phase IV' ELSE '' END`;

const FEEDS = {

  // ── 1. Upcoming Visits ──
  visits: {
    query: (params) => `SELECT
      ${STUDY_NAME_SQL} AS study_name,
      CAST(ca.study_key AS STRING) AS study_key,
      FORMAT_DATETIME('%Y-%m-%d', ca.start) AS scheduled_date,
      FORMAT_DATETIME('%H:%M', ca.start) AS scheduled_time,
      DATETIME_DIFF(ca.\`end\`, ca.start, MINUTE) AS duration_min,
      ${SUBJECT_NAME_SQL} AS subject_full_name,
      CAST(ca.subject_key AS STRING) AS subject_key_back_end,
      COALESCE(sc.name, '') AS full_name,
      CASE ca.status WHEN 0 THEN 'Cancelled' ELSE 'Active' END AS appointment_status,
      COALESCE(sv.name, '') AS visit_name,
      ${SUBJECT_STATUS_SQL} AS subject_status,
      COALESCE(sub.patient_id, '') AS subject_id,
      CASE WHEN ca.status = 0 THEN FORMAT_DATETIME('%Y-%m-%d', ca.cancel_date) ELSE '' END AS cancel_date,
      CASE WHEN ca.status = 0 THEN COALESCE(REGEXP_REPLACE(ca.cancel_reason, r'[\\x00-\\x1f]', ' '), '') ELSE '' END AS cancel_reason,
      CASE WHEN ca.status = 0 THEN CASE ca.cancel_type WHEN 1 THEN 'No Show' WHEN 2 THEN 'Site Cancelled' WHEN 3 THEN 'Patient Cancelled' ELSE '' END ELSE '' END AS appointment_cancellation_type,
      COALESCE(sc.name, '') AS staff_full_name,
      COALESCE(si.name, '') AS site_name,
      COALESCE(sub.mobile_phone, '') AS mobile_phone,
      CAST(ca.calendar_appointment_key AS STRING) AS calendar_appointment_key,
      CASE ca.type WHEN 0 THEN 'Regular Visit' WHEN 1 THEN 'Ad Hoc Visit' WHEN 2 THEN 'General Appointment' WHEN 3 THEN 'Block' ELSE '' END AS appointment_type,
      COALESCE(sp.name, '') AS investigator,
      FORMAT_DATETIME('%Y-%m-%d', CURRENT_DATETIME()) AS snapshot_date
    FROM ${tbl('calendar_appointment')} ca
    LEFT JOIN ${tbl('subject')} sub ON ca.subject_key = sub.subject_key
    LEFT JOIN ${tbl('study')} st ON ca.study_key = st.study_key
    LEFT JOIN ${tbl('sponsor')} spon ON st.sponsor_key = spon.sponsor_key
    LEFT JOIN ${tbl('site')} si ON ca.site_key = si.site_key
    LEFT JOIN ${tbl('study_visit')} sv ON ca.study_visit_key = sv.study_visit_key
    LEFT JOIN (SELECT ua.calendar_appointment_key, CONCAT(u.first_name, ' ', u.last_name) AS name
      FROM ${tbl('user_appointment')} ua
      JOIN ${tbl('study_user')} su ON ua.user_key = su.user_key AND ua.study_key = su.study_key AND su.role = 2
      JOIN ${tbl('user')} u ON ua.user_key = u.user_key
      WHERE ua._fivetran_deleted = false AND su._fivetran_deleted = false
      QUALIFY ROW_NUMBER() OVER (PARTITION BY ua.calendar_appointment_key ORDER BY ua.date_created DESC) = 1) sc ON ca.calendar_appointment_key = sc.calendar_appointment_key
    LEFT JOIN (SELECT ua.calendar_appointment_key, CONCAT(u.first_name, ' ', u.last_name) AS name
      FROM ${tbl('user_appointment')} ua
      JOIN ${tbl('study_user')} su ON ua.user_key = su.user_key AND ua.study_key = su.study_key AND su.role = 1
      JOIN ${tbl('user')} u ON ua.user_key = u.user_key
      WHERE ua._fivetran_deleted = false AND su._fivetran_deleted = false
      QUALIFY ROW_NUMBER() OVER (PARTITION BY ua.calendar_appointment_key ORDER BY ua.date_created DESC) = 1) sp ON ca.calendar_appointment_key = sp.calendar_appointment_key
    WHERE ca.subject_key IS NOT NULL AND st.is_active = 1      AND ca.start >= DATETIME_SUB(CURRENT_DATETIME(), INTERVAL ${parseInt((params||{}).lookback) || 90} DAY)
      AND ca.start <= DATETIME_ADD(CURRENT_DATETIME(), INTERVAL 365 DAY)
      ${STUDY_FILTER_SQL}
    ORDER BY ca.start ASC`,
    headers: {
      study_name: 'Study Name', study_key: 'Study Key', scheduled_date: 'Scheduled Date', scheduled_time: 'Scheduled Time',
      subject_full_name: 'Subject Full Name', subject_key_back_end: 'Subject Key (Back End)',
      full_name: 'Full Name', appointment_status: 'Appointment Status', visit_name: 'Name',
      subject_status: 'Subject Status', subject_id: 'Subject ID', cancel_date: 'Cancel Date',
      cancel_reason: 'Cancel Reason', appointment_cancellation_type: 'Appointment Cancellation Type',
      staff_full_name: 'Staff Full Name', site_name: 'Site Name', mobile_phone: 'Mobile Phone',
      calendar_appointment_key: 'Calendar Appointment Key (back end)',
      appointment_type: 'Appointment Type', investigator: 'Investigator', snapshot_date: 'snapshot_date'
    }
  },

  // ── 2. Cancellations ──
  cancels: {
    query: (params) => `SELECT
      ${SUBJECT_NAME_SQL} AS subject_full_name,
      ${STUDY_NAME_SQL} AS study_name,
      CAST(aal.study_key AS STRING) AS study_key,
      COALESCE(si.name, '') AS site_name,
      FORMAT_DATETIME('%Y-%m-%d', aal.date_created) AS cancel_date,
      FORMAT_DATETIME('%Y-%m-%d', COALESCE(aal.old_start, aal.date_created)) AS scheduled_date,
      CAST(aal.subject_key AS STRING) AS subject_key_back_end,
      COALESCE(sc.name, '') AS staff_full_name,
      COALESCE(aal.cancel_reason, '') AS cancel_reason,
      CASE aal.cancel_type WHEN 1 THEN 'No Show' WHEN 2 THEN 'Site Cancelled' WHEN 3 THEN 'Patient Cancelled' ELSE '' END AS appointment_cancellation_type,
      ${SUBJECT_STATUS_SQL} AS subject_status,
      COALESCE(sv.name, '') AS visit_name,
      CASE aal.appointment_type WHEN 0 THEN 'Regular Visit' WHEN 1 THEN 'Ad Hoc Visit' WHEN 2 THEN 'General Appointment' WHEN 3 THEN 'Block' ELSE '' END AS appointment_type,
      'cancelled' AS appointment_status,
      CAST(aal.calendar_appointment_key AS STRING) AS calendar_appointment_key,
      COALESCE(sp.name, '') AS investigator,
      FORMAT_DATETIME('%Y-%m-%d', CURRENT_DATETIME()) AS snapshot_date
    FROM ${tbl('appointment_audit_log')} aal
    LEFT JOIN ${tbl('study')} st ON aal.study_key = st.study_key
    LEFT JOIN ${tbl('sponsor')} spon ON st.sponsor_key = spon.sponsor_key
    LEFT JOIN ${tbl('site')} si ON aal.site_key = si.site_key
    LEFT JOIN ${tbl('subject')} sub ON aal.subject_key = sub.subject_key
    LEFT JOIN ${tbl('study_visit')} sv ON aal.study_visit_key = sv.study_visit_key
    LEFT JOIN ${tbl('calendar_appointment')} ca ON aal.calendar_appointment_key = ca.calendar_appointment_key
    LEFT JOIN (SELECT ua.calendar_appointment_key, CONCAT(u.first_name, ' ', u.last_name) AS name
      FROM ${tbl('user_appointment')} ua
      JOIN ${tbl('study_user')} su ON ua.user_key = su.user_key AND ua.study_key = su.study_key AND su.role = 2
      JOIN ${tbl('user')} u ON ua.user_key = u.user_key
      WHERE ua._fivetran_deleted = false AND su._fivetran_deleted = false
      QUALIFY ROW_NUMBER() OVER (PARTITION BY ua.calendar_appointment_key ORDER BY ua.date_created DESC) = 1) sc ON aal.calendar_appointment_key = sc.calendar_appointment_key
    LEFT JOIN (SELECT ua.calendar_appointment_key, CONCAT(u.first_name, ' ', u.last_name) AS name
      FROM ${tbl('user_appointment')} ua
      JOIN ${tbl('study_user')} su ON ua.user_key = su.user_key AND ua.study_key = su.study_key AND su.role = 1
      JOIN ${tbl('user')} u ON ua.user_key = u.user_key
      WHERE ua._fivetran_deleted = false AND su._fivetran_deleted = false
      QUALIFY ROW_NUMBER() OVER (PARTITION BY ua.calendar_appointment_key ORDER BY ua.date_created DESC) = 1) sp ON aal.calendar_appointment_key = sp.calendar_appointment_key
    WHERE aal.change_type = 4
      AND aal.date_created >= DATETIME_SUB(CURRENT_DATETIME(), INTERVAL ${parseInt((params||{}).days) || 90} DAY)
      AND st.is_active = 1      ${STUDY_FILTER_SQL}
    ORDER BY aal.date_created DESC`,
    headers: {
      subject_full_name: 'Subject Full Name', study_name: 'Study Name', study_key: 'Study Key',
      site_name: 'Site Name', cancel_date: 'Cancel Date', scheduled_date: 'Scheduled Date',
      subject_key_back_end: 'Subject Key (Back End)', staff_full_name: 'Staff Full Name',
      cancel_reason: 'Cancel Reason', appointment_cancellation_type: 'Appointment Cancellation Type',
      subject_status: 'Subject Status', visit_name: 'Name', appointment_type: 'Appointment Type',
      appointment_status: 'Appointment Status', calendar_appointment_key: 'Calendar Appointment Key (back end)',
      investigator: 'Investigator', snapshot_date: 'snapshot_date'
    }
  },

  // ── 3. Studies (uses CTEs to avoid correlated subqueries) ──
  studies: {
    query: () => `WITH
      coord_leaders AS (SELECT su.study_key, CONCAT(u.first_name, ' ', u.last_name) AS name
        FROM ${tbl('study_user')} su
        JOIN ${tbl('user')} u ON su.user_key = u.user_key
        WHERE su.role = 2 AND su.is_role_leader = 1 AND su._fivetran_deleted = false),
      pi_leaders AS (SELECT su.study_key, CONCAT(u.first_name, ' ', u.last_name) AS name
        FROM ${tbl('study_user')} su JOIN ${tbl('user')} u ON su.user_key = u.user_key
        WHERE su.role = 1 AND su.is_role_leader = 1 AND su._fivetran_deleted = false),
      sub_counts AS (SELECT study_key, COUNT(*) AS cnt FROM ${tbl('subject')} WHERE _fivetran_deleted = false GROUP BY study_key)
    SELECT
      CAST(st.study_key AS STRING) AS study_key,
      COALESCE(st.protocol_number, '') AS protocol_number,
      ${STUDY_NAME_SQL} AS study_name,
      ${STUDY_STATUS_SQL} AS status,
      COALESCE(cl.name, '') AS coordinator,
      COALESCE(pi.name, sd.investigator_name, '') AS investigator,
      COALESCE(st.indications, sd.primary_indication, '') AS indication,
      COALESCE(sd.specialty, '') AS specialty,
      COALESCE(sc.cnt, 0) AS subject_count,
      COALESCE(CAST(st.target_enrollment AS STRING), '') AS target_enrollment,
      COALESCE(spon.name, '') AS sponsor,
      ${PHASE_SQL} AS phase,
      FORMAT_DATETIME('%Y-%m-%d', st.date_created) AS date_created,
      FORMAT_DATETIME('%Y-%m-%d', st.last_updated) AS last_updated,
      COALESCE(FORMAT_DATE('%Y-%m-%d', DATE_SUB(DATE(sd.enrollment_start_date), INTERVAL 1 DAY)), '') AS start_date,
      COALESCE(FORMAT_DATE('%Y-%m-%d', DATE_SUB(DATE(sd.enrollment_close_date), INTERVAL 1 DAY)), '') AS end_date,
      COALESCE(st.external_id, '') AS external_study_number,
      COALESCE(si.name, '') AS site_name,
      CAST(st.site_key AS STRING) AS site_key,
      COALESCE(CAST(sf.total_revenue AS STRING), '0') AS total_revenue,
      COALESCE(CAST(sf.total_randomized AS STRING), '0') AS revenue_subjects,
      FORMAT_DATETIME('%Y-%m-%d', CURRENT_DATETIME()) AS snapshot_date
    FROM ${tbl('study')} st
    LEFT JOIN ${tbl('sponsor')} spon ON st.sponsor_key = spon.sponsor_key
    LEFT JOIN ${tbl('site')} si ON st.site_key = si.site_key
    LEFT JOIN ${tbl('clinical_trial')} ct ON st.clinical_trial_key = ct.clinical_trial_key
    LEFT JOIN ${tbl('study_details')} sd ON st.study_key = sd.study_key
    LEFT JOIN coord_leaders cl ON st.study_key = cl.study_key
    LEFT JOIN pi_leaders pi ON st.study_key = pi.study_key
    LEFT JOIN sub_counts sc ON st.study_key = sc.study_key
    LEFT JOIN ${tbl('study_finance')} sf ON st.study_key = sf.study_key
    WHERE st._fivetran_deleted = false AND st.is_active = 1      ${STUDY_FILTER_SQL}
    ORDER BY st.study_key`
  },

  // ── 4. Subjects ──
  subjects: {
    query: () => `SELECT
      CAST(sub.subject_key AS STRING) AS subject_id,
      CAST(sub.study_key AS STRING) AS study_key,
      COALESCE(st.protocol_number, '') AS protocol_number,
      ${SUBJECT_STATUS_SQL} AS status
    FROM ${tbl('subject')} sub
    JOIN ${tbl('study')} st ON sub.study_key = st.study_key
    WHERE sub._fivetran_deleted = false AND st.is_active = 1    ORDER BY sub.study_key, sub.subject_key`
  },

  // ── 5. Study Status (milestones) ──
  studyStatus: {
    query: () => `SELECT
      CAST(st.study_key AS STRING) AS study_key,
      ${STUDY_NAME_SQL} AS study_name,
      ${PHASE_SQL} AS phase,
      ${STUDY_STATUS_SQL} AS status,
      COALESCE(FORMAT_DATE('%Y-%m-%d', DATE_SUB(DATE(sd.enrollment_start_date), INTERVAL 1 DAY)), '') AS enrollment_start,
      COALESCE(FORMAT_DATE('%Y-%m-%d', DATE_SUB(DATE(sd.enrollment_close_date), INTERVAL 1 DAY)), '') AS enrollment_close,
      COALESCE(FORMAT_DATE('%Y-%m-%d', DATE_SUB(DATE(sd.first_patient_screened_date), INTERVAL 1 DAY)), '') AS first_patient_screened,
      COALESCE(FORMAT_DATE('%Y-%m-%d', DATE_SUB(DATE(sd.first_patient_randomized_date), INTERVAL 1 DAY)), '') AS first_patient_randomized,
      COALESCE(FORMAT_DATE('%Y-%m-%d', DATE_SUB(DATE(sd.site_initiation_date), INTERVAL 1 DAY)), '') AS site_initiation,
      COALESCE(FORMAT_DATE('%Y-%m-%d', DATE_SUB(DATE(sd.irb_approval_date), INTERVAL 1 DAY)), '') AS irb_approval,
      COALESCE(FORMAT_DATE('%Y-%m-%d', DATE_SUB(DATE(sd.irb_renewal_date), INTERVAL 1 DAY)), '') AS irb_renewal,
      COALESCE(FORMAT_DATE('%Y-%m-%d', DATE_SUB(DATE(sd.contract_signed_date), INTERVAL 1 DAY)), '') AS contract_signed,
      COALESCE(FORMAT_DATE('%Y-%m-%d', DATE_SUB(DATE(sd.regulatory_confirmed_date), INTERVAL 1 DAY)), '') AS regulatory_confirmed,
      COALESCE(FORMAT_DATE('%Y-%m-%d', DATE_SUB(DATE(sd.closeout_date), INTERVAL 1 DAY)), '') AS closeout,
      COALESCE(FORMAT_DATE('%Y-%m-%d', DATE(sd.last_updated)), FORMAT_DATE('%Y-%m-%d', DATE(st.last_updated)), '') AS last_updated,
      COALESCE(FORMAT_DATE('%Y-%m-%d', DATE_SUB(DATE(sd.investigator_meeting_date), INTERVAL 1 DAY)), '') AS investigator_meeting,
      COALESCE(FORMAT_DATE('%Y-%m-%d', DATE_SUB(DATE(sd.presite_selection_date), INTERVAL 1 DAY)), '') AS presite_selection,
      FORMAT_DATETIME('%Y-%m-%d', CURRENT_DATETIME()) AS snapshot_date
    FROM ${tbl('study')} st
    LEFT JOIN ${tbl('study_details')} sd ON st.study_key = sd.study_key
    LEFT JOIN ${tbl('sponsor')} spon ON st.sponsor_key = spon.sponsor_key
    LEFT JOIN ${tbl('clinical_trial')} ct ON st.clinical_trial_key = ct.clinical_trial_key
    WHERE st._fivetran_deleted = false AND st.is_active = 1      ${STUDY_FILTER_SQL}
    ORDER BY st.study_key`,
    headers: {
      study_key: 'Study Key (Back End)', study_name: 'Study Name', phase: 'Phase',
      status: 'Study Status', enrollment_start: 'Enrollment Start Date',
      enrollment_close: 'Enrollment Close Date', first_patient_screened: 'First Patient Screened Date',
      first_patient_randomized: 'First Patient Randomized Date',
      site_initiation: 'Site Initiation Date', irb_approval: 'Irb Approval Date',
      irb_renewal: 'Irb Renewal Date', contract_signed: 'Contract Signed Date',
      regulatory_confirmed: 'Regulatory Confirmed Date', closeout: 'Closeout Date',
      last_updated: 'Last Updated Date', investigator_meeting: 'Investigator Meeting Date',
      presite_selection: 'Presite Selection Date', snapshot_date: 'snapshot_date'
    }
  },

  // ── 6. Audit Log ──
  auditLog: {
    query: () => `SELECT
      COALESCE(si.name, '') AS site_name,
      CAST(aal.study_key AS STRING) AS study_key,
      ${STUDY_NAME_SQL} AS study_name,
      CAST(aal.subject_key AS STRING) AS subject_key,
      ${SUBJECT_NAME_SQL} AS subject_full_name,
      CAST(aal.calendar_appointment_key AS STRING) AS calendar_appointment_key,
      COALESCE(sv.name, '') AS visit_name,
      FORMAT_DATETIME('%Y-%m-%d %H:%M:%S', aal.date_created) AS date_changed,
      COALESCE(FORMAT_DATETIME('%Y-%m-%d %H:%M', aal.old_start), '') AS old_start,
      COALESCE(FORMAT_DATETIME('%Y-%m-%d %H:%M', aal.new_start), '') AS new_start,
      COALESCE(FORMAT_DATETIME('%Y-%m-%d %H:%M', aal.old_end), '') AS old_end,
      COALESCE(FORMAT_DATETIME('%Y-%m-%d %H:%M', aal.new_end), '') AS new_end,
      CONCAT(COALESCE(mod_u.first_name, ''), ' ', COALESCE(mod_u.last_name, '')) AS modified_by,
      CONCAT(COALESCE(by_u.first_name, ''), ' ', COALESCE(by_u.last_name, '')) AS affected_user,
      CONCAT(COALESCE(coord.first_name, ''), ' ', COALESCE(coord.last_name, '')) AS appointment_for,
      CASE aal.appointment_type WHEN 0 THEN 'Regular Visit' WHEN 1 THEN 'Ad Hoc Visit' WHEN 2 THEN 'General Appointment' WHEN 3 THEN 'Block' ELSE '' END AS appointment_type,
      CASE aal.change_type WHEN 0 THEN 'Created' WHEN 1 THEN 'User Added' WHEN 2 THEN 'User Removed' WHEN 3 THEN 'Rescheduled' WHEN 4 THEN 'Cancelled' WHEN 5 THEN 'Deleted' WHEN 6 THEN 'Restored' ELSE CAST(aal.change_type AS STRING) END AS change_type,
      CASE aal.cancel_type WHEN 1 THEN 'No Show' WHEN 2 THEN 'Site Cancelled' WHEN 3 THEN 'Patient Cancelled' ELSE '' END AS cancel_type,
      COALESCE(REGEXP_REPLACE(aal.cancel_reason, r'[\\x00-\\x1f]', ' '), '') AS cancel_reason
    FROM ${tbl('appointment_audit_log')} aal
    LEFT JOIN ${tbl('study')} st ON aal.study_key = st.study_key
    LEFT JOIN ${tbl('sponsor')} spon ON st.sponsor_key = spon.sponsor_key
    LEFT JOIN ${tbl('site')} si ON aal.site_key = si.site_key
    LEFT JOIN ${tbl('subject')} sub ON aal.subject_key = sub.subject_key
    LEFT JOIN ${tbl('study_visit')} sv ON aal.study_visit_key = sv.study_visit_key
    LEFT JOIN ${tbl('user')} mod_u ON aal.by_user_key = mod_u.user_key
    LEFT JOIN ${tbl('user')} by_u ON aal.by_user_key = by_u.user_key
    LEFT JOIN ${tbl('calendar_appointment')} ca ON aal.calendar_appointment_key = ca.calendar_appointment_key
    LEFT JOIN ${tbl('user')} coord ON ca.creator_key = coord.user_key
    WHERE aal.date_created >= DATETIME_SUB(CURRENT_DATETIME(), INTERVAL 90 DAY) AND st.is_active = 1    ORDER BY aal.date_created DESC`,
    headers: {
      site_name: 'Site Name', study_key: 'Study Key (Back End)', study_name: 'Study Name',
      subject_key: 'Subject Key (Back End)', subject_full_name: 'Subject Full Name',
      calendar_appointment_key: 'Calendar Appointment Key (back end)', visit_name: 'Name',
      date_changed: 'Date Changed', old_start: 'Old Start Time', new_start: 'New Start Time',
      old_end: 'Old End Time', new_end: 'New End Time', modified_by: 'Modified by user',
      affected_user: 'Affected user', appointment_for: 'Appointment For User',
      appointment_type: 'Appointment Type', change_type: 'Appointment Change Type',
      cancel_type: 'Appointment Cancellation Type', cancel_reason: 'Cancel Reason'
    }
  },

  // ── Pre-screening visits (for Schedule tab only, excluded from metrics) ──
  prescrVisits: {
    query: () => `SELECT
      ${STUDY_NAME_SQL} AS study_name,
      CAST(ca.study_key AS STRING) AS study_key,
      FORMAT_DATETIME('%Y-%m-%d', ca.start) AS scheduled_date,
      FORMAT_DATETIME('%H:%M', ca.start) AS scheduled_time,
      ${SUBJECT_NAME_SQL} AS subject_full_name,
      CAST(ca.subject_key AS STRING) AS subject_key_back_end,
      CASE ca.status WHEN 0 THEN 'Cancelled' ELSE 'Active' END AS appointment_status,
      COALESCE(sv.name, '') AS visit_name,
      ${SUBJECT_STATUS_SQL} AS subject_status,
      COALESCE(sc.name, '') AS staff_full_name,
      COALESCE(si.name, '') AS site_name,
      COALESCE(sp.name, '') AS investigator,
      FORMAT_DATETIME('%Y-%m-%d', CURRENT_DATETIME()) AS snapshot_date
    FROM ${tbl('calendar_appointment')} ca
    LEFT JOIN ${tbl('subject')} sub ON ca.subject_key = sub.subject_key
    LEFT JOIN ${tbl('study')} st ON ca.study_key = st.study_key
    LEFT JOIN ${tbl('sponsor')} spon ON st.sponsor_key = spon.sponsor_key
    LEFT JOIN ${tbl('site')} si ON ca.site_key = si.site_key
    LEFT JOIN ${tbl('study_visit')} sv ON ca.study_visit_key = sv.study_visit_key
    LEFT JOIN (SELECT ua.calendar_appointment_key, CONCAT(u.first_name, ' ', u.last_name) AS name
      FROM ${tbl('user_appointment')} ua
      JOIN ${tbl('study_user')} su ON ua.user_key = su.user_key AND ua.study_key = su.study_key AND su.role = 2
      JOIN ${tbl('user')} u ON ua.user_key = u.user_key
      WHERE ua._fivetran_deleted = false AND su._fivetran_deleted = false
      QUALIFY ROW_NUMBER() OVER (PARTITION BY ua.calendar_appointment_key ORDER BY ua.date_created DESC) = 1) sc ON ca.calendar_appointment_key = sc.calendar_appointment_key
    LEFT JOIN (SELECT ua.calendar_appointment_key, CONCAT(u.first_name, ' ', u.last_name) AS name
      FROM ${tbl('user_appointment')} ua
      JOIN ${tbl('study_user')} su ON ua.user_key = su.user_key AND ua.study_key = su.study_key AND su.role = 1
      JOIN ${tbl('user')} u ON ua.user_key = u.user_key
      WHERE ua._fivetran_deleted = false AND su._fivetran_deleted = false
      QUALIFY ROW_NUMBER() OVER (PARTITION BY ua.calendar_appointment_key ORDER BY ua.date_created DESC) = 1) sp ON ca.calendar_appointment_key = sp.calendar_appointment_key
    WHERE ca.subject_key IS NOT NULL AND st.is_active = 1      AND ca.status != 0
      AND ca.start >= CURRENT_DATETIME()
      AND ca.start <= DATETIME_ADD(CURRENT_DATETIME(), INTERVAL 365 DAY)
      AND (LOWER(CONCAT(COALESCE(st.nickname, ''), ' ', COALESCE(st.protocol_number, ''))) LIKE '%pre-screen%'
        OR LOWER(COALESCE(sv.name, '')) LIKE '%fibro%'
        OR LOWER(COALESCE(sv.name, '')) LIKE '%liver%scan%')
      AND st.status != 0
    ORDER BY ca.start ASC`
  },

  // ── 7. Patient DB ──
  patientDB: {
    query: () => `SELECT
      REGEXP_REPLACE(TRIM(CONCAT(COALESCE(p.first_name, ''), ' ', COALESCE(p.middle_name, ''), ' ', COALESCE(p.last_name, ''))), r'\\s+', ' ') AS patient_full_name,
      CASE p.status WHEN -20 THEN 'Deceased' WHEN -10 THEN 'Do Not Enroll' WHEN -5 THEN 'Bad Contact Info' WHEN -1 THEN 'Do Not Solicit' WHEN 1 THEN 'Available' ELSE 'Available' END AS patient_status,
      COALESCE(p.email, '') AS email,
      COALESCE(p.mobile_phone, '') AS mobile_phone,
      COALESCE(p.home_phone, '') AS home_phone,
      COALESCE(p.work_phone, '') AS work_phone,
      COALESCE(p.patient_id, CAST(p.patient_key AS STRING)) AS record_number,
      COALESCE(si.name, '') AS site_name,
      COALESCE(p.city, '') AS city,
      COALESCE(p.state, '') AS state,
      CASE p.sex WHEN 0 THEN 'Female' WHEN 1 THEN 'Male' WHEN 2 THEN 'Intersex' ELSE '' END AS gender,
      COALESCE(FORMAT_DATETIME('%Y-%m-%d', p.birth_date), '') AS birth_date,
      CAST(p.patient_key AS STRING) AS patient_key,
      COALESCE(FORMAT_DATETIME('%Y-%m-%d', p.last_interaction_date), '') AS last_interaction_date,
      CAST(COALESCE(p.rating, 0) AS STRING) AS rating,
      FORMAT_DATETIME('%Y-%m-%d', CURRENT_DATETIME()) AS snapshot_date
    FROM ${tbl('patient')} p
    LEFT JOIN ${tbl('site')} si ON p.site_key = si.site_key
    WHERE p._fivetran_deleted = false AND p.status NOT IN (-20, -1)
    ORDER BY p.last_name, p.first_name`,
    headers: {
      patient_full_name: 'Patient Full Name', patient_status: 'Patient Status',
      email: 'Email', mobile_phone: 'Mobile Phone', home_phone: 'Home Phone',
      work_phone: 'Work Phone', record_number: 'Record Number', site_name: 'Site Name',
      city: 'City', state: 'State', gender: 'Gender', birth_date: 'Birth Date',
      patient_key: 'Patient Key', last_interaction_date: 'Last Interaction Date',
      rating: 'Rating', snapshot_date: 'snapshot_date'
    }
  },

  // ═══════════════════════════════════════════════════════════
  // EXPANSION FEEDS — new analytics from BQ schema
  // ═══════════════════════════════════════════════════════════

  // ── 8. Patient Funnel (conversion rates per study) ──
  funnel: {
    query: () => `SELECT
      CAST(f.study_key AS STRING) AS study_key,
      ${STUDY_NAME_SQL} AS study_name,
      COUNT(*) AS total_patients,
      COUNTIF(f.is_interested = true) AS interested,
      COUNTIF(f.is_talked = true) AS talked,
      COUNTIF(f.is_connected = true) AS connected,
      COUNTIF(f.is_eligible = true) AS eligible,
      COUNTIF(f.is_scheduled_v1 = true) AS scheduled_v1,
      COUNTIF(f.is_not_show = true) AS no_show
    FROM ${tbl('fact_patient_funnel')} f
    JOIN ${tbl('study')} st ON f.study_key = st.study_key
    LEFT JOIN ${tbl('sponsor')} spon ON st.sponsor_key = spon.sponsor_key
    WHERE st.is_active = 1
    GROUP BY f.study_key, study_name
    HAVING total_patients > 0
    ORDER BY total_patients DESC`
  },

  // ── 9. Subject Retention (enrollment outcomes per study) ──
  retention: {
    query: () => `SELECT
      CAST(sub.study_key AS STRING) AS study_key,
      ${STUDY_NAME_SQL} AS study_name,
      COUNT(*) AS total_subjects,
      COUNTIF(sub.status = 11) AS enrolled,
      COUNTIF(sub.status = 20) AS completed,
      COUNTIF(sub.status = 13) AS discontinued,
      COUNTIF(sub.status = 12) AS screen_fail,
      COUNTIF(sub.status = 10) AS screening,
      COUNTIF(sub.status = 4) AS scheduled_v1,
      COUNTIF(sub.status = 3) AS no_show_v1,
      COUNTIF(sub.status = 1) AS interested,
      COUNTIF(sub.status = 2) AS prequalified,
      COUNTIF(sub.status = -1) AS not_eligible,
      COUNTIF(sub.status = -2) AS not_interested
    FROM ${tbl('subject')} sub
    JOIN ${tbl('study')} st ON sub.study_key = st.study_key
    LEFT JOIN ${tbl('sponsor')} spon ON st.sponsor_key = spon.sponsor_key
    WHERE sub._fivetran_deleted = false AND st.is_active = 1    GROUP BY sub.study_key, study_name
    HAVING total_subjects > 0
    ORDER BY enrolled DESC`
  },

  // ── 10. Revenue Analytics — DEPRECATED: use gaapStudyRevenue (feed 24) instead ──
  revenue: {
    query: () => `SELECT
      CAST(sf.study_key AS STRING) AS study_key,
      ${STUDY_NAME_SQL} AS study_name,
      sf.total_revenue,
      sf.total_cost,
      sf.projected_revenue,
      sf.total_randomized,
      sf.total_screen_fails,
      sf.total_screen_fails_allocated,
      sf.revenue_base,
      sf.revenue_screen_fail,
      sf.holdback_visit,
      sf.holdback_screen_fail,
      sf.patient_stipend,
      sf.total_patient_stipend,
      sf.total_holdback,
      sf.total_receivable,
      sf.total_invoice_receivable,
      sf.total_revenue_paid,
      sf.total_cost_paid,
      sf.total_external_amount
    FROM ${tbl('study_finance')} sf
    JOIN ${tbl('study')} st ON sf.study_key = st.study_key
    LEFT JOIN ${tbl('sponsor')} spon ON st.sponsor_key = spon.sponsor_key
    WHERE st.is_active = 1
    ORDER BY sf.total_revenue DESC`
  },

  // ── 11. Coordinator Productivity ──
  coordinators: {
    query: (params) => {
      const days = parseInt(params.days) || 30;
      return `SELECT
        CONCAT(u.first_name, ' ', u.last_name) AS coordinator,
        COUNT(DISTINCT svi.subject_visit_key) AS visits_managed,
        COUNT(DISTINCT svi.subject_key) AS unique_subjects,
        COUNT(DISTINCT svi.study_key) AS studies,
        COUNTIF(svi.status = 20) AS cancelled,
        COUNTIF(svi.status IN (22, 23)) AS completed
      FROM ${tbl('subject_visit_stats')} svs
      JOIN ${tbl('subject_visit')} svi ON svs.subject_visit_key = svi.subject_visit_key
      JOIN ${tbl('study')} st ON svi.study_key = st.study_key
      LEFT JOIN ${tbl('sponsor')} spon ON st.sponsor_key = spon.sponsor_key
      JOIN ${tbl('user')} u ON svs.coordinator_user_key = u.user_key
      WHERE svi.last_updated >= DATETIME_SUB(CURRENT_DATETIME(), INTERVAL ${days} DAY)
        AND svi._fivetran_deleted = false
        AND st.is_active = 1        ${STUDY_FILTER_SQL}
      GROUP BY coordinator
      HAVING visits_managed > 0
      ORDER BY visits_managed DESC`;
    }
  },


  // ── 12. Visit Compliance ──
  compliance: {
    query: () => `SELECT
      CAST(sv.study_key AS STRING) AS study_key,
      ${STUDY_NAME_SQL} AS study_name,
      sv.visit_name,
      sv.subject_visit_appointment_status AS status,
      sv.days_oow,
      FORMAT_DATETIME('%Y-%m-%d', sv.window_start_date) AS window_start,
      FORMAT_DATETIME('%Y-%m-%d', sv.window_end_date) AS window_end,
      FORMAT_DATETIME('%Y-%m-%d', sv.subject_visit_appointment_end) AS visit_date,
      CAST(sv.subject_key AS STRING) AS subject_key
    FROM ${tbl('fact_subject_visit')} sv
    JOIN ${tbl('study')} st ON sv.study_key = st.study_key
    LEFT JOIN ${tbl('sponsor')} spon ON st.sponsor_key = spon.sponsor_key
    WHERE sv.subject_visit_appointment_end >= DATETIME_SUB(CURRENT_DATETIME(), INTERVAL 90 DAY)
      AND st.is_active = 1    ORDER BY sv.subject_visit_appointment_end DESC`
  },

  // ═══════════════════════════════════════════════════════════
  // FINANCE FEEDS — direct from CRIO BQ finance tables
  // ═══════════════════════════════════════════════════════════

  // ── 13. Aging Invoices (unpaid) ──
  agingInvoices: {
    query: () => `SELECT
      i.invoice_number, CAST(i.invoice_key AS STRING) AS invoice_key,
      ${STUDY_NAME_SQL} AS study_name,
      CAST(i.study_key AS STRING) AS study_key,
      COALESCE(spon.name, '') AS sponsor,
      CAST(i.amount AS FLOAT64) AS amount,
      CAST(i.amount_paid AS FLOAT64) AS amount_paid,
      CAST(i.amount_unpaid AS FLOAT64) AS amount_unpaid,
      FORMAT_DATETIME('%Y-%m-%d', i.date_created) AS date_created,
      FORMAT_DATETIME('%Y-%m-%d', i.date_due) AS date_due,
      FORMAT_DATETIME('%Y-%m-%d', i.date_sent) AS date_sent,
      i.days_until_due,
      CASE i.status WHEN 0 THEN 'Draft' WHEN 1 THEN 'Unpaid' WHEN 2 THEN 'Paid' WHEN 3 THEN 'Partially Paid' ELSE CAST(i.status AS STRING) END AS status,
      DATE_DIFF(CURRENT_DATE(), DATE(i.date_due), DAY) AS days_overdue
    FROM ${tbl('invoice')} i
    LEFT JOIN ${tbl('study')} st ON i.study_key = st.study_key
    LEFT JOIN ${tbl('sponsor')} spon ON st.sponsor_key = spon.sponsor_key
    ORDER BY i.amount_unpaid DESC`
  },

  // ── 14. Payments — DEPRECATED: use gaapPayments (feed 40) instead ──
  payments: {
    query: () => `SELECT
      p.payment_number, CAST(p.payment_key AS STRING) AS payment_key,
      ${STUDY_NAME_SQL} AS study_name,
      CAST(p.study_key AS STRING) AS study_key,
      COALESCE(spon.name, '') AS sponsor,
      CAST(p.amount AS FLOAT64) AS amount,
      FORMAT_DATETIME('%Y-%m-%d', p.date_received) AS date_received,
      FORMAT_DATETIME('%Y-%m-%d', p.date_issued) AS date_issued,
      FORMAT_DATETIME('%Y-%m-%d', p.date_reconciled) AS date_reconciled,
      CASE WHEN p.is_reconciled = 1 THEN 'Reconciled' ELSE 'Pending' END AS reconciled,
      CASE p.type WHEN 0 THEN 'Revenue' WHEN 1 THEN 'Holdback' WHEN 2 THEN 'External' ELSE CAST(p.type AS STRING) END AS payment_type,
      CAST(p.total_invoices AS FLOAT64) AS total_invoices,
      CAST(p.total_holdbacks AS FLOAT64) AS total_holdbacks,
      p.comments
    FROM ${tbl('payment')} p
    LEFT JOIN ${tbl('study')} st ON p.study_key = st.study_key
    LEFT JOIN ${tbl('sponsor')} spon ON st.sponsor_key = spon.sponsor_key
    ORDER BY p.date_received DESC`
  },

  // ── 15. Revenue line items ──
  revenueItems: {
    query: (params) => {
      const days = parseInt(params.days) || 730;
      return `SELECT
        CAST(ri.study_key AS STRING) AS study_key,
        ${STUDY_NAME_SQL} AS study_name,
        COALESCE(spon.name, '') AS sponsor,
        FORMAT_DATETIME('%Y-%m-%d', ri.service_date) AS service_date,
        CAST(ri.revenue_amount AS FLOAT64) AS revenue,
        CAST(ri.holdback_amount AS FLOAT64) AS holdback,
        CAST(ri.receivable_amount AS FLOAT64) AS receivable,
        CAST(ri.paid_amount AS FLOAT64) AS paid,
        CAST(ri.due_amount AS FLOAT64) AS due,
        COALESCE(ri.details, '') AS details,
        CASE ri.type WHEN 0 THEN 'Visit' WHEN 1 THEN 'Procedure' WHEN 2 THEN 'Screen Fail' WHEN 3 THEN 'Ad Hoc' ELSE CAST(ri.type AS STRING) END AS type,
        CASE WHEN ri.requires_invoice = 1 THEN 'Yes' ELSE 'No' END AS requires_invoice,
        ri.invoice_key
      FROM ${tbl('revenue_item')} ri
      LEFT JOIN ${tbl('study')} st ON ri.study_key = st.study_key
      LEFT JOIN ${tbl('sponsor')} spon ON st.sponsor_key = spon.sponsor_key
      WHERE ri.service_date >= DATETIME_SUB(CURRENT_DATETIME(), INTERVAL ${days} DAY)
      ORDER BY ri.service_date DESC`;
    }
  },

  // ── 16. Monthly revenue — DEPRECATED: use gaapMonthly (feed 25) instead ──
  monthlyRevenue: {
    query: () => `SELECT
      FORMAT_DATE('%Y-%m', DATE(ri.service_date)) AS month,
      CAST(SUM(ri.revenue_amount) AS FLOAT64) AS total_revenue,
      CAST(SUM(ri.holdback_amount) AS FLOAT64) AS total_holdback,
      CAST(SUM(ri.receivable_amount) AS FLOAT64) AS total_receivable,
      CAST(SUM(ri.paid_amount) AS FLOAT64) AS total_paid,
      CAST(SUM(ri.due_amount) AS FLOAT64) AS total_due,
      COUNT(*) AS line_items,
      COUNT(DISTINCT ri.study_key) AS studies
    FROM ${tbl('revenue_item')} ri
    WHERE ri.service_date >= DATETIME_SUB(CURRENT_DATETIME(), INTERVAL 730 DAY)
    GROUP BY month
    ORDER BY month DESC`
  },

  // ── 17. Subject stipend payments ──
  stipends: {
    query: () => `SELECT
      CAST(sp.subject_key AS STRING) AS subject_key,
      CAST(sp.study_key AS STRING) AS study_key,
      ${STUDY_NAME_SQL} AS study_name,
      ${SUBJECT_NAME_SQL} AS subject_name,
      CAST(sp.amount AS FLOAT64) AS amount,
      CASE WHEN sp.is_paid = 1 THEN 'Paid' ELSE 'Pending' END AS status,
      FORMAT_DATETIME('%Y-%m-%d', sp.payment_date) AS payment_date,
      FORMAT_DATETIME('%Y-%m-%d', sp.date_created) AS date_created,
      sp.comments
    FROM ${tbl('subject_payment')} sp
    LEFT JOIN ${tbl('study')} st ON sp.study_key = st.study_key
    LEFT JOIN ${tbl('sponsor')} spon ON st.sponsor_key = spon.sponsor_key
    LEFT JOIN ${tbl('subject')} sub ON sp.subject_key = sub.subject_key
    WHERE sp.is_active = 1
    ORDER BY sp.date_created DESC`
  },

  // ── 18. Study finance summary (enhanced) ──
  studyFinance: {
    query: () => `WITH
      inv_stats AS (SELECT study_key, COUNT(*) AS inv_count, SUM(amount) AS inv_total, SUM(amount_unpaid) AS inv_unpaid_amount,
        COUNTIF(status = 1) AS inv_unpaid_count, COUNTIF(status = 2) AS inv_paid, COUNTIF(status = 3) AS inv_partial FROM ${tbl('invoice')} GROUP BY study_key),
      pmt_stats AS (SELECT study_key, COUNT(*) AS pmt_count, SUM(amount) AS pmt_total FROM ${tbl('payment')} GROUP BY study_key),
      stip_stats AS (SELECT study_key, COUNT(*) AS stip_count, SUM(amount) AS stip_total, COUNTIF(is_paid=1) AS stip_paid FROM ${tbl('subject_payment')} WHERE is_active = 1 GROUP BY study_key)
    SELECT
      CAST(sf.study_key AS STRING) AS study_key,
      ${STUDY_NAME_SQL} AS study_name,
      COALESCE(spon.name, '') AS sponsor,
      CAST(sf.total_revenue AS FLOAT64) AS total_revenue,
      CAST(sf.projected_revenue AS FLOAT64) AS projected_revenue,
      CAST(sf.total_cost AS FLOAT64) AS total_cost,
      CAST(sf.total_receivable AS FLOAT64) AS total_receivable,
      CAST(sf.total_invoice_receivable AS FLOAT64) AS total_invoice_receivable,
      CAST(sf.total_holdback AS FLOAT64) AS total_holdback,
      CAST(sf.total_revenue_paid AS FLOAT64) AS total_revenue_paid,
      CAST(sf.total_patient_stipend AS FLOAT64) AS total_patient_stipend,
      sf.total_randomized,
      sf.total_screen_fails,
      sf.total_screen_fails_allocated,
      CAST(sf.revenue_base AS FLOAT64) AS revenue_per_visit,
      CAST(sf.revenue_screen_fail AS FLOAT64) AS revenue_per_screen_fail,
      CAST(sf.patient_stipend AS FLOAT64) AS stipend_per_patient,
      COALESCE(inv.inv_count, 0) AS invoice_count,
      COALESCE(CAST(inv.inv_total AS FLOAT64), 0) AS invoice_total,
      COALESCE(CAST(inv.inv_unpaid_amount AS FLOAT64), 0) AS invoice_unpaid,
      COALESCE(inv.inv_unpaid_count, 0) AS invoices_unpaid,
      COALESCE(inv.inv_partial, 0) AS invoices_partial,
      COALESCE(inv.inv_paid, 0) AS invoices_paid,
      COALESCE(pmt.pmt_count, 0) AS payment_count,
      COALESCE(CAST(pmt.pmt_total AS FLOAT64), 0) AS payment_total,
      COALESCE(stip.stip_count, 0) AS stipend_count,
      COALESCE(CAST(stip.stip_total AS FLOAT64), 0) AS stipend_total,
      COALESCE(stip.stip_paid, 0) AS stipends_paid
    FROM ${tbl('study_finance')} sf
    JOIN ${tbl('study')} st ON sf.study_key = st.study_key
    LEFT JOIN ${tbl('sponsor')} spon ON st.sponsor_key = spon.sponsor_key
    LEFT JOIN inv_stats inv ON sf.study_key = inv.study_key
    LEFT JOIN pmt_stats pmt ON sf.study_key = pmt.study_key
    LEFT JOIN stip_stats stip ON sf.study_key = stip.study_key
    WHERE st.is_active = 1
    ORDER BY sf.total_revenue DESC`
  },

  // ── 19. Revenue per Subject — DEPRECATED: derivable from gaapStudyRevenue (feed 24) ──
  revenuePerSubject: {
    query: () => `SELECT CAST(sf.study_key AS STRING) AS study_key,
      ${STUDY_NAME_SQL} AS study_name,
      CAST(sf.total_revenue AS FLOAT64) AS total_revenue,
      sf.total_randomized,
      CASE WHEN sf.total_randomized > 0 THEN ROUND(sf.total_revenue / sf.total_randomized) ELSE 0 END AS rev_per_subject,
      sf.total_screen_fails,
      CASE WHEN sf.total_randomized + sf.total_screen_fails > 0
        THEN ROUND(sf.total_screen_fails / (sf.total_randomized + sf.total_screen_fails) * 100)
        ELSE 0 END AS sf_rate_pct,
      CAST(sf.projected_revenue AS FLOAT64) AS projected_revenue,
      CAST(sf.revenue_base AS FLOAT64) AS revenue_per_visit
    FROM ${tbl('study_finance')} sf
    JOIN ${tbl('study')} st ON sf.study_key = st.study_key
    LEFT JOIN ${tbl('sponsor')} spon ON st.sponsor_key = spon.sponsor_key
    WHERE sf.total_revenue > 0 AND st.is_active = 1    ORDER BY rev_per_subject DESC`
  },

  // ── 20. System Health (for monitoring) ──
  health: {
    query: () => `SELECT
      'visits' AS feed, COUNT(*) AS row_count,
      MAX(FORMAT_DATETIME('%Y-%m-%d %H:%M', ca.start)) AS latest_date
    FROM ${tbl('calendar_appointment')} ca
    WHERE ca.start >= DATETIME_SUB(CURRENT_DATETIME(), INTERVAL 7 DAY) AND ca.subject_key IS NOT NULL
    UNION ALL
    SELECT 'cancels', COUNT(*), MAX(FORMAT_DATETIME('%Y-%m-%d %H:%M', aal.date_created))
    FROM ${tbl('appointment_audit_log')} aal WHERE aal.change_type = 4 AND aal.date_created >= DATETIME_SUB(CURRENT_DATETIME(), INTERVAL 90 DAY)
    UNION ALL
    SELECT 'studies', COUNT(*), MAX(FORMAT_DATETIME('%Y-%m-%d %H:%M', st.last_updated))
    FROM ${tbl('study')} st WHERE st.is_active = 1 AND st._fivetran_deleted = false
    UNION ALL
    SELECT 'subjects', COUNT(*), NULL
    FROM ${tbl('subject')} sub WHERE sub._fivetran_deleted = false
    UNION ALL
    SELECT 'patients', COUNT(*), MAX(FORMAT_DATETIME('%Y-%m-%d %H:%M', p.last_updated))
    FROM ${tbl('patient')} p WHERE p._fivetran_deleted = false
    UNION ALL
    SELECT 'fivetran_sync', 0, MAX(FORMAT_TIMESTAMP('%Y-%m-%d %H:%M', _fivetran_synced))
    FROM ${tbl('patient')}`
  },

  // ═══════════════════════════════════════════════════════════
  // NEW FEEDS — from CRIO Looker Formulas deep dive
  // ═══════════════════════════════════════════════════════════

  // ── 21. Regulatory Compliance (training + delegation status per study) ──
  regulatory: {
    query: () => `WITH
      training AS (SELECT rtu.study_key,
        COUNT(*) AS total_trainings,
        COUNTIF(rtu.status = 0) AS pending,
        COUNTIF(rtu.status = 1) AS provided,
        COUNTIF(rtu.status = -1) AS expired,
        COUNTIF(rtu.status = 10) AS offline,
        COUNTIF(rtu.status = 11) AS exempt,
        COUNTIF(rtu.is_training_currently_required = 1 AND rtu.status NOT IN (1, 10, 11)) AS missing
      FROM ${tbl('regulatory_training_user')} rtu
      WHERE rtu._fivetran_deleted = false
      GROUP BY rtu.study_key),
      duties AS (SELECT rdu.study_key,
        COUNT(*) AS total_duties,
        COUNTIF(rdu.status = 0) AS pending_approval,
        COUNTIF(rdu.status = 1) AS approved,
        COUNTIF(rdu.status = -1) AS ended,
        COUNTIF(rdu.status IN (-10, -11)) AS rejected,
        COUNTIF(rdu.status = 20) AS pending_end,
        COUNTIF(rdu.is_active = 1) AS active_duties
      FROM ${tbl('regulatory_duty_user')} rdu
      WHERE rdu._fivetran_deleted = false
      GROUP BY rdu.study_key)
    SELECT
      CAST(st.study_key AS STRING) AS study_key,
      ${STUDY_NAME_SQL} AS study_name,
      COALESCE(t.total_trainings, 0) AS total_trainings,
      COALESCE(t.pending, 0) AS trainings_pending,
      COALESCE(t.provided, 0) AS trainings_provided,
      COALESCE(t.expired, 0) AS trainings_expired,
      COALESCE(t.missing, 0) AS trainings_missing,
      COALESCE(d.total_duties, 0) AS total_duties,
      COALESCE(d.pending_approval, 0) AS duties_pending,
      COALESCE(d.approved, 0) AS duties_approved,
      COALESCE(d.active_duties, 0) AS duties_active,
      COALESCE(d.rejected, 0) AS duties_rejected
    FROM ${tbl('study')} st
    LEFT JOIN ${tbl('sponsor')} spon ON st.sponsor_key = spon.sponsor_key
    LEFT JOIN training t ON st.study_key = t.study_key
    LEFT JOIN duties d ON st.study_key = d.study_key
    WHERE st.is_active = 1 AND st._fivetran_deleted = false
    ORDER BY t.missing DESC NULLS LAST`
  },

  // ── 22. Visit Todos (overdue/outstanding per study) ──
  visitTodos: {
    query: () => `SELECT
      CAST(vt.study_key AS STRING) AS study_key,
      ${STUDY_NAME_SQL} AS study_name,
      vt.name AS todo_name,
      COALESCE(vt.details, '') AS details,
      CASE vt.status WHEN 0 THEN 'Deleted' WHEN 1 THEN 'Completed' WHEN 2 THEN 'Available' WHEN 3 THEN 'Immediate' WHEN 4 THEN 'Overdue' ELSE CAST(vt.status AS STRING) END AS status,
      FORMAT_DATETIME('%Y-%m-%d', vt.due_date) AS due_date,
      FORMAT_DATETIME('%Y-%m-%d', vt.date_created) AS date_created,
      FORMAT_DATETIME('%Y-%m-%d', vt.date_completed) AS date_completed,
      CONCAT(COALESCE(cu.first_name, ''), ' ', COALESCE(cu.last_name, '')) AS created_by,
      CONCAT(COALESCE(comp_u.first_name, ''), ' ', COALESCE(comp_u.last_name, '')) AS completed_by,
      CAST(vt.subject_key AS STRING) AS subject_key,
      COALESCE(NULLIF(TRIM(CONCAT(COALESCE(sub.first_name,''),' ',COALESCE(sub.last_name,''))), ''), CAST(vt.subject_key AS STRING)) AS subject_name,
      COALESCE(sv.name, '') AS visit_name
    FROM ${tbl('subject_visit_todo')} vt
    JOIN ${tbl('study')} st ON vt.study_key = st.study_key
    LEFT JOIN ${tbl('sponsor')} spon ON st.sponsor_key = spon.sponsor_key
    LEFT JOIN ${tbl('study_visit')} sv ON vt.study_visit_key = sv.study_visit_key
    LEFT JOIN ${tbl('user')} cu ON vt.created_by_user_key = cu.user_key
    LEFT JOIN ${tbl('user')} comp_u ON vt.completed_by_user_key = comp_u.user_key
    LEFT JOIN ${tbl('subject')} sub ON vt.subject_key = sub.subject_key
    WHERE vt._fivetran_deleted = false AND st.is_active = 1      AND vt.status IN (1, 2, 3, 4)
      AND (vt.status != 1 OR vt.date_completed >= DATETIME_SUB(CURRENT_DATETIME(), INTERVAL 30 DAY))
    ORDER BY CASE vt.status WHEN 4 THEN 0 WHEN 3 THEN 1 WHEN 2 THEN 2 WHEN 1 THEN 3 END, vt.due_date ASC`
  },

  // ── 23. Recruiting Pipeline Detail (per-patient per-study status) ──
  recruiting: {
    query: () => `SELECT
      CAST(srp.study_key AS STRING) AS study_key,
      ${STUDY_NAME_SQL} AS study_name,
      CAST(srp.patient_key AS STRING) AS patient_key,
      REGEXP_REPLACE(TRIM(CONCAT(COALESCE(p.first_name, ''), ' ', COALESCE(p.last_name, ''))), r'\\s+', ' ') AS patient_name,
      CASE srp.status
        WHEN 0 THEN 'Prospect' WHEN 1 THEN 'Contacting' WHEN 10 THEN 'Interested'
        WHEN 20 THEN 'Screening' WHEN 30 THEN 'Success' WHEN 40 THEN 'Screen Fail'
        WHEN 45 THEN 'In Another Study' WHEN 50 THEN 'Not Eligible'
        WHEN 55 THEN 'Not Applicable' WHEN 60 THEN 'Not Interested'
        WHEN 65 THEN 'Give Up' WHEN 70 THEN 'Bad Contact Info'
        WHEN 75 THEN 'Do Not Solicit' WHEN 80 THEN 'Do Not Enroll'
        WHEN 85 THEN 'Deceased' ELSE CAST(srp.status AS STRING) END AS recruiting_status,
      CASE
        WHEN srp.status IN (0, 1, 10) THEN 'In Play'
        WHEN srp.status = 50 THEN 'Not Eligible'
        WHEN srp.status = 65 THEN 'Give Up'
        WHEN srp.status IN (30) THEN 'Success'
        WHEN srp.status IN (45, 55, 60) THEN 'Other'
        ELSE 'Closed' END AS status_group,
      COALESCE(srp.total_solicitation_calls, 0) AS calls,
      COALESCE(srp.total_solicitation_texts, 0) AS texts,
      COALESCE(srp.total_solicitation_emails, 0) AS emails,
      CASE WHEN srp.needs_followup = 1 THEN 'Yes' ELSE 'No' END AS needs_followup,
      FORMAT_DATETIME('%Y-%m-%d', srp.callback_date) AS callback_date,
      FORMAT_DATETIME('%Y-%m-%d', srp.status_date) AS status_changed,
      CONCAT(COALESCE(u.first_name, ''), ' ', COALESCE(u.last_name, '')) AS recruiter,
      COALESCE(prs.name, '') AS referral_source,
      COALESCE(prsc.name, '') AS referral_source_category,
      FORMAT_DATETIME('%Y-%m-%d', p.date_created) AS patient_created
    FROM ${tbl('study_recruiting_patient')} srp
    JOIN ${tbl('study')} st ON srp.study_key = st.study_key
    LEFT JOIN ${tbl('sponsor')} spon ON st.sponsor_key = spon.sponsor_key
    LEFT JOIN ${tbl('patient')} p ON srp.patient_key = p.patient_key
    LEFT JOIN ${tbl('user')} u ON srp.user_key = u.user_key
    LEFT JOIN ${tbl('patient_referral_source')} prs ON srp.referral_source_key = prs.patient_referral_source_key
    LEFT JOIN ${tbl('patient_referral_source_category')} prsc ON prs.patient_referral_source_category_key = prsc.patient_referral_source_category_key
    WHERE st.is_active = 1 AND srp._fivetran_deleted = false
    ORDER BY srp.status_date DESC`
  },

  // ═══════════════════════════════════════════════════════════
  // GAAP REVENUE — live from CRIO's GAAP accounting tables
  // Replaces hardcoded STUDY_REVENUE_12M, TOP_AR_STUDIES, MONTHLY_REVENUE
  // ═══════════════════════════════════════════════════════════

  // ── 24. GAAP Revenue per Study (upfront/holdback/invoiced/uninvoiced) ──
  gaapStudyRevenue: {
    query: () => `SELECT
      CAST(st.study_key AS STRING) AS study_key,
      ${STUDY_NAME_SQL} AS study_name,
      COALESCE(spon.name, '') AS sponsor,
      COALESCE(st.protocol_number, '') AS protocol_number,
      ROUND(SUM(CASE WHEN rg.type NOT IN (6, 7) THEN rdp.amount ELSE 0 END), 2) AS total_revenue,
      ROUND(SUM(CASE WHEN rg.amount_type = 1 AND rg.type NOT IN (6, 7) THEN rdp.amount ELSE 0 END), 2) AS total_upfront,
      ROUND(SUM(CASE WHEN rg.amount_type = 2 AND rg.type NOT IN (6, 7) THEN rdp.amount ELSE 0 END), 2) AS total_holdback,
      ROUND(SUM(CASE WHEN rg.requires_invoice = true THEN rdp.amount ELSE 0 END), 2) AS total_invoiceable,
      ROUND(SUM(CASE WHEN rg.invoice_item_id IS NOT NULL THEN rdp.amount ELSE 0 END), 2) AS invoiced,
      ROUND(SUM(CASE WHEN rg.requires_invoice = true AND rg.invoice_item_id IS NULL THEN rdp.amount ELSE 0 END), 2) AS uninvoiced,
      ROUND(SUM(CASE WHEN rg.requires_invoice = false THEN rdp.amount ELSE 0 END), 2) AS total_autopay,
      ROUND(SUM(CASE WHEN rg.type NOT IN (6, 7) AND rdp.service_date >= DATETIME_SUB(CURRENT_DATETIME(), INTERVAL 365 DAY) THEN rdp.amount ELSE 0 END), 2) AS revenue_12m,
      COUNT(DISTINCT rdp.revenue_data_point_id) AS line_items
    FROM ${tbl('gaap_revenue_data_point')} rdp
    JOIN ${tbl('gaap_revenue_group')} rg ON rdp.group_id = rg.group_id
    JOIN ${tbl('study')} st ON rg.study_id = st.external_id
    LEFT JOIN ${tbl('sponsor')} spon ON st.sponsor_key = spon.sponsor_key
    WHERE st.is_active = 1
    GROUP BY st.study_key, study_name, spon.name, st.protocol_number
    HAVING total_revenue > 0
    ORDER BY total_revenue DESC`
  },

  // ── 25. GAAP Monthly Revenue Time Series ──
  gaapMonthly: {
    query: () => `SELECT
      FORMAT_DATE('%Y-%m', DATE(rdp.service_date)) AS month,
      ROUND(SUM(CASE WHEN rg.type NOT IN (6, 7) THEN rdp.amount ELSE 0 END), 2) AS total_revenue,
      ROUND(SUM(CASE WHEN rg.amount_type = 1 AND rg.type NOT IN (6, 7) THEN rdp.amount ELSE 0 END), 2) AS upfront,
      ROUND(SUM(CASE WHEN rg.amount_type = 2 AND rg.type NOT IN (6, 7) THEN rdp.amount ELSE 0 END), 2) AS holdback,
      ROUND(SUM(CASE WHEN rg.requires_invoice = false THEN rdp.amount ELSE 0 END), 2) AS autopay,
      ROUND(SUM(CASE WHEN rg.requires_invoice = true THEN rdp.amount ELSE 0 END), 2) AS invoiceable,
      ROUND(SUM(CASE WHEN rg.invoice_item_id IS NOT NULL THEN rdp.amount ELSE 0 END), 2) AS invoiced,
      COUNT(DISTINCT rg.study_id) AS studies
    FROM ${tbl('gaap_revenue_data_point')} rdp
    JOIN ${tbl('gaap_revenue_group')} rg ON rdp.group_id = rg.group_id
    WHERE rdp.service_date >= DATETIME_SUB(CURRENT_DATETIME(), INTERVAL 730 DAY)
    GROUP BY month
    ORDER BY month DESC`
  },

  // ── 26. GAAP AR Aging (invoiced but unpaid, by study) ──
  gaapAging: {
    query: () => `WITH
      reconciled AS (
        SELECT revenue_data_point_id, SUM(amount) AS paid
        FROM ${tbl('gaap_reconciliation')}
        GROUP BY revenue_data_point_id
      )
    SELECT
      CAST(st.study_key AS STRING) AS study_key,
      ${STUDY_NAME_SQL} AS study_name,
      COALESCE(spon.name, '') AS sponsor,
      COALESCE(st.protocol_number, '') AS protocol_number,
      ROUND(SUM(CASE WHEN rg.requires_invoice = true THEN rdp.amount - COALESCE(rec.paid, 0) ELSE 0 END), 2) AS invoice_ar,
      ROUND(SUM(CASE WHEN rg.requires_invoice = false THEN rdp.amount - COALESCE(rec.paid, 0) ELSE 0 END), 2) AS autopay_ar,
      ROUND(SUM(rdp.amount - COALESCE(rec.paid, 0)), 2) AS total_ar,
      ROUND(SUM(COALESCE(rec.paid, 0)), 2) AS collected
    FROM ${tbl('gaap_revenue_data_point')} rdp
    JOIN ${tbl('gaap_revenue_group')} rg ON rdp.group_id = rg.group_id
    JOIN ${tbl('study')} st ON rg.study_id = st.external_id
    LEFT JOIN ${tbl('sponsor')} spon ON st.sponsor_key = spon.sponsor_key
    LEFT JOIN reconciled rec ON rdp.revenue_data_point_id = rec.revenue_data_point_id
    WHERE rdp.amount > COALESCE(rec.paid, 0)
    GROUP BY st.study_key, study_name, spon.name, st.protocol_number
    HAVING total_ar > 0
    ORDER BY total_ar DESC`
  },

  // ── 27. Enrollment Forecast vs Actual ──
  enrollmentForecast: {
    query: () => `SELECT
      CAST(f.study_key AS STRING) AS study_key,
      ${STUDY_NAME_SQL} AS study_name,
      FORMAT_DATE('%Y-%m', DATE(f.month)) AS month,
      f.enrollment_target AS target,
      f.enrollment_scheduled AS scheduled,
      f.enrollment_actual AS actual
    FROM ${tbl('study_month_forecast')} f
    JOIN ${tbl('study')} st ON f.study_key = st.study_key
    LEFT JOIN ${tbl('sponsor')} spon ON st.sponsor_key = spon.sponsor_key
    WHERE st.is_active = 1
      AND f.month >= DATETIME_SUB(CURRENT_DATETIME(), INTERVAL 365 DAY)
    ORDER BY f.study_key, f.month`
  },

  // ── 28. Site Financial Overview (cache_reports_overview) ──
  siteFinance: {
    query: () => `SELECT
      COALESCE(si.name, '') AS site_name,
      CAST(cro.site_key AS STRING) AS site_key,
      ROUND(CAST(cro.revenue_total_year_to_date AS FLOAT64), 2) AS ytd_revenue,
      ROUND(CAST(cro.cost_total_year_to_date AS FLOAT64), 2) AS ytd_cost,
      ROUND(CAST(cro.paid_total_year_to_date AS FLOAT64), 2) AS ytd_paid,
      ROUND(CAST(cro.invoices_unpaid AS FLOAT64), 2) AS invoices_unpaid,
      ROUND(CAST(cro.holdback_unpaid AS FLOAT64), 2) AS holdback_unpaid,
      ROUND(CAST(cro.autopay_unpaid AS FLOAT64), 2) AS autopay_unpaid,
      ROUND(CAST(cro.receivables_total AS FLOAT64), 2) AS receivables_total,
      cro.num_patients_randomized AS patients_randomized,
      cro.num_patients_screening AS patients_screening,
      cro.num_studies_open_for_enrollment AS studies_enrolling,
      cro.num_visits_completed AS visits_completed,
      cro.num_total_visits AS total_visits,
      FORMAT_DATETIME('%Y-%m-%d %H:%M', cro.last_updated) AS last_updated
    FROM ${tbl('cache_reports_overview')} cro
    LEFT JOIN ${tbl('site')} si ON cro.site_key = si.site_key`
  },

  // ═══════════════════════════════════════════════════════════
  // TIER 1 EXPANSION — deep analytics from full 196-table schema
  // ═══════════════════════════════════════════════════════════

  // ── 29. Enrollment Velocity (status transitions with exact dates) ──
  enrollmentVelocity: {
    query: (params) => {
      const days = parseInt(params.days) || 365;
      return `SELECT
        CAST(sal.study_key AS STRING) AS study_key,
        ${STUDY_NAME_SQL} AS study_name,
        FORMAT_DATE('%Y-%W', DATE(sal.as_of_date)) AS week,
        FORMAT_DATE('%Y-%m', DATE(sal.as_of_date)) AS month,
        COUNTIF(sal.new_status = 11) AS newly_enrolled,
        COUNTIF(sal.new_status = 10) AS newly_screening,
        COUNTIF(sal.new_status = 12) AS newly_screen_failed,
        COUNTIF(sal.new_status = 13) AS newly_discontinued,
        COUNTIF(sal.new_status = 20) AS newly_completed,
        COUNTIF(sal.new_status = 4) AS newly_scheduled_v1,
        COUNT(*) AS total_transitions
      FROM ${tbl('fact_subject_status_audit_log')} sal
      JOIN ${tbl('study')} st ON sal.study_key = st.study_key
      LEFT JOIN ${tbl('sponsor')} spon ON st.sponsor_key = spon.sponsor_key
      WHERE st.is_active = 1
        AND sal.as_of_date >= DATETIME_SUB(CURRENT_DATETIME(), INTERVAL ${days} DAY)
      GROUP BY sal.study_key, study_name, week, month
      ORDER BY week DESC, newly_enrolled DESC`;
    }
  },

  // ── 30. Recruiter Productivity (calls, texts, emails per user) ──
  recruiterStats: {
    query: (params) => {
      const days = parseInt(params.days) || 30;
      return `SELECT
        CONCAT(u.first_name, ' ', u.last_name) AS recruiter,
        COUNT(*) AS total_interactions,
        COUNTIF(pi.action_type BETWEEN 100 AND 199) AS phone_calls,
        COUNTIF(pi.action_type BETWEEN 200 AND 299) AS texts,
        COUNTIF(pi.action_type BETWEEN 300 AND 399) AS emails,
        COUNTIF(pi.action_type IN (180, 211, 311, 720)) AS interested_responses,
        COUNTIF(pi.action_type IN (170, 210, 310)) AS declined_responses,
        COUNTIF(pi.action_type IN (160, 161, 162)) AS no_answers,
        SUM(COALESCE(pi.action_duration, 0)) AS total_duration_seconds,
        COUNT(DISTINCT pi.patient_key) AS unique_patients,
        COUNT(DISTINCT pi.study_key) AS studies,
        COUNT(DISTINCT CASE WHEN sub.status = 4 THEN pi.patient_key END) AS scheduled_v1,
        COUNT(DISTINCT CASE WHEN sub.status IN (10, 11) THEN pi.patient_key END) AS screening_enrolled
      FROM ${tbl('patient_interaction')} pi
      JOIN ${tbl('user')} u ON pi.user_key = u.user_key
      LEFT JOIN ${tbl('subject')} sub ON pi.patient_key = sub.patient_key AND pi.study_key = sub.study_key
      WHERE pi.action_date >= DATETIME_SUB(CURRENT_DATETIME(), INTERVAL ${days} DAY)
        AND pi.user_key IS NOT NULL
      GROUP BY recruiter
      HAVING total_interactions > 0
      ORDER BY total_interactions DESC`;
    }
  },

  // ── 31. Patient Demographics (race + ethnicity per study) ──
  demographics: {
    query: () => `WITH
      race_data AS (
        SELECT srp.study_key, dr.race, COUNT(DISTINCT dr.patient_key) AS cnt
        FROM ${tbl('dim_race')} dr
        JOIN ${tbl('study_recruiting_patient')} srp ON dr.patient_key = srp.patient_key
        WHERE dr.race IS NOT NULL AND dr.race != ''
        GROUP BY srp.study_key, dr.race
      ),
      eth_data AS (
        SELECT srp.study_key, de.ethnicity, COUNT(DISTINCT de.patient_key) AS cnt
        FROM ${tbl('dim_ethnicity')} de
        JOIN ${tbl('study_recruiting_patient')} srp ON de.patient_key = srp.patient_key
        WHERE de.ethnicity IS NOT NULL AND de.ethnicity != ''
        GROUP BY srp.study_key, de.ethnicity
      )
    SELECT
      CAST(st.study_key AS STRING) AS study_key,
      ${STUDY_NAME_SQL} AS study_name,
      COALESCE(r.race, '') AS race,
      COALESCE(r.cnt, 0) AS race_count,
      COALESCE(e.ethnicity, '') AS ethnicity,
      COALESCE(e.cnt, 0) AS ethnicity_count
    FROM ${tbl('study')} st
    LEFT JOIN ${tbl('sponsor')} spon ON st.sponsor_key = spon.sponsor_key
    LEFT JOIN race_data r ON st.study_key = r.study_key
    LEFT JOIN eth_data e ON st.study_key = e.study_key
    WHERE st.is_active = 1 AND (r.race IS NOT NULL OR e.ethnicity IS NOT NULL)
    ORDER BY st.study_key, r.cnt DESC`
  },

  // ── 32. Web Form Funnel (ad → submission → patient) ──
  webFormFunnel: {
    query: () => `SELECT
      CAST(wfs.web_form_key AS STRING) AS form_key,
      COALESCE(wf.name, '') AS form_name,
      ${STUDY_NAME_SQL} AS study_name,
      COUNT(*) AS total_submissions,
      COUNTIF(wfs.is_valid = 1) AS valid_submissions,
      COUNTIF(wfs.is_new_patient = 1) AS new_patients,
      COUNTIF(wfs.facebook_ad_id IS NOT NULL AND wfs.facebook_ad_id > 0) AS from_facebook,
      COUNTIF(wfs.patient_key IS NOT NULL) AS linked_to_patient,
      FORMAT_DATE('%Y-%m', DATE(MIN(wfs.date_created))) AS first_submission,
      FORMAT_DATE('%Y-%m', DATE(MAX(wfs.date_created))) AS last_submission
    FROM ${tbl('web_form_submission')} wfs
    LEFT JOIN ${tbl('web_form')} wf ON wfs.web_form_key = wf.web_form_key
    LEFT JOIN ${tbl('study')} st ON wf.study_key = st.study_key
    LEFT JOIN ${tbl('sponsor')} spon ON st.sponsor_key = spon.sponsor_key
    WHERE wfs.is_active = 1
    GROUP BY wfs.web_form_key, wf.name, study_name
    HAVING total_submissions > 0
    ORDER BY total_submissions DESC`
  },

  // ── 33. Procedure-Level Revenue (revenue per procedure per study) ──
  procedureRevenue: {
    query: () => `SELECT
      CAST(svpr.study_key AS STRING) AS study_key,
      ${STUDY_NAME_SQL} AS study_name,
      COALESCE(sp.name, '') AS procedure_name,
      COUNT(*) AS completions,
      ROUND(SUM(CAST(svpr.revenue AS FLOAT64)), 2) AS total_revenue,
      ROUND(SUM(CAST(svpr.holdback AS FLOAT64)), 2) AS total_holdback,
      ROUND(SUM(CAST(svpr.receivable AS FLOAT64)), 2) AS total_receivable,
      COUNTIF(svpr.is_screen_fail = 1) AS screen_fail_count,
      ROUND(AVG(CAST(svpr.revenue AS FLOAT64)), 2) AS avg_revenue_per_completion
    FROM ${tbl('subject_visit_procedure_revenue')} svpr
    JOIN ${tbl('study')} st ON svpr.study_key = st.study_key
    LEFT JOIN ${tbl('sponsor')} spon ON st.sponsor_key = spon.sponsor_key
    LEFT JOIN ${tbl('study_procedure')} sp ON svpr.study_procedure_key = sp.study_procedure_key
    WHERE st.is_active = 1 AND svpr.is_active = 1
    GROUP BY svpr.study_key, study_name, sp.name
    HAVING total_revenue > 0
    ORDER BY total_revenue DESC`
  },

  // ── 34. eSource Comments & Issues (outstanding queries) ──
  comments: {
    query: () => `SELECT
      CAST(c.study_key AS STRING) AS study_key,
      ${STUDY_NAME_SQL} AS study_name,
      CAST(c.subject_key AS STRING) AS subject_key,
      c.issue_number,
      CASE c.type WHEN 1 THEN 'eSource' WHEN 2 THEN 'Subject Document' WHEN 3 THEN 'eReg' WHEN 4 THEN 'Subject Status' WHEN 5 THEN 'Subject Arm Change' WHEN 6 THEN 'Progress Note' ELSE 'Other' END AS comment_type,
      CASE WHEN c.is_external = 1 THEN 'External' ELSE 'Internal' END AS visibility,
      CASE WHEN c.is_resolved = 1 THEN 'Resolved' ELSE 'Open' END AS status,
      c.message,
      CONCAT(COALESCE(u.first_name, ''), ' ', COALESCE(u.last_name, '')) AS created_by,
      COALESCE(NULLIF(TRIM(CONCAT(COALESCE(sub.first_name,''),' ',COALESCE(sub.last_name,''))), ''), CAST(c.subject_key AS STRING)) AS subject_name,
      CAST(c.subject_key AS STRING) AS subject_key,
      CAST(c.comment_key AS STRING) AS comment_key,
      CAST(c.subject_visit_key AS STRING) AS subject_visit_key,
      COALESCE(sc.name, '') AS assigned_to,
      COALESCE(sv.name, '') AS visit_name,
      CASE svi.status WHEN 22 THEN 'completed-visit' WHEN 23 THEN 'completed-visit' WHEN 21 THEN 'completed-visit' WHEN 11 THEN 'visit' ELSE 'visit' END AS visit_path,
      FORMAT_DATETIME('%Y-%m-%d', c.date_created) AS date_created,
      DATE_DIFF(CURRENT_DATE(), DATE(c.date_created), DAY) AS days_outstanding
    FROM ${tbl('comment')} c
    JOIN ${tbl('study')} st ON c.study_key = st.study_key
    LEFT JOIN ${tbl('sponsor')} spon ON st.sponsor_key = spon.sponsor_key
    LEFT JOIN ${tbl('user')} u ON c.user_key = u.user_key
    LEFT JOIN ${tbl('subject')} sub ON c.subject_key = sub.subject_key
    LEFT JOIN ${tbl('subject_visit')} svi ON c.subject_visit_key = svi.subject_visit_key
    LEFT JOIN ${tbl('study_visit')} sv ON svi.study_visit_key = sv.study_visit_key
    LEFT JOIN (SELECT su.study_key, CONCAT(u2.first_name, ' ', u2.last_name) AS name
      FROM ${tbl('study_user')} su JOIN ${tbl('user')} u2 ON su.user_key = u2.user_key
      WHERE su.role = 2 AND su._fivetran_deleted = false
        AND LOWER(CONCAT(u2.first_name, ' ', u2.last_name)) IN ('mario castellanos','stacey scott','ruby pereira','cady chilensky','angelina mcmullen','carly wood')
      QUALIFY ROW_NUMBER() OVER (PARTITION BY su.study_key ORDER BY su.date_created DESC) = 1) sc ON c.study_key = sc.study_key
    WHERE c._fivetran_deleted = false AND st.is_active = 1      AND c.is_resolved = 0
      AND c.date_created >= DATETIME_SUB(CURRENT_DATETIME(), INTERVAL 90 DAY)
    ORDER BY c.date_created ASC`
  },

  // ── 35. Informed Consent Tracking ──
  consentTracking: {
    query: () => `SELECT
      CAST(ic.study_key AS STRING) AS study_key,
      ${STUDY_NAME_SQL} AS study_name,
      CAST(ic.subject_key AS STRING) AS subject_key,
      ${SUBJECT_NAME_SQL} AS subject_name,
      ic.version,
      FORMAT_DATETIME('%Y-%m-%d', ic.date_signed) AS date_signed,
      FORMAT_DATETIME('%Y-%m-%d', ic.version_date) AS version_date,
      FORMAT_DATETIME('%Y-%m-%d', ic.approval_date) AS approval_date,
      CONCAT(COALESCE(u.first_name, ''), ' ', COALESCE(u.last_name, '')) AS signed_by
    FROM ${tbl('informed_consent_audit_log')} ic
    JOIN ${tbl('study')} st ON ic.study_key = st.study_key
    LEFT JOIN ${tbl('sponsor')} spon ON st.sponsor_key = spon.sponsor_key
    LEFT JOIN ${tbl('subject')} sub ON ic.subject_key = sub.subject_key
    LEFT JOIN ${tbl('user')} u ON ic.user_key = u.user_key
    WHERE st.is_active = 1
    ORDER BY ic.date_signed DESC`
  },

  // ── 36. Source Document Status (per subject per visit) ──
  sourceDocuments: {
    query: () => `SELECT
      CAST(sd.study_key AS STRING) AS study_key,
      ${STUDY_NAME_SQL} AS study_name,
      CAST(sd.subject_key AS STRING) AS subject_key,
      ${SUBJECT_NAME_SQL} AS subject_name,
      COALESCE(sv.name, '') AS visit_name,
      COALESCE(dt.name, '') AS document_type,
      COALESCE(dc.name, '') AS document_category,
      CASE sd.status WHEN -1 THEN 'Deleted' WHEN 0 THEN 'Updated' WHEN 1 THEN 'Active' WHEN 2 THEN 'Incoming' WHEN 3 THEN 'Assigned' WHEN 4 THEN 'Rejected' WHEN 6 THEN 'Completed' WHEN 10 THEN 'Signed' ELSE CAST(sd.status AS STRING) END AS status,
      FORMAT_DATETIME('%Y-%m-%d', sd.uploaded_date) AS uploaded_date,
      FORMAT_DATETIME('%Y-%m-%d', sd.signed_date) AS signed_date,
      FORMAT_DATETIME('%Y-%m-%d', sd.assigned_date) AS assigned_date,
      FORMAT_DATETIME('%Y-%m-%d', sd.date_created) AS date_created,
      CONCAT(COALESCE(owner.first_name, ''), ' ', COALESCE(owner.last_name, '')) AS owner,
      CONCAT(COALESCE(assigned.first_name, ''), ' ', COALESCE(assigned.last_name, '')) AS assigned_to,
      CONCAT(COALESCE(signer.first_name, ''), ' ', COALESCE(signer.last_name, '')) AS signed_by,
      CASE WHEN sd.is_redacted = 1 THEN 'Yes' ELSE 'No' END AS redacted,
      CASE WHEN sd.has_draft = 1 THEN 'Yes' ELSE 'No' END AS has_draft,
      sd.file_size,
      COALESCE(sd.custom_name, '') AS custom_name,
      COALESCE(sd.external_id, '') AS doc_external_id,
      COALESCE(sd.cloud_document_id, '') AS cloud_doc_id,
      COALESCE(si.name, '') AS site_name
    FROM ${tbl('subject_document')} sd
    JOIN ${tbl('study')} st ON sd.study_key = st.study_key
    LEFT JOIN ${tbl('sponsor')} spon ON st.sponsor_key = spon.sponsor_key
    LEFT JOIN ${tbl('subject')} sub ON sd.subject_key = sub.subject_key
    LEFT JOIN ${tbl('study_visit')} sv ON sd.study_visit_key = sv.study_visit_key
    LEFT JOIN ${tbl('document_type')} dt ON sd.document_type_key = dt.document_type_key
    LEFT JOIN ${tbl('document_category')} dc ON sd.document_category_key = dc.document_category_key
    LEFT JOIN ${tbl('site')} si ON sd.site_key = si.site_key
    LEFT JOIN ${tbl('user')} owner ON sd.owner_user_key = owner.user_key
    LEFT JOIN ${tbl('user')} assigned ON sd.assigned_user_key = assigned.user_key
    LEFT JOIN ${tbl('user')} signer ON sd.signed_by_user_key = signer.user_key
    WHERE sd._fivetran_deleted = false AND st.is_active = 1      AND sd.status NOT IN (-1)
    ORDER BY sd.date_created DESC`
  },

  // ── 37. Revenue per Procedure per Visit per Subject ──
  visitProcedureRevenue: {
    query: (params) => {
      const days = parseInt(params.days) || 365;
      return `SELECT
        CAST(svpr.study_key AS STRING) AS study_key,
        ${STUDY_NAME_SQL} AS study_name,
        CAST(svpr.subject_key AS STRING) AS subject_key,
        ${SUBJECT_NAME_SQL} AS subject_name,
        COALESCE(sv.name, '') AS visit_name,
        COALESCE(sp.name, '') AS procedure_name,
        ROUND(CAST(svpr.revenue AS FLOAT64), 2) AS revenue,
        ROUND(CAST(svpr.holdback AS FLOAT64), 2) AS holdback,
        ROUND(CAST(svpr.receivable AS FLOAT64), 2) AS receivable,
        CASE WHEN svpr.requires_invoice = 1 THEN 'Invoice' ELSE 'Autopay' END AS pay_type,
        CASE WHEN svpr.is_screen_fail = 1 THEN 'Yes' ELSE 'No' END AS screen_fail,
        CASE WHEN svpr.is_locked = 1 THEN 'Locked' ELSE 'Open' END AS lock_status,
        FORMAT_DATETIME('%Y-%m-%d', svpr.date_completed) AS date_completed,
        FORMAT_DATETIME('%Y-%m-%d', svpr.initial_date_completed) AS initial_date_completed,
        COALESCE(si.name, '') AS site_name
      FROM ${tbl('subject_visit_procedure_revenue')} svpr
      JOIN ${tbl('study')} st ON svpr.study_key = st.study_key
      LEFT JOIN ${tbl('sponsor')} spon ON st.sponsor_key = spon.sponsor_key
      LEFT JOIN ${tbl('subject')} sub ON svpr.subject_key = sub.subject_key
      LEFT JOIN ${tbl('subject_visit')} svi ON svpr.subject_visit_key = svi.subject_visit_key
      LEFT JOIN ${tbl('study_visit')} sv ON svi.study_visit_key = sv.study_visit_key
      LEFT JOIN ${tbl('study_procedure')} sp ON svpr.study_procedure_key = sp.study_procedure_key
      LEFT JOIN ${tbl('site')} si ON svpr.site_key = si.site_key
      WHERE st.is_active = 1 AND svpr.is_active = 1
        AND svpr.date_completed >= DATETIME_SUB(CURRENT_DATETIME(), INTERVAL ${days} DAY)
      ORDER BY svpr.date_completed DESC`;
    }
  },

  // ── 38. eSource Completion — who answered the most questions per visit ──
  esourceByUser: {
    query: (params) => {
      const days = parseInt(params.days) || 90;
      return `SELECT
        CAST(q.study_key AS STRING) AS study_key,
        COALESCE(st.nickname, st.protocol_number, '') AS study_name,
        CAST(q.subject_visit_key AS STRING) AS subject_visit_key,
        COALESCE(sv.name, '') AS visit_name,
        CAST(q.subject_key AS STRING) AS subject_key,
        TRIM(CONCAT(COALESCE(q.first_name, ''), ' ', COALESCE(q.last_name, ''))) AS answered_by,
        COUNT(*) AS questions_answered,
        COUNT(DISTINCT q.study_procedure_key) AS procedures_touched,
        MIN(FORMAT_DATETIME('%Y-%m-%d', q.date_completed)) AS first_answer,
        MAX(FORMAT_DATETIME('%Y-%m-%d', q.date_completed)) AS last_answer,
        COUNTIF(q.is_completed_outside_crio = 1) AS outside_crio
      FROM ${tbl('fact_subject_visit_procedure_question')} q
      JOIN ${tbl('study')} st ON q.study_key = st.study_key
      LEFT JOIN ${tbl('subject_visit')} svi ON q.subject_visit_key = svi.subject_visit_key
      LEFT JOIN ${tbl('study_visit')} sv ON svi.study_visit_key = sv.study_visit_key
      WHERE q.date_completed >= DATETIME_SUB(CURRENT_DATETIME(), INTERVAL ${days} DAY)
        AND q.answer IS NOT NULL AND q.answer != ''
        AND st.is_active = 1        AND q.first_name IS NOT NULL
      GROUP BY q.study_key, study_name, q.subject_visit_key, visit_name, q.subject_key, answered_by
      ORDER BY questions_answered DESC`;
    }
  },

  // ── 39. GAAP Invoices (detailed invoice records with line items) ──
  gaapInvoices: {
    query: () => `SELECT
      gi.invoice_number,
      gi.invoice_id,
      CAST(st.study_key AS STRING) AS study_key,
      ${STUDY_NAME_SQL} AS study_name,
      COALESCE(spon.name, '') AS sponsor,
      CASE gi.status WHEN 0 THEN 'Draft' WHEN 1 THEN 'Unpaid' WHEN 2 THEN 'Paid' WHEN 3 THEN 'Partially Paid' ELSE CAST(gi.status AS STRING) END AS status,
      FORMAT_DATETIME('%Y-%m-%d', gi.date_created) AS date_created,
      FORMAT_DATETIME('%Y-%m-%d', gi.date_due) AS date_due,
      FORMAT_DATETIME('%Y-%m-%d', gi.date_sent) AS date_sent,
      COALESCE(gi.bill_to_company, '') AS bill_to,
      COUNT(gii.invoice_item_id) AS line_items,
      COALESCE(si.name, '') AS site_name
    FROM ${tbl('gaap_invoice')} gi
    JOIN ${tbl('study')} st ON gi.study_id = st.external_id
    LEFT JOIN ${tbl('sponsor')} spon ON st.sponsor_key = spon.sponsor_key
    LEFT JOIN ${tbl('gaap_invoice_item')} gii ON gi.invoice_id = gii.invoice_id AND gii.is_active = true
    LEFT JOIN ${tbl('site')} si ON gi.site_id = st.external_id
    WHERE st.is_active = 1
    GROUP BY gi.invoice_number, gi.invoice_id, st.study_key, study_name, spon.name, gi.status, gi.date_created, gi.date_due, gi.date_sent, gi.bill_to_company, si.name
    ORDER BY gi.date_created DESC`
  },

  // ── 40. GAAP Payments (payment records with reconciliation) ──
  gaapPayments: {
    query: () => `SELECT
      gp.payment_number,
      gp.payment_id,
      CAST(st.study_key AS STRING) AS study_key,
      ${STUDY_NAME_SQL} AS study_name,
      COALESCE(spon.name, '') AS sponsor,
      ROUND(CAST(gp.amount AS FLOAT64), 2) AS amount,
      CASE gp.type WHEN 1 THEN 'Check' WHEN 2 THEN 'Direct Deposit' WHEN 3 THEN 'Credit/Debit' WHEN 4 THEN 'Credit Memo' WHEN 5 THEN 'Refund' ELSE CAST(gp.type AS STRING) END AS payment_type,
      FORMAT_DATETIME('%Y-%m-%d', gp.date_received) AS date_received,
      FORMAT_DATETIME('%Y-%m-%d', gp.date_issued) AS date_issued,
      COALESCE(gp.comments, '') AS comments,
      (SELECT COUNT(*) FROM ${tbl('gaap_reconciliation')} gr WHERE gr.payment_id = gp.payment_id) AS reconciled_items,
      (SELECT ROUND(CAST(SUM(gr.amount) AS FLOAT64), 2) FROM ${tbl('gaap_reconciliation')} gr WHERE gr.payment_id = gp.payment_id) AS reconciled_amount
    FROM ${tbl('gaap_payment')} gp
    JOIN ${tbl('study')} st ON gp.study_id = st.external_id
    LEFT JOIN ${tbl('sponsor')} spon ON st.sponsor_key = spon.sponsor_key
    WHERE st.is_active = 1
    ORDER BY gp.date_received DESC`
  },

  // ── 41. Study Procedure Revenue Config (revenue rules per procedure) ──
  procedureRevenueConfig: {
    query: () => `SELECT
      CAST(spr.study_key AS STRING) AS study_key,
      ${STUDY_NAME_SQL} AS study_name,
      COALESCE(sp.name, '') AS procedure_name,
      ROUND(CAST(spr.revenue_base AS FLOAT64), 2) AS revenue_base,
      ROUND(CAST(spr.revenue_screen_fail AS FLOAT64), 2) AS revenue_screen_fail,
      ROUND(CAST(spr.revenue_ad_hoc AS FLOAT64), 2) AS revenue_ad_hoc,
      ROUND(CAST(spr.patient_stipend AS FLOAT64), 2) AS patient_stipend,
      ROUND(CAST(spr.total_holdbacks AS FLOAT64), 2) AS total_holdbacks,
      ROUND(CAST(spr.total_receivables AS FLOAT64), 2) AS total_receivable,
      ROUND(CAST(spr.total_revenue AS FLOAT64), 2) AS total_revenue,
      ROUND(CAST(spr.total_paid AS FLOAT64), 2) AS total_paid
    FROM ${tbl('study_procedure_revenue')} spr
    JOIN ${tbl('study')} st ON spr.study_key = st.study_key
    LEFT JOIN ${tbl('sponsor')} spon ON st.sponsor_key = spon.sponsor_key
    LEFT JOIN ${tbl('study_procedure')} sp ON spr.study_procedure_key = sp.study_procedure_key
    WHERE st.is_active = 1
    ORDER BY spr.total_revenue DESC`
  },

  // ── 42. Study Procedure Cost Config (cost rules per procedure) ──
  procedureCostConfig: {
    query: () => `SELECT
      CAST(spc.study_key AS STRING) AS study_key,
      ${STUDY_NAME_SQL} AS study_name,
      COALESCE(sp.name, '') AS procedure_name,
      ROUND(CAST(spc.cost_base AS FLOAT64), 2) AS cost_base,
      ROUND(CAST(spc.cost_screen_fail AS FLOAT64), 2) AS cost_screen_fail,
      ROUND(CAST(spc.cost_ad_hoc AS FLOAT64), 2) AS cost_ad_hoc,
      ROUND(CAST(spc.total_costs AS FLOAT64), 2) AS total_costs,
      ROUND(CAST(spc.total_costs_paid AS FLOAT64), 2) AS total_paid,
      COALESCE(CONCAT(v.first_name, ' ', v.last_name), v.company_name, '') AS vendor
    FROM ${tbl('study_procedure_cost')} spc
    JOIN ${tbl('study')} st ON spc.study_key = st.study_key
    LEFT JOIN ${tbl('sponsor')} spon ON st.sponsor_key = spon.sponsor_key
    LEFT JOIN ${tbl('study_procedure')} sp ON spc.study_procedure_key = sp.study_procedure_key
    LEFT JOIN ${tbl('vendor')} v ON spc.vendor_key = v.vendor_key
    WHERE st.is_active = 1
    ORDER BY spc.total_costs DESC`
  },

  // ── 43. Visit-Level Finance (revenue/cost per visit template) ──
  visitFinance: {
    query: () => `SELECT
      CAST(svf.study_key AS STRING) AS study_key,
      ${STUDY_NAME_SQL} AS study_name,
      COALESCE(sv.name, '') AS visit_name,
      ROUND(CAST(svf.revenue_base AS FLOAT64), 2) AS revenue_per_visit,
      ROUND(CAST(svf.cost_base AS FLOAT64), 2) AS cost_per_visit,
      ROUND(CAST(svf.patient_stipend AS FLOAT64), 2) AS patient_stipend,
      ROUND(CAST(svf.revenue_screen_fail AS FLOAT64), 2) AS revenue_screen_fail,
      ROUND(CAST(svf.cost_screen_fail AS FLOAT64), 2) AS cost_screen_fail,
      ROUND(CAST(svf.total_revenue AS FLOAT64), 2) AS total_revenue,
      ROUND(CAST(svf.total_paid AS FLOAT64), 2) AS total_paid,
      ROUND(CAST(svf.total_holdbacks AS FLOAT64), 2) AS total_holdback,
      ROUND(CAST(svf.total_costs AS FLOAT64), 2) AS total_cost
    FROM ${tbl('study_visit_finance')} svf
    JOIN ${tbl('study')} st ON svf.study_key = st.study_key
    LEFT JOIN ${tbl('sponsor')} spon ON st.sponsor_key = spon.sponsor_key
    LEFT JOIN ${tbl('study_visit')} sv ON svf.study_visit_key = sv.study_visit_key
    WHERE st.is_active = 1
    ORDER BY svf.total_revenue DESC`
  },

  // ── 44. Subject Visit Sign-Off (PI/QA approval tracking) ──
  visitSignOff: {
    query: () => `SELECT
      CAST(so.study_key AS STRING) AS study_key,
      ${STUDY_NAME_SQL} AS study_name,
      CAST(so.subject_key AS STRING) AS subject_key,
      ${SUBJECT_NAME_SQL} AS subject_name,
      COALESCE(sv.name, '') AS visit_name,
      CASE so.type WHEN 1 THEN 'PI Sign-Off' WHEN 2 THEN 'QA Sign-Off' ELSE CAST(so.type AS STRING) END AS sign_off_type,
      CASE WHEN so.is_active = 1 THEN 'Active' ELSE 'Inactive' END AS status,
      FORMAT_DATETIME('%Y-%m-%d', so.date_created) AS date_signed,
      CONCAT(COALESCE(u.first_name, ''), ' ', COALESCE(u.last_name, '')) AS signed_by,
      COALESCE(si.name, '') AS site_name
    FROM ${tbl('subject_visit_sign_off')} so
    JOIN ${tbl('study')} st ON so.study_key = st.study_key
    LEFT JOIN ${tbl('sponsor')} spon ON st.sponsor_key = spon.sponsor_key
    LEFT JOIN ${tbl('subject')} sub ON so.subject_key = sub.subject_key
    LEFT JOIN ${tbl('subject_visit')} svi ON so.subject_visit_key = svi.subject_visit_key
    LEFT JOIN ${tbl('study_visit')} sv ON svi.study_visit_key = sv.study_visit_key
    LEFT JOIN ${tbl('user')} u ON so.user_key = u.user_key
    LEFT JOIN ${tbl('site')} si ON so.site_key = si.site_key
    WHERE st.is_active = 1 AND so.is_active = 1
    ORDER BY so.date_created DESC`
  },

  // ── 48. Revenue Per User (eSource attribution + procedure revenue) ──
  revenuePerUser: {
    query: (params) => {
      const days = parseInt(params.days) || 365;
      // Coordinator list and investigator list for role classification
      const coordinators = "'Mario Castellanos','Stacey scott','Stacey Scott','Ruby Pereira','Cady Chilensky','Angelina McMullen','Ema Gunic','Vlado Draganic','Gabrijela Ateljevic','Ana Lambic','Jana Milankovic'";
      const investigators = "'Taher Modarressi','Eugene Andruczyk','Lolita Vaughan','Michael Tomeo','Joseph Heether','Jason Schoenfeld','Donna Gavarone','Lawrence Leventhal','Brian Shaffer','Hal Ganzman','Savita Singh','Parth Patel'";
      return `
      WITH procedure_revenue AS (
        SELECT subject_visit_key,
          ROUND(SUM(CAST(revenue AS FLOAT64)), 2) AS proc_revenue,
          ROUND(SUM(CAST(holdback AS FLOAT64)), 2) AS proc_holdback,
          COUNT(*) AS procedures_completed
        FROM ${tbl('subject_visit_procedure_revenue')}
        WHERE is_active = 1
        GROUP BY subject_visit_key
      ),
      esource_all AS (
        SELECT q.subject_visit_key,
          TRIM(CONCAT(COALESCE(q.first_name, ''), ' ', COALESCE(q.last_name, ''))) AS user_name,
          COUNT(*) AS questions_answered
        FROM ${tbl('fact_subject_visit_procedure_question')} q
        WHERE q.answer IS NOT NULL AND q.answer != '' AND q.first_name IS NOT NULL
          AND q.date_completed >= DATETIME_SUB(CURRENT_DATETIME(), INTERVAL ${days} DAY)
        GROUP BY q.subject_visit_key, user_name
      ),
      esource_coordinator AS (
        SELECT subject_visit_key, user_name AS coordinator, questions_answered AS coord_questions
        FROM esource_all WHERE user_name IN (${coordinators})
        QUALIFY ROW_NUMBER() OVER (PARTITION BY subject_visit_key ORDER BY questions_answered DESC) = 1
      ),
      esource_investigator AS (
        SELECT subject_visit_key, user_name AS investigator, questions_answered AS inv_questions
        FROM esource_all WHERE user_name IN (${investigators})
        QUALIFY ROW_NUMBER() OVER (PARTITION BY subject_visit_key ORDER BY questions_answered DESC) = 1
      ),
      completed_visits AS (
        SELECT svi.subject_visit_key, svi.study_key, svi.subject_key,
          st.site_key, svi.study_visit_key, svi.status AS visit_status_code,
          svi.last_updated AS completed_date
        FROM ${tbl('subject_visit')} svi
        JOIN ${tbl('study')} st ON svi.study_key = st.study_key
        WHERE svi.status IN (21, 22, 23) AND svi._fivetran_deleted = false
          AND st.is_active = 1
          AND svi.last_updated >= DATETIME_SUB(CURRENT_DATETIME(), INTERVAL ${days} DAY)
      ),
      first_scheduler AS (
        SELECT aal.subject_key, aal.study_visit_key, aal.study_key,
          TRIM(CONCAT(COALESCE(u.first_name, ''), ' ', COALESCE(u.last_name, ''))) AS scheduler_name
        FROM ${tbl('appointment_audit_log')} aal
        JOIN ${tbl('user')} u ON aal.by_user_key = u.user_key
        WHERE aal.change_type = 0
          AND aal._fivetran_deleted = false
        QUALIFY ROW_NUMBER() OVER (
          PARTITION BY aal.subject_key, aal.study_visit_key, aal.study_key
          ORDER BY aal.date_created ASC
        ) = 1
      )
      SELECT
        COALESCE(ec.coordinator, 'Unassigned') AS coordinator,
        COALESCE(ec.coord_questions, 0) AS coord_questions,
        COALESCE(ei.investigator, 'Unassigned') AS investigator,
        COALESCE(ei.inv_questions, 0) AS inv_questions,
        COALESCE(fs.scheduler_name, 'Unassigned') AS recruiter,
        CAST(cv.study_key AS STRING) AS study_key,
        ${STUDY_NAME_SQL} AS study_name,
        COALESCE(sv.name, '') AS visit_name,
        ${SUBJECT_NAME_SQL} AS subject_name,
        CASE cv.visit_status_code
          WHEN 22 THEN 'Complete' WHEN 23 THEN 'Outside CRIO'
          WHEN 21 THEN 'Partial' ELSE CAST(cv.visit_status_code AS STRING) END AS visit_status,
        COALESCE(pr.proc_revenue, ROUND(CAST(svf.revenue_base AS FLOAT64), 2), 0) AS visit_revenue,
        COALESCE(pr.proc_holdback, 0) AS visit_holdback,
        COALESCE(pr.procedures_completed, 0) AS procedures_completed,
        CASE WHEN pr.proc_revenue IS NOT NULL THEN 'Actual'
          WHEN svf.revenue_base IS NOT NULL THEN 'Contracted'
          ELSE 'No Rate' END AS revenue_type,
        FORMAT_DATETIME('%Y-%m-%d', cv.completed_date) AS date_completed,
        FORMAT_DATETIME('%Y-%m', cv.completed_date) AS month_completed,
        COALESCE(si.name, '') AS site_name
      FROM completed_visits cv
      JOIN ${tbl('study')} st ON cv.study_key = st.study_key
      LEFT JOIN ${tbl('sponsor')} spon ON st.sponsor_key = spon.sponsor_key
      LEFT JOIN ${tbl('subject')} sub ON cv.subject_key = sub.subject_key
      LEFT JOIN ${tbl('study_visit')} sv ON cv.study_visit_key = sv.study_visit_key
      LEFT JOIN ${tbl('site')} si ON cv.site_key = si.site_key
      LEFT JOIN procedure_revenue pr ON cv.subject_visit_key = pr.subject_visit_key
      LEFT JOIN ${tbl('study_visit_finance')} svf ON cv.study_visit_key = svf.study_visit_key
      LEFT JOIN esource_coordinator ec ON cv.subject_visit_key = ec.subject_visit_key
      LEFT JOIN esource_investigator ei ON cv.subject_visit_key = ei.subject_visit_key
      LEFT JOIN first_scheduler fs ON cv.subject_key = fs.subject_key
        AND cv.study_visit_key = fs.study_visit_key AND cv.study_key = fs.study_key
      WHERE (ec.coordinator IS NOT NULL OR ei.investigator IS NOT NULL OR fs.scheduler_name IS NOT NULL)
      ORDER BY visit_revenue DESC`;
    }
  },

  // ── 45. Subject Audit Trail (status changes with reasons) ──
  subjectAudit: {
    query: () => `SELECT
      CAST(sal.study_key AS STRING) AS study_key,
      ${STUDY_NAME_SQL} AS study_name,
      CAST(sal.subject_key AS STRING) AS subject_key,
      ${SUBJECT_NAME_SQL} AS subject_name,
      CASE sal.old_status
        WHEN -2 THEN 'Not Interested' WHEN -1 THEN 'Not Eligible'
        WHEN 1 THEN 'Interested' WHEN 2 THEN 'Prequalified'
        WHEN 3 THEN 'No Show/Cancelled V1' WHEN 4 THEN 'Scheduled V1'
        WHEN 10 THEN 'Screening' WHEN 11 THEN 'Enrolled'
        WHEN 12 THEN 'Screen Fail' WHEN 13 THEN 'Discontinued'
        WHEN 20 THEN 'Completed' ELSE CAST(sal.old_status AS STRING) END AS old_status,
      CASE sal.new_status
        WHEN -2 THEN 'Not Interested' WHEN -1 THEN 'Not Eligible'
        WHEN 1 THEN 'Interested' WHEN 2 THEN 'Prequalified'
        WHEN 3 THEN 'No Show/Cancelled V1' WHEN 4 THEN 'Scheduled V1'
        WHEN 10 THEN 'Screening' WHEN 11 THEN 'Enrolled'
        WHEN 12 THEN 'Screen Fail' WHEN 13 THEN 'Discontinued'
        WHEN 20 THEN 'Completed' ELSE CAST(sal.new_status AS STRING) END AS new_status,
      FORMAT_DATETIME('%Y-%m-%d %H:%M', sal.as_of_date) AS transition_date,
      COALESCE(sal.change_reason, '') AS reason,
      COALESCE(sal.change_reason_comment, '') AS comment,
      CONCAT(COALESCE(u.first_name, ''), ' ', COALESCE(u.last_name, '')) AS changed_by,
      COALESCE(si.name, '') AS site_name
    FROM ${tbl('subject_status_audit_log')} sal
    JOIN ${tbl('study')} st ON sal.study_key = st.study_key
    LEFT JOIN ${tbl('sponsor')} spon ON st.sponsor_key = spon.sponsor_key
    LEFT JOIN ${tbl('subject')} sub ON sal.subject_key = sub.subject_key
    LEFT JOIN ${tbl('user')} u ON sal.user_key = u.user_key
    LEFT JOIN ${tbl('site')} si ON sal.site_key = si.site_key
    WHERE st.is_active = 1
    ORDER BY sal.as_of_date DESC`
  },

  // ── 46. Stipend Payments (patient payments with card tracking) ──
  stipendPayments: {
    query: () => `SELECT
      CAST(subp.study_key AS STRING) AS study_key,
      ${STUDY_NAME_SQL} AS study_name,
      CAST(subp.subject_key AS STRING) AS subject_key,
      ${SUBJECT_NAME_SQL} AS subject_name,
      ROUND(CAST(sp.amount AS FLOAT64), 2) AS amount,
      FORMAT_DATETIME('%Y-%m-%d', sp.payment_date) AS payment_date,
      CASE sp.status WHEN 1 THEN 'Paid' WHEN 0 THEN 'Pending' ELSE CAST(sp.status AS STRING) END AS status,
      COALESCE(sa.current_balance, 0) AS card_balance,
      COALESCE(sa.total_deposited, 0) AS total_deposited,
      COALESCE(sa.total_paid, 0) AS total_paid_from_card,
      COALESCE(si.name, '') AS site_name
    FROM ${tbl('stipend_payment')} sp
    JOIN ${tbl('subject_payment')} subp ON sp.stipend_payment_key = subp.stipend_payment_key
    JOIN ${tbl('study')} st ON subp.study_key = st.study_key
    LEFT JOIN ${tbl('sponsor')} spon ON st.sponsor_key = spon.sponsor_key
    LEFT JOIN ${tbl('subject')} sub ON subp.subject_key = sub.subject_key
    LEFT JOIN ${tbl('stipend_account')} sa ON sp.stipend_account_key = sa.stipend_account_key
    LEFT JOIN ${tbl('site')} si ON sp.site_key = si.site_key
    WHERE st.is_active = 1 AND sp._fivetran_deleted = false
    ORDER BY sp.payment_date DESC`
  },

  // ── 48. eReg Pending Documents (assigned subject documents awaiting action) ──
  eregPending: {
    query: () => `SELECT
      CAST(sd.study_key AS STRING) AS study_key,
      ${STUDY_NAME_SQL} AS study_name,
      ${SUBJECT_NAME_SQL} AS subject_name,
      CAST(sd.subject_key AS STRING) AS subject_key,
      COALESCE(dt.name, sd.custom_name, '') AS document_name,
      COALESCE(dc.name, '') AS category,
      COALESCE(sd.description, '') AS description,
      CASE sd.status WHEN -1 THEN 'Deleted' WHEN 0 THEN 'Updated' WHEN 1 THEN 'Active' WHEN 2 THEN 'Incoming' WHEN 3 THEN 'Assigned' WHEN 4 THEN 'Rejected' WHEN 6 THEN 'Completed' WHEN 10 THEN 'Signed' ELSE CAST(sd.status AS STRING) END AS status,
      FORMAT_DATETIME('%Y-%m-%d', sd.date_created) AS date_created,
      FORMAT_DATETIME('%Y-%m-%d', sd.assigned_date) AS assigned_date,
      CONCAT(COALESCE(assigned.first_name, ''), ' ', COALESCE(assigned.last_name, '')) AS assigned_to,
      COALESCE(si.name, '') AS site_name
    FROM ${tbl('subject_document')} sd
    JOIN ${tbl('study')} st ON sd.study_key = st.study_key
    LEFT JOIN ${tbl('sponsor')} spon ON st.sponsor_key = spon.sponsor_key
    LEFT JOIN ${tbl('subject')} sub ON sd.subject_key = sub.subject_key
    LEFT JOIN ${tbl('document_type')} dt ON sd.document_type_key = dt.document_type_key
    LEFT JOIN ${tbl('document_category')} dc ON sd.document_category_key = dc.document_category_key
    LEFT JOIN ${tbl('user')} assigned ON sd.assigned_user_key = assigned.user_key
    LEFT JOIN ${tbl('site')} si ON sd.site_key = si.site_key
    WHERE sd._fivetran_deleted = false AND sd.status = 3
      AND sd.assigned_date >= DATETIME_SUB(CURRENT_DATETIME(), INTERVAL 90 DAY)
      AND st.is_active = 1      ${STUDY_FILTER_SQL}
    ORDER BY sd.assigned_date DESC`
  },

  // ── 49. Regulatory Performance (per-user activity + pending items, last 90 days) ──
  regulatoryPerformance: {
    query: () => `WITH
      doc_done AS (
        SELECT u.user_key,
          CONCAT(COALESCE(u.first_name,''),' ',COALESCE(u.last_name,'')) AS user_name,
          COALESCE(si.name,'') AS site_name,
          CAST(sd.study_key AS STRING) AS study_key,
          ${STUDY_NAME_SQL} AS study_name,
          COUNTIF(sd.owner_user_key = u.user_key AND sd.uploaded_date >= DATETIME_SUB(CURRENT_DATETIME(), INTERVAL 90 DAY)) AS docs_uploaded,
          COUNTIF(sd.signed_by_user_key = u.user_key AND sd.signed_date >= DATETIME_SUB(CURRENT_DATETIME(), INTERVAL 90 DAY)) AS docs_signed,
          COUNTIF(sd.assigned_user_key = u.user_key AND sd.assigned_date >= DATETIME_SUB(CURRENT_DATETIME(), INTERVAL 90 DAY)) AS docs_assigned_done
        FROM ${tbl('subject_document')} sd
        JOIN ${tbl('study')} st ON sd.study_key = st.study_key
        LEFT JOIN ${tbl('sponsor')} spon ON st.sponsor_key = spon.sponsor_key
        LEFT JOIN ${tbl('site')} si ON sd.site_key = si.site_key
        CROSS JOIN ${tbl('user')} u
        WHERE sd._fivetran_deleted = false AND st.is_active = 1 ${STUDY_FILTER_SQL}
          AND (sd.owner_user_key = u.user_key OR sd.signed_by_user_key = u.user_key OR sd.assigned_user_key = u.user_key)
        GROUP BY u.user_key, user_name, site_name, sd.study_key, study_name
      ),
      pending_docs AS (
        SELECT sd.assigned_user_key AS user_key,
          CAST(sd.study_key AS STRING) AS study_key,
          COUNT(*) AS pending_docs
        FROM ${tbl('subject_document')} sd
        JOIN ${tbl('study')} st ON sd.study_key = st.study_key
        WHERE sd._fivetran_deleted = false AND sd.status = 3 AND st.is_active = 1
        GROUP BY sd.assigned_user_key, sd.study_key
      ),
      comments AS (
        SELECT sc.user_key,
          CAST(c.study_key AS STRING) AS study_key,
          ${STUDY_NAME_SQL} AS study_name,
          COUNT(*) AS comments_created,
          COUNTIF(c.is_resolved = 0) AS open_comments
        FROM ${tbl('comment')} c
        JOIN ${tbl('study')} st ON c.study_key = st.study_key
        LEFT JOIN ${tbl('sponsor')} spon ON st.sponsor_key = spon.sponsor_key
        LEFT JOIN (SELECT su.study_key, su.user_key
          FROM ${tbl('study_user')} su WHERE su.role = 2 AND su._fivetran_deleted = false
          QUALIFY ROW_NUMBER() OVER (PARTITION BY su.study_key ORDER BY su.date_created DESC) = 1) sc ON c.study_key = sc.study_key
        WHERE c._fivetran_deleted = false AND st.is_active = 1 AND c.is_resolved = 0
          AND sc.user_key IS NOT NULL
        GROUP BY sc.user_key, c.study_key, study_name
      ),
      signoffs AS (
        SELECT so.user_key,
          CAST(so.study_key AS STRING) AS study_key,
          ${STUDY_NAME_SQL} AS study_name,
          COUNT(*) AS signoffs
        FROM ${tbl('subject_visit_sign_off')} so
        JOIN ${tbl('study')} st ON so.study_key = st.study_key
        LEFT JOIN ${tbl('sponsor')} spon ON st.sponsor_key = spon.sponsor_key
        WHERE st.is_active = 1 AND so.is_active = 1
          AND so.date_created >= DATETIME_SUB(CURRENT_DATETIME(), INTERVAL 90 DAY)
        GROUP BY so.user_key, so.study_key, study_name
      ),
      pending_ereg AS (
        SELECT rdu.user_key,
          CAST(rdu.study_key AS STRING) AS study_key,
          COUNT(*) AS pending_ereg
        FROM ${tbl('regulatory_duty_user')} rdu
        JOIN ${tbl('study')} st ON rdu.study_key = st.study_key
        WHERE rdu._fivetran_deleted = false AND rdu.status = 0 AND st.is_active = 1
        GROUP BY rdu.user_key, rdu.study_key
      ),
      all_users AS (
        SELECT DISTINCT user_key, user_name FROM doc_done
        UNION DISTINCT
        SELECT c.user_key, CONCAT(COALESCE(u.first_name,''),' ',COALESCE(u.last_name,'')) FROM comments c JOIN ${tbl('user')} u ON c.user_key = u.user_key
        UNION DISTINCT
        SELECT so.user_key, CONCAT(COALESCE(u.first_name,''),' ',COALESCE(u.last_name,'')) FROM signoffs so JOIN ${tbl('user')} u ON so.user_key = u.user_key
        UNION DISTINCT
        SELECT pe.user_key, CONCAT(COALESCE(u.first_name,''),' ',COALESCE(u.last_name,'')) FROM pending_ereg pe JOIN ${tbl('user')} u ON pe.user_key = u.user_key
      )
    SELECT
      au.user_name,
      COALESCE(d.site_name, '') AS site_name,
      COALESCE(d.study_key, c.study_key, so.study_key, pd.study_key, pe.study_key) AS study_key,
      COALESCE(NULLIF(d.study_name,''), c.study_name, so.study_name, '') AS study_name,
      COALESCE(d.docs_uploaded, 0) AS docs_uploaded,
      COALESCE(d.docs_signed, 0) AS docs_signed,
      COALESCE(d.docs_assigned_done, 0) AS docs_assigned_done,
      COALESCE(c.comments_created, 0) AS comments_created,
      COALESCE(c.open_comments, 0) AS open_comments,
      COALESCE(so.signoffs, 0) AS signoffs,
      COALESCE(pd.pending_docs, 0) AS pending_docs,
      COALESCE(pe.pending_ereg, 0) AS pending_ereg
    FROM all_users au
    LEFT JOIN doc_done d ON au.user_key = d.user_key
    LEFT JOIN comments c ON au.user_key = c.user_key AND COALESCE(d.study_key, c.study_key) = c.study_key
    LEFT JOIN signoffs so ON au.user_key = so.user_key AND COALESCE(d.study_key, so.study_key) = so.study_key
    LEFT JOIN pending_docs pd ON au.user_key = pd.user_key AND COALESCE(d.study_key, pd.study_key) = pd.study_key
    LEFT JOIN pending_ereg pe ON au.user_key = pe.user_key AND COALESCE(d.study_key, pe.study_key) = pe.study_key
    WHERE (COALESCE(d.docs_uploaded,0) + COALESCE(d.docs_signed,0) + COALESCE(c.comments_created,0) + COALESCE(so.signoffs,0) + COALESCE(pd.pending_docs,0) + COALESCE(pe.pending_ereg,0)) > 0
    ORDER BY au.user_name, d.study_key`
  },

  // ── 47. Document Completion Summary (aggregate per study — was feed 39) ──
  documentSummary: {
    query: () => `SELECT
      CAST(sd.study_key AS STRING) AS study_key,
      ${STUDY_NAME_SQL} AS study_name,
      COUNT(*) AS total_documents,
      COUNTIF(sd.status = 10) AS signed,
      COUNTIF(sd.status = 6) AS completed,
      COUNTIF(sd.status = 1) AS active,
      COUNTIF(sd.status = 3) AS assigned,
      COUNTIF(sd.status = 2) AS incoming,
      COUNTIF(sd.status = 4) AS rejected,
      COUNTIF(sd.status = 0) AS updated,
      COUNTIF(sd.signed_date IS NOT NULL) AS has_signature,
      COUNTIF(sd.uploaded_date IS NOT NULL) AS has_upload,
      COUNTIF(sd.has_draft = 1) AS drafts,
      COUNTIF(sd.is_redacted = 1) AS redacted,
      COUNT(DISTINCT sd.subject_key) AS subjects_with_docs,
      COUNT(DISTINCT sd.document_type_key) AS doc_types_used,
      ROUND(SAFE_DIVIDE(COUNTIF(sd.status IN (6, 10)), COUNT(*)) * 100, 1) AS completion_pct
    FROM ${tbl('subject_document')} sd
    JOIN ${tbl('study')} st ON sd.study_key = st.study_key
    LEFT JOIN ${tbl('sponsor')} spon ON st.sponsor_key = spon.sponsor_key
    WHERE sd._fivetran_deleted = false AND st.is_active = 1      AND sd.status != -1
    GROUP BY sd.study_key, study_name
    HAVING total_documents > 0
    ORDER BY total_documents DESC`
  },

  // ── Last interaction per patient (for Follow-Up table) ──
  lastInteraction: {
    query: () => `WITH ranked AS (
      SELECT
        CONCAT(COALESCE(p.first_name,''), ' ', COALESCE(p.last_name,'')) AS patient_name,
        CAST(pi.patient_key AS STRING) AS patient_key,
        FORMAT_DATETIME('%Y-%m-%d', pi.action_date) AS action_date,
        CASE
          WHEN pi.action_type BETWEEN 100 AND 199 THEN 'Call'
          WHEN pi.action_type BETWEEN 200 AND 299 THEN 'Text'
          WHEN pi.action_type BETWEEN 300 AND 399 THEN 'Email'
          WHEN pi.action_type = 720 THEN 'Interested'
          ELSE 'Other'
        END AS action_type,
        COALESCE(pi.action_details, '') AS action_details,
        CONCAT(COALESCE(u.first_name,''), ' ', COALESCE(u.last_name,'')) AS performed_by,
        ROW_NUMBER() OVER (PARTITION BY pi.patient_key ORDER BY pi.action_date DESC, pi.date_created DESC) AS rn
      FROM ${tbl('patient_interaction')} pi
      LEFT JOIN ${tbl('patient')} p ON pi.patient_key = p.patient_key
      LEFT JOIN ${tbl('user')} u ON pi.user_key = u.user_key
      WHERE pi._fivetran_deleted = false
        AND pi.action_date >= DATETIME_SUB(CURRENT_DATETIME(), INTERVAL 90 DAY)
        AND pi.site_key IN (1679, 5545)
    )
    SELECT patient_name, patient_key, action_date, action_type, action_details, performed_by
    FROM ranked WHERE rn = 1
    ORDER BY action_date DESC`
  },

  // ── Ride/Transport Requests (from patient interactions) ──
  rideRequests: {
    query: () => `
      SELECT DISTINCT
        pi.patient_key,
        CONCAT(COALESCE(p.first_name,''), ' ', COALESCE(p.last_name,'')) AS patient_name,
        MAX(FORMAT_DATETIME('%Y-%m-%d', pi.action_date)) AS last_ride_date,
        MAX(pi.action_details) AS last_ride_note
      FROM ${tbl('patient_interaction')} pi
      LEFT JOIN ${tbl('patient')} p ON pi.patient_key = p.patient_key
      WHERE pi._fivetran_deleted = false
        AND pi.action_date >= DATETIME_SUB(CURRENT_DATETIME(), INTERVAL 90 DAY)
        AND (
          REGEXP_CONTAINS(LOWER(pi.action_details), r'\\buber\\b|\\blyft\\b|\\brideshare\\b|\\bride share\\b|\\btransportation\\b|\\bcar service\\b|\\bpick.?up\\b|\\bneed.?a.?ride\\b|\\bneeds.?ride\\b|\\brides?\\b.{0,10}\\bschedul|\\bschedul.{0,10}\\brides?\\b|\\btransport.{0,10}\\brequest|\\brequest.{0,10}\\btransport|\\bride.{0,10}\\bcancel|\\bcancel.{0,10}\\bride')
          AND NOT LOWER(pi.action_details) LIKE '%triglyceride%'
        )
      GROUP BY pi.patient_key, patient_name
      ORDER BY last_ride_date DESC`
  },
  // ── Visit Confirmations (from patient interactions) ──
  visitConfirmations: {
    query: () => `
      SELECT DISTINCT
        pi.patient_key,
        CONCAT(COALESCE(p.first_name,''), ' ', COALESCE(p.last_name,'')) AS patient_name,
        MAX(FORMAT_DATETIME('%Y-%m-%d', pi.action_date)) AS confirmed_date,
        MAX(pi.action_details) AS confirmation_note
      FROM ${tbl('patient_interaction')} pi
      LEFT JOIN ${tbl('patient')} p ON pi.patient_key = p.patient_key
      WHERE pi._fivetran_deleted = false
        AND pi.action_date >= DATETIME_SUB(CURRENT_DATETIME(), INTERVAL 14 DAY)
        AND (
          REGEXP_CONTAINS(LOWER(pi.action_details), r'\\bconfirm.{0,20}(appt|appointment|visit)|(appt|appointment|visit).{0,20}\\bconfirm|appointment confirmation|\\bconfirmed for\\b|received email from patient confirming')
        )
      GROUP BY pi.patient_key, patient_name
      ORDER BY confirmed_date DESC`
  },
  unscheduledVisits: {
    query: () => `
      WITH active_subjects AS (
        SELECT sub.subject_key, sub.study_key,
          ${SUBJECT_NAME_SQL} AS subject_name,
          CASE sub.status WHEN 10 THEN 'Screening' WHEN 11 THEN 'Enrolled' ELSE CAST(sub.status AS STRING) END AS subject_status,
          sub.status AS status_code
        FROM ${tbl('subject')} sub
        JOIN ${tbl('study')} st ON sub.study_key = st.study_key
        LEFT JOIN ${tbl('sponsor')} spon ON st.sponsor_key = spon.sponsor_key
        WHERE sub.status IN (10, 11)
          AND sub._fivetran_deleted = false
          AND st.is_active = 1
          AND st.status IN (2, 3)
          ${STUDY_FILTER_SQL}
      ),
      last_visit AS (
        SELECT svi.subject_key, svi.study_key,
          svi.last_updated AS last_visit_date,
          sv.name AS last_visit_name
        FROM ${tbl('subject_visit')} svi
        LEFT JOIN ${tbl('study_visit')} sv ON svi.study_visit_key = sv.study_visit_key
        WHERE svi.status IN (21, 22, 23)
          AND svi._fivetran_deleted = false
        QUALIFY ROW_NUMBER() OVER (PARTITION BY svi.subject_key, svi.study_key ORDER BY svi.last_updated DESC) = 1
      ),
      next_visit AS (
        SELECT svi.subject_key, svi.study_key,
          sv.name AS next_visit_name,
          svi.window_start_date,
          svi.window_end_date,
          svi.subject_visit_appointment_status,
          ROW_NUMBER() OVER (PARTITION BY svi.subject_key, svi.study_key ORDER BY svi.window_start_date ASC) AS rn
        FROM ${tbl('fact_subject_visit')} svi
        LEFT JOIN ${tbl('study_visit')} sv ON svi.study_visit_key = sv.study_visit_key
        WHERE svi.subject_visit_appointment_status = 0
          AND svi.window_start_date IS NOT NULL
      )
      SELECT
        CAST(a.study_key AS STRING) AS study_key,
        ${STUDY_NAME_SQL} AS study_name,
        CAST(a.subject_key AS STRING) AS subject_key,
        a.subject_name,
        a.subject_status,
        COALESCE(FORMAT_DATETIME('%Y-%m-%d', lv.last_visit_date), 'None') AS last_visit_date,
        COALESCE(lv.last_visit_name, 'No visits yet') AS last_visit_name,
        COALESCE(nv.next_visit_name, '') AS next_visit_name,
        COALESCE(FORMAT_DATETIME('%Y-%m-%d', nv.window_start_date), '') AS window_start,
        COALESCE(FORMAT_DATETIME('%Y-%m-%d', nv.window_end_date), '') AS window_end,
        CASE WHEN nv.window_end_date < CURRENT_DATETIME() THEN 'overdue'
             WHEN nv.window_start_date <= CURRENT_DATETIME() THEN 'in_window'
             ELSE 'upcoming' END AS window_status,
        COALESCE(si.name, '') AS site_name
      FROM active_subjects a
      JOIN ${tbl('study')} st ON a.study_key = st.study_key
      LEFT JOIN ${tbl('sponsor')} spon ON st.sponsor_key = spon.sponsor_key
      LEFT JOIN ${tbl('site')} si ON st.site_key = si.site_key
      LEFT JOIN last_visit lv ON a.subject_key = lv.subject_key AND a.study_key = lv.study_key
      LEFT JOIN next_visit nv ON a.subject_key = nv.subject_key AND a.study_key = nv.study_key AND nv.rn = 1
      WHERE NOT EXISTS (
        SELECT 1 FROM ${tbl('calendar_appointment')} ca
        WHERE ca.subject_key = a.subject_key AND ca.study_key = a.study_key
          AND ca.status != 0 AND ca.start >= DATETIME_SUB(CURRENT_DATETIME(), INTERVAL 2 DAY)
          AND ca._fivetran_deleted = false
      )
      ORDER BY
        CASE WHEN nv.window_end_date < CURRENT_DATETIME() THEN 0
             WHEN nv.window_start_date <= CURRENT_DATETIME() THEN 1
             ELSE 2 END,
        nv.window_end_date ASC, study_name, a.subject_name`
  },
};

// ═══════════════════════════════════════════════════════════
// CRIO RECRUITMENT API — Patient Interactions & Reminders
// ═══════════════════════════════════════════════════════════

const CRIO_TOKEN = process.env.CRIO_TOKEN || '';
const CRIO_API_BASE = 'https://api.clinicalresearch.io';
const CRIO_CLIENT_ID = '1329';
const CRIO_SITE_IDS = { PHL: '1679', PNJ: '5545' };

function crioFetch(path) {
  if (!CRIO_TOKEN) throw new Error('No CRIO_TOKEN configured');
  return new Promise((resolve, reject) => {
    const url = CRIO_API_BASE + path + (path.includes('?') ? '&' : '?') + 'client_id=' + CRIO_CLIENT_ID;
    const u = new URL(url);
    const req = https.request({ hostname: u.hostname, path: u.pathname + u.search, method: 'GET',
      headers: { 'Authorization': 'Bearer ' + CRIO_TOKEN, 'Accept': 'application/json' }
    }, res => {
      let d = ''; res.on('data', c => d += c);
      res.on('end', () => resolve({ status: res.statusCode, body: d }));
    });
    req.on('error', reject); req.end();
  });
}

function crioPost(path, body) {
  if (!CRIO_TOKEN) throw new Error('No CRIO_TOKEN configured');
  return new Promise((resolve, reject) => {
    const url = CRIO_API_BASE + path + (path.includes('?') ? '&' : '?') + 'client_id=' + CRIO_CLIENT_ID;
    const u = new URL(url);
    const data = JSON.stringify(body);
    const req = https.request({ hostname: u.hostname, path: u.pathname + u.search, method: 'POST',
      headers: { 'Authorization': 'Bearer ' + CRIO_TOKEN, 'Content-Type': 'application/json',
                 'Accept': 'application/json', 'Content-Length': Buffer.byteLength(data) }
    }, res => {
      let d = ''; res.on('data', c => d += c);
      res.on('end', () => resolve({ status: res.statusCode, body: d }));
    });
    req.on('error', reject); req.write(data); req.end();
  });
}

function crioPut(path, body) {
  if (!CRIO_TOKEN) throw new Error('No CRIO_TOKEN configured');
  return new Promise((resolve, reject) => {
    const url = CRIO_API_BASE + path + (path.includes('?') ? '&' : '?') + 'client_id=' + CRIO_CLIENT_ID;
    const u = new URL(url);
    const data = JSON.stringify(body);
    const req = https.request({ hostname: u.hostname, path: u.pathname + u.search, method: 'PUT',
      headers: { 'Authorization': 'Bearer ' + CRIO_TOKEN, 'Content-Type': 'application/json',
                 'Accept': 'application/json', 'Content-Length': Buffer.byteLength(data) }
    }, res => {
      let d = ''; res.on('data', c => d += c);
      res.on('end', () => resolve({ status: res.statusCode, body: d }));
    });
    req.on('error', reject); req.write(data); req.end();
  });
}

// ═══════════════════════════════════════════════════════════
// TWILIO SMS — Visit Reminders & Post-Visit Feedback
// ═══════════════════════════════════════════════════════════

const TWILIO_SID = process.env.TWILIO_SID || '';
const TWILIO_TOKEN = process.env.TWILIO_TOKEN || '';
const TWILIO_FROM = '+18334871852';  // Toll-free — pending verification

function twilioSend(to, body) {
  if (!TWILIO_SID || !TWILIO_TOKEN) throw new Error('Twilio credentials not configured');
  return new Promise((resolve, reject) => {
    const data = new URLSearchParams({ To: to, From: TWILIO_FROM, Body: body }).toString();
    const auth = Buffer.from(TWILIO_SID + ':' + TWILIO_TOKEN).toString('base64');
    const req = https.request({
      hostname: 'api.twilio.com',
      path: `/2010-04-01/Accounts/${TWILIO_SID}/Messages.json`,
      method: 'POST',
      headers: { 'Authorization': 'Basic ' + auth, 'Content-Type': 'application/x-www-form-urlencoded',
                 'Content-Length': Buffer.byteLength(data) }
    }, res => {
      let d = ''; res.on('data', c => d += c);
      res.on('end', () => {
        try { resolve({ status: res.statusCode, ...JSON.parse(d) }); }
        catch (e) { resolve({ status: res.statusCode, raw: d }); }
      });
    });
    req.on('error', reject); req.write(data); req.end();
  });
}

// ═══════════════════════════════════════════════════════════
// STUDY REMINDER CONFIG — per-study instructions & templates
// ═══════════════════════════════════════════════════════════

const REMINDER_CONFIG = {
  // Default template — used when no study-specific config exists
  _default: {
    address_phl: '9501 Roosevelt Blvd, Suite 208, Philadelphia, PA 19114',
    address_pnj: '1 Capital Way, Suite 200, Pennington, NJ 08534',
    phone: '(215) 676-6696',
    instructions: '',
    compensation: '',
  },

  // Study-specific overrides (keyed by study_key from BQ)
  // Add entries here as studies are configured
  '89175': {  // EZEF — Lp(a) Heart Health
    nickname: 'LP(a) Heart Health Study',
    instructions: 'No fasting required. Blood draw included.',
    compensation: '~$60 per visit',
  },
  '86826': {  // Menstrual Migraine
    nickname: 'Menstrual Migraine Study',
    instructions: 'Please complete your diary entries before this appointment.',
    compensation: '',
  },
};

// ── Message Templates ──
function buildReminderMessage(patient, visit, studyCfg, type) {
  const cfg = { ...REMINDER_CONFIG._default, ...studyCfg };
  const firstName = patient.firstName || 'there';
  const studyName = cfg.nickname || visit.study_name || 'your clinical study';
  const date = visit.scheduled_date || '';
  const time = visit.scheduled_time || '';
  const address = visit.site_key === '5545' ? cfg.address_pnj : cfg.address_phl;
  const instr = cfg.instructions ? `\nReminder: ${cfg.instructions}` : '';
  const comp = cfg.compensation ? ` Compensation: ${cfg.compensation}.` : '';

  switch (type) {
    case '48h':
      return `Hi ${firstName}, this is Clinical Research Philadelphia. Your visit for the ${studyName} is on ${date} at ${time}.${instr}\n\nLocation: ${address}${comp}\n\nReply YES to confirm or call ${cfg.phone} to reschedule.\n\nReply STOP to opt out.`;

    case '24h':
      return `Hi ${firstName}, reminder: your visit is tomorrow at ${time}.\n\nLocation: ${address}${instr}\n\nQuestions? Call ${cfg.phone}.\n\nReply STOP to opt out.`;

    case 'day_of':
      return `Hi ${firstName}, your visit is today at ${time} at ${address}. See you soon!\n\nCall ${cfg.phone} if you need to reach us.\n\nReply STOP to opt out.`;

    case 'post_visit':
      return `Hi ${firstName}, thank you for your visit yesterday for the ${studyName}. We hope it went well!\n\nIf you have any feedback or concerns, please reply to this message or call ${cfg.phone}. Your coordinator is here to help.\n\nReply STOP to opt out.`;

    default:
      return `Hi ${firstName}, this is Clinical Research Philadelphia regarding your ${studyName} visit. Please call ${cfg.phone} with any questions.\n\nReply STOP to opt out.`;
  }
}

// ── Log interaction to CRIO patient notes via PUT ──
async function logToCrioPatientNotes(patientKey, siteId, message) {
  if (!CRIO_TOKEN || !patientKey) return { logged: false, reason: 'no token or patient key' };
  try {
    // Read current patient to get revision + existing notes
    const getR = await crioFetch(`/api/v1/patient/${patientKey}/site/${siteId}`);
    if (getR.status !== 200) return { logged: false, reason: 'patient read failed', status: getR.status };
    const patient = JSON.parse(getR.body);
    const pi = patient.patientInfo;
    const existingNotes = pi.notes || '';
    const timestamp = new Date().toISOString().replace('T', ' ').substring(0, 19);
    const newNote = `[CRP Reminder ${timestamp}] ${message}`;
    const updatedNotes = existingNotes ? existingNotes + '\n' + newNote : newNote;

    // PUT — spread full patientInfo but strip calculated/read-only fields
    const cleanPi2 = { ...pi, notes: updatedNotes };
    (cleanPi2.customFields || []).forEach((f, i) => { if (f.questionType === 'CALCULATION') cleanPi2.customFields[i] = undefined; });
    if (cleanPi2.customFields) cleanPi2.customFields = cleanPi2.customFields.filter(Boolean);
    delete cleanPi2.dateCreated; delete cleanPi2.dateCreatedTS;
    delete cleanPi2.lastUpdated; delete cleanPi2.lastUpdatedTS;
    const putR = await crioPut(`/api/v1/patient/${patientKey}`, {
      siteId: siteId,
      revision: patient.revision,
      patientInfo: cleanPi2
    });
    return { logged: putR.status === 200, status: putR.status };
  } catch (e) { return { logged: false, error: e.message }; }
}

// ── Log structured follow-up interaction to CRIO patient notes ──
async function logFollowUpToNotes(payload) {
  const { patient, patient_key, study, category, action, reason, coord, site, status } = payload;
  if (!CRIO_TOKEN) return { logged: false, reason: 'CRIO_TOKEN not configured' };

  const actionLabels = {
    'reschedule': 'Reschedule Visit', 'call': 'Call Patient', 'recruit': 'Send to Recruitment',
    'rescreen': 'Re-screen', 'waitlist': 'Add to Waitlist', 'lost': 'Mark as Lost', 'noaction': 'No Action Needed'
  };
  const actionLabel = actionLabels[action] || action;

  // Resolve patient_key from name if not provided
  let pk = patient_key;
  let siteId = site === 'PNJ' ? CRIO_SITE_IDS.PNJ : CRIO_SITE_IDS.PHL;
  if (!pk && patient) {
    try {
      const rows = await runQuery(`SELECT CAST(p.patient_key AS STRING) AS patient_key,
        CAST(p.site_key AS STRING) AS site_key
        FROM ${tbl('patient')} p
        WHERE LOWER(CONCAT(p.first_name, ' ', p.last_name)) = LOWER('${patient.replace(/'/g, "''")}')
        AND p._fivetran_deleted = false
        ORDER BY p.last_updated DESC LIMIT 1`);
      if (rows.length) { pk = rows[0].patient_key; siteId = rows[0].site_key; }
    } catch (e) { console.error('Patient lookup failed:', e.message); }
  }
  if (!pk) return { logged: false, reason: 'Could not resolve patient_key for: ' + patient };

  try {
    // GET current patient
    const getR = await crioFetch(`/api/v1/patient/${pk}/site/${siteId}`);
    if (getR.status !== 200) return { logged: false, reason: 'Patient GET failed', status: getR.status };
    const patientData = JSON.parse(getR.body);
    const pi = patientData.patientInfo;
    const existingNotes = pi.notes || '';

    // Build structured interaction entry
    const ts = new Date().toISOString().replace('T', ' ').substring(0, 19);
    const lines = [
      `━━━ CRP Follow-Up [${ts}] ━━━`,
      `Action: ${actionLabel}`,
      study ? `Study: ${study}` : null,
      category ? `Category: ${category}` : null,
      reason ? `Reason: ${reason}` : null,
      coord ? `Coordinator: ${coord}` : null,
      status ? `CRIO Status: ${status}` : null,
    ].filter(Boolean).join('\n');

    const updatedNotes = existingNotes ? existingNotes + '\n\n' + lines : lines;

    // PUT back — spread full patientInfo but strip calculated/read-only fields
    const writableInfo = { ...pi, notes: updatedNotes };
    // Strip ALL non-essential fields — only keep what we need to update notes safely
    // CRIO rejects calculated question fields, custom form answers, etc.
    const _keepKeys = new Set(['patientId','externalId','status','notes','patientContact',
      'doNotCall','doNotEmail','doNotText','birthDate','gender','sex','nin','patientExternalId']);
    Object.keys(writableInfo).forEach(k => { if (!_keepKeys.has(k)) delete writableInfo[k]; });
    const putR = await crioPut(`/api/v1/patient/${pk}`, {
      siteId: siteId,
      revision: patientData.revision,
      patientInfo: writableInfo
    });

    return { logged: putR.status === 200, patient_key: pk, site: siteId, status: putR.status,
             detail: putR.status !== 200 ? putR.body.substring(0, 300) : undefined };
  } catch (e) {
    return { logged: false, error: e.message };
  }
}

// ── Main reminder engine — query upcoming visits, send reminders ──
async function runReminderEngine(options = {}) {
  const { dryRun = false, testPhone = null, types = ['48h', '24h', 'day_of', 'post_visit'] } = options;
  const results = { sent: [], skipped: [], errors: [], dryRun };

  // 1. Query visits needing reminders from BQ
  const visitRows = await runQuery(`
    WITH upcoming AS (
      SELECT
        ${STUDY_NAME_SQL} AS study_name,
        CAST(ca.study_key AS STRING) AS study_key,
        FORMAT_DATETIME('%Y-%m-%d', ca.start) AS scheduled_date,
        FORMAT_DATETIME('%H:%M', ca.start) AS scheduled_time,
        ${SUBJECT_NAME_SQL} AS subject_name,
        CAST(sub.patient_key AS STRING) AS patient_key,
        COALESCE(sub.mobile_phone, p.mobile_phone, '') AS mobile_phone,
        COALESCE(p.email, '') AS email,
        CAST(ca.site_key AS STRING) AS site_key,
        DATETIME_DIFF(ca.start, CURRENT_DATETIME(), HOUR) AS hours_until,
        COALESCE(p.do_not_text, 0) AS do_not_text,
        COALESCE(p.do_not_call, 0) AS do_not_call,
        ca.calendar_appointment_key
      FROM ${tbl('calendar_appointment')} ca
      JOIN ${tbl('subject')} sub ON ca.subject_key = sub.subject_key AND ca._fivetran_deleted = false
      JOIN ${tbl('study')} st ON ca.study_key = st.study_key
      LEFT JOIN ${tbl('sponsor')} spon ON st.sponsor_key = spon.sponsor_key
      LEFT JOIN ${tbl('patient')} p ON sub.patient_key = p.patient_key AND p._fivetran_deleted = false
      WHERE ca.status != 0
        AND ca.start >= DATETIME_SUB(CURRENT_DATETIME(), INTERVAL 1 DAY)
        AND ca.start <= DATETIME_ADD(CURRENT_DATETIME(), INTERVAL 3 DAY)
        AND sub.status IN (4, 10, 11)
        ${STUDY_FILTER_SQL}
        AND ca._fivetran_deleted = false
    )
    SELECT * FROM upcoming
    WHERE mobile_phone != ''
    ORDER BY hours_until ASC
  `);

  // 2. Determine which reminder type each visit needs
  for (const v of visitRows) {
    const hours = parseInt(v.hours_until);
    let reminderType = null;

    if (hours >= 44 && hours <= 52 && types.includes('48h')) reminderType = '48h';
    else if (hours >= 20 && hours <= 28 && types.includes('24h')) reminderType = '24h';
    else if (hours >= 0 && hours <= 4 && types.includes('day_of')) reminderType = 'day_of';
    else if (hours >= -28 && hours <= -20 && types.includes('post_visit')) reminderType = 'post_visit';

    if (!reminderType) { results.skipped.push({ name: v.subject_name, hours, reason: 'outside reminder windows' }); continue; }

    // Check do-not-text
    if (v.do_not_text === '1' || v.do_not_text === 1 || v.do_not_text === 'true') {
      results.skipped.push({ name: v.subject_name, reason: 'do_not_text flag set' }); continue;
    }

    // Normalize phone
    const phone = v.mobile_phone.replace(/[^0-9+]/g, '');
    const fullPhone = phone.startsWith('+') ? phone : '+1' + phone.replace(/^1/, '');
    if (fullPhone.length < 11) { results.skipped.push({ name: v.subject_name, reason: 'invalid phone' }); continue; }

    // Build message
    const studyCfg = REMINDER_CONFIG[v.study_key] || {};
    const patientInfo = { firstName: (v.subject_name || '').split(' ')[0] };
    const msg = buildReminderMessage(patientInfo, v, studyCfg, reminderType);

    const entry = {
      patient: v.subject_name, study: v.study_name, phone: fullPhone,
      type: reminderType, hours, date: v.scheduled_date, time: v.scheduled_time,
      message: msg.substring(0, 80) + '...'
    };

    if (dryRun) {
      entry.dryRun = true;
      if (testPhone) {
        // In dry run with test phone, send to test phone instead
        const testResult = await twilioSend(testPhone, `[TEST for ${v.subject_name}] ${msg}`);
        entry.testSend = { status: testResult.status, sid: testResult.sid };
      }
      results.sent.push(entry);
      continue;
    }

    // 3. Send SMS via Twilio
    try {
      const smsResult = await twilioSend(fullPhone, msg);
      entry.sms = { status: smsResult.status, sid: smsResult.sid, error: smsResult.error_message };

      // 4. Log to CRIO patient notes
      if (smsResult.status === 201 && v.patient_key) {
        const logResult = await logToCrioPatientNotes(v.patient_key, v.site_key,
          `${reminderType} SMS sent to ${fullPhone}: "${msg.substring(0, 100)}..."`);
        entry.crioLog = logResult;
      }

      results.sent.push(entry);
    } catch (e) {
      results.errors.push({ ...entry, error: e.message });
    }
  }

  results.totalVisits = visitRows.length;
  results.timestamp = new Date().toISOString();
  return results;
}

// ── LEGACY: Test functions removed — keeping stubs for reference ──
// Phase 1-3 test functions were used to discover CRIO API capabilities.
// Key findings: Interaction API not available, Patient PUT works with full payload.
// See memory: reference_crio_reminder_system.md

/* eslint-disable no-unused-vars */
async function testCrioApiPhase3(testPatientKey, testSiteId) {
  const results = {};

  // 1. Get FULL patient object (we need to see exact structure for PUT)
  let fullPatient = null;
  try {
    const pr = await crioFetch(`/api/v1/patient/${testPatientKey}/site/${testSiteId}`);
    if (pr.status === 200) {
      fullPatient = JSON.parse(pr.body);
      results.fullPatientObject = fullPatient;
    }
  } catch (e) { results.fullPatientObject = { error: e.message }; }

  // 2. Try PUT with the full patient object + updated notes (mirror what we received)
  if (fullPatient && fullPatient.patientInfo) {
    const pi = fullPatient.patientInfo;
    // PUT attempts — error said "siteId : site id is required", so include siteId in body
    const contact = pi.patientContact || {};
    const testNote = '[CRP Dashboard reminder test ' + new Date().toISOString() + ']';
    const baseNotes = (pi.notes || '') ? pi.notes + '\n' + testNote : testNote;

    // Attempt A: siteId in body + notes only
    try {
      const putA = await crioPut(`/api/v1/patient/${testPatientKey}`, {
        siteId: testSiteId, notes: baseNotes
      });
      results.putAttemptA = { desc: 'PUT /patient/{id} with {siteId, notes}', status: putA.status, body: putA.body.substring(0, 600) };
    } catch (e) { results.putAttemptA = { error: e.message }; }

    // Attempt B: siteId + full patientInfo wrapper
    try {
      const putB = await crioPut(`/api/v1/patient/${testPatientKey}`, {
        siteId: testSiteId,
        patientInfo: { notes: baseNotes }
      });
      results.putAttemptB = { desc: 'PUT /patient/{id} with {siteId, patientInfo:{notes}}', status: putB.status, body: putB.body.substring(0, 600) };
    } catch (e) { results.putAttemptB = { error: e.message }; }

    // Attempt C: siteId + firstName/lastName + notes (match create schema)
    try {
      const putC = await crioPut(`/api/v1/patient/${testPatientKey}`, {
        siteId: testSiteId,
        firstName: contact.firstName || '',
        lastName: contact.lastName || '',
        notes: baseNotes
      });
      results.putAttemptC = { desc: 'PUT /patient/{id} with {siteId, firstName, lastName, notes}', status: putC.status, body: putC.body.substring(0, 600) };
    } catch (e) { results.putAttemptC = { error: e.message }; }

    // Attempt D: siteId + patientContact wrapper + notes
    try {
      const putD = await crioPut(`/api/v1/patient/${testPatientKey}`, {
        siteId: testSiteId,
        patientContact: { firstName: contact.firstName || '', lastName: contact.lastName || '' },
        notes: baseNotes
      });
      results.putAttemptD = { desc: 'PUT /patient/{id} with {siteId, patientContact, notes}', status: putD.status, body: putD.body.substring(0, 600) };
    } catch (e) { results.putAttemptD = { error: e.message }; }

    // Attempt E: full mirror of GET response with siteId
    try {
      const putE = await crioPut(`/api/v1/patient/${testPatientKey}`, {
        siteId: testSiteId,
        revision: fullPatient.revision,
        patientInfo: { ...pi, notes: baseNotes }
      });
      results.putAttemptE = { desc: 'PUT /patient/{id} with {siteId, revision, patientInfo:{...full}}', status: putE.status, body: putE.body.substring(0, 600) };
    } catch (e) { results.putAttemptE = { error: e.message }; }

    // Attempt F: siteId as integer
    try {
      const putF = await crioPut(`/api/v1/patient/${testPatientKey}`, {
        siteId: parseInt(testSiteId), notes: baseNotes
      });
      results.putAttemptF = { desc: 'PUT /patient/{id} with {siteId(int), notes}', status: putF.status, body: putF.body.substring(0, 600) };
    } catch (e) { results.putAttemptF = { error: e.message }; }
  }

  // 3. Query BQ patient_interaction table to understand schema + interaction types
  try {
    const schema = await runQuery(`SELECT column_name, data_type
      FROM \`crio-468120\`.crio_data.INFORMATION_SCHEMA.COLUMNS
      WHERE table_name = 'patient_interaction' ORDER BY ordinal_position`);
    results.interactionTableSchema = schema;
  } catch (e) { results.interactionTableSchema = { error: e.message }; }

  // 4. Sample recent interactions — skip (already got them in phase 3)

  // 5. Get distinct interaction action_types from BQ with counts
  try {
    const types = await runQuery(`SELECT
      CAST(pi.action_type AS STRING) AS action_type,
      COUNT(*) AS cnt,
      MAX(pi.action_details) AS sample_detail
      FROM ${tbl('patient_interaction')} pi
      WHERE pi.site_key IN (1679, 5545)
      GROUP BY 1 ORDER BY cnt DESC LIMIT 30`);
    results.interactionActionTypes = types;
  } catch (e) { results.interactionActionTypes = { error: e.message }; }

  // 5b. Communication log table — check if it exists and what's in it
  try {
    const clSchema = await runQuery(`SELECT column_name, data_type
      FROM \`crio-468120\`.crio_data.INFORMATION_SCHEMA.COLUMNS
      WHERE table_name = 'communication_log' ORDER BY ordinal_position`);
    results.communicationLogSchema = clSchema;
  } catch (e) { results.communicationLogSchema = { error: e.message }; }

  // 5c. Sample communication_log entries
  try {
    const clSamples = await runQuery(`SELECT * FROM ${tbl('communication_log')}
      WHERE site_key = 1679
      ORDER BY last_updated DESC LIMIT 5`);
    results.communicationLogSamples = clSamples;
  } catch (e) { results.communicationLogSamples = { error: e.message }; }

  // 5d. Find user_key 327503 (Chloe AI) — how does it log interactions?
  try {
    const chloeInteractions = await runQuery(`SELECT
      CAST(pi.action_type AS STRING) AS action_type,
      COUNT(*) AS cnt,
      MIN(FORMAT_DATETIME('%Y-%m-%d', pi.date_created)) AS earliest,
      MAX(FORMAT_DATETIME('%Y-%m-%d', pi.date_created)) AS latest
      FROM ${tbl('patient_interaction')} pi
      WHERE pi.user_key = 327503
      GROUP BY 1 ORDER BY cnt DESC`);
    results.chloeAiStats = chloeInteractions;
  } catch (e) { results.chloeAiStats = { error: e.message }; }

  // 5e. Check if there's a communication_log_type or action_type reference table
  try {
    const refTables = await runQuery(`SELECT table_name FROM \`crio-468120\`.crio_data.INFORMATION_SCHEMA.TABLES
      WHERE LOWER(table_name) LIKE '%communication%' OR LOWER(table_name) LIKE '%interaction%'
      OR LOWER(table_name) LIKE '%action_type%' OR LOWER(table_name) LIKE '%message%'
      OR LOWER(table_name) LIKE '%sms%' OR LOWER(table_name) LIKE '%notification%'`);
    results.relatedTables = refTables;
  } catch (e) { results.relatedTables = { error: e.message }; }

  // 6. Deep dive: outreach_sms table
  try {
    const smsSchema = await runQuery(`SELECT column_name, data_type
      FROM \`crio-468120\`.crio_data.INFORMATION_SCHEMA.COLUMNS
      WHERE table_name = 'outreach_sms' ORDER BY ordinal_position`);
    results.outreachSmsSchema = smsSchema;
  } catch (e) { results.outreachSmsSchema = { error: e.message }; }

  try {
    const smsSamples = await runQuery(`SELECT * FROM ${tbl('outreach_sms')}
      WHERE site_key = 1679
      ORDER BY last_updated DESC LIMIT 10`);
    results.outreachSmsSamples = smsSamples;
  } catch (e) { results.outreachSmsSamples = { error: e.message }; }

  // Distinct statuses/types in outreach_sms
  try {
    const smsStats = await runQuery(`SELECT
      CAST(status AS STRING) AS status,
      CAST(direction AS STRING) AS direction,
      CAST(type AS STRING) AS type,
      COUNT(*) AS cnt
      FROM ${tbl('outreach_sms')}
      GROUP BY 1, 2, 3 ORDER BY cnt DESC LIMIT 30`);
    results.outreachSmsStats = smsStats;
  } catch (e) { results.outreachSmsStats = { error: e.message }; }

  // Volume by month
  try {
    const smsVol = await runQuery(`SELECT
      FORMAT_DATETIME('%Y-%m', date_created) AS month,
      COUNT(*) AS cnt
      FROM ${tbl('outreach_sms')}
      WHERE date_created >= '2025-01-01'
      GROUP BY 1 ORDER BY 1 DESC LIMIT 18`);
    results.outreachSmsVolume = smsVol;
  } catch (e) { results.outreachSmsVolume = { error: e.message }; }

  // 7. Explore action type dimension tables
  try {
    const atSchema = await runQuery(`SELECT column_name, data_type
      FROM \`crio-468120\`.crio_data.INFORMATION_SCHEMA.COLUMNS
      WHERE table_name = 'dim_user_audit_log_action_type_name' ORDER BY ordinal_position`);
    results.actionTypeDimSchema = atSchema;
  } catch (e) { results.actionTypeDimSchema = { error: e.message }; }

  try {
    const atValues = await runQuery(`SELECT * FROM ${tbl('dim_user_audit_log_action_type_name')}
      ORDER BY 1 LIMIT 50`);
    results.actionTypeDimValues = atValues;
  } catch (e) { results.actionTypeDimValues = { error: e.message }; }

  // 8. Check outreach_sms linkage to patient_interaction
  try {
    const linked = await runQuery(`SELECT
      CAST(os.outreach_sms_key AS STRING) AS sms_key,
      CAST(os.patient_interaction_key AS STRING) AS interaction_key,
      os.phone_number, os.message_body,
      CAST(os.status AS STRING) AS status,
      CAST(os.direction AS STRING) AS direction,
      FORMAT_DATETIME('%Y-%m-%d %H:%M', os.date_created) AS created,
      CAST(os.patient_key AS STRING) AS patient_key,
      CAST(os.study_key AS STRING) AS study_key,
      CAST(os.user_key AS STRING) AS user_key
      FROM ${tbl('outreach_sms')} os
      WHERE os.site_key = 1679
      ORDER BY os.date_created DESC LIMIT 10`);
    results.outreachSmsLinked = linked;
  } catch (e) { results.outreachSmsLinked = { error: e.message }; }

  // 9. CRITICAL: Explore CRIO's built-in reminder tables
  // study_visit_reminder — reminder templates per visit type
  try {
    const svrSchema = await runQuery(`SELECT column_name, data_type
      FROM \`crio-468120\`.crio_data.INFORMATION_SCHEMA.COLUMNS
      WHERE table_name = 'study_visit_reminder' ORDER BY ordinal_position`);
    results.studyVisitReminderSchema = svrSchema;
  } catch (e) { results.studyVisitReminderSchema = { error: e.message }; }

  try {
    const svrData = await runQuery(`SELECT * FROM ${tbl('study_visit_reminder')}
      WHERE _fivetran_deleted = false ORDER BY last_updated DESC LIMIT 20`);
    results.studyVisitReminderData = svrData;
  } catch (e) { results.studyVisitReminderData = { error: e.message }; }

  // subject_visit_reminder — actual reminders sent/scheduled per subject visit
  try {
    const subvrSchema = await runQuery(`SELECT column_name, data_type
      FROM \`crio-468120\`.crio_data.INFORMATION_SCHEMA.COLUMNS
      WHERE table_name = 'subject_visit_reminder' ORDER BY ordinal_position`);
    results.subjectVisitReminderSchema = subvrSchema;
  } catch (e) { results.subjectVisitReminderSchema = { error: e.message }; }

  try {
    const subvrData = await runQuery(`SELECT * FROM ${tbl('subject_visit_reminder')}
      WHERE _fivetran_deleted = false ORDER BY last_updated DESC LIMIT 20`);
    results.subjectVisitReminderData = subvrData;
  } catch (e) { results.subjectVisitReminderData = { error: e.message }; }

  // study_reminder — study-level reminder config
  try {
    const srSchema = await runQuery(`SELECT column_name, data_type
      FROM \`crio-468120\`.crio_data.INFORMATION_SCHEMA.COLUMNS
      WHERE table_name = 'study_reminder' ORDER BY ordinal_position`);
    results.studyReminderSchema = srSchema;
  } catch (e) { results.studyReminderSchema = { error: e.message }; }

  try {
    const srData = await runQuery(`SELECT * FROM ${tbl('study_reminder')}
      WHERE _fivetran_deleted = false ORDER BY last_updated DESC LIMIT 20`);
    results.studyReminderData = srData;
  } catch (e) { results.studyReminderData = { error: e.message }; }

  // outreach_email and outreach_direct schemas
  try {
    const oeSchema = await runQuery(`SELECT column_name, data_type
      FROM \`crio-468120\`.crio_data.INFORMATION_SCHEMA.COLUMNS
      WHERE table_name = 'outreach_email' ORDER BY ordinal_position`);
    results.outreachEmailSchema = oeSchema;
  } catch (e) { results.outreachEmailSchema = { error: e.message }; }

  try {
    const odSchema = await runQuery(`SELECT column_name, data_type
      FROM \`crio-468120\`.crio_data.INFORMATION_SCHEMA.COLUMNS
      WHERE table_name = 'outreach_direct' ORDER BY ordinal_position`);
    results.outreachDirectSchema = odSchema;
  } catch (e) { results.outreachDirectSchema = { error: e.message }; }

  // Twilio phone configuration — what numbers does CRIO have?
  try {
    const twilioTables = await runQuery(`SELECT table_name FROM \`crio-468120\`.crio_data.INFORMATION_SCHEMA.TABLES
      WHERE LOWER(table_name) LIKE '%twilio%' OR LOWER(table_name) LIKE '%phone%'`);
    results.twilioTables = twilioTables;
  } catch (e) { results.twilioTables = { error: e.message }; }

  // If twilio_phone table exists, get the numbers
  try {
    const twilioPhones = await runQuery(`SELECT * FROM ${tbl('twilio_phone')}
      WHERE _fivetran_deleted = false LIMIT 10`);
    results.twilioPhones = twilioPhones;
  } catch (e) {
    // Try alternate table names
    try {
      const tp2 = await runQuery(`SELECT table_name FROM \`crio-468120\`.crio_data.INFORMATION_SCHEMA.TABLES
        WHERE LOWER(table_name) LIKE '%twilio%'`);
      results.twilioPhones = { tables_found: tp2 };
    } catch (e2) { results.twilioPhones = { error: e.message }; }
  }

  return results;
}

// ── CRIO API Test Phase 2 — deeper probing with POST and more path patterns ──
async function testCrioApiPhase2(testPatientKey, testSiteId) {
  const results = {};

  // Find a study + subject for this patient (interactions may be study-scoped)
  let studyKey = null, subjectKey = null;
  try {
    const subs = await runQuery(`SELECT CAST(s.study_key AS STRING) AS study_key,
      CAST(s.subject_key AS STRING) AS subject_key, s.status
      FROM ${tbl('subject')} s
      WHERE CAST(s.patient_key AS STRING) = '${testPatientKey}'
      AND s.status >= 1 ORDER BY s.status DESC LIMIT 1`);
    if (subs.length) {
      studyKey = subs[0].study_key;
      subjectKey = subs[0].subject_key;
      results.testSubject = { studyKey, subjectKey, status: subs[0].status };
    }
  } catch (e) { results.testSubject = { error: e.message }; }

  // Try POST to interaction paths (some APIs only accept POST for creation)
  const interactionBody = {
    type: 'TEXT',
    notes: 'CRIO API test — automated reminder system probe. Please ignore.',
    direction: 'OUTBOUND',
    timestamp: new Date().toISOString()
  };

  const postPaths = [
    `/api/v1/patient/${testPatientKey}/interaction`,
    `/api/v1/patient/${testPatientKey}/site/${testSiteId}/interaction`,
    `/api/v1/patient/${testPatientKey}/interactions`,
    `/api/v1/patient/${testPatientKey}/site/${testSiteId}/interactions`,
    `/api/v1/site/${testSiteId}/patient/${testPatientKey}/interaction`,
    `/api/v1/site/${testSiteId}/interaction`,
    // Subject-scoped (study context)
    ...(studyKey && subjectKey ? [
      `/api/v1/study/${studyKey}/site/${testSiteId}/subject/${subjectKey}/interaction`,
      `/api/v1/study/${studyKey}/site/${testSiteId}/subject/${subjectKey}/interactions`,
      `/api/v1/subject/${subjectKey}/interaction`,
    ] : []),
    // Recruitment-specific
    `/api/v1/recruitment/patient/${testPatientKey}/interaction`,
    `/api/v1/recruitment/interaction`,
  ];

  results.postProbe = {};
  for (const path of postPaths) {
    try {
      // Use OPTIONS first to check if POST is allowed (non-destructive)
      const optR = await new Promise((resolve, reject) => {
        const url = CRIO_API_BASE + path + '?client_id=' + CRIO_CLIENT_ID;
        const u = new URL(url);
        const req = https.request({ hostname: u.hostname, path: u.pathname + u.search, method: 'OPTIONS',
          headers: { 'Authorization': 'Bearer ' + CRIO_TOKEN, 'Accept': 'application/json' }
        }, res => { let d = ''; res.on('data', c => d += c);
          res.on('end', () => resolve({ status: res.statusCode, allow: res.headers['allow'] || '', body: d.substring(0, 200) })); });
        req.on('error', reject); req.end();
      });
      results.postProbe[path] = { options: optR };

      // If OPTIONS didn't explicitly reject, try POST with a dry-run style body
      if (optR.status !== 404) {
        const pr = await crioPost(path, interactionBody);
        results.postProbe[path].post = { status: pr.status, body: pr.body.substring(0, 400) };
      }
    } catch (e) { results.postProbe[path] = { error: e.message }; }
  }

  // Try v2 API paths
  const v2Paths = [
    `/api/v2/patient/${testPatientKey}/interaction`,
    `/api/v2/patient/${testPatientKey}/site/${testSiteId}/interaction`,
  ];
  results.v2Probe = {};
  for (const path of v2Paths) {
    try {
      const r = await crioFetch(path);
      results.v2Probe[path] = { get: { status: r.status, body: r.body.substring(0, 200) } };
    } catch (e) { results.v2Probe[path] = { error: e.message }; }
  }

  // Explore patient object fields — may contain interactions sub-resource
  try {
    const pr = await crioFetch(`/api/v1/patient/${testPatientKey}/site/${testSiteId}`);
    if (pr.status === 200) {
      const pData = JSON.parse(pr.body);
      results.patientFields = Object.keys(pData.patientInfo || pData).filter(k => !['notes'].includes(k));
      // Check if patient has any interaction-related fields
      const interactionKeys = Object.keys(pData.patientInfo || pData).filter(k =>
        /interact|communi|message|text|sms|email|note|call|log/i.test(k));
      results.interactionRelatedFields = interactionKeys;
    }
  } catch (e) { results.patientFields = { error: e.message }; }

  // Try patient update (PUT) with just a notes field — tests write capability
  try {
    const putR = await crioPut(`/api/v1/patient/${testPatientKey}/site/${testSiteId}`, {
      notes: 'CRP Dashboard automated reminder test — ' + new Date().toISOString()
    });
    results.patientUpdate = { status: putR.status, body: putR.body.substring(0, 400) };
  } catch (e) { results.patientUpdate = { error: e.message }; }

  return results;
}

// ── CRIO API Test — probes interaction, appointment, and patient endpoints ──
async function testCrioApi() {
  const results = {};

  // 1. Auth check — GET /sites (known working endpoint)
  try {
    const sites = await crioFetch('/api/v1/sites');
    const parsed = JSON.parse(sites.body);
    results.auth = { status: sites.status, ok: sites.status === 200,
      sites: Array.isArray(parsed) ? parsed.map(s => ({ id: s.siteId, name: s.name, studies: (s.studies||[]).length })) : 'unexpected format' };
  } catch (e) { results.auth = { error: e.message }; }

  // 2. Get a test patient from BQ (we need a patient_key to test interaction endpoints)
  let testPatientKey = null;
  let testPatientSiteId = CRIO_SITE_IDS.PHL;
  try {
    const patients = await runQuery(`SELECT CAST(p.patient_key AS STRING) AS patient_key, p.first_name, p.last_name,
      CAST(p.site_key AS STRING) AS site_key
      FROM ${tbl('patient')} p WHERE p.site_key IN (1679, 5545)
      AND p.first_name IS NOT NULL AND p.last_name IS NOT NULL
      ORDER BY p._fivetran_synced DESC LIMIT 5`);
    if (patients.length > 0) {
      testPatientKey = patients[0].patient_key;
      testPatientSiteId = patients[0].site_key;
      results.testPatient = { key: testPatientKey, name: patients[0].first_name + ' ' + patients[0].last_name, site: testPatientSiteId };
    } else {
      results.testPatient = { error: 'No patients found in BQ' };
    }
  } catch (e) { results.testPatient = { error: e.message }; }

  // 3. Test GET patient (confirm patient read works)
  if (testPatientKey) {
    try {
      const pr = await crioFetch(`/api/v1/patient/${testPatientKey}/site/${testPatientSiteId}`);
      const pBody = pr.body.substring(0, 500);
      results.getPatient = { status: pr.status, ok: pr.status === 200, preview: pBody };
    } catch (e) { results.getPatient = { error: e.message }; }
  }

  // 4. Probe interaction endpoints (try multiple path patterns)
  const interactionPaths = [
    `/api/v1/patient/${testPatientKey}/interaction`,
    `/api/v1/patient/${testPatientKey}/site/${testPatientSiteId}/interaction`,
    `/api/v1/interaction`,
    `/api/v1/site/${testPatientSiteId}/patient/${testPatientKey}/interaction`,
  ];

  // First: GET each path to see which ones exist (non-destructive)
  results.interactionProbe = {};
  for (const path of interactionPaths) {
    if (!testPatientKey && path.includes(testPatientKey)) continue;
    try {
      const r = await crioFetch(path);
      results.interactionProbe[path] = { method: 'GET', status: r.status, body: r.body.substring(0, 300) };
    } catch (e) { results.interactionProbe[path] = { method: 'GET', error: e.message }; }
  }

  // 5. Probe appointment-related endpoints
  const appointmentPaths = [
    `/api/v1/site/${testPatientSiteId}/calendar/availability`,
    `/api/v1/site/${testPatientSiteId}/appointment`,
    `/api/v1/appointment`,
  ];
  results.appointmentProbe = {};
  for (const path of appointmentPaths) {
    try {
      const r = await crioFetch(path);
      results.appointmentProbe[path] = { method: 'GET', status: r.status, body: r.body.substring(0, 300) };
    } catch (e) { results.appointmentProbe[path] = { error: e.message }; }
  }

  // 6. API docs/swagger discovery (some CRIO instances expose this)
  const docPaths = ['/api/v1', '/api/v1/docs', '/swagger.json', '/api/docs'];
  results.docsProbe = {};
  for (const path of docPaths) {
    try {
      const r = await crioFetch(path);
      results.docsProbe[path] = { status: r.status, body: r.body.substring(0, 200) };
    } catch (e) { results.docsProbe[path] = { error: e.message }; }
  }

  return results;
}

// ═══════════════════════════════════════════════════════════
// CLICKUP API FEEDS — Referrals, Campaigns, Medical Records
// ═══════════════════════════════════════════════════════════

const CLICKUP_TOKEN = process.env.CLICKUP_TOKEN || '';
const CLICKUP_API = 'https://api.clickup.com/api/v2';

const REFERRAL_LISTS = [
  { id: '901413202462', name: 'Dr. Modarressi', source_type: 'physician' },
  { id: '901414013590', name: 'Center For Primary Care Medicine', source_type: 'physician' },
  { id: '901413613360', name: 'Dr. Savita Singh', source_type: 'physician' },
  { id: '901414585282', name: 'Dr. Richard Mandel', source_type: 'physician' },
  { id: '901414585292', name: 'Prohealth Associates', source_type: 'physician' },
  { id: '901414585307', name: 'Parkwood', source_type: 'physician' },
  { id: '901414585313', name: 'SkinSmart Dermatology', source_type: 'physician' },
  { id: '901414585319', name: 'Princeton Dermatology', source_type: 'physician' },
  { id: '901414585325', name: 'Aura Derm', source_type: 'physician' },
  { id: '901414926366', name: 'Tri-County Rheumatology', source_type: 'physician' },
];
const CAMPAIGN_LIST_ID = '901407896291';
const MED_RECORDS_FOLDER_ID = '90147290121';

const PIPELINE_MAP = {
  'pending provider outreach': 'New Lead', 'recruiter to contact': 'New Lead',
  'schedule directly': 'Contacted', 'participant interested': 'Contacted', 'in contact': 'Contacted',
  'scheduled pre-screening': 'Pre-Screening', 'scheduled screening': 'Screening',
  'screening completed': 'Screened', 'randomization completed': 'Enrolled',
  'dnq': 'DNQ', 'unable to reach': 'Lost', 'screen fail': 'Screen Fail',
  'complete': 'Enrolled', 'pending release': 'New Lead', 'under review': 'New Lead',
  'not interested': 'Lost', 'ready to schedule': 'Contacted', 'no show': 'Lost',
  'in screening': 'Screening', 'scheduled': 'Screening', 'enrolled': 'Enrolled',
};
const CLOSED_STAGES = new Set(['DNQ', 'Screen Fail', 'Lost']);
const SOURCE_RENAME = { 'Practice': 'Princeton CardioMetabolic' };

const MED_STATUS_MAP = {
  'unable to reach': 'Unable to Reach', 'not interested': 'Not Interested',
  'pending release': 'Pending Release', 'under review': 'Under Review', 'dnq': 'DNQ',
  'ready to schedule': 'Ready to Schedule', 'enrolled': 'Enrolled',
  'in screening': 'In Screening', 'screen fail': 'Screen Fail',
  'no show': 'No Show', 'no show not rescheduled': 'No Show',
  'complete': 'Complete', 'discontinued': 'Discontinued', 'cancelled': 'Cancelled',
  'in another study': 'In Another Study', 'withdrawn': 'Withdrawn',
};
['visit 0','visit 1','visit 2','visit 3','visit 4','visit 5','visit 6','visit 7'].forEach(
  v => { MED_STATUS_MAP[v + ' scheduled'] = 'Visit Scheduled'; });
const MED_ACTIVE = new Set(['Pending Release','Under Review','Ready to Schedule','Visit Scheduled','In Screening','Enrolled']);
const MED_CLOSED = new Set(['DNQ','Screen Fail','Not Interested','Unable to Reach','No Show','Complete','Discontinued','Cancelled','In Another Study','Withdrawn']);

async function clickupFetch(path) {
  if (!CLICKUP_TOKEN) throw new Error('No CLICKUP_TOKEN configured');
  return new Promise((resolve, reject) => {
    const u = new URL(CLICKUP_API + path);
    const req = https.request({ hostname: u.hostname, path: u.pathname + u.search, method: 'GET',
      headers: { 'Authorization': CLICKUP_TOKEN }
    }, res => { let d = ''; res.on('data', c => d += c); res.on('end', () => {
      try { resolve(JSON.parse(d)); } catch(e) { reject(new Error('ClickUp parse error')); }
    }); });
    req.on('error', reject); req.end();
  });
}

async function clickupPost(path, body) {
  if (!CLICKUP_TOKEN) throw new Error('No CLICKUP_TOKEN configured');
  return new Promise((resolve, reject) => {
    const u = new URL(CLICKUP_API + path);
    const data = JSON.stringify(body);
    const req = https.request({ hostname: u.hostname, path: u.pathname + u.search, method: 'POST',
      headers: { 'Authorization': CLICKUP_TOKEN, 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(data) }
    }, res => { let d = ''; res.on('data', c => d += c); res.on('end', () => {
      try { resolve(JSON.parse(d)); } catch(e) { reject(new Error('ClickUp parse error: ' + d.substring(0, 200))); }
    }); });
    req.on('error', reject); req.write(data); req.end();
  });
}

async function clickupPut(path, body) {
  if (!CLICKUP_TOKEN) throw new Error('No CLICKUP_TOKEN configured');
  return new Promise((resolve, reject) => {
    const u = new URL(CLICKUP_API + path);
    const data = JSON.stringify(body);
    const req = https.request({ hostname: u.hostname, path: u.pathname + u.search, method: 'PUT',
      headers: { 'Authorization': CLICKUP_TOKEN, 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(data) }
    }, res => { let d = ''; res.on('data', c => d += c); res.on('end', () => {
      try { resolve(JSON.parse(d)); } catch(e) { reject(new Error('ClickUp parse error: ' + d.substring(0, 200))); }
    }); });
    req.on('error', reject); req.write(data); req.end();
  });
}

// ── Follow-Up → ClickUp Sync ──
const FOLLOWUP_LIST_ID = '901414925909';
// List statuses: selected (open), start up, recruiting, maintenance, feasibility, terminated/ended/haulted (done), complete (closed)
const FU_ACTION_TO_STATUS = {
  'reschedule': 'recruiting', 'call': 'recruiting', 'recruit': 'recruiting',
  'rescreen': 'recruiting', 'waitlist': 'maintenance', 'lost': 'complete', 'noaction': 'complete'
};
const FU_ACTION_LABELS = {
  'reschedule': 'Reschedule Visit', 'call': 'Call Patient', 'recruit': 'Send to Recruitment',
  'rescreen': 'Re-screen', 'waitlist': 'Add to Waitlist', 'lost': 'Mark as Lost', 'noaction': 'No Action Needed'
};

async function syncFollowUpToClickUp(payload) {
  const { patient, study, category, action, reason, coord, site, crio_url, status, source, risk } = payload;
  if (!patient || !action) throw new Error('patient and action are required');

  const statusName = FU_ACTION_TO_STATUS[action] || 'selected';
  const actionLabel = FU_ACTION_LABELS[action] || action;

  // Search for existing task by name in the follow-up list (paginate through all)
  let allTasks = [];
  let page = 0;
  while (true) {
    const batch = await clickupFetch('/list/' + FOLLOWUP_LIST_ID + '/task?page=' + page + '&limit=100&include_closed=true');
    allTasks = allTasks.concat(batch.tasks || []);
    if (!batch.tasks || batch.tasks.length < 100) break;
    page++;
  }
  const nameLower = patient.toLowerCase().trim();
  const match = allTasks.find(t => (t.name || '').toLowerCase().trim() === nameLower);

  if (match) {
    // Update existing task status + add comment
    await clickupPut('/task/' + match.id, { status: statusName });
    const commentLines = [
      `**Action:** ${actionLabel}`,
      `**Study:** ${study || '—'}`,
      `**Category:** ${category || '—'}`,
      `**Reason:** ${reason || '—'}`,
      `**Coordinator:** ${coord || '—'}`,
      crio_url ? `**CRIO:** ${crio_url}` : '',
      `*Updated from CRP Dashboard at ${new Date().toISOString().replace('T', ' ').substring(0, 19)}*`
    ].filter(Boolean).join('\n');
    await clickupPost('/task/' + match.id + '/comment', { comment_text: commentLines });
    return { updated: true, task_id: match.id, url: 'https://app.clickup.com/t/' + match.id };
  }

  // Create new task with full context
  const description = [
    `## Patient Follow-Up`,
    ``,
    `| Field | Value |`,
    `|-------|-------|`,
    `| **Category** | ${category || '—'} |`,
    `| **CRIO Status** | ${status || '—'} |`,
    `| **Study** | ${study || '—'} |`,
    `| **Reason** | ${reason || '—'} |`,
    `| **Coordinator** | ${coord || '—'} |`,
    `| **Site** | ${site || '—'} |`,
    `| **Referral Source** | ${source || '—'} |`,
    `| **Risk Level** | ${risk || '—'} |`,
    `| **Action** | ${actionLabel} |`,
    ``,
    crio_url ? `### CRIO Link\n${crio_url}` : '',
    ``,
    `---`,
    `*Created from CRP Dashboard at ${new Date().toISOString().replace('T', ' ').substring(0, 19)}*`
  ].filter(Boolean).join('\n');

  const taskBody = {
    name: patient,
    description,
    status: statusName,
    tags: [category || 'follow-up', actionLabel.toLowerCase()],
  };

  const task = await clickupPost('/list/' + FOLLOWUP_LIST_ID + '/task', taskBody);
  if (!task || !task.id) {
    console.error('ClickUp task creation failed:', JSON.stringify(task));
    throw new Error('ClickUp returned no task ID: ' + JSON.stringify(task).substring(0, 200));
  }

  return { created: true, task_id: task.id, url: 'https://app.clickup.com/t/' + task.id };
}

async function fetchAllClickUpTasks(listId) {
  let all = [], page = 0;
  while (true) {
    const d = await clickupFetch('/list/' + listId + '/task?page=' + page + '&limit=100&include_closed=true');
    all = all.concat(d.tasks || []);
    if (!d.tasks || d.tasks.length < 100) break;
    page++;
  }
  return all;
}

function parseCustomFields(fields) {
  const obj = {};
  (fields || []).forEach(f => {
    if (f.value == null) return;
    const opts = (f.type_config || {}).options || [];
    if (f.type === 'drop_down' && typeof f.value === 'number' && opts.length > 0) {
      // Dropdown: resolve index → label
      const opt = opts[f.value];
      obj[f.name] = opt ? (opt.name || opt.label || String(f.value)) : String(f.value);
    } else if (f.type === 'labels' && Array.isArray(f.value) && opts.length > 0) {
      // Labels: resolve UUIDs → label names
      const labelMap = {};
      opts.forEach(o => { labelMap[o.id] = o.label || o.name || o.id; });
      obj[f.name] = f.value.map(id => labelMap[id] || id).join(', ');
    } else if (f.type === 'date' && typeof f.value === 'number') {
      // Date: epoch ms → YYYY-MM-DD
      obj[f.name] = new Date(f.value).toISOString().split('T')[0];
    } else if (f.type === 'date' && typeof f.value === 'string' && /^\d{10,}$/.test(f.value)) {
      obj[f.name] = new Date(parseInt(f.value)).toISOString().split('T')[0];
    } else {
      obj[f.name] = typeof f.value === 'object' ? JSON.stringify(f.value) : String(f.value);
    }
  });
  return obj;
}

// ── ClickUp Feed Handlers ──

async function fetchReferrals() {
  // Fetch all 10 provider lists in parallel (was sequential — 15s → ~3s)
  const listResults = await Promise.all(
    REFERRAL_LISTS.map(list => fetchAllClickUpTasks(list.id).then(tasks => ({ list, tasks })).catch(e => { console.warn('ClickUp list', list.name, 'failed:', e.message); return { list, tasks: [] }; }))
  );
  const rows = [];
  for (const { list, tasks } of listResults) {
    for (const t of tasks) {
      const f = parseCustomFields(t.custom_fields);
      const statusRaw = ((t.status || {}).status || '').toLowerCase();
      const stage = PIPELINE_MAP[statusRaw] || 'Other';
      const source = SOURCE_RENAME[f['Source']] || f['Source'] || list.name;
      const dc = t.date_created ? new Date(parseInt(t.date_created)).toISOString().split('T')[0] : '';
      const du = t.date_updated ? new Date(parseInt(t.date_updated)).toISOString().split('T')[0] : '';
      const days = t.date_updated ? Math.floor((Date.now() - parseInt(t.date_updated)) / 86400000) : 999;
      const closed = CLOSED_STAGES.has(stage) || (t.status||{}).type === 'closed' || (t.status||{}).type === 'done';
      rows.push({
        id: t.id, name: t.name||'', tracker: list.name, source_type: list.source_type,
        source, study: f['Study']||'', status_raw: (t.status||{}).status||'', stage,
        phone: f['Phone #']||'', dob: f['Patient DOB']||'',
        referring_physician: f['Referring Physician']||'',
        next_appt: f['Next Appointment Date']||'',
        date_created: dc, date_updated: du, days_since_update: days,
        url: t.url || 'https://app.clickup.com/t/' + t.id,
        is_closed: closed ? 'TRUE' : 'FALSE'
      });
    }
  }
  return rows;
}

async function fetchCampaigns() {
  const tasks = await fetchAllClickUpTasks(CAMPAIGN_LIST_ID);
  return tasks.map(t => {
    const f = parseCustomFields(t.custom_fields);
    return {
      study: t.name||'', vendor: ((t.status||{}).status||'').trim(),
      first_contact: parseInt(f['FIRST CONTACT']||'0')||0,
      second_contact: parseInt(f['SECOND CONTACT']||'0')||0,
      third_contact: parseInt(f['THIRD CONTACT']||'0')||0,
      new_referrals: parseInt(f['New Referrals']||'0')||0,
      scheduled: parseInt(f['Scheduled']||f['SCHEDULED']||'0')||0,
      url: t.url || 'https://app.clickup.com/t/' + t.id
    };
  });
}

async function fetchMedRecords() {
  const folderData = await clickupFetch('/folder/' + MED_RECORDS_FOLDER_ID + '/list');
  const lists = folderData.lists || [];
  const rows = [];
  for (const list of lists) {
    const tasks = await fetchAllClickUpTasks(list.id);
    for (const t of tasks) {
      const f = parseCustomFields(t.custom_fields);
      const statusRaw = ((t.status||{}).status||'').toLowerCase();
      const status = MED_STATUS_MAP[statusRaw] || statusRaw || 'Unknown';
      const isActive = MED_ACTIVE.has(status);
      const isClosed = MED_CLOSED.has(status) || (t.status||{}).type === 'closed' || (t.status||{}).type === 'done';
      const dc = t.date_created ? new Date(parseInt(t.date_created)).toISOString().split('T')[0] : '';
      const du = t.date_updated ? new Date(parseInt(t.date_updated)).toISOString().split('T')[0] : '';
      const days = t.date_updated ? Math.floor((Date.now() - parseInt(t.date_updated)) / 86400000) : 999;
      const assignees = (t.assignees||[]).map(a => a.username||'').join(', ');
      let recordsInCrio = '';
      (t.custom_fields||[]).forEach(cf => {
        if (cf.name === 'Medical records added to CRIO' && cf.type === 'checkbox')
          recordsInCrio = cf.value === 'true' || cf.value === true ? 'Yes' : 'No';
      });
      rows.push({
        id: t.id, name: t.name||'', study: list.name, status_raw: (t.status||{}).status||'',
        status, assignee: assignees,
        phone: f['Phone #']||f['Phone']||'', dob: f['Patient DOB']||f['DOB']||'',
        crio_link: f['CRIO Link']||'',
        records_received: f['Medical records received?']||'',
        medical_release: f['Medical release (Jotform)']||'',
        records_in_crio: recordsInCrio,
        records_portal: f['Medical Records Portal']||'',
        retrieval_deadline: f['Retrieval Deadline']||'',
        investigator_approval: f['Investigator Approval']||f['PI Approval']||'',
        pre_screening_date: f['Pre-Screening Visit (Date)']||'',
        screening_date: f['Screening Visit (Date)']||'',
        randomization_date: f['Randomization Visit (Date)']||'',
        next_visit_date: f['Next Visit']||f['Next visit date']||'',
        next_appointment: f['Next Appointment Date']||f['Next Appointment']||'',
        last_contact_date: f['Last Contact Date']||'',
        same_day_cancel: f['Same day cancellation?']||'',
        notes: f['Notes']||'', ops_notes: f['Operations Team Notes']||'',
        date_created: dc, date_updated: du, days_since_update: days,
        url: t.url || 'https://app.clickup.com/t/' + t.id,
        is_active: isActive ? 'TRUE' : 'FALSE', is_closed: isClosed ? 'TRUE' : 'FALSE'
      });
    }
  }
  return rows;
}

// ── Register ClickUp feeds ──
// ── Monitoring Visit Tracker (list 901408668193) ──
async function fetchMonitoringVisits() {
  const tasks = await fetchAllClickUpTasks('901408668193');
  return tasks.map(t => {
    const f = parseCustomFields(t.custom_fields);
    return {
      name: t.name || '', status: (t.status||{}).status || '',
      study: f['Study'] || '', monitor: f['Monitor Name '] || f['Monitor Name'] || '',
      visit_date: f['Monitoring Visit Date '] || f['Monitoring Visit Date'] || '',
      visit_type: f['Type of Visit'] || '',
      observations: f['Number of Open Observations '] || f['Number of Open Observations'] || '0',
      observation_category: f['Observation Category '] || f['Observation Category'] || '',
      observation_date: f['Date Observation Occured '] || f['Date Observation Occured'] || '',
      next_steps: f['Next Steps/Corrective Action Taken '] || f['Next Steps/Corrective Action Taken'] || '',
      notes: f['Notes'] || '',
      url: t.url || '',
    };
  });
}

// ── Document Expiries (list 901409831522) ──
async function fetchDocExpiries() {
  const tasks = await fetchAllClickUpTasks('901409831522');
  return tasks.map(t => {
    const f = parseCustomFields(t.custom_fields);
    return {
      name: t.name || '', status: (t.status||{}).status || '',
      license_expiry: f['License Expiry'] || '',
      cv_expiry: f['CV Expiry'] || '',
      gcp_expiry: f['GCP Expiry'] || '',
      cssrs_expiry: f['C-SSRS Expiry'] || '',
      iata_expiry: f['IATA Expiry'] || '',
      url: t.url || '',
    };
  });
}

// ── IRB Expirations (list 901409833229) ──
async function fetchIRBExpirations() {
  const tasks = await fetchAllClickUpTasks('901409833229');
  return tasks.map(t => {
    const f = parseCustomFields(t.custom_fields);
    return {
      study: t.name || '', status: (t.status||{}).status || '',
      irb_expiration: f['IRB Expiration Date'] || '',
      url: t.url || '',
    };
  });
}

// ── Study Master List (list 901407640932) ──
async function fetchStudyMasterList() {
  const tasks = await fetchAllClickUpTasks('901407640932');
  return tasks.map(t => {
    const f = parseCustomFields(t.custom_fields);
    return {
      study: t.name || '', status: (t.status||{}).status || '',
      sponsor: f['Sponsor'] || '', cro: f['CRO'] || '',
      pi: f['PI'] || '', sub_i: f['Sub-I'] || '',
      primary_coordinator: f['Primary Coordinator'] || '',
      backup_coordinator: f['Back-Up Coordinator'] || '',
      phone_screener: f['Phone Screener Completed?'] || '',
      crio_esource: f['CRIO eSource Build'] || '',
      site: f['Study Site'] || '', site_number: f['Site Number'] || '',
      therapeutic_area: f['Therapeutic Area'] || '',
      start_date: f['Study start'] || '',
      url: t.url || '',
    };
  });
}

// ── Study Startup Checklist (Regulatory folder) ──
async function fetchStartupChecklist() {
  const tasks = await fetchAllClickUpTasks('901409833304');
  const CHECKLIST_FIELDS = [
    'IRB Submission done?', 'DOA Received & Created?', 'CRF Guidelines received?',
    'Study made in CRIO & Drive?', 'NTF CTA Routed?', 'NTF Submitted?',
    'Flowchart created?', 'Mining checklist created?', 'One page overview created?',
    'Add Site calibration in CRIO', 'Add CLIA Certification in CRIO?',
    'Blue folders done?', 'Confi completed?', 'Pre-Screener Completed?', 'Vendor\'s List'
  ];
  return tasks.filter(t => !t.parent).map(t => {
    const f = parseCustomFields(t.custom_fields);
    let done = 0, total = 0, pending = 0, items = {};
    CHECKLIST_FIELDS.forEach(field => {
      const val = (f[field] || '').toLowerCase().trim();
      if (val === 'n/a' || val === 'na' || val === '') return;
      total++;
      items[field] = val;
      if (val === 'yes' || val === 'true' || val === '1') done++;
      else if (val === 'pending') pending++;
    });
    return {
      study: t.name || '', status: (t.status||{}).status || '',
      done, total, pending, pct: total > 0 ? Math.round(done / total * 100) : 0,
      items, url: t.url || '',
    };
  });
}

// ── Provider Trackers (all physician tracker lists) ──
const PROVIDER_TRACKER_LISTS = [
  { id: '901413202462', name: 'Dr. Modarressi' },
  { id: '901414013590', name: 'Center For Primary Care Medicine' },
  { id: '901413613360', name: 'Dr. Savita Singh' },
  { id: '901414585282', name: 'Dr. Richard Mandel' },
  { id: '901414585292', name: 'Prohealth Associates' },
  { id: '901414585307', name: 'Parkwood' },
  { id: '901414585313', name: 'SkinSmart Dermatology' },
  { id: '901414585319', name: 'Princeton Dermatology' },
  { id: '901414585325', name: 'Aura Derm' },
  { id: '901414926366', name: 'Tri-County Rheumatology' },
];
async function fetchProviderTrackers() {
  const allRows = [];
  // Fetch all 10 lists in parallel
  const listResults = await Promise.all(
    PROVIDER_TRACKER_LISTS.map(list => fetchAllClickUpTasks(list.id).then(tasks => ({ list, tasks })).catch(e => { console.warn('ClickUp provider', list.name, 'failed:', e.message); return { list, tasks: [] }; }))
  );
  for (const { list, tasks } of listResults) {
    tasks.forEach(t => {
      const f = parseCustomFields(t.custom_fields);
      const statusRaw = ((t.status||{}).status||'').toLowerCase();
      const stage = PIPELINE_MAP[statusRaw] || statusRaw;
      const isClosed = CLOSED_STAGES.has(stage) || (t.status||{}).type === 'closed';
      allRows.push({
        name: t.name || '', provider: list.name,
        status: (t.status||{}).status || '', stage,
        study: f['Study'] || '', phone: f['Phone #'] || f['Phone'] || '',
        dob: f['Patient DOB'] || f['DOB'] || '',
        next_appointment: f['Next Appointment Date'] || '',
        crio_link: f['CRIO Link'] || '',
        interested: f['Interest shown by the Participant?'] === 'true' ? 'Yes' : '',
        pre_screening_required: f['Pre-screening required?'] || '',
        medical_record_uploaded: f['Patient Medical Record Uploaded?'] || '',
        is_active: !isClosed, url: t.url || '',
        date_created: t.date_created ? new Date(parseInt(t.date_created)).toISOString().split('T')[0] : '',
        date_updated: t.date_updated ? new Date(parseInt(t.date_updated)).toISOString().split('T')[0] : '',
        days_since_update: t.date_updated ? Math.floor((Date.now() - parseInt(t.date_updated)) / 86400000) : 999,
      });
    });
  }
  return allRows;
}

const CLICKUP_FEEDS = {
  referrals: fetchReferrals,
  campaigns: fetchCampaigns,
  medRecords: fetchMedRecords,
  monitoringVisits: fetchMonitoringVisits,
  docExpiries: fetchDocExpiries,
  irbExpirations: fetchIRBExpirations,
  studyMasterList: fetchStudyMasterList,
  startupChecklist: fetchStartupChecklist,
  providerTrackers: fetchProviderTrackers,
};

// ═══════════════════════════════════════════════════════════
// QUICKBOOKS API FEEDS — Employees, Time Activity, Payroll
// ═══════════════════════════════════════════════════════════

const QB = {
  clientId: process.env.QB_CLIENT_ID || '',
  clientSecret: process.env.QB_CLIENT_SECRET || '',
  refreshToken: process.env.QB_REFRESH_TOKEN || '',
  realmId: process.env.QB_REALM_ID || '',
};

let _qbToken = null;
let _qbTokenExpiry = 0;
let _qbRefreshToken = QB.refreshToken;
let _qbTokenLoaded = false;

// Persist QB refresh token to Secret Manager (survives cold starts)
const SECRET_NAME = `projects/${process.env.GCLOUD_PROJECT || 'crio-468120'}/secrets/qb-refresh-token/versions/latest`;
const SECRET_PARENT = `projects/${process.env.GCLOUD_PROJECT || 'crio-468120'}/secrets/qb-refresh-token`;

async function loadQBRefreshToken() {
  if (_qbTokenLoaded) return;
  _qbTokenLoaded = true;
  try {
    const { SecretManagerServiceClient } = require('@google-cloud/secret-manager');
    const client = new SecretManagerServiceClient();
    const [version] = await client.accessSecretVersion({ name: SECRET_NAME });
    const token = version.payload.data.toString('utf8').trim();
    if (token && token.startsWith('RT')) {
      _qbRefreshToken = token;
      console.log('QB: Loaded refresh token from Secret Manager');
    }
  } catch (e) {
    // Secret doesn't exist yet or no access — use env var
    console.log('QB: Secret Manager unavailable, using env var (' + e.message + ')');
  }
}

async function saveQBRefreshToken(token) {
  try {
    const { SecretManagerServiceClient } = require('@google-cloud/secret-manager');
    const client = new SecretManagerServiceClient();
    // Try to add a new version
    await client.addSecretVersion({
      parent: SECRET_PARENT,
      payload: { data: Buffer.from(token, 'utf8') },
    });
    console.log('QB: Saved rotated refresh token to Secret Manager');
  } catch (e) {
    // If secret doesn't exist, try to create it first
    try {
      const { SecretManagerServiceClient } = require('@google-cloud/secret-manager');
      const client = new SecretManagerServiceClient();
      await client.createSecret({ parent: `projects/${process.env.GCLOUD_PROJECT || 'crio-468120'}`, secretId: 'qb-refresh-token', secret: { replication: { automatic: {} } } });
      await client.addSecretVersion({ parent: SECRET_PARENT, payload: { data: Buffer.from(token, 'utf8') } });
      console.log('QB: Created secret and saved refresh token');
    } catch (e2) {
      console.warn('QB: Failed to persist token to Secret Manager:', e2.message);
    }
  }
}

async function getQBAccessToken() {
  if (_qbToken && Date.now() < _qbTokenExpiry - 60000) return _qbToken;
  await loadQBRefreshToken();
  const auth = Buffer.from(QB.clientId + ':' + QB.clientSecret).toString('base64');
  const params = new URLSearchParams({
    grant_type: 'refresh_token',
    refresh_token: _qbRefreshToken || QB.refreshToken,
  });
  return new Promise((resolve, reject) => {
    const req = https.request('https://oauth.platform.intuit.com/oauth2/v1/tokens/bearer', {
      method: 'POST',
      headers: { 'Authorization': 'Basic ' + auth, 'Content-Type': 'application/x-www-form-urlencoded' }
    }, res => {
      let d = ''; res.on('data', c => d += c);
      res.on('end', () => {
        try {
          const j = JSON.parse(d);
          if (j.error) { reject(new Error('QB token error: ' + j.error)); return; }
          _qbToken = j.access_token;
          _qbTokenExpiry = Date.now() + (j.expires_in || 3600) * 1000;
          if (j.refresh_token && j.refresh_token !== _qbRefreshToken) {
            _qbRefreshToken = j.refresh_token;
            saveQBRefreshToken(j.refresh_token).catch(() => {});
          }
          resolve(_qbToken);
        } catch (e) { reject(new Error('QB token parse failed: ' + d)); }
      });
    });
    req.on('error', reject);
    req.write(params.toString());
    req.end();
  });
}

async function qbQuery(sql) {
  const token = await getQBAccessToken();
  const encoded = encodeURIComponent(sql);
  const url = `/v3/company/${QB.realmId}/query?query=${encoded}`;
  return new Promise((resolve, reject) => {
    const req = https.request({
      hostname: 'quickbooks.api.intuit.com', path: url, method: 'GET',
      headers: { 'Authorization': 'Bearer ' + token, 'Accept': 'application/json' }
    }, res => {
      let d = ''; res.on('data', c => d += c);
      res.on('end', () => {
        try {
          const j = JSON.parse(d);
          if (j.Fault) { reject(new Error('QB query error: ' + JSON.stringify(j.Fault))); return; }
          resolve(j.QueryResponse || {});
        } catch (e) { reject(new Error('QB parse error: ' + d.substring(0, 200))); }
      });
    });
    req.on('error', reject);
    req.end();
  });
}

async function qbQueryAll(entity, where) {
  const rows = [];
  let startPos = 1;
  const pageSize = 1000;
  while (true) {
    const sql = `SELECT * FROM ${entity}${where ? ' WHERE ' + where : ''} STARTPOSITION ${startPos} MAXRESULTS ${pageSize}`;
    const resp = await qbQuery(sql);
    const items = resp[entity] || [];
    rows.push(...items);
    if (items.length < pageSize) break;
    startPos += pageSize;
  }
  return rows;
}

async function fetchQBEmployees() {
  const emps = await qbQueryAll('Employee');
  return emps.map(e => ({
    id: e.Id,
    name: e.DisplayName || ((e.GivenName || '') + ' ' + (e.FamilyName || '')).trim(),
    active: e.Active ? 'Yes' : 'No',
    cost_rate: e.CostRate || 0,
    bill_rate: e.BillRate || 0,
    hired_date: e.HiredDate || '',
    released_date: e.ReleasedDate || '',
    email: (e.PrimaryEmailAddr || {}).Address || '',
    phone: (e.PrimaryPhone || {}).FreeFormNumber || '',
  }));
}

async function fetchQBTimeActivity() {
  const params = arguments[0] || {};
  let where = '';
  if (params.start_date) where += `TxnDate >= '${params.start_date}'`;
  if (params.end_date) where += (where ? ' AND ' : '') + `TxnDate <= '${params.end_date}'`;

  const items = await qbQueryAll('TimeActivity', where || null);
  return items.map(t => ({
    date: t.TxnDate || '',
    employee: (t.EmployeeRef || t.VendorRef || {}).name || '',
    employee_id: (t.EmployeeRef || t.VendorRef || {}).value || '',
    customer: (t.CustomerRef || {}).name || '',
    customer_id: (t.CustomerRef || {}).value || '',
    hours: t.Hours || 0,
    minutes: t.Minutes || 0,
    description: t.Description || '',
    billable: t.BillableStatus === 'Billable' ? 'Yes' : 'No',
    hourly_rate: t.HourlyRate || 0,
    cost_rate: t.CostRate || 0,
  }));
}

async function fetchQBCustomers() {
  const custs = await qbQueryAll('Customer', "Active = true");
  return custs.map(c => ({
    id: c.Id,
    name: c.DisplayName || c.CompanyName || '',
    balance: c.Balance || 0,
    active: c.Active ? 'Yes' : 'No',
    parent: (c.ParentRef || {}).name || '',
  }));
}

async function qbReport(reportName, params) {
  const token = await getQBAccessToken();
  const qs = Object.entries(params || {}).map(([k,v]) => `${k}=${encodeURIComponent(v)}`).join('&');
  const url = `/v3/company/${QB.realmId}/reports/${reportName}?${qs}&minorversion=75`;
  return new Promise((resolve, reject) => {
    const req = https.request({
      hostname: 'quickbooks.api.intuit.com', path: url, method: 'GET',
      headers: { 'Authorization': 'Bearer ' + token, 'Accept': 'application/json' }
    }, res => {
      let d = ''; res.on('data', c => d += c);
      res.on('end', () => {
        try { resolve(JSON.parse(d)); }
        catch (e) { reject(new Error('QB report parse error')); }
      });
    });
    req.on('error', reject);
    req.end();
  });
}

function parsePnLRows(rows, depth) {
  const results = [];
  if (!rows) return results;
  for (const row of rows) {
    const header = row.Header || {};
    const colData = header.ColData || row.ColData || [];
    const name = colData[0] ? colData[0].value || '' : '';
    const amount = colData[1] ? parseFloat(colData[1].value) || 0 : 0;
    if (name) results.push({ name, amount, depth: depth || 0 });
    const subRows = (row.Rows || {}).Row || [];
    if (subRows.length) results.push(...parsePnLRows(subRows, (depth || 0) + 1));
  }
  return results;
}

async function fetchQBContractorCosts() {
  const params = arguments[0] || {};
  const startDate = params.start_date || new Date(Date.now() - 365*86400000).toISOString().split('T')[0];
  const endDate = params.end_date || new Date().toISOString().split('T')[0];

  // Get P&L with employee breakdown for individual payroll
  const [report, empReport] = await Promise.all([
    qbReport('ProfitAndLoss', { start_date: startDate, end_date: endDate }),
    qbReport('ProfitAndLoss', { start_date: startDate, end_date: endDate, summarize_column_by: 'Employees' }),
  ]);

  const allItems = parsePnLRows((report.Rows || {}).Row || [], 0);

  // Find contractor items
  let inContractor = false;
  const contractors = [];
  for (const item of allItems) {
    if (item.name.toLowerCase().includes('contractor and professional')) { inContractor = true; continue; }
    if (inContractor && item.depth <= 2 && !item.name.toLowerCase().includes('contractor')) { inContractor = false; }
    if (inContractor && item.amount > 0 && item.depth >= 3) {
      contractors.push({ name: item.name, cost: item.amount, type: 'contractor' });
    }
  }

  // Parse employee payroll from the by-employee P&L
  const payrollByEmployee = [];
  const empCols = (empReport.Columns || {}).Column || [];
  const empColNames = empCols.map(c => c.ColTitle || '');

  function parseEmpRows(rows) {
    for (const row of (rows || [])) {
      const colData = (row.Header || {}).ColData || row.ColData || [];
      const rowName = colData[0] ? colData[0].value || '' : '';
      if (rowName.toLowerCase() === 'wages' && colData.length > 1) {
        for (let i = 1; i < colData.length && i < empColNames.length; i++) {
          const empName = empColNames[i];
          const amount = parseFloat(colData[i].value) || 0;
          if (empName && amount > 0 && empName !== 'Total' && empName !== 'TOTAL'
              && empName !== 'Not Specified' && empName !== '') {
            payrollByEmployee.push({ name: empName, cost: amount, type: 'payroll' });
          }
        }
      }
      const sub = (row.Rows || {}).Row || [];
      if (sub.length) parseEmpRows(sub);
    }
  }
  parseEmpRows((empReport.Rows || {}).Row || []);

  return { contractors, payrollByEmployee, period: `${startDate} to ${endDate}` };
}

async function fetchQBStaffCosts() {
  const params = arguments[0] || {};
  const startDate = params.start_date || new Date(Date.now() - 90*86400000).toISOString().split('T')[0];
  const endDate = params.end_date || new Date().toISOString().split('T')[0];

  // Get employee time activity costs + contractor P&L costs in parallel
  const [employees, timeActivity, pnlData] = await Promise.all([
    fetchQBEmployees(),
    fetchQBTimeActivity(params),
    fetchQBContractorCosts(params),
  ]);

  const costRates = {};
  employees.forEach(e => { if (e.cost_rate > 0) costRates[e.name] = e.cost_rate; });

  // Build employee costs from time activity
  const staffCosts = {};
  timeActivity.forEach(t => {
    const emp = t.employee || '';
    const hrs = (parseFloat(t.hours) || 0) + (parseFloat(t.minutes) || 0) / 60;
    if (!emp || hrs <= 0) return;
    const rate = costRates[emp] || 0;
    if (!staffCosts[emp]) staffCosts[emp] = { name: emp, cost: 0, hours: hrs, rate, type: 'employee' };
    else { staffCosts[emp].cost += hrs * rate; staffCosts[emp].hours += hrs; }
    staffCosts[emp].cost = staffCosts[emp].hours * rate;
  });

  // Add contractor costs from P&L
  pnlData.contractors.forEach(c => {
    if (!staffCosts[c.name]) staffCosts[c.name] = { name: c.name, cost: c.cost, hours: 0, rate: 0, type: 'contractor' };
    else staffCosts[c.name].cost += c.cost;
  });

  // Add payroll costs for employees who don't track time (from P&L by Employee)
  (pnlData.payrollByEmployee || []).forEach(p => {
    if (!staffCosts[p.name]) {
      // Employee doesn't track time — use payroll as their cost
      staffCosts[p.name] = { name: p.name, cost: p.cost, hours: 0, rate: 0, type: 'payroll' };
    }
    // If they already have time-based cost, don't double-count — payroll IS the wages from time
    // But for employees with $0 time cost (no time entries), use payroll
    else if (staffCosts[p.name].cost === 0) {
      staffCosts[p.name].cost = p.cost;
      staffCosts[p.name].type = 'payroll';
    }
  });

  return Object.values(staffCosts);
}

// ── P&L Monthly (live from QB API) ──
async function fetchQBPnlMonthly() {
  const params = arguments[0] || {};
  const startDate = params.start_date || new Date(Date.now() - 365*86400000).toISOString().split('T')[0];
  const endDate = params.end_date || new Date().toISOString().split('T')[0];
  const report = await qbReport('ProfitAndLoss', {
    start_date: startDate, end_date: endDate,
    summarize_column_by: 'Month'
  });
  const cols = (report.Columns || {}).Column || [];
  const months = cols.slice(1).map(c => c.ColTitle || '').filter(m => m && m !== 'Total' && m !== 'TOTAL');

  const incomeRows = [];
  const expenseRows = [];
  let inIncome = false, inExpense = false;

  function walk(rRows) {
    for (const row of (rRows || [])) {
      const colData = (row.Header || {}).ColData || row.ColData || [];
      const name = colData[0] ? colData[0].value || '' : '';
      const lo = name.toLowerCase();

      // Track section boundaries
      if (row.group === 'Income' || lo === 'income' || (lo.includes('income') && !lo.includes('net') && !lo.includes('other') && !lo.includes('total'))) {
        inIncome = true; inExpense = false;
      }
      if (lo === 'gross profit' || lo === 'total income') { inIncome = false; }
      if (row.group === 'Expenses' || lo === 'expenses' || lo === 'cost of goods sold') {
        inExpense = true; inIncome = false;
      }
      if (lo === 'net income' || lo === 'net operating income') { inExpense = false; }

      if (name && colData.length > 1 && !lo.startsWith('total ') && !lo.startsWith('net ')) {
        const entry = { account: name };
        let total = 0;
        for (let i = 0; i < months.length && i + 1 < colData.length; i++) {
          const val = parseFloat(colData[i + 1].value) || 0;
          entry[months[i]] = val;
          total += val;
        }
        entry.total = total;
        if (total !== 0) {
          entry.section = inIncome ? 'income' : inExpense ? 'expense' : 'other';
          if (inIncome) incomeRows.push(entry);
          else if (inExpense) expenseRows.push(entry);
        }
      }
      const sub = (row.Rows || {}).Row || [];
      if (sub.length) walk(sub);
    }
  }
  walk((report.Rows || {}).Row || []);
  return { months, rows: incomeRows, expenseRows, period: `${startDate} to ${endDate}` };
}

// ── P&L by Class/Study (live from QB API) ──
async function fetchQBPnlByClass() {
  const params = arguments[0] || {};
  const startDate = params.start_date || new Date(Date.now() - 365*86400000).toISOString().split('T')[0];
  const endDate = params.end_date || new Date().toISOString().split('T')[0];
  const report = await qbReport('ProfitAndLoss', {
    start_date: startDate, end_date: endDate,
    summarize_column_by: 'Classes'
  });
  const cols = (report.Columns || {}).Column || [];
  const classes = cols.slice(1).map(c => c.ColTitle || '').filter(c => c && c !== 'Total' && c !== 'TOTAL' && c !== 'Not Specified');

  // Extract income rows per class
  const byClass = {};
  classes.forEach(c => { byClass[c] = { study: c, income: 0, expense: 0 }; });

  let inIncome = false, inExpense = false;
  function walk(rRows) {
    for (const row of (rRows || [])) {
      const colData = (row.Header || {}).ColData || row.ColData || [];
      const name = colData[0] ? colData[0].value || '' : '';
      const lo = name.toLowerCase();
      if (lo.includes('income') && !lo.includes('net') && !lo.includes('other')) { inIncome = true; inExpense = false; }
      if (lo.includes('expense') || lo.includes('cost of goods')) { inExpense = true; inIncome = false; }
      if (lo.includes('net income') || lo.includes('net operating')) { inIncome = false; inExpense = false; }

      if ((inIncome || inExpense) && colData.length > 1) {
        for (let i = 0; i < classes.length && i + 1 < colData.length; i++) {
          const val = parseFloat(colData[i + 1].value) || 0;
          if (val !== 0 && byClass[classes[i]]) {
            if (inIncome) byClass[classes[i]].income += val;
            if (inExpense) byClass[classes[i]].expense += val;
          }
        }
      }
      const sub = (row.Rows || {}).Row || [];
      if (sub.length) walk(sub);
    }
  }
  walk((report.Rows || {}).Row || []);

  return Object.values(byClass).filter(r => r.income > 0 || r.expense > 0)
    .sort((a, b) => b.income - a.income);
}

// ── QB Invoices (live from QB API) ──
async function fetchQBInvoices() {
  const params = arguments[0] || {};
  const startDate = params.start_date || new Date(Date.now() - 365*86400000).toISOString().split('T')[0];
  const all = await qbQueryAll('Invoice', `TxnDate >= '${startDate}'`);
  return all.map(inv => {
    const lines = (inv.Line || []).filter(l => l.DetailType === 'SalesItemLineDetail').map(l => ({
      item: (l.SalesItemLineDetail || {}).ItemRef ? l.SalesItemLineDetail.ItemRef.name : '',
      description: l.Description || '',
      qty: (l.SalesItemLineDetail || {}).Qty || 0,
      rate: (l.SalesItemLineDetail || {}).UnitPrice || 0,
      amount: l.Amount || 0,
      class: ((l.SalesItemLineDetail || {}).ClassRef || {}).name || '',
    }));
    return {
      id: inv.Id, doc_number: inv.DocNumber || '',
      date: inv.TxnDate || '', due_date: inv.DueDate || '',
      customer: (inv.CustomerRef || {}).name || '',
      total: inv.TotalAmt || 0, balance: inv.Balance || 0,
      status: inv.Balance === 0 ? 'Paid' : inv.Balance < inv.TotalAmt ? 'Partial' : 'Unpaid',
      email_status: inv.EmailStatus || '',
      lines, line_count: lines.length,
    };
  }).sort((a, b) => b.date.localeCompare(a.date));
}

// ── QB Payments (live from QB API) ──
async function fetchQBPayments() {
  const params = arguments[0] || {};
  const startDate = params.start_date || new Date(Date.now() - 365*86400000).toISOString().split('T')[0];
  const all = await qbQueryAll('Payment', `TxnDate >= '${startDate}'`);
  return all.map(p => ({
    id: p.Id, date: p.TxnDate || '',
    customer: (p.CustomerRef || {}).name || '',
    amount: p.TotalAmt || 0,
    method: (p.PaymentMethodRef || {}).name || '',
    memo: p.PrivateNote || '',
    deposit_to: (p.DepositToAccountRef || {}).name || '',
  })).sort((a, b) => b.date.localeCompare(a.date));
}

const QB_FEEDS = {
  qbEmployees: fetchQBEmployees,
  qbTimeActivity: fetchQBTimeActivity,
  qbCustomers: fetchQBCustomers,
  qbStaffCosts: fetchQBStaffCosts,
  qbPnlMonthly: fetchQBPnlMonthly,
  qbPnlByClass: fetchQBPnlByClass,
  qbInvoices: fetchQBInvoices,
  qbPayments: fetchQBPayments,
};

// ═══════════════════════════════════════════════════════════
// HTTP HANDLER
// ═══════════════════════════════════════════════════════════

functions.http('crpBqApi', async (req, res) => {
  // CORS
  res.set('Access-Control-Allow-Origin', '*');
  res.set('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.set('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') { res.status(204).send(''); return; }

  // ── GET: CRIO Interaction POST test — try all known paths to create an interaction ──
  if (req.query.action === 'crio-interaction-test') {
    res.set('Cache-Control', 'no-store');
    try {
      if (!CRIO_TOKEN) { res.status(500).json({ error: 'CRIO_TOKEN not configured' }); return; }
      const siteId = req.query.site || CRIO_SITE_IDS.PHL;
      // Get a test patient + study/subject from BQ
      const subs = await runQuery(`SELECT CAST(s.patient_key AS STRING) AS patient_key,
        CAST(s.study_key AS STRING) AS study_key, CAST(s.subject_key AS STRING) AS subject_key,
        CONCAT(p.first_name, ' ', p.last_name) AS name
        FROM ${tbl('subject')} s
        JOIN ${tbl('patient')} p ON s.patient_key = p.patient_key
        WHERE s.site_key = ${siteId} AND s.status IN (4,10,11) AND s._fivetran_deleted = false
        ORDER BY s.last_updated DESC LIMIT 1`);
      if (!subs.length) { res.json({ error: 'No active subjects found' }); return; }
      const { patient_key: pk, study_key: sk, subject_key: subk, name } = subs[0];
      const results = { patient: name, patient_key: pk, study_key: sk, subject_key: subk, site: siteId, attempts: {} };

      // Body variants to try
      const ts = new Date().toISOString();
      const bodies = {
        // Format A: CRIO recruitment-style (action_type integers from BQ)
        bqStyle: { actionType: 200, actionDetails: 'CRP Dashboard interaction test ' + ts, actionDate: ts },
        // Format B: human-readable
        readable: { type: 'TEXT', direction: 'OUTBOUND', notes: 'CRP test ' + ts },
        // Format C: with patient/study context
        withContext: { actionType: 200, patientKey: parseInt(pk), studyKey: parseInt(sk),
                       actionDetails: 'CRP test ' + ts, actionDate: ts },
        // Format D: snake_case
        snakeCase: { action_type: 200, action_details: 'CRP test ' + ts, action_date: ts,
                     patient_key: parseInt(pk), study_key: parseInt(sk) },
      };

      // Paths to try POST
      const paths = [
        `/api/v1/patient/${pk}/site/${siteId}/interaction`,
        `/api/v1/patient/${pk}/interaction`,
        `/api/v1/study/${sk}/site/${siteId}/subject/${subk}/interaction`,
        `/api/v1/site/${siteId}/patient/${pk}/interaction`,
        `/api/v1/recruitment/patient/${pk}/interaction`,
        `/api/v1/recruitment/patient/${pk}/site/${siteId}/interaction`,
        `/api/v1/patient/${pk}/site/${siteId}/interactions`,
        `/api/v1/study/${sk}/site/${siteId}/subject/${subk}/interactions`,
      ];

      for (const path of paths) {
        const pathResults = {};
        for (const [bodyName, body] of Object.entries(bodies)) {
          try {
            const r = await crioPost(path, body);
            pathResults[bodyName] = { status: r.status, body: r.body.substring(0, 300) };
            // If we got a 2xx, we found the right combo!
            if (r.status >= 200 && r.status < 300) {
              results.success = { path, bodyFormat: bodyName, status: r.status, response: r.body.substring(0, 500) };
            }
          } catch (e) { pathResults[bodyName] = { error: e.message }; }
        }
        results.attempts[path] = pathResults;
        // Stop if we found a working path
        if (results.success) break;
      }

      // Also try GET on these paths to see if any return existing interactions
      results.getProbe = {};
      for (const path of paths.slice(0, 4)) {
        try {
          const r = await crioFetch(path);
          results.getProbe[path] = { status: r.status, body: r.body.substring(0, 300) };
        } catch (e) { results.getProbe[path] = { error: e.message }; }
      }

      res.json(results);
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
    return;
  }

  // ── GET: CRIO Patient PUT test — read a patient, append a test note, PUT back ──
  if (req.query.action === 'crio-put-test') {
    res.set('Cache-Control', 'no-store');
    try {
      if (!CRIO_TOKEN) { res.status(500).json({ error: 'CRIO_TOKEN not configured' }); return; }
      const siteId = req.query.site || CRIO_SITE_IDS.PHL;
      // Get a test patient from BQ
      const patients = await runQuery(`SELECT CAST(patient_key AS STRING) AS patient_key,
        CONCAT(first_name, ' ', last_name) AS name
        FROM ${tbl('patient')} WHERE site_key = ${siteId} AND _fivetran_deleted = false
        ORDER BY last_updated DESC LIMIT 1`);
      if (!patients.length) { res.json({ error: 'No patients found' }); return; }
      const pk = patients[0].patient_key;
      const results = { patient: patients[0].name, patient_key: pk, site: siteId };

      // GET current patient
      const getR = await crioFetch(`/api/v1/patient/${pk}/site/${siteId}`);
      results.get = { status: getR.status };
      if (getR.status !== 200) { results.get.body = getR.body.substring(0, 500); res.json(results); return; }
      const patient = JSON.parse(getR.body);
      const pi = patient.patientInfo;
      results.get.revision = patient.revision;
      results.get.hasNotes = !!pi.notes;
      results.get.notesPreview = (pi.notes || '').substring(0, 200);

      // PUT with updated notes (append test line)
      const ts = new Date().toISOString().replace('T', ' ').substring(0, 19);
      const testNote = `[CRP PUT Test ${ts}]`;
      const updatedNotes = pi.notes ? pi.notes + '\n' + testNote : testNote;
      // Spread full patientInfo but strip calculated/read-only fields
      const cleanPi = { ...pi, notes: updatedNotes };
      (cleanPi.customFields || []).forEach((f, i) => { if (f && f.questionType === 'CALCULATION') cleanPi.customFields[i] = undefined; });
      if (cleanPi.customFields) cleanPi.customFields = cleanPi.customFields.filter(Boolean);
      delete cleanPi.dateCreated; delete cleanPi.dateCreatedTS;
      delete cleanPi.lastUpdated; delete cleanPi.lastUpdatedTS;
      const putR = await crioPut(`/api/v1/patient/${pk}`, {
        siteId: siteId,
        revision: patient.revision,
        patientInfo: cleanPi
      });
      results.put = { status: putR.status, body: putR.body.substring(0, 500) };
      results.success = putR.status === 200;

      // Verify by re-reading
      if (putR.status === 200) {
        const verifyR = await crioFetch(`/api/v1/patient/${pk}/site/${siteId}`);
        if (verifyR.status === 200) {
          const v = JSON.parse(verifyR.body);
          results.verify = { notesContainTest: (v.patientInfo.notes || '').indexOf(testNote) !== -1, newRevision: v.revision };
        }
      }
      res.json(results);
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
    return;
  }

  // ── POST/GET: Send Reminders — dry-run preview or live send ──
  if (req.query.action === 'send-reminders') {
    res.set('Cache-Control', 'no-store');
    try {
      const body = req.method === 'POST' ? (typeof req.body === 'string' ? JSON.parse(req.body) : (req.body || {})) : {};
      const dryRun = req.query.dry !== 'false';  // default to dry run for safety
      const testPhone = body.testPhone || req.query.testPhone || null;
      const types = body.types || (req.query.types ? req.query.types.split(',') : ['48h', '24h', 'day_of', 'post_visit']);
      const result = await runReminderEngine({ dryRun, testPhone, types });
      res.json({ success: true, ...result });
    } catch (err) {
      console.error('send-reminders error:', err.message);
      res.status(500).json({ success: false, error: err.message });
    }
    return;
  }

  // ── POST: Send single test SMS ──
  if (req.query.action === 'test-sms' && req.method === 'POST') {
    res.set('Cache-Control', 'no-store');
    try {
      const body = typeof req.body === 'string' ? JSON.parse(req.body) : (req.body || {});
      if (!body.to || !body.message) { res.status(400).json({ error: 'Provide to and message in body' }); return; }
      const result = await twilioSend(body.to, body.message);
      res.json({ success: result.status === 201 || result.status === 'queued', ...result });
    } catch (err) {
      console.error('test-sms error:', err.message);
      res.status(500).json({ success: false, error: err.message });
    }
    return;
  }

  // ── POST: Follow-Up → ClickUp sync + CRIO notes ──
  if (req.method === 'POST' && req.query.action === 'followup-sync') {
    res.set('Cache-Control', 'no-store');
    try {
      const body = typeof req.body === 'string' ? JSON.parse(req.body) : (req.body || {});
      // Run ClickUp sync and CRIO notes log in parallel
      const [clickupResult, crioResult] = await Promise.all([
        syncFollowUpToClickUp(body).catch(e => ({ error: e.message })),
        CRIO_TOKEN ? logFollowUpToNotes(body).catch(e => ({ logged: false, error: e.message })) : Promise.resolve({ logged: false, reason: 'CRIO_TOKEN not set' })
      ]);
      res.json({ success: true, clickup: clickupResult, crio: crioResult });
    } catch (err) {
      console.error('followup-sync error:', err.message);
      res.status(500).json({ success: false, error: err.message });
    }
    return;
  }

  // Cache-Control: allow CDN/browser caching for 5 minutes
  res.set('Cache-Control', 'public, max-age=300');

  const feed = req.query.feed;
  const format = req.query.format || 'csv';

  // ── Batch endpoint: ?feed=batch&feeds=visits,cancels,studies ──
  if (feed === 'batch') {
    const feedNames = (req.query.feeds || '').split(',').filter(Boolean);
    if (!feedNames.length) { res.status(400).json({ error: 'Provide feeds=name1,name2,...' }); return; }
    const results = {};
    await Promise.all(feedNames.map(async (name) => {
      const def = FEEDS[name];
      if (!def) { results[name] = { error: 'unknown feed' }; return; }
      try {
        const sql = typeof def.query === 'function' ? def.query(req.query) : def.query;
        const rows = await runQuery(sql);
        results[name] = { rows: rows.length, data: rows };
      } catch (err) { results[name] = { error: err.message }; }
    }));
    res.json({ batch: true, feeds: feedNames.length, results, timestamp: new Date().toISOString() });
    return;
  }

  // List available feeds
  if (!feed) {
    res.json({
      feeds: [...Object.keys(FEEDS), ...Object.keys(CLICKUP_FEEDS), ...Object.keys(QB_FEEDS)],
      usage: '?feed=visits&format=csv',
      formats: ['csv', 'json'],
      note: 'BQ feeds + ClickUp feeds (referrals, campaigns, medRecords)'
    });
    return;
  }

  // ── ClickUp feeds (direct API, no BQ) ──
  const clickupHandler = CLICKUP_FEEDS[feed];
  if (clickupHandler) {
    try {
      console.log(`Feed ${feed}: fetching from ClickUp API`);
      const rows = await clickupHandler();
      console.log(`Feed ${feed}: ${rows.length} rows from ClickUp`);
      if (format === 'json') {
        res.json({ feed, rows: rows.length, data: rows, source: 'clickup', timestamp: new Date().toISOString() });
      } else {
        if (rows.length === 0) { res.type('text/csv').send(''); return; }
        const fields = Object.keys(rows[0]);
        const csvLines = [fields.join(',')];
        for (const row of rows) {
          csvLines.push(fields.map(f => {
            const val = (row[f] == null ? '' : String(row[f])).replace(/"/g, '""');
            return val.includes(',') || val.includes('"') || val.includes('\n') ? `"${val}"` : val;
          }).join(','));
        }
        res.type('text/csv').send(csvLines.join('\n'));
      }
    } catch (err) {
      console.error(`ClickUp feed ${feed} failed:`, err.message);
      res.status(500).json({ error: err.message, feed, source: 'clickup' });
    }
    return;
  }

  // ── QB feeds ──
  const qbHandler = QB_FEEDS[feed];
  if (qbHandler) {
    try {
      if (!QB.clientId || !QB.refreshToken) { res.status(500).json({ error: 'QB credentials not configured' }); return; }
      console.log(`Feed ${feed}: fetching from QuickBooks API`);
      const rows = await qbHandler(req.query);
      console.log(`Feed ${feed}: ${rows.length} rows from QuickBooks`);
      if (format === 'json') {
        res.json({ feed, rows: rows.length, data: rows, source: 'quickbooks', timestamp: new Date().toISOString() });
      } else {
        if (rows.length === 0) { res.type('text/csv').send(''); return; }
        const fields = Object.keys(rows[0]);
        const csvLines = [fields.join(',')];
        for (const row of rows) {
          csvLines.push(fields.map(f => {
            const val = (row[f] == null ? '' : String(row[f])).replace(/"/g, '""');
            return val.includes(',') || val.includes('"') || val.includes('\n') ? `"${val}"` : val;
          }).join(','));
        }
        res.type('text/csv').send(csvLines.join('\n'));
      }
    } catch (err) {
      console.error(`QB feed ${feed} failed:`, err.message);
      res.status(500).json({ error: err.message, feed, source: 'quickbooks' });
    }
    return;
  }

  // ── BQ feeds ──
  const feedDef = FEEDS[feed];
  if (!feedDef) {
    res.status(404).json({ error: `Unknown feed: ${feed}`, available: [...Object.keys(FEEDS), ...Object.keys(CLICKUP_FEEDS), ...Object.keys(QB_FEEDS)] });
    return;
  }

  try {
    const sql = typeof feedDef.query === 'function' ? feedDef.query(req.query) : feedDef.query;
    // Debug: test with minimal query first if main returns 0
    console.log(`Feed ${feed}: running query (${sql.length} chars), auth: ${OAUTH.refreshToken ? 'user-token' : 'service-account'}`);
    const rows = await runQuery(sql);
    console.log(`Feed ${feed}: ${rows.length} rows returned`);

    if (format === 'json') {
      res.json({ feed, rows: rows.length, data: rows, timestamp: new Date().toISOString() });
    } else {
      // CSV output — apply header mapping if defined
      if (rows.length === 0) { res.type('text/csv').send(''); return; }
      const headerMap = feedDef.headers || {};
      const fields = Object.keys(rows[0]);
      const headers = fields.map(f => headerMap[f] || f);

      const csvLines = [headers.join(',')];
      for (const row of rows) {
        csvLines.push(fields.map(f => {
          const val = (row[f] == null ? '' : String(row[f])).replace(/"/g, '""');
          return val.includes(',') || val.includes('"') || val.includes('\n') ? `"${val}"` : val;
        }).join(','));
      }
      res.type('text/csv').send(csvLines.join('\n'));
    }
  } catch (err) {
    console.error(`Feed ${feed} failed:`, err.message);
    res.status(500).json({ error: err.message, feed });
  }
});

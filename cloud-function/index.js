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

async function runQuery(sql) {
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
    return allRows;
  }
  // Fallback: use default SA
  const bq = new BigQuery({ projectId: PROJECT });
  const [rows] = await bq.query({ query: sql, location: 'US' });
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
    query: () => `SELECT
      ${STUDY_NAME_SQL} AS study_name,
      CAST(ca.study_key AS STRING) AS study_key,
      FORMAT_DATETIME('%Y-%m-%d', ca.start) AS scheduled_date,
      ${SUBJECT_NAME_SQL} AS subject_full_name,
      CAST(ca.subject_key AS STRING) AS subject_key_back_end,
      COALESCE(
        NULLIF(TRIM(CONCAT(COALESCE(svs_coord.first_name, ''), ' ', COALESCE(svs_coord.last_name, ''))), ''),
        TRIM(CONCAT(COALESCE(coord.first_name, ''), ' ', COALESCE(coord.last_name, '')))
      ) AS full_name,
      CASE ca.status WHEN 0 THEN 'Cancelled' ELSE 'Active' END AS appointment_status,
      COALESCE(sv.name, '') AS visit_name,
      ${SUBJECT_STATUS_SQL} AS subject_status,
      COALESCE(sub.patient_id, '') AS subject_id,
      CASE WHEN ca.status = 0 THEN FORMAT_DATETIME('%Y-%m-%d', ca.cancel_date) ELSE '' END AS cancel_date,
      CASE WHEN ca.status = 0 THEN COALESCE(REGEXP_REPLACE(ca.cancel_reason, r'[\\x00-\\x1f]', ' '), '') ELSE '' END AS cancel_reason,
      CASE WHEN ca.status = 0 THEN CASE ca.cancel_type WHEN 1 THEN 'No Show' WHEN 2 THEN 'Site Cancelled' WHEN 3 THEN 'Patient Cancelled' ELSE '' END ELSE '' END AS appointment_cancellation_type,
      COALESCE(
        NULLIF(TRIM(CONCAT(COALESCE(svs_coord.first_name, ''), ' ', COALESCE(svs_coord.last_name, ''))), ''),
        TRIM(CONCAT(COALESCE(coord.first_name, ''), ' ', COALESCE(coord.last_name, '')))
      ) AS staff_full_name,
      COALESCE(si.name, '') AS site_name,
      COALESCE(sub.mobile_phone, '') AS mobile_phone,
      CAST(ca.calendar_appointment_key AS STRING) AS calendar_appointment_key,
      CASE ca.type WHEN 0 THEN 'Regular Visit' WHEN 1 THEN 'Ad Hoc Visit' WHEN 2 THEN 'General Appointment' WHEN 3 THEN 'Block' ELSE '' END AS appointment_type,
      COALESCE(
        NULLIF(TRIM(CONCAT(COALESCE(svs_inv.first_name, ''), ' ', COALESCE(svs_inv.last_name, ''))), ''),
        pi.name, ''
      ) AS investigator,
      FORMAT_DATETIME('%Y-%m-%d', CURRENT_DATETIME()) AS snapshot_date
    FROM ${tbl('calendar_appointment')} ca
    LEFT JOIN ${tbl('subject')} sub ON ca.subject_key = sub.subject_key
    LEFT JOIN ${tbl('study')} st ON ca.study_key = st.study_key
    LEFT JOIN ${tbl('sponsor')} spon ON st.sponsor_key = spon.sponsor_key
    LEFT JOIN ${tbl('site')} si ON ca.site_key = si.site_key
    LEFT JOIN ${tbl('study_visit')} sv ON ca.study_visit_key = sv.study_visit_key
    LEFT JOIN ${tbl('user')} coord ON ca.creator_key = coord.user_key
    LEFT JOIN ${tbl('subject_visit_stats')} svs ON ca.subject_visit_key = svs.subject_visit_key
    LEFT JOIN ${tbl('user')} svs_coord ON svs.coordinator_user_key = svs_coord.user_key
    LEFT JOIN ${tbl('user')} svs_inv ON svs.investigator_user_key = svs_inv.user_key
    LEFT JOIN (SELECT su.study_key, CONCAT(u.first_name, ' ', u.last_name) AS name
      FROM ${tbl('study_user')} su JOIN ${tbl('user')} u ON su.user_key = u.user_key
      WHERE su.role = 1 AND su.is_role_leader = 1 AND su._fivetran_deleted = false) pi ON ca.study_key = pi.study_key
    WHERE ca.subject_key IS NOT NULL AND st.is_active = 1
      AND ca.start >= DATETIME_SUB(CURRENT_DATETIME(), INTERVAL 7 DAY)
      AND ca.start <= DATETIME_ADD(CURRENT_DATETIME(), INTERVAL 365 DAY)
      AND LOWER(COALESCE(st.nickname, st.protocol_number, '')) NOT LIKE '%test%'
      AND LOWER(COALESCE(st.nickname, st.protocol_number, '')) NOT LIKE '%demo%'
      AND LOWER(COALESCE(st.nickname, st.protocol_number, '')) NOT LIKE '%sandbox%'
    ORDER BY ca.start ASC`,
    headers: {
      study_name: 'Study Name', study_key: 'Study Key', scheduled_date: 'Scheduled Date',
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
    query: () => `SELECT
      ${SUBJECT_NAME_SQL} AS subject_full_name,
      ${STUDY_NAME_SQL} AS study_name,
      CAST(aal.study_key AS STRING) AS study_key,
      COALESCE(si.name, '') AS site_name,
      FORMAT_DATETIME('%Y-%m-%d', aal.date_created) AS cancel_date,
      FORMAT_DATETIME('%Y-%m-%d', COALESCE(aal.old_start, aal.date_created)) AS scheduled_date,
      CAST(aal.subject_key AS STRING) AS subject_key_back_end,
      COALESCE(
        NULLIF(TRIM(CONCAT(COALESCE(svs_coord.first_name, ''), ' ', COALESCE(svs_coord.last_name, ''))), ''),
        NULLIF(TRIM(CONCAT(COALESCE(coord.first_name, ''), ' ', COALESCE(coord.last_name, ''))), ''),
        TRIM(CONCAT(COALESCE(by_user.first_name, ''), ' ', COALESCE(by_user.last_name, '')))
      ) AS staff_full_name,
      COALESCE(aal.cancel_reason, '') AS cancel_reason,
      CASE aal.cancel_type WHEN 1 THEN 'No Show' WHEN 2 THEN 'Site Cancelled' WHEN 3 THEN 'Patient Cancelled' ELSE '' END AS appointment_cancellation_type,
      ${SUBJECT_STATUS_SQL} AS subject_status,
      COALESCE(sv.name, '') AS visit_name,
      CASE aal.appointment_type WHEN 0 THEN 'Regular Visit' WHEN 1 THEN 'Ad Hoc Visit' WHEN 2 THEN 'General Appointment' WHEN 3 THEN 'Block' ELSE '' END AS appointment_type,
      'cancelled' AS appointment_status,
      CAST(aal.calendar_appointment_key AS STRING) AS calendar_appointment_key,
      COALESCE(
        NULLIF(TRIM(CONCAT(COALESCE(svs_inv.first_name, ''), ' ', COALESCE(svs_inv.last_name, ''))), ''),
        pi.name, ''
      ) AS investigator,
      FORMAT_DATETIME('%Y-%m-%d', CURRENT_DATETIME()) AS snapshot_date
    FROM ${tbl('appointment_audit_log')} aal
    LEFT JOIN ${tbl('study')} st ON aal.study_key = st.study_key
    LEFT JOIN (SELECT su.study_key, CONCAT(u.first_name, ' ', u.last_name) AS name
      FROM ${tbl('study_user')} su JOIN ${tbl('user')} u ON su.user_key = u.user_key
      WHERE su.role = 1 AND su.is_role_leader = 1 AND su._fivetran_deleted = false) pi ON aal.study_key = pi.study_key
    LEFT JOIN ${tbl('sponsor')} spon ON st.sponsor_key = spon.sponsor_key
    LEFT JOIN ${tbl('site')} si ON aal.site_key = si.site_key
    LEFT JOIN ${tbl('subject')} sub ON aal.subject_key = sub.subject_key
    LEFT JOIN ${tbl('study_visit')} sv ON aal.study_visit_key = sv.study_visit_key
    LEFT JOIN ${tbl('calendar_appointment')} ca ON aal.calendar_appointment_key = ca.calendar_appointment_key
    LEFT JOIN ${tbl('user')} coord ON ca.creator_key = coord.user_key
    LEFT JOIN ${tbl('user')} by_user ON aal.by_user_key = by_user.user_key
    LEFT JOIN ${tbl('subject_visit_stats')} svs ON ca.subject_visit_key = svs.subject_visit_key
    LEFT JOIN ${tbl('user')} svs_coord ON svs.coordinator_user_key = svs_coord.user_key
    LEFT JOIN ${tbl('user')} svs_inv ON svs.investigator_user_key = svs_inv.user_key
    WHERE aal.change_type = 4
      AND aal.date_created >= DATETIME_SUB(CURRENT_DATETIME(), INTERVAL 90 DAY)
      AND st.is_active = 1
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
      svs_coords AS (SELECT svi.study_key, svs.coordinator_user_key, COUNT(*) AS visit_count
        FROM ${tbl('subject_visit_stats')} svs
        JOIN ${tbl('subject_visit')} svi ON svs.subject_visit_key = svi.subject_visit_key
        WHERE svs.coordinator_user_key IS NOT NULL AND svi._fivetran_deleted = false
        GROUP BY svi.study_key, svs.coordinator_user_key),
      ranked_coords AS (SELECT study_key, coordinator_user_key, ROW_NUMBER() OVER (PARTITION BY study_key ORDER BY visit_count DESC) AS rn FROM svs_coords),
      coord_leaders AS (SELECT rc.study_key, CONCAT(u.first_name, ' ', u.last_name) AS name
        FROM ranked_coords rc JOIN ${tbl('user')} u ON rc.coordinator_user_key = u.user_key WHERE rc.rn = 1),
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
    WHERE st._fivetran_deleted = false AND st.is_active = 1
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
    WHERE sub._fivetran_deleted = false AND st.is_active = 1
    ORDER BY sub.study_key, sub.subject_key`
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
    WHERE st._fivetran_deleted = false AND st.is_active = 1
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
    WHERE aal.date_created >= DATETIME_SUB(CURRENT_DATETIME(), INTERVAL 90 DAY) AND st.is_active = 1
    ORDER BY aal.date_created DESC`,
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
    WHERE sub._fivetran_deleted = false AND st.is_active = 1
    GROUP BY sub.study_key, study_name
    HAVING total_subjects > 0
    ORDER BY enrolled DESC`
  },

  // ── 10. Revenue Analytics (financial performance per study) ──
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
      JOIN ${tbl('user')} u ON svs.coordinator_user_key = u.user_key
      WHERE svi.last_updated >= DATETIME_SUB(CURRENT_DATETIME(), INTERVAL ${days} DAY)
        AND svi._fivetran_deleted = false
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
      AND st.is_active = 1
    ORDER BY sv.subject_visit_appointment_end DESC`
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

  // ── 14. Payments received ──
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

  // ── 16. Monthly revenue summary ──
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

  // ── 19. Revenue per Subject ──
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
    WHERE sf.total_revenue > 0 AND st.is_active = 1
    ORDER BY rev_per_subject DESC`
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
      COALESCE(sv.name, '') AS visit_name
    FROM ${tbl('subject_visit_todo')} vt
    JOIN ${tbl('study')} st ON vt.study_key = st.study_key
    LEFT JOIN ${tbl('sponsor')} spon ON st.sponsor_key = spon.sponsor_key
    LEFT JOIN ${tbl('study_visit')} sv ON vt.study_visit_key = sv.study_visit_key
    LEFT JOIN ${tbl('user')} cu ON vt.created_by_user_key = cu.user_key
    LEFT JOIN ${tbl('user')} comp_u ON vt.completed_by_user_key = comp_u.user_key
    WHERE vt._fivetran_deleted = false AND st.is_active = 1
      AND vt.status IN (2, 3, 4)
    ORDER BY CASE vt.status WHEN 4 THEN 0 WHEN 3 THEN 1 ELSE 2 END, vt.due_date ASC`
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
      COALESCE(prs.name, '') AS referral_source
    FROM ${tbl('study_recruiting_patient')} srp
    JOIN ${tbl('study')} st ON srp.study_key = st.study_key
    LEFT JOIN ${tbl('sponsor')} spon ON st.sponsor_key = spon.sponsor_key
    LEFT JOIN ${tbl('patient')} p ON srp.patient_key = p.patient_key
    LEFT JOIN ${tbl('user')} u ON srp.user_key = u.user_key
    LEFT JOIN ${tbl('patient_referral_source')} prs ON srp.referral_source_key = prs.patient_referral_source_key
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
        COUNT(DISTINCT pi.study_key) AS studies
      FROM ${tbl('patient_interaction')} pi
      JOIN ${tbl('user')} u ON pi.user_key = u.user_key
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
      FORMAT_DATETIME('%Y-%m-%d', c.date_created) AS date_created,
      DATE_DIFF(CURRENT_DATE(), DATE(c.date_created), DAY) AS days_outstanding
    FROM ${tbl('comment')} c
    JOIN ${tbl('study')} st ON c.study_key = st.study_key
    LEFT JOIN ${tbl('sponsor')} spon ON st.sponsor_key = spon.sponsor_key
    LEFT JOIN ${tbl('user')} u ON c.user_key = u.user_key
    WHERE c._fivetran_deleted = false AND st.is_active = 1
      AND c.is_resolved = 0
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
    WHERE sd._fivetran_deleted = false AND st.is_active = 1
      AND sd.status NOT IN (-1)
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
        AND st.is_active = 1
        AND q.first_name IS NOT NULL
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
    WHERE sd._fivetran_deleted = false AND st.is_active = 1
      AND sd.status != -1
    GROUP BY sd.study_key, study_name
    HAVING total_documents > 0
    ORDER BY total_documents DESC`
  },
};

// ═══════════════════════════════════════════════════════════
// CLICKUP API FEEDS — Referrals, Campaigns, Medical Records
// ═══════════════════════════════════════════════════════════

const CLICKUP_TOKEN = process.env.CLICKUP_TOKEN || '';
const CLICKUP_API = 'https://api.clickup.com/api/v2';

const REFERRAL_LISTS = [
  { id: '901413202462', name: 'Dr. Modarressi', source_type: 'physician' },
  { id: '901413613356', name: 'Connolly Dermatology', source_type: 'physician' },
  { id: '901413613360', name: 'Dr. Savita Singh', source_type: 'physician' },
  { id: '901414013590', name: 'Center for Primary Care Medicine', source_type: 'physician' },
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
    if (f.value != null) obj[f.name] = typeof f.value === 'object' ? JSON.stringify(f.value) : String(f.value);
  });
  return obj;
}

// ── ClickUp Feed Handlers ──

async function fetchReferrals() {
  const rows = [];
  for (const list of REFERRAL_LISTS) {
    const tasks = await fetchAllClickUpTasks(list.id);
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
const CLICKUP_FEEDS = {
  referrals: fetchReferrals,
  campaigns: fetchCampaigns,
  medRecords: fetchMedRecords,
};

// ═══════════════════════════════════════════════════════════
// HTTP HANDLER
// ═══════════════════════════════════════════════════════════

functions.http('crpBqApi', async (req, res) => {
  // CORS
  res.set('Access-Control-Allow-Origin', '*');
  res.set('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.set('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') { res.status(204).send(''); return; }

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
      feeds: [...Object.keys(FEEDS), ...Object.keys(CLICKUP_FEEDS)],
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

  // ── BQ feeds ──
  const feedDef = FEEDS[feed];
  if (!feedDef) {
    res.status(404).json({ error: `Unknown feed: ${feed}`, available: [...Object.keys(FEEDS), ...Object.keys(CLICKUP_FEEDS)] });
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

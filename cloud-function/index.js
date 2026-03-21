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

async function runQuery(sql) {
  if (OAUTH.refreshToken) {
    // Use REST API with user token
    const token = await getAccessToken();
    const body = JSON.stringify({ query: sql, useLegacySql: false, maxResults: 50000 });
    return new Promise((resolve, reject) => {
      const req = https.request(`https://bigquery.googleapis.com/bigquery/v2/projects/${PROJECT}/queries`, {
        method: 'POST',
        headers: { 'Authorization': 'Bearer ' + token, 'Content-Type': 'application/json' }
      }, res => {
        let d = ''; res.on('data', c => d += c);
        res.on('end', () => {
          try {
            const j = JSON.parse(d);
            if (j.error) { reject(new Error(j.error.message)); return; }
            const schema = (j.schema?.fields || []).map(f => f.name);
            const rows = (j.rows || []).map(r => {
              const obj = {};
              r.f.forEach((c, i) => { obj[schema[i]] = c.v || ''; });
              return obj;
            });
            resolve(rows);
          } catch (e) { reject(new Error('BQ parse failed: ' + d.slice(0, 200))); }
        });
      });
      req.on('error', reject);
      req.write(body);
      req.end();
    });
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
  WHEN 1 THEN 'Interested' WHEN 2 THEN 'Prequalified'
  WHEN 3 THEN 'No Show/Cancelled V1' WHEN 4 THEN 'Scheduled V1'
  WHEN 10 THEN 'Screening' WHEN 11 THEN 'Enrolled'
  WHEN 12 THEN 'Screen Fail' WHEN 13 THEN 'Discontinued'
  WHEN 20 THEN 'Completed' ELSE CAST(sub.status AS STRING) END`;

const STUDY_STATUS_SQL = `CASE st.status
  WHEN 0 THEN 'Pre-Site Qualification' WHEN 1 THEN 'Site Qualification'
  WHEN 2 THEN 'Start Up' WHEN 3 THEN 'Enrolling'
  WHEN 4 THEN 'Maintenance' WHEN 5 THEN 'Closeout'
  WHEN 6 THEN 'Closed' ELSE CAST(st.status AS STRING) END`;

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
      CONCAT(COALESCE(coord.first_name, ''), ' ', COALESCE(coord.last_name, '')) AS full_name,
      CASE ca.status WHEN 0 THEN 'Cancelled' ELSE 'Active' END AS appointment_status,
      COALESCE(sv.name, '') AS visit_name,
      ${SUBJECT_STATUS_SQL} AS subject_status,
      COALESCE(sub.patient_id, '') AS subject_id,
      CASE WHEN ca.status = 0 THEN FORMAT_DATETIME('%Y-%m-%d', ca.cancel_date) ELSE '' END AS cancel_date,
      CASE WHEN ca.status = 0 THEN COALESCE(REGEXP_REPLACE(ca.cancel_reason, r'[\\x00-\\x1f]', ' '), '') ELSE '' END AS cancel_reason,
      CASE WHEN ca.status = 0 THEN CASE ca.cancel_type WHEN 1 THEN 'No Show' WHEN 2 THEN 'Site Cancelled' WHEN 3 THEN 'Patient Cancelled' ELSE '' END ELSE '' END AS appointment_cancellation_type,
      CONCAT(COALESCE(coord.first_name, ''), ' ', COALESCE(coord.last_name, '')) AS staff_full_name,
      COALESCE(si.name, '') AS site_name,
      COALESCE(sub.mobile_phone, '') AS mobile_phone,
      CAST(ca.calendar_appointment_key AS STRING) AS calendar_appointment_key,
      CASE ca.type WHEN 0 THEN 'Regular Visit' WHEN 1 THEN 'Ad Hoc Visit' WHEN 2 THEN 'General Appointment' WHEN 3 THEN 'Block' ELSE '' END AS appointment_type,
      FORMAT_DATETIME('%Y-%m-%d', CURRENT_DATETIME()) AS snapshot_date
    FROM ${tbl('calendar_appointment')} ca
    LEFT JOIN ${tbl('subject')} sub ON ca.subject_key = sub.subject_key
    LEFT JOIN ${tbl('study')} st ON ca.study_key = st.study_key
    LEFT JOIN ${tbl('sponsor')} spon ON st.sponsor_key = spon.sponsor_key
    LEFT JOIN ${tbl('site')} si ON ca.site_key = si.site_key
    LEFT JOIN ${tbl('study_visit')} sv ON ca.study_visit_key = sv.study_visit_key
    LEFT JOIN ${tbl('user')} coord ON ca.creator_key = coord.user_key
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
      appointment_type: 'Appointment Type', snapshot_date: 'snapshot_date'
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
      CONCAT(COALESCE(coord.first_name, by_user.first_name, ''), ' ', COALESCE(coord.last_name, by_user.last_name, '')) AS staff_full_name,
      COALESCE(aal.cancel_reason, '') AS cancel_reason,
      CASE aal.cancel_type WHEN 1 THEN 'No Show' WHEN 2 THEN 'Site Cancelled' WHEN 3 THEN 'Patient Cancelled' ELSE '' END AS appointment_cancellation_type,
      ${SUBJECT_STATUS_SQL} AS subject_status,
      COALESCE(sv.name, '') AS visit_name,
      CASE aal.appointment_type WHEN 0 THEN 'Regular Visit' WHEN 1 THEN 'Ad Hoc Visit' WHEN 2 THEN 'General Appointment' WHEN 3 THEN 'Block' ELSE '' END AS appointment_type,
      'cancelled' AS appointment_status,
      CONCAT(COALESCE(inv.first_name, ''), ' ', COALESCE(inv.last_name, '')) AS investigator,
      FORMAT_DATETIME('%Y-%m-%d', CURRENT_DATETIME()) AS snapshot_date
    FROM ${tbl('appointment_audit_log')} aal
    LEFT JOIN ${tbl('study')} st ON aal.study_key = st.study_key
    LEFT JOIN ${tbl('sponsor')} spon ON st.sponsor_key = spon.sponsor_key
    LEFT JOIN ${tbl('site')} si ON aal.site_key = si.site_key
    LEFT JOIN ${tbl('subject')} sub ON aal.subject_key = sub.subject_key
    LEFT JOIN ${tbl('study_visit')} sv ON aal.study_visit_key = sv.study_visit_key
    LEFT JOIN ${tbl('calendar_appointment')} ca ON aal.calendar_appointment_key = ca.calendar_appointment_key
    LEFT JOIN ${tbl('user')} coord ON ca.creator_key = coord.user_key
    LEFT JOIN ${tbl('user')} by_user ON aal.by_user_key = by_user.user_key
    LEFT JOIN ${tbl('user')} inv ON aal.by_user_key = inv.user_key
    WHERE aal.change_type = 4
      AND aal.date_created >= DATETIME_SUB(CURRENT_DATETIME(), INTERVAL 90 DAY)
      AND st.is_active = 1
    ORDER BY aal.date_created DESC`
  },

  // ── 3. Studies ──
  studies: {
    query: () => `SELECT
      CAST(st.study_key AS STRING) AS study_key,
      COALESCE(st.protocol_number, '') AS protocol_number,
      ${STUDY_NAME_SQL} AS study_name,
      ${STUDY_STATUS_SQL} AS status,
      COALESCE(sd.investigator_name, '') AS investigator,
      COALESCE(st.indications, sd.primary_indication, '') AS indication,
      COALESCE(sd.specialty, '') AS specialty,
      (SELECT COUNT(*) FROM ${tbl('subject')} sub WHERE sub.study_key = st.study_key AND sub._fivetran_deleted = false) AS subject_count,
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
      CASE aal.change_type WHEN 0 THEN 'User Added' WHEN 1 THEN 'Created' WHEN 2 THEN 'Rescheduled' WHEN 3 THEN 'Modified' WHEN 4 THEN 'Cancelled' WHEN 5 THEN 'Restored' ELSE CAST(aal.change_type AS STRING) END AS change_type,
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
      CASE p.status WHEN 0 THEN 'Available' WHEN 1 THEN 'Not Available' WHEN 2 THEN 'Active' WHEN 3 THEN 'Do Not Contact' ELSE 'Available' END AS patient_status,
      COALESCE(p.email, '') AS email,
      COALESCE(p.mobile_phone, '') AS mobile_phone,
      COALESCE(p.home_phone, '') AS home_phone,
      COALESCE(p.work_phone, '') AS work_phone,
      COALESCE(p.patient_id, CAST(p.patient_key AS STRING)) AS record_number,
      COALESCE(si.name, '') AS site_name,
      COALESCE(p.city, '') AS city,
      COALESCE(p.state, '') AS state,
      CASE p.gender WHEN 0 THEN 'Unknown' WHEN 1 THEN 'Male' WHEN 2 THEN 'Female' WHEN 3 THEN 'Other' ELSE '' END AS gender,
      COALESCE(FORMAT_DATETIME('%Y-%m-%d', p.birth_date), '') AS birth_date,
      CAST(p.patient_key AS STRING) AS patient_key,
      COALESCE(FORMAT_DATETIME('%Y-%m-%d', p.last_interaction_date), '') AS last_interaction_date,
      CAST(COALESCE(p.rating, 0) AS STRING) AS rating,
      FORMAT_DATETIME('%Y-%m-%d', CURRENT_DATETIME()) AS snapshot_date
    FROM ${tbl('patient')} p
    LEFT JOIN ${tbl('site')} si ON p.site_key = si.site_key
    WHERE p._fivetran_deleted = false AND p.status != 3
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
      COUNTIF(sub.status = 2) AS prequalified
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
        COUNT(DISTINCT ca.calendar_appointment_key) AS visits_managed,
        COUNT(DISTINCT ca.subject_key) AS unique_subjects,
        COUNT(DISTINCT ca.study_key) AS studies,
        COUNTIF(ca.status = 0) AS cancelled,
        COUNTIF(ca.status = 1) AS active
      FROM ${tbl('calendar_appointment')} ca
      JOIN ${tbl('user')} u ON ca.creator_key = u.user_key
      WHERE ca.start >= DATETIME_SUB(CURRENT_DATETIME(), INTERVAL ${days} DAY)
        AND ca.subject_key IS NOT NULL
      GROUP BY coordinator
      HAVING visits_managed > 0
      ORDER BY visits_managed DESC`;
    }
  },

  // ── TEST: minimal query to debug ──
  test: {
    query: () => `SELECT 'hello' AS msg, CURRENT_TIMESTAMP() AS ts`
  },
  test2: {
    query: () => `SELECT COUNT(*) AS cnt FROM \`crio-468120.crio_data.study\``
  },

  // ── 12. Visit Compliance ──
  compliance: {
    query: () => `SELECT
      CAST(sv.study_key AS STRING) AS study_key,
      st.nickname AS study_name,
      sv.visit_name,
      sv.subject_visit_appointment_status AS status,
      sv.days_oow,
      FORMAT_DATETIME('%Y-%m-%d', sv.window_start_date) AS window_start,
      FORMAT_DATETIME('%Y-%m-%d', sv.window_end_date) AS window_end,
      FORMAT_DATETIME('%Y-%m-%d', sv.subject_visit_appointment_end) AS visit_date,
      CAST(sv.subject_key AS STRING) AS subject_key
    FROM ${tbl('fact_subject_visit')} sv
    JOIN ${tbl('study')} st ON sv.study_key = st.study_key
    WHERE sv.subject_visit_appointment_end >= DATETIME_SUB(CURRENT_DATETIME(), INTERVAL 90 DAY)
      AND st.is_active = 1
    ORDER BY sv.subject_visit_appointment_end DESC`
  },
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

  const feed = req.query.feed;
  const format = req.query.format || 'csv';

  // List available feeds
  if (!feed) {
    res.json({
      feeds: Object.keys(FEEDS),
      usage: '?feed=visits&format=csv',
      formats: ['csv', 'json'],
      note: 'Add &days=N for feeds that support date range parameters'
    });
    return;
  }

  const feedDef = FEEDS[feed];
  if (!feedDef) {
    res.status(404).json({ error: `Unknown feed: ${feed}`, available: Object.keys(FEEDS) });
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

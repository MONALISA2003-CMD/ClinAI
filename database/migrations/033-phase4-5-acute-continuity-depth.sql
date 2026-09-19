-- ClinAI Phase 4 + Phase 5: additive operational indexing only.
-- No destructive statements. Existing authoritative data is preserved.

ALTER TABLE patient_consents ADD COLUMN IF NOT EXISTS version text;
ALTER TABLE pediatric_assessments ADD COLUMN IF NOT EXISTS reviewed_at timestamptz;
ALTER TABLE pediatric_assessments ADD COLUMN IF NOT EXISTS reviewed_by uuid;
ALTER TABLE child_health_visits ADD COLUMN IF NOT EXISTS reviewed_at timestamptz;
ALTER TABLE child_health_visits ADD COLUMN IF NOT EXISTS reviewed_by uuid;

CREATE INDEX IF NOT EXISTS emergency_cases_org_status_arrival_idx
  ON emergency_cases (organization_id, status, arrival_at DESC);

CREATE INDEX IF NOT EXISTS admissions_org_status_admitted_idx
  ON admissions (organization_id, status, admitted_at DESC);

CREATE INDEX IF NOT EXISTS facility_beds_org_status_ward_idx
  ON facility_beds (organization_id, status, ward);

CREATE INDEX IF NOT EXISTS nursing_assessments_org_status_created_idx
  ON nursing_assessments (organization_id, status, created_at DESC);

CREATE INDEX IF NOT EXISTS surgery_cases_org_status_scheduled_idx
  ON surgery_cases (organization_id, status, scheduled_at DESC);

CREATE INDEX IF NOT EXISTS maternity_records_org_status_event_idx
  ON maternity_records (organization_id, status, event_at DESC);

CREATE INDEX IF NOT EXISTS pediatric_assessments_org_created_idx
  ON pediatric_assessments (organization_id, created_at DESC);

CREATE INDEX IF NOT EXISTS child_health_visits_org_date_idx
  ON child_health_visits (organization_id, visit_date DESC);

CREATE INDEX IF NOT EXISTS immunizations_org_status_due_idx
  ON immunizations (organization_id, status, next_due_at);

CREATE INDEX IF NOT EXISTS chronic_care_org_status_review_idx
  ON chronic_care_records (organization_id, status, next_review_at);

CREATE INDEX IF NOT EXISTS patient_consents_org_status_expiry_idx
  ON patient_consents (organization_id, status, expires_at);

CREATE INDEX IF NOT EXISTS referrals_patient_status_urgency_requested_idx
  ON referrals (patient_id, status, urgency, requested_at DESC);

CREATE INDEX IF NOT EXISTS referral_network_org_status_service_idx
  ON referral_network_nodes (organization_id, status, service_code);

CREATE INDEX IF NOT EXISTS care_gap_snapshots_org_status_detected_idx
  ON care_gap_snapshots (organization_id, status, detected_at DESC);

CREATE INDEX IF NOT EXISTS patient_portal_accounts_org_status_updated_idx
  ON patient_portal_accounts (organization_id, status, updated_at DESC);

CREATE INDEX IF NOT EXISTS portal_messages_org_status_created_idx
  ON portal_messages (organization_id, status, created_at DESC);

CREATE INDEX IF NOT EXISTS telemedicine_org_status_scheduled_idx
  ON telemedicine_sessions (organization_id, status, scheduled_at DESC);

CREATE INDEX IF NOT EXISTS remote_monitoring_org_alert_measured_idx
  ON remote_monitoring_readings (organization_id, alert_status, measured_at DESC);

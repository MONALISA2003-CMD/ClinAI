-- ClinAI Production Integrity: additive AI observability/intelligence indexes.
-- No data reset, no destructive changes.
CREATE INDEX IF NOT EXISTS idx_ai_work_runs_org_patient_created
  ON ai_work_runs(organization_id, patient_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_ai_work_runs_org_purpose_created
  ON ai_work_runs(organization_id, purpose, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_ai_usage_events_org_patient_created
  ON ai_usage_events(organization_id, patient_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_ai_usage_events_org_purpose_created
  ON ai_usage_events(organization_id, purpose, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_ai_security_events_org_status_created
  ON ai_security_events(organization_id, status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_ai_risk_assessments_org_status
  ON ai_risk_assessments(organization_id, status, risk_level);

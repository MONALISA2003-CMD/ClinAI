-- ClinAI connected workflow migration
-- Safe to run against an existing PostgreSQL deployment.
ALTER TABLE notifications ADD COLUMN IF NOT EXISTS created_at timestamptz NOT NULL DEFAULT now();
CREATE INDEX IF NOT EXISTS idx_notifications_patient_created ON notifications(patient_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_audit_logs_org_created ON audit_logs(organization_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_outbox_org_created ON outbox_events(organization_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_clinical_orders_patient_created ON clinical_orders(patient_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_lab_results_sample_status ON lab_results(sample_id, status);
CREATE INDEX IF NOT EXISTS idx_medication_orders_patient_status ON medication_orders(patient_id, status);
CREATE INDEX IF NOT EXISTS idx_invoices_patient_status ON invoices(patient_id, status);

-- ClinAI intelligence, governance and communication indexes
CREATE INDEX IF NOT EXISTS idx_module_records_org_module_status ON module_records(organization_id,module,status,created_at DESC);
CREATE INDEX IF NOT EXISTS idx_module_records_patient_payload ON module_records USING gin(payload);
CREATE INDEX IF NOT EXISTS idx_ai_interactions_org_created ON ai_interactions(organization_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_notifications_org_created ON notifications(organization_id, created_at DESC);

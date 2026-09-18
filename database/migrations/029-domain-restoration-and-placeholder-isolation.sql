-- ClinAI 029: authoritative domain restoration and synthetic coverage isolation.
-- Non-destructive. Existing 025 synthetic coverage rows remain in the database for
-- auditability, but are excluded from operational module views. Real domain tables
-- remain the source of truth for their respective modules.

CREATE OR REPLACE VIEW clinai_live_module_records AS
SELECT id, organization_id, module, status, payload, created_by, created_at, updated_at
FROM module_records
WHERE COALESCE(payload->>'coverageVersion','') <> '025'
  AND COALESCE(payload->>'recordPurpose','') <> 'connected synthetic testing';

CREATE INDEX IF NOT EXISTS idx_module_records_live_org_module_created
  ON module_records(organization_id,module,created_at DESC)
  WHERE COALESCE(payload->>'coverageVersion','') <> '025'
  AND COALESCE(payload->>'recordPurpose','') <> 'connected synthetic testing';

CREATE INDEX IF NOT EXISTS idx_module_records_live_patient
  ON module_records(organization_id,module,(payload->>'patientId'),created_at DESC)
  WHERE COALESCE(payload->>'coverageVersion','') <> '025'
  AND COALESCE(payload->>'recordPurpose','') <> 'connected synthetic testing';

COMMENT ON VIEW clinai_live_module_records IS
  'Operational module-record projection excluding migration 025 coverage placeholders. Authoritative domain tables remain primary source of truth.';

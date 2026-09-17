-- Phase 4: non-destructive clinical workflow projection and journey intelligence.
ALTER TABLE clinical_workflow_events ADD COLUMN IF NOT EXISTS source_event_id uuid;
CREATE UNIQUE INDEX IF NOT EXISTS clinical_workflow_source_event_uidx
  ON clinical_workflow_events(source_event_id) WHERE source_event_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS clinical_workflow_event_type_patient_idx
  ON clinical_workflow_events(organization_id, patient_id, event_type, created_at DESC);
CREATE INDEX IF NOT EXISTS clinical_signals_workflow_gap_idx
  ON clinical_signals(organization_id, patient_id, signal_type, status, detected_at DESC);

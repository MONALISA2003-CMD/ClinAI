-- ClinAI Phase 2: core clinical domain depth.
-- Additive only. No DROP/TRUNCATE/DELETE/data replacement.

CREATE TABLE IF NOT EXISTS triage_assessments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  patient_id uuid NOT NULL REFERENCES patients(id) ON DELETE CASCADE,
  encounter_id uuid REFERENCES encounters(id) ON DELETE SET NULL,
  arrived_at timestamptz NOT NULL DEFAULT now(),
  arrival_mode text NOT NULL DEFAULT 'walk-in',
  chief_complaint text NOT NULL,
  triage_nurse_id uuid REFERENCES users(id),
  acuity text NOT NULL DEFAULT 'routine',
  triage_category text,
  temperature numeric,
  heart_rate numeric,
  respiratory_rate numeric,
  systolic numeric,
  diastolic numeric,
  spo2 numeric,
  pain numeric,
  mental_status text,
  mobility_status text,
  infection_precautions jsonb NOT NULL DEFAULT '{}',
  risk_flags jsonb NOT NULL DEFAULT '[]',
  notes text,
  disposition text,
  status text NOT NULL DEFAULT 'completed',
  routed_at timestamptz,
  completed_at timestamptz,
  created_by uuid REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE triage_assessments ADD COLUMN IF NOT EXISTS queue_entry_id uuid REFERENCES queue_entries(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS triage_assessments_org_time_idx ON triage_assessments(organization_id,arrived_at DESC);
CREATE INDEX IF NOT EXISTS triage_assessments_patient_idx ON triage_assessments(organization_id,patient_id,arrived_at DESC);
CREATE INDEX IF NOT EXISTS triage_assessments_acuity_idx ON triage_assessments(organization_id,acuity,status,arrived_at DESC);
CREATE INDEX IF NOT EXISTS triage_assessments_queue_idx ON triage_assessments(queue_entry_id);

ALTER TABLE diagnoses ADD COLUMN IF NOT EXISTS verification_status text NOT NULL DEFAULT 'unverified';
ALTER TABLE diagnoses ADD COLUMN IF NOT EXISTS severity text;
ALTER TABLE diagnoses ADD COLUMN IF NOT EXISTS certainty text;
ALTER TABLE diagnoses ADD COLUMN IF NOT EXISTS onset_date date;
ALTER TABLE diagnoses ADD COLUMN IF NOT EXISTS resolution_date date;
ALTER TABLE diagnoses ADD COLUMN IF NOT EXISTS laterality text;
ALTER TABLE diagnoses ADD COLUMN IF NOT EXISTS anatomical_site text;
ALTER TABLE diagnoses ADD COLUMN IF NOT EXISTS notes text;
ALTER TABLE diagnoses ADD COLUMN IF NOT EXISTS clinician_id uuid REFERENCES users(id);
CREATE INDEX IF NOT EXISTS diagnoses_patient_status_idx ON diagnoses(patient_id,status,verification_status);
CREATE INDEX IF NOT EXISTS diagnoses_code_idx ON diagnoses(code_system,code);

ALTER TABLE clinical_notes ADD COLUMN IF NOT EXISTS author_id uuid REFERENCES users(id);
ALTER TABLE clinical_notes ADD COLUMN IF NOT EXISTS documentation_status text NOT NULL DEFAULT 'draft';
ALTER TABLE clinical_notes ADD COLUMN IF NOT EXISTS chief_complaint text;
ALTER TABLE clinical_notes ADD COLUMN IF NOT EXISTS history text;
ALTER TABLE clinical_notes ADD COLUMN IF NOT EXISTS examination text;
ALTER TABLE clinical_notes ADD COLUMN IF NOT EXISTS diagnosis_references jsonb NOT NULL DEFAULT '[]';
ALTER TABLE clinical_notes ADD COLUMN IF NOT EXISTS order_references jsonb NOT NULL DEFAULT '[]';
ALTER TABLE clinical_notes ADD COLUMN IF NOT EXISTS medication_summary jsonb NOT NULL DEFAULT '[]';
ALTER TABLE clinical_notes ADD COLUMN IF NOT EXISTS allergy_summary jsonb NOT NULL DEFAULT '[]';
ALTER TABLE clinical_notes ADD COLUMN IF NOT EXISTS observation_summary jsonb NOT NULL DEFAULT '[]';
ALTER TABLE clinical_notes ADD COLUMN IF NOT EXISTS follow_up jsonb NOT NULL DEFAULT '{}';
ALTER TABLE clinical_notes ADD COLUMN IF NOT EXISTS amendment_reason text;
ALTER TABLE clinical_notes ADD COLUMN IF NOT EXISTS created_at timestamptz NOT NULL DEFAULT now();
ALTER TABLE clinical_notes ADD COLUMN IF NOT EXISTS updated_at timestamptz NOT NULL DEFAULT now();
CREATE INDEX IF NOT EXISTS clinical_notes_encounter_time_idx ON clinical_notes(encounter_id,created_at DESC);
CREATE INDEX IF NOT EXISTS clinical_notes_status_idx ON clinical_notes(documentation_status,created_at DESC);

ALTER TABLE care_plans ADD COLUMN IF NOT EXISTS priority text NOT NULL DEFAULT 'normal';
ALTER TABLE care_plans ADD COLUMN IF NOT EXISTS owner_id uuid REFERENCES users(id);
ALTER TABLE care_plans ADD COLUMN IF NOT EXISTS review_at timestamptz;
ALTER TABLE care_plans ADD COLUMN IF NOT EXISTS interventions jsonb NOT NULL DEFAULT '[]';
ALTER TABLE care_plans ADD COLUMN IF NOT EXISTS outcome_measures jsonb NOT NULL DEFAULT '[]';
ALTER TABLE care_plans ADD COLUMN IF NOT EXISTS barriers jsonb NOT NULL DEFAULT '[]';
ALTER TABLE care_plans ADD COLUMN IF NOT EXISTS next_review_note text;
ALTER TABLE care_plans ADD COLUMN IF NOT EXISTS created_at timestamptz NOT NULL DEFAULT now();
ALTER TABLE care_plans ADD COLUMN IF NOT EXISTS updated_at timestamptz NOT NULL DEFAULT now();
CREATE INDEX IF NOT EXISTS care_plans_patient_status_idx ON care_plans(patient_id,status,review_at);

ALTER TABLE referrals ADD COLUMN IF NOT EXISTS referral_type text NOT NULL DEFAULT 'clinical';
ALTER TABLE referrals ADD COLUMN IF NOT EXISTS service_code text;
ALTER TABLE referrals ADD COLUMN IF NOT EXISTS urgency text NOT NULL DEFAULT 'routine';
ALTER TABLE referrals ADD COLUMN IF NOT EXISTS destination_facility_id uuid REFERENCES facilities(id) ON DELETE SET NULL;
ALTER TABLE referrals ADD COLUMN IF NOT EXISTS referring_provider_id uuid REFERENCES users(id);
ALTER TABLE referrals ADD COLUMN IF NOT EXISTS clinical_summary text;
ALTER TABLE referrals ADD COLUMN IF NOT EXISTS requested_at timestamptz NOT NULL DEFAULT now();
ALTER TABLE referrals ADD COLUMN IF NOT EXISTS accepted_at timestamptz;
ALTER TABLE referrals ADD COLUMN IF NOT EXISTS completed_at timestamptz;
ALTER TABLE referrals ADD COLUMN IF NOT EXISTS updated_at timestamptz NOT NULL DEFAULT now();
CREATE INDEX IF NOT EXISTS referrals_patient_status_idx ON referrals(patient_id,status,requested_at DESC);
CREATE INDEX IF NOT EXISTS referrals_destination_idx ON referrals(destination_facility_id,status,requested_at DESC);

ALTER TABLE referral_transfers ADD COLUMN IF NOT EXISTS receiving_contact text;
ALTER TABLE referral_transfers ADD COLUMN IF NOT EXISTS transport_status text;
ALTER TABLE referral_transfers ADD COLUMN IF NOT EXISTS expected_arrival_at timestamptz;
ALTER TABLE referral_transfers ADD COLUMN IF NOT EXISTS updated_by uuid REFERENCES users(id);
CREATE INDEX IF NOT EXISTS referral_transfers_status_idx ON referral_transfers(organization_id,status,updated_at DESC);

ALTER TABLE care_tasks ADD COLUMN IF NOT EXISTS task_category text NOT NULL DEFAULT 'clinical';
ALTER TABLE care_tasks ADD COLUMN IF NOT EXISTS escalation_level integer NOT NULL DEFAULT 0;
ALTER TABLE care_tasks ADD COLUMN IF NOT EXISTS blocked_reason text;
ALTER TABLE care_tasks ADD COLUMN IF NOT EXISTS started_at timestamptz;
ALTER TABLE care_tasks ADD COLUMN IF NOT EXISTS updated_at timestamptz NOT NULL DEFAULT now();
CREATE INDEX IF NOT EXISTS care_tasks_work_queue_idx ON care_tasks(organization_id,status,priority,due_at);
CREATE INDEX IF NOT EXISTS care_tasks_patient_idx ON care_tasks(organization_id,patient_id,status,due_at);

CREATE INDEX IF NOT EXISTS clinical_workflow_events_patient_time_idx ON clinical_workflow_events(organization_id,patient_id,created_at DESC);
CREATE INDEX IF NOT EXISTS clinical_workflow_events_type_time_idx ON clinical_workflow_events(organization_id,event_type,created_at DESC);

COMMENT ON TABLE triage_assessments IS 'Authoritative Phase 2 triage assessment record. Existing module_records triage rows are retained as historical compatibility projections.';
COMMENT ON COLUMN clinical_notes.documentation_status IS 'Clinical documentation lifecycle: draft, signed, amended, voided.';
COMMENT ON COLUMN diagnoses.verification_status IS 'Clinical verification lifecycle separate from diagnosis clinical status.';
COMMENT ON COLUMN referrals.status IS 'Referral lifecycle: draft, sent, accepted, in-progress, completed, cancelled, closed.';

-- Preserve existing connected synthetic triage projections as authoritative records.
-- This is intentionally scoped to synthetic TEST data and is idempotent.
INSERT INTO triage_assessments(
  organization_id,patient_id,arrived_at,arrival_mode,chief_complaint,acuity,status,notes,created_at,updated_at
)
SELECT
  mr.organization_id,
  p.id,
  mr.created_at,
  'walk-in',
  COALESCE(mr.payload->>'scenario','Synthetic triage record'),
  'routine',
  'completed',
  'Backfilled from the existing connected synthetic triage compatibility projection; no additional clinical measurements were present in the source record.',
  mr.created_at,
  COALESCE(mr.updated_at,mr.created_at)
FROM module_records mr
JOIN patients p ON p.id = (mr.payload->>'patientId')::uuid AND p.organization_id = mr.organization_id
WHERE mr.module='triage'
  AND mr.payload->>'recordPurpose'='connected synthetic testing'
  AND mr.payload->>'patientNumber' LIKE 'TEST-%'
  AND NOT EXISTS (
    SELECT 1 FROM triage_assessments t
    WHERE t.organization_id=mr.organization_id
      AND t.patient_id=p.id
      AND t.created_at=mr.created_at
  );

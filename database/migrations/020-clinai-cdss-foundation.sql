-- ClinAI CDSS Foundation v20
-- Additive only. No DROP/TRUNCATE/DELETE/ALTER DATA operations.
-- Provides governed rule versioning, clinical signals, signal actions and evaluation audit.

CREATE TABLE IF NOT EXISTS cdss_rule_versions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  guideline_rule_id uuid NOT NULL REFERENCES clinical_guideline_rules(id) ON DELETE CASCADE,
  version text NOT NULL,
  status text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','review','approved','active','retired')),
  engine text NOT NULL DEFAULT 'clinai-json' CHECK (engine IN ('clinai-json','cql')),
  logic jsonb NOT NULL DEFAULT '{}',
  evidence jsonb NOT NULL DEFAULT '{}',
  effective_from timestamptz,
  effective_to timestamptz,
  approved_by uuid REFERENCES users(id) ON DELETE SET NULL,
  approved_at timestamptz,
  created_by uuid REFERENCES users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(guideline_rule_id, version)
);
CREATE INDEX IF NOT EXISTS cdss_rule_versions_status_idx ON cdss_rule_versions(status, updated_at DESC);

CREATE TABLE IF NOT EXISTS clinical_signals (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  patient_id uuid REFERENCES patients(id) ON DELETE SET NULL,
  encounter_id uuid REFERENCES encounters(id) ON DELETE SET NULL,
  rule_version_id uuid REFERENCES cdss_rule_versions(id) ON DELETE SET NULL,
  source_event_id uuid REFERENCES clinical_workflow_events(id) ON DELETE SET NULL,
  signal_type text NOT NULL,
  severity text NOT NULL DEFAULT 'moderate' CHECK (severity IN ('critical','high','moderate','low','informational')),
  status text NOT NULL DEFAULT 'open' CHECK (status IN ('open','acknowledged','snoozed','resolved','dismissed')),
  title text NOT NULL,
  summary text,
  evidence jsonb NOT NULL DEFAULT '{}',
  recommendation text,
  action_url text,
  detected_at timestamptz NOT NULL DEFAULT now(),
  acknowledged_by uuid REFERENCES users(id) ON DELETE SET NULL,
  acknowledged_at timestamptz,
  resolved_by uuid REFERENCES users(id) ON DELETE SET NULL,
  resolved_at timestamptz,
  snoozed_until timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS clinical_signals_org_status_idx ON clinical_signals(organization_id, status, severity, detected_at DESC);
CREATE INDEX IF NOT EXISTS clinical_signals_patient_idx ON clinical_signals(organization_id, patient_id, status, detected_at DESC);
CREATE INDEX IF NOT EXISTS clinical_signals_rule_idx ON clinical_signals(rule_version_id, detected_at DESC);

CREATE TABLE IF NOT EXISTS clinical_signal_actions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  signal_id uuid NOT NULL REFERENCES clinical_signals(id) ON DELETE CASCADE,
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  actor_user_id uuid REFERENCES users(id) ON DELETE SET NULL,
  action text NOT NULL CHECK (action IN ('acknowledge','snooze','resolve','dismiss','reopen','view')),
  reason text,
  metadata jsonb NOT NULL DEFAULT '{}',
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS clinical_signal_actions_signal_idx ON clinical_signal_actions(signal_id, created_at DESC);

CREATE TABLE IF NOT EXISTS cdss_evaluations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  patient_id uuid REFERENCES patients(id) ON DELETE SET NULL,
  encounter_id uuid REFERENCES encounters(id) ON DELETE SET NULL,
  rule_version_id uuid REFERENCES cdss_rule_versions(id) ON DELETE SET NULL,
  source_event_id uuid REFERENCES clinical_workflow_events(id) ON DELETE SET NULL,
  outcome text NOT NULL CHECK (outcome IN ('triggered','not_triggered','skipped','error')),
  evaluated_at timestamptz NOT NULL DEFAULT now(),
  duration_ms integer,
  evidence jsonb NOT NULL DEFAULT '{}',
  error_code text,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS cdss_evaluations_org_time_idx ON cdss_evaluations(organization_id, evaluated_at DESC);
CREATE INDEX IF NOT EXISTS cdss_evaluations_rule_time_idx ON cdss_evaluations(rule_version_id, evaluated_at DESC);

COMMENT ON TABLE clinical_signals IS 'Governed, clinician-facing CDSS signals derived from approved rule evaluations; not generative AI output.';
COMMENT ON TABLE cdss_rule_versions IS 'Versioned CDSS rule definitions linked to existing clinical guideline rules.';
COMMENT ON TABLE cdss_evaluations IS 'Audit trail of CDSS rule evaluation outcomes.';

-- ClinAI AI intelligence, orchestration, computation and audit persistence.
-- Names describe implementation modules rather than release phases.
CREATE TABLE IF NOT EXISTS ai_work_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  user_id uuid REFERENCES users(id) ON DELETE SET NULL,
  patient_id uuid REFERENCES patients(id) ON DELETE SET NULL,
  run_id text NOT NULL UNIQUE,
  purpose text NOT NULL,
  mode text NOT NULL DEFAULT 'intelligence',
  model text NOT NULL,
  status text NOT NULL DEFAULT 'completed',
  question text NOT NULL,
  tools_used jsonb NOT NULL DEFAULT '[]',
  calculations jsonb NOT NULL DEFAULT '[]',
  evidence_count integer NOT NULL DEFAULT 0,
  latency_ms integer,
  confidence text,
  safety_flags jsonb NOT NULL DEFAULT '[]',
  result_summary jsonb NOT NULL DEFAULT '{}',
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS ai_work_runs_org_created_idx ON ai_work_runs(organization_id,created_at DESC);
CREATE INDEX IF NOT EXISTS ai_work_runs_patient_idx ON ai_work_runs(organization_id,patient_id,created_at DESC);

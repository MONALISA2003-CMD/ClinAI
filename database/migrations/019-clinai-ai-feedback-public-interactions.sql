-- ClinAI additive AI feedback + public interaction storage.
-- No patient records are modified or deleted.
CREATE TABLE IF NOT EXISTS ai_feedback (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  user_id uuid REFERENCES users(id) ON DELETE SET NULL,
  patient_id uuid REFERENCES patients(id) ON DELETE SET NULL,
  run_id text NOT NULL,
  rating text NOT NULL,
  reason text,
  comment text,
  corrected_answer text,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS ai_feedback_org_created_idx ON ai_feedback(organization_id,created_at DESC);
CREATE INDEX IF NOT EXISTS ai_feedback_run_idx ON ai_feedback(run_id,created_at DESC);

CREATE TABLE IF NOT EXISTS public_feedback (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  type text NOT NULL,
  rating text,
  reason text,
  message text NOT NULL,
  page text,
  anonymous boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS public_feedback_created_idx ON public_feedback(created_at DESC);

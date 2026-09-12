-- ClinAI V15 platform completion
-- Safe to run repeatedly.
CREATE TABLE IF NOT EXISTS patient_aliases (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  patient_id uuid NOT NULL REFERENCES patients(id) ON DELETE CASCADE,
  alias_patient_id uuid NOT NULL,
  alias_patient_number text,
  reason text,
  merged_at timestamptz NOT NULL DEFAULT now(),
  merged_by uuid REFERENCES users(id) ON DELETE SET NULL
);
CREATE INDEX IF NOT EXISTS patient_aliases_lookup_idx ON patient_aliases(organization_id,alias_patient_id);

CREATE TABLE IF NOT EXISTS analytics_snapshots (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  snapshot_date date NOT NULL DEFAULT current_date,
  metric text NOT NULL,
  value_numeric numeric NOT NULL DEFAULT 0,
  dimensions jsonb NOT NULL DEFAULT '{}',
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(organization_id,snapshot_date,metric,dimensions)
);
CREATE INDEX IF NOT EXISTS analytics_snapshots_idx ON analytics_snapshots(organization_id,snapshot_date DESC,metric);

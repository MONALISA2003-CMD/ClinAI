CREATE TABLE IF NOT EXISTS pathway_enrollments (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
 pathway_id uuid NOT NULL REFERENCES care_pathways(id) ON DELETE CASCADE, patient_id uuid NOT NULL REFERENCES patients(id) ON DELETE CASCADE,
 encounter_id uuid REFERENCES encounters(id) ON DELETE SET NULL, status text NOT NULL DEFAULT 'active', current_step_no integer NOT NULL DEFAULT 1,
 started_at timestamptz NOT NULL DEFAULT now(), completed_at timestamptz, context jsonb NOT NULL DEFAULT '{}', created_by uuid REFERENCES users(id), updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS pathway_enrollments_patient_idx ON pathway_enrollments(patient_id,status,started_at DESC);
CREATE TABLE IF NOT EXISTS pathway_step_executions (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), enrollment_id uuid NOT NULL REFERENCES pathway_enrollments(id) ON DELETE CASCADE,
 step_id uuid NOT NULL REFERENCES care_pathway_steps(id) ON DELETE CASCADE, status text NOT NULL DEFAULT 'pending', facts jsonb NOT NULL DEFAULT '{}', result jsonb NOT NULL DEFAULT '{}',
 completed_at timestamptz, completed_by uuid REFERENCES users(id), created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(), UNIQUE(enrollment_id,step_id)
);
CREATE INDEX IF NOT EXISTS pathway_step_exec_enrollment_idx ON pathway_step_executions(enrollment_id,status);
CREATE TABLE IF NOT EXISTS reporting_submissions (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE, reporting_system text NOT NULL,
 period_start date NOT NULL, period_end date NOT NULL, payload jsonb NOT NULL DEFAULT '{}', status text NOT NULL DEFAULT 'draft', external_reference text, error text,
 created_by uuid REFERENCES users(id), created_at timestamptz NOT NULL DEFAULT now(), submitted_at timestamptz
);
CREATE INDEX IF NOT EXISTS reporting_submissions_period_idx ON reporting_submissions(organization_id,reporting_system,period_end DESC);
CREATE TABLE IF NOT EXISTS sync_devices (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE, device_id text NOT NULL,
 user_id uuid REFERENCES users(id), platform text, app_version text, last_seen_at timestamptz NOT NULL DEFAULT now(), last_sync_at timestamptz, metadata jsonb NOT NULL DEFAULT '{}', UNIQUE(organization_id,device_id)
);

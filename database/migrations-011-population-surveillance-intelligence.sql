CREATE TABLE IF NOT EXISTS surveillance_events (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
 patient_id uuid REFERENCES patients(id) ON DELETE SET NULL, event_type text NOT NULL, disease_code text, disease_name text,
 event_date timestamptz NOT NULL DEFAULT now(), location jsonb NOT NULL DEFAULT '{}', case_status text NOT NULL DEFAULT 'suspected' CHECK(case_status IN ('suspected','probable','confirmed','discarded','unknown')),
 severity text NOT NULL DEFAULT 'routine' CHECK(severity IN ('routine','high','urgent','critical')), source text, evidence jsonb NOT NULL DEFAULT '{}', reported_at timestamptz,
 created_by uuid REFERENCES users(id), created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS surveillance_events_org_date_idx ON surveillance_events(organization_id,event_date DESC);
CREATE INDEX IF NOT EXISTS surveillance_events_disease_idx ON surveillance_events(organization_id,disease_code,event_date DESC);
CREATE TABLE IF NOT EXISTS surveillance_cases (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE, event_id uuid REFERENCES surveillance_events(id) ON DELETE SET NULL,
 case_identifier text, disease_code text NOT NULL, case_definition_version text, classification text NOT NULL DEFAULT 'suspected',
 onset_date timestamptz, notification_date timestamptz, outcome text, exposure jsonb NOT NULL DEFAULT '{}', laboratory jsonb NOT NULL DEFAULT '{}', investigation jsonb NOT NULL DEFAULT '{}',
 status text NOT NULL DEFAULT 'open' CHECK(status IN ('open','under-investigation','closed','reopened')), created_by uuid REFERENCES users(id), created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS surveillance_cases_disease_status_idx ON surveillance_cases(organization_id,disease_code,status,created_at DESC);
CREATE TABLE IF NOT EXISTS population_cohorts (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE, name text NOT NULL, description text, cohort_type text NOT NULL,
 definition jsonb NOT NULL DEFAULT '{}', jurisdiction text NOT NULL DEFAULT 'UG', status text NOT NULL DEFAULT 'active' CHECK(status IN ('draft','active','archived')),
 source_guideline text, created_by uuid REFERENCES users(id), created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS population_cohort_members (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE, cohort_id uuid NOT NULL REFERENCES population_cohorts(id) ON DELETE CASCADE,
 patient_id uuid NOT NULL REFERENCES patients(id) ON DELETE CASCADE, status text NOT NULL DEFAULT 'active' CHECK(status IN ('active','resolved','excluded')),
 risk_level text NOT NULL DEFAULT 'routine' CHECK(risk_level IN ('routine','moderate','high','urgent')), evidence jsonb NOT NULL DEFAULT '{}', joined_at timestamptz NOT NULL DEFAULT now(), exited_at timestamptz,
 UNIQUE(cohort_id,patient_id)
);
CREATE INDEX IF NOT EXISTS population_cohort_members_patient_idx ON population_cohort_members(organization_id,patient_id,status);
CREATE TABLE IF NOT EXISTS population_indicators (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE, indicator_code text NOT NULL, indicator_name text NOT NULL,
 period_start date NOT NULL, period_end date NOT NULL, numerator numeric NOT NULL DEFAULT 0, denominator numeric NOT NULL DEFAULT 0, value numeric,
 dimensions jsonb NOT NULL DEFAULT '{}', source text, status text NOT NULL DEFAULT 'calculated', calculated_at timestamptz NOT NULL DEFAULT now(), UNIQUE(organization_id,indicator_code,period_start,period_end,dimensions)
);
CREATE INDEX IF NOT EXISTS population_indicators_period_idx ON population_indicators(organization_id,period_end DESC,indicator_code);

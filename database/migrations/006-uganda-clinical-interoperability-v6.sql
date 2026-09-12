-- ClinAI V6: Uganda-aware governance, terminology, pathways, HIE and offline foundations.
-- Clinical rules remain configuration-driven and require national/facility governance approval.
CREATE TABLE IF NOT EXISTS facility_identifiers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  facility_id uuid NOT NULL REFERENCES facilities(id) ON DELETE CASCADE, system text NOT NULL, value text NOT NULL, identifier_type text,
  period_start timestamptz, period_end timestamptz, created_at timestamptz NOT NULL DEFAULT now(), UNIQUE(organization_id,system,value)
);
CREATE TABLE IF NOT EXISTS health_worker_profiles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE, facility_id uuid REFERENCES facilities(id) ON DELETE SET NULL,
  cadre text NOT NULL, profession text, registration_system text, registration_number text, specialty text, status text NOT NULL DEFAULT 'active',
  verified_at timestamptz, metadata jsonb NOT NULL DEFAULT '{}', created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(), UNIQUE(organization_id,user_id)
);
CREATE TABLE IF NOT EXISTS terminology_concepts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), organization_id uuid REFERENCES organizations(id) ON DELETE CASCADE,
  system_uri text NOT NULL, code text NOT NULL, display text NOT NULL, version text, status text NOT NULL DEFAULT 'active', source text, source_url text, properties jsonb NOT NULL DEFAULT '{}', created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS clinical_guidelines (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), organization_id uuid REFERENCES organizations(id) ON DELETE CASCADE,
  jurisdiction text NOT NULL, domain text NOT NULL, title text NOT NULL, publisher text NOT NULL, version text, source_url text,
  effective_from date, effective_to date, status text NOT NULL DEFAULT 'draft', content_hash text, machine_readable boolean NOT NULL DEFAULT false, metadata jsonb NOT NULL DEFAULT '{}', created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS clinical_guideline_rules (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), guideline_id uuid NOT NULL REFERENCES clinical_guidelines(id) ON DELETE CASCADE,
  rule_key text NOT NULL, description text, input_schema jsonb NOT NULL DEFAULT '{}', logic jsonb NOT NULL DEFAULT '{}', output_schema jsonb NOT NULL DEFAULT '{}', priority integer NOT NULL DEFAULT 100, active boolean NOT NULL DEFAULT true, created_at timestamptz NOT NULL DEFAULT now(), UNIQUE(guideline_id,rule_key)
);
CREATE TABLE IF NOT EXISTS care_pathways (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), organization_id uuid REFERENCES organizations(id) ON DELETE CASCADE,
  code text NOT NULL, name text NOT NULL, domain text NOT NULL, jurisdiction text NOT NULL DEFAULT 'UG', version text NOT NULL, status text NOT NULL DEFAULT 'draft', source_guideline_id uuid REFERENCES clinical_guidelines(id) ON DELETE SET NULL, metadata jsonb NOT NULL DEFAULT '{}', created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(), UNIQUE(organization_id,code,version)
);
CREATE TABLE IF NOT EXISTS care_pathway_steps (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), pathway_id uuid NOT NULL REFERENCES care_pathways(id) ON DELETE CASCADE,
  sequence_no integer NOT NULL, step_code text NOT NULL, title text NOT NULL, step_type text NOT NULL, form_key text, rule_key text, required boolean NOT NULL DEFAULT false, configuration jsonb NOT NULL DEFAULT '{}', UNIQUE(pathway_id,sequence_no), UNIQUE(pathway_id,step_code)
);
CREATE TABLE IF NOT EXISTS immunization_schedule_rules (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), organization_id uuid REFERENCES organizations(id) ON DELETE CASCADE,
  jurisdiction text NOT NULL DEFAULT 'UG', vaccine_code text NOT NULL, vaccine_name text NOT NULL, dose_label text NOT NULL, minimum_age_days integer, recommended_age_days integer, interval_from_previous_days integer, eligibility jsonb NOT NULL DEFAULT '{}', source_guideline_id uuid REFERENCES clinical_guidelines(id) ON DELETE SET NULL, status text NOT NULL DEFAULT 'draft', effective_from date, effective_to date, created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS hie_connections (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  name text NOT NULL, jurisdiction text NOT NULL DEFAULT 'UG', protocol text NOT NULL, base_url text, status text NOT NULL DEFAULT 'disabled', capabilities jsonb NOT NULL DEFAULT '{}', credential_ref text, last_success_at timestamptz, last_error text, created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS hie_messages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE, connection_id uuid REFERENCES hie_connections(id) ON DELETE SET NULL,
  direction text NOT NULL, resource_type text, external_id text, correlation_id text, payload jsonb NOT NULL, status text NOT NULL DEFAULT 'queued', attempts integer NOT NULL DEFAULT 0, last_error text, available_at timestamptz NOT NULL DEFAULT now(), sent_at timestamptz, created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS reporting_mappings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), organization_id uuid REFERENCES organizations(id) ON DELETE CASCADE,
  jurisdiction text NOT NULL DEFAULT 'UG', reporting_system text NOT NULL, indicator_code text NOT NULL, indicator_name text NOT NULL, source_query jsonb NOT NULL DEFAULT '{}', denominator_query jsonb, numerator_query jsonb, period_granularity text NOT NULL DEFAULT 'monthly', version text, status text NOT NULL DEFAULT 'draft', source_url text, created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS offline_sync_queue (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE, device_id text NOT NULL, user_id uuid REFERENCES users(id), operation_id text NOT NULL, resource_type text NOT NULL, resource_id text, operation text NOT NULL, payload jsonb NOT NULL, base_version text, status text NOT NULL DEFAULT 'pending', conflict jsonb, attempts integer NOT NULL DEFAULT 0, created_at timestamptz NOT NULL DEFAULT now(), synced_at timestamptz, UNIQUE(organization_id,operation_id)
);
CREATE INDEX IF NOT EXISTS facility_identifiers_facility_idx ON facility_identifiers(facility_id,created_at DESC);
CREATE INDEX IF NOT EXISTS health_worker_facility_idx ON health_worker_profiles(facility_id,status);
CREATE INDEX IF NOT EXISTS terminology_lookup_idx ON terminology_concepts(system_uri,code);
CREATE INDEX IF NOT EXISTS guidelines_jurisdiction_domain_idx ON clinical_guidelines(jurisdiction,domain,status);
CREATE INDEX IF NOT EXISTS immunization_schedule_lookup_idx ON immunization_schedule_rules(jurisdiction,vaccine_code,status);
CREATE INDEX IF NOT EXISTS hie_messages_queue_idx ON hie_messages(organization_id,status,available_at);
CREATE INDEX IF NOT EXISTS offline_sync_pending_idx ON offline_sync_queue(organization_id,device_id,status,created_at);

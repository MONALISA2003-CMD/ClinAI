-- ClinAI 023: additive completion of governed intelligence, measurement, lifecycle and interoperability.
-- SAFETY: additive only. No DROP, TRUNCATE, DELETE, destructive rewrite or reset.
CREATE TABLE IF NOT EXISTS ai_capability_evaluations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), organization_id uuid REFERENCES organizations(id) ON DELETE CASCADE,
  capability_id text NOT NULL, version text NOT NULL DEFAULT '1.0', evaluation_type text NOT NULL,
  status text NOT NULL DEFAULT 'pending', sample_size integer, metrics jsonb NOT NULL DEFAULT '{}', findings jsonb NOT NULL DEFAULT '{}',
  reviewer_id uuid REFERENCES users(id) ON DELETE SET NULL, evaluated_at timestamptz, created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS ai_capability_evaluations_lookup_idx ON ai_capability_evaluations(organization_id,capability_id,status,created_at DESC);

CREATE TABLE IF NOT EXISTS ai_incidents (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  capability_id text, severity text NOT NULL DEFAULT 'moderate', status text NOT NULL DEFAULT 'open', incident_type text NOT NULL,
  patient_id uuid REFERENCES patients(id) ON DELETE SET NULL, description text NOT NULL, containment jsonb NOT NULL DEFAULT '{}',
  root_cause jsonb NOT NULL DEFAULT '{}', corrective_action jsonb NOT NULL DEFAULT '{}', owner_id uuid REFERENCES users(id) ON DELETE SET NULL,
  resolved_at timestamptz, created_by uuid REFERENCES users(id) ON DELETE SET NULL, created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS ai_incidents_org_idx ON ai_incidents(organization_id,status,severity,created_at DESC);

CREATE TABLE IF NOT EXISTS ai_model_lifecycle_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), organization_id uuid REFERENCES organizations(id) ON DELETE CASCADE,
  capability_id text, model_id text NOT NULL, event_type text NOT NULL, environment text NOT NULL DEFAULT 'production',
  outcome text NOT NULL DEFAULT 'observed', metrics jsonb NOT NULL DEFAULT '{}', notes text, actor_id uuid REFERENCES users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS ai_model_lifecycle_idx ON ai_model_lifecycle_events(organization_id,model_id,event_type,created_at DESC);

CREATE TABLE IF NOT EXISTS clinical_measure_results (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  measure_code text NOT NULL, period_start date NOT NULL, period_end date NOT NULL,
  numerator numeric NOT NULL DEFAULT 0, denominator numeric NOT NULL DEFAULT 0, value_numeric numeric,
  status text NOT NULL DEFAULT 'calculated', evidence jsonb NOT NULL DEFAULT '{}', calculated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(organization_id,measure_code,period_start,period_end)
);
CREATE INDEX IF NOT EXISTS clinical_measure_results_lookup_idx ON clinical_measure_results(organization_id,measure_code,period_end DESC);

CREATE TABLE IF NOT EXISTS cds_service_registry (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), organization_id uuid REFERENCES organizations(id) ON DELETE CASCADE,
  service_id text NOT NULL, title text NOT NULL, description text NOT NULL, hook text NOT NULL, endpoint text NOT NULL,
  prefetch jsonb NOT NULL DEFAULT '{}', status text NOT NULL DEFAULT 'active', version text NOT NULL DEFAULT '1.0', created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(organization_id,service_id,version)
);
CREATE INDEX IF NOT EXISTS cds_service_registry_lookup_idx ON cds_service_registry(organization_id,status,service_id);

CREATE TABLE IF NOT EXISTS smart_app_registrations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), organization_id uuid REFERENCES organizations(id) ON DELETE CASCADE,
  client_id text NOT NULL, app_name text NOT NULL, redirect_uris jsonb NOT NULL DEFAULT '[]', scopes jsonb NOT NULL DEFAULT '[]',
  launch_uri text, status text NOT NULL DEFAULT 'active', created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(organization_id,client_id)
);
CREATE INDEX IF NOT EXISTS smart_app_registrations_lookup_idx ON smart_app_registrations(organization_id,status);

INSERT INTO ai_capabilities (organization_id,capability_id,name,domain,risk_level,allowed_roles,allowed_modules,required_context,allowed_data,model_policy,evidence_policy,human_review,action_permissions,evaluation_policy,status,version)
VALUES
(NULL,'clinical-documentation','Clinical documentation assistance','documentation','level-3','["admin","doctor","nurse"]','["clinical-notes","encounters","referrals","discharge"]','["patient","currentEncounter","notes","diagnoses","orders","results"]','["minimum-necessary-clinical-record"]','{"patientDataRequiresAuthorizedClinicalProvider":true,"publicModelsBlockedByDefault":true}','{"sourceLinksRequired":true,"noInventedFacts":true}',true,'[]','{"preDeployment":true,"continuousMonitoring":true}','active','1.0'),
(NULL,'medication-safety','Medication safety review','medication-safety','level-1','["admin","doctor","nurse","pharmacist"]','["pharmacy","medication-reconciliation","orders"]','["medications","allergies","orders","observations"]','["minimum-necessary-clinical-record"]','{"deterministicFirst":true,"generativeInterpretationOnly":true}','{"evidenceRequired":true}',true,'[]','{"clinicalValidation":true}','active','1.0'),
(NULL,'diagnostic-support','Diagnostic support synthesis','diagnostic-support','level-3','["admin","doctor"]','["encounters","diagnoses","laboratory","imaging"]','["patient","encounters","diagnoses","observations","laboratory","imaging","medications","allergies"]','["minimum-necessary-clinical-record"]','{"deterministicSignalsFirst":true,"noAutonomousDiagnosis":true}','{"sourceLinksRequired":true,"uncertaintyRequired":true}',true,'[]','{"preDeployment":true,"continuousMonitoring":true}','active','1.0'),
(NULL,'population-intelligence','Population intelligence','population-health','level-2','["admin","manager","doctor","nurse"]','["population-health","surveillance","district-intelligence","analytics"]','["deidentified-operational-aggregates","populationIndicators"]','["minimum-necessary-aggregate-data"]','{"patientLevelDataRequiresAuthorization":true}','{"measureDefinitionsTraceable":true}',true,'[]','{"periodicReview":true}','active','1.0'),
(NULL,'ai-security-monitoring','AI security monitoring','security','level-2','["admin","manager"]','["security","ai","governance"]','["securityEvents","aiIncidents","modelLifecycle"]','["governance-metadata"]','{"noPatientDataRequired":true}','{"auditTrailRequired":true}',true,'[]','{"continuousMonitoring":true}','active','1.0')
ON CONFLICT (organization_id,capability_id,version) DO NOTHING;

INSERT INTO value_measure_definitions (organization_id,measure_code,name,domain,numerator_definition,denominator_definition,logic_language,jurisdiction,status,version)
VALUES
(NULL,'CLINAI-QUEUE-30M-REVIEW','Patients waiting more than 30 minutes','clinical-velocity','{"description":"Queue entries whose recorded waiting time exceeds 30 minutes"}','{"description":"Active queue entries with a recorded join time"}','CQL-compatible','UG','active','1.0'),
(NULL,'CLINAI-TASK-CLOSURE','Care task closure','care-coordination','{"description":"Care tasks completed during the measurement period"}','{"description":"Care tasks created during the measurement period"}','CQL-compatible','UG','active','1.0'),
(NULL,'CLINAI-CRITICAL-RESULT-RELEASE','Critical result release','patient-safety','{"description":"Critical results released after verification"}','{"description":"Critical results verified during the measurement period"}','CQL-compatible','UG','active','1.0')
ON CONFLICT (organization_id,measure_code,version) DO NOTHING;

CREATE TABLE IF NOT EXISTS smart_authorization_codes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), organization_id uuid REFERENCES organizations(id) ON DELETE CASCADE,
  user_id uuid REFERENCES users(id) ON DELETE SET NULL, client_id text NOT NULL, redirect_uri text NOT NULL, code_hash text NOT NULL UNIQUE,
  scope text, patient_id uuid REFERENCES patients(id) ON DELETE SET NULL, code_challenge text, expires_at timestamptz NOT NULL, used_at timestamptz
);
CREATE INDEX IF NOT EXISTS smart_authorization_codes_expiry_idx ON smart_authorization_codes(expires_at,used_at);
ALTER TABLE smart_authorization_codes ADD COLUMN IF NOT EXISTS user_role text;

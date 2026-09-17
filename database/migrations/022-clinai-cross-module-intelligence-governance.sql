-- ClinAI 022: additive cross-module intelligence + AI governance foundation.
-- SAFETY: additive only. No DROP, TRUNCATE, DELETE, destructive rewrite, or reset.

CREATE TABLE IF NOT EXISTS ai_capabilities (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid REFERENCES organizations(id) ON DELETE CASCADE,
  capability_id text NOT NULL,
  name text NOT NULL,
  domain text NOT NULL,
  risk_level text NOT NULL DEFAULT 'level-3',
  allowed_roles jsonb NOT NULL DEFAULT '[]',
  allowed_modules jsonb NOT NULL DEFAULT '[]',
  required_context jsonb NOT NULL DEFAULT '[]',
  allowed_data jsonb NOT NULL DEFAULT '[]',
  model_policy jsonb NOT NULL DEFAULT '{}',
  evidence_policy jsonb NOT NULL DEFAULT '{}',
  human_review boolean NOT NULL DEFAULT true,
  action_permissions jsonb NOT NULL DEFAULT '[]',
  evaluation_policy jsonb NOT NULL DEFAULT '{}',
  status text NOT NULL DEFAULT 'active',
  version text NOT NULL DEFAULT '1.0',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(organization_id, capability_id, version)
);
CREATE INDEX IF NOT EXISTS ai_capabilities_lookup_idx ON ai_capabilities(organization_id, status, domain);
CREATE UNIQUE INDEX IF NOT EXISTS ai_capabilities_global_unique_idx ON ai_capabilities(capability_id, version) WHERE organization_id IS NULL;

CREATE TABLE IF NOT EXISTS ai_risk_assessments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  capability_id text NOT NULL,
  patient_id uuid REFERENCES patients(id) ON DELETE SET NULL,
  risk_level text NOT NULL,
  risk_type text NOT NULL,
  status text NOT NULL DEFAULT 'open',
  source text NOT NULL DEFAULT 'deterministic',
  findings jsonb NOT NULL DEFAULT '{}',
  mitigations jsonb NOT NULL DEFAULT '[]',
  reviewer_id uuid REFERENCES users(id) ON DELETE SET NULL,
  reviewed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS ai_risk_assessments_org_status_idx ON ai_risk_assessments(organization_id, status, created_at DESC);
CREATE INDEX IF NOT EXISTS ai_risk_assessments_patient_idx ON ai_risk_assessments(organization_id, patient_id, created_at DESC);

CREATE TABLE IF NOT EXISTS ai_security_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  user_id uuid REFERENCES users(id) ON DELETE SET NULL,
  patient_id uuid REFERENCES patients(id) ON DELETE SET NULL,
  capability_id text,
  event_type text NOT NULL,
  severity text NOT NULL DEFAULT 'info',
  status text NOT NULL DEFAULT 'observed',
  source text NOT NULL DEFAULT 'ai-gateway',
  metadata jsonb NOT NULL DEFAULT '{}',
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS ai_security_events_org_idx ON ai_security_events(organization_id, severity, created_at DESC);
CREATE INDEX IF NOT EXISTS ai_security_events_patient_idx ON ai_security_events(organization_id, patient_id, created_at DESC);

CREATE TABLE IF NOT EXISTS care_gap_snapshots (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  patient_id uuid REFERENCES patients(id) ON DELETE CASCADE,
  gap_type text NOT NULL,
  severity text NOT NULL DEFAULT 'routine',
  status text NOT NULL DEFAULT 'open',
  source_module text NOT NULL,
  evidence jsonb NOT NULL DEFAULT '{}',
  detected_at timestamptz NOT NULL DEFAULT now(),
  closed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS care_gap_snapshots_open_idx ON care_gap_snapshots(organization_id, status, severity, detected_at DESC);
CREATE INDEX IF NOT EXISTS care_gap_snapshots_patient_idx ON care_gap_snapshots(organization_id, patient_id, status, detected_at DESC);

CREATE TABLE IF NOT EXISTS value_measure_definitions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid REFERENCES organizations(id) ON DELETE CASCADE,
  measure_code text NOT NULL,
  name text NOT NULL,
  domain text NOT NULL,
  numerator_definition jsonb NOT NULL DEFAULT '{}',
  denominator_definition jsonb NOT NULL DEFAULT '{}',
  logic_language text NOT NULL DEFAULT 'CQL-compatible',
  jurisdiction text NOT NULL DEFAULT 'UG',
  source_guideline_id uuid REFERENCES clinical_guidelines(id) ON DELETE SET NULL,
  status text NOT NULL DEFAULT 'draft',
  version text NOT NULL DEFAULT '1.0',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(organization_id, measure_code, version)
);
CREATE INDEX IF NOT EXISTS value_measure_definitions_lookup_idx ON value_measure_definitions(organization_id, domain, status);
CREATE UNIQUE INDEX IF NOT EXISTS value_measure_definitions_global_unique_idx ON value_measure_definitions(measure_code, version) WHERE organization_id IS NULL;

-- Seed global, non-patient-specific governance definitions. These are safe to re-run.
INSERT INTO ai_capabilities (organization_id, capability_id, name, domain, risk_level, allowed_roles, allowed_modules, required_context, allowed_data, model_policy, evidence_policy, human_review, action_permissions, evaluation_policy, status, version)
VALUES
(NULL,'patient-cross-module-synthesis','Patient cross-module synthesis','clinical-intelligence','level-3','["admin","doctor","nurse","pharmacist","lab","manager"]','["patients","patient-360","encounters","diagnoses","orders","laboratory","pharmacy","referrals","follow-up","care-tasks","care-gaps"]','["patient","currentEncounter","activeProblems","medications","allergies","observations","laboratory","imaging","referrals","carePlans","tasks","careGaps","riskSignals","longitudinalTrends","currentWorkflow"]','["minimum-necessary-clinical-record"]','{"patientDataRequiresAuthorizedClinicalProvider":true,"publicModelsBlockedByDefault":true}','{"sourceLinksRequired":true,"noInventedFacts":true}',true,'[]','{"preDeployment":true,"continuousMonitoring":true}','active','1.0'),
(NULL,'clinical-velocity','Clinical velocity intelligence','operations','level-2','["admin","manager","doctor","nurse"]','["clinical-velocity","command-center","analytics"]','["workflowEvents","queue","orders","results","referrals","followup","tasks"]','["deidentified-operational-aggregates"]','{"generativeNarrativeOptional":true}','{"metricDefinitionsTraceable":true}',true,'[]','{"periodicReview":true}','active','1.0'),
(NULL,'care-gap-detection','Care gap detection','value-based-care','level-2','["admin","manager","doctor","nurse","pharmacist"]','["care-gaps","patient-360","chronic-care","immunization","follow-up"]','["carePlans","immunizations","followups","referrals","tasks","results"]','["minimum-necessary-clinical-record"]','{"deterministicFirst":true}','{"evidenceRequired":true}',true,'[]','{"clinicalValidation":true}','active','1.0')
ON CONFLICT (organization_id, capability_id, version) DO NOTHING;

INSERT INTO value_measure_definitions (organization_id, measure_code, name, domain, numerator_definition, denominator_definition, logic_language, jurisdiction, status, version)
VALUES
(NULL,'CLINAI-REFERRAL-CLOSURE-7D','Referral closure within 7 days','care-coordination','{"description":"Completed referrals within seven days of creation"}','{"description":"Referrals with sufficient creation and completion timestamps"}','CQL-compatible','UG','active','1.0'),
(NULL,'CLINAI-FOLLOWUP-CLOSURE','Follow-up completion after due date','care-coordination','{"description":"Follow-ups completed by or before recorded due date"}','{"description":"Recorded follow-ups with a due date"}','CQL-compatible','UG','active','1.0'),
(NULL,'CLINAI-CRITICAL-RESULT-ACK','Critical result acknowledgement','patient-safety','{"description":"Critical results acknowledged/reviewed after availability"}','{"description":"Released critical results with acknowledgement evidence"}','CQL-compatible','UG','active','1.0')
ON CONFLICT (organization_id, measure_code, version) DO NOTHING;

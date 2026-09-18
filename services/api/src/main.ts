import Fastify from 'fastify';
import cors from '@fastify/cors';
import jwt from '@fastify/jwt';
import { z } from 'zod';
import { randomUUID, createHash } from 'node:crypto';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { dirname } from 'node:path';
import { Pool } from 'pg';
import { validateRecord, firstValidationMessage, isUuid, WORKFLOW_VALIDATION_CONTRACTS } from '../../../packages/domain/validation/index.js';
import { registerAI, registerPublicAI } from './ai/ai-orchestrator.js';
import { enqueueClinicalEvent, CLINICAL_EVENT_TYPES } from './events/clinicalEvents.js';
import { startClinicalEventWorker } from './events/clinicalEventWorker.js';
import { scanUnfinishedJourneys } from './events/clinicalJourneyEngine.js';
import { evaluateClinicalContext, SYNCHRONOUS_CDSS_RULES } from './intelligence/cdssGateway.js';
import { buildPatientIntelligenceLayer, buildClinicalVelocity, buildValueBasedCare, buildGovernanceSummary, buildAIGovernanceLifecycle, calculateClinicalMeasures, recordAICapabilityEvaluation, AI_CAPABILITY_CATALOG, buildPatient360Context, buildAISecurityIntelligence, buildAIRiskIntelligence, buildClinicalVelocityIntelligence, buildValueBasedCareIntelligence, recordSecurityEvent } from './intelligence/enterpriseIntelligence.js';
import moduleContractCatalog from '../../../packages/module-contracts/contracts.json' with { type: 'json' };
import { registerWorkstream2DomainRoutes } from './routes/workstream2Domains.js';
import { DOMAIN_MODULE_SPECS } from './domainModuleSpecs.js';

const MODULE_CONTRACTS = moduleContractCatalog.modules as any[];
const MODULE_CONTRACT_BY_ID:Record<string,any> = Object.fromEntries(MODULE_CONTRACTS.map(c=>[c.id,c]));

const app = Fastify({ logger: true });
const pool = process.env.DATABASE_URL ? new Pool({ connectionString: process.env.DATABASE_URL, max: 10 }) : null;
await app.register(cors, { origin: true });
await app.register(jwt, { secret: process.env.JWT_SECRET || 'clinai-local-development-secret' });

const modules = MODULE_CONTRACTS.map(c=>c.id) as string[];
type Mod = string;
type Row = Record<string, any>;
const file = process.env.CLINAI_STORE || '.clinai-data/store.json';
const store: Record<string, Row[]> = Object.fromEntries(modules.map(m => [m, []]));
const audit: Row[] = []; const events: Row[] = [];

async function loadStore(){ try { const raw=await readFile(file,'utf8'); const parsed=JSON.parse(raw); for(const m of modules) store[m]=Array.isArray(parsed.store?.[m])?parsed.store[m]:[]; audit.push(...(parsed.audit||[])); events.push(...(parsed.events||[])); } catch {} }
let persistTimer: NodeJS.Timeout|undefined;
function persist(){ clearTimeout(persistTimer); persistTimer=setTimeout(async()=>{await mkdir(dirname(file),{recursive:true}); await writeFile(file,JSON.stringify({store,audit:audit.slice(-2000),events:events.slice(-2000)},null,2));},100); }
await loadStore();

const PUBLIC_PREVIEW = process.env.CLINAI_PUBLIC_PREVIEW === 'true';
const PRODUCTION = process.env.NODE_ENV === 'production';
const DEMO_AUTH_ENABLED = process.env.NODE_ENV !== 'production' && process.env.CLINAI_ENABLE_DEMO_AUTH === 'true';
const PUBLIC_API_PATHS = new Set(['/api/public/feedback','/api/public/preview','/api/public/ai-assist','/api/public/ai-status','/api/public/ai-feedback','/api/public/test-dashboard','/api/public/test-patients','/api/public/test-modules','/api/public/test-intelligence','/api/public/test-session']);
const PUBLIC_TEST_DATA_ENABLED = process.env.CLINAI_PUBLIC_TEST_DATA !== 'false';
const WRITE_ROLES = new Set(['admin','doctor','nurse','lab','pharmacist','reception','cashier','inventory','manager']);
const READ_ONLY_ROLES = new Set(['viewer','analyst']);
function actor(req:any){ return req.user?.sub || 'system'; }
function org(req:any){ return req.user?.organizationId || null; }
function canWrite(req:any){ return Boolean(req.user?.publicSynthetic) || WRITE_ROLES.has(String(req.user?.role || '').toLowerCase()); }
function isPublicPath(path:string){ return PUBLIC_API_PATHS.has(path) || path.startsWith('/api/public/test-patients/') || path.startsWith('/api/public/test-modules/') || path.startsWith('/api/public/test-intelligence/'); }
const AI_NON_MUTATING_PATHS = new Set(['/api/ai/assist','/api/ai/patient-intelligence','/api/ai/compute','/api/ai/analyze','/api/ai/research','/api/ai/document','/api/ai/management-brief','/api/ai/cohort','/api/ai/role-briefing','/api/ai/attention','/api/ai/translate','/api/ai/language/analyze','/api/ai/router','/api/ai/feedback']);
function isClinicalMutation(req:any){
  const path=(req.raw.url||'/').split('?')[0];
  if(!['POST','PATCH','DELETE','PUT'].includes(req.method)) return false;
  if(AI_NON_MUTATING_PATHS.has(path)) return false;
  if(path==='/api/public/feedback') return false;
  if(path==='/api/auth/demo') return false;
  return path.startsWith('/api/');
}
function requireAuthorizedWrite(req:any){
  if(PUBLIC_PREVIEW && !req.user?.publicSynthetic) throw Object.assign(new Error('Public preview is read-only for non-synthetic workspaces.'),{statusCode:403,code:'PUBLIC_PREVIEW_READ_ONLY'});
  if(!canWrite(req)) throw Object.assign(new Error('Insufficient permission for this clinical or operational change.'),{statusCode:403,code:'WRITE_PERMISSION_REQUIRED'});
}
function now(){ return new Date().toISOString(); }

async function ensureRuntimeSchema(){
  if(!pool) return;
  await pool.query(`
    CREATE TABLE IF NOT EXISTS module_records (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
      module text NOT NULL,
      status text NOT NULL DEFAULT 'active',
      payload jsonb NOT NULL DEFAULT '{}',
      created_by uuid REFERENCES users(id),
      created_at timestamptz NOT NULL DEFAULT now(),
      updated_at timestamptz NOT NULL DEFAULT now()
    );
    CREATE INDEX IF NOT EXISTS idx_module_records_org_module_created ON module_records(organization_id,module,created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_module_records_payload_gin ON module_records USING gin(payload);
    DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='module_records_nonempty_payload') THEN ALTER TABLE module_records ADD CONSTRAINT module_records_nonempty_payload CHECK (jsonb_typeof(payload) = 'object' AND jsonb_object_length(payload) > 0) NOT VALID; END IF; END $$;
    CREATE TABLE IF NOT EXISTS emergency_cases (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(), organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
      patient_id uuid NOT NULL REFERENCES patients(id) ON DELETE CASCADE, encounter_id uuid REFERENCES encounters(id) ON DELETE SET NULL,
      acuity text NOT NULL DEFAULT 'urgent', chief_complaint text, triage_level text, status text NOT NULL DEFAULT 'arrived',
      arrival_at timestamptz NOT NULL DEFAULT now(), disposition text, disposition_at timestamptz, notes jsonb NOT NULL DEFAULT '{}', created_by uuid REFERENCES users(id), created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now()
    );
    CREATE TABLE IF NOT EXISTS admissions (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(), organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE, patient_id uuid NOT NULL REFERENCES patients(id) ON DELETE CASCADE,
      encounter_id uuid REFERENCES encounters(id) ON DELETE SET NULL, ward text, bed text, status text NOT NULL DEFAULT 'admitted', admitted_at timestamptz NOT NULL DEFAULT now(), discharged_at timestamptz, discharge_summary text, created_by uuid REFERENCES users(id), created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now()
    );
    CREATE TABLE IF NOT EXISTS nursing_assessments (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(), organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE, patient_id uuid NOT NULL REFERENCES patients(id) ON DELETE CASCADE, encounter_id uuid REFERENCES encounters(id) ON DELETE SET NULL,
      nurse_user_id uuid REFERENCES users(id), assessment_type text NOT NULL DEFAULT 'initial', findings jsonb NOT NULL DEFAULT '{}', pain_score numeric, risk_flags jsonb NOT NULL DEFAULT '[]', status text NOT NULL DEFAULT 'completed', created_at timestamptz NOT NULL DEFAULT now()
    );
    CREATE TABLE IF NOT EXISTS surgery_cases (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(), organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE, patient_id uuid NOT NULL REFERENCES patients(id) ON DELETE CASCADE, encounter_id uuid REFERENCES encounters(id) ON DELETE SET NULL,
      procedure_name text NOT NULL, scheduled_at timestamptz, status text NOT NULL DEFAULT 'scheduled', consent_confirmed boolean NOT NULL DEFAULT false, checklist jsonb NOT NULL DEFAULT '{}', surgeon_user_id uuid REFERENCES users(id), anaesthesia_plan text, notes jsonb NOT NULL DEFAULT '{}', created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now()
    );
    CREATE TABLE IF NOT EXISTS maternity_records (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(), organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE, patient_id uuid NOT NULL REFERENCES patients(id) ON DELETE CASCADE, encounter_id uuid REFERENCES encounters(id) ON DELETE SET NULL,
      pregnancy_id uuid, event_type text NOT NULL, gestational_age_weeks numeric, gravida integer, para integer, maternal_observations jsonb NOT NULL DEFAULT '{}', fetal_observations jsonb NOT NULL DEFAULT '{}', status text NOT NULL DEFAULT 'active', event_at timestamptz NOT NULL DEFAULT now(), notes text, created_at timestamptz NOT NULL DEFAULT now()
    );
    CREATE TABLE IF NOT EXISTS pediatric_assessments (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(), organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE, patient_id uuid NOT NULL REFERENCES patients(id) ON DELETE CASCADE, encounter_id uuid REFERENCES encounters(id) ON DELETE SET NULL,
      age_months integer, weight_kg numeric, height_cm numeric, muac_mm numeric, temperature numeric, respiratory_rate numeric, spo2 numeric, assessment jsonb NOT NULL DEFAULT '{}', imci_classification jsonb NOT NULL DEFAULT '{}', nutrition_status text, referral_required boolean NOT NULL DEFAULT false, created_at timestamptz NOT NULL DEFAULT now()
    );
    CREATE TABLE IF NOT EXISTS immunizations (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(), organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE, patient_id uuid NOT NULL REFERENCES patients(id) ON DELETE CASCADE,
      vaccine_code text NOT NULL, vaccine_name text NOT NULL, dose_number text, administered_at timestamptz NOT NULL DEFAULT now(), lot_number text, expiry_date date, route text, site text, vaccinator_user_id uuid REFERENCES users(id), status text NOT NULL DEFAULT 'administered', next_due_at timestamptz, notes text, created_at timestamptz NOT NULL DEFAULT now()
    );
    CREATE TABLE IF NOT EXISTS child_health_visits (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE, patient_id uuid NOT NULL REFERENCES patients(id) ON DELETE CASCADE, encounter_id uuid REFERENCES encounters(id) ON DELETE SET NULL, visit_date timestamptz NOT NULL DEFAULT now(), age_days integer, age_months numeric, weight_kg numeric, length_height_cm numeric, head_circumference_cm numeric, muac_mm numeric, temperature_c numeric, respiratory_rate numeric, spo2 numeric, feeding_assessment jsonb NOT NULL DEFAULT '{}', developmental_assessment jsonb NOT NULL DEFAULT '{}', danger_signs jsonb NOT NULL DEFAULT '{}', clinical_assessment jsonb NOT NULL DEFAULT '{}', plan jsonb NOT NULL DEFAULT '{}', referral_required boolean NOT NULL DEFAULT false, source_guideline text, created_by uuid REFERENCES users(id), created_at timestamptz NOT NULL DEFAULT now());
    CREATE INDEX IF NOT EXISTS child_health_visits_patient_idx ON child_health_visits(patient_id, visit_date DESC);
    CREATE TABLE IF NOT EXISTS child_growth_measurements (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE, patient_id uuid NOT NULL REFERENCES patients(id) ON DELETE CASCADE, measured_at timestamptz NOT NULL DEFAULT now(), age_days integer, weight_kg numeric, length_height_cm numeric, head_circumference_cm numeric, muac_mm numeric, z_scores jsonb NOT NULL DEFAULT '{}', growth_interpretation text, source_standard text, created_by uuid REFERENCES users(id), created_at timestamptz NOT NULL DEFAULT now());
    CREATE INDEX IF NOT EXISTS child_growth_patient_idx ON child_growth_measurements(patient_id, measured_at DESC);
    CREATE TABLE IF NOT EXISTS child_imci_assessments (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE, patient_id uuid NOT NULL REFERENCES patients(id) ON DELETE CASCADE, encounter_id uuid REFERENCES encounters(id) ON DELETE SET NULL, assessed_at timestamptz NOT NULL DEFAULT now(), age_months numeric, general_danger_signs jsonb NOT NULL DEFAULT '{}', cough_breathing jsonb NOT NULL DEFAULT '{}', diarrhoea jsonb NOT NULL DEFAULT '{}', fever jsonb NOT NULL DEFAULT '{}', ear_problem jsonb NOT NULL DEFAULT '{}', nutrition_anemia jsonb NOT NULL DEFAULT '{}', immunization_status jsonb NOT NULL DEFAULT '{}', feeding_status jsonb NOT NULL DEFAULT '{}', classifications jsonb NOT NULL DEFAULT '{}', plan jsonb NOT NULL DEFAULT '{}', referral_required boolean NOT NULL DEFAULT false, source_guideline text, created_by uuid REFERENCES users(id), created_at timestamptz NOT NULL DEFAULT now());
    CREATE INDEX IF NOT EXISTS child_imci_patient_idx ON child_imci_assessments(patient_id, assessed_at DESC);
    CREATE TABLE IF NOT EXISTS immunization_reviews (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE, patient_id uuid NOT NULL REFERENCES patients(id) ON DELETE CASCADE, reviewed_at timestamptz NOT NULL DEFAULT now(), jurisdiction text NOT NULL DEFAULT 'UG', due_items jsonb NOT NULL DEFAULT '[]', overdue_items jsonb NOT NULL DEFAULT '[]', completed_items jsonb NOT NULL DEFAULT '[]', next_review_at timestamptz, source_guideline text, created_by uuid REFERENCES users(id), created_at timestamptz NOT NULL DEFAULT now());
    CREATE INDEX IF NOT EXISTS immunization_reviews_patient_idx ON immunization_reviews(patient_id, reviewed_at DESC);
    CREATE TABLE IF NOT EXISTS child_care_gaps (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE, patient_id uuid NOT NULL REFERENCES patients(id) ON DELETE CASCADE, gap_type text NOT NULL, status text NOT NULL DEFAULT 'open' CHECK (status IN ('open','acknowledged','resolved','dismissed')), priority text NOT NULL DEFAULT 'routine' CHECK (priority IN ('routine','high','urgent')), title text NOT NULL, description text, evidence jsonb NOT NULL DEFAULT '{}', source_guideline text, detected_at timestamptz NOT NULL DEFAULT now(), resolved_at timestamptz, resolved_by uuid REFERENCES users(id), created_at timestamptz NOT NULL DEFAULT now());
    CREATE INDEX IF NOT EXISTS child_care_gaps_patient_idx ON child_care_gaps(patient_id,status,detected_at DESC);
    CREATE TABLE IF NOT EXISTS immunization_catchup_plans (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE, patient_id uuid NOT NULL REFERENCES patients(id) ON DELETE CASCADE, jurisdiction text NOT NULL DEFAULT 'UG', status text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','active','completed','cancelled')), plan_items jsonb NOT NULL DEFAULT '[]', rationale jsonb NOT NULL DEFAULT '{}', source_guideline text, clinician_review_required boolean NOT NULL DEFAULT true, reviewed_by uuid REFERENCES users(id), reviewed_at timestamptz, created_by uuid REFERENCES users(id), created_at timestamptz NOT NULL DEFAULT now());
    CREATE INDEX IF NOT EXISTS immunization_catchup_patient_idx ON immunization_catchup_plans(patient_id,status,created_at DESC);
    CREATE TABLE IF NOT EXISTS care_graph_edges (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE, patient_id uuid NOT NULL REFERENCES patients(id) ON DELETE CASCADE, source_type text NOT NULL, source_id uuid, target_type text NOT NULL, target_id uuid, relationship text NOT NULL, metadata jsonb NOT NULL DEFAULT '{}', created_at timestamptz NOT NULL DEFAULT now());
    CREATE INDEX IF NOT EXISTS care_graph_patient_idx ON care_graph_edges(patient_id,created_at DESC);
    CREATE TABLE IF NOT EXISTS chronic_care_records (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(), organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE, patient_id uuid NOT NULL REFERENCES patients(id) ON DELETE CASCADE, encounter_id uuid REFERENCES encounters(id) ON DELETE SET NULL,
      condition_code text NOT NULL, condition_name text NOT NULL, status text NOT NULL DEFAULT 'active', goals jsonb NOT NULL DEFAULT '[]', measures jsonb NOT NULL DEFAULT '{}', medications jsonb NOT NULL DEFAULT '[]', next_review_at timestamptz, risk_level text, care_plan jsonb NOT NULL DEFAULT '{}', created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now()
    );
    CREATE TABLE IF NOT EXISTS telemedicine_sessions (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(), organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE, patient_id uuid NOT NULL REFERENCES patients(id) ON DELETE CASCADE, appointment_id uuid REFERENCES appointments(id) ON DELETE SET NULL, encounter_id uuid REFERENCES encounters(id) ON DELETE SET NULL,
      scheduled_at timestamptz NOT NULL, status text NOT NULL DEFAULT 'scheduled', meeting_url text, identity_verified boolean NOT NULL DEFAULT false, consent_confirmed boolean NOT NULL DEFAULT false, started_at timestamptz, ended_at timestamptz, provider_user_id uuid REFERENCES users(id), notes jsonb NOT NULL DEFAULT '{}', created_at timestamptz NOT NULL DEFAULT now()
    );
    CREATE TABLE IF NOT EXISTS remote_monitoring_readings (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(), organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE, patient_id uuid NOT NULL REFERENCES patients(id) ON DELETE CASCADE,
      device_id text, metric text NOT NULL, value_numeric numeric, unit text, measured_at timestamptz NOT NULL, source text NOT NULL DEFAULT 'patient', validation_status text NOT NULL DEFAULT 'unvalidated', alert_status text NOT NULL DEFAULT 'none', metadata jsonb NOT NULL DEFAULT '{}', created_at timestamptz NOT NULL DEFAULT now()
    );
    CREATE INDEX IF NOT EXISTS emergency_cases_org_idx ON emergency_cases(organization_id, status, arrival_at DESC);
    CREATE INDEX IF NOT EXISTS admissions_org_idx ON admissions(organization_id, status, admitted_at DESC);
    CREATE INDEX IF NOT EXISTS nursing_assessments_patient_idx ON nursing_assessments(patient_id, created_at DESC);
    CREATE INDEX IF NOT EXISTS surgery_cases_org_idx ON surgery_cases(organization_id, status, scheduled_at DESC);
    CREATE INDEX IF NOT EXISTS maternity_patient_idx ON maternity_records(patient_id, event_at DESC);
    CREATE INDEX IF NOT EXISTS pediatric_patient_idx ON pediatric_assessments(patient_id, created_at DESC);
    CREATE INDEX IF NOT EXISTS immunizations_patient_idx ON immunizations(patient_id, administered_at DESC);
    CREATE INDEX IF NOT EXISTS chronic_patient_idx ON chronic_care_records(patient_id, status, next_review_at);
    CREATE INDEX IF NOT EXISTS telemedicine_org_idx ON telemedicine_sessions(organization_id, status, scheduled_at);
    CREATE INDEX IF NOT EXISTS remote_monitoring_patient_idx ON remote_monitoring_readings(patient_id, metric, measured_at DESC);
    ALTER TABLE notifications ADD COLUMN IF NOT EXISTS created_at timestamptz NOT NULL DEFAULT now();
    CREATE INDEX IF NOT EXISTS idx_idempotency_expires ON idempotency_keys(organization_id, expires_at);
    CREATE TABLE IF NOT EXISTS patient_identifiers (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
      patient_id uuid NOT NULL REFERENCES patients(id) ON DELETE CASCADE,
      system text NOT NULL,
      value text NOT NULL,
      identifier_type text,
      use text NOT NULL DEFAULT 'usual',
      period_start timestamptz,
      period_end timestamptz,
      created_at timestamptz NOT NULL DEFAULT now(),
      UNIQUE(organization_id, system, value)
    );
    CREATE INDEX IF NOT EXISTS patient_identifiers_patient_idx ON patient_identifiers(patient_id, created_at DESC);
    CREATE INDEX IF NOT EXISTS patient_identifiers_lookup_idx ON patient_identifiers(organization_id, system, value);
    CREATE TABLE IF NOT EXISTS facility_identifiers (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(), organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
      facility_id uuid NOT NULL REFERENCES facilities(id) ON DELETE CASCADE, system text NOT NULL, value text NOT NULL, identifier_type text,
      period_start timestamptz, period_end timestamptz, created_at timestamptz NOT NULL DEFAULT now(),
      UNIQUE(organization_id, system, value)
    );
    CREATE INDEX IF NOT EXISTS facility_identifiers_facility_idx ON facility_identifiers(facility_id, created_at DESC);
    CREATE TABLE IF NOT EXISTS health_worker_profiles (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(), organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
      user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE, facility_id uuid REFERENCES facilities(id) ON DELETE SET NULL,
      cadre text NOT NULL, profession text, registration_system text, registration_number text, specialty text, status text NOT NULL DEFAULT 'active',
      verified_at timestamptz, metadata jsonb NOT NULL DEFAULT '{}', created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
      UNIQUE(organization_id, user_id)
    );
    CREATE INDEX IF NOT EXISTS health_worker_facility_idx ON health_worker_profiles(facility_id, status);
    CREATE TABLE IF NOT EXISTS terminology_concepts (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(), organization_id uuid REFERENCES organizations(id) ON DELETE CASCADE,
      system_uri text NOT NULL, code text NOT NULL, display text NOT NULL, version text, status text NOT NULL DEFAULT 'active',
      source text, source_url text, properties jsonb NOT NULL DEFAULT '{}', created_at timestamptz NOT NULL DEFAULT now()
    );
    CREATE INDEX IF NOT EXISTS terminology_lookup_idx ON terminology_concepts(system_uri, code);
    CREATE UNIQUE INDEX IF NOT EXISTS terminology_unique_version_idx ON terminology_concepts(organization_id, system_uri, code, COALESCE(version,''));
    CREATE TABLE IF NOT EXISTS clinical_guidelines (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(), organization_id uuid REFERENCES organizations(id) ON DELETE CASCADE,
      jurisdiction text NOT NULL, domain text NOT NULL, title text NOT NULL, publisher text NOT NULL, version text,
      source_url text, effective_from date, effective_to date, status text NOT NULL DEFAULT 'draft',
      content_hash text, machine_readable boolean NOT NULL DEFAULT false, metadata jsonb NOT NULL DEFAULT '{}', created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now()
    );
    CREATE INDEX IF NOT EXISTS guidelines_jurisdiction_domain_idx ON clinical_guidelines(jurisdiction, domain, status);
    CREATE TABLE IF NOT EXISTS clinical_guideline_rules (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(), guideline_id uuid NOT NULL REFERENCES clinical_guidelines(id) ON DELETE CASCADE,
      rule_key text NOT NULL, description text, input_schema jsonb NOT NULL DEFAULT '{}', logic jsonb NOT NULL DEFAULT '{}',
      output_schema jsonb NOT NULL DEFAULT '{}', priority integer NOT NULL DEFAULT 100, active boolean NOT NULL DEFAULT true, created_at timestamptz NOT NULL DEFAULT now(),
      UNIQUE(guideline_id, rule_key)
    );
    CREATE TABLE IF NOT EXISTS care_pathways (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(), organization_id uuid REFERENCES organizations(id) ON DELETE CASCADE,
      code text NOT NULL, name text NOT NULL, domain text NOT NULL, jurisdiction text NOT NULL DEFAULT 'UG', version text NOT NULL,
      status text NOT NULL DEFAULT 'draft', source_guideline_id uuid REFERENCES clinical_guidelines(id) ON DELETE SET NULL, metadata jsonb NOT NULL DEFAULT '{}',
      created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(), UNIQUE(organization_id, code, version)
    );
    CREATE TABLE IF NOT EXISTS care_pathway_steps (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(), pathway_id uuid NOT NULL REFERENCES care_pathways(id) ON DELETE CASCADE,
      sequence_no integer NOT NULL, step_code text NOT NULL, title text NOT NULL, step_type text NOT NULL,
      form_key text, rule_key text, required boolean NOT NULL DEFAULT false, configuration jsonb NOT NULL DEFAULT '{}',
      UNIQUE(pathway_id, sequence_no), UNIQUE(pathway_id, step_code)
    );
    CREATE TABLE IF NOT EXISTS immunization_schedule_rules (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(), organization_id uuid REFERENCES organizations(id) ON DELETE CASCADE,
      jurisdiction text NOT NULL DEFAULT 'UG', vaccine_code text NOT NULL, vaccine_name text NOT NULL, dose_label text NOT NULL,
      minimum_age_days integer, recommended_age_days integer, interval_from_previous_days integer, eligibility jsonb NOT NULL DEFAULT '{}',
      source_guideline_id uuid REFERENCES clinical_guidelines(id) ON DELETE SET NULL, status text NOT NULL DEFAULT 'draft', effective_from date, effective_to date,
      created_at timestamptz NOT NULL DEFAULT now()
    );
    CREATE INDEX IF NOT EXISTS immunization_schedule_lookup_idx ON immunization_schedule_rules(jurisdiction, vaccine_code, status);
    CREATE TABLE IF NOT EXISTS hie_connections (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(), organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
      name text NOT NULL, jurisdiction text NOT NULL DEFAULT 'UG', protocol text NOT NULL, base_url text, status text NOT NULL DEFAULT 'disabled',
      capabilities jsonb NOT NULL DEFAULT '{}', credential_ref text, last_success_at timestamptz, last_error text, created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now()
    );
    CREATE TABLE IF NOT EXISTS hie_messages (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(), organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE, connection_id uuid REFERENCES hie_connections(id) ON DELETE SET NULL,
      direction text NOT NULL, resource_type text, external_id text, correlation_id text, payload jsonb NOT NULL, status text NOT NULL DEFAULT 'queued',
      attempts integer NOT NULL DEFAULT 0, last_error text, available_at timestamptz NOT NULL DEFAULT now(), sent_at timestamptz, created_at timestamptz NOT NULL DEFAULT now()
    );
    CREATE INDEX IF NOT EXISTS hie_messages_queue_idx ON hie_messages(organization_id, status, available_at);
    CREATE TABLE IF NOT EXISTS reporting_mappings (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(), organization_id uuid REFERENCES organizations(id) ON DELETE CASCADE,
      jurisdiction text NOT NULL DEFAULT 'UG', reporting_system text NOT NULL, indicator_code text NOT NULL, indicator_name text NOT NULL,
      source_query jsonb NOT NULL DEFAULT '{}', denominator_query jsonb, numerator_query jsonb, period_granularity text NOT NULL DEFAULT 'monthly',
      version text, status text NOT NULL DEFAULT 'draft', source_url text, created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
      UNIQUE(organization_id, reporting_system, indicator_code, version)
    );
    CREATE TABLE IF NOT EXISTS offline_sync_queue (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(), organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
      device_id text NOT NULL, user_id uuid REFERENCES users(id), operation_id text NOT NULL, resource_type text NOT NULL, resource_id text,
      operation text NOT NULL, payload jsonb NOT NULL, base_version text, status text NOT NULL DEFAULT 'pending', conflict jsonb, attempts integer NOT NULL DEFAULT 0,
      created_at timestamptz NOT NULL DEFAULT now(), synced_at timestamptz, UNIQUE(organization_id, operation_id)
    );
    CREATE INDEX IF NOT EXISTS offline_sync_pending_idx ON offline_sync_queue(organization_id, device_id, status, created_at);

    -- V8 Uganda maternal, newborn and postnatal clinical content
    CREATE TABLE IF NOT EXISTS maternal_care_records (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(), organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
      patient_id uuid NOT NULL REFERENCES patients(id) ON DELETE CASCADE, gravida integer, para integer, lmp date, estimated_due_date date,
      gestational_age_weeks numeric, risk_status text NOT NULL DEFAULT 'not-assessed', risk_factors jsonb NOT NULL DEFAULT '{}',
      birth_plan jsonb NOT NULL DEFAULT '{}', source_guideline text, created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now()
    );
    CREATE INDEX IF NOT EXISTS maternal_records_patient_idx ON maternal_care_records(patient_id, created_at DESC);
    CREATE TABLE IF NOT EXISTS maternal_care_contacts (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(), organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
      patient_id uuid NOT NULL REFERENCES patients(id) ON DELETE CASCADE, maternal_record_id uuid REFERENCES maternal_care_records(id) ON DELETE SET NULL,
      contact_number integer NOT NULL, contact_date timestamptz NOT NULL, gestational_age_weeks numeric,
      blood_pressure jsonb NOT NULL DEFAULT '{}', symphysio_fundal_height numeric, fetal_assessment jsonb NOT NULL DEFAULT '{}',
      laboratory jsonb NOT NULL DEFAULT '{}', preventive_care jsonb NOT NULL DEFAULT '{}', counselling jsonb NOT NULL DEFAULT '{}',
      danger_signs jsonb NOT NULL DEFAULT '{}', assessment text, plan text, referral_required boolean NOT NULL DEFAULT false,
      source_guideline text, created_at timestamptz NOT NULL DEFAULT now()
    );
    CREATE INDEX IF NOT EXISTS maternal_contacts_patient_idx ON maternal_care_contacts(patient_id, contact_date DESC);
    CREATE TABLE IF NOT EXISTS birth_events (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(), organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
      mother_patient_id uuid NOT NULL REFERENCES patients(id) ON DELETE CASCADE, birth_datetime timestamptz NOT NULL, mode text NOT NULL,
      place_type text, facility_id uuid REFERENCES facilities(id) ON DELETE SET NULL, gestational_age_weeks numeric,
      multiple_birth boolean NOT NULL DEFAULT false, complications jsonb NOT NULL DEFAULT '{}', outcome text, referral jsonb NOT NULL DEFAULT '{}',
      source_guideline text, created_at timestamptz NOT NULL DEFAULT now()
    );
    CREATE INDEX IF NOT EXISTS birth_events_mother_idx ON birth_events(mother_patient_id, birth_datetime DESC);
    CREATE TABLE IF NOT EXISTS newborn_records (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(), organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
      patient_id uuid REFERENCES patients(id) ON DELETE SET NULL, mother_patient_id uuid NOT NULL REFERENCES patients(id) ON DELETE CASCADE,
      birth_event_id uuid REFERENCES birth_events(id) ON DELETE SET NULL, sex text, birth_weight_grams numeric, gestational_age_weeks numeric,
      apgar jsonb NOT NULL DEFAULT '{}', feeding jsonb NOT NULL DEFAULT '{}', resuscitation jsonb NOT NULL DEFAULT '{}',
      danger_signs jsonb NOT NULL DEFAULT '{}', birth_defects_screening jsonb NOT NULL DEFAULT '{}', kangaroo_care jsonb NOT NULL DEFAULT '{}',
      referral jsonb NOT NULL DEFAULT '{}', source_guideline text, created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now()
    );
    CREATE INDEX IF NOT EXISTS newborns_mother_idx ON newborn_records(mother_patient_id, created_at DESC);
    CREATE TABLE IF NOT EXISTS postnatal_contacts (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(), organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
      patient_id uuid NOT NULL REFERENCES patients(id) ON DELETE CASCADE, newborn_id uuid REFERENCES newborn_records(id) ON DELETE SET NULL,
      contact_date timestamptz NOT NULL, contact_timing text NOT NULL, maternal_assessment jsonb NOT NULL DEFAULT '{}',
      newborn_assessment jsonb NOT NULL DEFAULT '{}', feeding_support jsonb NOT NULL DEFAULT '{}', family_planning jsonb NOT NULL DEFAULT '{}',
      mental_health jsonb NOT NULL DEFAULT '{}', danger_signs jsonb NOT NULL DEFAULT '{}', referral_required boolean NOT NULL DEFAULT false,
      plan text, source_guideline text, created_at timestamptz NOT NULL DEFAULT now()
    );
    CREATE INDEX IF NOT EXISTS pnc_contacts_patient_idx ON postnatal_contacts(patient_id, contact_date DESC);
  `);
}
await ensureRuntimeSchema();
if(pool){
  await pool.query(`ALTER TABLE notifications ADD COLUMN IF NOT EXISTS created_at timestamptz NOT NULL DEFAULT now()`);
  await pool.query(`CREATE INDEX IF NOT EXISTS notifications_patient_idx ON notifications(patient_id, created_at DESC)`);
  await pool.query(`CREATE TABLE IF NOT EXISTS surveillance_events (
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
CREATE TABLE IF NOT EXISTS public_health_investigations (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE, surveillance_case_id uuid REFERENCES surveillance_cases(id) ON DELETE SET NULL, event_id uuid REFERENCES surveillance_events(id) ON DELETE SET NULL, investigation_type text NOT NULL, status text NOT NULL DEFAULT 'open' CHECK(status IN ('open','under-review','completed','closed')), lead_user_id uuid REFERENCES users(id), started_at timestamptz NOT NULL DEFAULT now(), completed_at timestamptz, findings jsonb NOT NULL DEFAULT '{}', verification jsonb NOT NULL DEFAULT '{}', risk_assessment jsonb NOT NULL DEFAULT '{}', source_guideline text, created_by uuid REFERENCES users(id), created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE IF NOT EXISTS public_health_contacts (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE, investigation_id uuid REFERENCES public_health_investigations(id) ON DELETE CASCADE, patient_id uuid REFERENCES patients(id) ON DELETE SET NULL, contact_type text NOT NULL, exposure_start timestamptz, exposure_end timestamptz, relationship text, location jsonb NOT NULL DEFAULT '{}', risk_level text NOT NULL DEFAULT 'routine', status text NOT NULL DEFAULT 'identified', notes jsonb NOT NULL DEFAULT '{}', created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE IF NOT EXISTS public_health_response_tasks (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE, investigation_id uuid REFERENCES public_health_investigations(id) ON DELETE CASCADE, event_id uuid REFERENCES surveillance_events(id) ON DELETE SET NULL, task_type text NOT NULL, title text NOT NULL, priority text NOT NULL DEFAULT 'routine', status text NOT NULL DEFAULT 'pending', assigned_to uuid REFERENCES users(id), due_at timestamptz, completed_at timestamptz, escalation_level integer NOT NULL DEFAULT 0, evidence jsonb NOT NULL DEFAULT '{}', requires_human_approval boolean NOT NULL DEFAULT true, created_by uuid REFERENCES users(id), created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE IF NOT EXISTS public_health_alerts (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE, alert_type text NOT NULL, severity text NOT NULL DEFAULT 'high', title text NOT NULL, message text NOT NULL, source_event_id uuid REFERENCES surveillance_events(id) ON DELETE SET NULL, source_investigation_id uuid REFERENCES public_health_investigations(id) ON DELETE SET NULL, status text NOT NULL DEFAULT 'pending-review', generated_reason jsonb NOT NULL DEFAULT '{}', reviewed_by uuid REFERENCES users(id), reviewed_at timestamptz, created_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE IF NOT EXISTS mortality_surveillance_records (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE, patient_id uuid REFERENCES patients(id) ON DELETE SET NULL, facility_id uuid REFERENCES facilities(id) ON DELETE SET NULL, death_datetime timestamptz NOT NULL, place_of_death text, immediate_cause text, underlying_cause text, contributing_conditions jsonb NOT NULL DEFAULT '[]', maternal_death boolean NOT NULL DEFAULT false, neonatal_death boolean NOT NULL DEFAULT false, review_status text NOT NULL DEFAULT 'pending', review_findings jsonb NOT NULL DEFAULT '{}', source_guideline text, created_by uuid REFERENCES users(id), created_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE IF NOT EXISTS districts (  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,  name text NOT NULL, code text, region text, status text NOT NULL DEFAULT 'active', metadata jsonb NOT NULL DEFAULT '{}', created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(), UNIQUE(organization_id,name) ); CREATE TABLE IF NOT EXISTS district_facility_links (  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,  district_id uuid NOT NULL REFERENCES districts(id) ON DELETE CASCADE, facility_id uuid NOT NULL REFERENCES facilities(id) ON DELETE CASCADE,  relationship text NOT NULL DEFAULT 'serves', effective_from timestamptz, effective_to timestamptz, metadata jsonb NOT NULL DEFAULT '{}', created_at timestamptz NOT NULL DEFAULT now(), UNIQUE(organization_id,district_id,facility_id) ); CREATE TABLE IF NOT EXISTS facility_service_capacity (  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,  facility_id uuid NOT NULL REFERENCES facilities(id) ON DELETE CASCADE, service_code text NOT NULL, service_name text NOT NULL,  status text NOT NULL DEFAULT 'available' CHECK(status IN ('available','limited','unavailable','planned')),  capacity_total integer, capacity_available integer, wait_minutes integer, operating_hours jsonb NOT NULL DEFAULT '{}', metadata jsonb NOT NULL DEFAULT '{}', observed_at timestamptz NOT NULL DEFAULT now(), created_at timestamptz NOT NULL DEFAULT now() ); CREATE INDEX IF NOT EXISTS facility_service_capacity_idx ON facility_service_capacity(organization_id,facility_id,service_code,observed_at DESC); CREATE TABLE IF NOT EXISTS facility_resource_status (  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,  facility_id uuid NOT NULL REFERENCES facilities(id) ON DELETE CASCADE, resource_type text NOT NULL, resource_name text NOT NULL,  status text NOT NULL DEFAULT 'available' CHECK(status IN ('available','low','critical','unavailable','unknown')),  quantity numeric, unit text, threshold numeric, notes jsonb NOT NULL DEFAULT '{}', observed_at timestamptz NOT NULL DEFAULT now(), created_at timestamptz NOT NULL DEFAULT now() ); CREATE INDEX IF NOT EXISTS facility_resource_status_idx ON facility_resource_status(organization_id,facility_id,status,observed_at DESC); CREATE TABLE IF NOT EXISTS workforce_capacity_snapshots (  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,  facility_id uuid REFERENCES facilities(id) ON DELETE CASCADE, district_id uuid REFERENCES districts(id) ON DELETE CASCADE,  cadre text NOT NULL, scheduled_count integer NOT NULL DEFAULT 0, available_count integer NOT NULL DEFAULT 0, on_duty_count integer NOT NULL DEFAULT 0,  vacancy_count integer NOT NULL DEFAULT 0, snapshot_at timestamptz NOT NULL DEFAULT now(), metadata jsonb NOT NULL DEFAULT '{}' ); CREATE INDEX IF NOT EXISTS workforce_capacity_idx ON workforce_capacity_snapshots(organization_id,facility_id,cadre,snapshot_at DESC); CREATE TABLE IF NOT EXISTS facility_operational_incidents (  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,  facility_id uuid REFERENCES facilities(id) ON DELETE SET NULL, district_id uuid REFERENCES districts(id) ON DELETE SET NULL,  incident_type text NOT NULL, severity text NOT NULL DEFAULT 'moderate' CHECK(severity IN ('low','moderate','high','critical')),  status text NOT NULL DEFAULT 'open' CHECK(status IN ('open','acknowledged','mitigating','resolved','closed')),  title text NOT NULL, description text, started_at timestamptz NOT NULL DEFAULT now(), resolved_at timestamptz,  response_owner uuid REFERENCES users(id), impact jsonb NOT NULL DEFAULT '{}', created_by uuid REFERENCES users(id), created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now() ); CREATE INDEX IF NOT EXISTS facility_incidents_idx ON facility_operational_incidents(organization_id,status,severity,started_at DESC); CREATE TABLE IF NOT EXISTS facility_performance_snapshots (  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,  facility_id uuid REFERENCES facilities(id) ON DELETE CASCADE, district_id uuid REFERENCES districts(id) ON DELETE CASCADE,  period_start date NOT NULL, period_end date NOT NULL, indicator_code text NOT NULL, indicator_name text NOT NULL,  numerator numeric, denominator numeric, value_numeric numeric, unit text, quality_status text NOT NULL DEFAULT 'unreviewed', dimensions jsonb NOT NULL DEFAULT '{}', source text, created_at timestamptz NOT NULL DEFAULT now() ); CREATE INDEX IF NOT EXISTS facility_performance_idx ON facility_performance_snapshots(organization_id,period_end DESC,indicator_code,facility_id); CREATE TABLE IF NOT EXISTS referral_network_nodes (  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,  from_facility_id uuid NOT NULL REFERENCES facilities(id) ON DELETE CASCADE, to_facility_id uuid NOT NULL REFERENCES facilities(id) ON DELETE CASCADE,  service_code text, status text NOT NULL DEFAULT 'active' CHECK(status IN ('active','restricted','inactive')),  typical_wait_minutes integer, transport_notes jsonb NOT NULL DEFAULT '{}', metadata jsonb NOT NULL DEFAULT '{}', created_at timestamptz NOT NULL DEFAULT now(), UNIQUE(organization_id,from_facility_id,to_facility_id,service_code) ); CREATE INDEX IF NOT EXISTS referral_network_idx ON referral_network_nodes(organization_id,from_facility_id,status);
`);
}

async function ensureDemoTenant(){
  if(!pool) return null;
  const client=await pool.connect();
  try{
    await client.query('BEGIN');
    let orgRow=await client.query('SELECT id FROM organizations WHERE name=$1 LIMIT 1',['ClinAI Demo Organization']);
    let organizationId:string;
    if(orgRow.rowCount){ organizationId=orgRow.rows[0].id; }
    else {
      const r=await client.query('INSERT INTO organizations(name,status) VALUES($1,$2) RETURNING id',['ClinAI Demo Organization','active']);
      organizationId=r.rows[0].id;
    }
    let facility=await client.query('SELECT id FROM facilities WHERE organization_id=$1 ORDER BY created_at LIMIT 1',[organizationId]);
    if(!facility.rowCount) await client.query('INSERT INTO facilities(organization_id,name,type) VALUES($1,$2,$3)',[organizationId,'Main Facility','clinic']);
    let user=await client.query('SELECT id FROM users WHERE firebase_uid=$1 LIMIT 1',['demo-user']);
    let userId:string;
    if(user.rowCount) userId=user.rows[0].id;
    else { const r=await client.query('INSERT INTO users(firebase_uid,email,display_name) VALUES($1,$2,$3) RETURNING id',['demo-user','demo@clinai.local','ClinAI Demo User']); userId=r.rows[0].id; }
    let role=await client.query('SELECT id FROM roles WHERE organization_id=$1 AND code=$2',[organizationId,'viewer']);
    let roleId:string;
    if(role.rowCount) roleId=role.rows[0].id;
    else { const r=await client.query('INSERT INTO roles(organization_id,code,name) VALUES($1,$2,$3) RETURNING id',[organizationId,'viewer','Read-only Sandbox Viewer']); roleId=r.rows[0].id; }
    await client.query('INSERT INTO user_roles(user_id,role_id) VALUES($1,$2) ON CONFLICT DO NOTHING',[userId,roleId]);
    await client.query('COMMIT');
    return {organizationId,userId};
  }catch(e){ await client.query('ROLLBACK'); throw e; }
  finally{ client.release(); }
}
const demoTenant=DEMO_AUTH_ENABLED ? await ensureDemoTenant() : null;
function dbOrganizationId(req:any){ return req.user?.organizationId || null; }
function dbUserId(req:any){ return req.user?.sub && req.user.sub!=='system' ? req.user.sub : null; }
async function dbAudit(client:any, req:any, action:string, entityType:string, entityId:string, metadata:Row={}){
  const organizationId=dbOrganizationId(req), actorId=dbUserId(req);
  if(!organizationId) return;
  await client.query('INSERT INTO audit_logs(organization_id,actor_user_id,action,entity_type,entity_id,metadata) VALUES($1,$2,$3,$4,$5,$6)',[organizationId,actorId,action,entityType,entityId,JSON.stringify(metadata)]);
}
function add(m:Mod, data:Row, req:any){ const row={id:data.id||randomUUID(), organizationId:data.organizationId||org(req), createdAt:data.createdAt||now(), updatedAt:now(), ...data}; store[m].push(row); audit.push({id:randomUUID(),action:'CREATE',module:m,resourceId:row.id,actorId:actor(req),at:now()}); events.push({id:randomUUID(),type:`${m}.created`,payload:row,at:now()}); persist(); return row; }
function patch(m:Mod,id:string,data:Row,req:any){ const row=store[m].find(x=>x.id===id && x.organizationId===req.user?.organizationId); if(!row) return null; Object.assign(row,data,{updatedAt:now()}); audit.push({id:randomUUID(),action:'UPDATE',module:m,resourceId:id,actorId:actor(req),at:now()}); events.push({id:randomUUID(),type:`${m}.updated`,payload:row,at:now()}); persist(); return row; }
function remove(m:Mod,id:string,req:any){ const i=store[m].findIndex(x=>x.id===id && x.organizationId===req.user?.organizationId); if(i<0)return false; store[m].splice(i,1); audit.push({id:randomUUID(),action:'DELETE',module:m,resourceId:id,actorId:actor(req),at:now()}); persist(); return true; }

const patient=z.object({firstName:z.string().trim().min(1,'First name is required'),middleName:z.string().trim().optional(),lastName:z.string().trim().min(1,'Last name is required'),dateOfBirth:z.string().optional(),sex:z.enum(['male','female','intersex','unknown']).optional(),phone:z.string().trim().optional(),email:z.string().email('Enter a valid email address').optional(),nationalId:z.string().trim().optional(),preferredLanguage:z.string().trim().optional(),address:z.union([z.string(),z.record(z.any())]).optional(),facilityId:z.string().uuid().optional()});
const contact=z.object({type:z.string().min(1),value:z.string().min(1),isPrimary:z.boolean().default(false)});
const emergencyContact=z.object({name:z.string().min(1),relationship:z.string().optional(),phone:z.string().optional(),address:z.string().optional()});
const allergy=z.object({substance:z.string().min(1),reaction:z.string().optional(),severity:z.string().optional(),status:z.string().default('active')});
const appointment=z.object({patientId:z.string(),providerId:z.string().optional(),facilityId:z.string().optional(),startAt:z.string(),durationMinutes:z.number().int().positive().default(30),type:z.string().default('consultation'),reason:z.string().optional(),status:z.string().default('scheduled')});
const encounter=z.object({patientId:z.string(),appointmentId:z.string().optional(),providerId:z.string().optional(),facilityId:z.string().optional(),reason:z.string().optional(),type:z.string().default('outpatient'),status:z.string().default('in-progress')});
const order=z.object({patientId:z.string(),encounterId:z.string().optional(),category:z.enum(['laboratory','imaging','medication','procedure']),code:z.string().min(1),description:z.string().optional(),priority:z.enum(['routine','urgent','stat']).default('routine'),details:z.record(z.any()).optional()});
const triage=z.object({patientId:z.string(),encounterId:z.string().optional(),chiefComplaint:z.string().optional(),temperature:z.number().optional(),heartRate:z.number().optional(),respiratoryRate:z.number().optional(),systolic:z.number().optional(),diastolic:z.number().optional(),spo2:z.number().optional(),pain:z.number().min(0).max(10).optional(),acuity:z.enum(['routine','urgent','emergency']).default('routine')});
const generic=z.record(z.any());
function validationError(message:string, issues?:any[]){ return Object.assign(new Error(message),{statusCode:400,code:'VALIDATION_FAILED',issues:issues||[]}); }
function validateContractPayload(contract:any, body:any, partial=false){
  const issues=validateRecord(contract,body||{}, {partial});
  if(issues.length) throw validationError(firstValidationMessage(issues),issues);
  if(body?.organizationId && body.organizationId!==undefined) throw validationError('Organization is assigned by the authorized workspace and cannot be supplied by the client.');
  return body;
}
function contractForRequest(req:any){
  const path=String(req.raw.url||'/').split('?')[0];
  const moduleParam=req.params?.module;
  if(path.startsWith('/api/contracts/modules/') && moduleParam) return MODULE_CONTRACT_BY_ID[String(moduleParam)];
  const candidates=MODULE_CONTRACTS.filter(c=>c.backend?.createEndpoint && c.backend.createEndpoint!=='/api/contracts/modules/:module');
  return candidates.find(c=>path===c.backend.endpoint || path.startsWith(`${c.backend.endpoint}/`));
}
const RELATION_TABLES:Record<string,string>={'patients.id':'patients','encounters.id':'encounters','facilities.id':'facilities','appointments.id':'appointments','invoices.id':'invoices','surveillance_cases.id':'surveillance_cases','surveillance_events.id':'surveillance_events','public_health_investigations.id':'public_health_investigations','districts.id':'districts','sync_devices.id':'sync_devices','lab_samples.id':'lab_samples','medication_orders.id':'medication_orders'};
async function validateContractRelationships(req:any, contract:any, body:any){
  if(!pool || !contract?.relationships?.length) return;
  const oid=dbOrganizationId(req); if(!oid) throw validationError('Organization context is required.');
  for(const rel of contract.relationships){
    const value=body?.[rel.field];
    if(value===undefined||value===null||value==='') continue;
    if(!isUuid(value)) throw validationError(`${rel.field} must be a valid identifier.`);
    const table=RELATION_TABLES[rel.target]; if(!table) throw validationError(`Unsupported relationship target for ${rel.field}.`);
    const q=await pool.query(`SELECT id FROM ${table} WHERE id=$1 AND organization_id=$2 LIMIT 1`,[value,oid]);
    if(!q.rowCount) throw Object.assign(new Error(`${rel.field} does not belong to the authorized organization.`),{statusCode:409,code:'RELATIONSHIP_INVALID'});
  }
  const patientId=body?.patientId;
  const encounterId=body?.encounterId;
  if(patientId && encounterId){
    const q=await pool.query('SELECT e.patient_id FROM encounters e WHERE e.id=$1 AND e.organization_id=$2',[encounterId,oid]);
    if(!q.rowCount) throw Object.assign(new Error('Encounter not found in the authorized organization.'),{statusCode:409,code:'RELATIONSHIP_INVALID'});
    if(q.rows[0].patient_id!==patientId) throw Object.assign(new Error('Patient and encounter do not belong to the same care record.'),{statusCode:409,code:'PATIENT_RELATIONSHIP_INVALID'});
  }
}


app.get('/',async()=>({ok:true,service:'clinai-api',status:'live',health:'/health'}));
app.get('/health',async(_req,reply)=>{
  if(!pool) return reply.code(503).send({ok:false,service:'clinai-api',time:now(),persistence:false,database:{connected:false,engine:'postgresql'}});
  try {
    const r=await pool.query("select count(*)::int as table_count from information_schema.tables where table_schema='public' and table_type='BASE TABLE'");
    return {ok:true,service:'clinai-api',time:now(),persistence:true,database:{connected:true,engine:'postgresql',tableCount:r.rows[0].table_count}};
  } catch {
    return reply.code(503).send({ok:false,service:'clinai-api',time:now(),persistence:false,database:{connected:false,engine:'postgresql'}});
  }
});
app.get('/api/system/status',async(_req,reply)=>{
  if(!pool) return reply.code(503).send({ok:false,service:'clinai-api',database:{connected:false,mode:'json'},message:'DATABASE_URL is not configured'});
  try {
    const r=await pool.query("select count(*)::int as table_count from information_schema.tables where table_schema='public' and table_type='BASE TABLE'");
    return {ok:true,service:'clinai-api',status:'live',database:{connected:true,engine:'postgresql',tableCount:r.rows[0].table_count}};
  } catch {
    return reply.code(503).send({ok:false,service:'clinai-api',status:'degraded',database:{connected:false,engine:'postgresql'}});
  }
});
app.get('/api/build-info',async()=>({service:'clinai-api',buildId:process.env.RENDER_GIT_COMMIT||process.env.COMMIT_SHA||'runtime',version:'0.20.0'}));
app.get('/api/modules',async()=>modules);
app.post('/api/auth/demo',async(_req:any,reply:any)=>{
  if(!DEMO_AUTH_ENABLED || PRODUCTION) return reply.code(404).send({error:'Demo authentication is disabled. Use the authorized ClinAI sign-in flow.'});
  if(!demoTenant) return reply.code(503).send({error:'Sandbox authentication is unavailable.'});
  return {token:await app.jwt.sign({sub:demoTenant.userId,role:'viewer',organizationId:demoTenant.organizationId,authContext:'sandbox-read-only'},{expiresIn:'1h'}),organizationId:demoTenant.organizationId,userId:demoTenant.userId,mode:'sandbox-read-only'};
});
app.get('/api/public/preview',async()=>({
  mode:'public-preview',
  readOnly:true,
  synthetic:true,
  patientWrites:false,
  clinicalRecords:'synthetic-demo-only',
  data:{patients:24,appointmentsToday:8,waiting:3,activeEncounters:5,openTasks:4,criticalSignals:1},
  message:'This is a read-only ClinAI preview using synthetic demonstration data. Authorized clinical work requires an authenticated workspace.'
}));
app.addHook('preHandler',async(req)=>{
  const publicPath=(req.raw.url||'/').split('?')[0];
  if(publicPath==='/'||publicPath==='/health'||publicPath==='/api/build-info'||isPublicPath(publicPath)) return;
  try{
    await req.jwtVerify();
    if(isClinicalMutation(req)) requireAuthorizedWrite(req);
  }catch(e:any){
    const status = Number(e?.statusCode || 401);
    if(status === 401) throw Object.assign(new Error('Your ClinAI session is not authenticated. Please sign in again.'), { statusCode: 401, code: 'AUTHENTICATION_REQUIRED' });
    throw e;
  }
});
app.addHook('preHandler', async(req:any,reply:any)=>{
  if(!['POST','PATCH','PUT'].includes(req.method)) return;
  if(req.raw.url?.startsWith('/api/auth/')) return;
  const workflowName=req.params?.name;
  const workflowContract=workflowName?WORKFLOW_VALIDATION_CONTRACTS[String(workflowName)]:undefined;
  const contract=workflowContract || contractForRequest(req);
  if(!contract) return;
  const role=String(req.user?.role||'').toLowerCase();
  if(contract.permissions?.write?.length && !contract.permissions.write.map((x:string)=>x.toLowerCase()).includes(role)){
    throw Object.assign(new Error('This workspace role does not have permission to create or change this record.'),{statusCode:403,code:'MODULE_PERMISSION_REQUIRED'});
  }
  const body=(req.body&&typeof req.body==='object')?req.body:{};
  const partial=req.method==='PATCH';
  validateContractPayload(contract,body,partial);
  await validateContractRelationships(req,contract,body);
});

app.addHook('preHandler', async(req:any,reply:any)=>{
  if(!pool || !['POST','PATCH','DELETE'].includes(req.method) || req.raw.url?.startsWith('/api/auth/')) return;
  const key=String(req.headers['idempotency-key']||'').trim(); if(!key) return;
  const oid=dbOrganizationId(req); if(!oid) return;
  const r=await pool.query('SELECT response_code,response_body FROM idempotency_keys WHERE organization_id=$1 AND key=$2 AND (expires_at IS NULL OR expires_at>now())',[oid,key]);
  if(r.rowCount){ req.idempotencyReplay=true; return reply.code(r.rows[0].response_code).send(r.rows[0].response_body); }
  req.idempotencyKey=key;
});
app.addHook('onSend', async(req:any,reply:any,payload:any)=>{
  if(!pool || !req.idempotencyKey || req.idempotencyReplay || reply.statusCode>=500) return;
  try { const body=typeof payload==='string'?JSON.parse(payload):payload; await pool.query(`INSERT INTO idempotency_keys(organization_id,key,response_code,response_body,expires_at) VALUES($1,$2,$3,$4,now()+interval '24 hours') ON CONFLICT (organization_id,key) DO NOTHING`,[dbOrganizationId(req),req.idempotencyKey,reply.statusCode,JSON.stringify(body)]); } catch {}
});

app.get('/api/analytics/command-center',async(req:any)=>{
  if(!pool)return {data:{}}
  const o=dbOrganizationId(req);
  const [overview,queue,trend,clinical,finance,facilities,alerts]=await Promise.all([
    pool.query(`SELECT
      (SELECT count(*) FROM patients WHERE organization_id=$1) AS patients,
      (SELECT count(*) FROM appointments WHERE organization_id=$1 AND start_at::date=current_date) AS appointments_today,
      (SELECT count(*) FROM queue_entries qe JOIN queues q ON q.id=qe.queue_id WHERE q.organization_id=$1 AND qe.status NOT IN ('completed','cancelled','no-show')) AS waiting,
      (SELECT count(*) FROM encounters WHERE organization_id=$1 AND status IN ('in-progress','active')) AS active_encounters,
      (SELECT count(*) FROM facility_beds WHERE organization_id=$1 AND status='occupied') AS occupied_beds,
      (SELECT count(*) FROM facility_beds WHERE organization_id=$1 AND status='available') AS available_beds,
      (SELECT count(*) FROM referrals r JOIN patients p ON p.id=r.patient_id WHERE p.organization_id=$1 AND r.status NOT IN ('completed','cancelled')) AS open_referrals,
      (SELECT count(*) FROM care_tasks WHERE organization_id=$1 AND status='open') AS open_tasks,
      (SELECT COALESCE(sum(total-paid),0) FROM (SELECT i.total,COALESCE((SELECT sum(p.amount) FROM payments p WHERE p.invoice_id=i.id AND p.status='completed'),0) paid FROM invoices i WHERE i.organization_id=$1 AND i.status<>'paid') x) AS outstanding_balance`,[o]),
    pool.query(`SELECT qe.status,qe.priority,count(*)::int AS count FROM queue_entries qe JOIN queues q ON q.id=qe.queue_id WHERE q.organization_id=$1 AND qe.status NOT IN ('completed','cancelled','no-show') GROUP BY qe.status,qe.priority ORDER BY count DESC`,[o]),
    pool.query(`WITH days AS (SELECT generate_series(current_date-6,current_date,interval '1 day')::date d) SELECT d,
      (SELECT count(*) FROM patients p WHERE p.organization_id=$1 AND p.created_at::date=d) patients,
      (SELECT count(*) FROM appointments a WHERE a.organization_id=$1 AND a.start_at::date=d) appointments,
      (SELECT count(*) FROM encounters e WHERE e.organization_id=$1 AND e.started_at::date=d) encounters,
      (SELECT count(*) FROM payments py JOIN invoices i ON i.id=py.invoice_id WHERE i.organization_id=$1 AND py.status='completed' AND py.paid_at::date=d) payments
      FROM days ORDER BY d`,[o]),
    pool.query(`SELECT * FROM (VALUES
      ('Critical laboratory results',(SELECT count(*) FROM lab_results lr JOIN lab_samples ls ON ls.id=lr.sample_id JOIN clinical_orders co ON co.id=ls.order_id JOIN patients p ON p.id=co.patient_id WHERE p.organization_id=$1 AND lr.critical=true AND lr.status<>'released')),
      ('Pending lab verification',(SELECT count(*) FROM lab_results lr JOIN lab_samples ls ON ls.id=lr.sample_id JOIN clinical_orders co ON co.id=ls.order_id JOIN patients p ON p.id=co.patient_id WHERE p.organization_id=$1 AND lr.status='preliminary')),
      ('Open care tasks',(SELECT count(*) FROM care_tasks WHERE organization_id=$1 AND status='open')),
      ('Medication reviews',(SELECT count(*) FROM medication_reconciliation WHERE organization_id=$1 AND status='in-review')),
      ('Open facility incidents',(SELECT count(*) FROM facility_operational_incidents WHERE organization_id=$1 AND status NOT IN ('resolved','closed')))
    ) v(label,count)`,[o]),
    pool.query(`SELECT count(*)::int AS invoices,count(*) FILTER (WHERE status='paid')::int AS paid,count(*) FILTER (WHERE status<>'paid')::int AS open,COALESCE(sum(total),0) AS billed FROM invoices WHERE organization_id=$1`,[o]),
    pool.query(`SELECT f.id,f.name,f.type,
      COALESCE((SELECT count(*) FROM facility_beds b WHERE b.facility_id=f.id AND b.status='occupied'),0)::int occupied_beds,
      COALESCE((SELECT count(*) FROM facility_beds b WHERE b.facility_id=f.id AND b.status='available'),0)::int available_beds,
      COALESCE((SELECT count(*) FROM facility_operational_incidents i WHERE i.facility_id=f.id AND i.status NOT IN ('resolved','closed')),0)::int open_incidents
      FROM facilities f WHERE f.organization_id=$1 ORDER BY f.name`,[o]),
    pool.query(`SELECT event_type AS type,severity,reason,created_at AS "createdAt" FROM security_events WHERE organization_id=$1 ORDER BY created_at DESC LIMIT 8`,[o])
  ]);
  return {data:{overview:overview.rows[0],queue:queue.rows,trend:trend.rows,clinical:clinical.rows,finance:finance.rows[0],facilities:facilities.rows,alerts:alerts.rows}};
});

app.get('/api/public/test-dashboard',async(_req:any,reply:any)=>{
  if(!pool) return {data:{overview:{patients:0,appointmentsToday:0,waiting:0,activeEncounters:0,occupiedBeds:0,availableBeds:0,openReferrals:0,openTasks:0,outstandingBalance:0},queue:[],trend:[],clinical:[],finance:{},facilities:[],patients:[]}};
  if(!PUBLIC_TEST_DATA_ENABLED) return reply.code(403).send({error:'Public test data is currently disabled.'});
  const [overview,queue,trend,clinical,finance,facilities,patients]=await Promise.all([
    pool.query(`SELECT count(*)::int AS patients,(SELECT count(*) FROM appointments a JOIN patients p ON p.id=a.patient_id WHERE p.is_test_data AND a.start_at::date=current_date) appointments_today,(SELECT count(*) FROM queue_entries qe JOIN queues q ON q.id=qe.queue_id JOIN patients p ON p.id=qe.patient_id WHERE p.is_test_data AND q.code='TEST-QUEUE' AND qe.status NOT IN ('completed','cancelled','no-show')) waiting,(SELECT count(*) FROM encounters e JOIN patients p ON p.id=e.patient_id WHERE p.is_test_data AND e.status IN ('in-progress','active')) active_encounters,(SELECT count(*) FROM facility_beds b WHERE b.status='occupied' AND b.metadata->>'source'='synthetic-test-data') occupied_beds,(SELECT count(*) FROM facility_beds b WHERE b.status='available' AND b.metadata->>'source'='synthetic-test-data') available_beds,(SELECT count(*) FROM referrals r JOIN patients p ON p.id=r.patient_id WHERE p.is_test_data AND r.status NOT IN ('completed','cancelled')) open_referrals,(SELECT count(*) FROM care_tasks t JOIN patients p ON p.id=t.patient_id WHERE p.is_test_data AND t.status='open') open_tasks,(SELECT coalesce(sum(i.total),0) FROM invoices i JOIN patients p ON p.id=i.patient_id WHERE p.is_test_data AND i.status<>'paid') outstanding_balance FROM patients WHERE is_test_data`,[]),
    pool.query(`SELECT qe.status,qe.priority,count(*)::int AS count FROM queue_entries qe JOIN queues q ON q.id=qe.queue_id JOIN patients p ON p.id=qe.patient_id WHERE p.is_test_data AND q.code='TEST-QUEUE' AND qe.status NOT IN ('completed','cancelled','no-show') GROUP BY qe.status,qe.priority ORDER BY count DESC`),
    pool.query(`WITH days AS (SELECT generate_series(current_date-6,current_date,interval '1 day')::date d) SELECT d,(SELECT count(*) FROM appointments a JOIN patients p ON p.id=a.patient_id WHERE p.is_test_data AND a.start_at::date=d) appointments,(SELECT count(*) FROM encounters e JOIN patients p ON p.id=e.patient_id WHERE p.is_test_data AND e.started_at::date=d) encounters FROM days ORDER BY d`),
    pool.query(`SELECT * FROM (VALUES ('Critical laboratory results',(SELECT count(*) FROM lab_results lr JOIN lab_samples ls ON ls.id=lr.sample_id JOIN clinical_orders co ON co.id=ls.order_id JOIN patients p ON p.id=co.patient_id WHERE p.is_test_data AND lr.critical=true AND lr.status<>'released')),('Pending laboratory review',(SELECT count(*) FROM lab_results lr JOIN lab_samples ls ON ls.id=lr.sample_id JOIN clinical_orders co ON co.id=ls.order_id JOIN patients p ON p.id=co.patient_id WHERE p.is_test_data AND lr.status='preliminary')),('Open care tasks',(SELECT count(*) FROM care_tasks t JOIN patients p ON p.id=t.patient_id WHERE p.is_test_data AND t.status='open')),('Medication reviews',(SELECT count(*) FROM medication_reconciliation mr JOIN patients p ON p.id=mr.patient_id WHERE p.is_test_data AND mr.status='in-review')),('Open referrals',(SELECT count(*) FROM referrals r JOIN patients p ON p.id=r.patient_id WHERE p.is_test_data AND r.status NOT IN ('completed','cancelled')))) v(label,count)`),
    pool.query(`SELECT count(*)::int AS invoices,count(*) FILTER (WHERE i.status='paid')::int AS paid,count(*) FILTER (WHERE i.status<>'paid')::int AS open,coalesce(sum(i.total),0) AS billed FROM invoices i JOIN patients p ON p.id=i.patient_id WHERE p.is_test_data`),
    pool.query(`SELECT f.id,f.name,f.type,coalesce((SELECT count(*) FROM facility_beds b WHERE b.facility_id=f.id AND b.status='occupied' AND b.metadata->>'source'='synthetic-test-data'),0)::int occupied_beds,coalesce((SELECT count(*) FROM facility_beds b WHERE b.facility_id=f.id AND b.status='available' AND b.metadata->>'source'='synthetic-test-data'),0)::int available_beds,coalesce((SELECT count(*) FROM facility_operational_incidents i WHERE i.facility_id=f.id AND i.impact->>'source'='synthetic-test-data' AND i.status NOT IN ('resolved','closed')),0)::int open_incidents FROM facilities f WHERE f.name='Main Facility' LIMIT 10`),
    pool.query(`SELECT p.patient_number AS "patientNumber",p.first_name AS "firstName",p.last_name AS "lastName",p.date_of_birth AS "dateOfBirth",p.sex,p.status,(SELECT d.display FROM diagnoses d WHERE d.patient_id=p.id ORDER BY d.id DESC LIMIT 1) AS "currentProblem",(SELECT t.priority FROM care_tasks t WHERE t.patient_id=p.id AND t.status='open' ORDER BY CASE t.priority WHEN 'urgent' THEN 1 WHEN 'high' THEN 2 ELSE 3 END,t.created_at DESC LIMIT 1) AS priority,(SELECT count(*)::int FROM care_gap_snapshots cg WHERE cg.patient_id=p.id AND cg.status NOT IN ('resolved','dismissed')) AS "careGaps" FROM patients p WHERE p.is_test_data ORDER BY p.patient_number`)
  ]);
  return {data:{overview:overview.rows[0],queue:queue.rows,trend:trend.rows,clinical:clinical.rows,finance:finance.rows[0],facilities:facilities.rows,patients:patients.rows}};
});

app.get('/api/public/test-patients',async(_req:any,reply:any)=>{
  if(!pool)return {data:[]}; if(!PUBLIC_TEST_DATA_ENABLED)return reply.code(403).send({error:'Public test data is currently disabled.'});
  const r=await pool.query(`SELECT p.patient_number AS "patientNumber",p.first_name AS "firstName",p.last_name AS "lastName",p.date_of_birth AS "dateOfBirth",p.sex,p.status,(SELECT d.display FROM diagnoses d WHERE d.patient_id=p.id ORDER BY d.id DESC LIMIT 1) AS "currentProblem",(SELECT t.priority FROM care_tasks t WHERE t.patient_id=p.id AND t.status='open' ORDER BY CASE t.priority WHEN 'urgent' THEN 1 WHEN 'high' THEN 2 ELSE 3 END,t.created_at DESC LIMIT 1) AS priority FROM patients p WHERE p.is_test_data ORDER BY p.patient_number`); return {data:r.rows,count:r.rowCount};
});

app.get('/api/public/test-patients/:patientNumber',async(req:any,reply:any)=>{
  if(!pool)return reply.code(404).send({error:'Synthetic test patient not found.'}); if(!PUBLIC_TEST_DATA_ENABLED)return reply.code(403).send({error:'Public test data is currently disabled.'});
  const r=await pool.query(`SELECT p.patient_number AS "patientNumber",p.first_name AS "firstName",p.last_name AS "lastName",p.date_of_birth AS "dateOfBirth",p.sex,p.preferred_language AS "preferredLanguage",p.status,(SELECT d.display FROM diagnoses d WHERE d.patient_id=p.id ORDER BY d.id DESC LIMIT 1) AS "currentProblem",(SELECT count(*)::int FROM encounters e WHERE e.patient_id=p.id) encounters,(SELECT count(*)::int FROM diagnoses d WHERE d.patient_id=p.id) diagnoses,(SELECT count(*)::int FROM clinical_orders o WHERE o.patient_id=p.id) orders,(SELECT count(*)::int FROM referrals x WHERE x.patient_id=p.id AND x.status NOT IN ('completed','cancelled')) open_referrals,(SELECT count(*)::int FROM care_tasks t WHERE t.patient_id=p.id AND t.status='open') open_tasks,(SELECT count(*)::int FROM care_gap_snapshots cg WHERE cg.patient_id=p.id AND cg.status NOT IN ('resolved','dismissed')) care_gaps FROM patients p WHERE p.is_test_data AND p.patient_number=$1 LIMIT 1`,[req.params.patientNumber]);
  if(!r.rowCount)return reply.code(404).send({error:'Synthetic test patient not found.'}); return {data:r.rows[0],syntheticTestData:true};
});

// Public synthetic Patient 360: read-only and strictly limited to is_test_data patients.
app.get('/api/public/test-patients/:patientNumber/360',async(req:any,reply:any)=>{
  if(!pool)return reply.code(503).send({error:'Synthetic Patient 360 requires PostgreSQL'});
  if(!PUBLIC_TEST_DATA_ENABLED)return reply.code(404).send({error:'Public test data is disabled.'});
  const number=String(req.params.patientNumber||'').trim();
  if(!/^TEST-[0-9]{3}$/.test(number))return reply.code(404).send({error:'Synthetic test patient not found.'});
  const pq=await pool.query(`SELECT p.id,p.organization_id AS "organizationId",p.facility_id AS "facilityId",p.patient_number AS "patientNumber",p.first_name AS "firstName",p.middle_name AS "middleName",p.last_name AS "lastName",p.date_of_birth AS "dateOfBirth",p.sex,p.preferred_language AS "preferredLanguage",p.status,p.email FROM patients p WHERE p.patient_number=$1 AND p.is_test_data=true AND p.email ILIKE '%@clinaidemoemail.com' LIMIT 1`,[number]);
  if(!pq.rowCount)return reply.code(404).send({error:'Synthetic test patient not found.'});
  const p=pq.rows[0], id=p.id, oid=p.organizationId;
  const [appointments,encounters,orders,diagnoses,observations,notes,medications,allergies,admissions,immunizations,chronicCare,telemedicine,remoteMonitoring,carePlans,referrals,careTasks,followUp,clinicalAlerts,contacts,emergencyContacts,timeline]=await Promise.all([
    pool.query(`SELECT id,start_at AS "startAt",end_at AS "endAt",type,status,reason FROM appointments WHERE patient_id=$1 AND organization_id=$2 ORDER BY start_at DESC LIMIT 50`,[id,oid]),
    pool.query(`SELECT id,type,status,started_at AS "startedAt",ended_at AS "endedAt" FROM encounters WHERE patient_id=$1 AND organization_id=$2 ORDER BY started_at DESC LIMIT 50`,[id,oid]),
    pool.query(`SELECT id,order_type AS "category",priority,status,details,created_at AS "createdAt" FROM clinical_orders WHERE patient_id=$1 ORDER BY created_at DESC LIMIT 100`,[id]),
    pool.query(`SELECT id,code,display,diagnosis_type AS "diagnosisType",status FROM diagnoses WHERE patient_id=$1 ORDER BY id DESC LIMIT 100`,[id]),
    pool.query(`SELECT id,display,code,value_numeric AS "valueNumeric",value_text AS "valueText",unit,observed_at AS "observedAt" FROM observations WHERE patient_id=$1 ORDER BY observed_at DESC LIMIT 100`,[id]),
    pool.query(`SELECT n.id,n.note_type AS "noteType",n.subjective,n.objective,n.assessment,n.plan,n.signed_at AS "signedAt" FROM clinical_notes n JOIN encounters e ON e.id=n.encounter_id WHERE e.patient_id=$1 AND e.organization_id=$2 ORDER BY n.id DESC LIMIT 50`,[id,oid]),
    pool.query(`SELECT mo.id,mo.dose,mo.frequency,mo.route,mo.duration,mo.quantity,mo.status,m.name,m.strength,m.form FROM medication_orders mo JOIN medications m ON m.id=mo.medication_id JOIN patients pp ON pp.id=mo.patient_id WHERE mo.patient_id=$1 AND pp.organization_id=$2 ORDER BY mo.id DESC LIMIT 100`,[id,oid]),
    pool.query(`SELECT id,substance,reaction,severity,status FROM allergies WHERE patient_id=$1 ORDER BY id DESC`,[id]),
    pool.query(`SELECT id,ward,bed,status,admitted_at AS "admittedAt",discharged_at AS "dischargedAt",discharge_summary AS "dischargeSummary" FROM admissions WHERE patient_id=$1 AND organization_id=$2 ORDER BY admitted_at DESC LIMIT 50`,[id,oid]),
    pool.query(`SELECT id,vaccine_name AS "vaccineName",dose_number AS "doseNumber",administered_at AS "administeredAt",status,next_due_at AS "nextDueAt" FROM immunizations WHERE patient_id=$1 AND organization_id=$2 ORDER BY administered_at DESC LIMIT 100`,[id,oid]),
    pool.query(`SELECT id,condition_code AS "conditionCode",condition_name AS "conditionName",status,risk_level AS "riskLevel",next_review_at AS "nextReviewAt" FROM chronic_care_records WHERE patient_id=$1 AND organization_id=$2 ORDER BY updated_at DESC LIMIT 50`,[id,oid]),
    pool.query(`SELECT id,scheduled_at AS "scheduledAt",status,identity_verified AS "identityVerified",consent_confirmed AS "consentConfirmed",started_at AS "startedAt",ended_at AS "endedAt" FROM telemedicine_sessions WHERE patient_id=$1 AND organization_id=$2 ORDER BY scheduled_at DESC LIMIT 50`,[id,oid]),
    pool.query(`SELECT id,metric,value_numeric AS "valueNumeric",unit,measured_at AS "measuredAt",source,validation_status AS "validationStatus",alert_status AS "alertStatus" FROM remote_monitoring_readings WHERE patient_id=$1 AND organization_id=$2 ORDER BY measured_at DESC LIMIT 100`,[id,oid]),
    pool.query(`SELECT id,title,status,goals FROM care_plans WHERE patient_id=$1 ORDER BY id DESC LIMIT 50`,[id]),
    pool.query(`SELECT id,destination,reason,status,created_at AS "createdAt" FROM referrals WHERE patient_id=$1 ORDER BY created_at DESC LIMIT 50`,[id]),
    pool.query(`SELECT id,task_type AS "taskType",title,priority,status,due_at AS "dueAt",created_at AS "createdAt",completed_at AS "completedAt" FROM care_tasks WHERE patient_id=$1 AND organization_id=$2 ORDER BY created_at DESC LIMIT 100`,[id,oid]),
    pool.query(`SELECT id,status,payload,created_at AS "createdAt",updated_at AS "updatedAt" FROM module_records WHERE organization_id=$2 AND payload->>'patientId'=$1 AND module IN ('follow-up','followup') AND COALESCE(payload->>'coverageVersion','') <> '025' AND COALESCE(payload->>'recordPurpose','') <> 'connected synthetic testing' ORDER BY created_at DESC LIMIT 50`,[id,oid]),
    pool.query(`SELECT id,COALESCE(payload->>'kind',module) AS kind,COALESCE(payload->>'severity','') AS severity,status,payload,created_at AS "createdAt" FROM module_records WHERE organization_id=$2 AND payload->>'patientId'=$1 AND module IN ('clinical-alerts','care-gaps') AND COALESCE(payload->>'coverageVersion','') <> '025' AND COALESCE(payload->>'recordPurpose','') <> 'connected synthetic testing' AND status NOT IN ('resolved','closed','completed') ORDER BY created_at DESC LIMIT 50`,[id,oid]),
    pool.query(`SELECT id,type,value,is_primary AS "isPrimary" FROM patient_contacts WHERE patient_id=$1 ORDER BY is_primary DESC,id`,[id]),
    pool.query(`SELECT id,name,relationship FROM emergency_contacts WHERE patient_id=$1 ORDER BY id`,[id]),
    pool.query(`SELECT id,started_at AS at,'visit' AS kind,concat('Care visit · ',COALESCE(type,'visit')) AS title,status FROM encounters WHERE organization_id=$1 AND patient_id=$2 UNION ALL SELECT id,observed_at,'observation',COALESCE(display,code),COALESCE(value_text,value_numeric::text) FROM observations WHERE patient_id=$2 UNION ALL SELECT id,created_at,'order',COALESCE(details->>'description',order_type),status FROM clinical_orders WHERE patient_id=$2 UNION ALL SELECT id,created_at,'referral',COALESCE(destination,'Referral'),status FROM referrals WHERE patient_id=$2 ORDER BY at DESC LIMIT 150`,[oid,id])
  ]);
  const publicPatient={patientNumber:p.patientNumber,firstName:p.firstName,middleName:p.middleName,lastName:p.lastName,dateOfBirth:p.dateOfBirth,sex:p.sex,preferredLanguage:p.preferredLanguage,status:p.status}; return {patient:publicPatient,contacts:contacts.rows.map((x:any)=>({type:x.type,isPrimary:x.isPrimary})),emergencyContacts:emergencyContacts.rows.map((x:any)=>({relationship:x.relationship})),allergies:allergies.rows,appointments:appointments.rows,encounters:encounters.rows,orders:orders.rows,diagnoses:diagnoses.rows,observations:observations.rows,clinicalNotes:notes.rows,medications:medications.rows,admissions:admissions.rows,immunizations:immunizations.rows,chronicCare:chronicCare.rows,telemedicine:telemedicine.rows,remoteMonitoring:remoteMonitoring.rows,carePlans:carePlans.rows,referrals:referrals.rows,followUp:followUp.rows,careTasks:careTasks.rows,clinicalAlerts:clinicalAlerts.rows,timeline:timeline.rows,publicTestPatient:true};
});

// Public module read surface. It never accepts writes and only returns synthetic records.
app.get('/api/public/test-modules/:module',async(req:any,reply:any)=>{
  if(!pool)return reply.code(503).send({error:'Synthetic module data requires PostgreSQL'});
  if(!PUBLIC_TEST_DATA_ENABLED)return reply.code(404).send({error:'Public test data is disabled.'});
  const moduleId=String(req.params.module||'');
  if(!MODULE_CONTRACT_BY_ID[moduleId])return reply.code(404).send({error:'Module not found'});
  const orgQ=await pool.query(`SELECT organization_id AS "organizationId" FROM patients WHERE is_test_data=true AND email ILIKE '%@clinaidemoemail.com' GROUP BY organization_id ORDER BY COUNT(*) DESC LIMIT 1`);
  if(!orgQ.rowCount)return {data:[],count:0,readOnly:true,synthetic:true,module:moduleId};
  const oid=orgQ.rows[0].organizationId;
  if(moduleId==='patients'){
    const r=await pool.query(`SELECT id,patient_number AS "patientNumber",first_name AS "firstName",middle_name AS "middleName",last_name AS "lastName",date_of_birth AS "dateOfBirth",sex,preferred_language AS "preferredLanguage",status FROM patients WHERE organization_id=$1 AND is_test_data=true ORDER BY patient_number LIMIT 100`,[oid]);
    return {data:r.rows,count:r.rowCount,readOnly:true,synthetic:true,module:moduleId};
  }
  const requestedPatient=String(req.query?.patientNumber||'').trim();
  const params:any[]=[oid,moduleId];
  let patientClause='';
  if(requestedPatient){
    params.push(requestedPatient);
    patientClause=` AND payload->>'patientNumber'=$3`;
  }
  const r=await pool.query(`SELECT mr.id,mr.module,mr.status,mr.payload,mr.created_at AS "createdAt",mr.updated_at AS "updatedAt",p.patient_number AS "patientNumber",p.first_name AS "firstName",p.middle_name AS "middleName",p.last_name AS "lastName",p.sex,p.date_of_birth AS "dateOfBirth",p.status AS "patientStatus"
    FROM module_records mr
    LEFT JOIN patients p ON p.id::text=mr.payload->>'patientId' AND p.organization_id=mr.organization_id AND p.is_test_data=true
    WHERE mr.organization_id=$1 AND mr.module=$2
      AND COALESCE(mr.payload->>'coverageVersion','') <> '025' AND COALESCE(mr.payload->>'recordPurpose','') <> 'connected synthetic testing'
      AND (mr.payload->>'isTestData'='true' OR mr.payload->>'patientId' IN (SELECT id::text FROM patients WHERE organization_id=$1 AND is_test_data=true))
      ${patientClause}
    ORDER BY mr.created_at DESC LIMIT 500`,params);
  return {data:r.rows.map((x:any)=>({id:x.id,module:x.module,status:x.status,...x.payload,patientNumber:x.patientNumber||x.payload?.patientNumber,firstName:x.firstName||undefined,middleName:x.middleName||undefined,lastName:x.lastName||undefined,sex:x.sex||undefined,dateOfBirth:x.dateOfBirth||undefined,patientStatus:x.patientStatus||undefined,createdAt:x.createdAt,updatedAt:x.updatedAt})),count:r.rowCount,readOnly:true,synthetic:true,module:moduleId,patientNumber:requestedPatient||null,patientCount:new Set(r.rows.map((x:any)=>x.patientNumber).filter(Boolean)).size};
});


// Public synthetic intelligence workspaces. Read-only and always limited to is_test_data patients.
app.get('/api/public/test-intelligence/:workspace',async(req:any,reply:any)=>{
  if(!pool)return reply.code(503).send({error:'Synthetic intelligence requires PostgreSQL'});
  if(!PUBLIC_TEST_DATA_ENABLED)return reply.code(404).send({error:'Public test data is disabled.'});
  const workspace=String(req.params.workspace||'').trim().toLowerCase();
  const orgQ=await pool.query(`SELECT organization_id AS "organizationId" FROM patients WHERE is_test_data=true AND email ILIKE '%@clinaidemoemail.com' GROUP BY organization_id ORDER BY COUNT(*) DESC LIMIT 1`);
  if(!orgQ.rowCount)return reply.code(404).send({error:'Synthetic test environment is not configured.'});
  const organizationId=orgQ.rows[0].organizationId;
  const days=Math.min(365,Math.max(1,Number(req.query?.days||30)));
  try {
    if(workspace==='patient-360'){
      const number=String(req.query?.patientNumber||'').trim();
      if(!/^TEST-[0-9]{3}$/.test(number)) return {data:{selectedPatient:null,availablePatients:(await pool.query(`SELECT patient_number AS "patientNumber",first_name AS "firstName",last_name AS "lastName" FROM patients WHERE organization_id=$1 AND is_test_data=true ORDER BY patient_number`,[organizationId])).rows}};
      const pq=await pool.query(`SELECT id FROM patients WHERE organization_id=$1 AND is_test_data=true AND patient_number=$2 LIMIT 1`,[organizationId,number]);
      if(!pq.rowCount)return reply.code(404).send({error:'Synthetic test patient not found.'});
      const d=await buildPatient360Context(intelligenceQuery(),organizationId,pq.rows[0].id,'clinical');
      return {data:{patientNumber:number,context:d,syntheticTestData:true,readOnly:true}};
    }
    if(workspace==='clinical-velocity'){
      const rows=await pool.query(`WITH signals AS (
        SELECT e.id,e.event_type,e.patient_id,e.created_at,
               CASE WHEN e.event_type LIKE '%critical%' THEN 'critical' WHEN e.event_type LIKE '%urgent%' THEN 'urgent' ELSE 'routine' END severity
        FROM clinical_workflow_events e JOIN patients p ON p.id=e.patient_id
        WHERE e.organization_id=$1 AND p.is_test_data AND e.created_at>=now()-($2::text||' days')::interval
      ), actions AS (
        SELECT s.id,s.severity,s.created_at,MIN(a.created_at) AS action_at
        FROM signals s LEFT JOIN clinical_workflow_events a ON a.organization_id=$1 AND a.patient_id=s.patient_id AND a.created_at>s.created_at
          AND a.event_type IN ('result.verified','result.released','task.completed','referral.completed','followup.completed')
        GROUP BY s.id,s.severity,s.created_at
      ) SELECT severity,count(*)::int AS total,count(*) FILTER(WHERE action_at IS NOT NULL)::int AS completed,count(*) FILTER(WHERE action_at IS NULL)::int AS unresolved,
        round(avg(extract(epoch FROM(action_at-created_at))/60.0) FILTER(WHERE action_at IS NOT NULL)::numeric,1) AS "averageMinutes",
        round(percentile_cont(0.5) WITHIN GROUP(ORDER BY extract(epoch FROM(action_at-created_at))/60.0) FILTER(WHERE action_at IS NOT NULL)::numeric,1) AS "medianMinutes",
        round(percentile_cont(0.9) WITHIN GROUP(ORDER BY extract(epoch FROM(action_at-created_at))/60.0) FILTER(WHERE action_at IS NOT NULL)::numeric,1) AS "p90Minutes"
        FROM actions GROUP BY severity ORDER BY severity`,[organizationId,String(days)]);
      const unresolved=await pool.query(`SELECT count(*)::int AS count FROM clinical_signals s JOIN patients p ON p.id=s.patient_id WHERE p.organization_id=$1 AND p.is_test_data AND s.severity IN ('critical','high') AND s.status NOT IN ('resolved','closed','dismissed')`,[organizationId]);
      return {data:{workspace:'clinical-velocity',periodDays:days,metrics:rows.rows,unresolvedSignals:Number(unresolved.rows[0]?.count||0),guardrails:{unsafeSpeedNeverRewarded:true,qualitySignalsRequired:true,patientImpactConsidered:true},syntheticTestData:true,readOnly:true}};
    }
    if(workspace==='value-based-care'){
      const measures=await pool.query(`SELECT 'referral-completion' AS measure,count(*) FILTER(WHERE r.status IN ('completed','closed'))::int AS numerator,count(*)::int AS denominator,
        CASE WHEN count(*)=0 THEN NULL ELSE round(100.0*count(*) FILTER(WHERE r.status IN ('completed','closed'))/count(*),1) END AS "valueNumeric"
        FROM referrals r JOIN patients p ON p.id=r.patient_id WHERE p.organization_id=$1 AND p.is_test_data`,[organizationId]);
      const followups=await pool.query(`SELECT count(*) FILTER(WHERE status IN ('completed','closed'))::int AS numerator,count(*)::int AS denominator,
        CASE WHEN count(*)=0 THEN NULL ELSE round(100.0*count(*) FILTER(WHERE status IN ('completed','closed'))/count(*),1) END AS "valueNumeric"
        FROM module_records WHERE organization_id=$1 AND module='follow-up' AND payload->>'isTestData'='true'`,[organizationId]);
      const gaps=await pool.query(`SELECT COALESCE(payload->>'sourceModule',module) AS "sourceModule",COALESCE(payload->>'severity','routine') AS severity,count(*)::int AS count FROM module_records WHERE organization_id=$1 AND module='care-gaps' AND payload->>'isTestData'='true' GROUP BY 1,2 ORDER BY count DESC`,[organizationId]);
      return {data:{workspace:'value-based-care',period:{days},measures:[{measure:'referral-completion',...measures.rows[0]},{measure:'follow-up-completion',...followups.rows[0]}],careGapDistribution:gaps.rows,outcomeRule:'Operational completion is not treated as a clinical outcome without clinical validation.',syntheticTestData:true,readOnly:true}};
    }
    if(workspace==='ai-risk'){
      const matrix=await pool.query(`SELECT r.risk_level AS "riskLevel",r.risk_type AS "riskType",r.status,count(*)::int AS count FROM ai_risk_assessments r JOIN patients p ON p.id=r.patient_id WHERE r.organization_id=$1 AND p.is_test_data GROUP BY r.risk_level,r.risk_type,r.status ORDER BY r.risk_level,r.risk_type`,[organizationId]);
      const signals=await pool.query(`SELECT s.severity,s.status,count(*)::int AS count FROM clinical_signals s JOIN patients p ON p.id=s.patient_id WHERE s.organization_id=$1 AND p.is_test_data GROUP BY s.severity,s.status ORDER BY count DESC`,[organizationId]);
      return {data:{workspace:'ai-risk',riskMatrix:matrix.rows,clinicalSignals:signals.rows,workflow:['risk-classification','evaluation','clinical-validation','approval','monitoring','drift','incident','mitigation','residual-risk','review','retirement'],policy:{deterministicSignalsRemainSourceOfClinicalRisk:true,generativeAIIsInterpretive:true},syntheticTestData:true,readOnly:true}};
    }
    if(workspace==='ai-security'){
      const events=await pool.query(`SELECT event_type AS "eventType",severity,status,source,count(*)::int AS count FROM ai_security_events s JOIN patients p ON p.id=s.patient_id WHERE s.organization_id=$1 AND p.is_test_data AND s.created_at>=now()-($2::text||' days')::interval GROUP BY event_type,severity,status,source ORDER BY count DESC`,[organizationId,String(days)]);
      const controls=['prompt-injection','indirect-injection','data-disclosure','cross-tenant-access','role-spoofing','unauthorized-patient-lookup','tool-misuse','provider-leakage','unsafe-output','abuse-rate-limit'];
      const observed=new Set(events.rows.map((x:any)=>String(x.eventType)));
      return {data:{workspace:'ai-security',periodDays:days,events:events.rows,controls:controls.map(control=>({control,observed:observed.has(control),status:observed.has(control)?'monitored':'no-events-recorded'})),policy:{tenantIsolation:true,serverDerivedRole:true,patientAuthorization:true,providerLeakageBlocked:true,unsafeOutputBlocked:true,rateLimitsEnforced:true},syntheticTestData:true,readOnly:true}};
    }
    if(workspace==='ai-governance'){
      const [caps,evals,incidents,lifecycle]=await Promise.all([
        pool.query(`SELECT capability_id AS "capabilityId",name,domain,risk_level AS "riskLevel",status,version FROM ai_capabilities WHERE organization_id=$1 OR organization_id IS NULL ORDER BY domain,capability_id`,[organizationId]),
        pool.query(`SELECT capability_id AS "capabilityId",evaluation_type AS "evaluationType",status,count(*)::int AS count FROM ai_capability_evaluations WHERE organization_id=$1 GROUP BY capability_id,evaluation_type,status ORDER BY capability_id`,[organizationId]),
        pool.query(`SELECT severity,status,incident_type AS "incidentType",count(*)::int AS count FROM ai_incidents WHERE organization_id=$1 GROUP BY severity,status,incident_type ORDER BY count DESC`,[organizationId]),
        pool.query(`SELECT model_id AS "modelId",event_type AS "eventType",environment,outcome,count(*)::int AS count FROM ai_model_lifecycle_events WHERE organization_id=$1 GROUP BY model_id,event_type,environment,outcome ORDER BY count DESC`,[organizationId])
      ]);
      return {data:{workspace:'ai-governance',capabilities:caps.rows,evaluations:evals.rows,incidents:incidents.rows,lifecycle:lifecycle.rows,lifecycleStates:['design','evaluation','clinical-validation','approval','production','monitoring','incident','mitigation','re-evaluation','retirement'],riskLevels:['level-1','level-2','level-3'],syntheticTestData:true,readOnly:true}};
    }
    return reply.code(404).send({error:'Synthetic intelligence workspace not found.'});
  } catch (e:any) {
    req.log.error(e);
    return reply.code(500).send({error:'The synthetic intelligence workspace could not be prepared.'});
  }
});


app.get('/api/dashboard',async(req:any)=>{
  if(!pool){const count=(m:Mod)=>store[m].length;return {patients:count('patients'),appointments:count('appointments'),waiting:store.queue.filter(x=>['waiting','waiting-triage','waiting-doctor'].includes(x.status)).length,criticalLabs:store.laboratory.filter(x=>x.critical).length,openTasks:store.tasks.filter(x=>x.status==='open').length,unpaid:store.billing.filter(x=>x.status!=='paid').length};}
  const oid=dbOrganizationId(req);
  const [p,a,q,l,t,i]=await Promise.all([
    pool.query('SELECT count(*)::int n FROM patients WHERE organization_id=$1',[oid]),
    pool.query('SELECT count(*)::int n FROM appointments WHERE organization_id=$1',[oid]),
    pool.query("SELECT count(*)::int n FROM queue_entries qe JOIN queues q ON q.id=qe.queue_id WHERE q.organization_id=$1 AND qe.status IN ('waiting','waiting-triage','waiting-doctor','emergency')",[oid]),
    pool.query("SELECT count(*)::int n FROM module_records WHERE organization_id=$1 AND module='laboratory' AND COALESCE(payload->>'critical','false')='true' AND COALESCE(payload->>'status','') NOT IN ('released','resolved')",[oid]),
    pool.query("SELECT count(*)::int n FROM module_records WHERE organization_id=$1 AND module='tasks' AND COALESCE(payload->>'status','open')='open'",[oid]),
    pool.query("SELECT count(*)::int n FROM invoices WHERE organization_id=$1 AND status <> 'paid'",[oid])
  ]);
  return {patients:p.rows[0].n,appointments:a.rows[0].n,waiting:q.rows[0].n,criticalLabs:l.rows[0].n,openTasks:t.rows[0].n,unpaid:i.rows[0].n};
});
app.get('/api/events',async(req:any)=>{
  if(!pool) return events.slice(-500).reverse();
  const r=await pool.query(`SELECT id,event_type AS "type",aggregate_type AS "aggregateType",aggregate_id AS "aggregateId",payload,status,attempts,available_at AS "availableAt",created_at AS "createdAt" FROM outbox_events WHERE organization_id=$1 ORDER BY created_at DESC LIMIT 500`,[dbOrganizationId(req)]);
  return r.rows;
});
app.get('/api/patients',async(req:any)=>{
  if(!pool) return {data:store.patients.filter(x=>x.organizationId===org(req)),count:store.patients.filter(x=>x.organizationId===org(req)).length};
  const q=String(req.query?.q||'').trim(); const params:any[]=[dbOrganizationId(req)];
  let where='p.organization_id=$1';
  if(q){ params.push(`%${q}%`); where += ' AND (p.patient_number ILIKE $2 OR p.first_name ILIKE $2 OR p.last_name ILIKE $2 OR COALESCE(p.phone,\'\') ILIKE $2)'; }
  const r=await pool.query(`SELECT p.id,p.organization_id AS "organizationId",p.facility_id AS "facilityId",p.patient_number AS "patientNumber",p.first_name AS "firstName",p.middle_name AS "middleName",p.last_name AS "lastName",p.date_of_birth AS "dateOfBirth",p.sex,p.phone,p.email,p.address,p.national_identifier AS "nationalId",p.preferred_language AS "preferredLanguage",p.status,p.created_at AS "createdAt",p.updated_at AS "updatedAt" FROM patients p WHERE ${where} ORDER BY p.created_at DESC LIMIT 100`,params);
  return {data:r.rows,count:r.rowCount};
});
app.get('/api/patients/:id',async(req:any,reply)=>{
  if(!pool) return reply.code(404).send({error:'Patient not found'});
  const r=await pool.query(`SELECT p.id,p.organization_id AS "organizationId",p.facility_id AS "facilityId",p.patient_number AS "patientNumber",p.first_name AS "firstName",p.middle_name AS "middleName",p.last_name AS "lastName",p.date_of_birth AS "dateOfBirth",p.sex,p.phone,p.email,p.address,p.national_identifier AS "nationalId",p.preferred_language AS "preferredLanguage",p.status,p.created_at AS "createdAt",p.updated_at AS "updatedAt" FROM patients p WHERE p.id=$1 AND p.organization_id=$2`,[req.params.id,dbOrganizationId(req)]);
  if(!r.rowCount) return reply.code(404).send({error:'Patient not found'}); return r.rows[0];
});
app.get('/api/appointments',async(req:any)=>{
  if(!pool) return {data:store.appointments.filter(x=>x.organizationId===org(req)),count:store.appointments.length};
  const params:any[]=[dbOrganizationId(req)]; let where='a.organization_id=$1';
  if(req.query?.patientId){params.push(String(req.query.patientId));where+=' AND a.patient_id=$2';}
  const x=await pool.query(`SELECT a.id,a.organization_id AS "organizationId",a.patient_id AS "patientId",a.provider_user_id AS "providerId",a.facility_id AS "facilityId",a.start_at AS "startAt",a.end_at AS "endAt",a.type,a.status,a.reason,a.created_at AS "createdAt" FROM appointments a WHERE ${where} ORDER BY a.start_at DESC LIMIT 200`,params); return {data:x.rows,count:x.rowCount};
});
app.get('/api/encounters',async(req:any)=>{
  if(!pool) return {data:store.encounters.filter(x=>x.organizationId===org(req)),count:store.encounters.length};
  const params:any[]=[dbOrganizationId(req)]; let where='e.organization_id=$1';
  if(req.query?.patientId){params.push(String(req.query.patientId));where+=' AND e.patient_id=$2';}
  const x=await pool.query(`SELECT e.id,e.organization_id AS "organizationId",e.patient_id AS "patientId",e.appointment_id AS "appointmentId",e.provider_user_id AS "providerId",e.facility_id AS "facilityId",e.type,e.status,e.started_at AS "startedAt",e.ended_at AS "endedAt" FROM encounters e WHERE ${where} ORDER BY e.started_at DESC LIMIT 200`,params); return {data:x.rows,count:x.rowCount};
});
app.post('/api/public/test-session',async(req:any,reply:any)=>{
  if(!pool)return reply.code(503).send({error:'Public synthetic workspace requires PostgreSQL'});
  if(!PUBLIC_TEST_DATA_ENABLED)return reply.code(403).send({error:'Public test data is currently disabled.'});
  try{
    const orgQ=await pool.query(`SELECT p.organization_id AS "organizationId",COUNT(*)::int AS total,COUNT(*) FILTER (WHERE p.is_test_data=true)::int AS synthetic FROM patients p WHERE p.is_test_data=true AND p.email ILIKE '%@clinaidemoemail.com' GROUP BY p.organization_id ORDER BY COUNT(*) DESC LIMIT 1`);
    if(!orgQ.rowCount || Number(orgQ.rows[0].total)!==Number(orgQ.rows[0].synthetic) || Number(orgQ.rows[0].synthetic)<1) return reply.code(503).send({error:'A dedicated synthetic test workspace is not available.'});
    const organizationId=orgQ.rows[0].organizationId;
    const token=await app.jwt.sign({sub:'system',organizationId,role:'admin',publicSynthetic:true}, {expiresIn:'2h'});
    return {data:{token,expiresInSeconds:7200,synthetic:true}};
  }catch{ return reply.code(503).send({error:'The public synthetic workspace could not be prepared.'}); }
});

app.post('/api/patients',async(req:any,reply)=>{
  const p=patient.parse(req.body);
  if(!pool) return reply.code(201).send(add('patients',{...p,patientNumber:`CLN-${String(store.patients.length+1).padStart(6,'0')}`,status:'active'},req));
  const client=await pool.connect();
  try{ await client.query('BEGIN');
    const duplicate=await client.query('SELECT id,patient_number AS "patientNumber",first_name AS "firstName",last_name AS "lastName",phone FROM patients WHERE organization_id=$1 AND phone IS NOT NULL AND phone=$2 AND lower(last_name)=lower($3) LIMIT 1',[dbOrganizationId(req),p.phone||null,p.lastName]);
    if(duplicate.rowCount){ await client.query('ROLLBACK'); return reply.code(409).send({error:'Possible duplicate patient',duplicate:duplicate.rows[0]}); }
    const seq=await client.query("SELECT COALESCE(MAX(CASE WHEN patient_number ~ '^CLN-[0-9]+$' THEN substring(patient_number from 5)::integer ELSE 0 END),0)+1 AS n FROM patients WHERE organization_id=$1",[dbOrganizationId(req)]);
    const number=`CLN-${String(seq.rows[0].n).padStart(6,'0')}`;
    const r=await client.query(`INSERT INTO patients(organization_id,facility_id,patient_number,first_name,middle_name,last_name,date_of_birth,sex,phone,email,national_identifier,preferred_language,address,is_test_data) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14) RETURNING id,organization_id AS "organizationId",facility_id AS "facilityId",patient_number AS "patientNumber",first_name AS "firstName",middle_name AS "middleName",last_name AS "lastName",date_of_birth AS "dateOfBirth",sex,phone,email,national_identifier AS "nationalId",preferred_language AS "preferredLanguage",address,status,created_at AS "createdAt",updated_at AS "updatedAt"`,[dbOrganizationId(req),p.facilityId||null,number,p.firstName,p.middleName||null,p.lastName,p.dateOfBirth||null,p.sex||null,p.phone||null,p.email||null,p.nationalId||null,p.preferredLanguage||null,p.address?JSON.stringify(p.address):null,Boolean(req.user?.publicSynthetic)]);
    await dbAudit(client,req,'CREATE','patient',r.rows[0].id,{patientNumber:number}); await queueEvent(client,req,CLINICAL_EVENT_TYPES.PATIENT_REGISTERED,{patientId:r.rows[0].id,patientNumber:number}); await client.query('COMMIT'); return reply.code(201).send(r.rows[0]);
  }catch(e:any){ await client.query('ROLLBACK'); if(e.code==='23505') return reply.code(409).send({error:'Patient number already exists'}); throw e; } finally{client.release();}
});
app.post('/api/patients/:id/contacts',async(req:any,reply)=>{ const c=contact.parse(req.body); if(!pool)return reply.code(201).send(add('patient-contacts',{patientId:req.params.id,...c},req)); const client=await pool.connect(); try{await client.query('BEGIN'); const ok=await client.query('SELECT id FROM patients WHERE id=$1 AND organization_id=$2',[req.params.id,dbOrganizationId(req)]); if(!ok.rowCount){await client.query('ROLLBACK');return reply.code(404).send({error:'Patient not found'});} if(c.isPrimary) await client.query('UPDATE patient_contacts SET is_primary=false WHERE patient_id=$1',[req.params.id]); const r=await client.query(`INSERT INTO patient_contacts(patient_id,type,value,is_primary) VALUES($1,$2,$3,$4) RETURNING id,type,value,is_primary AS "isPrimary"`,[req.params.id,c.type,c.value,c.isPrimary]); await dbAudit(client,req,'CREATE','patient_contact',r.rows[0].id,{patientId:req.params.id}); await client.query('COMMIT'); return reply.code(201).send(r.rows[0]); }catch(e){await client.query('ROLLBACK');throw e}finally{client.release()} });
app.post('/api/patients/:id/emergency-contacts',async(req:any,reply)=>{ const c=emergencyContact.parse(req.body); if(!pool)return reply.code(201).send(add('emergency-contacts',{patientId:req.params.id,...c},req)); const client=await pool.connect(); try{await client.query('BEGIN'); const ok=await client.query('SELECT id FROM patients WHERE id=$1 AND organization_id=$2',[req.params.id,dbOrganizationId(req)]); if(!ok.rowCount){await client.query('ROLLBACK');return reply.code(404).send({error:'Patient not found'});} const r=await client.query(`INSERT INTO emergency_contacts(patient_id,name,relationship,phone,address) VALUES($1,$2,$3,$4,$5) RETURNING id,name,relationship,phone,address`,[req.params.id,c.name,c.relationship||null,c.phone||null,c.address||null]); await dbAudit(client,req,'CREATE','emergency_contact',r.rows[0].id,{patientId:req.params.id}); await client.query('COMMIT'); return reply.code(201).send(r.rows[0]); }catch(e){await client.query('ROLLBACK');throw e}finally{client.release()} });
app.post('/api/patients/:id/allergies',async(req:any,reply)=>{ const a=allergy.parse(req.body); if(!pool)return reply.code(201).send(add('allergies',{patientId:req.params.id,...a},req)); const client=await pool.connect(); try{await client.query('BEGIN'); const ok=await client.query('SELECT id FROM patients WHERE id=$1 AND organization_id=$2',[req.params.id,dbOrganizationId(req)]); if(!ok.rowCount){await client.query('ROLLBACK');return reply.code(404).send({error:'Patient not found'});} const r=await client.query(`INSERT INTO allergies(patient_id,substance,reaction,severity,status) VALUES($1,$2,$3,$4,$5) RETURNING id,substance,reaction,severity,status`,[req.params.id,a.substance,a.reaction||null,a.severity||null,a.status]); await dbAudit(client,req,'CREATE','allergy',r.rows[0].id,{patientId:req.params.id,substance:a.substance}); await queueEvent(client,req,CLINICAL_EVENT_TYPES.ALLERGY_RECORDED,{allergyId:r.rows[0].id,patientId:req.params.id,substance:a.substance,severity:a.severity||null,status:a.status}); await client.query('COMMIT'); return reply.code(201).send(r.rows[0]); }catch(e){await client.query('ROLLBACK');throw e}finally{client.release()} });
app.post('/api/appointments',async(req:any,reply)=>{
  const a=appointment.parse(req.body);
  if(!pool) return reply.code(201).send(add('appointments',a,req));
  const client=await pool.connect(); try{ await client.query('BEGIN');
    const pc=await client.query('SELECT id FROM patients WHERE id=$1 AND organization_id=$2',[a.patientId,dbOrganizationId(req)]);
    if(!pc.rowCount){await client.query('ROLLBACK');return reply.code(400).send({error:'Patient not found'});}
    const end=new Date(new Date(a.startAt).getTime()+a.durationMinutes*60000).toISOString();
    const r=await client.query(`INSERT INTO appointments(organization_id,patient_id,provider_user_id,facility_id,start_at,end_at,type,reason,status) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING id,organization_id AS "organizationId",patient_id AS "patientId",provider_user_id AS "providerId",facility_id AS "facilityId",start_at AS "startAt",end_at AS "endAt",type,reason,status,created_at AS "createdAt"`,[dbOrganizationId(req),a.patientId,a.providerId||null,a.facilityId||null,a.startAt,end,a.type,a.reason||null,a.status]);
    await dbAudit(client,req,'CREATE','appointment',r.rows[0].id,{patientId:a.patientId}); await queueEvent(client,req,CLINICAL_EVENT_TYPES.APPOINTMENT_CREATED,{appointmentId:r.rows[0].id,patientId:a.patientId,encounterId:null,startAt:a.startAt,status:r.rows[0].status}); await client.query('COMMIT'); return reply.code(201).send(r.rows[0]);
  }catch(e){await client.query('ROLLBACK');throw e;}finally{client.release();}
});
app.post('/api/encounters',async(req:any,reply)=>{
  const e=encounter.parse(req.body);
  if(!pool) return reply.code(201).send(add('encounters',e,req));
  const client=await pool.connect(); try{await client.query('BEGIN');
    const r=await client.query(`INSERT INTO encounters(organization_id,patient_id,appointment_id,provider_user_id,facility_id,type,status) SELECT $1,$2,$3,$4,$5,$6,$7 WHERE EXISTS(SELECT 1 FROM patients WHERE id=$2 AND organization_id=$1) RETURNING id,organization_id AS "organizationId",patient_id AS "patientId",appointment_id AS "appointmentId",provider_user_id AS "providerId",facility_id AS "facilityId",type,status,started_at AS "startedAt"`,[dbOrganizationId(req),e.patientId,e.appointmentId||null,e.providerId||null,e.facilityId||null,e.type,e.status]);
    if(!r.rowCount){await client.query('ROLLBACK');return reply.code(400).send({error:'Patient not found'});}
    await dbAudit(client,req,'CREATE','encounter',r.rows[0].id,{patientId:e.patientId}); await enqueueClinicalEvent(client,{organizationId:dbOrganizationId(req),eventType:CLINICAL_EVENT_TYPES.ENCOUNTER_STARTED,aggregateType:'encounter',aggregateId:r.rows[0].id,patientId:e.patientId,encounterId:r.rows[0].id,payload:{encounterId:r.rows[0].id,patientId:e.patientId}}); await client.query('COMMIT'); return reply.code(201).send(r.rows[0]);
  }catch(err){await client.query('ROLLBACK');throw err;}finally{client.release();}
});
app.post('/api/triage',async(req:any,reply)=>{
  const t=triage.parse(req.body);
  if(!pool){const x=add('triage',{...t,status:'completed',completedAt:now()},req);add('queue',{patientId:t.patientId,encounterId:t.encounterId,status:t.acuity==='emergency'?'emergency':'waiting-doctor',priority:t.acuity},req);return reply.code(201).send(x);}
  const client=await pool.connect(); try{await client.query('BEGIN');
    const p=await client.query('SELECT id FROM patients WHERE id=$1 AND organization_id=$2',[t.patientId,dbOrganizationId(req)]); if(!p.rowCount){await client.query('ROLLBACK');return reply.code(404).send({error:'Patient not found'});}
    const record={...t,status:'completed',completedAt:now()};
    const tr=await client.query(`INSERT INTO module_records(organization_id,module,status,payload,created_by) VALUES($1,'triage','completed',$2,$3) RETURNING id,created_at AS "createdAt"`,[dbOrganizationId(req),JSON.stringify(record),dbUserId(req)]);
    const vitals:[string,number|undefined,string][]=[['temperature',t.temperature,'Cel'],['heart-rate',t.heartRate,'/min'],['respiratory-rate',t.respiratoryRate,'/min'],['systolic-blood-pressure',t.systolic,'mmHg'],['diastolic-blood-pressure',t.diastolic,'mmHg'],['oxygen-saturation',t.spo2,'%'],['pain-score',t.pain,'/10']];
    for(const [code,value,unit] of vitals) if(value!==undefined) await client.query(`INSERT INTO observations(patient_id,encounter_id,code_system,code,display,value_numeric,unit,performer_user_id) VALUES($1,$2,'LOINC',$3,$4,$5,$6,$7)`,[t.patientId,t.encounterId||null,code,code,value,unit,dbUserId(req)]);
    let q=await client.query("SELECT id FROM queues WHERE organization_id=$1 AND code='GENERAL' LIMIT 1",[dbOrganizationId(req)]); if(!q.rowCount) q=await client.query("INSERT INTO queues(organization_id,code,name) VALUES($1,'GENERAL','General Queue') RETURNING id",[dbOrganizationId(req)]);
    const status=t.acuity==='emergency'?'emergency':'waiting-doctor';
    const qe=await client.query('INSERT INTO queue_entries(queue_id,patient_id,priority,status) VALUES($1,$2,$3,$4) RETURNING id',[q.rows[0].id,t.patientId,t.acuity,status]);
    await dbAudit(client,req,'CREATE','triage',tr.rows[0].id,{patientId:t.patientId,acuity:t.acuity}); await enqueueClinicalEvent(client,{organizationId:dbOrganizationId(req),eventType:CLINICAL_EVENT_TYPES.VITAL_RECORDED,aggregateType:'triage',aggregateId:tr.rows[0].id,patientId:t.patientId,encounterId:t.encounterId||null,payload:{triageId:tr.rows[0].id,patientId:t.patientId,encounterId:t.encounterId||null,acuity:t.acuity}}); await client.query('COMMIT'); return reply.code(201).send({id:tr.rows[0].id,...record,queueEntryId:qe.rows[0].id});
  }catch(e){await client.query('ROLLBACK');throw e}finally{client.release()}
});
app.get('/api/orders',async(req:any)=>{if(!pool)return {data:store.orders||[],count:(store.orders||[]).length};const params:any[]=[dbOrganizationId(req)];let where='p.organization_id=$1';if(req.query?.patientId){params.push(String(req.query.patientId));where+=' AND o.patient_id=$2';}const r=await pool.query(`SELECT o.id,o.patient_id AS "patientId",o.encounter_id AS "encounterId",o.order_type AS category,o.priority,o.status,o.details,o.created_at AS "createdAt" FROM clinical_orders o JOIN patients p ON p.id=o.patient_id WHERE ${where} ORDER BY o.created_at DESC LIMIT 500`,params);return {data:r.rows,count:r.rowCount};});
app.post('/api/orders',async(req:any,reply)=>{
  const o=order.parse(req.body);
  if(!pool){const x=add('orders',{...o,status:'ordered',orderedAt:now()},req);if(o.category==='laboratory')add('laboratory',{orderId:x.id,patientId:o.patientId,status:'ordered',priority:o.priority,code:o.code,description:o.description},req);if(o.category==='imaging')add('imaging',{orderId:x.id,patientId:o.patientId,status:'ordered',priority:o.priority,code:o.code,description:o.description},req);if(o.category==='medication')add('pharmacy',{orderId:x.id,patientId:o.patientId,status:'prescribed',priority:o.priority,medicationCode:o.code,description:o.description},req);if(o.category==='procedure')add('procedures',{orderId:x.id,patientId:o.patientId,status:'ordered',code:o.code,description:o.description},req);return reply.code(201).send(x);}
  const client=await pool.connect();try{await client.query('BEGIN');
    const p=await client.query('SELECT id FROM patients WHERE id=$1 AND organization_id=$2',[o.patientId,dbOrganizationId(req)]);if(!p.rowCount){await client.query('ROLLBACK');return reply.code(404).send({error:'Patient not found'});}
    const r=await client.query(`INSERT INTO clinical_orders(patient_id,encounter_id,ordered_by,order_type,priority,status,details) VALUES($1,$2,$3,$4,$5,'ordered',$6) RETURNING id,patient_id AS "patientId",encounter_id AS "encounterId",order_type AS category,priority,status,details,created_at AS "createdAt"`,[o.patientId,o.encounterId||null,dbUserId(req),o.category,o.priority,JSON.stringify({code:o.code,description:o.description,...(o.details||{})})]);
    const routed=await client.query(`INSERT INTO module_records(organization_id,module,status,payload,created_by) VALUES($1,$2,'ordered',$3,$4) RETURNING id`,[dbOrganizationId(req),o.category,JSON.stringify({orderId:r.rows[0].id,patientId:o.patientId,encounterId:o.encounterId||null,code:o.code,description:o.description,priority:o.priority,status:'ordered'}),dbUserId(req)]);
    let sampleMeta:any=null; if(o.category==='laboratory'){ let test=await client.query(`SELECT id FROM lab_tests WHERE organization_id=$1 AND code=$2 LIMIT 1`,[dbOrganizationId(req),o.code]); if(!test.rowCount)test=await client.query(`INSERT INTO lab_tests(organization_id,code,name,active) VALUES($1,$2,$3,true) RETURNING id`,[dbOrganizationId(req),o.code,o.description||o.code]); const barcode=`CLN-${Date.now()}-${Math.random().toString(36).slice(2,8).toUpperCase()}`; const sample=await client.query(`INSERT INTO lab_samples(order_id,barcode,status) VALUES($1,$2,'ordered') RETURNING id,barcode,status`,[r.rows[0].id,barcode]); sampleMeta=sample.rows[0]; await client.query(`UPDATE module_records SET payload=payload || $1::jsonb WHERE id=$2`,[JSON.stringify({sampleId:sample.rows[0].id,barcode:sample.rows[0].barcode}),routed.rows[0].id]); }
    if(o.category==='laboratory') {
      let test=await client.query(`SELECT id FROM lab_tests WHERE organization_id=$1 AND code=$2 LIMIT 1`,[dbOrganizationId(req),o.code]);
      if(!test.rowCount) test=await client.query(`INSERT INTO lab_tests(organization_id,code,name,active) VALUES($1,$2,$3,true) RETURNING id`,[dbOrganizationId(req),o.code,o.description||o.code]);
      const barcode=`CLN-${Date.now()}-${Math.floor(Math.random()*100000)}`;
      const sample=await client.query(`INSERT INTO lab_samples(order_id,barcode,specimen_type,status) VALUES($1,$2,$3,'collected') RETURNING id,barcode`,[r.rows[0].id,barcode,o.details?.specimenType||null]);
      if(o.details?.valueNumeric!==undefined || o.details?.valueText!==undefined) await client.query(`INSERT INTO lab_results(sample_id,test_id,value_numeric,value_text,unit,abnormal_flag,critical,status) VALUES($1,$2,$3,$4,$5,$6,$7,'preliminary')`,[sample.rows[0].id,test.rows[0].id,o.details?.valueNumeric??null,o.details?.valueText??null,o.details?.unit??null,o.details?.abnormalFlag??null,Boolean(o.details?.critical)]);
    }
    await dbAudit(client,req,'CREATE','clinical_order',r.rows[0].id,{category:o.category,code:o.code,routedRecordId:routed.rows[0].id});await queueEvent(client,req,CLINICAL_EVENT_TYPES.ORDER_CREATED,{orderId:r.rows[0].id,category:o.category,patientId:o.patientId,encounterId:o.encounterId||null,code:o.code,description:o.description,priority:o.priority});await client.query('COMMIT');return reply.code(201).send(r.rows[0]);
  }catch(e){await client.query('ROLLBACK');throw e}finally{client.release()}
});


app.get('/api/laboratory',async(req:any)=>{
 if(!pool)return {data:store.laboratory||[],count:(store.laboratory||[]).length};
 const r=await pool.query(`SELECT ls.id,co.patient_id AS "patientId",co.encounter_id AS "encounterId",co.code,co.details->>'description' AS description,co.priority,ls.barcode,ls.specimen_type AS "specimenType",ls.status,ls.collected_at AS "collectedAt",ls.received_at AS "receivedAt",ls.processed_at AS "processedAt",lr.id AS "resultId",lr.value_numeric AS "valueNumeric",lr.value_text AS "valueText",lr.unit,lr.abnormal_flag AS "abnormalFlag",lr.critical,lr.status AS "resultStatus" FROM lab_samples ls JOIN clinical_orders co ON co.id=ls.order_id JOIN patients p ON p.id=co.patient_id LEFT JOIN lab_results lr ON lr.sample_id=ls.id WHERE p.organization_id=$1 ORDER BY ls.id DESC LIMIT 500`,[dbOrganizationId(req)]); return {data:r.rows,count:r.rowCount};
});
app.get('/api/imaging',async(req:any)=>{
 if(!pool)return {data:store.imaging||[],count:(store.imaging||[]).length};
 const r=await pool.query(`SELECT id,patient_id AS "patientId",encounter_id AS "encounterId",order_id AS "orderId",study_code AS "studyCode",study_name AS "studyName",modality,body_site AS "bodySite",priority,status,scheduled_at AS "scheduledAt",performed_at AS "performedAt",report,critical,report_verified_at AS "reportVerifiedAt",report_released_at AS "reportReleasedAt",created_at AS "createdAt" FROM imaging_studies WHERE organization_id=$1 ORDER BY created_at DESC LIMIT 500`,[dbOrganizationId(req)]); return {data:r.rows,count:r.rowCount};
});
app.get('/api/queue',async(req:any)=>{
  if(!pool) return {data:store.queue.filter(x=>x.organizationId===org(req)).sort((a,b)=>String(a.createdAt).localeCompare(String(b.createdAt))),count:store.queue.length};
  const oid=dbOrganizationId(req);
  const r=await pool.query(`SELECT qe.id, q.code AS "queueCode", q.name AS "queueName", qe.patient_id AS "patientId", qe.appointment_id AS "appointmentId", qe.priority, qe.status, qe.joined_at AS "joinedAt", qe.called_at AS "calledAt", qe.completed_at AS "completedAt" FROM queue_entries qe JOIN queues q ON q.id=qe.queue_id WHERE q.organization_id=$1 ORDER BY qe.joined_at ASC LIMIT 500`,[oid]);
  return {data:r.rows,count:r.rowCount};
});
app.post('/api/queue',async(req:any,reply)=>{
  const b=z.object({patientId:z.string().uuid(),appointmentId:z.string().uuid().optional(),facilityId:z.string().uuid().optional(),priority:z.enum(['normal','routine','urgent','emergency','stat']).default('normal'),status:z.string().default('waiting')}).parse(req.body);
  if(!pool)return reply.code(201).send(add('queue',b,req));
  const client=await pool.connect(); try{await client.query('BEGIN');
    const patient=await client.query('SELECT id FROM patients WHERE id=$1 AND organization_id=$2',[b.patientId,dbOrganizationId(req)]);
    if(!patient.rowCount){await client.query('ROLLBACK');return reply.code(404).send({error:'Patient not found'});}
    let q=await client.query("SELECT id FROM queues WHERE organization_id=$1 AND facility_id IS NOT DISTINCT FROM $2 AND code='GENERAL' LIMIT 1",[dbOrganizationId(req),b.facilityId||null]);
    if(!q.rowCount) q=await client.query('INSERT INTO queues(organization_id,facility_id,code,name) VALUES($1,$2,$3,$4) RETURNING id',[dbOrganizationId(req),b.facilityId||null,'GENERAL','General Queue']);
    const dup=await client.query("SELECT id FROM queue_entries WHERE queue_id=$1 AND patient_id=$2 AND status NOT IN ('completed','cancelled','no-show') LIMIT 1",[q.rows[0].id,b.patientId]);
    if(dup.rowCount){await client.query('ROLLBACK');return reply.code(409).send({error:'Patient already has an active queue entry',queueEntryId:dup.rows[0].id});}
    const r=await client.query(`INSERT INTO queue_entries(queue_id,patient_id,appointment_id,priority,status) VALUES($1,$2,$3,$4,$5) RETURNING id,patient_id AS "patientId",appointment_id AS "appointmentId",priority,status,joined_at AS "joinedAt"`,[q.rows[0].id,b.patientId,b.appointmentId||null,b.priority,b.status]);
    await dbAudit(client,req,'CREATE','queue_entry',r.rows[0].id,{patientId:b.patientId}); await queueEvent(client,req,CLINICAL_EVENT_TYPES.QUEUE_ENTERED,{queueEntryId:r.rows[0].id,patientId:b.patientId,appointmentId:b.appointmentId||null,status:b.status,priority:b.priority}); await client.query('COMMIT'); return reply.code(201).send(r.rows[0]);
  }catch(e){await client.query('ROLLBACK');throw e}finally{client.release()}
});



// Authoritative domain adapter. Generic module_records is intentionally not used for
// modules that already have a real PostgreSQL domain table. This keeps the UI, API and
// database on the same source of truth while preserving existing specialised workflows.
function camelOutput(value:any){return value}
function domainInputValue(field:any,value:any){
  if(value===undefined||value===null)return null;
  if(field.type==='number'){const n=Number(value);if(!Number.isFinite(n))throw validationError(`${field.label} must be a valid number.`);return n;}
  if(field.type==='boolean'){if(typeof value==='boolean')return value;if(value==='true')return true;if(value==='false')return false;throw validationError(`${field.label} must be true or false.`)}
  if(field.type==='uuid'){if(!isUuid(String(value)))throw validationError(`${field.label} must be a valid identifier.`);return String(value)}
  if(field.type==='date'||field.type==='datetime'){const d=new Date(String(value));if(Number.isNaN(d.getTime()))throw validationError(`${field.label} must be a valid date.`);return field.type==='date'?String(value).slice(0,10):d.toISOString();}
  if(field.type==='json'){
    if(typeof value==='object')return value;
    try{return JSON.parse(String(value))}catch{throw validationError(`${field.label} must contain valid structured data.`)}
  }
  const text=String(value).trim(); if(!text)throw validationError(`${field.label} cannot be empty.`); return text;
}
function domainSpec(moduleId:string){return DOMAIN_MODULE_SPECS[moduleId]||null}
function domainSelectFields(spec:any){return ['id','organization_id',...spec.fields.map((f:any)=>f.column),'created_at'].filter((x:string,i:number,a:string[])=>a.indexOf(x)===i)}
function domainToApi(row:any,spec:any){
  const out:any={id:row.id};
  for(const f of spec.fields){const v=row[f.column]; if(v!==undefined)out[f.key]=v}
  if(row.organization_id)out.organizationId=row.organization_id;
  if(row.created_at)out.createdAt=row.created_at;
  if(row.updated_at)out.updatedAt=row.updated_at;
  return out;
}
async function validateDomainPatient(req:any,patientId:string){
  if(!pool)return;
  const q=await pool.query(`SELECT id,is_test_data FROM patients WHERE id=$1 AND organization_id=$2 LIMIT 1`,[patientId,dbOrganizationId(req)]);
  if(!q.rowCount)throw Object.assign(new Error('Patient does not belong to the authorized organization.'),{statusCode:409,code:'PATIENT_RELATIONSHIP_INVALID'});
  if(req.user?.publicSynthetic && !q.rows[0].is_test_data)throw Object.assign(new Error('Public testing can only use synthetic TEST patients.'),{statusCode:403,code:'SYNTHETIC_DATA_ONLY'});
}
async function authoritativeModuleRows(req:any,reply:any){
  const moduleId=String(req.params.module),spec=domainSpec(moduleId);
  if(!spec)return reply.code(404).send({error:'Authoritative domain is not registered for this module.'});
  const oid=dbOrganizationId(req); if(!oid)return reply.code(401).send({error:'Organization context is required'});
  if(!pool)return {data:(store[moduleId]||[]).filter(x=>x.organizationId===oid),count:(store[moduleId]||[]).length,source:'store',module:moduleId};
  const columnRows=await pool.query(`SELECT column_name FROM information_schema.columns WHERE table_schema='public' AND table_name=$1`,[spec.table]);
  const availableColumns=new Set(columnRows.rows.map((x:any)=>String(x.column_name)));
  const hasOrg=availableColumns.has('organization_id');
  const hasCreatedAt=availableColumns.has('created_at');
  const hasObservedAt=availableColumns.has('observed_at');
  const params:any[]=[oid]; let where=hasOrg?'t.organization_id=$1':'1=1';
  const patientId=String(req.query?.patientId||'').trim(); const patientNumber=String(req.query?.patientNumber||'').trim();
  if(spec.patientField && patientId){params.push(patientId);where+=` AND t.${spec.patientField}=$${params.length}`; if(!hasOrg)where+=` AND EXISTS (SELECT 1 FROM patients pp WHERE pp.id=t.${spec.patientField} AND pp.organization_id=$1)`}
  if(spec.patientField && patientNumber){params.push(patientNumber);where+=` AND EXISTS (SELECT 1 FROM patients pp WHERE pp.id=t.${spec.patientField} AND pp.organization_id=$1 AND pp.patient_number=$${params.length})`}
  if(!hasOrg && !spec.patientField){const encounterField=spec.fields.find((f:any)=>f.column==='encounter_id'); if(encounterField)where+=` AND EXISTS (SELECT 1 FROM encounters ee WHERE ee.id=t.encounter_id AND ee.organization_id=$1)`; else if(spec.fields.find((f:any)=>f.column==='patient_id'))where+=` AND EXISTS (SELECT 1 FROM patients pp WHERE pp.id=t.patient_id AND pp.organization_id=$1)`;}
  const columns=domainSelectFields(spec).filter((c:string)=>availableColumns.has(c)).map((c:string)=>`t.${c}`).join(',');
  const orderColumn=hasCreatedAt?'created_at':hasObservedAt?'observed_at':'id';
  const r=await pool.query(`SELECT ${columns} FROM ${spec.table} t WHERE ${where} ORDER BY t.${orderColumn} DESC LIMIT 500`,params);
  return {data:r.rows.map((x:any)=>domainToApi(x,spec)),count:r.rowCount,source:spec.table,module:moduleId};
}
async function authoritativeModuleCreate(req:any,reply:any){
  const moduleId=String(req.params.module),spec=domainSpec(moduleId);
  if(!spec)return reply.code(404).send({error:'Authoritative domain is not registered for this module.'});
  requireAuthorizedWrite(req);
  const body=req.body||{};
  const values:any[]=[]; const columns:string[]=[];
  for(const field of spec.fields){
    const value=body[field.key];
    if(field.required && (value===undefined||value===null||String(value).trim()===''))throw validationError(`${field.label} is required.`);
    if(value===undefined||value===null||value==='')continue;
    if(field.options && !field.options.includes(String(value)))throw validationError(`${field.label} has an unsupported value.`);
    columns.push(field.column); values.push(domainInputValue(field,value));
  }
  const patientField=spec.patientField;
  if(patientField){
    const patientKey=spec.fields.find((f:any)=>f.column===patientField)?.key;
    if(patientKey && body[patientKey])await validateDomainPatient(req,String(body[patientKey]));
  }
  if(body.encounterId){
    const encounter=await pool?.query(`SELECT patient_id FROM encounters WHERE id=$1 AND organization_id=$2 LIMIT 1`,[String(body.encounterId),dbOrganizationId(req)]);
    if(!encounter?.rowCount)throw Object.assign(new Error('Encounter does not belong to the authorized organization.'),{statusCode:409,code:'ENCOUNTER_RELATIONSHIP_INVALID'});
    if(body.patientId && encounter.rows[0].patient_id!==String(body.patientId))throw Object.assign(new Error('Patient and encounter do not belong to the same care record.'),{statusCode:409,code:'PATIENT_RELATIONSHIP_INVALID'});
  }
  if(!columns.length)throw validationError('At least one meaningful field is required. Empty records are not allowed.');
  if(!pool){const row=add(moduleId,{...body,status:body.status||'active'},req);return reply.code(201).send({...row,source:'store'});}
  const hasCreatedBy=await pool.query(`SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name=$1 AND column_name='created_by'`,[spec.table]);
  if(hasCreatedBy.rowCount){columns.push('created_by');values.push(dbUserId(req));}
  const orgColumn=await pool.query(`SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name=$1 AND column_name='organization_id'`,[spec.table]);
  const hasOrg=Boolean(orgColumn.rowCount);
  if(hasOrg){columns.unshift('organization_id');values.unshift(dbOrganizationId(req));}
  const placeholders=values.map((_,i)=>`$${i+1}`).join(',');
  const returning=domainSelectFields(spec).join(',');
  const client=await pool.connect();
  try{
    await client.query('BEGIN');
    const r=await client.query(`INSERT INTO ${spec.table} (${columns.join(',')}) VALUES (${placeholders}) RETURNING ${returning}`,values);
    const row=r.rows[0];
    await dbAudit(client,req,'CREATE',moduleId,row.id,{source:spec.table});
    await client.query('COMMIT');
    return reply.code(201).send({...domainToApi(row,spec),source:spec.table});
  }catch(e){await client.query('ROLLBACK');throw e}finally{client.release()}
}
app.get('/api/domains/modules/:module', authoritativeModuleRows);
app.post('/api/domains/modules/:module', authoritativeModuleCreate);

// Phase 2 contract routes: modules without a domain-specific endpoint use an explicit
// contract endpoint. There is intentionally no /api/:module fallback anymore.
async function contractModuleRows(req:any, reply:any){
  const moduleId=String(req.params.module);
  const contract=MODULE_CONTRACT_BY_ID[moduleId];
  if(!contract)return reply.code(404).send({error:'Module contract not found'});
  const organizationId=dbOrganizationId(req);
  if(!organizationId)return reply.code(401).send({error:'Organization context is required'});
  if(!pool)return {data:(store[moduleId]||[]).filter(x=>x.organizationId===organizationId).slice(-500).reverse(),count:(store[moduleId]||[]).filter(x=>x.organizationId===organizationId).length,contractId:contract.id};
  const r=await pool.query(`SELECT id,organization_id AS "organizationId",module,status,payload,created_by AS "createdBy",created_at AS "createdAt",updated_at AS "updatedAt" FROM module_records WHERE organization_id=$1 AND module=$2 AND COALESCE(payload->>'coverageVersion','') <> '025' AND COALESCE(payload->>'recordPurpose','') <> 'connected synthetic testing' ORDER BY created_at DESC LIMIT 500`,[organizationId,moduleId]);
  return {data:r.rows.map((x:any)=>({id:x.id,organizationId:x.organizationId,module:x.module,status:x.status,...x.payload,createdBy:x.createdBy,createdAt:x.createdAt,updatedAt:x.updatedAt})),count:r.rowCount,contractId:contract.id};
}
app.get('/api/contracts/modules/:module', contractModuleRows);

app.post('/api/contracts/modules/:module',async(req:any,reply)=>{
  requireAuthorizedWrite(req);
  const moduleId=String(req.params.module);
  const contract=MODULE_CONTRACT_BY_ID[moduleId];
  if(!contract)return reply.code(404).send({error:'Module contract not found'});
  if(!contract.backend.createEndpoint)return reply.code(405).send({error:'This module is read-only'});
  const body=validateContractPayload(contract,generic.parse(req.body||{}));
  if(!pool){const row=add(moduleId,body,req);return reply.code(201).send({...row,contractId:contract.id});}
  const r=await pool.query(`INSERT INTO module_records(organization_id,module,status,payload,created_by) VALUES($1,$2,$3,$4,$5) RETURNING id,organization_id AS "organizationId",module,status,payload,created_by AS "createdBy",created_at AS "createdAt",updated_at AS "updatedAt"`,[dbOrganizationId(req),moduleId,body.status||'active',JSON.stringify(body),dbUserId(req)]);
  await pool.query('INSERT INTO audit_logs(organization_id,actor_user_id,action,entity_type,entity_id,metadata) VALUES($1,$2,$3,$4,$5,$6)',[dbOrganizationId(req),dbUserId(req),'CREATE',moduleId,r.rows[0].id,JSON.stringify({module:moduleId,contractId:contract.id})]);
  return reply.code(201).send({id:r.rows[0].id,organizationId:r.rows[0].organizationId,module:moduleId,status:r.rows[0].status,...r.rows[0].payload,createdBy:r.rows[0].createdBy,createdAt:r.rows[0].createdAt,updatedAt:r.rows[0].updatedAt,contractId:contract.id});
});

app.post('/api/workflows/:name',async(req:any,reply)=>{
  const b=(req.body||{}) as Row; const name=String(req.params.name); const oid=dbOrganizationId(req);
  if(!pool){
    let results:Row[]=[];
    switch(name){
      case'checkin':{const a=store.appointments.find(x=>x.id===b.appointmentId&&x.organizationId===org(req));if(!a)throw Object.assign(new Error('Appointment not found'),{statusCode:404});patch('appointments',a.id,{status:'arrived',arrivedAt:now()},req);results=[add('registration',{...b,status:'checked-in',checkedInAt:now()},req),add('queue',{patientId:b.patientId,appointmentId:b.appointmentId,status:'waiting-triage',priority:b.priority||'normal'},req)];break;}
      case'triage':results=[add('triage',{...b,status:'completed',completedAt:now()},req),add('queue',{patientId:b.patientId,status:b.acuity==='emergency'?'emergency':'waiting-doctor',priority:b.acuity||'routine'},req)];break;
      case'lab_result':results=[add('laboratory',{...b,status:'verified',verifiedAt:now()},req),add('notifications',{patientId:b.patientId,channel:b.channel||'in-app',template:b.critical?'critical-lab':'result-ready',status:'queued'},req),add('tasks',{patientId:b.patientId,type:b.critical?'critical-result-review':'result-review',status:'open',priority:b.critical?'critical':'normal'},req)];break;
      case'dispense':results=[add('pharmacy',{...b,status:'dispensed',dispensedAt:now()},req),add('inventory',{itemId:b.itemId,quantityDelta:-(b.quantity||1),movement:'dispense'},req),add('notifications',{patientId:b.patientId,channel:'in-app',template:'prescription-ready',status:'queued'},req)];break;
      case'discharge':results=[add('inpatient',{...b,status:'discharged',dischargedAt:now()},req),add('follow-up',{patientId:b.patientId,status:'due',dueAt:b.followUpDate||null},req),add('tasks',{patientId:b.patientId,type:'follow-up-booking',status:'open'},req)];break;
      case'payment':results=[add('payments',{...b,status:'completed',paidAt:now()},req),add('notifications',{patientId:b.patientId,channel:b.channel||'in-app',template:'payment-receipt',status:'queued'},req)];break;
      case'referral':results=[add('referrals',{...b,status:'sent',sentAt:now()},req),add('tasks',{patientId:b.patientId,type:'referral-tracking',status:'open'},req)];break;
      default:throw Object.assign(new Error('Workflow not implemented'),{statusCode:404});
    } return reply.code(201).send({workflow:name,results,eventId:randomUUID()});
  }
  const client=await pool.connect();
  try{await client.query('BEGIN'); let result:any;
    if(name==='checkin'){
      const a=await client.query(`UPDATE appointments SET status='arrived' WHERE id=$1 AND organization_id=$2 RETURNING id,patient_id AS "patientId",facility_id AS "facilityId"`,[b.appointmentId,oid]); if(!a.rowCount)return reply.code(404).send({error:'Appointment not found'});
      let q=await client.query(`SELECT id FROM queues WHERE organization_id=$1 AND code='OUTPATIENT' LIMIT 1`,[oid]); if(!q.rowCount)q=await client.query(`INSERT INTO queues(organization_id,facility_id,code,name) VALUES($1,$2,'OUTPATIENT','Outpatient Queue') RETURNING id`,[oid,a.rows[0].facilityId||null]);
      const qe=await client.query(`INSERT INTO queue_entries(queue_id,patient_id,appointment_id,priority,status) VALUES($1,$2,$3,$4,'waiting-triage') RETURNING id,patient_id AS "patientId",appointment_id AS "appointmentId",priority,status`,[q.rows[0].id,a.rows[0].patientId,b.appointmentId,b.priority||'normal']);
      result={appointment:a.rows[0],queue:qe.rows[0]};
      await dbAudit(client,req,'CHECK_IN','appointment',b.appointmentId,{queueEntryId:qe.rows[0].id});
      await enqueueClinicalEvent(client,{organizationId:oid,eventType:CLINICAL_EVENT_TYPES.APPOINTMENT_CHECKED_IN,aggregateType:'appointment',aggregateId:b.appointmentId,patientId:a.rows[0].patientId,payload:{appointmentId:b.appointmentId,queueEntryId:qe.rows[0].id}});
    } else if(name==='triage'){
      const p=await client.query(`SELECT id FROM patients WHERE id=$1 AND organization_id=$2`,[b.patientId,oid]);if(!p.rowCount)return reply.code(404).send({error:'Patient not found'});
      const tr=await client.query(`INSERT INTO module_records(organization_id,module,status,payload,created_by) VALUES($1,'triage','completed',$2,$3) RETURNING id,payload,status,created_at AS "createdAt"`,[oid,JSON.stringify({...b,status:'completed',completedAt:now()}),dbUserId(req)]);
      let q=await client.query(`SELECT id FROM queues WHERE organization_id=$1 AND code='GENERAL' LIMIT 1`,[oid]);if(!q.rowCount)q=await client.query(`INSERT INTO queues(organization_id,code,name) VALUES($1,'GENERAL','General Queue') RETURNING id`,[oid]);
      const qe=await client.query(`INSERT INTO queue_entries(queue_id,patient_id,priority,status) VALUES($1,$2,$3,$4) RETURNING id`,[q.rows[0].id,b.patientId,b.acuity||'routine',b.acuity==='emergency'?'emergency':'waiting-doctor']);result={triage:{id:tr.rows[0].id,...b,status:'completed'},queueEntryId:qe.rows[0].id};
      await dbAudit(client,req,'TRIAGE_COMPLETE','triage',tr.rows[0].id,{patientId:b.patientId,acuity:b.acuity||'routine'});
    } else if(name==='lab_result'){
      const sample=await client.query(`SELECT ls.id,co.patient_id AS "patientId" FROM lab_samples ls JOIN clinical_orders co ON co.id=ls.order_id JOIN patients p ON p.id=co.patient_id WHERE ls.id=$1 AND p.organization_id=$2 FOR UPDATE`,[b.sampleId,oid]);
      if(!sample.rowCount)return reply.code(404).send({error:'Lab sample not found'});
      let test=await client.query(`SELECT id FROM lab_tests WHERE organization_id=$1 AND (code=$2 OR lower(name)=lower($3)) LIMIT 1`,[oid,b.testCode||null,b.testName||'Lab Test']);if(!test.rowCount)test=await client.query(`INSERT INTO lab_tests(organization_id,code,name,unit,active) VALUES($1,$2,$3,$4,true) RETURNING id`,[oid,b.testCode||null,b.testName||'Lab Test',b.unit||null]);
      const lr=await client.query(`INSERT INTO lab_results(sample_id,test_id,value_numeric,value_text,unit,abnormal_flag,critical,status,verified_by,verified_at) VALUES($1,$2,$3,$4,$5,$6,$7,'preliminary',NULL,NULL) RETURNING id,sample_id AS "sampleId",value_numeric AS "valueNumeric",value_text AS "valueText",unit,abnormal_flag AS "abnormalFlag",critical,status,verified_at AS "verifiedAt"`,[b.sampleId,test.rows[0].id,b.valueNumeric??null,b.valueText??null,b.unit||null,b.abnormalFlag||null,Boolean(b.critical),dbUserId(req)]);
      await client.query(`UPDATE lab_samples SET status='processed',processed_at=now() WHERE id=$1`,[b.sampleId]);
      await client.query(`INSERT INTO module_records(organization_id,module,status,payload,created_by) VALUES($1,'tasks','open',$2,$3)`,[oid,JSON.stringify({patientId:sample.rows[0].patientId,type:Boolean(b.critical)?'critical-result-review':'result-review',status:'open',priority:Boolean(b.critical)?'critical':'normal',referenceId:lr.rows[0].id}),dbUserId(req)]);
      await client.query(`INSERT INTO notifications(organization_id,patient_id,channel,template,status,payload) VALUES($1,$2,'in-app',$3,'queued',$4)`,[oid,sample.rows[0].patientId,Boolean(b.critical)?'critical-lab':'result-ready',JSON.stringify({labResultId:lr.rows[0].id})]);
      result=lr.rows[0];
    } else if(name==='dispense'){
      const mo=await client.query(`SELECT mo.id,mo.patient_id AS "patientId",mo.quantity,mo.status FROM medication_orders mo JOIN patients p ON p.id=mo.patient_id WHERE mo.id=$1 AND p.organization_id=$2 FOR UPDATE`,[b.medicationOrderId,oid]);if(!mo.rowCount)return reply.code(404).send({error:'Medication order not found'});if(mo.rows[0].status!=='active')return reply.code(409).send({error:'Medication order is not active'});
      const qty=Number(b.quantity||mo.rows[0].quantity||1);if(qty<=0)return reply.code(400).send({error:'Quantity must be positive'});
      if(b.batchId){const stock=await client.query(`SELECT id,quantity FROM inventory_batches ib JOIN inventory_items ii ON ii.id=ib.item_id WHERE ib.id=$1 AND ii.organization_id=$2 FOR UPDATE`,[b.batchId,oid]);if(!stock.rowCount)return reply.code(404).send({error:'Inventory batch not found'});if(Number(stock.rows[0].quantity)<qty)return reply.code(409).send({error:'Insufficient stock',available:stock.rows[0].quantity});await client.query(`UPDATE inventory_batches SET quantity=quantity-$1 WHERE id=$2`,[qty,b.batchId]);await client.query(`INSERT INTO stock_movements(item_id,batch_id,movement_type,quantity,reference_type,reference_id,created_by) SELECT item_id,$1,'dispense',$2,'medication_order',$3,$4 FROM inventory_batches WHERE id=$1`,[b.batchId,qty,b.medicationOrderId,dbUserId(req)]);}
      const d=await client.query(`INSERT INTO dispensations(medication_order_id,quantity,batch,expiry_date,dispensed_by) VALUES($1,$2,$3,$4,$5) RETURNING id,medication_order_id AS "medicationOrderId",quantity,batch,expiry_date AS "expiryDate",dispensed_at AS "dispensedAt"`,[b.medicationOrderId,qty,b.batch||null,b.expiryDate||null,dbUserId(req)]);await client.query(`UPDATE medication_orders SET status='dispensed' WHERE id=$1`,[b.medicationOrderId]);result=d.rows[0];await dbAudit(client,req,'DISPENSE','medication_order',b.medicationOrderId,{quantity:qty,batchId:b.batchId||null});
    } else if(name==='discharge'){
      const e=await client.query(`UPDATE encounters SET status='discharged',ended_at=COALESCE(ended_at,now()) WHERE id=$1 AND organization_id=$2 RETURNING id,patient_id AS "patientId",status,ended_at AS "endedAt"`,[b.encounterId,oid]);if(!e.rowCount)return reply.code(404).send({error:'Encounter not found'});
      const f=await client.query(`INSERT INTO module_records(organization_id,module,status,payload,created_by) VALUES($1,'follow-up','due',$2,$3) RETURNING id,payload,status`,[oid,JSON.stringify({patientId:e.rows[0].patientId,encounterId:b.encounterId,dueAt:b.followUpDate||null,reason:b.followUpReason||'Post-discharge follow-up'}),dbUserId(req)]);
      const t=await client.query(`INSERT INTO module_records(organization_id,module,status,payload,created_by) VALUES($1,'tasks','open',$2,$3) RETURNING id,payload,status`,[oid,JSON.stringify({patientId:e.rows[0].patientId,type:'follow-up-booking',status:'open',priority:'normal',referenceId:f.rows[0].id}),dbUserId(req)]);result={encounter:e.rows[0],followUp:{id:f.rows[0].id,...f.rows[0].payload},task:{id:t.rows[0].id,...t.rows[0].payload}};await dbAudit(client,req,'DISCHARGE','encounter',b.encounterId,{followUpId:f.rows[0].id});
    } else if(name==='payment'){
      const inv=await client.query(`SELECT id,patient_id AS "patientId",total,status FROM invoices WHERE id=$1 AND organization_id=$2 FOR UPDATE`,[b.invoiceId,oid]);if(!inv.rowCount)return reply.code(404).send({error:'Invoice not found'});const paid=await client.query(`SELECT COALESCE(sum(amount),0)::numeric total FROM payments WHERE invoice_id=$1 AND status='completed'`,[b.invoiceId]);const amount=Number(b.amount||Number(inv.rows[0].total)-Number(paid.rows[0].total));if(amount<=0)return reply.code(400).send({error:'Payment amount must be positive'});const outstanding=Number(inv.rows[0].total)-Number(paid.rows[0].total);if(amount>outstanding+0.0001)return reply.code(400).send({error:'Payment exceeds outstanding balance',outstanding});const pay=await client.query(`INSERT INTO payments(invoice_id,method,provider_reference,amount,status,paid_at) VALUES($1,$2,$3,$4,'completed',now()) RETURNING id,invoice_id AS "invoiceId",method,provider_reference AS "providerReference",amount,status,paid_at AS "paidAt"`,[b.invoiceId,b.method||'cash',b.providerReference||null,amount]);const next=amount+Number(paid.rows[0].total)>=Number(inv.rows[0].total)?'paid':'partially-paid';await client.query(`UPDATE invoices SET status=$1 WHERE id=$2`,[next,b.invoiceId]);await client.query(`INSERT INTO accounting_entries(organization_id,account_code,description,entry_type,amount,currency,reference_type,reference_id,status,created_by) VALUES($1,'1100','Patient payment received','income',$2,COALESCE((SELECT currency FROM invoices WHERE id=$3),'UGX'),'payment',$4,'posted',$5) ON CONFLICT DO NOTHING`,[oid,amount,b.invoiceId,pay.rows[0].id,dbUserId(req)]);const claim=await client.query(`SELECT id,amount,coverage_amount,patient_responsibility FROM claims WHERE invoice_id=$1 ORDER BY submitted_at DESC NULLS LAST LIMIT 1`,[b.invoiceId]);const recon=await client.query(`SELECT id FROM finance_reconciliations WHERE invoice_id=$1 AND payment_id IS NULL ORDER BY created_at DESC LIMIT 1 FOR UPDATE`,[b.invoiceId]);if(recon.rowCount) await client.query(`UPDATE finance_reconciliations SET paid_amount=paid_amount+$1,status=CASE WHEN $2>=invoice_amount THEN 'reconciled' ELSE 'partially-paid' END,reconciled_at=CASE WHEN $2>=invoice_amount THEN now() ELSE reconciled_at END,notes=notes||jsonb_build_object('lastPaymentId',$3) WHERE id=$4`,[amount,Number(paid.rows[0].total)+amount,pay.rows[0].id,recon.rows[0].id]);else await client.query(`INSERT INTO finance_reconciliations(organization_id,invoice_id,claim_id,invoice_amount,claimed_amount,approved_amount,paid_amount,patient_responsibility,status,notes,created_by) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,[oid,b.invoiceId,claim.rows[0]?.id||null,Number(inv.rows[0].total),Number(claim.rows[0]?.amount||0),Number(claim.rows[0]?.coverage_amount||0),amount,Number(claim.rows[0]?.patient_responsibility||0),next==='paid'?'reconciled':'partially-paid',JSON.stringify({lastPaymentId:pay.rows[0].id}),dbUserId(req)]);result=pay.rows[0];await dbAudit(client,req,'PAY','invoice',b.invoiceId,{paymentId:pay.rows[0].id,amount});
    } else if(name==='referral'){
      const r=await client.query(`INSERT INTO referrals(patient_id,encounter_id,destination,reason,status) SELECT $1,$2,$3,$4,'sent' WHERE EXISTS(SELECT 1 FROM patients WHERE id=$1 AND organization_id=$5) RETURNING id,patient_id AS "patientId",encounter_id AS "encounterId",destination,reason,status,created_at AS "createdAt"`,[b.patientId,b.encounterId||null,b.destination||null,b.reason||'Referral',oid]);if(!r.rowCount)return reply.code(404).send({error:'Patient not found'});const t=await client.query(`INSERT INTO module_records(organization_id,module,status,payload,created_by) VALUES($1,'tasks','open',$2,$3) RETURNING id`,[oid,JSON.stringify({patientId:b.patientId,type:'referral-tracking',status:'open',priority:'normal',referenceId:r.rows[0].id}),dbUserId(req)]);result={referral:r.rows[0],taskId:t.rows[0].id};await dbAudit(client,req,'REFERRAL_SENT','referral',r.rows[0].id,{patientId:b.patientId});
    } else throw Object.assign(new Error('Workflow not implemented'),{statusCode:404});
    await client.query('COMMIT'); return reply.code(201).send({workflow:name,result});
  }catch(e:any){await client.query('ROLLBACK');throw e}finally{client.release()}
});

// --- Production-oriented workflow helpers ---
app.get('/api/patients/:id/360',async(req:any,reply)=>{
  if(!pool) { const p=store.patients.find(x=>x.id===req.params.id&&x.organizationId===org(req)); if(!p)return reply.code(404).send({error:'Patient not found'}); const related=(m:Mod)=>store[m].filter(x=>x.patientId===p.id).sort((a,b)=>String(b.createdAt).localeCompare(String(a.createdAt))); return {patient:p,contacts:store['patient-contacts'].filter(x=>x.patientId===p.id),emergencyContacts:store['emergency-contacts'].filter(x=>x.patientId===p.id),allergies:store.allergies.filter(x=>x.patientId===p.id),timeline:[...related('encounters'),...related('orders'),...related('triage'),...related('laboratory'),...related('pharmacy'),...related('billing'),...related('payments'),...related('referrals'),...related('follow-up')].sort((a,b)=>String(b.createdAt).localeCompare(String(a.createdAt))),alerts:store.notifications.filter(x=>x.patientId===p.id&&x.status!=='resolved')}; }
  const patientQ=await pool.query(`SELECT p.id,p.organization_id AS "organizationId",p.facility_id AS "facilityId",p.patient_number AS "patientNumber",p.first_name AS "firstName",p.middle_name AS "middleName",p.last_name AS "lastName",p.date_of_birth AS "dateOfBirth",p.sex,p.phone,p.email,p.address,p.national_identifier AS "nationalId",p.preferred_language AS "preferredLanguage",p.status,p.created_at AS "createdAt",p.updated_at AS "updatedAt" FROM patients p WHERE p.id=$1 AND p.organization_id=$2`,[req.params.id,dbOrganizationId(req)]);
  if(!patientQ.rowCount)return reply.code(404).send({error:'Patient not found'}); const id=req.params.id;
  const [contacts,emergency,allergies,appointments,encounters,orders,diagnoses,observations,notes,medications,notifications,admissions,immunizations,chronicCare,telemedicine,remoteMonitoring,carePlans,referrals,followUp,careTasks,clinicalAlerts,invoices,claims,policies,payments,financeReconciliation]=await Promise.all([
    pool.query(`SELECT id,type,value,is_primary AS "isPrimary" FROM patient_contacts WHERE patient_id=$1 ORDER BY is_primary DESC,id`,[id]),
    pool.query(`SELECT id,name,relationship,phone,address FROM emergency_contacts WHERE patient_id=$1 ORDER BY id`,[id]),
    pool.query(`SELECT id,substance,reaction,severity,status FROM allergies WHERE patient_id=$1 ORDER BY id DESC`,[id]),
    pool.query(`SELECT id,patient_id AS "patientId",provider_user_id AS "providerId",facility_id AS "facilityId",start_at AS "startAt",end_at AS "endAt",type,status,reason,created_at AS "createdAt" FROM appointments WHERE patient_id=$1 AND organization_id=$2 ORDER BY start_at DESC LIMIT 50`,[id,dbOrganizationId(req)]),
    pool.query(`SELECT id,appointment_id AS "appointmentId",provider_user_id AS "providerId",facility_id AS "facilityId",type,status,started_at AS "startedAt",ended_at AS "endedAt" FROM encounters WHERE patient_id=$1 AND organization_id=$2 ORDER BY started_at DESC LIMIT 50`,[id,dbOrganizationId(req)]),
    pool.query(`SELECT id,encounter_id AS "encounterId",order_type AS "category",priority,status,details,created_at AS "createdAt" FROM clinical_orders WHERE patient_id=$1 ORDER BY created_at DESC LIMIT 100`,[id]),
    pool.query(`SELECT id,encounter_id AS "encounterId",code_system AS "codeSystem",code,display,diagnosis_type AS "diagnosisType",status FROM diagnoses WHERE patient_id=$1 ORDER BY id DESC LIMIT 100`,[id]),
    pool.query(`SELECT id,encounter_id AS "encounterId",code_system AS "codeSystem",code,display,value_numeric AS "valueNumeric",value_text AS "valueText",unit,observed_at AS "observedAt" FROM observations WHERE patient_id=$1 ORDER BY observed_at DESC LIMIT 100`,[id]),
    pool.query(`SELECT n.id,n.encounter_id AS "encounterId",n.note_type AS "noteType",n.subjective,n.objective,n.assessment,n.plan,n.signed_at AS "signedAt",n.version FROM clinical_notes n JOIN encounters e ON e.id=n.encounter_id WHERE e.patient_id=$1 AND e.organization_id=$2 ORDER BY n.id DESC LIMIT 100`,[id,dbOrganizationId(req)]),
    pool.query(`SELECT mo.id,mo.encounter_id AS "encounterId",mo.dose,mo.frequency,mo.route,mo.duration,mo.quantity,mo.status,m.id AS "medicationId",m.code AS "medicationCode",m.name,m.strength,m.form FROM medication_orders mo JOIN medications m ON m.id=mo.medication_id JOIN patients p ON p.id=mo.patient_id WHERE mo.patient_id=$1 AND p.organization_id=$2 ORDER BY mo.id DESC LIMIT 100`,[id,dbOrganizationId(req)]),
    pool.query(`SELECT id,channel,template,status,payload,scheduled_at AS "scheduledAt",sent_at AS "sentAt" FROM notifications WHERE patient_id=$1 AND organization_id=$2 ORDER BY created_at DESC LIMIT 50`,[id,dbOrganizationId(req)]),
    pool.query(`SELECT id,encounter_id AS "encounterId",ward,bed,status,admitted_at AS "admittedAt",discharged_at AS "dischargedAt",discharge_summary AS "dischargeSummary" FROM admissions WHERE patient_id=$1 AND organization_id=$2 ORDER BY admitted_at DESC LIMIT 50`,[id,dbOrganizationId(req)]),
    pool.query(`SELECT id,vaccine_code AS "vaccineCode",vaccine_name AS "vaccineName",dose_number AS "doseNumber",administered_at AS "administeredAt",lot_number AS "lotNumber",expiry_date AS "expiryDate",route,site,status,next_due_at AS "nextDueAt" FROM immunizations WHERE patient_id=$1 AND organization_id=$2 ORDER BY administered_at DESC LIMIT 100`,[id,dbOrganizationId(req)]),
    pool.query(`SELECT id,encounter_id AS "encounterId",condition_code AS "conditionCode",condition_name AS "conditionName",status,risk_level AS "riskLevel",next_review_at AS "nextReviewAt",goals,measures,medications,care_plan AS "carePlan" FROM chronic_care_records WHERE patient_id=$1 AND organization_id=$2 ORDER BY updated_at DESC LIMIT 50`,[id,dbOrganizationId(req)]),
    pool.query(`SELECT id,appointment_id AS "appointmentId",encounter_id AS "encounterId",scheduled_at AS "scheduledAt",status,meeting_url AS "meetingUrl",identity_verified AS "identityVerified",consent_confirmed AS "consentConfirmed",started_at AS "startedAt",ended_at AS "endedAt",notes FROM telemedicine_sessions WHERE patient_id=$1 AND organization_id=$2 ORDER BY scheduled_at DESC LIMIT 50`,[id,dbOrganizationId(req)]),
    pool.query(`SELECT id,device_id AS "deviceId",metric,value_numeric AS "valueNumeric",unit,measured_at AS "measuredAt",source,validation_status AS "validationStatus",alert_status AS "alertStatus" FROM remote_monitoring_readings WHERE patient_id=$1 AND organization_id=$2 ORDER BY measured_at DESC LIMIT 100`,[id,dbOrganizationId(req)]),
    pool.query(`SELECT id,encounter_id AS "encounterId",title,status,goals FROM care_plans WHERE patient_id=$1 ORDER BY id DESC LIMIT 50`,[id]),
    pool.query(`SELECT id,encounter_id AS "encounterId",destination,reason,status,created_at AS "createdAt" FROM referrals WHERE patient_id=$1 ORDER BY created_at DESC LIMIT 50`,[id]),
    pool.query(`SELECT id,module,status,payload,created_at AS "createdAt",updated_at AS "updatedAt" FROM module_records WHERE organization_id=$2 AND payload->>'patientId'=$1 AND module IN ('follow-up','followup') AND COALESCE(payload->>'coverageVersion','') <> '025' AND COALESCE(payload->>'recordPurpose','') <> 'connected synthetic testing' ORDER BY created_at DESC LIMIT 50`,[id,dbOrganizationId(req)]),
    pool.query(`SELECT id,encounter_id AS "encounterId",task_type AS "taskType",title,priority,status,due_at AS "dueAt",assigned_to AS "assignedTo",created_at AS "createdAt",completed_at AS "completedAt" FROM care_tasks WHERE patient_id=$1 AND organization_id=$2 ORDER BY created_at DESC LIMIT 100`,[id,dbOrganizationId(req)]),
    pool.query(`SELECT id,COALESCE(payload->>'kind',module) AS kind,COALESCE(payload->>'severity','') AS severity,status,payload,created_at AS "createdAt" FROM module_records WHERE organization_id=$2 AND payload->>'patientId'=$1 AND module IN ('clinical-alerts','care-gaps') AND COALESCE(payload->>'coverageVersion','') <> '025' AND COALESCE(payload->>'recordPurpose','') <> 'connected synthetic testing' AND status NOT IN ('resolved','closed','completed') ORDER BY created_at DESC LIMIT 50`,[id,dbOrganizationId(req)]),
    pool.query(`SELECT i.id,i.encounter_id AS "encounterId",i.status,i.currency,i.total,i.created_at AS "createdAt",COALESCE((SELECT SUM(p.amount) FROM payments p WHERE p.invoice_id=i.id AND p.status='completed'),0)::numeric AS "paidAmount",GREATEST(i.total-COALESCE((SELECT SUM(p.amount) FROM payments p WHERE p.invoice_id=i.id AND p.status='completed'),0),0)::numeric AS "outstandingAmount" FROM invoices i WHERE i.patient_id=$1 AND i.organization_id=$2 ORDER BY i.created_at DESC LIMIT 50`,[id,dbOrganizationId(req)]),
    pool.query(`SELECT c.id,c.policy_id AS "policyId",c.invoice_id AS "invoiceId",c.status,c.amount,c.coverage_amount AS "coverageAmount",c.patient_responsibility AS "patientResponsibility",c.submitted_at AS "submittedAt",c.responded_at AS "respondedAt",ip.policy_number AS "policyNumber",pr.name AS "providerName" FROM claims c LEFT JOIN insurance_policies ip ON ip.id=c.policy_id LEFT JOIN insurance_providers pr ON pr.id=ip.provider_id WHERE c.patient_id=$1 ORDER BY c.submitted_at DESC NULLS LAST LIMIT 50`,[id]),
    pool.query(`SELECT ip.id,ip.policy_number AS "policyNumber",ip.member_number AS "memberNumber",ip.status,ip.effective_from AS "effectiveFrom",ip.effective_to AS "effectiveTo",ip.copay_percent AS "copayPercent",pr.name AS "providerName" FROM insurance_policies ip JOIN insurance_providers pr ON pr.id=ip.provider_id WHERE ip.patient_id=$1 ORDER BY ip.id DESC LIMIT 20`,[id]),
    pool.query(`SELECT py.id,py.invoice_id AS "invoiceId",py.method,py.provider_reference AS "providerReference",py.amount,py.status,py.paid_at AS "paidAt" FROM payments py JOIN invoices i ON i.id=py.invoice_id WHERE i.patient_id=$1 AND i.organization_id=$2 ORDER BY py.paid_at DESC NULLS LAST LIMIT 50`,[id,dbOrganizationId(req)]),
    pool.query(`SELECT fr.id,fr.invoice_id AS "invoiceId",fr.claim_id AS "claimId",fr.invoice_amount AS "invoiceAmount",fr.claimed_amount AS "claimedAmount",fr.approved_amount AS "approvedAmount",fr.paid_amount AS "paidAmount",fr.patient_responsibility AS "patientResponsibility",fr.status,fr.reconciled_at AS "reconciledAt" FROM finance_reconciliations fr JOIN invoices i ON i.id=fr.invoice_id WHERE i.patient_id=$1 AND fr.organization_id=$2 ORDER BY fr.created_at DESC LIMIT 50`,[id,dbOrganizationId(req)])
  ]);
  return {patient:patientQ.rows[0],contacts:contacts.rows,emergencyContacts:emergency.rows,allergies:allergies.rows,appointments:appointments.rows,encounters:encounters.rows,orders:orders.rows,diagnoses:diagnoses.rows,observations:observations.rows,clinicalNotes:notes.rows,medications:medications.rows,notifications:notifications.rows,admissions:admissions.rows,immunizations:immunizations.rows,chronicCare:chronicCare.rows,telemedicine:telemedicine.rows,remoteMonitoring:remoteMonitoring.rows,carePlans:carePlans.rows,referrals:referrals.rows,followUp:followUp.rows,careTasks:careTasks.rows,clinicalAlerts:clinicalAlerts.rows,invoices:invoices.rows,claims:claims.rows,insurancePolicies:policies.rows,payments:payments.rows,financeReconciliation:financeReconciliation.rows};
});
app.post('/api/queue/:id/transition',async(req:any,reply)=>{const next=String(req.body?.status||'');const allowed=['waiting','called','in-service','completed','cancelled','no-show','waiting-triage','waiting-doctor','emergency'];if(!allowed.includes(next))return reply.code(400).send({error:'Invalid queue status'});if(!pool){const q=store.queue.find(x=>x.id===req.params.id&&x.organizationId===org(req));if(!q)return reply.code(404).send({error:'Queue entry not found'});const from=q.status;const updated=patch('queue',q.id,{status:next,calledAt:next==='called'?now():q.calledAt,completedAt:next==='completed'?now():q.completedAt},req);events.push({id:randomUUID(),type:'queue.transitioned',from,to:next,resourceId:q.id,at:now()});persist();return updated;}const r=await pool.query(`UPDATE queue_entries qe SET status=$1,called_at=CASE WHEN $1='called' THEN now() ELSE qe.called_at END,completed_at=CASE WHEN $1='completed' THEN now() ELSE qe.completed_at END FROM queues q WHERE qe.id=$2 AND qe.queue_id=q.id AND q.organization_id=$3 RETURNING qe.id,qe.patient_id AS "patientId",qe.status,qe.priority,qe.joined_at AS "joinedAt",qe.called_at AS "calledAt",qe.completed_at AS "completedAt"`,[next,req.params.id,dbOrganizationId(req)]);if(!r.rowCount)return reply.code(404).send({error:'Queue entry not found'});await pool.query('INSERT INTO audit_logs(organization_id,actor_user_id,action,entity_type,entity_id,metadata) VALUES($1,$2,$3,$4,$5,$6)',[dbOrganizationId(req),dbUserId(req),'TRANSITION','queue_entry',req.params.id,JSON.stringify({status:next})]);return r.rows[0];});
app.post('/api/pharmacy/:id/dispense',async(req:any,reply)=>{
  if(pool){const client=await pool.connect();try{await client.query('BEGIN');
    const o=await client.query(`SELECT mo.id,mo.patient_id AS "patientId",mo.quantity,mo.status,m.name AS "medicationName",m.code AS "medicationCode" FROM medication_orders mo JOIN medications m ON m.id=mo.medication_id WHERE mo.id=$1 AND EXISTS(SELECT 1 FROM patients p WHERE p.id=mo.patient_id AND p.organization_id=$2) FOR UPDATE`,[req.params.id,dbOrganizationId(req)]);
    if(!o.rowCount){await client.query('ROLLBACK');return reply.code(404).send({error:'Pharmacy order not found'});}
    if(!['active','partially-dispensed'].includes(o.rows[0].status)){await client.query('ROLLBACK');return reply.code(409).send({error:`Medication order is ${o.rows[0].status}`});}
    const qty=Number(req.body?.quantity||o.rows[0].quantity||1);if(qty<=0){await client.query('ROLLBACK');return reply.code(400).send({error:'Quantity must be positive'});}
    const already=await client.query(`SELECT COALESCE(SUM(quantity),0)::numeric total FROM dispensations WHERE medication_order_id=$1`,[req.params.id]);
    const remaining=Number(o.rows[0].quantity||0)-Number(already.rows[0].total||0);if(qty>remaining+0.0001){await client.query('ROLLBACK');return reply.code(400).send({error:'Dispensing quantity exceeds the remaining prescribed quantity',remaining});}
    let batchId=req.body?.batchId||null; let batchMeta:any=null;
    if(!batchId){const stock=await client.query(`SELECT ib.id,ib.item_id,ib.quantity,ib.batch_number AS "batchNumber",ib.expiry_date AS "expiryDate" FROM inventory_batches ib JOIN inventory_items ii ON ii.id=ib.item_id WHERE ii.organization_id=$1 AND (ii.sku=$2 OR lower(ii.name)=lower($3)) AND ib.quantity>0 ORDER BY ib.expiry_date NULLS LAST,ib.id LIMIT 1 FOR UPDATE`,[dbOrganizationId(req),o.rows[0].medicationCode||null,o.rows[0].medicationName]);if(stock.rowCount)batchId=stock.rows[0].id;}
    if(batchId){const stock=await client.query(`SELECT ib.id,ib.item_id,ib.quantity,ib.batch_number AS "batchNumber",ib.expiry_date AS "expiryDate" FROM inventory_batches ib JOIN inventory_items ii ON ii.id=ib.item_id WHERE ib.id=$1 AND ii.organization_id=$2 FOR UPDATE`,[batchId,dbOrganizationId(req)]);if(!stock.rowCount){await client.query('ROLLBACK');return reply.code(404).send({error:'Inventory batch not found'});}if(Number(stock.rows[0].quantity)<qty){await client.query('ROLLBACK');return reply.code(409).send({error:'Insufficient stock',available:Number(stock.rows[0].quantity)});}await client.query(`UPDATE inventory_batches SET quantity=quantity-$1 WHERE id=$2`,[qty,batchId]);await client.query(`INSERT INTO stock_movements(item_id,batch_id,movement_type,quantity,reference_type,reference_id,created_by) VALUES($1,$2,'dispense',$3,'medication_order',$4,$5)`,[stock.rows[0].item_id,batchId,qty,req.params.id,dbUserId(req)]);batchMeta={batchId,batch:stock.rows[0].batchNumber,expiryDate:stock.rows[0].expiryDate};}
    const d=await client.query(`INSERT INTO dispensations(medication_order_id,quantity,batch,expiry_date,dispensed_by) VALUES($1,$2,$3,$4,$5) RETURNING id,medication_order_id AS "medicationOrderId",quantity,batch,expiry_date AS "expiryDate",dispensed_at AS "dispensedAt"`,[req.params.id,qty,batchMeta?.batch||req.body?.batch||null,batchMeta?.expiryDate||req.body?.expiryDate||null,dbUserId(req)]);
    const next=remaining-qty>0.0001?'partially-dispensed':'dispensed';await client.query(`UPDATE medication_orders SET status=$1 WHERE id=$2`,[next,req.params.id]);
    await client.query(`INSERT INTO notifications(organization_id,patient_id,channel,template,status,payload) VALUES($1,$2,'in-app','prescription-ready','queued',$3)`,[dbOrganizationId(req),o.rows[0].patientId,JSON.stringify({medicationOrderId:req.params.id,quantity:qty,batchId})]);
    await dbAudit(client,req,'DISPENSE','medication_order',req.params.id,{quantity:qty,batchId});await enqueueClinicalEvent(client,{organizationId:dbOrganizationId(req),eventType:CLINICAL_EVENT_TYPES.MEDICATION_DISPENSED,aggregateType:'medication_order',aggregateId:req.params.id,patientId:o.rows[0].patientId,payload:{medicationOrderId:req.params.id,patientId:o.rows[0].patientId,medicationName:o.rows[0].medicationName,medicationCode:o.rows[0].medicationCode,quantity:qty,batchId}});
    await client.query('COMMIT');return {...o.rows[0],status:next,dispensation:d.rows[0],inventory:batchMeta};
  }catch(e){await client.query('ROLLBACK');throw e}finally{client.release()}}
  const x=store.pharmacy.find(v=>v.id===req.params.id);if(!x)throw Object.assign(new Error('Pharmacy order not found'),{statusCode:404});const qty=Number(req.body?.quantity||1);if(qty<=0)throw Object.assign(new Error('Quantity must be positive'),{statusCode:400});patch('pharmacy',x.id,{status:'dispensed',quantity:qty,dispensedAt:now(),dispensedBy:actor(req)},req);add('inventory',{itemId:req.body?.itemId||x.medicationCode,quantityDelta:-qty,movement:'dispense',referenceId:x.id},req);add('notifications',{patientId:x.patientId,channel:'in-app',template:'prescription-ready',status:'queued'},req);return store.pharmacy.find(v=>v.id===x.id)});
app.post('/api/billing/:id/pay',async(req:any,reply)=>{
  if(pool){const client=await pool.connect();try{await client.query('BEGIN');const oid=dbOrganizationId(req);
    const inv=await client.query(`SELECT id,patient_id AS "patientId",total,status,currency FROM invoices WHERE id=$1 AND organization_id=$2 FOR UPDATE`,[req.params.id,oid]);if(!inv.rowCount){await client.query('ROLLBACK');return reply.code(404).send({error:'Invoice not found'});}
    const amount=Number(req.body?.amount||inv.rows[0].total||0);if(amount<=0){await client.query('ROLLBACK');return reply.code(400).send({error:'Payment amount must be positive'});}
    const paid=await client.query(`SELECT COALESCE(SUM(amount),0)::numeric total FROM payments WHERE invoice_id=$1 AND status='completed'`,[req.params.id]);const outstanding=Number(inv.rows[0].total)-Number(paid.rows[0].total);if(amount>outstanding+0.0001){await client.query('ROLLBACK');return reply.code(400).send({error:'Payment exceeds outstanding balance',outstanding});}
    const payment=await client.query(`INSERT INTO payments(invoice_id,method,provider_reference,amount,status,paid_at) VALUES($1,$2,$3,$4,'completed',now()) RETURNING id,invoice_id AS "invoiceId",method,provider_reference AS "providerReference",amount,status,paid_at AS "paidAt"`,[req.params.id,req.body?.method||'cash',req.body?.providerReference||null,amount]);
    const newPaid=Number(paid.rows[0].total)+amount;const next=newPaid>=Number(inv.rows[0].total)?'paid':'partially-paid';await client.query(`UPDATE invoices SET status=$1 WHERE id=$2`,[next,req.params.id]);
    await client.query(`INSERT INTO accounting_entries(organization_id,account_code,description,entry_type,amount,currency,reference_type,reference_id,status,created_by) VALUES($1,'1100','Patient payment received','income',$2,$3,'payment',$4,'posted',$5) ON CONFLICT DO NOTHING`,[oid,amount,inv.rows[0].currency,payment.rows[0].id,dbUserId(req)]);
    const claim=await client.query(`SELECT id,amount,coverage_amount,patient_responsibility,status FROM claims WHERE invoice_id=$1 ORDER BY submitted_at DESC NULLS LAST LIMIT 1`,[req.params.id]);
    const recon=await client.query(`SELECT id,invoice_amount,claimed_amount,approved_amount,paid_amount,patient_responsibility,status FROM finance_reconciliations WHERE invoice_id=$1 AND payment_id IS NULL ORDER BY created_at DESC LIMIT 1 FOR UPDATE`,[req.params.id]);
    const patientResp=claim.rowCount?Number(claim.rows[0].patient_responsibility||0):Math.max(Number(inv.rows[0].total)-Number(claim.rows[0]?.coverage_amount||0),0);
    if(recon.rowCount) await client.query(`UPDATE finance_reconciliations SET paid_amount=paid_amount+$1,status=CASE WHEN $2>=invoice_amount THEN 'reconciled' WHEN $2>0 THEN 'partially-paid' ELSE status END,reconciled_at=CASE WHEN $2>=invoice_amount THEN now() ELSE reconciled_at END,notes=notes||jsonb_build_object('lastPaymentId',$3) WHERE id=$4`,[amount,newPaid,payment.rows[0].id,recon.rows[0].id]);
    else await client.query(`INSERT INTO finance_reconciliations(organization_id,invoice_id,claim_id,invoice_amount,claimed_amount,approved_amount,paid_amount,patient_responsibility,status,notes,created_by) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,[oid,req.params.id,claim.rows[0]?.id||null,Number(inv.rows[0].total),Number(claim.rows[0]?.amount||0),Number(claim.rows[0]?.coverage_amount||0),amount,patientResp,newPaid>=Number(inv.rows[0].total)?'reconciled':'partially-paid',JSON.stringify({lastPaymentId:payment.rows[0].id}),dbUserId(req)]);
    await client.query(`INSERT INTO notifications(organization_id,patient_id,channel,template,status,payload) VALUES($1,$2,'in-app','payment-receipt','queued',$3)`,[oid,inv.rows[0].patientId,JSON.stringify({paymentId:payment.rows[0].id})]);await dbAudit(client,req,'PAY','invoice',req.params.id,{paymentId:payment.rows[0].id,amount});await queueEvent(client,req,'invoice.paid',{invoiceId:req.params.id,paymentId:payment.rows[0].id,amount});await client.query('COMMIT');return payment.rows[0];
  }catch(e){await client.query('ROLLBACK');throw e}finally{client.release()}}
  const inv=store.billing.find(v=>v.id===req.params.id);if(!inv)throw Object.assign(new Error('Invoice not found'),{statusCode:404});const amount=Number(req.body?.amount||0);if(amount<=0)throw Object.assign(new Error('Payment amount must be positive'),{statusCode:400});const payment=add('payments',{invoiceId:inv.id,patientId:inv.patientId,amount,method:req.body?.method||'cash',status:'completed',paidAt:now()},req);const total=Number(inv.total||0), paid=store.payments.filter(x=>x.invoiceId===inv.id&&x.status==='completed').reduce((s,x)=>s+Number(x.amount||0),0);patch('billing',inv.id,{paidAmount:paid,status:paid>=total?'paid':'partially-paid'},req);add('notifications',{patientId:inv.patientId,channel:'in-app',template:'payment-receipt',status:'queued',payload:{paymentId:payment.id}},req);return payment});

app.post('/api/laboratory/results',async(req:any,reply)=>{
  const b=(req.body||{}) as Row;
  if(!pool) return reply.code(201).send(add('laboratory',{...b,status:'preliminary'},req));
  const client=await pool.connect(); try{await client.query('BEGIN');
    const sample=await client.query(`SELECT ls.id,co.patient_id AS "patientId" FROM lab_samples ls JOIN clinical_orders co ON co.id=ls.order_id JOIN patients p ON p.id=co.patient_id WHERE ls.id=$1 AND p.organization_id=$2`,[b.sampleId,dbOrganizationId(req)]);
    if(!sample.rowCount){await client.query('ROLLBACK');return reply.code(404).send({error:'Lab sample not found'});}
    let test=await client.query(`SELECT id FROM lab_tests WHERE organization_id=$1 AND (id=$2 OR code=$3) LIMIT 1`,[dbOrganizationId(req),b.testId||null,b.code||null]);
    if(!test.rowCount) test=await client.query(`INSERT INTO lab_tests(organization_id,code,name,unit,active) VALUES($1,$2,$3,$4,true) RETURNING id`,[dbOrganizationId(req),b.code||null,b.name||b.code||'Laboratory test',b.unit||null]);
    const r=await client.query(`INSERT INTO lab_results(sample_id,test_id,value_numeric,value_text,unit,abnormal_flag,critical,status) VALUES($1,$2,$3,$4,$5,$6,$7,'preliminary') RETURNING id,sample_id AS "sampleId",test_id AS "testId",value_numeric AS "valueNumeric",value_text AS "valueText",unit,abnormal_flag AS "abnormalFlag",critical,status`,[b.sampleId,test.rows[0].id,b.valueNumeric??null,b.valueText??null,b.unit||null,b.abnormalFlag||null,Boolean(b.critical)]);
    await dbAudit(client,req,'CREATE','lab_result',r.rows[0].id,{patientId:sample.rows[0].patientId}); await queueEvent(client,req,CLINICAL_EVENT_TYPES.LAB_RESULT_CREATED,{labResultId:r.rows[0].id,patientId:sample.rows[0].patientId,encounterId:sample.rows[0].encounterId||null}); await client.query('COMMIT'); return reply.code(201).send(r.rows[0]);
  }catch(e){await client.query('ROLLBACK');throw e}finally{client.release()}
});

// --- Connected clinical actions ---
async function queueEvent(client:any, req:any, type:string, payload:Row){
  if(!pool) return;
  const body = payload || {};
  const aggregateId = body.patientId || body.encounterId || body.orderId || body.clinicalNoteId || body.sampleId || body.labResultId || body.medicationOrderId || body.referralId || body.admissionId || body.taskId || body.queueEntryId || body.studyId || body.bedId || body.invoiceId || null;
  const eventKey = createHash('sha256').update(JSON.stringify({type,aggregateId,payload:body})).digest('hex');
  await enqueueClinicalEvent(client,{organizationId:dbOrganizationId(req),eventType:type,aggregateType:type.split('.')[0]||null,aggregateId:aggregateId ? String(aggregateId) : null,patientId:body.patientId||null,encounterId:body.encounterId||null,payload:body,eventKey});
}

app.post('/api/actions/:module/:id/:action',async(req:any,reply)=>{
  const {module,id,action}=req.params as {module:string;id:string;action:string};
  const b=(req.body||{}) as Row;
  if(!pool){
    if(module==='queue') return reply.send(patch('queue',id,{status:action},req));
    if(module==='tasks') return reply.send(patch('tasks',id,{status:action==='complete'?'completed':action},req));
    if(module==='clinical-notes') return reply.send(patch('clinical-notes',id,{status:action==='sign'?'signed':action},req));
    if(module==='billing') return reply.send(patch('billing',id,{status:action==='pay'?'paid':action},req));
    return reply.code(400).send({error:'Action not supported in JSON mode'});
  }
  const client=await pool.connect();
  try{
    await client.query('BEGIN');
    let result:any;
    if(module==='appointments' && action==='check-in'){
      const a=await client.query(`SELECT a.id,a.patient_id AS "patientId",a.facility_id AS "facilityId",a.status FROM appointments a WHERE a.id=$1 AND a.organization_id=$2 FOR UPDATE`,[id,dbOrganizationId(req)]);
      if(!a.rowCount){await client.query('ROLLBACK');return reply.code(404).send({error:'Appointment not found'});}
      if(['cancelled','completed','no-show'].includes(a.rows[0].status)){await client.query('ROLLBACK');return reply.code(409).send({error:`Appointment is ${a.rows[0].status}`});}
      await client.query(`UPDATE appointments SET status='checked-in' WHERE id=$1`,[id]);
      let q=await client.query(`SELECT id FROM queues WHERE organization_id=$1 AND facility_id IS NOT DISTINCT FROM $2 AND code='GENERAL' LIMIT 1`,[dbOrganizationId(req),a.rows[0].facilityId]);
      if(!q.rowCount) q=await client.query(`INSERT INTO queues(organization_id,facility_id,code,name) VALUES($1,$2,'GENERAL','General Queue') RETURNING id`,[dbOrganizationId(req),a.rows[0].facilityId]);
      const existing=await client.query(`SELECT id,status FROM queue_entries WHERE queue_id=$1 AND patient_id=$2 AND status NOT IN ('completed','cancelled','no-show') LIMIT 1`,[q.rows[0].id,a.rows[0].patientId]);
      let qe=existing.rows[0];
      if(!qe) qe=(await client.query(`INSERT INTO queue_entries(queue_id,patient_id,appointment_id,priority,status) VALUES($1,$2,$3,$4,'waiting-triage') RETURNING id,status`,[q.rows[0].id,a.rows[0].patientId,id,b.priority||'normal'])).rows[0];
      result={appointmentId:id,patientId:a.rows[0].patientId,queueEntryId:qe.id,status:'checked-in',queueStatus:qe.status};
      await dbAudit(client,req,'CHECK_IN','appointment',id,result); await queueEvent(client,req,'appointment.checked_in',result);
    } else if(module==='queue'){
      const allowed=['waiting','called','in-service','completed','cancelled','no-show','waiting-triage','waiting-doctor','emergency'];
      if(!allowed.includes(action)) {await client.query('ROLLBACK');return reply.code(400).send({error:'Invalid queue action'});}
      const r=await client.query(`UPDATE queue_entries qe SET status=$1,called_at=CASE WHEN $1='called' THEN now() ELSE qe.called_at END,completed_at=CASE WHEN $1='completed' THEN now() ELSE qe.completed_at END FROM queues q WHERE qe.id=$2 AND qe.queue_id=q.id AND q.organization_id=$3 RETURNING qe.id,qe.patient_id AS "patientId",qe.appointment_id AS "appointmentId",qe.priority,qe.status,qe.joined_at AS "joinedAt",qe.called_at AS "calledAt",qe.completed_at AS "completedAt"`,[action,id,dbOrganizationId(req)]);
      if(!r.rowCount){await client.query('ROLLBACK');return reply.code(404).send({error:'Queue entry not found'});}
      result=r.rows[0]; await dbAudit(client,req,'QUEUE_TRANSITION','queue_entry',id,{status:action}); await queueEvent(client,req,'queue.transitioned',{queueEntryId:id,status:action});
    } else if(module==='encounters' && action==='complete') {
      const r=await client.query(`UPDATE encounters SET status='completed',ended_at=COALESCE(ended_at,now()) WHERE id=$1 AND organization_id=$2 RETURNING id,patient_id AS "patientId",status,started_at AS "startedAt",ended_at AS "endedAt"`,[id,dbOrganizationId(req)]);
      if(!r.rowCount){await client.query('ROLLBACK');return reply.code(404).send({error:'Encounter not found'});} result=r.rows[0]; await dbAudit(client,req,'COMPLETE','encounter',id,{}); await queueEvent(client,req,CLINICAL_EVENT_TYPES.ENCOUNTER_COMPLETED,{encounterId:id,patientId:r.rows[0].patientId});
    } else if(module==='clinical-notes' && action==='sign'){
      const r=await client.query(`UPDATE clinical_notes n SET signed_by=$1,signed_at=now() FROM encounters e WHERE n.id=$2 AND n.encounter_id=e.id AND e.organization_id=$3 AND n.signed_at IS NULL RETURNING n.id,n.encounter_id AS "encounterId",n.signed_at AS "signedAt",n.version`,[dbUserId(req),id,dbOrganizationId(req)]);
      if(!r.rowCount){await client.query('ROLLBACK');return reply.code(404).send({error:'Draft clinical note not found'});}
      result={...r.rows[0],status:'signed'}; await dbAudit(client,req,'SIGN','clinical_note',id,{}); await queueEvent(client,req,CLINICAL_EVENT_TYPES.CLINICAL_NOTE_SIGNED,{clinicalNoteId:id});
    } else if(module==='laboratory' && ['collect','receive'].includes(action)) {
      const next=action==='collect'?'collected':'received';
      const stamp=action==='collect'?'collected_at':'received_at';
      const r=await client.query(`UPDATE lab_samples ls SET status=$1,${stamp}=now() FROM clinical_orders co JOIN patients p ON p.id=co.patient_id WHERE ls.id=$2 AND ls.order_id=co.id AND p.organization_id=$3 AND ls.status IN ('ordered','collected') RETURNING ls.id,ls.order_id AS "orderId",ls.barcode,ls.status,ls.collected_at AS "collectedAt",ls.received_at AS "receivedAt"`,[next,id,dbOrganizationId(req)]);
      if(!r.rowCount){await client.query('ROLLBACK');return reply.code(409).send({error:'Lab sample is not in a valid state for this action'});} result=r.rows[0]; await dbAudit(client,req,action.toUpperCase(),'lab_sample',id,{}); await queueEvent(client,req,action==='collect'?CLINICAL_EVENT_TYPES.SPECIMEN_COLLECTED:CLINICAL_EVENT_TYPES.SPECIMEN_RECEIVED,{sampleId:id,status:next});
    } else if(module==='laboratory' && (action==='verify' || action==='release')){
      if(action==='release'){
        const r=await client.query(`UPDATE lab_results lr SET status='final' FROM lab_samples ls JOIN clinical_orders co ON co.id=ls.order_id JOIN patients p ON p.id=co.patient_id WHERE lr.id=$1 AND lr.sample_id=ls.id AND p.organization_id=$2 AND lr.status='verified' RETURNING lr.id,lr.sample_id AS "sampleId",lr.value_numeric AS "valueNumeric",lr.value_text AS "valueText",lr.unit,lr.abnormal_flag AS "abnormalFlag",lr.critical,lr.status,lr.verified_at AS "verifiedAt"`,[id,dbOrganizationId(req)]);
        if(!r.rowCount){await client.query('ROLLBACK');return reply.code(409).send({error:'Lab result must be verified before release, or was not found'});} result=r.rows[0];
      } else {
        const r=await client.query(`UPDATE lab_results lr SET status='verified',verified_by=$1,verified_at=now() FROM lab_samples ls JOIN clinical_orders co ON co.id=ls.order_id JOIN patients p ON p.id=co.patient_id WHERE lr.id=$2 AND lr.sample_id=ls.id AND p.organization_id=$3 AND lr.status IN ('preliminary','ordered') RETURNING lr.id,lr.sample_id AS "sampleId",lr.value_numeric AS "valueNumeric",lr.value_text AS "valueText",lr.unit,lr.abnormal_flag AS "abnormalFlag",lr.critical,lr.status,lr.verified_at AS "verifiedAt"`,[dbUserId(req),id,dbOrganizationId(req)]);
        if(!r.rowCount){await client.query('ROLLBACK');return reply.code(409).send({error:'Lab result is not in a verifiable state'});} result=r.rows[0];
        const lab=await client.query(`SELECT co.patient_id AS "patientId",lr.critical FROM lab_results lr JOIN lab_samples ls ON ls.id=lr.sample_id JOIN clinical_orders co ON co.id=ls.order_id WHERE lr.id=$1`,[id]);
        if(lab.rowCount){await client.query(`INSERT INTO notifications(organization_id,patient_id,channel,template,status,payload) VALUES($1,$2,'in-app',$3,'queued',$4)`,[dbOrganizationId(req),lab.rows[0].patientId,lab.rows[0].critical?'critical-lab':'result-ready',JSON.stringify({labResultId:id})]);await client.query(`INSERT INTO module_records(organization_id,module,status,payload,created_by) VALUES($1,'tasks','open',$2,$3)`,[dbOrganizationId(req),JSON.stringify({patientId:lab.rows[0].patientId,type:lab.rows[0].critical?'critical-result-review':'result-review',priority:lab.rows[0].critical?'critical':'normal',labResultId:id,status:'open'}),dbUserId(req)]);}
      }
      await dbAudit(client,req,action.toUpperCase(),'lab_result',id,{}); await queueEvent(client,req,action==='verify'?CLINICAL_EVENT_TYPES.RESULT_VERIFIED:CLINICAL_EVENT_TYPES.RESULT_RELEASED,{labResultId:id,status:result.status});
    } else if(module==='pharmacy' && action==='dispense'){
      const o=await client.query(`SELECT mo.id,mo.patient_id AS "patientId",mo.quantity,mo.status,m.name AS "medicationName",m.code AS "medicationCode" FROM medication_orders mo JOIN medications m ON m.id=mo.medication_id WHERE mo.id=$1 AND EXISTS(SELECT 1 FROM patients p WHERE p.id=mo.patient_id AND p.organization_id=$2) FOR UPDATE`,[id,dbOrganizationId(req)]);
      if(!o.rowCount){await client.query('ROLLBACK');return reply.code(404).send({error:'Medication order not found'});}
      if(!['active','partially-dispensed'].includes(o.rows[0].status)){await client.query('ROLLBACK');return reply.code(409).send({error:`Medication order is ${o.rows[0].status}`});}
      const qty=Number(b.quantity||o.rows[0].quantity||1); if(qty<=0){await client.query('ROLLBACK');return reply.code(400).send({error:'Quantity must be positive'});}
      let batchId=b.batchId||null;
      if(!batchId){ const stock=await client.query(`SELECT ib.id,ib.quantity,ib.batch_number AS "batchNumber",ib.expiry_date AS "expiryDate" FROM inventory_batches ib JOIN inventory_items ii ON ii.id=ib.item_id WHERE ii.organization_id=$1 AND (ii.sku=$2 OR lower(ii.name)=lower($3)) AND ib.quantity>0 ORDER BY ib.expiry_date NULLS LAST,ib.id LIMIT 1 FOR UPDATE`,[dbOrganizationId(req),o.rows[0].medicationCode||null,o.rows[0].medicationName]); if(stock.rowCount) batchId=stock.rows[0].id; }
      let batchMeta:any=null;
      if(batchId){ const stock=await client.query(`SELECT ib.id,ib.item_id,ib.quantity,ib.batch_number AS "batchNumber",ib.expiry_date AS "expiryDate" FROM inventory_batches ib JOIN inventory_items ii ON ii.id=ib.item_id WHERE ib.id=$1 AND ii.organization_id=$2 FOR UPDATE`,[batchId,dbOrganizationId(req)]); if(!stock.rowCount){await client.query('ROLLBACK');return reply.code(404).send({error:'Inventory batch not found'});} if(Number(stock.rows[0].quantity)<qty){await client.query('ROLLBACK');return reply.code(409).send({error:'Insufficient stock',available:Number(stock.rows[0].quantity)});} await client.query(`UPDATE inventory_batches SET quantity=quantity-$1 WHERE id=$2`,[qty,batchId]); await client.query(`INSERT INTO stock_movements(item_id,batch_id,movement_type,quantity,reference_type,reference_id,created_by) VALUES($1,$2,'dispense',$3,'medication_order',$4,$5)`,[stock.rows[0].item_id,batchId,qty,id,dbUserId(req)]); batchMeta={batchId,batch:stock.rows[0].batchNumber,expiryDate:stock.rows[0].expiryDate}; }
      const d=await client.query(`INSERT INTO dispensations(medication_order_id,quantity,batch,expiry_date,dispensed_by) VALUES($1,$2,$3,$4,$5) RETURNING id,medication_order_id AS "medicationOrderId",quantity,batch,expiry_date AS "expiryDate",dispensed_at AS "dispensedAt"`,[id,qty,batchMeta?.batch||b.batch||null,batchMeta?.expiryDate||b.expiryDate||null,dbUserId(req)]);
      const remaining=Number(o.rows[0].quantity||0)-qty; const next=remaining>0?'partially-dispensed':'dispensed'; await client.query(`UPDATE medication_orders SET status=$1 WHERE id=$2`,[next,id]);
      await client.query(`INSERT INTO notifications(organization_id,patient_id,channel,template,status,payload) VALUES($1,$2,'in-app','prescription-ready','queued',$3)`,[dbOrganizationId(req),o.rows[0].patientId,JSON.stringify({medicationOrderId:id,quantity:qty})]);
      result={...o.rows[0],status:next,dispensation:d.rows[0],inventory:batchMeta}; await dbAudit(client,req,'DISPENSE','medication_order',id,{quantity:qty,batchId}); await queueEvent(client,req,'medication.dispensed',{medicationOrderId:id,quantity:qty,batchId});
    } else if(module==='billing' && action==='pay'){
      const inv=await client.query(`SELECT id,patient_id AS "patientId",total,status,currency FROM invoices WHERE id=$1 AND organization_id=$2 FOR UPDATE`,[id,dbOrganizationId(req)]);
      if(!inv.rowCount){await client.query('ROLLBACK');return reply.code(404).send({error:'Invoice not found'});}
      const amount=Number(b.amount||inv.rows[0].total||0); if(amount<=0){await client.query('ROLLBACK');return reply.code(400).send({error:'Payment amount must be positive'});}
      const paid=await client.query(`SELECT COALESCE(SUM(amount),0)::numeric total FROM payments WHERE invoice_id=$1 AND status='completed'`,[id]); const outstanding=Number(inv.rows[0].total)-Number(paid.rows[0].total); if(amount>outstanding+0.0001){await client.query('ROLLBACK');return reply.code(400).send({error:'Payment exceeds outstanding balance',outstanding});}
      const payment=await client.query(`INSERT INTO payments(invoice_id,method,provider_reference,amount,status,paid_at) VALUES($1,$2,$3,$4,'completed',now()) RETURNING id,invoice_id AS "invoiceId",method,provider_reference AS "providerReference",amount,status,paid_at AS "paidAt"`,[id,b.method||'cash',b.providerReference||null,amount]);
      const newPaid=Number(paid.rows[0].total)+amount; const nextStatus=newPaid>=Number(inv.rows[0].total)?'paid':'partially-paid'; await client.query(`UPDATE invoices SET status=$1 WHERE id=$2`,[nextStatus,id]); await client.query(`INSERT INTO accounting_entries(organization_id,account_code,description,entry_type,amount,currency,reference_type,reference_id,status,created_by) VALUES($1,'1100','Patient payment received','income',$2,$3,'payment',$4,'posted',$5) ON CONFLICT DO NOTHING`,[dbOrganizationId(req),amount,inv.rows[0].currency,payment.rows[0].id,dbUserId(req)]);const claim=await client.query(`SELECT id,amount,coverage_amount,patient_responsibility FROM claims WHERE invoice_id=$1 ORDER BY submitted_at DESC NULLS LAST LIMIT 1`,[id]);const recon=await client.query(`SELECT id FROM finance_reconciliations WHERE invoice_id=$1 AND payment_id IS NULL ORDER BY created_at DESC LIMIT 1 FOR UPDATE`,[id]);if(recon.rowCount) await client.query(`UPDATE finance_reconciliations SET paid_amount=paid_amount+$1,status=CASE WHEN $2>=invoice_amount THEN 'reconciled' ELSE 'partially-paid' END,reconciled_at=CASE WHEN $2>=invoice_amount THEN now() ELSE reconciled_at END,notes=notes||jsonb_build_object('lastPaymentId',$3) WHERE id=$4`,[amount,newPaid,payment.rows[0].id,recon.rows[0].id]);else await client.query(`INSERT INTO finance_reconciliations(organization_id,invoice_id,claim_id,invoice_amount,claimed_amount,approved_amount,paid_amount,patient_responsibility,status,notes,created_by) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,[dbOrganizationId(req),id,claim.rows[0]?.id||null,Number(inv.rows[0].total),Number(claim.rows[0]?.amount||0),Number(claim.rows[0]?.coverage_amount||0),amount,Number(claim.rows[0]?.patient_responsibility||0),nextStatus==='paid'?'reconciled':'partially-paid',JSON.stringify({lastPaymentId:payment.rows[0].id}),dbUserId(req)]); await client.query(`INSERT INTO notifications(organization_id,patient_id,channel,template,status,payload) VALUES($1,$2,'in-app','payment-receipt','queued',$3)`,[dbOrganizationId(req),inv.rows[0].patientId,JSON.stringify({paymentId:payment.rows[0].id})]);
      result=payment.rows[0]; await dbAudit(client,req,'PAY','invoice',id,{paymentId:payment.rows[0].id,amount}); await queueEvent(client,req,'invoice.paid',{invoiceId:id,paymentId:payment.rows[0].id,amount});
    } else if(module==='tasks' && action==='complete'){
      const r=await client.query(`UPDATE module_records SET payload=jsonb_set(payload,'{status}','"completed"'::jsonb,true),updated_at=now() WHERE id=$1 AND organization_id=$2 AND module='tasks' RETURNING id,status,payload`,[id,dbOrganizationId(req)]);
      if(!r.rowCount){await client.query('ROLLBACK');return reply.code(404).send({error:'Task not found'});} result={id:r.rows[0].id,status:'completed',...r.rows[0].payload}; await dbAudit(client,req,'COMPLETE','task',id,{}); await queueEvent(client,req,CLINICAL_EVENT_TYPES.TASK_COMPLETED,{taskId:id});
    } else if(module==='inpatient' && action==='discharge'){
      const body=b; const p=await client.query(`SELECT id FROM patients WHERE id=$1 AND organization_id=$2`,[body.patientId,dbOrganizationId(req)]); if(!p.rowCount){await client.query('ROLLBACK');return reply.code(404).send({error:'Patient not found'});}
      const f=await client.query(`INSERT INTO module_records(organization_id,module,status,payload,created_by) VALUES($1,'inpatient','discharged',$2,$3) RETURNING id`,[dbOrganizationId(req),JSON.stringify({...body,status:'discharged',dischargedAt:now()}),dbUserId(req)]); const fu=await client.query(`INSERT INTO module_records(organization_id,module,status,payload,created_by) VALUES($1,'follow-up','due',$2,$3) RETURNING id`,[dbOrganizationId(req),JSON.stringify({patientId:body.patientId,reason:body.followUpReason||'Post-discharge follow-up',dueAt:body.followUpDate||null,status:'due'}),dbUserId(req)]); result={inpatientRecordId:f.rows[0].id,followUpId:fu.rows[0].id,status:'discharged'}; await dbAudit(client,req,'DISCHARGE','patient',body.patientId,result); await queueEvent(client,req,'patient.discharged',{patientId:body.patientId,followUpId:fu.rows[0].id});
    } else if(module==='referrals' && action==='send'){
      const r=await client.query(`UPDATE referrals r SET status='sent' FROM patients p WHERE r.id=$1 AND r.patient_id=p.id AND p.organization_id=$2 RETURNING r.id,r.patient_id AS "patientId",r.destination,r.reason,r.status`,[id,dbOrganizationId(req)]); if(!r.rowCount){await client.query('ROLLBACK');return reply.code(404).send({error:'Referral not found'});} await client.query(`INSERT INTO module_records(organization_id,module,status,payload,created_by) VALUES($1,'tasks','open',$2,$3)`,[dbOrganizationId(req),JSON.stringify({patientId:r.rows[0].patientId,type:'referral-tracking',referralId:id,status:'open'}),dbUserId(req)]); result=r.rows[0]; await dbAudit(client,req,'SEND','referral',id,{}); await queueEvent(client,req,CLINICAL_EVENT_TYPES.REFERRAL_SENT,{referralId:id,patientId:r.rows[0].patientId});
    } else { await client.query('ROLLBACK'); return reply.code(400).send({error:`Unsupported action ${action} for ${module}`}); }
    await client.query('COMMIT'); return reply.send(result);
  }catch(e){await client.query('ROLLBACK');throw e}finally{client.release()}
});

app.post('/api/medication-administrations',async(req:any,reply)=>{
  const b=z.object({medicationOrderId:z.string().uuid(),dose:z.string().optional(),route:z.string().optional(),scheduledAt:z.string().optional(),status:z.enum(['given','held','refused','missed']).default('given'),reason:z.string().optional()}).parse(req.body);
  if(!pool)return reply.code(201).send(add('nursing',{...b,administeredAt:now()},req));
  const client=await pool.connect(); try{await client.query('BEGIN'); const mo=await client.query(`SELECT mo.id,mo.patient_id AS "patientId" FROM medication_orders mo JOIN patients p ON p.id=mo.patient_id WHERE mo.id=$1 AND p.organization_id=$2`,[b.medicationOrderId,dbOrganizationId(req)]); if(!mo.rowCount){await client.query('ROLLBACK');return reply.code(404).send({error:'Medication order not found'});} const r=await client.query(`INSERT INTO medication_administrations(medication_order_id,dose,route,scheduled_at,administered_at,status,administered_by,reason) VALUES($1,$2,$3,$4,CASE WHEN $5 IN ('given','held','refused') THEN now() ELSE NULL END,$5,$6,$7) RETURNING id,medication_order_id AS "medicationOrderId",dose,route,scheduled_at AS "scheduledAt",administered_at AS "administeredAt",status,reason`,[b.medicationOrderId,b.dose||null,b.route||null,b.scheduledAt||null,b.status,dbUserId(req),b.reason||null]); await dbAudit(client,req,'ADMINISTER_MEDICATION','medication_order',b.medicationOrderId,{status:b.status}); await queueEvent(client,req,CLINICAL_EVENT_TYPES.MEDICATION_ADMINISTERED,{patientId:mo.rows[0].patientId,medicationOrderId:b.medicationOrderId,administrationId:r.rows[0].id,status:b.status}); await client.query('COMMIT'); return reply.code(201).send({...r.rows[0],patientId:mo.rows[0].patientId}); }catch(e){await client.query('ROLLBACK');throw e}finally{client.release()}
});

// --- Advanced clinical services: emergency, inpatient, nursing, surgery, maternity, pediatrics, immunization, chronic care, telemedicine, remote monitoring ---
const advancedAction=z.object({action:z.string(),payload:z.record(z.any()).default({})});
async function requirePatient(client:any,req:any,patientId:string){
  const r=await client.query('SELECT id FROM patients WHERE id=$1 AND organization_id=$2',[patientId,dbOrganizationId(req)]);
  if(!r.rowCount) throw Object.assign(new Error('Patient not found'),{statusCode:404});
}
function fallbackAdvanced(module:string,body:any,req:any){return add(module as Mod,{...body},req)}

app.post('/api/emergency/cases',async(req:any,reply)=>{
  const b=z.object({patientId:z.string().uuid(),encounterId:z.string().uuid().optional(),acuity:z.enum(['urgent','emergency']).default('urgent'),chiefComplaint:z.string().optional(),triageLevel:z.string().optional(),status:z.string().default('arrived'),notes:z.record(z.any()).default({})}).parse(req.body||{});
  if(!pool)return reply.code(201).send(fallbackAdvanced('emergency',b,req));
  const c=await pool.connect();try{await c.query('BEGIN');await requirePatient(c,req,b.patientId);const r=await c.query(`INSERT INTO emergency_cases(organization_id,patient_id,encounter_id,acuity,chief_complaint,triage_level,status,notes,created_by) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING *`,[dbOrganizationId(req),b.patientId,b.encounterId||null,b.acuity,b.chiefComplaint||null,b.triageLevel||null,b.status,JSON.stringify(b.notes),dbUserId(req)]);await dbAudit(c,req,'CREATE','emergency_case',r.rows[0].id,{acuity:b.acuity});await enqueueClinicalEvent(c,{organizationId:dbOrganizationId(req),eventType:CLINICAL_EVENT_TYPES.EMERGENCY_ARRIVED,aggregateType:'emergency_case',aggregateId:r.rows[0].id,patientId:b.patientId,encounterId:b.encounterId||null,payload:{emergencyCaseId:r.rows[0].id,patientId:b.patientId,encounterId:b.encounterId||null,acuity:b.acuity,triageLevel:b.triageLevel||null}});await c.query('COMMIT');return reply.code(201).send(r.rows[0]);}catch(e){await c.query('ROLLBACK');throw e}finally{c.release()}
});
app.get('/api/emergency/cases',async(req:any)=>{if(!pool)return {data:store.emergency,count:store.emergency.length};const r=await pool.query(`SELECT * FROM emergency_cases WHERE organization_id=$1 ORDER BY arrival_at DESC LIMIT 500`,[dbOrganizationId(req)]);return {data:r.rows,count:r.rowCount};});
app.post('/api/emergency/cases/:id/disposition',async(req:any,reply)=>{if(!pool){const x=patch('emergency',req.params.id,{status:'disposed',disposition:req.body?.disposition,dispositionAt:now()},req);if(!x)return reply.code(404).send({error:'Emergency case not found'});return x}const r=await pool.query(`UPDATE emergency_cases SET status='disposed',disposition=$1,disposition_at=now(),updated_at=now() WHERE id=$2 AND organization_id=$3 RETURNING *`,[req.body?.disposition||'discharged',req.params.id,dbOrganizationId(req)]);if(!r.rowCount)return reply.code(404).send({error:'Emergency case not found'});await pool.query(`INSERT INTO audit_logs(organization_id,actor_user_id,action,entity_type,entity_id,metadata) VALUES($1,$2,'DISPOSITION','emergency_case',$3,$4)`,[dbOrganizationId(req),dbUserId(req),req.params.id,JSON.stringify({disposition:req.body?.disposition})]);return r.rows[0]});

app.post('/api/inpatient/admissions',async(req:any,reply)=>{const b=z.object({patientId:z.string().uuid(),encounterId:z.string().uuid().optional(),ward:z.string(),bed:z.string().optional(),status:z.string().default('admitted')}).parse(req.body||{});if(!pool)return reply.code(201).send(fallbackAdvanced('inpatient',b,req));const c=await pool.connect();try{await c.query('BEGIN');await requirePatient(c,req,b.patientId);const r=await c.query(`INSERT INTO admissions(organization_id,patient_id,encounter_id,ward,bed,status,created_by) VALUES($1,$2,$3,$4,$5,$6,$7) RETURNING *`,[dbOrganizationId(req),b.patientId,b.encounterId||null,b.ward,b.bed||null,b.status,dbUserId(req)]);await dbAudit(c,req,'ADMIT','patient',b.patientId,{admissionId:r.rows[0].id,ward:b.ward,bed:b.bed});await queueEvent(c,req,CLINICAL_EVENT_TYPES.ADMISSION_STARTED,{admissionId:r.rows[0].id,patientId:b.patientId,encounterId:b.encounterId||null,ward:b.ward,bed:b.bed,status:r.rows[0].status});await c.query('COMMIT');return reply.code(201).send(r.rows[0]);}catch(e){await c.query('ROLLBACK');throw e}finally{c.release()}});
app.get('/api/inpatient/admissions',async(req:any)=>{if(!pool)return {data:store.inpatient,count:store.inpatient.length};const r=await pool.query(`SELECT * FROM admissions WHERE organization_id=$1 ORDER BY admitted_at DESC LIMIT 500`,[dbOrganizationId(req)]);return {data:r.rows,count:r.rowCount};});
app.post('/api/inpatient/admissions/:id/discharge',async(req:any,reply)=>{if(!pool){const x=patch('inpatient',req.params.id,{status:'discharged',dischargedAt:now(),dischargeSummary:req.body?.dischargeSummary||null},req);if(!x)return reply.code(404).send({error:'Admission not found'});return x}const c=await pool.connect();try{await c.query('BEGIN');const r=await c.query(`UPDATE admissions SET status='discharged',discharged_at=now(),discharge_summary=$1,updated_at=now() WHERE id=$2 AND organization_id=$3 RETURNING *`,[req.body?.dischargeSummary||null,req.params.id,dbOrganizationId(req)]);if(!r.rowCount){await c.query('ROLLBACK');return reply.code(404).send({error:'Admission not found'})}const fu=await c.query(`INSERT INTO module_records(organization_id,module,status,payload,created_by) VALUES($1,'follow-up','due',$2,$3) RETURNING id`,[dbOrganizationId(req),JSON.stringify({patientId:r.rows[0].patient_id,reason:'Post-discharge follow-up',dueAt:req.body?.followUpAt||null,status:'due'}),dbUserId(req)]);await dbAudit(c,req,'DISCHARGE','admission',req.params.id,{followUpId:fu.rows[0].id});await queueEvent(c,req,CLINICAL_EVENT_TYPES.DISCHARGE_STARTED,{admissionId:req.params.id,patientId:r.rows[0].patient_id,encounterId:r.rows[0].encounter_id||null,followUpId:fu.rows[0].id,status:'discharged'});await c.query('COMMIT');return {...r.rows[0],followUpId:fu.rows[0].id};}catch(e){await c.query('ROLLBACK');throw e}finally{c.release()}});

app.post('/api/nursing/assessments',async(req:any,reply)=>{const b=z.object({patientId:z.string().uuid(),encounterId:z.string().uuid().optional(),assessmentType:z.string().default('initial'),findings:z.record(z.any()).default({}),painScore:z.number().optional(),riskFlags:z.array(z.string()).default([])}).parse(req.body||{});if(!pool)return reply.code(201).send(fallbackAdvanced('nursing',b,req));const r=await pool.query(`INSERT INTO nursing_assessments(organization_id,patient_id,encounter_id,nurse_user_id,assessment_type,findings,pain_score,risk_flags) VALUES($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *`,[dbOrganizationId(req),b.patientId,b.encounterId||null,dbUserId(req),b.assessmentType,JSON.stringify(b.findings),b.painScore||null,JSON.stringify(b.riskFlags)]);return reply.code(201).send(r.rows[0]);});
app.get('/api/nursing/assessments',async(req:any)=>{if(!pool)return {data:store.nursing,count:store.nursing.length};const r=await pool.query(`SELECT * FROM nursing_assessments WHERE organization_id=$1 ORDER BY created_at DESC LIMIT 500`,[dbOrganizationId(req)]);return {data:r.rows,count:r.rowCount};});

app.post('/api/surgery/cases',async(req:any,reply)=>{const b=z.object({patientId:z.string().uuid(),encounterId:z.string().uuid().optional(),procedureName:z.string(),scheduledAt:z.string().optional(),consentConfirmed:z.boolean().default(false),surgeonUserId:z.string().uuid().optional(),anaesthesiaPlan:z.string().optional(),checklist:z.record(z.any()).default({})}).parse(req.body||{});if(!pool)return reply.code(201).send(fallbackAdvanced('surgery',b,req));const client=await pool.connect();try{await client.query('BEGIN');const r=await client.query(`INSERT INTO surgery_cases(organization_id,patient_id,encounter_id,procedure_name,scheduled_at,consent_confirmed,surgeon_user_id,anaesthesia_plan,checklist) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING *`,[dbOrganizationId(req),b.patientId,b.encounterId||null,b.procedureName,b.scheduledAt||null,b.consentConfirmed,b.surgeonUserId||null,b.anaesthesiaPlan||null,JSON.stringify(b.checklist)]);if(b.scheduledAt) await enqueueClinicalEvent(client,{organizationId:dbOrganizationId(req),eventType:CLINICAL_EVENT_TYPES.APPOINTMENT_CREATED,aggregateType:'surgery_case',aggregateId:r.rows[0].id,patientId:b.patientId,encounterId:b.encounterId||null,payload:{surgeryCaseId:r.rows[0].id,patientId:b.patientId,encounterId:b.encounterId||null,procedureName:b.procedureName,scheduledAt:b.scheduledAt}});if(b.consentConfirmed) await enqueueClinicalEvent(client,{organizationId:dbOrganizationId(req),eventType:'surgery.consent.confirmed',aggregateType:'surgery_case',aggregateId:r.rows[0].id,patientId:b.patientId,encounterId:b.encounterId||null,payload:{surgeryCaseId:r.rows[0].id,patientId:b.patientId}});await client.query('COMMIT');return reply.code(201).send(r.rows[0]);}catch(e){await client.query('ROLLBACK');throw e}finally{client.release()};});
app.get('/api/surgery/cases',async(req:any)=>{if(!pool)return {data:store.surgery,count:store.surgery.length};const r=await pool.query(`SELECT * FROM surgery_cases WHERE organization_id=$1 ORDER BY scheduled_at DESC NULLS LAST LIMIT 500`,[dbOrganizationId(req)]);return {data:r.rows,count:r.rowCount};});
app.post('/api/surgery/cases/:id/checklist',async(req:any,reply)=>{if(!pool){const x=patch('surgery',req.params.id,{checklist:req.body,status:req.body?.completed?'ready':'scheduled'},req);if(!x)return reply.code(404).send({error:'Surgery case not found'});return x}const r=await pool.query(`UPDATE surgery_cases SET checklist=$1,status=$2,updated_at=now() WHERE id=$3 AND organization_id=$4 RETURNING *`,[JSON.stringify(req.body||{}),req.body?.completed?'ready':'scheduled',req.params.id,dbOrganizationId(req)]);if(!r.rowCount)return reply.code(404).send({error:'Surgery case not found'});return r.rows[0]});

app.post('/api/maternity/records',async(req:any,reply)=>{const b=z.object({patientId:z.string().uuid(),encounterId:z.string().uuid().optional(),eventType:z.string(),gestationalAgeWeeks:z.number().optional(),gravida:z.number().int().optional(),para:z.number().int().optional(),maternalObservations:z.record(z.any()).default({}),fetalObservations:z.record(z.any()).default({}),status:z.string().default('active'),notes:z.string().optional()}).parse(req.body||{});if(!pool)return reply.code(201).send(fallbackAdvanced('maternity',b,req));const client=await pool.connect();try{await client.query('BEGIN');const r=await client.query(`INSERT INTO maternity_records(organization_id,patient_id,encounter_id,event_type,gestational_age_weeks,gravida,para,maternal_observations,fetal_observations,status,notes) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) RETURNING *`,[dbOrganizationId(req),b.patientId,b.encounterId||null,b.eventType,b.gestationalAgeWeeks||null,b.gravida??null,b.para??null,JSON.stringify(b.maternalObservations),JSON.stringify(b.fetalObservations),b.status,b.notes||null]);const et=String(b.eventType).toLowerCase();const map:any={'anc':'maternity.anc.recorded','risk':'maternity.risk.assessed','danger-signs':'maternity.danger-signs.recorded','labour':'maternity.labour.started','birth':'maternity.birth.recorded','newborn':'maternity.newborn.recorded','pnc':'maternity.pnc.recorded','delivery-planning':'maternity.delivery-planned'};if(map[et]) await enqueueClinicalEvent(client,{organizationId:dbOrganizationId(req),eventType:map[et],aggregateType:'maternity_record',aggregateId:r.rows[0].id,patientId:b.patientId,encounterId:b.encounterId||null,payload:{maternityRecordId:r.rows[0].id,patientId:b.patientId,encounterId:b.encounterId||null,eventType:b.eventType,gestationalAgeWeeks:b.gestationalAgeWeeks||null}});await client.query('COMMIT');return reply.code(201).send(r.rows[0]);}catch(e){await client.query('ROLLBACK');throw e}finally{client.release()};});
app.get('/api/maternity/records',async(req:any)=>{if(!pool)return {data:store.maternity,count:store.maternity.length};const r=await pool.query(`SELECT * FROM maternity_records WHERE organization_id=$1 ORDER BY event_at DESC LIMIT 500`,[dbOrganizationId(req)]);return {data:r.rows,count:r.rowCount};});

app.post('/api/pediatrics/assessments',async(req:any,reply)=>{const b=z.object({patientId:z.string().uuid(),encounterId:z.string().uuid().optional(),ageMonths:z.number().int().optional(),weightKg:z.number().optional(),heightCm:z.number().optional(),muacMm:z.number().optional(),temperature:z.number().optional(),respiratoryRate:z.number().optional(),spo2:z.number().optional(),assessment:z.record(z.any()).default({}),imciClassification:z.record(z.any()).default({}),nutritionStatus:z.string().optional(),referralRequired:z.boolean().default(false)}).parse(req.body||{});if(!pool)return reply.code(201).send(fallbackAdvanced('pediatrics',b,req));const r=await pool.query(`INSERT INTO pediatric_assessments(organization_id,patient_id,encounter_id,age_months,weight_kg,height_cm,muac_mm,temperature,respiratory_rate,spo2,assessment,imci_classification,nutrition_status,referral_required) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14) RETURNING *`,[dbOrganizationId(req),b.patientId,b.encounterId||null,b.ageMonths??null,b.weightKg??null,b.heightCm??null,b.muacMm??null,b.temperature??null,b.respiratoryRate??null,b.spo2??null,JSON.stringify(b.assessment),JSON.stringify(b.imciClassification),b.nutritionStatus||null,b.referralRequired]);return reply.code(201).send(r.rows[0]);});
app.get('/api/pediatrics/assessments',async(req:any)=>{if(!pool)return {data:store.pediatrics,count:store.pediatrics.length};const r=await pool.query(`SELECT * FROM pediatric_assessments WHERE organization_id=$1 ORDER BY created_at DESC LIMIT 500`,[dbOrganizationId(req)]);return {data:r.rows,count:r.rowCount};});

app.post('/api/immunizations',async(req:any,reply)=>{const b=z.object({patientId:z.string().uuid(),vaccineCode:z.string(),vaccineName:z.string(),doseNumber:z.string().optional(),administeredAt:z.string().optional(),lotNumber:z.string().optional(),expiryDate:z.string().optional(),route:z.string().optional(),site:z.string().optional(),nextDueAt:z.string().optional(),notes:z.string().optional()}).parse(req.body||{});if(!pool)return reply.code(201).send(fallbackAdvanced('immunization',b,req));const r=await pool.query(`INSERT INTO immunizations(organization_id,patient_id,vaccine_code,vaccine_name,dose_number,administered_at,lot_number,expiry_date,route,site,vaccinator_user_id,next_due_at,notes) VALUES($1,$2,$3,$4,$5,COALESCE($6,now()),$7,$8,$9,$10,$11,$12,$13) RETURNING *`,[dbOrganizationId(req),b.patientId,b.vaccineCode,b.vaccineName,b.doseNumber||null,b.administeredAt||null,b.lotNumber||null,b.expiryDate||null,b.route||null,b.site||null,dbUserId(req),b.nextDueAt||null,b.notes||null]);return reply.code(201).send(r.rows[0]);});
app.get('/api/immunizations',async(req:any)=>{if(!pool)return {data:store.immunization,count:store.immunization.length};const r=await pool.query(`SELECT * FROM immunizations WHERE organization_id=$1 ORDER BY administered_at DESC LIMIT 500`,[dbOrganizationId(req)]);return {data:r.rows,count:r.rowCount};});

app.post('/api/chronic-care/records',async(req:any,reply)=>{const b=z.object({patientId:z.string().uuid(),encounterId:z.string().uuid().optional(),conditionCode:z.string(),conditionName:z.string(),status:z.string().default('active'),goals:z.array(z.any()).default([]),measures:z.record(z.any()).default({}),medications:z.array(z.any()).default([]),nextReviewAt:z.string().optional(),riskLevel:z.string().optional(),carePlan:z.record(z.any()).default({})}).parse(req.body||{});if(!pool)return reply.code(201).send(fallbackAdvanced('chronic-care',b,req));const r=await pool.query(`INSERT INTO chronic_care_records(organization_id,patient_id,encounter_id,condition_code,condition_name,status,goals,measures,medications,next_review_at,risk_level,care_plan) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) RETURNING *`,[dbOrganizationId(req),b.patientId,b.encounterId||null,b.conditionCode,b.conditionName,b.status,JSON.stringify(b.goals),JSON.stringify(b.measures),JSON.stringify(b.medications),b.nextReviewAt||null,b.riskLevel||null,JSON.stringify(b.carePlan)]);return reply.code(201).send(r.rows[0]);});
app.get('/api/chronic-care/records',async(req:any)=>{if(!pool)return {data:store['chronic-care'],count:store['chronic-care'].length};const r=await pool.query(`SELECT * FROM chronic_care_records WHERE organization_id=$1 ORDER BY next_review_at NULLS LAST,updated_at DESC LIMIT 500`,[dbOrganizationId(req)]);return {data:r.rows,count:r.rowCount};});

app.post('/api/telemedicine/sessions',async(req:any,reply)=>{const b=z.object({patientId:z.string().uuid(),appointmentId:z.string().uuid().optional(),encounterId:z.string().uuid().optional(),scheduledAt:z.string(),meetingUrl:z.string().url().optional(),providerUserId:z.string().uuid().optional(),consentConfirmed:z.boolean().default(false)}).parse(req.body||{});if(!pool)return reply.code(201).send(fallbackAdvanced('telemedicine',b,req));if(!b.consentConfirmed)return reply.code(409).send({error:'Telemedicine consent must be confirmed'});const r=await pool.query(`INSERT INTO telemedicine_sessions(organization_id,patient_id,appointment_id,encounter_id,scheduled_at,meeting_url,provider_user_id,consent_confirmed) VALUES($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *`,[dbOrganizationId(req),b.patientId,b.appointmentId||null,b.encounterId||null,b.scheduledAt,b.meetingUrl||null,b.providerUserId||null,b.consentConfirmed]);return reply.code(201).send(r.rows[0]);});
app.get('/api/telemedicine/sessions',async(req:any)=>{if(!pool)return {data:store.telemedicine,count:store.telemedicine.length};const r=await pool.query(`SELECT * FROM telemedicine_sessions WHERE organization_id=$1 ORDER BY scheduled_at DESC LIMIT 500`,[dbOrganizationId(req)]);return {data:r.rows,count:r.rowCount};});
app.post('/api/telemedicine/sessions/:id/start',async(req:any,reply)=>{if(!pool){const x=patch('telemedicine',req.params.id,{status:'in-progress',startedAt:now(),identityVerified:true},req);if(!x)return reply.code(404).send({error:'Session not found'});return x}const r=await pool.query(`UPDATE telemedicine_sessions SET status='in-progress',started_at=now(),identity_verified=true WHERE id=$1 AND organization_id=$2 RETURNING *`,[req.params.id,dbOrganizationId(req)]);if(!r.rowCount)return reply.code(404).send({error:'Session not found'});return r.rows[0]});
app.post('/api/telemedicine/sessions/:id/end',async(req:any,reply)=>{if(!pool){const x=patch('telemedicine',req.params.id,{status:'completed',endedAt:now()},req);if(!x)return reply.code(404).send({error:'Session not found'});return x}const r=await pool.query(`UPDATE telemedicine_sessions SET status='completed',ended_at=now() WHERE id=$1 AND organization_id=$2 RETURNING *`,[req.params.id,dbOrganizationId(req)]);if(!r.rowCount)return reply.code(404).send({error:'Session not found'});return r.rows[0]});

app.post('/api/remote-monitoring/readings',async(req:any,reply)=>{const b=z.object({patientId:z.string().uuid(),deviceId:z.string().optional(),metric:z.string(),valueNumeric:z.number().optional(),unit:z.string().optional(),measuredAt:z.string(),source:z.string().default('patient'),metadata:z.record(z.any()).default({})}).parse(req.body||{});if(!pool)return reply.code(201).send(fallbackAdvanced('remote-monitoring',b,req));let alert='none';if(b.valueNumeric!==undefined){if(b.metric==='spo2'&&b.valueNumeric<90)alert='critical';if(b.metric==='systolic'&&b.valueNumeric>=180)alert='critical';}const r=await pool.query(`INSERT INTO remote_monitoring_readings(organization_id,patient_id,device_id,metric,value_numeric,unit,measured_at,source,validation_status,alert_status,metadata) VALUES($1,$2,$3,$4,$5,$6,$7,$8,'unvalidated',$9,$10) RETURNING *`,[dbOrganizationId(req),b.patientId,b.deviceId||null,b.metric,b.valueNumeric??null,b.unit||null,b.measuredAt,b.source,alert,JSON.stringify(b.metadata)]);if(alert==='critical')await moduleCreate(req,'clinical-alerts',{patientId:b.patientId,type:'remote-monitoring',severity:'CRITICAL',title:`Critical remote ${b.metric} reading`,message:`A remote monitoring reading requires clinician review.`,source:'remote-monitoring'},'critical');return reply.code(201).send(r.rows[0]);});
app.get('/api/remote-monitoring/readings',async(req:any)=>{if(!pool)return {data:store['remote-monitoring'],count:store['remote-monitoring'].length};const params:any[]=[dbOrganizationId(req)];let where='organization_id=$1';if(req.query?.patientId){params.push(String(req.query.patientId));where+=' AND patient_id=$2';}const r=await pool.query(`SELECT * FROM remote_monitoring_readings WHERE ${where} ORDER BY measured_at DESC LIMIT 500`,params);return {data:r.rows,count:r.rowCount};});

// --- Database-backed clinical results, inventory and audit/search ---
app.get('/api/laboratory/samples',async(req:any)=>{
  if(!pool)return {data:store.laboratory.filter(x=>x.sampleId||x.orderId),count:store.laboratory.length};
  const params:any[]=[dbOrganizationId(req)]; let where='p.organization_id=$1'; if(req.query?.orderId){params.push(String(req.query.orderId));where+=' AND ls.order_id=$2';}
  const r=await pool.query(`SELECT ls.id,ls.order_id AS "orderId",co.patient_id AS "patientId",ls.barcode,ls.specimen_type AS "specimenType",ls.status,ls.collected_at AS "collectedAt",ls.received_at AS "receivedAt",ls.processed_at AS "processedAt" FROM lab_samples ls JOIN clinical_orders co ON co.id=ls.order_id JOIN patients p ON p.id=co.patient_id WHERE ${where} ORDER BY ls.id DESC LIMIT 500`,params); return {data:r.rows,count:r.rowCount};
});

app.get('/api/laboratory/results',async(req:any)=>{
  if(!pool) return {data:store.laboratory.filter(x=>x.organizationId===org(req)),count:store.laboratory.length};
  const r=await pool.query(`SELECT lr.id,co.patient_id AS "patientId",ls.barcode,lt.code,lt.name,lr.value_numeric AS "valueNumeric",lr.value_text AS "valueText",lr.unit,lr.abnormal_flag AS "abnormalFlag",lr.critical,lr.status,lr.verified_at AS "verifiedAt" FROM lab_results lr JOIN lab_samples ls ON ls.id=lr.sample_id JOIN clinical_orders co ON co.id=ls.order_id JOIN lab_tests lt ON lt.id=lr.test_id JOIN patients p ON p.id=co.patient_id WHERE p.organization_id=$1 ORDER BY lr.id DESC LIMIT 500`,[dbOrganizationId(req)]); return {data:r.rows,count:r.rowCount};
});
app.get('/api/medication-administrations',async(req:any)=>{ if(!pool)return {data:store.nursing.filter(x=>x.medicationOrderId),count:store.nursing.length}; const r=await pool.query(`SELECT ma.id,ma.medication_order_id AS "medicationOrderId",mo.patient_id AS "patientId",ma.dose,ma.route,ma.scheduled_at AS "scheduledAt",ma.administered_at AS "administeredAt",ma.status,ma.reason,ma.administered_by AS "administeredBy" FROM medication_administrations ma JOIN medication_orders mo ON mo.id=ma.medication_order_id JOIN patients p ON p.id=mo.patient_id WHERE p.organization_id=$1 ORDER BY ma.administered_at DESC NULLS LAST LIMIT 500`,[dbOrganizationId(req)]); return {data:r.rows,count:r.rowCount}; });

app.get('/api/audit',async(req:any)=>{
  if(!pool) return audit.slice(-500).reverse();
  const r=await pool.query(`SELECT id,actor_user_id AS "actorUserId",action,entity_type AS "entityType",entity_id AS "entityId",metadata,created_at AS "createdAt" FROM audit_logs WHERE organization_id=$1 ORDER BY created_at DESC LIMIT 500`,[dbOrganizationId(req)]); return r.rows;
});
app.get('/api/search',async(req:any)=>{
  const q=String(req.query?.q||'').trim(); if(!q)return {patients:[],encounters:[],appointments:[],orders:[]};
  if(!pool){const needle=q.toLowerCase();const match=(r:Row)=>Object.values(r).some(v=>typeof v==='string'&&v.toLowerCase().includes(needle));return {patients:store.patients.filter(match).slice(0,20),encounters:store.encounters.filter(match).slice(0,20),appointments:store.appointments.filter(match).slice(0,20),orders:store.orders.filter(match).slice(0,20)};}
  const like=`%${q}%`; const oid=dbOrganizationId(req);
  const [p,e,a,o]=await Promise.all([
    pool.query(`SELECT id,patient_number AS "patientNumber",first_name AS "firstName",last_name AS "lastName",phone FROM patients WHERE organization_id=$1 AND (patient_number ILIKE $2 OR first_name ILIKE $2 OR last_name ILIKE $2 OR COALESCE(phone,'') ILIKE $2) ORDER BY created_at DESC LIMIT 20`,[oid,like]),
    pool.query(`SELECT e.id,e.patient_id AS "patientId",e.type,e.status,e.started_at AS "startedAt" FROM encounters e WHERE e.organization_id=$1 AND (e.id::text ILIKE $2 OR e.type ILIKE $2 OR e.status ILIKE $2) ORDER BY e.started_at DESC LIMIT 20`,[oid,like]),
    pool.query(`SELECT a.id,a.patient_id AS "patientId",a.status,a.reason,a.start_at AS "startAt" FROM appointments a WHERE a.organization_id=$1 AND (a.id::text ILIKE $2 OR COALESCE(a.reason,'') ILIKE $2 OR a.status ILIKE $2) ORDER BY a.start_at DESC LIMIT 20`,[oid,like]),
    pool.query(`SELECT co.id,co.patient_id AS "patientId",co.order_type AS category,co.status,co.priority,co.details FROM clinical_orders co JOIN patients p ON p.id=co.patient_id WHERE p.organization_id=$1 AND (co.id::text ILIKE $2 OR co.order_type ILIKE $2 OR co.status ILIKE $2 OR co.details::text ILIKE $2) ORDER BY co.created_at DESC LIMIT 20`,[oid,like])
  ]); return {patients:p.rows,encounters:e.rows,appointments:a.rows,orders:o.rows};
});

app.post('/api/patients/:id/identifiers',async(req:any,reply)=>{
  if(!pool) return reply.code(501).send({error:'Patient identifiers require PostgreSQL'});
  const b=z.object({system:z.string().url().or(z.string().min(2)),value:z.string().min(1),identifierType:z.string().optional(),use:z.enum(['usual','official','temp','secondary','old']).default('usual'),periodStart:z.string().datetime().optional(),periodEnd:z.string().datetime().optional()}).parse(req.body||{});
  const r=await pool.query(`INSERT INTO patient_identifiers(organization_id,patient_id,system,value,identifier_type,use,period_start,period_end) SELECT $1,$2,$3,$4,$5,$6,$7,$8 WHERE EXISTS(SELECT 1 FROM patients WHERE id=$2 AND organization_id=$1) RETURNING id,system,value,identifier_type AS "identifierType",use,period_start AS "periodStart",period_end AS "periodEnd"`,[dbOrganizationId(req),req.params.id,b.system,b.value,b.identifierType||null,b.use,b.periodStart||null,b.periodEnd||null]);
  if(!r.rowCount) return reply.code(404).send({error:'Patient not found'}); await pool.query(`INSERT INTO audit_logs(organization_id,actor_user_id,action,entity_type,entity_id,metadata) VALUES($1,$2,'CREATE','patient_identifier',$3,$4)`,[dbOrganizationId(req),dbUserId(req),r.rows[0].id,JSON.stringify({patientId:req.params.id,system:b.system})]); return reply.code(201).send(r.rows[0]);
});

app.get('/api/uganda/profile',async()=>({country:'UG',countryName:'Uganda',currency:'UGX',defaultLocale:'en-UG',supportedLanguages:['en','lg','sw','rn'],clinicalContentPolicy:'Configured and versioned; local/national clinical protocols require governance approval',interoperability:{fhir:'R4',hl7v2:true,dicom:true},nationalAlignment:{healthInformationExchangeGuidelines:'Uganda MoH',digitalHealthArchitecture:'Uganda DH-ASK 2024',privacy:'Uganda Data Protection and Privacy framework'},externalIntegration:{nationalHIE:'not-connected',facilityRegistry:'not-connected',terminologyRegistry:'not-connected'},note:'ClinAI provides an integration-ready architecture; it does not claim live connection to Uganda national systems until credentials and approved interfaces are configured.'}));

// --- FHIR R4 canonical endpoint surface (Release 1 additive layer) ---
// ClinAI keeps its existing domain model as the source of truth and exposes a
// standards-facing FHIR R4 surface without replacing or reshaping legacy tables.
const FHIR_R4_RESOURCES = ['Patient','Encounter','Observation','MedicationRequest','ServiceRequest','DiagnosticReport','Immunization','CarePlan','Procedure','MedicationAdministration','Appointment'] as const;
app.get('/api/fhir/R4/metadata',async()=>({resourceType:'CapabilityStatement',id:'clinai-fhir-r4',url:'https://clinai.health/fhir/CapabilityStatement/clinai-r4',version:'1.0.0',status:'active',kind:'instance',software:{name:'ClinAI',version:process.env.CLINAI_VERSION||'development'},implementation:{description:'ClinAI FHIR R4 compatibility surface backed by the existing clinical domain model.'},fhirVersion:'4.0.1',format:['json'],rest:[{mode:'server',resource:FHIR_R4_RESOURCES.map(type=>({type,interaction:[{code:'read'}],searchInclude:[]}))}]}));

// --- FHIR R4 resource endpoints ---
app.get('/api/fhir/Encounter/:id',async(req:any,reply)=>{
  if(!pool)return reply.code(501).send({error:'FHIR Encounter requires PostgreSQL'});
  const r=await pool.query(`SELECT e.id,e.patient_id,e.status,e.type,e.started_at,e.ended_at FROM encounters e WHERE e.id=$1 AND e.organization_id=$2`,[req.params.id,dbOrganizationId(req)]); if(!r.rowCount)return reply.code(404).send({resourceType:'OperationOutcome',issue:[{severity:'error',code:'not-found',diagnostics:'Encounter not found'}]}); const x=r.rows[0]; return {resourceType:'Encounter',id:x.id,status:x.status,class:{system:'http://terminology.hl7.org/CodeSystem/v3-ActCode',code:x.type},subject:{reference:`Patient/${x.patient_id}`},period:{start:x.started_at,end:x.ended_at}};
});
app.get('/api/fhir/Observation/:id',async(req:any,reply)=>{
  if(!pool)return reply.code(501).send({error:'FHIR Observation requires PostgreSQL'}); const r=await pool.query(`SELECT o.id,o.patient_id,o.encounter_id,o.code_system,o.code,o.display,o.value_numeric,o.value_text,o.unit,o.observed_at FROM observations o JOIN patients p ON p.id=o.patient_id WHERE o.id=$1 AND p.organization_id=$2`,[req.params.id,dbOrganizationId(req)]); if(!r.rowCount)return reply.code(404).send({resourceType:'OperationOutcome',issue:[{severity:'error',code:'not-found',diagnostics:'Observation not found'}]}); const x=r.rows[0]; const value=x.value_numeric!==null?{value:Number(x.value_numeric),unit:x.unit}:x.value_text!==null?{value:x.value_text}:undefined; return clean({resourceType:'Observation',id:x.id,status:'final',code:{coding:x.code?[{system:x.code_system||undefined,code:x.code,display:x.display}]:undefined,text:x.display},subject:{reference:`Patient/${x.patient_id}`},encounter:x.encounter_id?{reference:`Encounter/${x.encounter_id}`}:undefined,effectiveDateTime:x.observed_at,valueQuantity:value&&typeof value.value==='number'?value:undefined,valueString:value&&typeof value.value==='string'?value.value:undefined});
});
app.get('/api/fhir/MedicationRequest/:id',async(req:any,reply)=>{
  if(!pool)return reply.code(501).send({error:'FHIR MedicationRequest requires PostgreSQL'}); const r=await pool.query(`SELECT mo.id,mo.patient_id,mo.encounter_id,mo.dose,mo.frequency,mo.route,mo.duration,mo.quantity,mo.status,m.code,m.name,m.strength,m.form FROM medication_orders mo JOIN medications m ON m.id=mo.medication_id JOIN patients p ON p.id=mo.patient_id WHERE mo.id=$1 AND p.organization_id=$2`,[req.params.id,dbOrganizationId(req)]); if(!r.rowCount)return reply.code(404).send({resourceType:'OperationOutcome',issue:[{severity:'error',code:'not-found',diagnostics:'Medication order not found'}]}); const x=r.rows[0]; return clean({resourceType:'MedicationRequest',id:x.id,status:x.status,intent:'order',medicationCodeableConcept:{coding:x.code?[{system:'https://clinai.health/medication',code:x.code,display:x.name}]:undefined,text:[x.name,x.strength,x.form].filter(Boolean).join(' ')},subject:{reference:`Patient/${x.patient_id}`},encounter:x.encounter_id?{reference:`Encounter/${x.encounter_id}`}:undefined,dosageInstruction:[{text:[x.dose,x.frequency,x.route,x.duration].filter(Boolean).join(' ')}],dispenseRequest:x.quantity?{quantity:{value:Number(x.quantity)}}:undefined});
});


app.get('/api/fhir/DiagnosticReport/:id',async(req:any,reply)=>{
  if(!pool)return reply.code(501).send({error:'FHIR DiagnosticReport requires PostgreSQL'});
  const r=await pool.query(`SELECT lr.id,co.patient_id,ls.order_id,lt.code,lt.name,lr.status,lr.value_numeric,lr.value_text,lr.unit,lr.critical,lr.verified_at FROM lab_results lr JOIN lab_samples ls ON ls.id=lr.sample_id JOIN clinical_orders co ON co.id=ls.order_id JOIN lab_tests lt ON lt.id=lr.test_id JOIN patients p ON p.id=co.patient_id WHERE lr.id=$1 AND p.organization_id=$2`,[req.params.id,dbOrganizationId(req)]);
  if(!r.rowCount)return reply.code(404).send({resourceType:'OperationOutcome',issue:[{severity:'error',code:'not-found',diagnostics:'Diagnostic report not found'}]}); const x=r.rows[0];
  return clean({resourceType:'DiagnosticReport',id:x.id,status:x.status==='released'?'final':x.status==='verified'?'final':'preliminary',code:{coding:[{system:'https://clinai.health/lab',code:x.code,display:x.name}]},subject:{reference:`Patient/${x.patient_id}`},basedOn:[{reference:`ServiceRequest/${x.order_id}`}],issued:x.verified_at});
});
app.get('/api/fhir/ServiceRequest/:id',async(req:any,reply)=>{
  if(!pool)return reply.code(501).send({error:'FHIR ServiceRequest requires PostgreSQL'}); const r=await pool.query(`SELECT co.id,co.patient_id,co.order_type,co.priority,co.status,co.details,co.created_at FROM clinical_orders co JOIN patients p ON p.id=co.patient_id WHERE co.id=$1 AND p.organization_id=$2`,[req.params.id,dbOrganizationId(req)]); if(!r.rowCount)return reply.code(404).send({resourceType:'OperationOutcome',issue:[{severity:'error',code:'not-found',diagnostics:'Service request not found'}]}); const x=r.rows[0]; return {resourceType:'ServiceRequest',id:x.id,status:x.status==='ordered'?'active':x.status,intent:'order',priority:x.priority,code:{text:x.details?.description||x.order_type,coding:x.details?.code?[{system:'https://clinai.health/order',code:x.details.code}]:undefined},subject:{reference:`Patient/${x.patient_id}`},authoredOn:x.created_at};
});

// --- FHIR R4 longitudinal resources ---
app.get('/api/fhir/Immunization/:id',async(req:any,reply)=>{
  if(!pool) return reply.code(501).send({error:'FHIR Immunization requires PostgreSQL'});
  const r=await pool.query(`SELECT i.id,i.patient_id,i.vaccine_code,i.vaccine_name,i.dose_number,i.administered_at,i.lot_number,i.expiry_date,i.route,i.site,i.status FROM immunizations i JOIN patients p ON p.id=i.patient_id WHERE i.id=$1 AND p.organization_id=$2`,[req.params.id,dbOrganizationId(req)]); if(!r.rowCount)return reply.code(404).send({resourceType:'OperationOutcome',issue:[{severity:'error',code:'not-found',diagnostics:'Immunization not found'}]}); const x=r.rows[0]; return clean({resourceType:'Immunization',id:x.id,status:x.status==='administered'?'completed':x.status,vaccineCode:{coding:[{system:'https://clinai.health/vaccine',code:x.vaccine_code,display:x.vaccine_name}],text:x.vaccine_name},patient:{reference:`Patient/${x.patient_id}`},occurrenceDateTime:x.administered_at,lotNumber:x.lot_number,expirationDate:x.expiry_date,route:x.route?{text:x.route}:undefined,site:x.site?{text:x.site}:undefined,protocolApplied:x.dose_number?[{doseNumberPositiveInt:Number.parseInt(x.dose_number,10)||undefined}]:undefined});
});
app.get('/api/fhir/CarePlan/:id',async(req:any,reply)=>{
  if(!pool)return reply.code(501).send({error:'FHIR CarePlan requires PostgreSQL'}); const r=await pool.query(`SELECT c.id,c.patient_id,c.encounter_id,c.title,c.status,c.goals FROM care_plans c JOIN patients p ON p.id=c.patient_id WHERE c.id=$1 AND p.organization_id=$2`,[req.params.id,dbOrganizationId(req)]); if(!r.rowCount)return reply.code(404).send({resourceType:'OperationOutcome',issue:[{severity:'error',code:'not-found',diagnostics:'CarePlan not found'}]}); const x=r.rows[0]; return clean({resourceType:'CarePlan',id:x.id,status:x.status,intent:'plan',title:x.title,subject:{reference:`Patient/${x.patient_id}`},encounter:x.encounter_id?{reference:`Encounter/${x.encounter_id}`}:undefined,goal:Array.isArray(x.goals)?x.goals.map((g:any)=>({display:g.display||g.description||String(g)})):undefined});
});
app.get('/api/fhir/Procedure/:id',async(req:any,reply)=>{
  if(!pool)return reply.code(501).send({error:'FHIR Procedure requires PostgreSQL'}); const r=await pool.query(`SELECT pr.id,pr.patient_id,pr.encounter_id,pr.code_system,pr.code,pr.display,pr.performed_at,pr.performer_user_id FROM procedures pr JOIN patients p ON p.id=pr.patient_id WHERE pr.id=$1 AND p.organization_id=$2`,[req.params.id,dbOrganizationId(req)]); if(!r.rowCount)return reply.code(404).send({resourceType:'OperationOutcome',issue:[{severity:'error',code:'not-found',diagnostics:'Procedure not found'}]}); const x=r.rows[0]; return clean({resourceType:'Procedure',id:x.id,status:'completed',code:{coding:x.code?[{system:x.code_system||undefined,code:x.code,display:x.display}]:undefined,text:x.display},subject:{reference:`Patient/${x.patient_id}`},encounter:x.encounter_id?{reference:`Encounter/${x.encounter_id}`}:undefined,performedDateTime:x.performed_at});
});
app.get('/api/fhir/MedicationAdministration/:id',async(req:any,reply)=>{
  if(!pool)return reply.code(501).send({error:'FHIR MedicationAdministration requires PostgreSQL'}); const r=await pool.query(`SELECT ma.id,mo.patient_id,mo.medication_id,m.code,m.name,m.strength,m.form,ma.dose,ma.route,ma.scheduled_at,ma.administered_at,ma.status,ma.reason FROM medication_administrations ma JOIN medication_orders mo ON mo.id=ma.medication_order_id JOIN medications m ON m.id=mo.medication_id JOIN patients p ON p.id=mo.patient_id WHERE ma.id=$1 AND p.organization_id=$2`,[req.params.id,dbOrganizationId(req)]); if(!r.rowCount)return reply.code(404).send({resourceType:'OperationOutcome',issue:[{severity:'error',code:'not-found',diagnostics:'Medication administration not found'}]}); const x=r.rows[0]; return clean({resourceType:'MedicationAdministration',id:x.id,status:x.status,medicationCodeableConcept:{coding:x.code?[{system:'https://clinai.health/medication',code:x.code,display:x.name}]:undefined,text:[x.name,x.strength,x.form].filter(Boolean).join(' ')},subject:{reference:`Patient/${x.patient_id}`},effectiveDateTime:x.administered_at||x.scheduled_at,dosage:{dose:x.dose?{value:Number.parseFloat(x.dose)||undefined,unit:x.dose}:undefined,route:x.route?{text:x.route}:undefined},statusReason:x.reason?[{text:x.reason}]:undefined});
});
app.get('/api/fhir/Appointment/:id',async(req:any,reply)=>{
  if(!pool) return reply.code(501).send({error:'FHIR Appointment requires PostgreSQL'});
  const r=await pool.query(`SELECT a.id,a.patient_id,a.provider_user_id,a.facility_id,a.start_at,a.end_at,a.type,a.status,a.reason FROM appointments a WHERE a.id=$1 AND a.organization_id=$2`,[req.params.id,dbOrganizationId(req)]);
  if(!r.rowCount) return reply.code(404).send({resourceType:'OperationOutcome',issue:[{severity:'error',code:'not-found',diagnostics:'Appointment not found'}]});
  const x=r.rows[0];
  const participants:any[]=[{actor:{reference:`Patient/${x.patient_id}`},status:'accepted'}];
  if(x.provider_user_id) participants.push({actor:{reference:`Practitioner/${x.provider_user_id}`},status:'accepted'});
  return clean({resourceType:'Appointment',id:x.id,status:x.status,appointmentType:x.type?{text:x.type}:undefined,reason:x.reason?[{text:x.reason}]:undefined,start:x.start_at,end:x.end_at,participant:participants});
});
app.get('/api/fhir/ServiceRequest',async(req:any,reply)=>{
  if(!pool)return reply.code(501).send({error:'FHIR ServiceRequest search requires PostgreSQL'}); const q=String(req.query?.patient||req.query?.patientId||'').trim(); const params:any[]=[dbOrganizationId(req)]; let where='p.organization_id=$1'; if(q){params.push(q);where+=' AND (co.patient_id::text=$2 OR co.id::text=$2)';} const r=await pool.query(`SELECT co.id,co.patient_id,co.encounter_id,co.order_type,co.priority,co.status,co.details,co.created_at FROM clinical_orders co JOIN patients p ON p.id=co.patient_id WHERE ${where} ORDER BY co.created_at DESC LIMIT 100`,params); const entries=r.rows.map((x:any)=>({fullUrl:`urn:uuid:${x.id}`,resource:{resourceType:'ServiceRequest',id:x.id,status:x.status==='ordered'?'active':x.status,intent:'order',priority:x.priority,code:{text:x.details?.description||x.order_type},subject:{reference:`Patient/${x.patient_id}`},encounter:x.encounter_id?{reference:`Encounter/${x.encounter_id}`}:undefined,authoredOn:x.created_at}})); return {resourceType:'Bundle',type:'searchset',total:entries.length,entry:entries};
});

// --- V6 Uganda clinical content, interoperability, governance and offline foundations ---
app.get('/api/uganda/architecture',async()=>({
  country:'UG', currency:'UGX', locale:'en-UG', jurisdiction:'UG',
  sources:[
    {name:'Uganda MoH Strategic Plan II 2025/26-2029/30',status:'reference',year:2026},
    {name:'Uganda Health Information Exchange and Interoperability Guidelines',status:'reference',year:2023},
    {name:'Uganda Digital Health Architecture, Standards and Knowledge products (DH-ASK)',status:'reference',year:2024},
    {name:'Uganda EMR Implementation Guidelines',status:'reference',year:2024},
    {name:'WHO SMART Guidelines Base',status:'reference',version:'1.0.0',fhir:'R4'},
    {name:'WHO Immunization DAK',status:'reference',version:'1.1.0',fhir:'R4'},
    {name:'WHO Infectious Disease Surveillance DAK',status:'reference',year:2026}
  ],
  integrationBoundary:{nationalHIE:'adapter-ready; not connected',facilityRegistry:'adapter-ready; not connected',healthWorkerRegistry:'adapter-ready; not connected',terminologyRegistry:'local registry enabled; external connection not configured',reporting:'mapping engine enabled; external submission not connected'}
}));

app.get('/api/facilities/:facilityId/identifiers',async(req:any)=>{ if(!pool)return {data:[]}; const r=await pool.query(`SELECT id,system,value,identifier_type AS "identifierType",period_start AS "periodStart",period_end AS "periodEnd" FROM facility_identifiers WHERE facility_id=$1 AND organization_id=$2 ORDER BY created_at DESC`,[req.params.facilityId,dbOrganizationId(req)]); return {data:r.rows}; });
app.post('/api/facilities/:facilityId/identifiers',async(req:any,reply)=>{ if(!pool)return reply.code(501).send({error:'PostgreSQL required'}); const b=z.object({system:z.string().url().or(z.string().min(2)),value:z.string().min(1),identifierType:z.string().optional(),periodStart:z.string().optional(),periodEnd:z.string().optional()}).parse(req.body); const r=await pool.query(`INSERT INTO facility_identifiers(organization_id,facility_id,system,value,identifier_type,period_start,period_end) SELECT $1,$2,$3,$4,$5,$6,$7 WHERE EXISTS(SELECT 1 FROM facilities WHERE id=$2 AND organization_id=$1) RETURNING id,system,value,identifier_type AS "identifierType",period_start AS "periodStart",period_end AS "periodEnd"`,[dbOrganizationId(req),req.params.facilityId,b.system,b.value,b.identifierType||null,b.periodStart||null,b.periodEnd||null]); if(!r.rowCount)return reply.code(404).send({error:'Facility not found'}); return reply.code(201).send(r.rows[0]); });

app.get('/api/health-workers',async(req:any)=>{ if(!pool)return {data:[]}; const r=await pool.query(`SELECT h.id,h.user_id AS "userId",u.display_name AS "displayName",u.email,h.facility_id AS "facilityId",h.cadre,h.profession,h.registration_system AS "registrationSystem",h.registration_number AS "registrationNumber",h.specialty,h.status,h.verified_at AS "verifiedAt" FROM health_worker_profiles h JOIN users u ON u.id=h.user_id WHERE h.organization_id=$1 ORDER BY u.display_name`,[dbOrganizationId(req)]); return {data:r.rows}; });
app.post('/api/health-workers',async(req:any,reply)=>{ if(!pool)return reply.code(501).send({error:'PostgreSQL required'}); const b=z.object({userId:z.string().uuid(),facilityId:z.string().uuid().optional(),cadre:z.string().min(1),profession:z.string().optional(),registrationSystem:z.string().optional(),registrationNumber:z.string().optional(),specialty:z.string().optional(),metadata:z.record(z.any()).optional()}).parse(req.body); const r=await pool.query(`INSERT INTO health_worker_profiles(organization_id,user_id,facility_id,cadre,profession,registration_system,registration_number,specialty,metadata) SELECT $1,$2,$3,$4,$5,$6,$7,$8,$9 WHERE EXISTS(SELECT 1 FROM users WHERE id=$2) RETURNING id,user_id AS "userId",facility_id AS "facilityId",cadre,profession,registration_system AS "registrationSystem",registration_number AS "registrationNumber",specialty,status,metadata`,[dbOrganizationId(req),b.userId,b.facilityId||null,b.cadre,b.profession||null,b.registrationSystem||null,b.registrationNumber||null,b.specialty||null,JSON.stringify(b.metadata||{})]); if(!r.rowCount)return reply.code(404).send({error:'User not found'}); return reply.code(201).send(r.rows[0]); });

app.get('/api/terminology',async(req:any)=>{ if(!pool)return {data:[]}; const system=String(req.query?.system||'').trim(),code=String(req.query?.code||'').trim(); const params:any[]=[dbOrganizationId(req)]; let where='(organization_id=$1 OR organization_id IS NULL)'; if(system){params.push(system);where+=' AND system_uri=$2'} if(code){params.push(code);where+=` AND code=$${params.length}`}; const r=await pool.query(`SELECT id,system_uri AS "system",code,display,version,status,source,source_url AS "sourceUrl",properties FROM terminology_concepts WHERE ${where} ORDER BY display LIMIT 200`,params); return {data:r.rows}; });
app.post('/api/terminology',async(req:any,reply)=>{ if(!pool)return reply.code(501).send({error:'PostgreSQL required'}); const b=z.object({system:z.string().min(2),code:z.string().min(1),display:z.string().min(1),version:z.string().optional(),status:z.string().default('active'),source:z.string().optional(),sourceUrl:z.string().url().optional(),properties:z.record(z.any()).optional()}).parse(req.body); const r=await pool.query(`INSERT INTO terminology_concepts(organization_id,system_uri,code,display,version,status,source,source_url,properties) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING id,system_uri AS "system",code,display,version,status,source,source_url AS "sourceUrl",properties`,[dbOrganizationId(req),b.system,b.code,b.display,b.version||null,b.status,b.source||null,b.sourceUrl||null,JSON.stringify(b.properties||{})]); return reply.code(201).send(r.rows[0]); });

app.get('/api/guidelines',async(req:any)=>{ if(!pool)return {data:[]}; const j=String(req.query?.jurisdiction||'').trim(),d=String(req.query?.domain||'').trim(); const params:any[]=[dbOrganizationId(req)]; let where='(organization_id=$1 OR organization_id IS NULL)'; if(j){params.push(j);where+=` AND jurisdiction=$${params.length}`} if(d){params.push(d);where+=` AND domain=$${params.length}`}; const r=await pool.query(`SELECT id,jurisdiction,domain,title,publisher,version,source_url AS "sourceUrl",effective_from AS "effectiveFrom",effective_to AS "effectiveTo",status,machine_readable AS "machineReadable",metadata FROM clinical_guidelines WHERE ${where} ORDER BY updated_at DESC`,params); return {data:r.rows}; });
app.post('/api/guidelines',async(req:any,reply)=>{ if(!pool)return reply.code(501).send({error:'PostgreSQL required'}); const b=z.object({jurisdiction:z.string().min(2),domain:z.string().min(2),title:z.string().min(1),publisher:z.string().min(1),version:z.string().optional(),sourceUrl:z.string().url().optional(),effectiveFrom:z.string().optional(),effectiveTo:z.string().optional(),status:z.enum(['draft','active','retired']).default('draft'),machineReadable:z.boolean().default(false),metadata:z.record(z.any()).optional()}).parse(req.body); const r=await pool.query(`INSERT INTO clinical_guidelines(organization_id,jurisdiction,domain,title,publisher,version,source_url,effective_from,effective_to,status,machine_readable,metadata) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) RETURNING id,jurisdiction,domain,title,publisher,version,source_url AS "sourceUrl",status,machine_readable AS "machineReadable",metadata`,[dbOrganizationId(req),b.jurisdiction,b.domain,b.title,b.publisher,b.version||null,b.sourceUrl||null,b.effectiveFrom||null,b.effectiveTo||null,b.status,b.machineReadable,JSON.stringify(b.metadata||{})]); return reply.code(201).send(r.rows[0]); });
app.post('/api/guidelines/:id/rules',async(req:any,reply)=>{ if(!pool)return reply.code(501).send({error:'PostgreSQL required'}); const b=z.object({ruleKey:z.string().min(1),description:z.string().optional(),inputSchema:z.record(z.any()).optional(),logic:z.record(z.any()),outputSchema:z.record(z.any()).optional(),priority:z.number().int().default(100),active:z.boolean().default(true)}).parse(req.body); const r=await pool.query(`INSERT INTO clinical_guideline_rules(guideline_id,rule_key,description,input_schema,logic,output_schema,priority,active) SELECT $1,$2,$3,$4,$5,$6,$7,$8 WHERE EXISTS(SELECT 1 FROM clinical_guidelines WHERE id=$1 AND (organization_id=$9 OR organization_id IS NULL)) RETURNING id,rule_key,description,input_schema AS "inputSchema",logic,output_schema AS "outputSchema",priority,active`,[req.params.id,b.ruleKey,b.description||null,JSON.stringify(b.inputSchema||{}),JSON.stringify(b.logic),JSON.stringify(b.outputSchema||{}),b.priority,b.active,dbOrganizationId(req)]); if(!r.rowCount)return reply.code(404).send({error:'Guideline not found'}); return reply.code(201).send(r.rows[0]); });

// --- CDSS foundation: governed rules, evaluations and clinician-facing signals ---
app.post('/api/cdss/evaluate',async(req:any,reply)=>{
  if(!pool)return reply.code(501).send({error:'PostgreSQL required'});
  const b=z.object({
    eventId:z.string().uuid().optional(),
    eventType:z.string().min(1),
    aggregateType:z.string().optional(),
    aggregateId:z.string().optional(),
    patientId:z.string().uuid().optional(),
    encounterId:z.string().uuid().optional(),
    payload:z.record(z.any()).optional(),
    ruleScope:z.array(z.string()).optional(),
  }).parse(req.body||{});
  const organizationId=dbOrganizationId(req);
  if(!organizationId)return reply.code(401).send({error:'Organization context required'});
  if(b.patientId){
    const patient=await pool.query('SELECT id FROM patients WHERE id=$1 AND organization_id=$2',[b.patientId,organizationId]);
    if(!patient.rowCount)return reply.code(404).send({error:'Patient not found'});
  }
  const requested=b.ruleScope?.filter(x=>SYNCHRONOUS_CDSS_RULES.has(x));
  const result=await evaluateClinicalContext(pool,{
    mode:'sync',
    trigger:{eventId:b.eventId,eventType:b.eventType,organizationId,aggregateType:b.aggregateType,aggregateId:b.aggregateId,patientId:b.patientId||null,encounterId:b.encounterId||null,payload:b.payload},
    ruleScope:requested,
  });
  return {data:result};
});

app.get('/api/cdss/signals',async(req:any)=>{
  if(!pool)return {data:[]};
  const patientId=String(req.query?.patientId||'').trim();
  const status=String(req.query?.status||'').trim();
  const severity=String(req.query?.severity||'').trim();
  const params:any[]=[dbOrganizationId(req)]; let n=2; const where=['organization_id=$1'];
  if(patientId){where.push(`patient_id=$${n++}`);params.push(patientId)}
  if(status){where.push(`status=$${n++}`);params.push(status)}
  if(severity){where.push(`severity=$${n++}`);params.push(severity)}
  const r=await pool.query(`SELECT id,patient_id AS "patientId",encounter_id AS "encounterId",rule_version_id AS "ruleVersionId",source_event_id AS "sourceEventId",signal_type AS "signalType",severity,status,title,summary,evidence,recommendation,action_url AS "actionUrl",detected_at AS "detectedAt",acknowledged_at AS "acknowledgedAt",resolved_at AS "resolvedAt",snoozed_until AS "snoozedUntil",created_at AS "createdAt",updated_at AS "updatedAt" FROM clinical_signals WHERE ${where.join(' AND ')} ORDER BY CASE severity WHEN 'critical' THEN 1 WHEN 'high' THEN 2 WHEN 'moderate' THEN 3 WHEN 'low' THEN 4 ELSE 5 END,detected_at DESC LIMIT 200`,params);
  return {data:r.rows};
});

app.get('/api/cdss/signals/:id',async(req:any,reply)=>{
  if(!pool)return reply.code(501).send({error:'PostgreSQL required'});
  const r=await pool.query(`SELECT s.*,rv.version AS "ruleVersion",rv.engine,gr.rule_key AS "ruleKey",g.title AS "guidelineTitle",g.publisher,g.jurisdiction,g.version AS "guidelineVersion" FROM clinical_signals s LEFT JOIN cdss_rule_versions rv ON rv.id=s.rule_version_id LEFT JOIN clinical_guideline_rules gr ON gr.id=rv.guideline_rule_id LEFT JOIN clinical_guidelines g ON g.id=gr.guideline_id WHERE s.id=$1 AND s.organization_id=$2`,[req.params.id,dbOrganizationId(req)]);
  if(!r.rowCount)return reply.code(404).send({error:'Clinical signal not found'});
  const a=await pool.query(`SELECT id,actor_user_id AS "actorUserId",action,reason,metadata,created_at AS "createdAt" FROM clinical_signal_actions WHERE signal_id=$1 AND organization_id=$2 ORDER BY created_at DESC`,[req.params.id,dbOrganizationId(req)]);
  return {data:{...r.rows[0],actions:a.rows}};
});

app.post('/api/cdss/signals/:id/action',async(req:any,reply)=>{
  if(!pool)return reply.code(501).send({error:'PostgreSQL required'});
  const b=z.object({action:z.enum(['acknowledge','snooze','resolve','dismiss','reopen','view']),reason:z.string().optional(),snoozedUntil:z.string().optional(),metadata:z.record(z.any()).default({})}).parse(req.body||{});
  const client=await pool.connect();
  try{
    await client.query('BEGIN');
    const existing=await client.query(`SELECT id,status FROM clinical_signals WHERE id=$1 AND organization_id=$2 FOR UPDATE`,[req.params.id,dbOrganizationId(req)]);
    if(!existing.rowCount){await client.query('ROLLBACK');return reply.code(404).send({error:'Clinical signal not found'});}
    const statusMap:any={acknowledge:'acknowledged',snooze:'snoozed',resolve:'resolved',dismiss:'dismissed',reopen:'open',view:existing.rows[0].status};
    const nextStatus=statusMap[b.action];
    const r=await client.query(`UPDATE clinical_signals SET status=$1,snoozed_until=CASE WHEN $2='snooze' THEN $3 ELSE NULL END,acknowledged_by=CASE WHEN $2='acknowledge' THEN $4 ELSE acknowledged_by END,acknowledged_at=CASE WHEN $2='acknowledge' THEN now() ELSE acknowledged_at END,resolved_by=CASE WHEN $2='resolve' THEN $4 ELSE resolved_by END,resolved_at=CASE WHEN $2='resolve' THEN now() ELSE resolved_at END,updated_at=now() WHERE id=$5 AND organization_id=$6 RETURNING id,status,snoozed_until AS "snoozedUntil",acknowledged_at AS "acknowledgedAt",resolved_at AS "resolvedAt"`,[nextStatus,b.action,b.snoozedUntil||null,dbUserId(req),req.params.id,dbOrganizationId(req)]);
    await client.query(`INSERT INTO clinical_signal_actions(signal_id,organization_id,actor_user_id,action,reason,metadata) VALUES($1,$2,$3,$4,$5,$6)`,[req.params.id,dbOrganizationId(req),dbUserId(req),b.action,b.reason||null,JSON.stringify(b.metadata)]);
    await dbAudit(client,req,`CDSS_${b.action.toUpperCase()}`,'clinical_signal',req.params.id,{reason:b.reason||null});
    await client.query('COMMIT');
    return {data:r.rows[0]};
  }catch(e){await client.query('ROLLBACK');throw e}finally{client.release()}
});

app.get('/api/cdss/rules',async(req:any)=>{
  if(!pool)return {data:[]};
  const status=String(req.query?.status||'').trim(); const params:any[]=[dbOrganizationId(req)]; let where='(g.organization_id=$1 OR g.organization_id IS NULL)';
  if(status){params.push(status);where+=` AND rv.status=$${params.length}`;}
  const r=await pool.query(`SELECT rv.id,rv.guideline_rule_id AS "guidelineRuleId",rv.version,rv.status,rv.engine,rv.evidence,rv.effective_from AS "effectiveFrom",rv.effective_to AS "effectiveTo",rv.approved_at AS "approvedAt",gr.rule_key AS "ruleKey",gr.description,g.id AS "guidelineId",g.title AS "guidelineTitle",g.publisher,g.jurisdiction,g.version AS "guidelineVersion" FROM cdss_rule_versions rv JOIN clinical_guideline_rules gr ON gr.id=rv.guideline_rule_id JOIN clinical_guidelines g ON g.id=gr.guideline_id WHERE ${where} ORDER BY rv.updated_at DESC`,params);
  return {data:r.rows};
});

app.post('/api/cdss/rules/:ruleId/versions',async(req:any,reply)=>{
  if(!pool)return reply.code(501).send({error:'PostgreSQL required'});
  const b=z.object({version:z.string().min(1),status:z.enum(['draft','review','approved','active','retired']).default('draft'),engine:z.enum(['clinai-json','cql']).default('clinai-json'),logic:z.record(z.any()).default({}),evidence:z.record(z.any()).default({}),effectiveFrom:z.string().optional(),effectiveTo:z.string().optional()}).parse(req.body||{});
  const owns=await pool.query(`SELECT gr.id FROM clinical_guideline_rules gr JOIN clinical_guidelines g ON g.id=gr.guideline_id WHERE gr.id=$1 AND (g.organization_id=$2 OR g.organization_id IS NULL)`,[req.params.ruleId,dbOrganizationId(req)]);
  if(!owns.rowCount)return reply.code(404).send({error:'Guideline rule not found'});
  const r=await pool.query(`INSERT INTO cdss_rule_versions(guideline_rule_id,version,status,engine,logic,evidence,effective_from,effective_to,created_by) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING id,guideline_rule_id AS "guidelineRuleId",version,status,engine,logic,evidence,effective_from AS "effectiveFrom",effective_to AS "effectiveTo",created_at AS "createdAt"`,[req.params.ruleId,b.version,b.status,b.engine,JSON.stringify(b.logic),JSON.stringify(b.evidence),b.effectiveFrom||null,b.effectiveTo||null,dbUserId(req)]);
  return reply.code(201).send({data:r.rows[0]});
});

app.get('/api/cdss/summary',async(req:any)=>{
  if(!pool)return {data:{}}; const o=dbOrganizationId(req);
  const r=await pool.query(`SELECT count(*) FILTER (WHERE status='open')::int AS open,count(*) FILTER (WHERE status='acknowledged')::int AS acknowledged,count(*) FILTER (WHERE severity='critical' AND status IN ('open','acknowledged'))::int AS critical,count(*) FILTER (WHERE severity='high' AND status IN ('open','acknowledged'))::int AS high FROM clinical_signals WHERE organization_id=$1`,[o]);
  return {data:r.rows[0]};
});


app.get('/api/care-pathways',async(req:any)=>{ if(!pool)return {data:[]}; const r=await pool.query(`SELECT id,code,name,domain,jurisdiction,version,status,source_guideline_id AS "sourceGuidelineId",metadata FROM care_pathways WHERE organization_id=$1 OR organization_id IS NULL ORDER BY updated_at DESC`,[dbOrganizationId(req)]); return {data:r.rows}; });
app.post('/api/care-pathways',async(req:any,reply)=>{ if(!pool)return reply.code(501).send({error:'PostgreSQL required'}); const b=z.object({code:z.string().min(1),name:z.string().min(1),domain:z.string().min(1),jurisdiction:z.string().default('UG'),version:z.string().min(1),status:z.string().default('draft'),sourceGuidelineId:z.string().uuid().optional(),metadata:z.record(z.any()).optional()}).parse(req.body); const r=await pool.query(`INSERT INTO care_pathways(organization_id,code,name,domain,jurisdiction,version,status,source_guideline_id,metadata) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING id,code,name,domain,jurisdiction,version,status,source_guideline_id AS "sourceGuidelineId",metadata`,[dbOrganizationId(req),b.code,b.name,b.domain,b.jurisdiction,b.version,b.status,b.sourceGuidelineId||null,JSON.stringify(b.metadata||{})]); return reply.code(201).send(r.rows[0]); });
app.post('/api/care-pathways/:id/steps',async(req:any,reply)=>{ if(!pool)return reply.code(501).send({error:'PostgreSQL required'}); const b=z.object({sequenceNo:z.number().int().positive(),stepCode:z.string().min(1),title:z.string().min(1),stepType:z.string().min(1),formKey:z.string().optional(),ruleKey:z.string().optional(),required:z.boolean().default(false),configuration:z.record(z.any()).optional()}).parse(req.body); const r=await pool.query(`INSERT INTO care_pathway_steps(pathway_id,sequence_no,step_code,title,step_type,form_key,rule_key,required,configuration) SELECT $1,$2,$3,$4,$5,$6,$7,$8,$9 WHERE EXISTS(SELECT 1 FROM care_pathways WHERE id=$1 AND (organization_id=$10 OR organization_id IS NULL)) RETURNING id,sequence_no AS "sequenceNo",step_code AS "stepCode",title,step_type AS "stepType",form_key AS "formKey",rule_key AS "ruleKey",required,configuration`,[req.params.id,b.sequenceNo,b.stepCode,b.title,b.stepType,b.formKey||null,b.ruleKey||null,b.required,JSON.stringify(b.configuration||{}),dbOrganizationId(req)]); if(!r.rowCount)return reply.code(404).send({error:'Pathway not found'}); return reply.code(201).send(r.rows[0]); });

app.get('/api/immunization/schedule',async(req:any)=>{ if(!pool)return {data:[]}; const jurisdiction=String(req.query?.jurisdiction||'UG'); const r=await pool.query(`SELECT id,jurisdiction,vaccine_code AS "vaccineCode",vaccine_name AS "vaccineName",dose_label AS "doseLabel",minimum_age_days AS "minimumAgeDays",recommended_age_days AS "recommendedAgeDays",interval_from_previous_days AS "intervalFromPreviousDays",eligibility,status,effective_from AS "effectiveFrom",effective_to AS "effectiveTo",source_guideline_id AS "sourceGuidelineId" FROM immunization_schedule_rules WHERE (organization_id=$1 OR organization_id IS NULL) AND jurisdiction=$2 AND status='active' ORDER BY recommended_age_days NULLS LAST,vaccine_code,dose_label`,[dbOrganizationId(req),jurisdiction]); return {data:r.rows}; });
app.post('/api/immunization/schedule',async(req:any,reply)=>{ if(!pool)return reply.code(501).send({error:'PostgreSQL required'}); const b=z.object({jurisdiction:z.string().default('UG'),vaccineCode:z.string().min(1),vaccineName:z.string().min(1),doseLabel:z.string().min(1),minimumAgeDays:z.number().int().optional(),recommendedAgeDays:z.number().int().optional(),intervalFromPreviousDays:z.number().int().optional(),eligibility:z.record(z.any()).optional(),sourceGuidelineId:z.string().uuid().optional(),status:z.enum(['draft','active','retired']).default('draft'),effectiveFrom:z.string().optional(),effectiveTo:z.string().optional()}).parse(req.body); const r=await pool.query(`INSERT INTO immunization_schedule_rules(organization_id,jurisdiction,vaccine_code,vaccine_name,dose_label,minimum_age_days,recommended_age_days,interval_from_previous_days,eligibility,source_guideline_id,status,effective_from,effective_to) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13) RETURNING id`,[dbOrganizationId(req),b.jurisdiction,b.vaccineCode,b.vaccineName,b.doseLabel,b.minimumAgeDays??null,b.recommendedAgeDays??null,b.intervalFromPreviousDays??null,JSON.stringify(b.eligibility||{}),b.sourceGuidelineId||null,b.status,b.effectiveFrom||null,b.effectiveTo||null]); return reply.code(201).send(r.rows[0]); });

app.get('/api/hie/connections',async(req:any)=>{ if(!pool)return {data:[]}; const r=await pool.query(`SELECT id,name,jurisdiction,protocol,base_url AS "baseUrl",status,capabilities,last_success_at AS "lastSuccessAt",last_error AS "lastError" FROM hie_connections WHERE organization_id=$1 ORDER BY name`,[dbOrganizationId(req)]); return {data:r.rows}; });
app.post('/api/hie/connections',async(req:any,reply)=>{ if(!pool)return reply.code(501).send({error:'PostgreSQL required'}); const b=z.object({name:z.string().min(1),jurisdiction:z.string().default('UG'),protocol:z.string().min(1),baseUrl:z.string().url().optional(),status:z.string().default('disabled'),capabilities:z.record(z.any()).optional(),credentialRef:z.string().optional()}).parse(req.body); const r=await pool.query(`INSERT INTO hie_connections(organization_id,name,jurisdiction,protocol,base_url,status,capabilities,credential_ref) VALUES($1,$2,$3,$4,$5,$6,$7,$8) RETURNING id,name,jurisdiction,protocol,base_url AS "baseUrl",status,capabilities`,[dbOrganizationId(req),b.name,b.jurisdiction,b.protocol,b.baseUrl||null,b.status,JSON.stringify(b.capabilities||{}),b.credentialRef||null]); return reply.code(201).send(r.rows[0]); });
app.post('/api/hie/messages',async(req:any,reply)=>{ if(!pool)return reply.code(501).send({error:'PostgreSQL required'}); const b=z.object({connectionId:z.string().uuid().optional(),direction:z.enum(['outbound','inbound']).default('outbound'),resourceType:z.string().optional(),externalId:z.string().optional(),correlationId:z.string().optional(),payload:z.record(z.any()),status:z.enum(['queued','processing','sent','failed','received']).default('queued')}).parse(req.body); const r=await pool.query(`INSERT INTO hie_messages(organization_id,connection_id,direction,resource_type,external_id,correlation_id,payload,status) VALUES($1,$2,$3,$4,$5,$6,$7,$8) RETURNING id,status,created_at AS "createdAt"`,[dbOrganizationId(req),b.connectionId||null,b.direction,b.resourceType||null,b.externalId||null,b.correlationId||null,JSON.stringify(b.payload),b.status]); return reply.code(201).send(r.rows[0]); });

app.get('/api/reporting/mappings',async(req:any)=>{ if(!pool)return {data:[]}; const r=await pool.query(`SELECT id,jurisdiction,reporting_system AS "reportingSystem",indicator_code AS "indicatorCode",indicator_name AS "indicatorName",source_query AS "sourceQuery",denominator_query AS "denominatorQuery",numerator_query AS "numeratorQuery",period_granularity AS "periodGranularity",version,status,source_url AS "sourceUrl" FROM reporting_mappings WHERE organization_id=$1 OR organization_id IS NULL ORDER BY reporting_system,indicator_code`,[dbOrganizationId(req)]); return {data:r.rows}; });
app.post('/api/reporting/mappings',async(req:any,reply)=>{ if(!pool)return reply.code(501).send({error:'PostgreSQL required'}); const b=z.object({jurisdiction:z.string().default('UG'),reportingSystem:z.string().min(1),indicatorCode:z.string().min(1),indicatorName:z.string().min(1),sourceQuery:z.record(z.any()),denominatorQuery:z.record(z.any()).optional(),numeratorQuery:z.record(z.any()).optional(),periodGranularity:z.string().default('monthly'),version:z.string().optional(),status:z.string().default('draft'),sourceUrl:z.string().url().optional()}).parse(req.body); const r=await pool.query(`INSERT INTO reporting_mappings(organization_id,jurisdiction,reporting_system,indicator_code,indicator_name,source_query,denominator_query,numerator_query,period_granularity,version,status,source_url) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) RETURNING id`,[dbOrganizationId(req),b.jurisdiction,b.reportingSystem,b.indicatorCode,b.indicatorName,JSON.stringify(b.sourceQuery),b.denominatorQuery?JSON.stringify(b.denominatorQuery):null,b.numeratorQuery?JSON.stringify(b.numeratorQuery):null,b.periodGranularity,b.version||null,b.status,b.sourceUrl||null]); return reply.code(201).send(r.rows[0]); });

app.post('/api/offline/sync',async(req:any,reply)=>{ if(!pool)return reply.code(501).send({error:'PostgreSQL required'}); const b=z.object({deviceId:z.string().min(1),operationId:z.string().min(1),resourceType:z.string().min(1),resourceId:z.string().optional(),operation:z.enum(['create','update','delete']),payload:z.record(z.any()),baseVersion:z.string().optional()}).parse(req.body); const r=await pool.query(`INSERT INTO offline_sync_queue(organization_id,device_id,user_id,operation_id,resource_type,resource_id,operation,payload,base_version) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9) ON CONFLICT (organization_id,operation_id) DO NOTHING RETURNING id,status,operation_id AS "operationId",created_at AS "createdAt"`,[dbOrganizationId(req),b.deviceId,dbUserId(req),b.operationId,b.resourceType,b.resourceId||null,b.operation,JSON.stringify(b.payload),b.baseVersion||null]); return reply.code(202).send(r.rows[0]||{status:'duplicate',operationId:b.operationId}); });
app.get('/api/offline/sync',async(req:any)=>{ if(!pool)return {data:[]}; const device=String(req.query?.deviceId||'').trim(); const params:any[]=[dbOrganizationId(req)]; let where='organization_id=$1 AND status IN (\'pending\',\'conflict\')'; if(device){params.push(device);where+=' AND device_id=$2'} const r=await pool.query(`SELECT id,device_id AS "deviceId",operation_id AS "operationId",resource_type AS "resourceType",resource_id AS "resourceId",operation,payload,base_version AS "baseVersion",status,conflict,attempts,created_at AS "createdAt" FROM offline_sync_queue WHERE ${where} ORDER BY created_at LIMIT 200`,params); return {data:r.rows}; });

// --- Interoperability and persistence health ---
app.get('/api/system/persistence',async(_req,reply)=>{
  if(!pool) return {mode:'development-json',database:false};
  try { const r=await pool.query('select now() as time'); return {mode:'postgresql',database:true,time:r.rows[0].time}; }
  catch(e:any){ return reply.code(503).send({mode:'postgresql',database:false,error:e.message}); }
});

function clean(o:Row){ const out:Row={}; for(const [k,v] of Object.entries(o)) if(v!==undefined) out[k]=v; return out; }
function fhirPatient(p:Row){
  return clean({resourceType:'Patient',id:p.id,identifier:[{system:'https://clinai.health/patient-number',value:p.patientNumber}],name:[{family:p.lastName,given:[p.firstName]}],gender:p.sex==='unknown'?undefined:p.sex,birthDate:p.dateOfBirth,telecom:[p.phone?{system:'phone',value:p.phone}:null,p.email?{system:'email',value:p.email}:null].filter(Boolean),address:p.address?[{text:p.address}]:undefined});
}
// Canonical FHIR R4 paths. These redirect internally to the existing, tested resource handlers.
for (const resource of FHIR_R4_RESOURCES) {
  if (resource === 'Patient') continue;
  app.all(`/api/fhir/R4/${resource}/:id`,async(req:any,reply)=>{
    const target = `/api/fhir/${resource}/${encodeURIComponent(req.params.id)}`;
    return reply.redirect(target,307);
  });
}
app.all('/api/fhir/R4/Patient/:id',async(req:any,reply)=>reply.redirect(`/api/fhir/Patient/${encodeURIComponent(req.params.id)}`,307));
app.all('/api/fhir/R4/Patient',async(req:any,reply)=>{
  const qs = new URLSearchParams(req.query as Record<string,string>);
  const suffix = qs.toString() ? `?${qs.toString()}` : '';
  return reply.redirect(`/api/fhir/Patient${suffix}`,307);
});

app.get('/api/fhir/Patient/:id',async(req:any,reply)=>{
  let p:any; if(pool){const r=await pool.query(`SELECT id,patient_number AS "patientNumber",first_name AS "firstName",middle_name AS "middleName",last_name AS "lastName",date_of_birth AS "dateOfBirth",sex,phone,email,address FROM patients WHERE id=$1 AND organization_id=$2`,[req.params.id,dbOrganizationId(req)]); p=r.rows[0];} else p=store.patients.find(x=>x.id===req.params.id && x.organizationId===org(req));
  if(!p) return reply.code(404).send({resourceType:'OperationOutcome',issue:[{severity:'error',code:'not-found',diagnostics:'Patient not found'}]});
  return fhirPatient(p);
});
app.get('/api/fhir/Patient',async(req:any)=>{
  const q=String(req.query?.identifier||req.query?.name||'').trim();
  let rows:any[]=[];
  if(pool){const params:any[]=[dbOrganizationId(req)];let where='organization_id=$1';if(q){params.push(`%${q}%`);where+=' AND (patient_number ILIKE $2 OR first_name ILIKE $2 OR last_name ILIKE $2)';}const r=await pool.query(`SELECT id,patient_number AS "patientNumber",first_name AS "firstName",last_name AS "lastName",date_of_birth AS "dateOfBirth",sex,phone,email,address FROM patients WHERE ${where} ORDER BY created_at DESC LIMIT 100`,params);rows=r.rows;}else rows=store.patients.filter(x=>x.organizationId===org(req)).filter(x=>!q || `${x.patientNumber} ${x.firstName} ${x.lastName}`.toLowerCase().includes(q.toLowerCase())).slice(0,100);
  return {resourceType:'Bundle',type:'searchset',total:rows.length,entry:rows.map(x=>({fullUrl:`urn:uuid:${x.id}`,resource:fhirPatient(x)}))};
});

app.post('/api/clinical/observations',async(req:any,reply)=>{
  const body=z.object({patientId:z.string().uuid(),encounterId:z.string().uuid().optional(),code:z.string(),display:z.string().optional(),valueNumeric:z.number().optional(),valueText:z.string().optional(),unit:z.string().optional()}).parse(req.body);
  if(!pool)return reply.code(201).send(add('clinical-notes',{kind:'observation',...body,recordedAt:now()},req));
  const r=await pool.query(`INSERT INTO observations(patient_id,encounter_id,code,display,value_numeric,value_text,unit,performer_user_id) SELECT $1,$2,$3,$4,$5,$6,$7,$8 WHERE EXISTS(SELECT 1 FROM patients WHERE id=$1 AND organization_id=$9) RETURNING id,patient_id AS "patientId",encounter_id AS "encounterId",code,display,value_numeric AS "valueNumeric",value_text AS "valueText",unit,observed_at AS "observedAt"`,[body.patientId,body.encounterId||null,body.code,body.display||null,body.valueNumeric??null,body.valueText??null,body.unit||null,dbUserId(req),dbOrganizationId(req)]);
  if(!r.rowCount)return reply.code(404).send({error:'Patient not found'});return reply.code(201).send(r.rows[0]);
});
app.post('/api/clinical/notes/:encounterId/sign',async(req:any,reply)=>{
  if(pool){
    const client=await pool.connect();
    try{ await client.query('BEGIN');
      const n=await client.query(`SELECT cn.id,cn.encounter_id AS "encounterId",e.patient_id AS "patientId",cn.signed_at AS "signedAt" FROM clinical_notes cn JOIN encounters e ON e.id=cn.encounter_id WHERE cn.encounter_id=$1 AND e.organization_id=$2 ORDER BY cn.version DESC LIMIT 1`,[req.params.encounterId,dbOrganizationId(req)]);
      if(!n.rowCount){await client.query('ROLLBACK');return reply.code(404).send({error:'Clinical note not found'});}
      if(n.rows[0].signedAt){await client.query('ROLLBACK');return reply.code(409).send({error:'Clinical note is already signed'});}
      const r=await client.query(`UPDATE clinical_notes SET signed_by=$1,signed_at=now() WHERE id=$2 RETURNING id,encounter_id AS "encounterId",note_type AS "noteType",subjective,objective,assessment,plan,signed_by AS "signedBy",signed_at AS "signedAt",version`,[dbUserId(req),n.rows[0].id]);
      await dbAudit(client,req,'SIGN','clinical_note',n.rows[0].id,{encounterId:req.params.encounterId}); await client.query('COMMIT'); return r.rows[0];
    }catch(e){await client.query('ROLLBACK');throw e}finally{client.release()}
  }
  const note=store['clinical-notes'].find(x=>x.encounterId===req.params.encounterId && x.organizationId===org(req));
  if(!note) return reply.code(404).send({error:'Clinical note not found'});
  if(note.signedAt) return reply.code(409).send({error:'Clinical note is already signed'});
  const updated=patch('clinical-notes',note.id,{signedAt:now(),signedBy:actor(req),status:'signed'},req);
  audit.push({id:randomUUID(),action:'CLINICAL_NOTE_SIGNED',resourceId:note.id,patientId:note.patientId,actorId:actor(req),at:now()}); persist(); return updated;
});
app.post('/api/appointments/:id/check-in',async(req:any,reply)=>{
  if(pool){
    const client=await pool.connect();
    try{await client.query('BEGIN');
      const a=await client.query(`UPDATE appointments SET status='arrived' WHERE id=$1 AND organization_id=$2 RETURNING id,patient_id AS "patientId",facility_id AS "facilityId",status,start_at AS "startAt"`,[req.params.id,dbOrganizationId(req)]);
      if(!a.rowCount){await client.query('ROLLBACK');return reply.code(404).send({error:'Appointment not found'});}
      const q0=await client.query(`SELECT id FROM queues WHERE organization_id=$1 AND code='OUTPATIENT' LIMIT 1`,[dbOrganizationId(req)]);
      let qid=q0.rows[0]?.id;
      if(!qid){const q=await client.query(`INSERT INTO queues(organization_id,facility_id,code,name) VALUES($1,$2,'OUTPATIENT','Outpatient Queue') RETURNING id`,[dbOrganizationId(req),a.rows[0].facilityId||null]);qid=q.rows[0].id;}
      const q=await client.query(`INSERT INTO queue_entries(queue_id,patient_id,appointment_id,priority,status) VALUES($1,$2,$3,'normal','waiting-triage') RETURNING id,patient_id AS "patientId",appointment_id AS "appointmentId",priority,status,joined_at AS "joinedAt"`,[qid,a.rows[0].patientId,a.rows[0].id]);
      const reg=await client.query(`INSERT INTO module_records(organization_id,module,status,payload,created_by) VALUES($1,'registration','checked-in',$2,$3) RETURNING id`,[dbOrganizationId(req),JSON.stringify({patientId:a.rows[0].patientId,appointmentId:a.rows[0].id,status:'checked-in',checkedInAt:now()}),dbUserId(req)]);
      await dbAudit(client,req,'CHECK_IN','appointment',a.rows[0].id,{queueEntryId:q.rows[0].id,registrationId:reg.rows[0].id}); await client.query('COMMIT'); return {appointment:a.rows[0],queue:q.rows[0],registrationId:reg.rows[0].id};
    }catch(e){await client.query('ROLLBACK');throw e}finally{client.release()}
  }
  const a=store.appointments.find(x=>x.id===req.params.id && x.organizationId===org(req)); if(!a)return reply.code(404).send({error:'Appointment not found'}); patch('appointments',a.id,{status:'arrived',arrivedAt:now()},req); const q=add('queue',{patientId:a.patientId,appointmentId:a.id,facilityId:a.facilityId,status:'waiting-triage',priority:'normal'},req); add('registration',{patientId:a.patientId,appointmentId:a.id,status:'checked-in',checkedInAt:now()},req); return {appointment:a,queue:q};
});
app.post('/api/laboratory/:id/verify',async(req:any,reply)=>{
  if(pool){const client=await pool.connect();try{await client.query('BEGIN');const r=await client.query(`UPDATE module_records SET status='verified',payload=payload || $1::jsonb,updated_at=now() WHERE id=$2 AND organization_id=$3 AND module='laboratory' RETURNING id,payload,status`,[JSON.stringify({verifiedAt:now(),critical:Boolean(req.body?.critical),abnormalFlag:req.body?.abnormalFlag||null,verifiedBy:dbUserId(req)}),req.params.id,dbOrganizationId(req)]);if(!r.rowCount){await client.query('ROLLBACK');return reply.code(404).send({error:'Lab record not found'});}const x=r.rows[0];const p=x.payload as any;await client.query(`INSERT INTO module_records(organization_id,module,status,payload,created_by) VALUES($1,'tasks','open',$2,$3)`,[dbOrganizationId(req),JSON.stringify({patientId:p.patientId,type:p.critical?'critical-result-review':'result-review',status:'open',priority:p.critical?'critical':'normal',referenceId:x.id}),dbUserId(req)]);await client.query(`INSERT INTO notifications(organization_id,patient_id,channel,template,status,payload) VALUES($1,$2,'in-app',$3,'queued',$4)`,[dbOrganizationId(req),p.patientId,p.critical?'critical-lab':'result-ready',JSON.stringify({laboratoryId:x.id})]);await dbAudit(client,req,'VERIFY','laboratory',x.id,{critical:Boolean(p.critical)}); await enqueueClinicalEvent(client,{organizationId:dbOrganizationId(req),eventType:CLINICAL_EVENT_TYPES.RESULT_VERIFIED,aggregateType:'laboratory',aggregateId:x.id,patientId:p.patientId,payload:{laboratoryId:x.id,patientId:p.patientId,critical:Boolean(p.critical),abnormalFlag:p.abnormalFlag||null}}); await client.query('COMMIT');return {id:x.id,...p,status:'verified'};}catch(e){await client.query('ROLLBACK');throw e}finally{client.release()}}
  const x=patch('laboratory',req.params.id,{status:'verified',verifiedAt:now(),verifiedBy:actor(req),critical:Boolean(req.body?.critical),abnormalFlag:req.body?.abnormalFlag||null},req);if(!x)throw Object.assign(new Error('Lab record not found'),{statusCode:404});add('notifications',{patientId:x.patientId,channel:'in-app',template:x.critical?'critical-lab':'result-ready',status:'queued',payload:{laboratoryId:x.id}},req);add('tasks',{patientId:x.patientId,type:x.critical?'critical-result-review':'result-review',status:'open',priority:x.critical?'critical':'normal',referenceId:x.id},req);return x;
});
app.post('/api/laboratory/:id/release',async(req:any,reply)=>{
  if(pool){const client=await pool.connect();try{await client.query('BEGIN');const r=await client.query(`SELECT id,payload,status FROM module_records WHERE id=$1 AND organization_id=$2 AND module='laboratory' FOR UPDATE`,[req.params.id,dbOrganizationId(req)]);if(!r.rowCount){await client.query('ROLLBACK');return reply.code(404).send({error:'Lab record not found'});}if(r.rows[0].status!=='verified'){await client.query('ROLLBACK');return reply.code(409).send({error:'Result must be verified before release'});}const p=r.rows[0].payload as any;const u=await client.query(`UPDATE module_records SET status='released',payload=payload || $1::jsonb,updated_at=now() WHERE id=$2 RETURNING id,payload,status,updated_at AS "updatedAt"`,[JSON.stringify({releasedAt:now(),releasedBy:dbUserId(req)}),req.params.id]);await client.query(`INSERT INTO notifications(organization_id,patient_id,channel,template,status,payload) VALUES($1,$2,'in-app','result-ready','queued',$3)`,[dbOrganizationId(req),p.patientId,JSON.stringify({laboratoryId:req.params.id})]);await dbAudit(client,req,'RELEASE','laboratory',req.params.id,{});await client.query('COMMIT');return {id:u.rows[0].id,...u.rows[0].payload,status:u.rows[0].status,updatedAt:u.rows[0].updatedAt};}catch(e){await client.query('ROLLBACK');throw e}finally{client.release()}}
  const x=store.laboratory.find(v=>v.id===req.params.id && v.organizationId===org(req));if(!x)return reply.code(404).send({error:'Lab record not found'});if(x.status!=='verified')return reply.code(409).send({error:'Result must be verified before release'});const released=patch('laboratory',x.id,{status:'released',releasedAt:now(),releasedBy:actor(req)},req);add('notifications',{patientId:x.patientId,channel:'in-app',template:'result-ready',status:'queued',payload:{laboratoryId:x.id}},req);return released;
});
app.post('/api/tasks/:id/complete',async(req:any,reply)=>{
  if(pool){const r=await pool.query(`UPDATE module_records SET status='completed',payload=payload || $1::jsonb,updated_at=now() WHERE id=$2 AND organization_id=$3 AND module='tasks' RETURNING id,payload,status,updated_at AS "updatedAt"`,[JSON.stringify({completedAt:now(),completedBy:dbUserId(req),resolution:req.body?.resolution||null}),req.params.id,dbOrganizationId(req)]);if(!r.rowCount)return reply.code(404).send({error:'Task not found'});await pool.query('INSERT INTO audit_logs(organization_id,actor_user_id,action,entity_type,entity_id,metadata) VALUES($1,$2,$3,$4,$5,$6)',[dbOrganizationId(req),dbUserId(req),'COMPLETE','task',r.rows[0].id,JSON.stringify({})]);return {id:r.rows[0].id,...r.rows[0].payload,status:r.rows[0].status,updatedAt:r.rows[0].updatedAt};}
  const x=store.tasks.find(v=>v.id===req.params.id && v.organizationId===org(req));if(!x)return reply.code(404).send({error:'Task not found'});return patch('tasks',x.id,{status:'completed',completedAt:now(),completedBy:actor(req),resolution:req.body?.resolution||null},req);
});


app.post('/api/laboratory/:sampleId/result',async(req:any,reply)=>{
  const b=z.object({testCode:z.string().optional(),testName:z.string().default('Lab Test'),valueNumeric:z.number().optional(),valueText:z.string().optional(),unit:z.string().optional(),abnormalFlag:z.string().optional(),critical:z.boolean().default(false)}).parse(req.body||{});
  if(!pool)return reply.code(201).send(add('laboratory',{sampleId:req.params.sampleId,...b,status:'preliminary'},req));
  const client=await pool.connect();try{await client.query('BEGIN');const s=await client.query(`SELECT ls.id,co.patient_id AS "patientId" FROM lab_samples ls JOIN clinical_orders co ON co.id=ls.order_id JOIN patients p ON p.id=co.patient_id WHERE ls.id=$1 AND p.organization_id=$2 FOR UPDATE`,[req.params.sampleId,dbOrganizationId(req)]);if(!s.rowCount){await client.query('ROLLBACK');return reply.code(404).send({error:'Lab sample not found'});}let t=await client.query(`SELECT id FROM lab_tests WHERE organization_id=$1 AND (code=$2 OR lower(name)=lower($3)) LIMIT 1`,[dbOrganizationId(req),b.testCode||null,b.testName]);if(!t.rowCount)t=await client.query(`INSERT INTO lab_tests(organization_id,code,name,unit) VALUES($1,$2,$3,$4) RETURNING id`,[dbOrganizationId(req),b.testCode||null,b.testName,b.unit||null]);const r=await client.query(`INSERT INTO lab_results(sample_id,test_id,value_numeric,value_text,unit,abnormal_flag,critical,status,verified_by,verified_at) VALUES($1,$2,$3,$4,$5,$6,$7,'preliminary',NULL,NULL) RETURNING id,sample_id AS "sampleId",value_numeric AS "valueNumeric",value_text AS "valueText",unit,abnormal_flag AS "abnormalFlag",critical,status,verified_at AS "verifiedAt"`,[req.params.sampleId,t.rows[0].id,b.valueNumeric??null,b.valueText??null,b.unit||null,b.abnormalFlag||null,b.critical,dbUserId(req)]);await client.query(`UPDATE lab_samples SET status='processed',processed_at=now() WHERE id=$1`,[req.params.sampleId]);await dbAudit(client,req,'CREATE','lab_result',r.rows[0].id,{patientId:s.rows[0].patientId});await client.query('COMMIT');return reply.code(201).send({...r.rows[0],patientId:s.rows[0].patientId});}catch(e){await client.query('ROLLBACK');throw e}finally{client.release()}
});

app.get('/api/patients/:id/care-summary',async(req:any,reply)=>{
  const id=req.params.id; if(!pool){const p=store.patients.find(x=>x.id===id&&x.organizationId===org(req));if(!p)return reply.code(404).send({error:'Patient not found'});return {patient:p,activeProblems:store.diagnoses.filter(x=>x.patientId===id),medications:store.pharmacy.filter(x=>x.patientId===id&&x.status!=='discontinued'),openTasks:store.tasks.filter(x=>x.patientId===id&&x.status!=='completed')};}
  const p=await pool.query(`SELECT id,patient_number AS "patientNumber",first_name AS "firstName",last_name AS "lastName",date_of_birth AS "dateOfBirth",sex,phone,email,status FROM patients WHERE id=$1 AND organization_id=$2`,[id,dbOrganizationId(req)]);if(!p.rowCount)return reply.code(404).send({error:'Patient not found'});
  const [dx,med,tasks,alerts]=await Promise.all([
    pool.query(`SELECT id,code,display,diagnosis_type AS "diagnosisType",status FROM diagnoses WHERE patient_id=$1 AND status <> 'resolved' ORDER BY id DESC LIMIT 50`,[id]),
    pool.query(`SELECT mo.id,mo.dose,mo.frequency,mo.route,mo.duration,mo.quantity,mo.status,m.code AS "medicationCode",m.name AS "medicationName" FROM medication_orders mo JOIN medications m ON m.id=mo.medication_id WHERE mo.patient_id=$1 AND mo.status NOT IN ('discontinued','completed') ORDER BY mo.id DESC LIMIT 50`,[id]),
    pool.query(`SELECT id,status,payload,created_at AS "createdAt" FROM module_records WHERE organization_id=$1 AND module='tasks' AND payload->>'patientId'=$2 AND status <> 'completed' ORDER BY created_at DESC LIMIT 50`,[dbOrganizationId(req),id]),
    pool.query(`SELECT id,channel,template,status,payload,created_at AS "createdAt" FROM notifications WHERE organization_id=$1 AND patient_id=$2 AND status NOT IN ('sent','resolved') ORDER BY created_at DESC LIMIT 50`,[dbOrganizationId(req),id])
  ]);return {patient:p.rows[0],activeProblems:dx.rows,medications:med.rows,openTasks:tasks.rows,alerts:alerts.rows};
});





// --- Governance, care-gap, communication and intelligence layer ---
const governanceRecord=z.object({name:z.string().min(1),version:z.string().default('1.0'),status:z.enum(['draft','active','retired']).default('draft'),definition:z.record(z.any()).default({})});
const messageRecord=z.object({patientId:z.string().uuid().optional(),recipientUserId:z.string().uuid().optional(),channel:z.enum(['in-app','sms','email','whatsapp','push']).default('in-app'),subject:z.string().optional(),body:z.string().min(1),consentConfirmed:z.boolean().default(false)});
const gapRecord=z.object({patientId:z.string().uuid(),type:z.string().min(1),priority:z.enum(['low','normal','high','critical']).default('normal'),dueAt:z.string().optional(),description:z.string().optional(),status:z.enum(['open','in-progress','resolved','dismissed']).default('open')});
const alertRecord=z.object({patientId:z.string().uuid(),encounterId:z.string().uuid().optional(),type:z.string().min(1),severity:z.enum(['INFO','NOTICE','WARNING','CRITICAL']),title:z.string().min(1),message:z.string().min(1),source:z.string().default('rule-engine')});
async function moduleCreate(req:any,module:string,payload:any,status='active'){
  if(!pool) return add(module as Mod,{...payload,status},req);
  const r=await pool.query(`INSERT INTO module_records(organization_id,module,status,payload,created_by) VALUES($1,$2,$3,$4,$5) RETURNING id,module,status,payload,created_at AS "createdAt",updated_at AS "updatedAt"`,[dbOrganizationId(req),module,status,JSON.stringify(payload),dbUserId(req)]);
  await pool.query(`INSERT INTO audit_logs(organization_id,actor_user_id,action,entity_type,entity_id,metadata) VALUES($1,$2,'CREATE',$3,$4,$5)`,[dbOrganizationId(req),dbUserId(req),module,r.rows[0].id,JSON.stringify({status})]);
  return {id:r.rows[0].id,...r.rows[0].payload,status:r.rows[0].status,createdAt:r.rows[0].createdAt,updatedAt:r.rows[0].updatedAt};
}
app.post('/api/governance/:kind',async(req:any,reply)=>{
  const allowed=['forms','order-sets','protocols','workflow-rules','terminology']; if(!allowed.includes(req.params.kind)) return reply.code(404).send({error:'Governance resource not supported'});
  const b=governanceRecord.parse(req.body||{}); return reply.code(201).send(await moduleCreate(req,`governance-${req.params.kind}`,b,b.status));
});
app.get('/api/governance/:kind',async(req:any,reply)=>{
  const allowed=['forms','order-sets','protocols','workflow-rules','terminology']; if(!allowed.includes(req.params.kind)) return reply.code(404).send({error:'Governance resource not supported'});
  const module=`governance-${req.params.kind}`; if(!pool)return {data:store[module]||[],count:(store[module]||[]).length};
  const r=await pool.query(`SELECT id,status,payload,created_at AS "createdAt",updated_at AS "updatedAt" FROM module_records WHERE organization_id=$1 AND module=$2 AND COALESCE(payload->>'coverageVersion','') <> '025' AND COALESCE(payload->>'recordPurpose','') <> 'connected synthetic testing' ORDER BY created_at DESC LIMIT 500`,[dbOrganizationId(req),module]); return {data:r.rows.map((x:any)=>({id:x.id,...x.payload,status:x.status,createdAt:x.createdAt,updatedAt:x.updatedAt})),count:r.rowCount};
});
app.post('/api/care-gaps',async(req:any,reply)=>{const b=gapRecord.parse(req.body||{}); return reply.code(201).send(await moduleCreate(req,'care-gaps',b,b.status));});
app.get('/api/care-gaps',async(req:any)=>{if(!pool)return {data:store['care-gaps']||[],count:(store['care-gaps']||[]).length};const r=await pool.query(`SELECT id,status,payload,created_at AS "createdAt",updated_at AS "updatedAt" FROM module_records WHERE organization_id=$1 AND module='care-gaps' AND COALESCE(payload->>'coverageVersion','') <> '025' AND COALESCE(payload->>'recordPurpose','') <> 'connected synthetic testing' ORDER BY created_at DESC LIMIT 500`,[dbOrganizationId(req)]);return {data:r.rows.map((x:any)=>({id:x.id,...x.payload,status:x.status,createdAt:x.createdAt,updatedAt:x.updatedAt})),count:r.rowCount};});
app.post('/api/alerts',async(req:any,reply)=>{const b=alertRecord.parse(req.body||{}); const x=await moduleCreate(req,'clinical-alerts',b,b.severity==='CRITICAL'?'critical':'open'); if(pool) await pool.query(`INSERT INTO notifications(organization_id,patient_id,channel,template,status,payload) VALUES($1,$2,'in-app','clinical-alert','queued',$3)`,[dbOrganizationId(req),b.patientId,JSON.stringify({alertId:x.id,severity:b.severity,title:b.title})]); return reply.code(201).send(x);});
app.get('/api/alerts',async(req:any)=>{if(!pool)return {data:store['clinical-alerts']||[],count:(store['clinical-alerts']||[]).length};const r=await pool.query(`SELECT id,status,payload,created_at AS "createdAt" FROM module_records WHERE organization_id=$1 AND module='clinical-alerts' AND COALESCE(payload->>'coverageVersion','') <> '025' AND COALESCE(payload->>'recordPurpose','') <> 'connected synthetic testing' ORDER BY created_at DESC LIMIT 500`,[dbOrganizationId(req)]);return {data:r.rows.map((x:any)=>({id:x.id,...x.payload,status:x.status,createdAt:x.createdAt})),count:r.rowCount};});
app.post('/api/messages',async(req:any,reply)=>{const b=messageRecord.parse(req.body||{});if(b.patientId&&!b.consentConfirmed&&['sms','email','whatsapp','push'].includes(b.channel))return reply.code(409).send({error:'Patient communication consent must be confirmed before external delivery'});return reply.code(201).send(await moduleCreate(req,'messages',b,'queued'));});
app.get('/api/messages',async(req:any)=>{if(!pool)return {data:store.messages||[],count:(store.messages||[]).length};const r=await pool.query(`SELECT id,status,payload,created_at AS "createdAt" FROM module_records WHERE organization_id=$1 AND module='messages' AND COALESCE(payload->>'coverageVersion','') <> '025' AND COALESCE(payload->>'recordPurpose','') <> 'connected synthetic testing' ORDER BY created_at DESC LIMIT 500`,[dbOrganizationId(req)]);return {data:r.rows.map((x:any)=>({id:x.id,...x.payload,status:x.status,createdAt:x.createdAt})),count:r.rowCount};});
app.get('/api/analytics/operations',async(req:any,reply)=>{
  if(!pool) return {patients:store.patients.length,appointments:store.appointments.length,openTasks:(store.tasks||[]).filter((x:any)=>x.status!=='completed').length,careGaps:(store['care-gaps']||[]).filter((x:any)=>x.status!=='resolved').length};
  const oid=dbOrganizationId(req);
  const [patients,appointments,waiting,encounters,labs,openTasks,gaps,beds,unpaid]=await Promise.all([
    pool.query('SELECT count(*)::int n FROM patients WHERE organization_id=$1',[oid]),
    pool.query('SELECT count(*)::int n FROM appointments WHERE organization_id=$1',[oid]),
    pool.query("SELECT count(*)::int n FROM queue_entries qe JOIN queues q ON q.id=qe.queue_id WHERE q.organization_id=$1 AND qe.status NOT IN ('completed','cancelled','no-show')",[oid]),
    pool.query('SELECT count(*)::int n FROM encounters WHERE organization_id=$1',[oid]),
    pool.query('SELECT count(*)::int n FROM lab_results lr JOIN lab_samples ls ON ls.id=lr.sample_id JOIN clinical_orders co ON co.id=ls.order_id JOIN patients p ON p.id=co.patient_id WHERE p.organization_id=$1',[oid]),
    pool.query("SELECT count(*)::int n FROM module_records WHERE organization_id=$1 AND module='tasks' AND COALESCE(payload->>'coverageVersion','') <> '025' AND COALESCE(payload->>'recordPurpose','') <> 'connected synthetic testing' AND status NOT IN ('completed','cancelled')",[oid]),
    pool.query("SELECT count(*)::int n FROM module_records WHERE organization_id=$1 AND module='care-gaps' AND COALESCE(payload->>'coverageVersion','') <> '025' AND COALESCE(payload->>'recordPurpose','') <> 'connected synthetic testing' AND status NOT IN ('resolved','dismissed')",[oid]),
    pool.query("SELECT count(*)::int n FROM module_records WHERE organization_id=$1 AND module='beds' AND COALESCE(payload->>'coverageVersion','') <> '025' AND COALESCE(payload->>'recordPurpose','') <> 'connected synthetic testing' AND status='occupied'",[oid]),
    pool.query("SELECT count(*)::int n FROM invoices WHERE organization_id=$1 AND status <> 'paid'",[oid])
  ]);
  return {patients:patients.rows[0].n,appointments:appointments.rows[0].n,waiting:waiting.rows[0].n,encounters:encounters.rows[0].n,labResults:labs.rows[0].n,openTasks:openTasks.rows[0].n,careGaps:gaps.rows[0].n,occupiedBeds:beds.rows[0].n,unpaidInvoices:unpaid.rows[0].n};
});
app.post('/api/cds/evaluate',async(req:any,reply)=>{
  const b=z.object({patientId:z.string().uuid(),encounterId:z.string().uuid().optional(),facts:z.record(z.any()).default({})}).parse(req.body||{});
  const alerts:any[]=[];
  const f=b.facts;
  if(typeof f.spo2==='number'&&f.spo2<90) alerts.push({type:'abnormal-vital',severity:'CRITICAL',title:'Low oxygen saturation',message:'Oxygen saturation is below the configured review threshold.'});
  if(typeof f.systolic==='number'&&f.systolic>=180) alerts.push({type:'abnormal-vital',severity:'CRITICAL',title:'Severely elevated blood pressure',message:'Systolic blood pressure is at or above the configured review threshold.'});
  if(typeof f.temperature==='number'&&f.temperature>=39) alerts.push({type:'abnormal-vital',severity:'WARNING',title:'Elevated temperature',message:'Temperature is elevated and requires clinical review.'});
  const saved:any[]=[]; for(const a of alerts) saved.push(await moduleCreate(req,'clinical-alerts',{...a,patientId:b.patientId,encounterId:b.encounterId,source:'deterministic-cds'},a.severity==='CRITICAL'?'critical':'open'));
  return {patientId:b.patientId,alerts:saved,requiresClinicianReview:saved.length>0};
});
app.post('/api/care-gaps/:id/resolve',async(req:any,reply)=>{if(!pool){const x=patch('care-gaps',req.params.id,{status:'resolved',resolvedAt:now(),resolution:req.body?.resolution||null},req);if(!x)return reply.code(404).send({error:'Care gap not found'});return x;}const r=await pool.query(`UPDATE module_records SET status='resolved',payload=payload || $1::jsonb,updated_at=now() WHERE id=$2 AND organization_id=$3 AND module='care-gaps' RETURNING id,status,payload,updated_at AS "updatedAt"`,[JSON.stringify({resolvedAt:now(),resolution:req.body?.resolution||null,resolvedBy:dbUserId(req)}),req.params.id,dbOrganizationId(req)]);if(!r.rowCount)return reply.code(404).send({error:'Care gap not found'});await pool.query(`INSERT INTO audit_logs(organization_id,actor_user_id,action,entity_type,entity_id,metadata) VALUES($1,$2,'RESOLVE','care_gap',$3,$4)`,[dbOrganizationId(req),dbUserId(req),r.rows[0].id,JSON.stringify({})]);return {id:r.rows[0].id,...r.rows[0].payload,status:r.rows[0].status,updatedAt:r.rows[0].updatedAt};});


// --- V9 Uganda child health, growth, IMCI and immunization continuity ---
app.get('/api/child-health/:patientId', async(req:any)=>{
  if(!pool)return {data:{visits:[],growth:[],imci:[],immunizationReviews:[]}};
  const o=dbOrganizationId(req), p=req.params.patientId;
  const [v,g,i,r]=await Promise.all([
    pool.query(`SELECT * FROM child_health_visits WHERE organization_id=$1 AND patient_id=$2 ORDER BY visit_date DESC LIMIT 200`,[o,p]),
    pool.query(`SELECT * FROM child_growth_measurements WHERE organization_id=$1 AND patient_id=$2 ORDER BY measured_at DESC LIMIT 200`,[o,p]),
    pool.query(`SELECT * FROM child_imci_assessments WHERE organization_id=$1 AND patient_id=$2 ORDER BY assessed_at DESC LIMIT 100`,[o,p]),
    pool.query(`SELECT * FROM immunization_reviews WHERE organization_id=$1 AND patient_id=$2 ORDER BY reviewed_at DESC LIMIT 50`,[o,p])
  ]);
  return {data:{visits:v.rows,growth:g.rows,imci:i.rows,immunizationReviews:r.rows}};
});

app.post('/api/child-health/visits', async(req:any,reply)=>{
  if(!pool)return reply.code(501).send({error:'PostgreSQL required'});
  const b=z.object({patientId:z.string().uuid(),encounterId:z.string().uuid().optional(),visitDate:z.string().optional(),ageDays:z.number().int().nonnegative().optional(),ageMonths:z.number().nonnegative().optional(),weightKg:z.number().nonnegative().optional(),lengthHeightCm:z.number().nonnegative().optional(),headCircumferenceCm:z.number().nonnegative().optional(),muacMm:z.number().nonnegative().optional(),temperatureC:z.number().optional(),respiratoryRate:z.number().nonnegative().optional(),spo2:z.number().min(0).max(100).optional(),feedingAssessment:z.record(z.any()).optional(),developmentalAssessment:z.record(z.any()).optional(),dangerSigns:z.record(z.any()).optional(),clinicalAssessment:z.record(z.any()).optional(),plan:z.record(z.any()).optional(),referralRequired:z.boolean().default(false),sourceGuideline:z.string().default('UG-MOH-IMNCI-2020')}).parse(req.body||{});
  const r=await pool.query(`INSERT INTO child_health_visits(organization_id,patient_id,encounter_id,visit_date,age_days,age_months,weight_kg,length_height_cm,head_circumference_cm,muac_mm,temperature_c,respiratory_rate,spo2,feeding_assessment,developmental_assessment,danger_signs,clinical_assessment,plan,referral_required,source_guideline,created_by) VALUES($1,$2,$3,COALESCE($4,now()),$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21) RETURNING *`,[dbOrganizationId(req),b.patientId,b.encounterId||null,b.visitDate||null,b.ageDays??null,b.ageMonths??null,b.weightKg??null,b.lengthHeightCm??null,b.headCircumferenceCm??null,b.muacMm??null,b.temperatureC??null,b.respiratoryRate??null,b.spo2??null,JSON.stringify(b.feedingAssessment||{}),JSON.stringify(b.developmentalAssessment||{}),JSON.stringify(b.dangerSigns||{}),JSON.stringify(b.clinicalAssessment||{}),JSON.stringify(b.plan||{}),b.referralRequired,b.sourceGuideline,dbUserId(req)]);
  return reply.code(201).send(r.rows[0]);
});

app.post('/api/child-health/growth', async(req:any,reply)=>{
  if(!pool)return reply.code(501).send({error:'PostgreSQL required'});
  const b=z.object({patientId:z.string().uuid(),measuredAt:z.string().optional(),ageDays:z.number().int().nonnegative().optional(),weightKg:z.number().nonnegative().optional(),lengthHeightCm:z.number().nonnegative().optional(),headCircumferenceCm:z.number().nonnegative().optional(),muacMm:z.number().nonnegative().optional(),zScores:z.record(z.any()).optional(),growthInterpretation:z.string().optional(),sourceStandard:z.string().default('WHO-GROWTH-STANDARDS')}).parse(req.body||{});
  const r=await pool.query(`INSERT INTO child_growth_measurements(organization_id,patient_id,measured_at,age_days,weight_kg,length_height_cm,head_circumference_cm,muac_mm,z_scores,growth_interpretation,source_standard,created_by) VALUES($1,$2,COALESCE($3,now()),$4,$5,$6,$7,$8,$9,$10,$11,$12) RETURNING *`,[dbOrganizationId(req),b.patientId,b.measuredAt||null,b.ageDays??null,b.weightKg??null,b.lengthHeightCm??null,b.headCircumferenceCm??null,b.muacMm??null,JSON.stringify(b.zScores||{}),b.growthInterpretation||null,b.sourceStandard,dbUserId(req)]);
  return reply.code(201).send(r.rows[0]);
});

app.post('/api/child-health/imci', async(req:any,reply)=>{
  if(!pool)return reply.code(501).send({error:'PostgreSQL required'});
  const b=z.object({patientId:z.string().uuid(),encounterId:z.string().uuid().optional(),assessedAt:z.string().optional(),ageMonths:z.number().nonnegative().optional(),generalDangerSigns:z.record(z.any()).optional(),coughBreathing:z.record(z.any()).optional(),diarrhoea:z.record(z.any()).optional(),fever:z.record(z.any()).optional(),earProblem:z.record(z.any()).optional(),nutritionAnemia:z.record(z.any()).optional(),immunizationStatus:z.record(z.any()).optional(),feedingStatus:z.record(z.any()).optional(),classifications:z.record(z.any()).optional(),plan:z.record(z.any()).optional(),referralRequired:z.boolean().default(false),sourceGuideline:z.string().default('UG-MOH-IMNCI-2020')}).parse(req.body||{});
  const r=await pool.query(`INSERT INTO child_imci_assessments(organization_id,patient_id,encounter_id,assessed_at,age_months,general_danger_signs,cough_breathing,diarrhoea,fever,ear_problem,nutrition_anemia,immunization_status,feeding_status,classifications,plan,referral_required,source_guideline,created_by) VALUES($1,$2,$3,COALESCE($4,now()),$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18) RETURNING *`,[dbOrganizationId(req),b.patientId,b.encounterId||null,b.assessedAt||null,b.ageMonths??null,JSON.stringify(b.generalDangerSigns||{}),JSON.stringify(b.coughBreathing||{}),JSON.stringify(b.diarrhoea||{}),JSON.stringify(b.fever||{}),JSON.stringify(b.earProblem||{}),JSON.stringify(b.nutritionAnemia||{}),JSON.stringify(b.immunizationStatus||{}),JSON.stringify(b.feedingStatus||{}),JSON.stringify(b.classifications||{}),JSON.stringify(b.plan||{}),b.referralRequired,b.sourceGuideline,dbUserId(req)]);
  return reply.code(201).send(r.rows[0]);
});

app.get('/api/immunization/due/:patientId', async(req:any,reply)=>{
  if(!pool)return {data:[],meta:{source:'UG-MOH-IMMUNIZATION-2025'}};
  const o=dbOrganizationId(req), p=req.params.patientId, jurisdiction=String(req.query?.jurisdiction||'UG');
  const patient=await pool.query(`SELECT id,date_of_birth AS "dateOfBirth" FROM patients WHERE id=$1 AND organization_id=$2`,[p,o]);
  if(!patient.rowCount)return reply.code(404).send({error:'Patient not found'});
  const dob=patient.rows[0].dateOfBirth;
  const rules=await pool.query(`SELECT id,vaccine_code AS "vaccineCode",vaccine_name AS "vaccineName",dose_label AS "doseLabel",minimum_age_days AS "minimumAgeDays",recommended_age_days AS "recommendedAgeDays",interval_from_previous_days AS "intervalFromPreviousDays",eligibility,status,effective_from AS "effectiveFrom",effective_to AS "effectiveTo",source_guideline AS "sourceGuideline" FROM immunization_schedule_rules WHERE (organization_id=$1 OR organization_id IS NULL) AND jurisdiction=$2 AND status='active' ORDER BY recommended_age_days NULLS LAST,vaccine_code,dose_label`,[o,jurisdiction]);
  const given=await pool.query(`SELECT vaccine_code AS "vaccineCode",vaccine_name AS "vaccineName",dose_number AS "doseNumber",administered_at AS "administeredAt" FROM immunizations WHERE organization_id=$1 AND patient_id=$2 ORDER BY administered_at DESC`,[o,p]);
  const ageDays=Math.max(0,Math.floor((Date.now()-new Date(dob).getTime())/86400000));
  const completed=new Set(given.rows.map((x:any)=>`${x.vaccineCode}|${x.doseNumber||''}`));
  const items=rules.rows.map((r:any)=>{const key=`${r.vaccineCode}|${r.doseLabel}`;const recommended=r.recommendedAgeDays==null?null:Number(r.recommendedAgeDays);const minimum=r.minimumAgeDays==null?0:Number(r.minimumAgeDays);const eligible=ageDays>=minimum;const completedFlag=completed.has(key);const overdue=eligible && recommended!=null && ageDays>recommended && !completedFlag;return {...r,eligible,completed:completedFlag,overdue,ageDays};});
  return {data:items,meta:{patientId:p,jurisdiction,ageDays,source:'UG-MOH-IMMUNIZATION-2025',whoReference:'WHO-SMART-DAK-IMMZ-1.1.0'}};
});

app.post('/api/immunization/reviews', async(req:any,reply)=>{
  if(!pool)return reply.code(501).send({error:'PostgreSQL required'});
  const b=z.object({patientId:z.string().uuid(),jurisdiction:z.string().default('UG'),dueItems:z.array(z.any()).default([]),overdueItems:z.array(z.any()).default([]),completedItems:z.array(z.any()).default([]),nextReviewAt:z.string().optional(),sourceGuideline:z.string().default('UG-MOH-IMMUNIZATION-2025')}).parse(req.body||{});
  const r=await pool.query(`INSERT INTO immunization_reviews(organization_id,patient_id,jurisdiction,due_items,overdue_items,completed_items,next_review_at,source_guideline,created_by) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING *`,[dbOrganizationId(req),b.patientId,b.jurisdiction,JSON.stringify(b.dueItems),JSON.stringify(b.overdueItems),JSON.stringify(b.completedItems),b.nextReviewAt||null,b.sourceGuideline,dbUserId(req)]);
  return reply.code(201).send(r.rows[0]);
});

// --- V8 Uganda maternal, newborn and postnatal workflows ---
app.get('/api/clinical-content/sources', async()=>({data:[
 {code:'UG-MOH-ANC-2025',title:'Antenatal Care Service Edited Version',jurisdiction:'UG',sourceType:'national_guideline',published:'2025-06-25',lastVerified:'2026-09-12',sourceUrl:'https://library.health.go.ug/sexual-and-reproductive-health/maternal-health/antenatal-care-service-edited-version'},
 {code:'WHO-ANC-DAK-2021',title:'Digital Adaptation Kit for Antenatal Care',jurisdiction:'GLOBAL',sourceType:'smart_dak',published:'2021-02-17',lastVerified:'2026-09-12',sourceUrl:'https://www.who.int/publications/who-guidelines/9789240020306'},
 {code:'WHO-PNC-DAK-2025',title:'Digital Adaptation Kit for Postnatal Care',jurisdiction:'GLOBAL',sourceType:'smart_dak',published:'2025-07-06',lastVerified:'2026-09-12',sourceUrl:'https://www.who.int/publications/i/item/9789240090347'},
 {code:'UG-MOH-EMNCC-2022',title:'Essential Maternal and Neonatal Clinical Care Guidelines for Uganda',jurisdiction:'UG',sourceType:'national_guideline',published:'2022-08-01',lastVerified:'2026-09-12',sourceUrl:'https://library.health.go.ug/node/1588'},
 {code:'WHO-SMART-BASE-1.0.0',title:'WHO SMART Base',jurisdiction:'GLOBAL',sourceType:'smart_base',published:'2026-08-27',lastVerified:'2026-09-12',sourceUrl:'https://smart.who.int/base/1.0.0/index.html'},
 {code:'UG-MOH-IMMUNIZATION-2025',title:'Routine Immunization Schedule',jurisdiction:'UG',sourceType:'national_schedule',published:'2025-11-06',lastVerified:'2026-09-12',sourceUrl:'https://health.go.ug/download/routine-immunization-schedule/'},
 {code:'UG-MOH-IMMUNIZATION-2026',title:'Media Brief on Routine Immunization Services 2026',jurisdiction:'UG',sourceType:'national_brief',published:'2026-01-27',lastVerified:'2026-09-12',sourceUrl:'https://health.go.ug/download/media-brief-on-routine-immunization-services-2026/'},
 {code:'UG-MOH-IMNCI-2020',title:'Uganda National IMNCI Chart Booklet',jurisdiction:'UG',sourceType:'national_guideline',published:'2020-01-01',lastVerified:'2026-09-12',sourceUrl:'https://library.health.go.ug/sexual-and-reproductive-health/integrated-management-childhood-illnesses/uganda-national-imnci'},
 {code:'UG-CLINICAL-GUIDELINES-2023-CH17',title:'Uganda Clinical Guidelines 2023 Chapter 17: Childhood Illness',jurisdiction:'UG',sourceType:'national_guideline',published:'2023-01-01',lastVerified:'2026-09-12',sourceUrl:'https://library.health.go.ug/file-download/download/public/1698'},
 {code:'WHO-SMART-DAK-IMMZ-1.1.0',title:'SMART DAK Immunizations v1.1.0',jurisdiction:'GLOBAL',sourceType:'smart_dak',published:'2025-03-06',lastVerified:'2026-09-12',sourceUrl:'https://smart.who.int/dak-immz/'}
]}));

app.get('/api/maternal-care/:patientId', async(req:any)=>{ if(!pool)return {data:{}}; const patientId=req.params.patientId; const o=dbOrganizationId(req); const [m,c,b,n,p]=await Promise.all([
 pool.query(`SELECT * FROM maternal_care_records WHERE organization_id=$1 AND patient_id=$2 ORDER BY created_at DESC`,[o,patientId]),
 pool.query(`SELECT * FROM maternal_care_contacts WHERE organization_id=$1 AND patient_id=$2 ORDER BY contact_date DESC`,[o,patientId]),
 pool.query(`SELECT * FROM birth_events WHERE organization_id=$1 AND mother_patient_id=$2 ORDER BY birth_datetime DESC`,[o,patientId]),
 pool.query(`SELECT * FROM newborn_records WHERE organization_id=$1 AND mother_patient_id=$2 ORDER BY created_at DESC`,[o,patientId]),
 pool.query(`SELECT * FROM postnatal_contacts WHERE organization_id=$1 AND patient_id=$2 ORDER BY contact_date DESC`,[o,patientId])
 ]); return {data:{maternal:m.rows,contacts:c.rows,births:b.rows,newborns:n.rows,postnatal:p.rows}}; });

app.post('/api/maternal-care/records', async(req:any,reply)=>{ if(!pool)return reply.code(501).send({error:'PostgreSQL required'}); const b=z.object({patientId:z.string().uuid(),gravida:z.number().int().nonnegative().optional(),para:z.number().int().nonnegative().optional(),lmp:z.string().optional(),estimatedDueDate:z.string().optional(),gestationalAgeWeeks:z.number().optional(),riskStatus:z.string().default('not-assessed'),riskFactors:z.record(z.any()).optional(),birthPlan:z.record(z.any()).optional(),sourceGuideline:z.string().optional()}).parse(req.body); const r=await pool.query(`INSERT INTO maternal_care_records(organization_id,patient_id,gravida,para,lmp,estimated_due_date,gestational_age_weeks,risk_status,risk_factors,birth_plan,source_guideline) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) RETURNING *`,[dbOrganizationId(req),b.patientId,b.gravida??null,b.para??null,b.lmp??null,b.estimatedDueDate??null,b.gestationalAgeWeeks??null,b.riskStatus,JSON.stringify(b.riskFactors||{}),JSON.stringify(b.birthPlan||{}),b.sourceGuideline||'UG-MOH-ANC-2025']); return reply.code(201).send(r.rows[0]); });

app.post('/api/maternal-care/contacts', async(req:any,reply)=>{ if(!pool)return reply.code(501).send({error:'PostgreSQL required'}); const b=z.object({patientId:z.string().uuid(),maternalRecordId:z.string().uuid().optional(),contactNumber:z.number().int().positive(),contactDate:z.string(),gestationalAgeWeeks:z.number().optional(),bloodPressure:z.record(z.any()).optional(),symphysioFundalHeight:z.number().optional(),fetalAssessment:z.record(z.any()).optional(),laboratory:z.record(z.any()).optional(),preventiveCare:z.record(z.any()).optional(),counselling:z.record(z.any()).optional(),dangerSigns:z.record(z.any()).optional(),assessment:z.string().optional(),plan:z.string().optional(),referralRequired:z.boolean().default(false),sourceGuideline:z.string().default('UG-MOH-ANC-2025')}).parse(req.body); const r=await pool.query(`INSERT INTO maternal_care_contacts(organization_id,patient_id,maternal_record_id,contact_number,contact_date,gestational_age_weeks,blood_pressure,symphysio_fundal_height,fetal_assessment,laboratory,preventive_care,counselling,danger_signs,assessment,plan,referral_required,source_guideline) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17) RETURNING *`,[dbOrganizationId(req),b.patientId,b.maternalRecordId||null,b.contactNumber,b.contactDate,b.gestationalAgeWeeks??null,JSON.stringify(b.bloodPressure||{}),b.symphysioFundalHeight??null,JSON.stringify(b.fetalAssessment||{}),JSON.stringify(b.laboratory||{}),JSON.stringify(b.preventiveCare||{}),JSON.stringify(b.counselling||{}),JSON.stringify(b.dangerSigns||{}),b.assessment||null,b.plan||null,b.referralRequired,b.sourceGuideline]); return reply.code(201).send(r.rows[0]); });

app.post('/api/maternal-care/births', async(req:any,reply)=>{ if(!pool)return reply.code(501).send({error:'PostgreSQL required'}); const b=z.object({motherPatientId:z.string().uuid(),birthDatetime:z.string(),mode:z.string(),placeType:z.string().optional(),facilityId:z.string().uuid().optional(),gestationalAgeWeeks:z.number().optional(),multipleBirth:z.boolean().default(false),complications:z.record(z.any()).optional(),outcome:z.string().optional(),referral:z.record(z.any()).optional(),sourceGuideline:z.string().default('UG-MOH-EMNCC-2022')}).parse(req.body); const r=await pool.query(`INSERT INTO birth_events(organization_id,mother_patient_id,birth_datetime,mode,place_type,facility_id,gestational_age_weeks,multiple_birth,complications,outcome,referral,source_guideline) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) RETURNING *`,[dbOrganizationId(req),b.motherPatientId,b.birthDatetime,b.mode,b.placeType||null,b.facilityId||null,b.gestationalAgeWeeks??null,b.multipleBirth,JSON.stringify(b.complications||{}),b.outcome||null,JSON.stringify(b.referral||{}),b.sourceGuideline]); return reply.code(201).send(r.rows[0]); });

app.post('/api/newborns', async(req:any,reply)=>{ if(!pool)return reply.code(501).send({error:'PostgreSQL required'}); const b=z.object({patientId:z.string().uuid().optional(),motherPatientId:z.string().uuid(),birthEventId:z.string().uuid().optional(),sex:z.string().optional(),birthWeightGrams:z.number().optional(),gestationalAgeWeeks:z.number().optional(),apgar:z.record(z.any()).optional(),feeding:z.record(z.any()).optional(),resuscitation:z.record(z.any()).optional(),dangerSigns:z.record(z.any()).optional(),birthDefectsScreening:z.record(z.any()).optional(),kangarooCare:z.record(z.any()).optional(),referral:z.record(z.any()).optional(),sourceGuideline:z.string().default('UG-MOH-EMNCC-2022')}).parse(req.body); const r=await pool.query(`INSERT INTO newborn_records(organization_id,patient_id,mother_patient_id,birth_event_id,sex,birth_weight_grams,gestational_age_weeks,apgar,feeding,resuscitation,danger_signs,birth_defects_screening,kangaroo_care,referral,source_guideline) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15) RETURNING *`,[dbOrganizationId(req),b.patientId||null,b.motherPatientId,b.birthEventId||null,b.sex||null,b.birthWeightGrams??null,b.gestationalAgeWeeks??null,JSON.stringify(b.apgar||{}),JSON.stringify(b.feeding||{}),JSON.stringify(b.resuscitation||{}),JSON.stringify(b.dangerSigns||{}),JSON.stringify(b.birthDefectsScreening||{}),JSON.stringify(b.kangarooCare||{}),JSON.stringify(b.referral||{}),b.sourceGuideline]); return reply.code(201).send(r.rows[0]); });

app.post('/api/postnatal-care/contacts', async(req:any,reply)=>{ if(!pool)return reply.code(501).send({error:'PostgreSQL required'}); const b=z.object({patientId:z.string().uuid(),newbornId:z.string().uuid().optional(),contactDate:z.string(),contactTiming:z.string(),maternalAssessment:z.record(z.any()).optional(),newbornAssessment:z.record(z.any()).optional(),feedingSupport:z.record(z.any()).optional(),familyPlanning:z.record(z.any()).optional(),mentalHealth:z.record(z.any()).optional(),dangerSigns:z.record(z.any()).optional(),referralRequired:z.boolean().default(false),plan:z.string().optional(),sourceGuideline:z.string().default('WHO-PNC-DAK-2025')}).parse(req.body); const r=await pool.query(`INSERT INTO postnatal_contacts(organization_id,patient_id,newborn_id,contact_date,contact_timing,maternal_assessment,newborn_assessment,feeding_support,family_planning,mental_health,danger_signs,referral_required,plan,source_guideline) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14) RETURNING *`,[dbOrganizationId(req),b.patientId,b.newbornId||null,b.contactDate,b.contactTiming,JSON.stringify(b.maternalAssessment||{}),JSON.stringify(b.newbornAssessment||{}),JSON.stringify(b.feedingSupport||{}),JSON.stringify(b.familyPlanning||{}),JSON.stringify(b.mentalHealth||{}),JSON.stringify(b.dangerSigns||{}),b.referralRequired,b.plan||null,b.sourceGuideline]); return reply.code(201).send(r.rows[0]); });

app.get('/api/postnatal-care/:patientId', async(req:any)=>{ if(!pool)return {data:[]}; const r=await pool.query(`SELECT * FROM postnatal_contacts WHERE organization_id=$1 AND patient_id=$2 ORDER BY contact_date DESC`,[dbOrganizationId(req),req.params.patientId]); return {data:r.rows}; });



// --- V10 Child intelligence, care gaps, immunization catch-up and longitudinal Care Graph ---
app.get('/api/child-intelligence/:patientId', async(req:any,reply)=>{
  if(!pool)return {data:{growthTrend:[],careGaps:[],immunization:{due:[],overdue:[],completed:[]},referrals:[]}};
  const o=dbOrganizationId(req), p=req.params.patientId;
  const [growth,gaps,refs,imm] = await Promise.all([
    pool.query(`SELECT id,measured_at AS "measuredAt",age_days AS "ageDays",weight_kg AS "weightKg",length_height_cm AS "lengthHeightCm",head_circumference_cm AS "headCircumferenceCm",muac_mm AS "muacMm",z_scores AS "zScores",growth_interpretation AS "growthInterpretation",source_standard AS "sourceStandard" FROM child_growth_measurements WHERE organization_id=$1 AND patient_id=$2 ORDER BY measured_at DESC LIMIT 24`,[o,p]),
    pool.query(`SELECT * FROM child_care_gaps WHERE organization_id=$1 AND patient_id=$2 AND status IN ('open','acknowledged') ORDER BY CASE priority WHEN 'urgent' THEN 1 WHEN 'high' THEN 2 ELSE 3 END,detected_at DESC`,[o,p]),
    pool.query(`SELECT id,status,payload,created_at AS "createdAt" FROM module_records WHERE organization_id=$1 AND module='referrals' AND COALESCE(payload->>'coverageVersion','') <> '025' AND COALESCE(payload->>'recordPurpose','') <> 'connected synthetic testing' AND payload->>'patientId'=$2 ORDER BY created_at DESC LIMIT 50`,[o,p]),
    pool.query(`SELECT * FROM immunization_reviews WHERE organization_id=$1 AND patient_id=$2 ORDER BY reviewed_at DESC LIMIT 1`,[o,p])
  ]);
  const series=growth.rows.slice().reverse();
  const trend=series.length<2?[]:[{metric:'weightKg',first:series[0].weightKg,last:series.at(-1).weightKg,delta:series.at(-1).weightKg!=null&&series[0].weightKg!=null?Number(series.at(-1).weightKg)-Number(series[0].weightKg):null},{metric:'lengthHeightCm',first:series[0].lengthHeightCm,last:series.at(-1).lengthHeightCm,delta:series.at(-1).lengthHeightCm!=null&&series[0].lengthHeightCm!=null?Number(series.at(-1).lengthHeightCm)-Number(series[0].lengthHeightCm):null}];
  const ir=imm.rows[0]||{};
  return {data:{growthTrend:trend,growthMeasurements:growth.rows,careGaps:gaps.rows,immunization:{due:ir.due_items||[],overdue:ir.overdue_items||[],completed:ir.completed_items||[]},referrals:refs.rows}};
});

app.post('/api/child-intelligence/care-gaps/detect', async(req:any,reply)=>{
  if(!pool)return reply.code(501).send({error:'PostgreSQL required'});
  const b=z.object({patientId:z.string().uuid(),sourceGuideline:z.string().default('UG-MOH-CHILD-HEALTH-2023')}).parse(req.body||{});
  const o=dbOrganizationId(req), p=b.patientId;
  const [growth,imm] = await Promise.all([
    pool.query(`SELECT measured_at FROM child_growth_measurements WHERE organization_id=$1 AND patient_id=$2 ORDER BY measured_at DESC LIMIT 1`,[o,p]),
    pool.query(`SELECT due_items,overdue_items FROM immunization_reviews WHERE organization_id=$1 AND patient_id=$2 ORDER BY reviewed_at DESC LIMIT 1`,[o,p])
  ]);
  const gaps:any[]=[];
  if(!growth.rowCount) gaps.push({gapType:'growth-monitoring',priority:'high',title:'No child growth measurement recorded',description:'A growth measurement has not yet been recorded for this child in ClinAI.',evidence:{reason:'no-growth-record'}});
  const lastGrowth=growth.rows[0]?.measured_at;
  if(lastGrowth && Date.now()-new Date(lastGrowth).getTime()>180*86400000) gaps.push({gapType:'growth-monitoring',priority:'high',title:'Growth monitoring may be overdue',description:'The most recent growth measurement is more than six months old. Review against the applicable child-health schedule.',evidence:{lastMeasuredAt:lastGrowth}});
  const ir=imm.rows[0];
  if(ir?.overdue_items?.length) gaps.push({gapType:'immunization',priority:'high',title:'Overdue immunization items require review',description:'The latest immunization review contains overdue items.',evidence:{overdueItems:ir.overdue_items}});
  const created:any[]=[];
  for(const g of gaps){
    const existing=await pool.query(`SELECT id FROM child_care_gaps WHERE organization_id=$1 AND patient_id=$2 AND gap_type=$3 AND status IN ('open','acknowledged') LIMIT 1`,[o,p,g.gapType]);
    if(!existing.rowCount){const r=await pool.query(`INSERT INTO child_care_gaps(organization_id,patient_id,gap_type,status,priority,title,description,evidence,source_guideline) VALUES($1,$2,$3,'open',$4,$5,$6,$7,$8) RETURNING *`,[o,p,g.gapType,g.priority,g.title,g.description,JSON.stringify(g.evidence),b.sourceGuideline]);created.push(r.rows[0]);}
  }
  return reply.code(201).send({data:created,requiresClinicianReview:true});
});

app.post('/api/immunization/catch-up-plans', async(req:any,reply)=>{
  if(!pool)return reply.code(501).send({error:'PostgreSQL required'});
  const b=z.object({patientId:z.string().uuid(),jurisdiction:z.string().default('UG'),planItems:z.array(z.record(z.any())).default([]),rationale:z.record(z.any()).default({}),sourceGuideline:z.string().default('WHO-SMART-DAK-IMMZ-1.1.0')}).parse(req.body||{});
  const r=await pool.query(`INSERT INTO immunization_catchup_plans(organization_id,patient_id,jurisdiction,status,plan_items,rationale,source_guideline,clinician_review_required,created_by) VALUES($1,$2,$3,'draft',$4,$5,$6,true,$7) RETURNING *`,[dbOrganizationId(req),b.patientId,b.jurisdiction,JSON.stringify(b.planItems),JSON.stringify(b.rationale),b.sourceGuideline,dbUserId(req)]);
  return reply.code(201).send(r.rows[0]);
});

app.get('/api/immunization/catch-up-plans/:patientId', async(req:any)=>{if(!pool)return {data:[]};const r=await pool.query(`SELECT * FROM immunization_catchup_plans WHERE organization_id=$1 AND patient_id=$2 ORDER BY created_at DESC`,[dbOrganizationId(req),req.params.patientId]);return {data:r.rows};});

app.post('/api/care-graph/edges', async(req:any,reply)=>{
  if(!pool)return reply.code(501).send({error:'PostgreSQL required'});
  const b=z.object({patientId:z.string().uuid(),sourceType:z.string(),sourceId:z.string().uuid().optional(),targetType:z.string(),targetId:z.string().uuid().optional(),relationship:z.string(),metadata:z.record(z.any()).default({})}).parse(req.body||{});
  const r=await pool.query(`INSERT INTO care_graph_edges(organization_id,patient_id,source_type,source_id,target_type,target_id,relationship,metadata) VALUES($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *`,[dbOrganizationId(req),b.patientId,b.sourceType,b.sourceId||null,b.targetType,b.targetId||null,b.relationship,JSON.stringify(b.metadata)]);
  return reply.code(201).send(r.rows[0]);
});

app.get('/api/care-graph/:patientId', async(req:any)=>{
  if(!pool)return {data:{nodes:[],edges:[]}};
  const o=dbOrganizationId(req),p=req.params.patientId;
  const [edges,maternal,births,newborn,pnc,child,growth,imci,imm,refs]=await Promise.all([
    pool.query(`SELECT * FROM care_graph_edges WHERE organization_id=$1 AND patient_id=$2 ORDER BY created_at DESC`,[o,p]),
    pool.query(`SELECT id,created_at AS "createdAt",risk_status AS "riskStatus" FROM maternal_care_records WHERE organization_id=$1 AND patient_id=$2 ORDER BY created_at DESC LIMIT 20`,[o,p]),
    pool.query(`SELECT id,birth_datetime AS "birthDatetime",mode,outcome FROM birth_events WHERE organization_id=$1 AND mother_patient_id=$2 ORDER BY birth_datetime DESC LIMIT 20`,[o,p]),
    pool.query(`SELECT id,created_at AS "createdAt",sex,birth_weight_grams AS "birthWeightGrams" FROM newborn_records WHERE organization_id=$1 AND (patient_id=$2 OR mother_patient_id=$2) ORDER BY created_at DESC LIMIT 20`,[o,p]),
    pool.query(`SELECT id,contact_date AS "contactDate",contact_timing AS "contactTiming" FROM postnatal_contacts WHERE organization_id=$1 AND patient_id=$2 ORDER BY contact_date DESC LIMIT 20`,[o,p]),
    pool.query(`SELECT id,visit_date AS "visitDate",age_months AS "ageMonths",referral_required AS "referralRequired" FROM child_health_visits WHERE organization_id=$1 AND patient_id=$2 ORDER BY visit_date DESC LIMIT 30`,[o,p]),
    pool.query(`SELECT id,measured_at AS "measuredAt",weight_kg AS "weightKg",length_height_cm AS "lengthHeightCm" FROM child_growth_measurements WHERE organization_id=$1 AND patient_id=$2 ORDER BY measured_at DESC LIMIT 30`,[o,p]),
    pool.query(`SELECT id,assessed_at AS "assessedAt",classifications,referral_required AS "referralRequired" FROM child_imci_assessments WHERE organization_id=$1 AND patient_id=$2 ORDER BY assessed_at DESC LIMIT 30`,[o,p]),
    pool.query(`SELECT id,reviewed_at AS "reviewedAt",due_items AS "dueItems",overdue_items AS "overdueItems" FROM immunization_reviews WHERE organization_id=$1 AND patient_id=$2 ORDER BY reviewed_at DESC LIMIT 20`,[o,p]),
    pool.query(`SELECT id,status,payload,created_at AS "createdAt" FROM module_records WHERE organization_id=$1 AND module='referrals' AND COALESCE(payload->>'coverageVersion','') <> '025' AND COALESCE(payload->>'recordPurpose','') <> 'connected synthetic testing' AND payload->>'patientId'=$2 ORDER BY created_at DESC LIMIT 30`,[o,p])
  ]);
  const groups:any[]=[['maternal-record',maternal.rows],['birth-event',births.rows],['newborn',newborn.rows],['postnatal-contact',pnc.rows],['child-visit',child.rows],['growth',growth.rows],['imci',imci.rows],['immunization-review',imm.rows],['referral',refs.rows]];
  const nodes=groups.flatMap(([type,rows])=>rows.map((x:any)=>({id:`${type}:${x.id}`,type,data:x})));
  return {data:{nodes,edges:edges.rows}};
});


// --- V12 Public Health Response + One Health ---
app.post('/api/public-health/investigations',async(req:any,reply)=>{if(!pool)return reply.code(501).send({error:'PostgreSQL required'});const b=z.object({surveillanceCaseId:z.string().uuid().optional(),eventId:z.string().uuid().optional(),investigationType:z.string(),leadUserId:z.string().uuid().optional(),findings:z.record(z.any()).default({}),verification:z.record(z.any()).default({}),riskAssessment:z.record(z.any()).default({}),sourceGuideline:z.string().optional()}).parse(req.body||{});const r=await pool.query(`INSERT INTO public_health_investigations(organization_id,surveillance_case_id,event_id,investigation_type,lead_user_id,findings,verification,risk_assessment,source_guideline,created_by) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING *`,[dbOrganizationId(req),b.surveillanceCaseId||null,b.eventId||null,b.investigationType,b.leadUserId||null,JSON.stringify(b.findings),JSON.stringify(b.verification),JSON.stringify(b.riskAssessment),b.sourceGuideline||null,dbUserId(req)]);return reply.code(201).send(r.rows[0]);});
app.get('/api/public-health/investigations',async(req:any)=>{if(!pool)return {data:[]};const r=await pool.query(`SELECT * FROM public_health_investigations WHERE organization_id=$1 ORDER BY started_at DESC LIMIT 200`,[dbOrganizationId(req)]);return {data:r.rows};});
app.post('/api/public-health/investigations/:investigationId/contacts',async(req:any,reply)=>{if(!pool)return reply.code(501).send({error:'PostgreSQL required'});const b=z.object({patientId:z.string().uuid().optional(),contactType:z.string(),exposureStart:z.string().optional(),exposureEnd:z.string().optional(),relationship:z.string().optional(),location:z.record(z.any()).default({}),riskLevel:z.enum(['routine','moderate','high','urgent']).default('routine'),notes:z.record(z.any()).default({})}).parse(req.body||{});const r=await pool.query(`INSERT INTO public_health_contacts(organization_id,investigation_id,patient_id,contact_type,exposure_start,exposure_end,relationship,location,risk_level,notes) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING *`,[dbOrganizationId(req),req.params.investigationId,b.patientId||null,b.contactType,b.exposureStart||null,b.exposureEnd||null,b.relationship||null,JSON.stringify(b.location),b.riskLevel,JSON.stringify(b.notes)]);return reply.code(201).send(r.rows[0]);});
app.get('/api/public-health/investigations/:investigationId/contacts',async(req:any)=>{if(!pool)return {data:[]};const r=await pool.query(`SELECT * FROM public_health_contacts WHERE organization_id=$1 AND investigation_id=$2 ORDER BY created_at DESC`,[dbOrganizationId(req),req.params.investigationId]);return {data:r.rows};});
app.post('/api/public-health/response-tasks',async(req:any,reply)=>{if(!pool)return reply.code(501).send({error:'PostgreSQL required'});const b=z.object({investigationId:z.string().uuid().optional(),eventId:z.string().uuid().optional(),taskType:z.string(),title:z.string(),priority:z.enum(['routine','high','urgent','critical']).default('routine'),assignedTo:z.string().uuid().optional(),dueAt:z.string().optional(),escalationLevel:z.number().int().min(0).default(0),evidence:z.record(z.any()).default({}),requiresHumanApproval:z.boolean().default(true)}).parse(req.body||{});const r=await pool.query(`INSERT INTO public_health_response_tasks(organization_id,investigation_id,event_id,task_type,title,priority,assigned_to,due_at,escalation_level,evidence,requires_human_approval,created_by) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) RETURNING *`,[dbOrganizationId(req),b.investigationId||null,b.eventId||null,b.taskType,b.title,b.priority,b.assignedTo||null,b.dueAt||null,b.escalationLevel,JSON.stringify(b.evidence),b.requiresHumanApproval,dbUserId(req)]);return reply.code(201).send(r.rows[0]);});
app.get('/api/public-health/response-tasks',async(req:any)=>{if(!pool)return {data:[]};const r=await pool.query(`SELECT * FROM public_health_response_tasks WHERE organization_id=$1 AND status NOT IN ('completed','cancelled') ORDER BY CASE priority WHEN 'critical' THEN 1 WHEN 'urgent' THEN 2 WHEN 'high' THEN 3 ELSE 4 END,due_at NULLS LAST`,[dbOrganizationId(req)]);return {data:r.rows};});
app.post('/api/public-health/alerts',async(req:any,reply)=>{if(!pool)return reply.code(501).send({error:'PostgreSQL required'});const b=z.object({alertType:z.string(),severity:z.enum(['routine','high','urgent','critical']).default('high'),title:z.string(),message:z.string(),sourceEventId:z.string().uuid().optional(),sourceInvestigationId:z.string().uuid().optional(),generatedReason:z.record(z.any()).default({})}).parse(req.body||{});const r=await pool.query(`INSERT INTO public_health_alerts(organization_id,alert_type,severity,title,message,source_event_id,source_investigation_id,generated_reason) VALUES($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *`,[dbOrganizationId(req),b.alertType,b.severity,b.title,b.message,b.sourceEventId||null,b.sourceInvestigationId||null,JSON.stringify(b.generatedReason)]);return reply.code(201).send(r.rows[0]);});
app.get('/api/public-health/alerts',async(req:any)=>{if(!pool)return {data:[]};const r=await pool.query(`SELECT * FROM public_health_alerts WHERE organization_id=$1 AND status NOT IN ('resolved','dismissed') ORDER BY created_at DESC LIMIT 200`,[dbOrganizationId(req)]);return {data:r.rows};});
app.post('/api/mortality-surveillance',async(req:any,reply)=>{if(!pool)return reply.code(501).send({error:'PostgreSQL required'});const b=z.object({patientId:z.string().uuid().optional(),facilityId:z.string().uuid().optional(),deathDatetime:z.string(),placeOfDeath:z.string().optional(),immediateCause:z.string().optional(),underlyingCause:z.string().optional(),contributingConditions:z.array(z.any()).default([]),maternalDeath:z.boolean().default(false),neonatalDeath:z.boolean().default(false),sourceGuideline:z.string().optional()}).parse(req.body||{});const r=await pool.query(`INSERT INTO mortality_surveillance_records(organization_id,patient_id,facility_id,death_datetime,place_of_death,immediate_cause,underlying_cause,contributing_conditions,maternal_death,neonatal_death,source_guideline,created_by) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) RETURNING *`,[dbOrganizationId(req),b.patientId||null,b.facilityId||null,b.deathDatetime,b.placeOfDeath||null,b.immediateCause||null,b.underlyingCause||null,JSON.stringify(b.contributingConditions),b.maternalDeath,b.neonatalDeath,b.sourceGuideline||null,dbUserId(req)]);return reply.code(201).send(r.rows[0]);});
app.get('/api/public-health/dashboard',async(req:any)=>{if(!pool)return {data:{}};const o=dbOrganizationId(req);const [investigations,contacts,tasks,alerts,mortality]=await Promise.all([pool.query(`SELECT count(*)::int AS count FROM public_health_investigations WHERE organization_id=$1 AND status NOT IN ('closed','completed')`,[o]),pool.query(`SELECT count(*)::int AS count FROM public_health_contacts WHERE organization_id=$1 AND status IN ('identified','notified','monitoring')`,[o]),pool.query(`SELECT count(*)::int AS count FROM public_health_response_tasks WHERE organization_id=$1 AND status NOT IN ('completed','cancelled')`,[o]),pool.query(`SELECT count(*)::int AS count FROM public_health_alerts WHERE organization_id=$1 AND status NOT IN ('resolved','dismissed')`,[o]),pool.query(`SELECT count(*)::int AS count FROM mortality_surveillance_records WHERE organization_id=$1 AND death_datetime>=now()-interval '30 days'`,[o])]);return {data:{openInvestigations:investigations.rows[0]?.count||0,activeContacts:contacts.rows[0]?.count||0,pendingResponseTasks:tasks.rows[0]?.count||0,openAlerts:alerts.rows[0]?.count||0,deathsLast30Days:mortality.rows[0]?.count||0,requiresHumanApproval:true,oneHealthReady:true}}});

// --- V11 Population Health + Surveillance Intelligence ---
app.post('/api/surveillance/events', async(req:any,reply)=>{
  if(!pool)return reply.code(501).send({error:'PostgreSQL required'});
  const b=z.object({patientId:z.string().uuid().optional(),eventType:z.string(),diseaseCode:z.string().optional(),diseaseName:z.string().optional(),eventDate:z.string().optional(),location:z.record(z.any()).default({}),caseStatus:z.enum(['suspected','probable','confirmed','discarded','unknown']).default('suspected'),severity:z.enum(['routine','high','urgent','critical']).default('routine'),source:z.string().optional(),evidence:z.record(z.any()).default({})}).parse(req.body||{});
  const r=await pool.query(`INSERT INTO surveillance_events(organization_id,patient_id,event_type,disease_code,disease_name,event_date,location,case_status,severity,source,evidence,created_by) VALUES($1,$2,$3,$4,$5,COALESCE($6::timestamptz,now()),$7,$8,$9,$10,$11,$12) RETURNING *`,[dbOrganizationId(req),b.patientId||null,b.eventType,b.diseaseCode||null,b.diseaseName||null,b.eventDate||null,JSON.stringify(b.location),b.caseStatus,b.severity,b.source||null,JSON.stringify(b.evidence),dbUserId(req)]);
  return reply.code(201).send(r.rows[0]);
});
app.get('/api/surveillance/events', async(req:any)=>{if(!pool)return {data:[]};const q=req.query||{};const params=[dbOrganizationId(req)];let where='organization_id=$1';if(q.diseaseCode){params.push(q.diseaseCode);where+=' AND disease_code=$'+params.length;}const r=await pool.query(`SELECT * FROM surveillance_events WHERE ${where} ORDER BY event_date DESC LIMIT 200`,params);return {data:r.rows};});
app.post('/api/surveillance/cases', async(req:any,reply)=>{if(!pool)return reply.code(501).send({error:'PostgreSQL required'});const b=z.object({eventId:z.string().uuid().optional(),caseIdentifier:z.string().optional(),diseaseCode:z.string(),caseDefinitionVersion:z.string().optional(),classification:z.enum(['suspected','probable','confirmed','discarded']).default('suspected'),onsetDate:z.string().optional(),notificationDate:z.string().optional(),outcome:z.string().optional(),exposure:z.record(z.any()).default({}),laboratory:z.record(z.any()).default({}),investigation:z.record(z.any()).default({})}).parse(req.body||{});const r=await pool.query(`INSERT INTO surveillance_cases(organization_id,event_id,case_identifier,disease_code,case_definition_version,classification,onset_date,notification_date,outcome,exposure,laboratory,investigation,created_by) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13) RETURNING *`,[dbOrganizationId(req),b.eventId||null,b.caseIdentifier||null,b.diseaseCode,b.caseDefinitionVersion||null,b.classification,b.onsetDate||null,b.notificationDate||null,b.outcome||null,JSON.stringify(b.exposure),JSON.stringify(b.laboratory),JSON.stringify(b.investigation),dbUserId(req)]);return reply.code(201).send(r.rows[0]);});
app.get('/api/surveillance/summary', async(req:any)=>{if(!pool)return {data:{}};const o=dbOrganizationId(req);const [events,cases,byDisease]=await Promise.all([pool.query(`SELECT count(*)::int AS count FROM surveillance_events WHERE organization_id=$1 AND event_date>=now()-interval '30 days'`,[o]),pool.query(`SELECT count(*)::int AS count FROM surveillance_cases WHERE organization_id=$1 AND status<>'closed'`,[o]),pool.query(`SELECT disease_code,case_status,count(*)::int AS count FROM surveillance_events WHERE organization_id=$1 AND event_date>=now()-interval '30 days' GROUP BY disease_code,case_status ORDER BY count DESC`,[o])]);return {data:{eventsLast30Days:events.rows[0]?.count||0,openCases:cases.rows[0]?.count||0,byDisease:byDisease.rows}};});
app.post('/api/population/cohorts', async(req:any,reply)=>{if(!pool)return reply.code(501).send({error:'PostgreSQL required'});const b=z.object({name:z.string(),description:z.string().optional(),cohortType:z.string(),definition:z.record(z.any()).default({}),jurisdiction:z.string().default('UG'),sourceGuideline:z.string().optional()}).parse(req.body||{});const r=await pool.query(`INSERT INTO population_cohorts(organization_id,name,description,cohort_type,definition,jurisdiction,source_guideline,created_by) VALUES($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *`,[dbOrganizationId(req),b.name,b.description||null,b.cohortType,JSON.stringify(b.definition),b.jurisdiction,b.sourceGuideline||null,dbUserId(req)]);return reply.code(201).send(r.rows[0]);});
app.post('/api/population/cohorts/:cohortId/members', async(req:any,reply)=>{if(!pool)return reply.code(501).send({error:'PostgreSQL required'});const b=z.object({patientId:z.string().uuid(),riskLevel:z.enum(['routine','moderate','high','urgent']).default('routine'),evidence:z.record(z.any()).default({})}).parse(req.body||{});const r=await pool.query(`INSERT INTO population_cohort_members(organization_id,cohort_id,patient_id,risk_level,evidence) VALUES($1,$2,$3,$4,$5) ON CONFLICT(cohort_id,patient_id) DO UPDATE SET risk_level=EXCLUDED.risk_level,evidence=EXCLUDED.evidence,status='active' RETURNING *`,[dbOrganizationId(req),req.params.cohortId,b.patientId,b.riskLevel,JSON.stringify(b.evidence)]);return reply.code(201).send(r.rows[0]);});
app.get('/api/population/cohorts/:cohortId', async(req:any)=>{if(!pool)return {data:[]};const r=await pool.query(`SELECT m.*,p.first_name,p.last_name FROM population_cohort_members m JOIN patients p ON p.id=m.patient_id WHERE m.organization_id=$1 AND m.cohort_id=$2 ORDER BY CASE m.risk_level WHEN 'urgent' THEN 1 WHEN 'high' THEN 2 WHEN 'moderate' THEN 3 ELSE 4 END,m.joined_at DESC`,[dbOrganizationId(req),req.params.cohortId]);return {data:r.rows};});
app.post('/api/population/indicators', async(req:any,reply)=>{if(!pool)return reply.code(501).send({error:'PostgreSQL required'});const b=z.object({indicatorCode:z.string(),indicatorName:z.string(),periodStart:z.string(),periodEnd:z.string(),numerator:z.number().default(0),denominator:z.number().default(0),dimensions:z.record(z.any()).default({}),source:z.string().optional()}).parse(req.body||{});const value=b.denominator?b.numerator/b.denominator*100:null;const r=await pool.query(`INSERT INTO population_indicators(organization_id,indicator_code,indicator_name,period_start,period_end,numerator,denominator,value,dimensions,source) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) ON CONFLICT(organization_id,indicator_code,period_start,period_end,dimensions) DO UPDATE SET numerator=EXCLUDED.numerator,denominator=EXCLUDED.denominator,value=EXCLUDED.value,calculated_at=now() RETURNING *`,[dbOrganizationId(req),b.indicatorCode,b.indicatorName,b.periodStart,b.periodEnd,b.numerator,b.denominator,value,JSON.stringify(b.dimensions),b.source||null]);return reply.code(201).send(r.rows[0]);});
app.get('/api/population/dashboard', async(req:any)=>{if(!pool)return {data:{}};const o=dbOrganizationId(req);const [cohorts,highRisk,indicators]=await Promise.all([pool.query(`SELECT count(*)::int AS count FROM population_cohorts WHERE organization_id=$1 AND status='active'`,[o]),pool.query(`SELECT count(*)::int AS count FROM population_cohort_members WHERE organization_id=$1 AND status='active' AND risk_level IN ('high','urgent')`,[o]),pool.query(`SELECT * FROM population_indicators WHERE organization_id=$1 ORDER BY period_end DESC,calculated_at DESC LIMIT 100`,[o])]);return {data:{activeCohorts:cohorts.rows[0]?.count||0,highRiskMembers:highRisk.rows[0]?.count||0,indicators:indicators.rows}};});

function friendlyError(err:any){
  const issues=Array.isArray(err?.issues)?err.issues.map((x:any)=>x?.message).filter(Boolean):[];
  if(issues.length)return issues.slice(0,5).join(' ');
  const m=String(err?.message||'').trim();
  if(/duplicate|already exists|unique/i.test(m))return 'This record may already exist. Please review the existing information before creating another one.';
  if(/not found/i.test(m))return 'We could not find the requested record. Please check the information and try again.';
  if(/required|must be|invalid/i.test(m))return m.replace(/\b(uuid|JSON|schema|payload|request body|validation)\b/gi,'information').replace(/\s+/g,' ').trim();
  if(/timeout|timed out/i.test(m))return 'We could not complete that request in time. Please try again.';
  if(/stack|postgres|database|sql|syntax|internal server|relation .* does not exist/i.test(m))return 'We could not complete that request. Please try again.';
  return m || 'We could not complete that request. Please try again.';
}
app.setErrorHandler((err:any,_req,reply)=>{app.log.error(err);reply.code(err.statusCode||500).send({error:friendlyError(err)});});

// --- V13 Facility Operations + District Health Intelligence ---
app.get('/api/districts',async(req:any)=>{if(!pool)return {data:[]};const r=await pool.query(`SELECT * FROM districts WHERE organization_id=$1 ORDER BY name`,[dbOrganizationId(req)]);return {data:r.rows};});
app.post('/api/districts',async(req:any,reply)=>{if(!pool)return reply.code(501).send({error:'PostgreSQL required'});const b=z.object({name:z.string().min(1),code:z.string().optional(),region:z.string().optional(),metadata:z.record(z.any()).default({})}).parse(req.body||{});const r=await pool.query(`INSERT INTO districts(organization_id,name,code,region,metadata) VALUES($1,$2,$3,$4,$5) RETURNING *`,[dbOrganizationId(req),b.name,b.code||null,b.region||null,JSON.stringify(b.metadata)]);return reply.code(201).send(r.rows[0]);});
app.post('/api/districts/:districtId/facilities',async(req:any,reply)=>{if(!pool)return reply.code(501).send({error:'PostgreSQL required'});const b=z.object({facilityId:z.string().uuid(),relationship:z.string().default('serves'),effectiveFrom:z.string().optional(),effectiveTo:z.string().optional(),metadata:z.record(z.any()).default({})}).parse(req.body||{});const r=await pool.query(`INSERT INTO district_facility_links(organization_id,district_id,facility_id,relationship,effective_from,effective_to,metadata) SELECT $1,$2,$3,$4,$5,$6,$7 WHERE EXISTS(SELECT 1 FROM districts WHERE id=$2 AND organization_id=$1) AND EXISTS(SELECT 1 FROM facilities WHERE id=$3 AND organization_id=$1) ON CONFLICT(organization_id,district_id,facility_id) DO UPDATE SET relationship=EXCLUDED.relationship,effective_from=EXCLUDED.effective_from,effective_to=EXCLUDED.effective_to,metadata=EXCLUDED.metadata RETURNING *`,[dbOrganizationId(req),req.params.districtId,b.facilityId,b.relationship,b.effectiveFrom||null,b.effectiveTo||null,JSON.stringify(b.metadata)]);if(!r.rowCount)return reply.code(404).send({error:'District or facility not found'});return reply.code(201).send(r.rows[0]);});
app.get('/api/facilities/operations',async(req:any)=>{if(!pool)return {data:[]};const r=await pool.query(`SELECT f.id,f.name,f.type,COALESCE((SELECT json_agg(x) FROM (SELECT service_code AS "serviceCode",service_name AS "serviceName",status,capacity_available AS "capacityAvailable",wait_minutes AS "waitMinutes",observed_at AS "observedAt" FROM facility_service_capacity WHERE facility_id=f.id ORDER BY observed_at DESC LIMIT 20)x),'[]') AS services,COALESCE((SELECT json_agg(x) FROM (SELECT resource_type AS "resourceType",resource_name AS "resourceName",status,quantity,unit,observed_at AS "observedAt" FROM facility_resource_status WHERE facility_id=f.id ORDER BY observed_at DESC LIMIT 20)x),'[]') AS resources FROM facilities f WHERE f.organization_id=$1 ORDER BY f.name`,[dbOrganizationId(req)]);return {data:r.rows};});
app.post('/api/facilities/:facilityId/capacity',async(req:any,reply)=>{if(!pool)return reply.code(501).send({error:'PostgreSQL required'});const b=z.object({serviceCode:z.string(),serviceName:z.string(),status:z.enum(['available','limited','unavailable','planned']).default('available'),capacityTotal:z.number().int().nonnegative().optional(),capacityAvailable:z.number().int().nonnegative().optional(),waitMinutes:z.number().int().nonnegative().optional(),operatingHours:z.record(z.any()).default({}),metadata:z.record(z.any()).default({})}).parse(req.body||{});const r=await pool.query(`INSERT INTO facility_service_capacity(organization_id,facility_id,service_code,service_name,status,capacity_total,capacity_available,wait_minutes,operating_hours,metadata) SELECT $1,$2,$3,$4,$5,$6,$7,$8,$9,$10 WHERE EXISTS(SELECT 1 FROM facilities WHERE id=$2 AND organization_id=$1) RETURNING *`,[dbOrganizationId(req),req.params.facilityId,b.serviceCode,b.serviceName,b.status,b.capacityTotal??null,b.capacityAvailable??null,b.waitMinutes??null,JSON.stringify(b.operatingHours),JSON.stringify(b.metadata)]);if(!r.rowCount)return reply.code(404).send({error:'Facility not found'});return reply.code(201).send(r.rows[0]);});
app.post('/api/facilities/:facilityId/resources',async(req:any,reply)=>{if(!pool)return reply.code(501).send({error:'PostgreSQL required'});const b=z.object({resourceType:z.string(),resourceName:z.string(),status:z.enum(['available','low','critical','unavailable','unknown']).default('available'),quantity:z.number().optional(),unit:z.string().optional(),threshold:z.number().optional(),notes:z.record(z.any()).default({})}).parse(req.body||{});const r=await pool.query(`INSERT INTO facility_resource_status(organization_id,facility_id,resource_type,resource_name,status,quantity,unit,threshold,notes) SELECT $1,$2,$3,$4,$5,$6,$7,$8,$9 WHERE EXISTS(SELECT 1 FROM facilities WHERE id=$2 AND organization_id=$1) RETURNING *`,[dbOrganizationId(req),req.params.facilityId,b.resourceType,b.resourceName,b.status,b.quantity??null,b.unit||null,b.threshold??null,JSON.stringify(b.notes)]);if(!r.rowCount)return reply.code(404).send({error:'Facility not found'});return reply.code(201).send(r.rows[0]);});
app.post('/api/workforce/capacity',async(req:any,reply)=>{if(!pool)return reply.code(501).send({error:'PostgreSQL required'});const b=z.object({facilityId:z.string().uuid().optional(),districtId:z.string().uuid().optional(),cadre:z.string(),scheduledCount:z.number().int().nonnegative().default(0),availableCount:z.number().int().nonnegative().default(0),onDutyCount:z.number().int().nonnegative().default(0),vacancyCount:z.number().int().nonnegative().default(0),metadata:z.record(z.any()).default({})}).parse(req.body||{});const r=await pool.query(`INSERT INTO workforce_capacity_snapshots(organization_id,facility_id,district_id,cadre,scheduled_count,available_count,on_duty_count,vacancy_count,metadata) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING *`,[dbOrganizationId(req),b.facilityId||null,b.districtId||null,b.cadre,b.scheduledCount,b.availableCount,b.onDutyCount,b.vacancyCount,JSON.stringify(b.metadata)]);return reply.code(201).send(r.rows[0]);});
app.post('/api/facility-incidents',async(req:any,reply)=>{if(!pool)return reply.code(501).send({error:'PostgreSQL required'});const b=z.object({facilityId:z.string().uuid().optional(),districtId:z.string().uuid().optional(),incidentType:z.string(),severity:z.enum(['low','moderate','high','critical']).default('moderate'),title:z.string(),description:z.string().optional(),responseOwner:z.string().uuid().optional(),impact:z.record(z.any()).default({})}).parse(req.body||{});const r=await pool.query(`INSERT INTO facility_operational_incidents(organization_id,facility_id,district_id,incident_type,severity,title,description,response_owner,impact,created_by) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING *`,[dbOrganizationId(req),b.facilityId||null,b.districtId||null,b.incidentType,b.severity,b.title,b.description||null,b.responseOwner||null,JSON.stringify(b.impact),dbUserId(req)]);return reply.code(201).send(r.rows[0]);});
app.get('/api/facility-incidents',async(req:any)=>{if(!pool)return {data:[]};const r=await pool.query(`SELECT * FROM facility_operational_incidents WHERE organization_id=$1 AND status NOT IN ('resolved','closed') ORDER BY CASE severity WHEN 'critical' THEN 1 WHEN 'high' THEN 2 WHEN 'moderate' THEN 3 ELSE 4 END,started_at DESC`,[dbOrganizationId(req)]);return {data:r.rows};});
app.post('/api/facility-performance',async(req:any,reply)=>{if(!pool)return reply.code(501).send({error:'PostgreSQL required'});const b=z.object({facilityId:z.string().uuid().optional(),districtId:z.string().uuid().optional(),periodStart:z.string(),periodEnd:z.string(),indicatorCode:z.string(),indicatorName:z.string(),numerator:z.number().optional(),denominator:z.number().optional(),valueNumeric:z.number().optional(),unit:z.string().optional(),qualityStatus:z.string().default('unreviewed'),dimensions:z.record(z.any()).default({}),source:z.string().optional()}).parse(req.body||{});const r=await pool.query(`INSERT INTO facility_performance_snapshots(organization_id,facility_id,district_id,period_start,period_end,indicator_code,indicator_name,numerator,denominator,value_numeric,unit,quality_status,dimensions,source) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14) RETURNING *`,[dbOrganizationId(req),b.facilityId||null,b.districtId||null,b.periodStart,b.periodEnd,b.indicatorCode,b.indicatorName,b.numerator??null,b.denominator??null,b.valueNumeric??null,b.unit||null,b.qualityStatus,JSON.stringify(b.dimensions),b.source||null]);return reply.code(201).send(r.rows[0]);});
app.get('/api/districts/:districtId/intelligence',async(req:any)=>{if(!pool)return {data:{}};const o=dbOrganizationId(req),d=req.params.districtId;const [facilities,workforce,incidents,performance,referrals]=await Promise.all([pool.query(`SELECT f.id,f.name,f.type FROM facilities f JOIN district_facility_links l ON l.facility_id=f.id WHERE l.organization_id=$1 AND l.district_id=$2 ORDER BY f.name`,[o,d]),pool.query(`SELECT cadre,SUM(on_duty_count)::int AS "onDuty",SUM(available_count)::int AS "available",SUM(vacancy_count)::int AS vacancies FROM workforce_capacity_snapshots WHERE organization_id=$1 AND district_id=$2 GROUP BY cadre ORDER BY cadre`,[o,d]),pool.query(`SELECT severity,count(*)::int AS count FROM facility_operational_incidents WHERE organization_id=$1 AND district_id=$2 AND status NOT IN ('resolved','closed') GROUP BY severity`,[o,d]),pool.query(`SELECT indicator_code AS "indicatorCode",indicator_name AS "indicatorName",AVG(value_numeric) AS "averageValue" FROM facility_performance_snapshots WHERE organization_id=$1 AND district_id=$2 GROUP BY indicator_code,indicator_name ORDER BY indicator_code`,[o,d]),pool.query(`SELECT from_facility_id AS "fromFacilityId",to_facility_id AS "toFacilityId",service_code AS "serviceCode",status,typical_wait_minutes AS "typicalWaitMinutes" FROM referral_network_nodes WHERE organization_id=$1 AND (from_facility_id IN (SELECT facility_id FROM district_facility_links WHERE district_id=$2) OR to_facility_id IN (SELECT facility_id FROM district_facility_links WHERE district_id=$2))`,[o,d])]);return {data:{facilities:facilities.rows,workforce:workforce.rows,incidents:incidents.rows,performance:performance.rows,referralNetwork:referrals.rows,meta:{jurisdiction:'UG',requiresHumanReview:true}}};});



// --- V15 Platform Completion: analytics, patient merge lineage and command-center intelligence ---
async function ensureV15Schema(){
  if(!pool)return;
  await pool.query(`
    CREATE TABLE IF NOT EXISTS patient_aliases (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(), organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
      patient_id uuid NOT NULL REFERENCES patients(id) ON DELETE CASCADE, alias_patient_id uuid NOT NULL,
      alias_patient_number text, reason text, merged_at timestamptz NOT NULL DEFAULT now(), merged_by uuid REFERENCES users(id) ON DELETE SET NULL
    );
    CREATE INDEX IF NOT EXISTS patient_aliases_lookup_idx ON patient_aliases(organization_id,alias_patient_id);
    CREATE TABLE IF NOT EXISTS analytics_snapshots (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(), organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
      snapshot_date date NOT NULL DEFAULT current_date, metric text NOT NULL, value_numeric numeric NOT NULL DEFAULT 0,
      dimensions jsonb NOT NULL DEFAULT '{}', created_at timestamptz NOT NULL DEFAULT now(),
      UNIQUE(organization_id,snapshot_date,metric,dimensions)
    );
    CREATE INDEX IF NOT EXISTS analytics_snapshots_idx ON analytics_snapshots(organization_id,snapshot_date DESC,metric);
    CREATE TABLE IF NOT EXISTS ai_usage_events (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(), organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
      user_id uuid REFERENCES users(id) ON DELETE SET NULL, patient_id uuid REFERENCES patients(id) ON DELETE SET NULL,
      purpose text NOT NULL, model text NOT NULL, model_version text, request_id text, input_tokens integer, output_tokens integer,
      latency_ms integer, status text NOT NULL DEFAULT 'completed', safety_flags jsonb NOT NULL DEFAULT '[]', created_at timestamptz NOT NULL DEFAULT now()
    );
    CREATE INDEX IF NOT EXISTS ai_usage_org_created_idx ON ai_usage_events(organization_id,created_at DESC);
    CREATE TABLE IF NOT EXISTS ai_prompt_versions (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(), organization_id uuid REFERENCES organizations(id) ON DELETE CASCADE,
      key text NOT NULL, version text NOT NULL, prompt text NOT NULL, status text NOT NULL DEFAULT 'active', created_at timestamptz NOT NULL DEFAULT now(),
      UNIQUE(organization_id,key,version)
    );
    CREATE TABLE IF NOT EXISTS ai_knowledge_sources (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(), organization_id uuid REFERENCES organizations(id) ON DELETE CASCADE,
      title text NOT NULL, jurisdiction text, specialty text, source_url text, version text, effective_from date, effective_to date,
      content text NOT NULL, status text NOT NULL DEFAULT 'approved', created_at timestamptz NOT NULL DEFAULT now()
    );
    CREATE INDEX IF NOT EXISTS ai_knowledge_lookup_idx ON ai_knowledge_sources(organization_id,status,jurisdiction,specialty);
    CREATE TABLE IF NOT EXISTS ai_work_runs (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(), organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
      user_id uuid REFERENCES users(id) ON DELETE SET NULL, patient_id uuid REFERENCES patients(id) ON DELETE SET NULL,
      run_id text NOT NULL UNIQUE, purpose text NOT NULL, mode text NOT NULL DEFAULT 'intelligence', model text NOT NULL, status text NOT NULL DEFAULT 'completed',
      question text NOT NULL, tools_used jsonb NOT NULL DEFAULT '[]', calculations jsonb NOT NULL DEFAULT '[]', evidence_count integer NOT NULL DEFAULT 0,
      latency_ms integer, confidence text, safety_flags jsonb NOT NULL DEFAULT '[]', result_summary jsonb NOT NULL DEFAULT '{}', created_at timestamptz NOT NULL DEFAULT now()
    );
    CREATE INDEX IF NOT EXISTS ai_work_runs_org_created_idx ON ai_work_runs(organization_id,created_at DESC);
    CREATE INDEX IF NOT EXISTS ai_work_runs_patient_idx ON ai_work_runs(organization_id,patient_id,created_at DESC);
  `);
}

// --- V14 Integration Completion: patient flow, closed-loop referrals, safety, access and operational intelligence ---
async function ensureV14Schema(){
  if(!pool)return;
  await pool.query(`
    CREATE TABLE IF NOT EXISTS clinical_workflow_events (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(), organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
      patient_id uuid REFERENCES patients(id) ON DELETE SET NULL, encounter_id uuid REFERENCES encounters(id) ON DELETE SET NULL,
      event_type text NOT NULL, from_state text, to_state text, payload jsonb NOT NULL DEFAULT '{}',
      actor_id uuid REFERENCES users(id) ON DELETE SET NULL, created_at timestamptz NOT NULL DEFAULT now()
    );
    ALTER TABLE clinical_workflow_events ADD COLUMN IF NOT EXISTS patient_id uuid REFERENCES patients(id) ON DELETE SET NULL;
    ALTER TABLE clinical_workflow_events ADD COLUMN IF NOT EXISTS encounter_id uuid REFERENCES encounters(id) ON DELETE SET NULL;
    ALTER TABLE clinical_workflow_events ADD COLUMN IF NOT EXISTS from_state text;
    ALTER TABLE clinical_workflow_events ADD COLUMN IF NOT EXISTS to_state text;
    ALTER TABLE clinical_workflow_events ADD COLUMN IF NOT EXISTS payload jsonb NOT NULL DEFAULT '{}';
    ALTER TABLE clinical_workflow_events ADD COLUMN IF NOT EXISTS actor_id uuid REFERENCES users(id) ON DELETE SET NULL;
    ALTER TABLE clinical_workflow_events ADD COLUMN IF NOT EXISTS source_event_id uuid;
    CREATE UNIQUE INDEX IF NOT EXISTS clinical_workflow_source_event_uidx ON clinical_workflow_events(source_event_id) WHERE source_event_id IS NOT NULL;
    ALTER TABLE clinical_workflow_events ADD COLUMN IF NOT EXISTS created_at timestamptz NOT NULL DEFAULT now();
    CREATE INDEX IF NOT EXISTS clinical_workflow_patient_idx ON clinical_workflow_events(organization_id,patient_id,created_at DESC);
    CREATE TABLE IF NOT EXISTS patient_consents (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(), organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
      patient_id uuid NOT NULL REFERENCES patients(id) ON DELETE CASCADE, consent_type text NOT NULL, status text NOT NULL DEFAULT 'active',
      scope jsonb NOT NULL DEFAULT '{}', granted_at timestamptz NOT NULL DEFAULT now(), expires_at timestamptz,
      recorded_by uuid REFERENCES users(id) ON DELETE SET NULL
    );
    CREATE INDEX IF NOT EXISTS patient_consents_idx ON patient_consents(organization_id,patient_id,consent_type,status);
    CREATE TABLE IF NOT EXISTS security_events (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(), organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
      user_id uuid REFERENCES users(id) ON DELETE SET NULL, patient_id uuid REFERENCES patients(id) ON DELETE SET NULL,
      event_type text NOT NULL, severity text NOT NULL DEFAULT 'info', reason text, metadata jsonb NOT NULL DEFAULT '{}', created_at timestamptz NOT NULL DEFAULT now()
    );
    CREATE INDEX IF NOT EXISTS security_events_idx ON security_events(organization_id,created_at DESC);
    CREATE TABLE IF NOT EXISTS ai_evaluations (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(), organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
      patient_id uuid REFERENCES patients(id) ON DELETE SET NULL, model_version text, use_case text NOT NULL,
      input_summary text, output_summary text, expected_result text, reviewer_id uuid REFERENCES users(id) ON DELETE SET NULL,
      verdict text NOT NULL DEFAULT 'pending', safety_flags jsonb NOT NULL DEFAULT '[]', created_at timestamptz NOT NULL DEFAULT now(), reviewed_at timestamptz
    );
    CREATE TABLE IF NOT EXISTS offline_devices (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(), organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
      device_id text NOT NULL, user_id uuid REFERENCES users(id) ON DELETE SET NULL, label text, status text NOT NULL DEFAULT 'active',
      last_sync_at timestamptz, metadata jsonb NOT NULL DEFAULT '{}', created_at timestamptz NOT NULL DEFAULT now(),
      UNIQUE(organization_id,device_id)
    );
    CREATE TABLE IF NOT EXISTS referral_network_matches (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(), organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
      referral_id uuid REFERENCES referrals(id) ON DELETE CASCADE, from_facility_id uuid REFERENCES facilities(id) ON DELETE SET NULL,
      to_facility_id uuid REFERENCES facilities(id) ON DELETE SET NULL, service_code text, availability_status text NOT NULL DEFAULT 'unknown',
      capacity_snapshot jsonb NOT NULL DEFAULT '{}', score numeric, rationale jsonb NOT NULL DEFAULT '{}', created_at timestamptz NOT NULL DEFAULT now()
    );
    CREATE INDEX IF NOT EXISTS referral_network_matches_idx ON referral_network_matches(organization_id,referral_id,created_at DESC);
    CREATE TABLE IF NOT EXISTS portal_messages (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(), organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
      patient_id uuid NOT NULL REFERENCES patients(id) ON DELETE CASCADE, direction text NOT NULL, channel text NOT NULL DEFAULT 'portal',
      subject text, body text NOT NULL, status text NOT NULL DEFAULT 'unread', sent_by uuid REFERENCES users(id) ON DELETE SET NULL,
      created_at timestamptz NOT NULL DEFAULT now(), read_at timestamptz
    );
    CREATE INDEX IF NOT EXISTS portal_messages_patient_idx ON portal_messages(organization_id,patient_id,created_at DESC);
    CREATE TABLE IF NOT EXISTS care_tasks (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(), organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
      patient_id uuid REFERENCES patients(id) ON DELETE SET NULL, encounter_id uuid REFERENCES encounters(id) ON DELETE SET NULL,
      task_type text NOT NULL, title text NOT NULL, priority text NOT NULL DEFAULT 'normal', status text NOT NULL DEFAULT 'open',
      due_at timestamptz, assigned_to uuid REFERENCES users(id) ON DELETE SET NULL, payload jsonb NOT NULL DEFAULT '{}',
      created_at timestamptz NOT NULL DEFAULT now(), completed_at timestamptz
    );
    CREATE INDEX IF NOT EXISTS care_tasks_idx ON care_tasks(organization_id,status,due_at);
  `);
}
// --- ClinAI interaction feedback (additive, non-destructive) ---
async function ensureAIInteractionSchema(){
  if(!pool)return;
  await pool.query(`
    CREATE TABLE IF NOT EXISTS ai_feedback (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(), organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
      user_id uuid REFERENCES users(id) ON DELETE SET NULL, patient_id uuid REFERENCES patients(id) ON DELETE SET NULL,
      run_id text NOT NULL, rating text NOT NULL, reason text, comment text, corrected_answer text, created_at timestamptz NOT NULL DEFAULT now()
    );
    CREATE INDEX IF NOT EXISTS ai_feedback_org_created_idx ON ai_feedback(organization_id,created_at DESC);
    CREATE INDEX IF NOT EXISTS ai_feedback_run_idx ON ai_feedback(run_id,created_at DESC);
    CREATE TABLE IF NOT EXISTS public_feedback (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(), type text NOT NULL, rating text, reason text, message text NOT NULL,
      page text, anonymous boolean NOT NULL DEFAULT true, created_at timestamptz NOT NULL DEFAULT now()
    );
    CREATE INDEX IF NOT EXISTS public_feedback_created_idx ON public_feedback(created_at DESC);
    CREATE TABLE IF NOT EXISTS public_ai_runs (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(), run_id text NOT NULL UNIQUE, mode text NOT NULL, language text NOT NULL DEFAULT 'English',
      capability text, input_length integer NOT NULL DEFAULT 0, created_at timestamptz NOT NULL DEFAULT now()
    );
    CREATE INDEX IF NOT EXISTS public_ai_runs_created_idx ON public_ai_runs(created_at DESC);
    CREATE TABLE IF NOT EXISTS public_ai_feedback (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(), run_id text NOT NULL, rating text NOT NULL, reason text, comment text,
      created_at timestamptz NOT NULL DEFAULT now()
    );
    CREATE INDEX IF NOT EXISTS public_ai_feedback_run_idx ON public_ai_feedback(run_id,created_at DESC);
  `);
}

// --- ClinAI Intelligence ---
registerPublicAI({ app, pool, dbOrganizationId, dbUserId });
registerAI({ app, pool, dbOrganizationId, dbUserId });

await ensureV15Schema();
await ensureV14Schema();
await ensureAIInteractionSchema();

if (pool) startClinicalEventWorker(pool);

function workflowEvent(client:any,req:any,eventType:string,payload:any,fromState?:string,toState?:string){
  return client.query(`INSERT INTO clinical_workflow_events(organization_id,patient_id,encounter_id,event_type,from_state,to_state,payload,actor_id) VALUES($1,$2,$3,$4,$5,$6,$7,$8)`,[dbOrganizationId(req),payload?.patientId||null,payload?.encounterId||null,eventType,fromState||null,toState||null,JSON.stringify(payload||{}),dbUserId(req)]);
}

app.get('/api/patients/:id/timeline',async(req:any,reply)=>{
  if(!pool)return reply.send({data:[]});
  const o=dbOrganizationId(req),p=req.params.id;
  const q=await pool.query(`
    SELECT id,started_at AS at,'visit' AS kind,concat('Care visit · ',COALESCE(type,'visit')) AS title,status,patient_id AS "patientId" FROM encounters WHERE organization_id=$1 AND patient_id=$2
    UNION ALL SELECT o.id,o.observed_at,'observation',COALESCE(o.display,o.code),COALESCE(o.value_text,o.value_numeric::text),o.patient_id FROM observations o JOIN patients op ON op.id=o.patient_id WHERE op.organization_id=$1 AND o.patient_id=$2
    UNION ALL SELECT d.id,e.started_at,'diagnosis',COALESCE(d.display,d.code),d.status,d.patient_id FROM diagnoses d JOIN patients dp ON dp.id=d.patient_id LEFT JOIN encounters e ON e.id=d.encounter_id WHERE dp.organization_id=$1 AND d.patient_id=$2
    UNION ALL SELECT co.id,co.created_at,'order',COALESCE(co.details->>'description',co.order_type),co.status,co.patient_id FROM clinical_orders co JOIN patients cop ON cop.id=co.patient_id WHERE cop.organization_id=$1 AND co.patient_id=$2
    UNION ALL SELECT mo.id,e.started_at,'medication',m.name,mo.status,mo.patient_id FROM medication_orders mo JOIN medications m ON m.id=mo.medication_id JOIN patients p ON p.id=mo.patient_id LEFT JOIN encounters e ON e.id=mo.encounter_id WHERE p.organization_id=$1 AND mo.patient_id=$2
    UNION ALL SELECT r.id,r.created_at,'referral',COALESCE(r.destination,'Referral'),r.status,r.patient_id FROM referrals r JOIN patients rp ON rp.id=r.patient_id WHERE rp.organization_id=$1 AND r.patient_id=$2
    UNION ALL SELECT mr.id,mr.created_at,'follow-up',COALESCE(mr.payload->>'reason','Follow-up'),mr.status,$2::uuid FROM module_records mr WHERE mr.organization_id=$1 AND mr.module IN ('follow-up','followup') AND COALESCE(mr.payload->>'coverageVersion','') <> '025' AND COALESCE(mr.payload->>'recordPurpose','') <> 'connected synthetic testing' AND mr.payload->>'patientId'=$2
    UNION ALL SELECT id,created_at,'workflow',event_type,COALESCE(to_state,from_state,'recorded'),patient_id FROM clinical_workflow_events WHERE organization_id=$1 AND patient_id=$2
    ORDER BY at DESC LIMIT 150`,[o,p]);
  return {data:q.rows};
});

app.get('/api/patients/:id/flow',async(req:any)=>{
  if(!pool)return {data:{}};
  const o=dbOrganizationId(req),p=req.params.id;
  const [appt,queue,triage,enc,orders,ref,adm,follow]=await Promise.all([
    pool.query(`SELECT id,status,start_at AS "startAt" FROM appointments WHERE organization_id=$1 AND patient_id=$2 ORDER BY start_at DESC LIMIT 5`,[o,p]),
    pool.query(`SELECT qe.id,qe.status,qe.priority,qe.joined_at AS "createdAt" FROM queue_entries qe JOIN queues q ON q.id=qe.queue_id WHERE q.organization_id=$1 AND qe.patient_id=$2 ORDER BY qe.joined_at DESC LIMIT 5`,[o,p]),
    pool.query(`SELECT id,created_at AS "createdAt",acuity,chief_complaint AS "chiefComplaint" FROM triage_assessments WHERE organization_id=$1 AND patient_id=$2 ORDER BY created_at DESC LIMIT 5`,[o,p]),
    pool.query(`SELECT id,status,started_at AS "startedAt" FROM encounters WHERE organization_id=$1 AND patient_id=$2 ORDER BY started_at DESC LIMIT 5`,[o,p]),
    pool.query(`SELECT co.id,co.status,co.order_type AS "orderType",co.created_at AS "createdAt" FROM clinical_orders co JOIN patients cp ON cp.id=co.patient_id WHERE cp.organization_id=$1 AND co.patient_id=$2 ORDER BY co.created_at DESC LIMIT 10`,[o,p]),
    pool.query(`SELECT r.id,r.status,r.reason,r.destination,r.created_at AS "createdAt" FROM referrals r JOIN patients rp ON rp.id=r.patient_id WHERE rp.organization_id=$1 AND r.patient_id=$2 ORDER BY r.created_at DESC LIMIT 10`,[o,p]),
    pool.query(`SELECT id,status,admitted_at AS "admittedAt",discharged_at AS "dischargedAt" FROM admissions WHERE organization_id=$1 AND patient_id=$2 ORDER BY admitted_at DESC LIMIT 5`,[o,p]),
    pool.query(`SELECT id,status,due_at AS "dueAt",payload FROM module_records WHERE organization_id=$1 AND module='follow-up' AND COALESCE(payload->>'coverageVersion','') <> '025' AND COALESCE(payload->>'recordPurpose','') <> 'connected synthetic testing' AND payload->>'patientId'=$2 ORDER BY created_at DESC LIMIT 10`,[o,p])
  ]);
  return {data:{appointments:appt.rows,queue:queue.rows,triage:triage.rows,encounters:enc.rows,orders:orders.rows,referrals:ref.rows,admissions:adm.rows,followUp:follow.rows}};
});

app.post('/api/patients/duplicate-check',async(req:any,reply)=>{
  if(!pool)return reply.send({data:[]});
  const b=z.object({firstName:z.string().optional(),lastName:z.string().optional(),dateOfBirth:z.string().optional(),phone:z.string().optional()}).parse(req.body||{});
  const clauses:string[]=[]; const vals:any[]=[dbOrganizationId(req)]; let i=2;
  if(b.phone){clauses.push(`phone=$${i++}`);vals.push(b.phone)}
  if(b.dateOfBirth){clauses.push(`date_of_birth=$${i++}`);vals.push(b.dateOfBirth)}
  if(b.firstName&&b.lastName){clauses.push(`(lower(first_name)=lower($${i++}) AND lower(last_name)=lower($${i++}))`);vals.push(b.firstName,b.lastName)}
  if(!clauses.length)return {data:[]};
  const r=await pool.query(`SELECT id,patient_number AS "patientNumber",first_name AS "firstName",last_name AS "lastName",date_of_birth AS "dateOfBirth",phone FROM patients WHERE organization_id=$1 AND (${clauses.join(' OR ')}) LIMIT 20`,vals);
  return {data:r.rows};
});

app.post('/api/patients/:id/merge',async(req:any,reply)=>{
  if(!pool)return reply.code(501).send({error:'PostgreSQL required'});
  const b=z.object({duplicatePatientId:z.string().uuid(),reason:z.string().min(3)}).parse(req.body||{}); const client=await pool.connect();
  try{
    await client.query('BEGIN'); const o=dbOrganizationId(req); const primary=req.params.id; const duplicate=b.duplicatePatientId;
    if(primary===duplicate)return reply.code(400).send({error:'A patient cannot be merged with itself'});
    const people=await client.query(`SELECT id,patient_number AS "patientNumber" FROM patients WHERE organization_id=$1 AND id=ANY($2::uuid[])`,[o,[primary,duplicate]]);
    if(people.rowCount!==2){await client.query('ROLLBACK');return reply.code(404).send({error:'Patient not found'});}
    const alias=people.rows.find((x:any)=>x.id===duplicate);
    await client.query(`INSERT INTO patient_aliases(organization_id,patient_id,alias_patient_id,alias_patient_number,reason,merged_by) VALUES($1,$2,$3,$4,$5,$6)`,[o,primary,duplicate,alias.patientNumber,b.reason,dbUserId(req)]);
    const tables=await client.query(`SELECT table_name FROM information_schema.columns WHERE table_schema='public' AND column_name='patient_id' AND table_name NOT IN ('patients','patient_aliases','audit_logs','security_events','clinical_workflow_events') GROUP BY table_name ORDER BY table_name`);
    const moved:string[]=[];
    for(const r of tables.rows){const t=r.table_name; await client.query('SAVEPOINT merge_row'); try{const q=await client.query(`UPDATE "${t.replace(/"/g,'""')}" SET patient_id=$1 WHERE patient_id=$2`,[primary,duplicate]); if(q.rowCount)moved.push(`${t}:${q.rowCount}`); await client.query('RELEASE SAVEPOINT merge_row');}catch{await client.query('ROLLBACK TO SAVEPOINT merge_row');await client.query('RELEASE SAVEPOINT merge_row');}}
    await client.query(`UPDATE patients SET status='merged',updated_at=now() WHERE id=$1 AND organization_id=$2`,[duplicate,o]);
    await workflowEvent(client,req,'patient.merge',{patientId:primary,duplicatePatientId:duplicate,reason:b.reason,moved});
    await dbAudit(client,req,'MERGE','patient',primary,{duplicatePatientId:duplicate,reason:b.reason,moved});
    await client.query('COMMIT'); return {data:{primaryPatientId:primary,mergedPatientId:duplicate,status:'merged',moved}};
  }catch(e){await client.query('ROLLBACK');throw e}finally{client.release()}
});

app.post('/api/check-in/walk-in',async(req:any,reply)=>{
  if(!pool)return reply.code(501).send({error:'PostgreSQL required'}); const b=z.object({patientId:z.string().uuid(),priority:z.enum(['routine','urgent','emergency','stat']).default('routine'),service:z.string().default('general')}).parse(req.body||{});
  const client=await pool.connect();try{await client.query('BEGIN');const q=await client.query(`SELECT id FROM queues WHERE organization_id=$1 AND code='GENERAL' LIMIT 1`,[dbOrganizationId(req)]);const queue=q.rowCount?q.rows[0].id:(await client.query(`INSERT INTO queues(organization_id,code,name) VALUES($1,'GENERAL','General Queue') RETURNING id`,[dbOrganizationId(req)])).rows[0].id;const qe=await client.query(`INSERT INTO queue_entries(queue_id,patient_id,status,priority,joined_at) VALUES($1,$2,'waiting',$3,now()) RETURNING id,status,priority,joined_at AS "createdAt"`,[queue,b.patientId,b.priority]);await workflowEvent(client,req,'patient.checked_in',{patientId:b.patientId});await dbAudit(client,req,'CHECK_IN','patient',b.patientId,{priority:b.priority,walkIn:true,queueId:queue});await client.query('COMMIT');return reply.code(201).send({data:qe.rows[0]})}catch(e){await client.query('ROLLBACK');throw e}finally{client.release()}
});

app.post('/api/triage/:id/route',async(req:any,reply)=>{if(!pool)return reply.code(501).send({error:'PostgreSQL required'});const b=z.object({destination:z.enum(['emergency','urgent-care','doctor','observation','other']),reason:z.string().optional()}).parse(req.body||{});const client=await pool.connect();try{await client.query('BEGIN');const r=await client.query(`SELECT patient_id AS "patientId",encounter_id AS "encounterId",acuity FROM triage_assessments WHERE id=$1 AND organization_id=$2`,[req.params.id,dbOrganizationId(req)]);if(!r.rowCount){await client.query('ROLLBACK');return reply.code(404).send({error:'Triage assessment not found'})}await workflowEvent(client,req,'triage.routed',{patientId:r.rows[0].patientId,encounterId:r.rows[0].encounterId,destination:b.destination,reason:b.reason},r.rows[0].acuity,b.destination);await dbAudit(client,req,'TRIAGE_ROUTE','patient',r.rows[0].patientId,b);await client.query('COMMIT');return {data:{patientId:r.rows[0].patientId,destination:b.destination}}}catch(e){await client.query('ROLLBACK');throw e}finally{client.release()}});

app.get('/api/laboratory/workflow/:patientId',async(req:any)=>{if(!pool)return {data:[]};const r=await pool.query(`SELECT co.id,co.status,co.order_type AS "orderType",co.details,co.created_at AS "createdAt" FROM clinical_orders co JOIN patients p ON p.id=co.patient_id WHERE p.organization_id=$1 AND co.patient_id=$2 AND co.order_type='laboratory' ORDER BY co.created_at DESC`,[dbOrganizationId(req),req.params.patientId]);return {data:r.rows}});
app.post('/api/laboratory/specimens/:id/status',async(req:any,reply)=>{if(!pool)return reply.code(501).send({error:'PostgreSQL required'});const b=z.object({status:z.enum(['collected','received','rejected','processing','preliminary','verified','released']),reason:z.string().optional()}).parse(req.body||{});const client=await pool.connect();try{await client.query('BEGIN');const r=await client.query(`UPDATE specimens s SET status=$1 WHERE s.id=$2 AND EXISTS (SELECT 1 FROM patients p WHERE p.id=s.patient_id AND p.organization_id=$3) RETURNING s.id,s.patient_id AS "patientId",s.status`,[b.status,req.params.id,dbOrganizationId(req)]);if(!r.rowCount){await client.query('ROLLBACK');return reply.code(404).send({error:'Specimen not found'})}await workflowEvent(client,req,'laboratory.specimen.status',{patientId:null,specimenId:req.params.id,status:b.status,reason:b.reason});await client.query('COMMIT');return {data:r.rows[0]}}catch(e){await client.query('ROLLBACK');throw e}finally{client.release()}});

app.post('/api/imaging/studies',async(req:any,reply)=>{if(!pool)return reply.code(501).send({error:'PostgreSQL required'});const b=z.object({patientId:z.string().uuid(),encounterId:z.string().uuid().optional(),orderId:z.string().uuid().optional(),studyName:z.string(),modality:z.string().optional(),bodySite:z.string().optional(),priority:z.string().default('routine')}).parse(req.body||{});const client=await pool.connect();try{await client.query('BEGIN');const r=await client.query(`INSERT INTO imaging_studies(organization_id,patient_id,encounter_id,order_id,study_name,modality,body_site,priority,created_by) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING *`,[dbOrganizationId(req),b.patientId,b.encounterId||null,b.orderId||null,b.studyName,b.modality||null,b.bodySite||null,b.priority,dbUserId(req)]);await queueEvent(client,req,'imaging.study.created',{studyId:r.rows[0].id,patientId:b.patientId,encounterId:b.encounterId||null,orderId:b.orderId||null,status:r.rows[0].status||'scheduled',modality:b.modality||null});await client.query('COMMIT');return reply.code(201).send(r.rows[0]);}catch(e){await client.query('ROLLBACK');throw e}finally{client.release()}});
app.post('/api/imaging/studies/:id/status',async(req:any,reply)=>{if(!pool)return reply.code(501).send({error:'PostgreSQL required'});const b=z.object({status:z.enum(['scheduled','performed','reported','verified','released','cancelled']),report:z.string().optional(),critical:z.boolean().optional()}).parse(req.body||{});const client=await pool.connect();try{await client.query('BEGIN');const r=await client.query(`UPDATE imaging_studies SET status=$1,report=COALESCE($2,report),critical=COALESCE($3,critical),performed_at=CASE WHEN $1='performed' THEN now() ELSE performed_at END,report_verified_at=CASE WHEN $1='verified' THEN now() ELSE report_verified_at END,report_released_at=CASE WHEN $1='released' THEN now() ELSE report_released_at END,updated_at=now() WHERE id=$4 AND organization_id=$5 RETURNING *`,[b.status,b.report??null,b.critical??null,req.params.id,dbOrganizationId(req)]);if(!r.rowCount){await client.query('ROLLBACK');return reply.code(404).send({error:'Study not found'});}const x=r.rows[0];await queueEvent(client,req,'imaging.study.status',{studyId:x.id,patientId:x.patient_id,encounterId:x.encounter_id||null,orderId:x.order_id||null,status:x.status,critical:Boolean(x.critical)});await client.query('COMMIT');return {data:x};}catch(e){await client.query('ROLLBACK');throw e}finally{client.release()}});

app.post('/api/beds/:id/assign',async(req:any,reply)=>{if(!pool)return reply.code(501).send({error:'PostgreSQL required'});const b=z.object({patientId:z.string().uuid(),admissionId:z.string().uuid().optional()}).parse(req.body||{});const client=await pool.connect();try{await client.query('BEGIN');const r=await client.query(`UPDATE facility_beds SET status='occupied',patient_id=$1,admission_id=$2,observed_at=now() WHERE id=$3 AND organization_id=$4 AND status IN ('available','reserved') RETURNING *`,[b.patientId,b.admissionId||null,req.params.id,dbOrganizationId(req)]);if(!r.rowCount){await client.query('ROLLBACK');return reply.code(409).send({error:'Bed is not available'})}await workflowEvent(client,req,'bed.assigned',{patientId:b.patientId,admissionId:b.admissionId||null,bedId:req.params.id});await queueEvent(client,req,'bed.assigned',{patientId:b.patientId,admissionId:b.admissionId||null,bedId:req.params.id,status:'occupied'});await client.query('COMMIT');return {data:r.rows[0]}}catch(e){await client.query('ROLLBACK');throw e}finally{client.release()}});
app.post('/api/beds/:id/release',async(req:any,reply)=>{if(!pool)return reply.code(501).send({error:'PostgreSQL required'});const client=await pool.connect();try{await client.query('BEGIN');const r=await client.query(`UPDATE facility_beds SET status='cleaning',patient_id=NULL,admission_id=NULL,observed_at=now() WHERE id=$1 AND organization_id=$2 RETURNING *`,[req.params.id,dbOrganizationId(req)]);if(!r.rowCount){await client.query('ROLLBACK');return reply.code(404).send({error:'Bed not found'});}const x=r.rows[0];await queueEvent(client,req,'bed.released',{bedId:x.id,patientId:null,admissionId:x.admission_id||null,status:x.status});await client.query('COMMIT');return {data:x};}catch(e){await client.query('ROLLBACK');throw e}finally{client.release()}});

app.post('/api/referral-transfers/:id/status',async(req:any,reply)=>{if(!pool)return reply.code(501).send({error:'PostgreSQL required'});const b=z.object({status:z.enum(['requested','accepted','declined','ready','departed','arrived','completed','cancelled']),outcome:z.string().optional(),handover:z.record(z.any()).optional(),transport:z.record(z.any()).optional()}).parse(req.body||{});const client=await pool.connect();try{await client.query('BEGIN');const r=await client.query(`UPDATE referral_transfers SET status=$1,outcome=COALESCE($2,outcome),handover=COALESCE($3,handover),transport=COALESCE($4,transport),accepted_at=CASE WHEN $1='accepted' THEN now() ELSE accepted_at END,departed_at=CASE WHEN $1='departed' THEN now() ELSE departed_at END,arrived_at=CASE WHEN $1='arrived' THEN now() ELSE arrived_at END,updated_at=now() WHERE id=$5 AND organization_id=$6 RETURNING *`,[b.status,b.outcome??null,b.handover?JSON.stringify(b.handover):null,b.transport?JSON.stringify(b.transport):null,req.params.id,dbOrganizationId(req)]);if(!r.rowCount){await client.query('ROLLBACK');return reply.code(404).send({error:'Transfer not found'})}await workflowEvent(client,req,'referral.transfer.status',{referralId:r.rows[0].referral_id,status:b.status});await queueEvent(client,req,b.status==='completed'?CLINICAL_EVENT_TYPES.REFERRAL_COMPLETED:'referral.transfer.status',{referralId:r.rows[0].referral_id,patientId:r.rows[0].patient_id||null,status:b.status,transferId:r.rows[0].id});await client.query('COMMIT');return {data:r.rows[0]}}catch(e){await client.query('ROLLBACK');throw e}finally{client.release()}});
app.get('/api/referrals/:id/network',async(req:any)=>{if(!pool)return {data:[]};const r=await pool.query(`SELECT m.*,f.name AS "facilityName" FROM referral_network_matches m LEFT JOIN facilities f ON f.id=m.to_facility_id WHERE m.organization_id=$1 AND m.referral_id=$2 ORDER BY m.score DESC NULLS LAST, m.created_at DESC`,[dbOrganizationId(req),req.params.id]);return {data:r.rows}});

app.post('/api/portal/messages',async(req:any,reply)=>{if(!pool)return reply.code(501).send({error:'PostgreSQL required'});const b=z.object({patientId:z.string().uuid(),direction:z.enum(['inbound','outbound']).default('outbound'),channel:z.string().default('portal'),subject:z.string().optional(),body:z.string().min(1)}).parse(req.body||{});const r=await pool.query(`INSERT INTO portal_messages(organization_id,patient_id,direction,channel,subject,body,sent_by) VALUES($1,$2,$3,$4,$5,$6,$7) RETURNING *`,[dbOrganizationId(req),b.patientId,b.direction,b.channel,b.subject||null,b.body,dbUserId(req)]);return reply.code(201).send(r.rows[0])});
app.get('/api/portal/messages/:patientId',async(req:any)=>{if(!pool)return {data:[]};const r=await pool.query(`SELECT * FROM portal_messages WHERE organization_id=$1 AND patient_id=$2 ORDER BY created_at DESC`,[dbOrganizationId(req),req.params.patientId]);return {data:r.rows}});

app.post('/api/consents',async(req:any,reply)=>{if(!pool)return reply.code(501).send({error:'PostgreSQL required'});const b=z.object({patientId:z.string().uuid(),consentType:z.string(),status:z.enum(['active','withdrawn','expired']).default('active'),scope:z.record(z.any()).default({}),expiresAt:z.string().optional()}).parse(req.body||{});const r=await pool.query(`INSERT INTO patient_consents(organization_id,patient_id,consent_type,status,scope,expires_at,recorded_by) VALUES($1,$2,$3,$4,$5,$6,$7) RETURNING *`,[dbOrganizationId(req),b.patientId,b.consentType,b.status,JSON.stringify(b.scope),b.expiresAt||null,dbUserId(req)]);return reply.code(201).send(r.rows[0])});
app.get('/api/consents/:patientId',async(req:any)=>{if(!pool)return {data:[]};const r=await pool.query(`SELECT * FROM patient_consents WHERE organization_id=$1 AND patient_id=$2 ORDER BY granted_at DESC`,[dbOrganizationId(req),req.params.patientId]);return {data:r.rows}});

app.get('/api/tasks/care',async(req:any)=>{if(!pool)return {data:[]};const r=await pool.query(`SELECT * FROM care_tasks WHERE organization_id=$1 AND status<>'completed' ORDER BY due_at NULLS LAST,created_at DESC LIMIT 100`,[dbOrganizationId(req)]);return {data:r.rows}});
app.post('/api/tasks/care',async(req:any,reply)=>{if(!pool)return reply.code(501).send({error:'PostgreSQL required'});const b=z.object({patientId:z.string().uuid().optional(),encounterId:z.string().uuid().optional(),taskType:z.string(),title:z.string(),priority:z.string().default('normal'),dueAt:z.string().optional(),assignedTo:z.string().uuid().optional(),payload:z.record(z.any()).default({})}).parse(req.body||{});const client=await pool.connect();try{await client.query('BEGIN');const r=await client.query(`INSERT INTO care_tasks(organization_id,patient_id,encounter_id,task_type,title,priority,due_at,assigned_to,payload) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING *`,[dbOrganizationId(req),b.patientId||null,b.encounterId||null,b.taskType,b.title,b.priority,b.dueAt||null,b.assignedTo||null,JSON.stringify(b.payload)]);await queueEvent(client,req,CLINICAL_EVENT_TYPES.TASK_CREATED,{taskId:r.rows[0].id,patientId:b.patientId||null,encounterId:b.encounterId||null,taskType:b.taskType,priority:b.priority});await client.query('COMMIT');return reply.code(201).send(r.rows[0]);}catch(e){await client.query('ROLLBACK');throw e}finally{client.release()}});

app.get('/api/operations/summary',async(req:any)=>{if(!pool)return {data:{}};const o=dbOrganizationId(req);const [patients,encounters,queue,beds,refs,tasks]=await Promise.all([pool.query(`SELECT count(*)::int n FROM patients WHERE organization_id=$1`,[o]),pool.query(`SELECT count(*)::int n FROM encounters WHERE organization_id=$1 AND status IN ('in-progress','active')`,[o]),pool.query(`SELECT count(*)::int n FROM queue_entries qe JOIN queues q ON q.id=qe.queue_id WHERE q.organization_id=$1 AND qe.status NOT IN ('completed','cancelled','no-show')`,[o]),pool.query(`SELECT count(*) FILTER (WHERE status='available')::int available,count(*) FILTER (WHERE status='occupied')::int occupied FROM facility_beds WHERE organization_id=$1`,[o]),pool.query(`SELECT count(*) FILTER (WHERE status NOT IN ('completed','cancelled'))::int open FROM referral_transfers WHERE organization_id=$1`,[o]),pool.query(`SELECT count(*) FILTER (WHERE status='open')::int open FROM care_tasks WHERE organization_id=$1`,[o])]);return {data:{patients:patients.rows[0].n,activeEncounters:encounters.rows[0].n,queue:queue.rows[0].n,beds:beds.rows[0],referrals:refs.rows[0].open,tasks:tasks.rows[0].open}}});

await 
app.post('/api/medication-reconciliation',async(req:any,reply)=>{if(!pool)return reply.code(501).send({error:'PostgreSQL required'});const b=z.object({patientId:z.string().uuid(),encounterId:z.string().uuid().optional(),medicines:z.array(z.record(z.any())).default([]),discrepancies:z.array(z.record(z.any())).default([]),source:z.string().default('clinical-review')}).parse(req.body||{});const r=await pool.query(`INSERT INTO medication_reconciliation(organization_id,patient_id,encounter_id,source,status,medicines,discrepancies,created_by) VALUES($1,$2,$3,$4,'in-review',$5,$6,$7) RETURNING *`,[dbOrganizationId(req),b.patientId,b.encounterId||null,b.source,JSON.stringify(b.medicines),JSON.stringify(b.discrepancies),dbUserId(req)]);return reply.code(201).send(r.rows[0])});
app.post('/api/medication-reconciliation/:id/resolve',async(req:any,reply)=>{if(!pool)return reply.code(501).send({error:'PostgreSQL required'});const b=z.object({resolvedCount:z.number().int().min(0),status:z.enum(['in-review','resolved']).default('resolved')}).parse(req.body||{});const r=await pool.query(`UPDATE medication_reconciliation SET resolved_count=$1,status=$2,reviewed_by=$3,reviewed_at=now(),updated_at=now() WHERE id=$4 AND organization_id=$5 RETURNING *`,[b.resolvedCount,b.status,dbUserId(req),req.params.id,dbOrganizationId(req)]);if(!r.rowCount)return reply.code(404).send({error:'Medication review not found'});return {data:r.rows[0]}});
app.get('/api/medication-reconciliation/:patientId',async(req:any)=>{if(!pool)return {data:[]};const r=await pool.query(`SELECT * FROM medication_reconciliation WHERE organization_id=$1 AND patient_id=$2 ORDER BY created_at DESC`,[dbOrganizationId(req),req.params.patientId]);return {data:r.rows}});


// --- V26 module contract repair: collection endpoints for existing domain data ---
// These endpoints expose existing domain tables to the module workspace. They do not
// replace the specialized patient-scoped routes and they do not create parallel data stores.
app.get('/api/referral-transfers',async(req:any)=>{if(!pool)return {data:[]};const r=await pool.query(`SELECT * FROM referral_transfers WHERE organization_id=$1 ORDER BY updated_at DESC NULLS LAST LIMIT 500`,[dbOrganizationId(req)]);return {data:r.rows,count:r.rowCount};});
app.get('/api/care-tasks',async(req:any)=>{if(!pool)return {data:[]};const r=await pool.query(`SELECT * FROM care_tasks WHERE organization_id=$1 ORDER BY CASE status WHEN 'open' THEN 1 WHEN 'in-progress' THEN 2 WHEN 'blocked' THEN 3 ELSE 4 END,due_at NULLS LAST,created_at DESC LIMIT 500`,[dbOrganizationId(req)]);return {data:r.rows,count:r.rowCount};});
app.get('/api/child-health',async(req:any)=>{if(!pool)return {data:[]};const r=await pool.query(`SELECT v.*,p.patient_number AS "patientNumber",p.first_name AS "firstName",p.last_name AS "lastName" FROM child_health_visits v JOIN patients p ON p.id=v.patient_id WHERE v.organization_id=$1 ORDER BY v.visit_date DESC LIMIT 500`,[dbOrganizationId(req)]);return {data:r.rows,count:r.rowCount};});
app.get('/api/medication-reconciliation',async(req:any)=>{if(!pool)return {data:[]};const r=await pool.query(`SELECT m.*,p.patient_number AS "patientNumber",p.first_name AS "firstName",p.last_name AS "lastName" FROM medication_reconciliation m JOIN patients p ON p.id=m.patient_id WHERE m.organization_id=$1 ORDER BY m.created_at DESC LIMIT 500`,[dbOrganizationId(req)]);return {data:r.rows,count:r.rowCount};});
app.get('/api/consents',async(req:any)=>{if(!pool)return {data:[]};const r=await pool.query(`SELECT c.*,p.patient_number AS "patientNumber",p.first_name AS "firstName",p.last_name AS "lastName" FROM patient_consents c JOIN patients p ON p.id=c.patient_id WHERE c.organization_id=$1 ORDER BY c.granted_at DESC LIMIT 500`,[dbOrganizationId(req)]);return {data:r.rows,count:r.rowCount};});
app.get('/api/portal-messages',async(req:any)=>{if(!pool)return {data:[]};const r=await pool.query(`SELECT m.*,p.patient_number AS "patientNumber",p.first_name AS "firstName",p.last_name AS "lastName" FROM portal_messages m JOIN patients p ON p.id=m.patient_id WHERE m.organization_id=$1 ORDER BY m.created_at DESC LIMIT 500`,[dbOrganizationId(req)]);return {data:r.rows,count:r.rowCount};});
app.get('/api/surveillance',async(req:any)=>{if(!pool)return {data:[]};const r=await pool.query(`SELECT * FROM surveillance_events WHERE organization_id=$1 ORDER BY event_date DESC LIMIT 500`,[dbOrganizationId(req)]);return {data:r.rows,count:r.rowCount};});
app.get('/api/investigations',async(req:any)=>{if(!pool)return {data:[]};const r=await pool.query(`SELECT * FROM public_health_investigations WHERE organization_id=$1 ORDER BY started_at DESC LIMIT 500`,[dbOrganizationId(req)]);return {data:r.rows,count:r.rowCount};});
app.get('/api/response',async(req:any)=>{if(!pool)return {data:[]};const r=await pool.query(`SELECT * FROM public_health_response_tasks WHERE organization_id=$1 ORDER BY CASE priority WHEN 'critical' THEN 1 WHEN 'urgent' THEN 2 WHEN 'high' THEN 3 ELSE 4 END,due_at NULLS LAST,created_at DESC LIMIT 500`,[dbOrganizationId(req)]);return {data:r.rows,count:r.rowCount};});
app.get('/api/mortality',async(req:any)=>{if(!pool)return {data:[]};const r=await pool.query(`SELECT m.*,p.patient_number AS "patientNumber",p.first_name AS "firstName",p.last_name AS "lastName",f.name AS "facilityName" FROM mortality_surveillance_records m LEFT JOIN patients p ON p.id=m.patient_id LEFT JOIN facilities f ON f.id=m.facility_id WHERE m.organization_id=$1 ORDER BY m.death_datetime DESC LIMIT 500`,[dbOrganizationId(req)]);return {data:r.rows,count:r.rowCount};});
app.get('/api/district-intelligence',async(req:any)=>{if(!pool)return {data:[]};const r=await pool.query(`SELECT d.id,d.name,d.code,d.region,d.status,COUNT(DISTINCT l.facility_id)::int AS "facilityCount",COALESCE((SELECT COUNT(*) FROM facility_operational_incidents i WHERE i.organization_id=$1 AND i.district_id=d.id AND i.status NOT IN ('resolved','closed')),0)::int AS "openIncidents",COALESCE((SELECT COUNT(*) FROM workforce_capacity_snapshots w WHERE w.organization_id=$1 AND w.district_id=d.id AND w.snapshot_at>=now()-interval '7 days'),0)::int AS "recentWorkforceSnapshots" FROM districts d LEFT JOIN district_facility_links l ON l.organization_id=d.organization_id AND l.district_id=d.id WHERE d.organization_id=$1 GROUP BY d.id ORDER BY d.name LIMIT 500`,[dbOrganizationId(req)]);return {data:r.rows,count:r.rowCount};});
app.get('/api/facility-capacity',async(req:any)=>{if(!pool)return {data:[]};const r=await pool.query(`SELECT c.*,f.name AS "facilityName",f.type AS "facilityType" FROM facility_service_capacity c JOIN facilities f ON f.id=c.facility_id WHERE c.organization_id=$1 ORDER BY c.observed_at DESC LIMIT 500`,[dbOrganizationId(req)]);return {data:r.rows,count:r.rowCount};});
app.get('/api/facility-resources',async(req:any)=>{if(!pool)return {data:[]};const r=await pool.query(`SELECT r.*,f.name AS "facilityName",f.type AS "facilityType" FROM facility_resource_status r JOIN facilities f ON f.id=r.facility_id WHERE r.organization_id=$1 ORDER BY r.observed_at DESC LIMIT 500`,[dbOrganizationId(req)]);return {data:r.rows,count:r.rowCount};});
app.get('/api/facility-performance',async(req:any)=>{if(!pool)return {data:[]};const r=await pool.query(`SELECT p.*,f.name AS "facilityName",f.type AS "facilityType" FROM facility_performance_snapshots p LEFT JOIN facilities f ON f.id=p.facility_id WHERE p.organization_id=$1 ORDER BY p.period_end DESC,p.created_at DESC LIMIT 500`,[dbOrganizationId(req)]);return {data:r.rows,count:r.rowCount};});
app.get('/api/referral-network',async(req:any)=>{if(!pool)return {data:[]};const r=await pool.query(`SELECT n.*,ff.name AS "fromFacilityName",tf.name AS "toFacilityName" FROM referral_network_nodes n JOIN facilities ff ON ff.id=n.from_facility_id JOIN facilities tf ON tf.id=n.to_facility_id WHERE n.organization_id=$1 ORDER BY ff.name,tf.name,n.service_code LIMIT 500`,[dbOrganizationId(req)]);return {data:r.rows,count:r.rowCount};});
app.get('/api/ai-evaluations',async(req:any)=>{if(!pool)return {data:[]};const r=await pool.query(`SELECT id,patient_id AS "patientId",model_version AS "modelVersion",use_case AS "useCase",input_summary AS "inputSummary",output_summary AS "outputSummary",expected_result AS "expectedResult",reviewer_id AS "reviewerId",verdict,safety_flags AS "safetyFlags",created_at AS "createdAt",reviewed_at AS "reviewedAt" FROM ai_evaluations WHERE organization_id=$1 ORDER BY created_at DESC LIMIT 500`,[dbOrganizationId(req)]);return {data:r.rows,count:r.rowCount};});
app.get('/api/care-graph',async(req:any)=>{if(!pool)return {data:[]};const r=await pool.query(`SELECT e.*,p.patient_number AS "patientNumber",p.first_name AS "firstName",p.last_name AS "lastName" FROM care_graph_edges e JOIN patients p ON p.id=e.patient_id WHERE e.organization_id=$1 ORDER BY e.created_at DESC LIMIT 500`,[dbOrganizationId(req)]);return {data:r.rows,count:r.rowCount};});

// Read-only operational/public-health workspaces should not fabricate a generic module_records row.
// Existing specialized POST routes remain the source of truth for their writes.
app.post('/api/response',async(req:any,reply)=>{if(!pool)return reply.code(501).send({error:'PostgreSQL required'});const b=z.object({investigationId:z.string().uuid().optional(),eventId:z.string().uuid().optional(),taskType:z.string(),title:z.string(),priority:z.string().default('routine'),dueAt:z.string().optional(),assignedTo:z.string().uuid().optional(),evidence:z.record(z.any()).default({})}).parse(req.body||{});const r=await pool.query(`INSERT INTO public_health_response_tasks(organization_id,investigation_id,event_id,task_type,title,priority,due_at,assigned_to,evidence,created_by) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING *`,[dbOrganizationId(req),b.investigationId||null,b.eventId||null,b.taskType,b.title,b.priority,b.dueAt||null,b.assignedTo||null,JSON.stringify(b.evidence),dbUserId(req)]);return reply.code(201).send(r.rows[0]);});
app.post('/api/referral-network',async(req:any,reply)=>{if(!pool)return reply.code(501).send({error:'PostgreSQL required'});const b=z.object({fromFacilityId:z.string().uuid(),toFacilityId:z.string().uuid(),serviceCode:z.string().optional(),status:z.enum(['active','restricted','inactive']).default('active'),typicalWaitMinutes:z.number().int().nonnegative().optional(),transportNotes:z.record(z.any()).default({}),metadata:z.record(z.any()).default({})}).parse(req.body||{});const r=await pool.query(`INSERT INTO referral_network_nodes(organization_id,from_facility_id,to_facility_id,service_code,status,typical_wait_minutes,transport_notes,metadata) SELECT $1,$2,$3,$4,$5,$6,$7,$8 WHERE EXISTS(SELECT 1 FROM facilities WHERE id=$2 AND organization_id=$1) AND EXISTS(SELECT 1 FROM facilities WHERE id=$3 AND organization_id=$1) RETURNING *`,[dbOrganizationId(req),b.fromFacilityId,b.toFacilityId,b.serviceCode||null,b.status,b.typicalWaitMinutes??null,JSON.stringify(b.transportNotes),JSON.stringify(b.metadata)]);if(!r.rowCount)return reply.code(404).send({error:'Facility not found'});return reply.code(201).send(r.rows[0]);});



// --- Phase 4 clinical journey intelligence ---
app.get('/api/intelligence/journeys', async (req:any, reply:any) => {
  const organizationId=dbOrganizationId(req); if(!organizationId)return reply.code(400).send({error:'Organization context is required'});
  if(!INTELLIGENCE_ROLES.has(req.user?.role||''))return reply.code(403).send({error:'Journey intelligence requires an authorized clinical or management role.'});
  if(!pool)return reply.code(501).send({error:'PostgreSQL required'});
  try {
    const patientId=req.query?.patientId?String(req.query.patientId):null;
    const rows=await pool.query(`SELECT cs.id,cs.patient_id AS "patientId",cs.severity,cs.status,cs.title,cs.summary,cs.evidence,cs.detected_at AS "detectedAt",p.patient_number AS "patientNumber",p.first_name AS "firstName",p.last_name AS "lastName" FROM clinical_signals cs JOIN patients p ON p.id=cs.patient_id WHERE cs.organization_id=$1 AND cs.signal_type='workflow-gap' AND cs.status IN ('open','acknowledged','snoozed') ${patientId?'AND cs.patient_id=$2':''} ORDER BY CASE cs.severity WHEN 'critical' THEN 0 WHEN 'high' THEN 1 WHEN 'moderate' THEN 2 ELSE 3 END,cs.detected_at DESC LIMIT 500`,patientId?[organizationId,patientId]:[organizationId]);
    return {data:rows.rows};
  } catch { return reply.code(500).send({error:'Clinical journey intelligence could not be prepared.'}); }
});

app.post('/api/intelligence/journeys/scan', async (req:any, reply:any) => {
  if(!GOVERNANCE_ROLES.has(req.user?.role||''))return reply.code(403).send({error:'Journey scanning requires an authorized management role.'});
  if(!pool)return reply.code(501).send({error:'PostgreSQL required'});
  const organizationId=dbOrganizationId(req); if(!organizationId)return reply.code(400).send({error:'Organization context is required'});
  try { return {data:await scanUnfinishedJourneys(pool,organizationId,req.body?.patientId?String(req.body.patientId):undefined)}; }
  catch { return reply.code(500).send({error:'Journey scan could not be completed.'}); }
});

// --- Cross-module clinical intelligence and governance surfaces (additive) ---
// These endpoints read existing EMR/workflow data and keep deterministic CDSS separate
// from the protected generative AI Router. They never replace existing module routes.
const INTELLIGENCE_ROLES = new Set(['admin','doctor','nurse','pharmacist','lab','manager']);
const GOVERNANCE_ROLES = new Set(['admin','manager']);
function intelligenceQuery(){ return async (sql:string, params:any[]=[]) => pool ? (await pool.query(sql,params)).rows : []; }

app.get('/api/intelligence/overview', async (req:any, reply:any) => {
  const organizationId = dbOrganizationId(req); if (!organizationId) return reply.code(400).send({error:'Organization context is required'});
  const q = intelligenceQuery();
  try {
    const [velocity, value, governance, careGaps, risk] = await Promise.all([
      buildClinicalVelocity(q, organizationId, Number(req.query?.days || 30)),
      buildValueBasedCare(q, organizationId, Number(req.query?.days || 30)),
      buildGovernanceSummary(q, organizationId),
      q(`SELECT gap_type AS "gapType",severity,count(*)::int AS count FROM (SELECT 'critical-result-review' AS gap_type,'critical' AS severity FROM lab_results lr JOIN lab_samples ls ON ls.id=lr.sample_id JOIN clinical_orders co ON co.id=ls.order_id WHERE co.organization_id=$1 AND lr.critical=true AND lr.status<>'released' UNION ALL SELECT 'priority-task','urgent' FROM care_tasks WHERE organization_id=$1 AND status='open' AND priority IN ('critical','urgent') UNION ALL SELECT 'delayed-referral','high' FROM referrals WHERE organization_id=$1 AND status NOT IN ('completed','closed','cancelled') AND created_at<now()-interval '7 days' UNION ALL SELECT 'immunization-due','routine' FROM immunizations WHERE organization_id=$1 AND next_due_at IS NOT NULL AND next_due_at<now()) gaps GROUP BY gap_type,severity ORDER BY count DESC`, [organizationId]),
      q(`SELECT severity,status,count(*)::int AS count FROM clinical_signals WHERE organization_id=$1 AND status NOT IN ('resolved','dismissed') GROUP BY severity,status ORDER BY count DESC`, [organizationId]),
    ]);
    return {data:{generatedAt:new Date().toISOString(),velocity,value,governance,careGaps,riskSignals:risk}};
  } catch (e:any) { return reply.code(500).send({error:'Clinical intelligence overview could not be prepared.'}); }
});

app.get('/api/intelligence/patient/:patientId', async (req:any, reply:any) => {
  const organizationId=dbOrganizationId(req); if(!organizationId)return reply.code(400).send({error:'Organization context is required'});
  if(!INTELLIGENCE_ROLES.has(req.user?.role||''))return reply.code(403).send({error:'This intelligence view requires an authorized clinical or management role.'});
  try {
    const data=await buildPatientIntelligenceLayer(intelligenceQuery(),organizationId,req.params.patientId);
    return {data};
  } catch { return reply.code(500).send({error:'Patient intelligence could not be prepared.'}); }
});

app.get('/api/intelligence/velocity', async (req:any, reply:any) => {
  const organizationId=dbOrganizationId(req); if(!organizationId)return reply.code(400).send({error:'Organization context is required'});
  try { return {data:await buildClinicalVelocity(intelligenceQuery(),organizationId,Number(req.query?.days||30))}; }
  catch { return reply.code(500).send({error:'Clinical velocity could not be calculated.'}); }
});

app.get('/api/intelligence/care-gaps', async (req:any, reply:any) => {
  const organizationId=dbOrganizationId(req); if(!organizationId)return reply.code(400).send({error:'Organization context is required'});
  const q=intelligenceQuery();
  try {
    if(req.query?.patientId) return {data:await buildPatientIntelligenceLayer(q,organizationId,String(req.query.patientId))};
    const rows=await q(`SELECT gap_type AS "gapType",severity,count(*)::int AS count FROM (SELECT 'critical-result-review' AS gap_type,'critical' AS severity FROM lab_results lr JOIN lab_samples ls ON ls.id=lr.sample_id JOIN clinical_orders co ON co.id=ls.order_id WHERE co.organization_id=$1 AND lr.critical=true AND lr.status<>'released' UNION ALL SELECT 'priority-task','urgent' FROM care_tasks WHERE organization_id=$1 AND status='open' AND priority IN ('critical','urgent') UNION ALL SELECT 'delayed-referral','high' FROM referrals WHERE organization_id=$1 AND status NOT IN ('completed','closed','cancelled') AND created_at<now()-interval '7 days' UNION ALL SELECT 'immunization-due','routine' FROM immunizations WHERE organization_id=$1 AND next_due_at IS NOT NULL AND next_due_at<now()) gaps GROUP BY gap_type,severity ORDER BY CASE severity WHEN 'critical' THEN 1 WHEN 'urgent' THEN 2 WHEN 'high' THEN 3 ELSE 4 END,count DESC`,[organizationId]);
    return {data:{generatedAt:new Date().toISOString(),gaps:rows}};
  } catch { return reply.code(500).send({error:'Care gap intelligence could not be prepared.'}); }
});

app.get('/api/intelligence/risk', async (req:any, reply:any) => {
  const organizationId=dbOrganizationId(req); if(!organizationId)return reply.code(400).send({error:'Organization context is required'});
  try {
    const rows=await intelligenceQuery()(`SELECT severity,status,count(*)::int AS count FROM clinical_signals WHERE organization_id=$1 GROUP BY severity,status ORDER BY CASE severity WHEN 'critical' THEN 1 WHEN 'high' THEN 2 WHEN 'moderate' THEN 3 ELSE 4 END`,[organizationId]);
    const assessments=await intelligenceQuery()(`SELECT risk_level AS "riskLevel",risk_type AS "riskType",status,count(*)::int AS count FROM ai_risk_assessments WHERE organization_id=$1 GROUP BY risk_level,risk_type,status ORDER BY count DESC`,[organizationId]);
    return {data:{generatedAt:new Date().toISOString(),clinicalSignals:rows,aiRiskAssessments:assessments,policy:{deterministicSignalsRemainSourceOfClinicalRisk:true,generativeAIIsInterpretive:true}}};
  } catch { return reply.code(500).send({error:'Risk intelligence could not be prepared.'}); }
});

app.get('/api/intelligence/value', async (req:any, reply:any) => {
  const organizationId=dbOrganizationId(req); if(!organizationId)return reply.code(400).send({error:'Organization context is required'});
  try { return {data:await buildValueBasedCare(intelligenceQuery(),organizationId,Number(req.query?.days||30))}; }
  catch { return reply.code(500).send({error:'Value-based care intelligence could not be prepared.'}); }
});

app.get('/api/intelligence/governance', async (req:any, reply:any) => {
  if(!GOVERNANCE_ROLES.has(req.user?.role||''))return reply.code(403).send({error:'Governance information requires an authorized management role.'});
  const organizationId=dbOrganizationId(req); if(!organizationId)return reply.code(400).send({error:'Organization context is required'});
  try { return {data:await buildGovernanceSummary(intelligenceQuery(),organizationId)}; }
  catch { return reply.code(500).send({error:'AI governance summary could not be prepared.'}); }
});

app.get('/api/intelligence/security-events', async (req:any, reply:any) => {
  if(!GOVERNANCE_ROLES.has(req.user?.role||''))return reply.code(403).send({error:'AI security events require an authorized management role.'});
  const organizationId=dbOrganizationId(req); if(!organizationId)return reply.code(400).send({error:'Organization context is required'});
  try {
    const rows=await intelligenceQuery()(`SELECT id,event_type AS "eventType",severity,status,capability_id AS "capabilityId",created_at AS "createdAt" FROM ai_security_events WHERE organization_id=$1 ORDER BY created_at DESC LIMIT 200`,[organizationId]);
    return {data:rows};
  } catch { return reply.code(500).send({error:'AI security events could not be loaded.'}); }
});

// CDS Hooks discovery and service boundary. Clinical rules are executed by the existing
// deterministic CDSS evaluator. No generative model is called by this endpoint.
const CDS_HOOKS = [
  {id:'patient-view',title:'Patient view intelligence',description:'Returns governed deterministic clinical review signals when a patient record is opened.',eventType:'patient.viewed'},
  {id:'encounter-start',title:'Encounter start intelligence',description:'Returns deterministic safety signals at encounter start.',eventType:'encounter.started'},
  {id:'order-select',title:'Order selection safety review',description:'Returns deterministic safety signals when an order is selected for review.',eventType:'order.select'},
  {id:'order-sign',title:'Order sign safety review',description:'Returns synchronous medication/allergy and critical safety signals before order completion.',eventType:'order.sign'},
  {id:'encounter-discharge',title:'Discharge review',description:'Returns unresolved safety and follow-up signals at discharge.',eventType:'encounter.discharge'},
];
app.get('/api/cds-services',async()=>({services:CDS_HOOKS.map(h=>({id:h.id,title:h.title,description:h.description,hook:h.id,endpoint:`/api/cds-services/${h.id}`}))}));
app.post('/api/cds-services/:serviceId',async(req:any,reply:any)=>{
  const service=CDS_HOOKS.find(x=>x.id===req.params.serviceId); if(!service)return reply.code(404).send({error:'CDS service not found'});
  const organizationId=dbOrganizationId(req); if(!organizationId)return reply.code(400).send({error:'Organization context is required'});
  if(!pool)return reply.code(501).send({error:'CDS service requires PostgreSQL'});
  const body=req.body||{}; const patientId=body.patientId || body.context?.patientId || body.context?.patient?.id || body.prefetch?.patient?.id || null;
  if(!patientId)return {cards:[],systemActions:[]};
  const mode=service.id==='order-sign'?'sync':'sync';
  const decision=await evaluateClinicalContext(pool,{mode,trigger:{eventType:service.eventType,organizationId,patientId:String(patientId),encounterId:body.encounterId||body.context?.encounterId||null,payload:body.context||{}}});
  return {cards:decision.reasons.slice(0,8).map((x:any)=>({uuid:randomUUID(),summary:x.title,detail:x.summary,indicator:x.severity==='critical'?'critical':x.severity==='high'?'warning':'info',source:{label:'ClinAI CDSS',url:'/api/cds-services'},links:[]})),systemActions:[]};
});



// --- Phase 6/7 longitudinal intelligence surfaces ---
app.get('/api/intelligence/patient-360/:patientId', async (req:any, reply:any) => {
  const organizationId=dbOrganizationId(req); if(!organizationId)return reply.code(400).send({error:'Organization context is required'});
  if(!pool)return reply.code(501).send({error:'PostgreSQL required'});
  const patientId=String(req.params.patientId); const task=String(req.query?.task||'clinical');
  try { return {data:await buildPatient360Context(intelligenceQuery(),organizationId,patientId,task)}; }
  catch { return reply.code(500).send({error:'Patient 360 context could not be prepared.'}); }
});

app.get('/api/intelligence/security', async (req:any, reply:any) => {
  const organizationId=dbOrganizationId(req); if(!organizationId)return reply.code(400).send({error:'Organization context is required'});
  try{return {data:await buildAISecurityIntelligence(intelligenceQuery(),organizationId,Number(req.query?.days||30))};}catch{return reply.code(500).send({error:'AI security intelligence could not be prepared.'});}
});

app.get('/api/intelligence/risk-management', async (req:any, reply:any) => {
  const organizationId=dbOrganizationId(req); if(!organizationId)return reply.code(400).send({error:'Organization context is required'});
  try{return {data:await buildAIRiskIntelligence(intelligenceQuery(),organizationId)};}catch{return reply.code(500).send({error:'AI risk intelligence could not be prepared.'});}
});

app.get('/api/intelligence/clinical-velocity', async (req:any, reply:any) => {
  const organizationId=dbOrganizationId(req); if(!organizationId)return reply.code(400).send({error:'Organization context is required'});
  try{return {data:await buildClinicalVelocityIntelligence(intelligenceQuery(),organizationId,Number(req.query?.days||30))};}catch{return reply.code(500).send({error:'Clinical velocity intelligence could not be prepared.'});}
});

app.get('/api/intelligence/value-based-care', async (req:any, reply:any) => {
  const organizationId=dbOrganizationId(req); if(!organizationId)return reply.code(400).send({error:'Organization context is required'});
  try{return {data:await buildValueBasedCareIntelligence(intelligenceQuery(),organizationId,req.query?.start?String(req.query.start):undefined,req.query?.end?String(req.query.end):undefined)};}catch{return reply.code(500).send({error:'Value based care intelligence could not be prepared.'});}
});

// --- V28 completed governance, measurement and interoperability surfaces ---
app.get('/api/intelligence/capabilities', async (req:any, reply:any) => {
  const organizationId=dbOrganizationId(req); if(!organizationId)return reply.code(400).send({error:'Organization context is required'});
  try { const rows=await intelligenceQuery()(`SELECT capability_id AS "capabilityId",name,domain,risk_level AS "riskLevel",allowed_roles AS "allowedRoles",allowed_modules AS "allowedModules",required_context AS "requiredContext",allowed_data AS "allowedData",model_policy AS "modelPolicy",evidence_policy AS "evidencePolicy",human_review AS "humanReview",action_permissions AS "actionPermissions",evaluation_policy AS "evaluationPolicy",status,version FROM ai_capabilities WHERE organization_id=$1 OR organization_id IS NULL ORDER BY domain,capability_id`,[organizationId]); return {data:rows,catalog:AI_CAPABILITY_CATALOG}; } catch { return reply.code(500).send({error:'AI capability registry could not be loaded.'}); }
});

app.post('/api/intelligence/capability-evaluations', async (req:any, reply:any) => {
  if(!GOVERNANCE_ROLES.has(req.user?.role||''))return reply.code(403).send({error:'Capability evaluation requires an authorized management role.'});
  const b=z.object({capabilityId:z.string().min(2),version:z.string().default('1.0'),evaluationType:z.string().min(2),status:z.enum(['pending','passed','failed','reviewed']).default('pending'),sampleSize:z.number().int().nonnegative().optional(),metrics:z.record(z.any()).default({}),findings:z.record(z.any()).default({})}).parse(req.body||{});
  try { return reply.code(201).send({data:await recordAICapabilityEvaluation(pool,{organizationId:dbOrganizationId(req)!,...b,reviewerId:dbUserId(req)})}); } catch { return reply.code(500).send({error:'Capability evaluation could not be recorded.'}); }
});

app.get('/api/intelligence/lifecycle', async (req:any, reply:any) => {
  if(!GOVERNANCE_ROLES.has(req.user?.role||''))return reply.code(403).send({error:'AI lifecycle information requires an authorized management role.'});
  const organizationId=dbOrganizationId(req); if(!organizationId)return reply.code(400).send({error:'Organization context is required'});
  try{return {data:await buildAIGovernanceLifecycle(intelligenceQuery(),organizationId)}}catch{return reply.code(500).send({error:'AI lifecycle information could not be prepared.'})}
});

app.post('/api/intelligence/incidents', async (req:any, reply:any) => {
  if(!GOVERNANCE_ROLES.has(req.user?.role||''))return reply.code(403).send({error:'AI incident management requires an authorized management role.'});
  if(!pool)return reply.code(501).send({error:'PostgreSQL required'});
  const b=z.object({capabilityId:z.string().optional(),severity:z.enum(['low','moderate','high','critical']).default('moderate'),incidentType:z.string().min(2),patientId:z.string().uuid().optional(),description:z.string().min(5),containment:z.record(z.any()).default({}),rootCause:z.record(z.any()).default({}),correctiveAction:z.record(z.any()).default({}),ownerId:z.string().uuid().optional()}).parse(req.body||{});
  const r=await pool.query(`INSERT INTO ai_incidents(organization_id,capability_id,severity,incident_type,patient_id,description,containment,root_cause,corrective_action,owner_id,created_by) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) RETURNING id,created_at AS "createdAt",status`,[dbOrganizationId(req),b.capabilityId||null,b.severity,b.incidentType,b.patientId||null,b.description,JSON.stringify(b.containment),JSON.stringify(b.rootCause),JSON.stringify(b.correctiveAction),b.ownerId||null,dbUserId(req)]);
  await recordSecurityEvent(pool,{organizationId:dbOrganizationId(req)!,userId:dbUserId(req),patientId:b.patientId||null,capabilityId:b.capabilityId||null,eventType:'ai-incident-created',severity:b.severity,status:'observed',metadata:{incidentType:b.incidentType}}).catch(()=>null);
  return reply.code(201).send({data:r.rows[0]});
});

app.get('/api/intelligence/care-gaps/snapshots', async (req:any, reply:any) => {
  const organizationId=dbOrganizationId(req); if(!organizationId)return reply.code(400).send({error:'Organization context is required'});
  try { const rows=await intelligenceQuery()(`SELECT id,patient_id AS "patientId",gap_type AS "gapType",severity,status,source_module AS "sourceModule",evidence,detected_at AS "detectedAt",closed_at AS "closedAt" FROM care_gap_snapshots WHERE organization_id=$1 ${req.query?.patientId?'AND patient_id=$2':''} AND status='open' ORDER BY CASE severity WHEN 'critical' THEN 0 WHEN 'urgent' THEN 1 WHEN 'high' THEN 2 ELSE 3 END,detected_at DESC LIMIT 500`,req.query?.patientId?[organizationId,String(req.query.patientId)]:[organizationId]); return {data:rows}; } catch { return reply.code(500).send({error:'Care-gap snapshots could not be loaded.'}); }
});

app.post('/api/intelligence/care-gaps/materialize', async (req:any, reply:any) => {
  if(!GOVERNANCE_ROLES.has(req.user?.role||''))return reply.code(403).send({error:'Care-gap materialization requires an authorized management role.'});
  if(!pool)return reply.code(501).send({error:'PostgreSQL required'});
  const organizationId=dbOrganizationId(req); if(!organizationId)return reply.code(400).send({error:'Organization context is required'});
  const patientId=req.body?.patientId?String(req.body.patientId):null;
  const intelligence=patientId?await buildPatientIntelligenceLayer(intelligenceQuery(),organizationId,patientId):null;
  if(!intelligence)return reply.code(400).send({error:'A patientId is required to materialize patient care gaps.'});
  const client=await pool.connect(); try { await client.query('BEGIN'); const ids:string[]=[]; for(const g of intelligence.careGaps||[]) { const r=await client.query(`INSERT INTO care_gap_snapshots(organization_id,patient_id,gap_type,severity,status,source_module,evidence) VALUES($1,$2,$3,$4,'open',$5,$6) RETURNING id`,[organizationId,patientId,g.gapType,g.severity,g.sourceModule,JSON.stringify(g.evidence||{})]); if(r.rowCount)ids.push(r.rows[0].id); } await client.query('COMMIT'); return {data:{created:ids.length,ids,generatedAt:intelligence.generatedAt}}; } catch(e){await client.query('ROLLBACK');throw e} finally{client.release()}
});

app.get('/api/intelligence/measures', async (req:any, reply:any) => {
  const organizationId=dbOrganizationId(req); if(!organizationId)return reply.code(400).send({error:'Organization context is required'});
  const end=String(req.query?.end||new Date().toISOString().slice(0,10)); const start=String(req.query?.start||new Date(Date.now()-29*86400000).toISOString().slice(0,10));
  try{return {data:await calculateClinicalMeasures(intelligenceQuery(),organizationId,start,end),period:{start,end},logic:'CQL-compatible deterministic execution'}}catch{return reply.code(500).send({error:'Clinical measures could not be calculated.'})}
});

app.post('/api/intelligence/measures/materialize', async (req:any, reply:any) => {
  if(!GOVERNANCE_ROLES.has(req.user?.role||''))return reply.code(403).send({error:'Measure materialization requires an authorized management role.'});
  if(!pool)return reply.code(501).send({error:'PostgreSQL required'});
  const organizationId=dbOrganizationId(req); if(!organizationId)return reply.code(400).send({error:'Organization context is required'});
  const end=String(req.body?.end||new Date().toISOString().slice(0,10)); const start=String(req.body?.start||new Date(Date.now()-29*86400000).toISOString().slice(0,10));
  const measures=await calculateClinicalMeasures(intelligenceQuery(),organizationId,start,end);
  const client=await pool.connect(); try { await client.query('BEGIN'); for(const m of measures) await client.query(`INSERT INTO clinical_measure_results(organization_id,measure_code,period_start,period_end,numerator,denominator,value_numeric,evidence) VALUES($1,$2,$3,$4,$5,$6,$7,$8) ON CONFLICT(organization_id,measure_code,period_start,period_end) DO UPDATE SET numerator=EXCLUDED.numerator,denominator=EXCLUDED.denominator,value_numeric=EXCLUDED.value_numeric,evidence=EXCLUDED.evidence,calculated_at=now()`,[organizationId,m.measureCode,start,end,m.numerator,m.denominator,m.valueNumeric,JSON.stringify({engine:'deterministic',logic:'CQL-compatible'})]); await client.query('COMMIT'); return {data:measures,period:{start,end}}; } catch(e){await client.query('ROLLBACK');throw e} finally{client.release()}
});

app.post('/api/smart/apps', async (req:any, reply:any) => {
  if(!GOVERNANCE_ROLES.has(req.user?.role||''))return reply.code(403).send({error:'SMART app registration requires an authorized management role.'});
  if(!pool)return reply.code(501).send({error:'PostgreSQL required'});
  const b=z.object({clientId:z.string().min(3).max(120),appName:z.string().min(2).max(200),redirectUris:z.array(z.string().url()).min(1).max(10),scopes:z.array(z.string()).default(['openid','fhirUser','launch','patient/*.read']),launchUri:z.string().url().optional()}).parse(req.body||{});
  const r=await pool.query(`INSERT INTO smart_app_registrations(organization_id,client_id,app_name,redirect_uris,scopes,launch_uri) VALUES($1,$2,$3,$4,$5,$6) ON CONFLICT(organization_id,client_id) DO UPDATE SET app_name=EXCLUDED.app_name,redirect_uris=EXCLUDED.redirect_uris,scopes=EXCLUDED.scopes,launch_uri=EXCLUDED.launch_uri,updated_at=now() RETURNING id,client_id AS "clientId",app_name AS "appName",redirect_uris AS "redirectUris",scopes,launch_uri AS "launchUri",status`);
  return reply.code(201).send({data:r.rows[0]});
});

app.get('/.well-known/smart-configuration', async (req:any) => { const base=`${String(process.env.PUBLIC_BASE_URL||'').replace(/\/$/,'')||'https://clinai-api.onrender.com'}`; return {issuer:base,authorization_endpoint:`${base}/api/smart/authorize`,token_endpoint:`${base}/api/smart/token`,capabilities:['launch-ehr','client-public','client-confidential-symmetric','permission-v2','context-ehr-patient','context-ehr-encounter','sso-openid-connect'],scopes_supported:['openid','fhirUser','launch','launch/patient','patient/*.read','user/*.read','offline_access'],response_types_supported:['code'],grant_types_supported:['authorization_code','refresh_token'],code_challenge_methods_supported:['S256']}; });
app.get('/api/smart/authorize', async (req:any, reply:any) => { const q=req.query||{}; if(!q.client_id||!q.redirect_uri||!q.response_type) return reply.code(400).send({error:'SMART authorization parameters are incomplete.'}); if(String(q.response_type)!=='code')return reply.code(400).send({error:'Only authorization code flow is supported.'}); if(!pool)return reply.code(503).send({error:'SMART authorization requires PostgreSQL.'}); const r=await pool.query(`SELECT id,organization_id FROM smart_app_registrations WHERE client_id=$1 AND status='active' AND redirect_uris @> $2::jsonb LIMIT 1`,[String(q.client_id),JSON.stringify([String(q.redirect_uri)])]); if(!r.rowCount)return reply.code(400).send({error:'SMART client is not registered for this redirect URI.'}); const code=randomUUID(); const orgId=String(r.rows[0].organization_id||dbOrganizationId(req)||''); if(!orgId)return reply.code(400).send({error:'SMART organization context is required.'}); if(dbOrganizationId(req)!==orgId)return reply.code(403).send({error:'SMART client belongs to a different organization.'}); const requestedScope=String(q.scope||'openid fhirUser launch'); const challenge=String(q.code_challenge||''); if(!challenge)return reply.code(400).send({error:'PKCE code_challenge is required.'}); await pool.query(`INSERT INTO smart_authorization_codes(organization_id,user_id,user_role,client_id,redirect_uri,code_hash,scope,patient_id,code_challenge,expires_at) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,now()+interval '5 minutes')`,[orgId,dbUserId(req),String(req.user?.role||'doctor'),String(q.client_id),String(q.redirect_uri),createHash('sha256').update(code).digest('hex'),requestedScope,q.patient_id||null,challenge]); const u=new URL(String(q.redirect_uri)); u.searchParams.set('code',code); if(q.state)u.searchParams.set('state',String(q.state)); return reply.redirect(u.toString()); });
app.post('/api/smart/token', async (req:any, reply:any) => { if(!pool)return reply.code(503).send({error:'SMART token service requires PostgreSQL.'}); const b=z.object({grant_type:z.enum(['authorization_code','refresh_token']),code:z.string().optional(),client_id:z.string().min(2),redirect_uri:z.string().optional(),refresh_token:z.string().optional(),code_verifier:z.string().optional()}).parse(req.body||{}); if(b.grant_type!=='authorization_code'||!b.code)return reply.code(400).send({error:'Authorization code is required.'}); if(!b.code_verifier)return reply.code(400).send({error:'PKCE code_verifier is required.'}); const hash=createHash('sha256').update(b.code).digest('hex'); const r=await pool.query(`UPDATE smart_authorization_codes SET used_at=now() WHERE code_hash=$1 AND client_id=$2 AND redirect_uri=COALESCE($3,redirect_uri) AND used_at IS NULL AND expires_at>now() RETURNING organization_id,user_id,user_role,scope,patient_id,code_challenge`,[hash,b.client_id,b.redirect_uri||null]); if(!r.rowCount)return reply.code(400).send({error:'Authorization code is invalid, expired or already used.'}); const expected=createHash('sha256').update(b.code_verifier).digest('base64url'); if(expected!==r.rows[0].code_challenge)return reply.code(400).send({error:'PKCE verification failed.'}); const accessToken=await app.jwt.sign({sub:r.rows[0].user_id||`smart:${b.client_id}`,organizationId:r.rows[0].organization_id,role:r.rows[0].user_role||'doctor',scope:r.rows[0].scope||'',smartClientId:b.client_id}, {expiresIn:'15m'}); return {access_token:accessToken,token_type:'Bearer',expires_in:900,scope:r.rows[0].scope||'',patient:r.rows[0].patient_id||undefined}; });

registerWorkstream2DomainRoutes(app,pool,{dbOrganizationId,dbUserId,requireAuthorizedWrite,dbAudit,queueEvent,clinicalEventTypes:CLINICAL_EVENT_TYPES});

app.listen({port:Number(process.env.PORT||4000),host:'0.0.0.0'});


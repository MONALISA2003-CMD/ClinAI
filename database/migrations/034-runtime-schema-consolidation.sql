-- Consolidates schema DDL previously executed during API startup.
-- Created for P1: schema changes are now explicit operator-run migrations.
-- Review against the target database before applying. This does not replace legacy migration provenance review.

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
    CREATE TABLE IF NOT EXISTS organization_settings (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
      category text NOT NULL, name text NOT NULL, value text NOT NULL,
      value_type text NOT NULL DEFAULT 'text' CHECK (value_type IN ('text','number','boolean','json')),
      description text, created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
      UNIQUE(organization_id,category,name)
    );
    CREATE INDEX IF NOT EXISTS organization_settings_org_category_idx ON organization_settings(organization_id,category,name);
    ALTER TABLE health_worker_profiles ADD COLUMN IF NOT EXISTS department text;
    ALTER TABLE health_worker_profiles ADD COLUMN IF NOT EXISTS role text;
    ALTER TABLE health_worker_profiles ADD COLUMN IF NOT EXISTS shift text;
    ALTER TABLE health_worker_profiles ADD COLUMN IF NOT EXISTS availability_status text;
    ALTER TABLE health_worker_profiles ADD COLUMN IF NOT EXISTS leave_status text;
    ALTER TABLE health_worker_profiles ADD COLUMN IF NOT EXISTS workload numeric;
    ALTER TABLE health_worker_profiles ADD COLUMN IF NOT EXISTS license_expiry date;
    ALTER TABLE health_worker_profiles ADD COLUMN IF NOT EXISTS credentials jsonb NOT NULL DEFAULT '{}';
    ALTER TABLE facility_resource_status ADD COLUMN IF NOT EXISTS maintenance_status text;
    ALTER TABLE facility_resource_status ADD COLUMN IF NOT EXISTS maintenance_due_at timestamptz;
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

-- ---------------------------------------------------------------------------

ALTER TABLE lab_samples ADD COLUMN IF NOT EXISTS created_at timestamptz NOT NULL DEFAULT now();
    ALTER TABLE lab_samples ADD COLUMN IF NOT EXISTS received_by uuid REFERENCES users(id);
    ALTER TABLE lab_samples ADD COLUMN IF NOT EXISTS processed_by uuid REFERENCES users(id);
    ALTER TABLE lab_samples ADD COLUMN IF NOT EXISTS rejected_at timestamptz;
    ALTER TABLE lab_samples ADD COLUMN IF NOT EXISTS rejection_reason text;
    ALTER TABLE lab_samples ADD COLUMN IF NOT EXISTS updated_at timestamptz NOT NULL DEFAULT now();
    ALTER TABLE lab_results ADD COLUMN IF NOT EXISTS reference_range jsonb NOT NULL DEFAULT '{}';
    ALTER TABLE lab_results ADD COLUMN IF NOT EXISTS interpretation text;
    ALTER TABLE lab_results ADD COLUMN IF NOT EXISTS comments text;
    ALTER TABLE lab_results ADD COLUMN IF NOT EXISTS released_by uuid REFERENCES users(id);
    ALTER TABLE lab_results ADD COLUMN IF NOT EXISTS released_at timestamptz;
    ALTER TABLE lab_results ADD COLUMN IF NOT EXISTS created_at timestamptz NOT NULL DEFAULT now();
    ALTER TABLE lab_results ADD COLUMN IF NOT EXISTS updated_at timestamptz NOT NULL DEFAULT now();
    CREATE TABLE IF NOT EXISTS imaging_studies(
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(), organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
      patient_id uuid NOT NULL REFERENCES patients(id) ON DELETE CASCADE, encounter_id uuid REFERENCES encounters(id) ON DELETE SET NULL,
      order_id uuid REFERENCES clinical_orders(id) ON DELETE SET NULL, study_code text, study_name text NOT NULL,
      modality text, body_site text, priority text NOT NULL DEFAULT 'routine', status text NOT NULL DEFAULT 'scheduled',
      scheduled_at timestamptz, performed_at timestamptz, report text, findings text, impression text,
      critical boolean NOT NULL DEFAULT false, report_verified_at timestamptz, report_released_at timestamptz,
      cancel_reason text, created_by uuid REFERENCES users(id), created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now()
    );
    ALTER TABLE imaging_studies ADD COLUMN IF NOT EXISTS organization_id uuid REFERENCES organizations(id) ON DELETE CASCADE;
    ALTER TABLE imaging_studies ADD COLUMN IF NOT EXISTS patient_id uuid REFERENCES patients(id) ON DELETE CASCADE;
    ALTER TABLE imaging_studies ADD COLUMN IF NOT EXISTS encounter_id uuid REFERENCES encounters(id) ON DELETE SET NULL;
    ALTER TABLE imaging_studies ADD COLUMN IF NOT EXISTS order_id uuid REFERENCES clinical_orders(id) ON DELETE SET NULL;
    ALTER TABLE imaging_studies ADD COLUMN IF NOT EXISTS study_code text;
    ALTER TABLE imaging_studies ADD COLUMN IF NOT EXISTS study_name text;
    ALTER TABLE imaging_studies ADD COLUMN IF NOT EXISTS modality text;
    ALTER TABLE imaging_studies ADD COLUMN IF NOT EXISTS body_site text;
    ALTER TABLE imaging_studies ADD COLUMN IF NOT EXISTS priority text NOT NULL DEFAULT 'routine';
    ALTER TABLE imaging_studies ADD COLUMN IF NOT EXISTS status text NOT NULL DEFAULT 'scheduled';
    ALTER TABLE imaging_studies ADD COLUMN IF NOT EXISTS scheduled_at timestamptz;
    ALTER TABLE imaging_studies ADD COLUMN IF NOT EXISTS performed_at timestamptz;
    ALTER TABLE imaging_studies ADD COLUMN IF NOT EXISTS report text;
    ALTER TABLE imaging_studies ADD COLUMN IF NOT EXISTS findings text;
    ALTER TABLE imaging_studies ADD COLUMN IF NOT EXISTS impression text;
    ALTER TABLE imaging_studies ADD COLUMN IF NOT EXISTS critical boolean NOT NULL DEFAULT false;
    ALTER TABLE imaging_studies ADD COLUMN IF NOT EXISTS report_verified_at timestamptz;
    ALTER TABLE imaging_studies ADD COLUMN IF NOT EXISTS report_released_at timestamptz;
    ALTER TABLE imaging_studies ADD COLUMN IF NOT EXISTS cancel_reason text;
    ALTER TABLE imaging_studies ADD COLUMN IF NOT EXISTS created_by uuid REFERENCES users(id);
    ALTER TABLE imaging_studies ADD COLUMN IF NOT EXISTS created_at timestamptz NOT NULL DEFAULT now();
    ALTER TABLE imaging_studies ADD COLUMN IF NOT EXISTS updated_at timestamptz NOT NULL DEFAULT now();
    ALTER TABLE medication_orders ADD COLUMN IF NOT EXISTS prescribed_at timestamptz NOT NULL DEFAULT now();
    ALTER TABLE medication_orders ADD COLUMN IF NOT EXISTS indication text;
    ALTER TABLE medication_orders ADD COLUMN IF NOT EXISTS instructions text;
    ALTER TABLE medication_orders ADD COLUMN IF NOT EXISTS start_date date;
    ALTER TABLE medication_orders ADD COLUMN IF NOT EXISTS end_date date;
    ALTER TABLE medication_orders ADD COLUMN IF NOT EXISTS updated_at timestamptz NOT NULL DEFAULT now();
    ALTER TABLE dispensations ADD COLUMN IF NOT EXISTS created_at timestamptz NOT NULL DEFAULT now();
    ALTER TABLE dispensations ADD COLUMN IF NOT EXISTS status text NOT NULL DEFAULT 'completed';
    ALTER TABLE dispensations ADD COLUMN IF NOT EXISTS notes jsonb NOT NULL DEFAULT '{}';
    CREATE TABLE IF NOT EXISTS medication_reconciliation(
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(), organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
      patient_id uuid NOT NULL REFERENCES patients(id) ON DELETE CASCADE, encounter_id uuid REFERENCES encounters(id) ON DELETE SET NULL,
      source text NOT NULL DEFAULT 'clinical-review', medication_name text, status text NOT NULL DEFAULT 'in-review',
      medicines jsonb NOT NULL DEFAULT '[]', discrepancies jsonb NOT NULL DEFAULT '[]', resolved_count integer NOT NULL DEFAULT 0,
      reviewed_by uuid REFERENCES users(id), reviewed_at timestamptz, created_by uuid REFERENCES users(id),
      created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now()
    );
    ALTER TABLE medication_reconciliation ADD COLUMN IF NOT EXISTS encounter_id uuid REFERENCES encounters(id) ON DELETE SET NULL;
    ALTER TABLE medication_reconciliation ADD COLUMN IF NOT EXISTS source text NOT NULL DEFAULT 'clinical-review';
    ALTER TABLE medication_reconciliation ADD COLUMN IF NOT EXISTS medication_name text;
    ALTER TABLE medication_reconciliation ADD COLUMN IF NOT EXISTS medicines jsonb NOT NULL DEFAULT '[]';
    ALTER TABLE medication_reconciliation ADD COLUMN IF NOT EXISTS discrepancies jsonb NOT NULL DEFAULT '[]';
    ALTER TABLE medication_reconciliation ADD COLUMN IF NOT EXISTS resolved_count integer NOT NULL DEFAULT 0;
    ALTER TABLE medication_reconciliation ADD COLUMN IF NOT EXISTS reviewed_by uuid REFERENCES users(id);
    ALTER TABLE medication_reconciliation ADD COLUMN IF NOT EXISTS reviewed_at timestamptz;
    ALTER TABLE medication_reconciliation ADD COLUMN IF NOT EXISTS created_by uuid REFERENCES users(id);
    ALTER TABLE medication_reconciliation ADD COLUMN IF NOT EXISTS created_at timestamptz NOT NULL DEFAULT now();
    ALTER TABLE medication_reconciliation ADD COLUMN IF NOT EXISTS updated_at timestamptz NOT NULL DEFAULT now();
    CREATE TABLE IF NOT EXISTS medication_reconciliation_items(
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(), reconciliation_id uuid NOT NULL REFERENCES medication_reconciliation(id) ON DELETE CASCADE,
      patient_id uuid NOT NULL REFERENCES patients(id) ON DELETE CASCADE, medication_order_id uuid REFERENCES medication_orders(id) ON DELETE SET NULL,
      medication_id uuid REFERENCES medications(id) ON DELETE SET NULL, medication_name text, dose text, frequency text, route text,
      discrepancy_type text, status text NOT NULL DEFAULT 'open', notes text, resolved_by uuid REFERENCES users(id), resolved_at timestamptz,
      created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now()
    );
    CREATE INDEX IF NOT EXISTS lab_samples_org_status_idx ON lab_samples(order_id,status,collected_at DESC);
    CREATE INDEX IF NOT EXISTS lab_results_sample_status_idx ON lab_results(sample_id,status,created_at DESC);
    CREATE INDEX IF NOT EXISTS imaging_studies_org_status_idx ON imaging_studies(organization_id,status,created_at DESC);
    CREATE INDEX IF NOT EXISTS imaging_studies_patient_created_idx ON imaging_studies(patient_id,created_at DESC);
    CREATE INDEX IF NOT EXISTS medication_orders_patient_prescribed_idx ON medication_orders(patient_id,prescribed_at DESC);
    CREATE INDEX IF NOT EXISTS medication_orders_status_idx ON medication_orders(status,prescribed_at DESC);
    CREATE INDEX IF NOT EXISTS dispensations_order_created_idx ON dispensations(medication_order_id,created_at DESC);
    CREATE INDEX IF NOT EXISTS medication_reconciliation_org_status_idx ON medication_reconciliation(organization_id,status,created_at DESC);
    CREATE INDEX IF NOT EXISTS medication_reconciliation_patient_idx ON medication_reconciliation(patient_id,created_at DESC);
    CREATE INDEX IF NOT EXISTS medication_reconciliation_items_parent_idx ON medication_reconciliation_items(reconciliation_id,status,created_at DESC);

-- ---------------------------------------------------------------------------

ALTER TABLE notifications ADD COLUMN IF NOT EXISTS created_at timestamptz NOT NULL DEFAULT now();

-- ---------------------------------------------------------------------------

CREATE INDEX IF NOT EXISTS notifications_patient_idx ON notifications(patient_id, created_at DESC);

-- ---------------------------------------------------------------------------

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
CREATE TABLE IF NOT EXISTS public_health_investigations (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE, surveillance_case_id uuid REFERENCES surveillance_cases(id) ON DELETE SET NULL, event_id uuid REFERENCES surveillance_events(id) ON DELETE SET NULL, investigation_type text NOT NULL, status text NOT NULL DEFAULT 'open' CHECK(status IN ('open','under-review','completed','closed')), lead_user_id uuid REFERENCES users(id), started_at timestamptz NOT NULL DEFAULT now(), completed_at timestamptz, findings jsonb NOT NULL DEFAULT '{}', verification jsonb NOT NULL DEFAULT '{}', risk_assessment jsonb NOT NULL DEFAULT '{}', source_guideline text, created_by uuid REFERENCES users(id), created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE IF NOT EXISTS public_health_contacts (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE, investigation_id uuid REFERENCES public_health_investigations(id) ON DELETE CASCADE, patient_id uuid REFERENCES patients(id) ON DELETE SET NULL, contact_type text NOT NULL, exposure_start timestamptz, exposure_end timestamptz, relationship text, location jsonb NOT NULL DEFAULT '{}', risk_level text NOT NULL DEFAULT 'routine', status text NOT NULL DEFAULT 'identified', notes jsonb NOT NULL DEFAULT '{}', created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE IF NOT EXISTS public_health_response_tasks (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE, investigation_id uuid REFERENCES public_health_investigations(id) ON DELETE CASCADE, event_id uuid REFERENCES surveillance_events(id) ON DELETE SET NULL, task_type text NOT NULL, title text NOT NULL, priority text NOT NULL DEFAULT 'routine', status text NOT NULL DEFAULT 'pending', assigned_to uuid REFERENCES users(id), due_at timestamptz, completed_at timestamptz, escalation_level integer NOT NULL DEFAULT 0, evidence jsonb NOT NULL DEFAULT '{}', requires_human_approval boolean NOT NULL DEFAULT true, created_by uuid REFERENCES users(id), created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE IF NOT EXISTS public_health_alerts (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE, alert_type text NOT NULL, severity text NOT NULL DEFAULT 'high', title text NOT NULL, message text NOT NULL, source_event_id uuid REFERENCES surveillance_events(id) ON DELETE SET NULL, source_investigation_id uuid REFERENCES public_health_investigations(id) ON DELETE SET NULL, status text NOT NULL DEFAULT 'pending-review', generated_reason jsonb NOT NULL DEFAULT '{}', reviewed_by uuid REFERENCES users(id), reviewed_at timestamptz, created_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE IF NOT EXISTS mortality_surveillance_records (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE, patient_id uuid REFERENCES patients(id) ON DELETE SET NULL, facility_id uuid REFERENCES facilities(id) ON DELETE SET NULL, death_datetime timestamptz NOT NULL, place_of_death text, immediate_cause text, underlying_cause text, contributing_conditions jsonb NOT NULL DEFAULT '[]', maternal_death boolean NOT NULL DEFAULT false, neonatal_death boolean NOT NULL DEFAULT false, review_status text NOT NULL DEFAULT 'pending', review_findings jsonb NOT NULL DEFAULT '{}', source_guideline text, created_by uuid REFERENCES users(id), created_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE IF NOT EXISTS districts (  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,  name text NOT NULL, code text, region text, status text NOT NULL DEFAULT 'active', metadata jsonb NOT NULL DEFAULT '{}', created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(), UNIQUE(organization_id,name) ); CREATE TABLE IF NOT EXISTS district_facility_links (  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,  district_id uuid NOT NULL REFERENCES districts(id) ON DELETE CASCADE, facility_id uuid NOT NULL REFERENCES facilities(id) ON DELETE CASCADE,  relationship text NOT NULL DEFAULT 'serves', effective_from timestamptz, effective_to timestamptz, metadata jsonb NOT NULL DEFAULT '{}', created_at timestamptz NOT NULL DEFAULT now(), UNIQUE(organization_id,district_id,facility_id) ); CREATE TABLE IF NOT EXISTS facility_service_capacity (  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,  facility_id uuid NOT NULL REFERENCES facilities(id) ON DELETE CASCADE, service_code text NOT NULL, service_name text NOT NULL,  status text NOT NULL DEFAULT 'available' CHECK(status IN ('available','limited','unavailable','planned')),  capacity_total integer, capacity_available integer, wait_minutes integer, operating_hours jsonb NOT NULL DEFAULT '{}', metadata jsonb NOT NULL DEFAULT '{}', observed_at timestamptz NOT NULL DEFAULT now(), created_at timestamptz NOT NULL DEFAULT now() ); CREATE INDEX IF NOT EXISTS facility_service_capacity_idx ON facility_service_capacity(organization_id,facility_id,service_code,observed_at DESC); CREATE TABLE IF NOT EXISTS facility_resource_status (  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,  facility_id uuid NOT NULL REFERENCES facilities(id) ON DELETE CASCADE, resource_type text NOT NULL, resource_name text NOT NULL,  status text NOT NULL DEFAULT 'available' CHECK(status IN ('available','low','critical','unavailable','unknown')),  quantity numeric, unit text, threshold numeric, notes jsonb NOT NULL DEFAULT '{}', observed_at timestamptz NOT NULL DEFAULT now(), created_at timestamptz NOT NULL DEFAULT now() ); CREATE INDEX IF NOT EXISTS facility_resource_status_idx ON facility_resource_status(organization_id,facility_id,status,observed_at DESC); CREATE TABLE IF NOT EXISTS workforce_capacity_snapshots (  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,  facility_id uuid REFERENCES facilities(id) ON DELETE CASCADE, district_id uuid REFERENCES districts(id) ON DELETE CASCADE,  cadre text NOT NULL, scheduled_count integer NOT NULL DEFAULT 0, available_count integer NOT NULL DEFAULT 0, on_duty_count integer NOT NULL DEFAULT 0,  vacancy_count integer NOT NULL DEFAULT 0, snapshot_at timestamptz NOT NULL DEFAULT now(), metadata jsonb NOT NULL DEFAULT '{}' ); CREATE INDEX IF NOT EXISTS workforce_capacity_idx ON workforce_capacity_snapshots(organization_id,facility_id,cadre,snapshot_at DESC); CREATE TABLE IF NOT EXISTS facility_operational_incidents (  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,  facility_id uuid REFERENCES facilities(id) ON DELETE SET NULL, district_id uuid REFERENCES districts(id) ON DELETE SET NULL,  incident_type text NOT NULL, severity text NOT NULL DEFAULT 'moderate' CHECK(severity IN ('low','moderate','high','critical')),  status text NOT NULL DEFAULT 'open' CHECK(status IN ('open','acknowledged','mitigating','resolved','closed')),  title text NOT NULL, description text, started_at timestamptz NOT NULL DEFAULT now(), resolved_at timestamptz,  response_owner uuid REFERENCES users(id), impact jsonb NOT NULL DEFAULT '{}', created_by uuid REFERENCES users(id), created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now() ); CREATE INDEX IF NOT EXISTS facility_incidents_idx ON facility_operational_incidents(organization_id,status,severity,started_at DESC); CREATE TABLE IF NOT EXISTS facility_performance_snapshots (  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,  facility_id uuid REFERENCES facilities(id) ON DELETE CASCADE, district_id uuid REFERENCES districts(id) ON DELETE CASCADE,  period_start date NOT NULL, period_end date NOT NULL, indicator_code text NOT NULL, indicator_name text NOT NULL,  numerator numeric, denominator numeric, value_numeric numeric, unit text, quality_status text NOT NULL DEFAULT 'unreviewed', dimensions jsonb NOT NULL DEFAULT '{}', source text, created_at timestamptz NOT NULL DEFAULT now() ); CREATE INDEX IF NOT EXISTS facility_performance_idx ON facility_performance_snapshots(organization_id,period_end DESC,indicator_code,facility_id); CREATE TABLE IF NOT EXISTS referral_network_nodes (  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,  from_facility_id uuid NOT NULL REFERENCES facilities(id) ON DELETE CASCADE, to_facility_id uuid NOT NULL REFERENCES facilities(id) ON DELETE CASCADE,  service_code text, status text NOT NULL DEFAULT 'active' CHECK(status IN ('active','restricted','inactive')),  typical_wait_minutes integer, transport_notes jsonb NOT NULL DEFAULT '{}', metadata jsonb NOT NULL DEFAULT '{}', created_at timestamptz NOT NULL DEFAULT now(), UNIQUE(organization_id,from_facility_id,to_facility_id,service_code) ); CREATE INDEX IF NOT EXISTS referral_network_idx ON referral_network_nodes(organization_id,from_facility_id,status);

  ALTER TABLE insurance_policies ADD COLUMN IF NOT EXISTS organization_id uuid;
  UPDATE insurance_policies ip SET organization_id=p.organization_id FROM patients p WHERE ip.organization_id IS NULL AND ip.patient_id=p.id;
  DO $$ BEGIN IF EXISTS (SELECT 1 FROM insurance_policies WHERE organization_id IS NULL) THEN RAISE EXCEPTION 'insurance_policies organization backfill incomplete'; END IF; END $$;
  ALTER TABLE insurance_policies ALTER COLUMN organization_id SET NOT NULL;
  DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='insurance_policies_organization_id_fkey') THEN ALTER TABLE insurance_policies ADD CONSTRAINT insurance_policies_organization_id_fkey FOREIGN KEY (organization_id) REFERENCES organizations(id) ON DELETE CASCADE; END IF; END $$;

-- ---------------------------------------------------------------------------

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
    CREATE TABLE IF NOT EXISTS ai_providers (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(), organization_id uuid REFERENCES organizations(id) ON DELETE CASCADE,
      provider_key text NOT NULL, display_name text NOT NULL, enabled boolean NOT NULL DEFAULT true,
      governance_class text NOT NULL DEFAULT 'public-free', created_at timestamptz NOT NULL DEFAULT now(),
      UNIQUE(organization_id,provider_key)
    );
    CREATE TABLE IF NOT EXISTS ai_models (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(), provider_id uuid REFERENCES ai_providers(id) ON DELETE CASCADE,
      model_key text NOT NULL, display_name text NOT NULL, capability_profile jsonb NOT NULL DEFAULT '{}',
      enabled boolean NOT NULL DEFAULT true, priority integer NOT NULL DEFAULT 100, created_at timestamptz NOT NULL DEFAULT now(),
      UNIQUE(provider_id,model_key)
    );
    CREATE TABLE IF NOT EXISTS ai_provider_usage (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(), organization_id uuid REFERENCES organizations(id) ON DELETE CASCADE,
      provider_key text NOT NULL, model_key text NOT NULL, status text NOT NULL, http_status integer, latency_ms integer,
      input_tokens integer, output_tokens integer, error_code text, created_at timestamptz NOT NULL DEFAULT now()
    );
    CREATE INDEX IF NOT EXISTS ai_provider_usage_created_idx ON ai_provider_usage(organization_id,created_at DESC);
    CREATE INDEX IF NOT EXISTS ai_provider_usage_provider_idx ON ai_provider_usage(provider_key,model_key,created_at DESC);

-- ---------------------------------------------------------------------------

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

-- ---------------------------------------------------------------------------

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

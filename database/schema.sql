CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE organizations (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), name text NOT NULL, status text NOT NULL DEFAULT 'active', created_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE facilities (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), organization_id uuid NOT NULL REFERENCES organizations(id), name text NOT NULL, type text NOT NULL, timezone text NOT NULL DEFAULT 'Africa/Kampala', created_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE users (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), firebase_uid text UNIQUE NOT NULL, email text, display_name text, status text NOT NULL DEFAULT 'active', created_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE roles (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), organization_id uuid NOT NULL REFERENCES organizations(id), code text NOT NULL, name text NOT NULL, UNIQUE(organization_id, code));
CREATE TABLE user_roles (user_id uuid NOT NULL REFERENCES users(id), role_id uuid NOT NULL REFERENCES roles(id), PRIMARY KEY(user_id, role_id));

CREATE TABLE patients (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), organization_id uuid NOT NULL REFERENCES organizations(id), facility_id uuid REFERENCES facilities(id), patient_number text NOT NULL, first_name text NOT NULL, middle_name text, last_name text NOT NULL, date_of_birth date, sex text, phone text, email text, address jsonb, national_identifier text, preferred_language text, status text NOT NULL DEFAULT 'active', is_test_data boolean NOT NULL DEFAULT false, created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(), UNIQUE(organization_id, patient_number));
CREATE INDEX patients_org_name_idx ON patients(organization_id, last_name, first_name);
CREATE TABLE patient_contacts (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), patient_id uuid NOT NULL REFERENCES patients(id) ON DELETE CASCADE, type text NOT NULL, value text NOT NULL, is_primary boolean NOT NULL DEFAULT false);
CREATE TABLE emergency_contacts (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), patient_id uuid NOT NULL REFERENCES patients(id) ON DELETE CASCADE, name text NOT NULL, relationship text, phone text, address text);
CREATE TABLE allergies (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), patient_id uuid NOT NULL REFERENCES patients(id) ON DELETE CASCADE, substance text NOT NULL, reaction text, severity text, status text NOT NULL DEFAULT 'active');

CREATE TABLE appointments (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), organization_id uuid NOT NULL REFERENCES organizations(id), facility_id uuid REFERENCES facilities(id), patient_id uuid NOT NULL REFERENCES patients(id), provider_user_id uuid REFERENCES users(id), start_at timestamptz NOT NULL, end_at timestamptz, type text, status text NOT NULL DEFAULT 'scheduled', reason text, created_at timestamptz NOT NULL DEFAULT now());
CREATE INDEX appointments_provider_time_idx ON appointments(provider_user_id, start_at);
CREATE TABLE queues (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), organization_id uuid NOT NULL REFERENCES organizations(id), facility_id uuid REFERENCES facilities(id), code text NOT NULL, name text NOT NULL, UNIQUE(organization_id, code));
CREATE TABLE queue_entries (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), queue_id uuid NOT NULL REFERENCES queues(id), patient_id uuid NOT NULL REFERENCES patients(id), appointment_id uuid REFERENCES appointments(id), priority text NOT NULL DEFAULT 'normal', status text NOT NULL DEFAULT 'waiting', joined_at timestamptz NOT NULL DEFAULT now(), called_at timestamptz, completed_at timestamptz);

CREATE TABLE encounters (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), organization_id uuid NOT NULL REFERENCES organizations(id), facility_id uuid REFERENCES facilities(id), patient_id uuid NOT NULL REFERENCES patients(id), provider_user_id uuid REFERENCES users(id), appointment_id uuid REFERENCES appointments(id), type text NOT NULL, status text NOT NULL DEFAULT 'in-progress', started_at timestamptz NOT NULL DEFAULT now(), ended_at timestamptz);
CREATE TABLE clinical_notes (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), encounter_id uuid NOT NULL REFERENCES encounters(id) ON DELETE CASCADE, note_type text NOT NULL, subjective text, objective text, assessment text, plan text, signed_by uuid REFERENCES users(id), signed_at timestamptz, version integer NOT NULL DEFAULT 1);
CREATE TABLE observations (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), patient_id uuid NOT NULL REFERENCES patients(id), encounter_id uuid REFERENCES encounters(id), code_system text, code text, display text, value_numeric numeric, value_text text, unit text, observed_at timestamptz NOT NULL DEFAULT now(), performer_user_id uuid REFERENCES users(id));
CREATE TABLE diagnoses (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), patient_id uuid NOT NULL REFERENCES patients(id), encounter_id uuid REFERENCES encounters(id), code_system text, code text, display text NOT NULL, diagnosis_type text, status text NOT NULL DEFAULT 'active');
CREATE TABLE procedures (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), patient_id uuid NOT NULL REFERENCES patients(id), encounter_id uuid REFERENCES encounters(id), code_system text, code text, display text NOT NULL, performed_at timestamptz, performer_user_id uuid REFERENCES users(id));
CREATE TABLE care_plans (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), patient_id uuid NOT NULL REFERENCES patients(id), encounter_id uuid REFERENCES encounters(id), title text NOT NULL, status text NOT NULL DEFAULT 'active', goals jsonb NOT NULL DEFAULT '[]');
CREATE TABLE referrals (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), patient_id uuid NOT NULL REFERENCES patients(id), encounter_id uuid REFERENCES encounters(id), destination text, reason text NOT NULL, status text NOT NULL DEFAULT 'draft', created_at timestamptz NOT NULL DEFAULT now());

CREATE TABLE clinical_orders (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), patient_id uuid NOT NULL REFERENCES patients(id), encounter_id uuid REFERENCES encounters(id), ordered_by uuid REFERENCES users(id), order_type text NOT NULL, priority text NOT NULL DEFAULT 'routine', status text NOT NULL DEFAULT 'ordered', details jsonb NOT NULL DEFAULT '{}', created_at timestamptz NOT NULL DEFAULT now());
CREATE INDEX clinical_orders_patient_idx ON clinical_orders(patient_id, created_at DESC);

CREATE TABLE lab_tests (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), organization_id uuid NOT NULL REFERENCES organizations(id), code text, name text NOT NULL, specimen_type text, unit text, reference_range jsonb, active boolean NOT NULL DEFAULT true);
CREATE TABLE lab_samples (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), order_id uuid NOT NULL REFERENCES clinical_orders(id), barcode text UNIQUE NOT NULL, specimen_type text, status text NOT NULL DEFAULT 'ordered', collected_at timestamptz, received_at timestamptz, processed_at timestamptz);
CREATE TABLE lab_results (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), sample_id uuid NOT NULL REFERENCES lab_samples(id), test_id uuid NOT NULL REFERENCES lab_tests(id), value_numeric numeric, value_text text, unit text, abnormal_flag text, critical boolean NOT NULL DEFAULT false, status text NOT NULL DEFAULT 'preliminary', verified_by uuid REFERENCES users(id), verified_at timestamptz);

CREATE TABLE medications (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), organization_id uuid NOT NULL REFERENCES organizations(id), code text, name text NOT NULL, strength text, form text, route text, active boolean NOT NULL DEFAULT true);
CREATE TABLE medication_orders (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), patient_id uuid NOT NULL REFERENCES patients(id), encounter_id uuid REFERENCES encounters(id), medication_id uuid NOT NULL REFERENCES medications(id), dose text, frequency text, route text, duration text, quantity numeric, status text NOT NULL DEFAULT 'active', prescribed_by uuid REFERENCES users(id));
CREATE TABLE dispensations (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), medication_order_id uuid NOT NULL REFERENCES medication_orders(id), quantity numeric NOT NULL, batch text, expiry_date date, dispensed_by uuid REFERENCES users(id), dispensed_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE medication_administrations (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), medication_order_id uuid NOT NULL REFERENCES medication_orders(id), dose text, route text, scheduled_at timestamptz, administered_at timestamptz, status text NOT NULL, administered_by uuid REFERENCES users(id), reason text);

CREATE TABLE inventory_items (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), organization_id uuid NOT NULL REFERENCES organizations(id), sku text, name text NOT NULL, unit text, reorder_level numeric NOT NULL DEFAULT 0, active boolean NOT NULL DEFAULT true);
CREATE TABLE inventory_batches (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), item_id uuid NOT NULL REFERENCES inventory_items(id), batch_number text, expiry_date date, quantity numeric NOT NULL DEFAULT 0, location text);
CREATE TABLE stock_movements (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), item_id uuid NOT NULL REFERENCES inventory_items(id), batch_id uuid REFERENCES inventory_batches(id), movement_type text NOT NULL, quantity numeric NOT NULL, reference_type text, reference_id uuid, created_by uuid REFERENCES users(id), created_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE suppliers (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), organization_id uuid NOT NULL REFERENCES organizations(id), name text NOT NULL, contact jsonb);
CREATE TABLE purchase_orders (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), organization_id uuid NOT NULL REFERENCES organizations(id), supplier_id uuid REFERENCES suppliers(id), status text NOT NULL DEFAULT 'draft', created_at timestamptz NOT NULL DEFAULT now());

CREATE TABLE invoices (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), organization_id uuid NOT NULL REFERENCES organizations(id), patient_id uuid REFERENCES patients(id), encounter_id uuid REFERENCES encounters(id), status text NOT NULL DEFAULT 'open', currency char(3) NOT NULL DEFAULT 'UGX', total numeric NOT NULL DEFAULT 0, created_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE invoice_items (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), invoice_id uuid NOT NULL REFERENCES invoices(id) ON DELETE CASCADE, description text NOT NULL, quantity numeric NOT NULL DEFAULT 1, unit_price numeric NOT NULL, total numeric NOT NULL);
CREATE TABLE payments (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), invoice_id uuid NOT NULL REFERENCES invoices(id), method text NOT NULL, provider_reference text, amount numeric NOT NULL, status text NOT NULL DEFAULT 'pending', paid_at timestamptz);
CREATE TABLE insurance_providers (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), organization_id uuid NOT NULL REFERENCES organizations(id), name text NOT NULL);
CREATE TABLE insurance_policies (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), patient_id uuid NOT NULL REFERENCES patients(id), provider_id uuid NOT NULL REFERENCES insurance_providers(id), policy_number text NOT NULL, status text NOT NULL DEFAULT 'active', coverage jsonb);
CREATE TABLE claims (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), policy_id uuid REFERENCES insurance_policies(id), invoice_id uuid REFERENCES invoices(id), status text NOT NULL DEFAULT 'draft', external_reference text);

CREATE TABLE documents (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), organization_id uuid NOT NULL REFERENCES organizations(id), patient_id uuid REFERENCES patients(id), encounter_id uuid REFERENCES encounters(id), document_type text NOT NULL, storage_ref text NOT NULL, mime_type text, created_by uuid REFERENCES users(id), created_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE consents (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), patient_id uuid NOT NULL REFERENCES patients(id), consent_type text NOT NULL, version text NOT NULL, status text NOT NULL, captured_at timestamptz NOT NULL DEFAULT now(), captured_by uuid REFERENCES users(id));
CREATE TABLE notifications (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), organization_id uuid REFERENCES organizations(id), patient_id uuid REFERENCES patients(id), channel text NOT NULL, template text NOT NULL, status text NOT NULL DEFAULT 'queued', payload jsonb NOT NULL DEFAULT '{}', scheduled_at timestamptz, sent_at timestamptz, created_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE audit_logs (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), organization_id uuid REFERENCES organizations(id), actor_user_id uuid REFERENCES users(id), action text NOT NULL, entity_type text NOT NULL, entity_id uuid, metadata jsonb NOT NULL DEFAULT '{}', created_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE ai_interactions (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), organization_id uuid REFERENCES organizations(id), patient_id uuid REFERENCES patients(id), actor_user_id uuid REFERENCES users(id), model text NOT NULL, model_version text, prompt_version text, purpose text NOT NULL, input_hash text, output jsonb, approval_status text NOT NULL DEFAULT 'pending', created_at timestamptz NOT NULL DEFAULT now());

-- Reliability, workflow and governance infrastructure
CREATE TABLE IF NOT EXISTS idempotency_keys (
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  key text NOT NULL,
  response_code integer NOT NULL,
  response_body jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz,
  PRIMARY KEY (organization_id, key)
);
CREATE TABLE IF NOT EXISTS outbox_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid REFERENCES organizations(id),
  event_type text NOT NULL,
  aggregate_type text,
  aggregate_id uuid,
  payload jsonb NOT NULL DEFAULT '{}',
  status text NOT NULL DEFAULT 'pending',
  attempts integer NOT NULL DEFAULT 0,
  available_at timestamptz NOT NULL DEFAULT now(),
  processed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS outbox_pending_idx ON outbox_events(status, available_at);
CREATE TABLE IF NOT EXISTS consent_versions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id),
  consent_type text NOT NULL,
  version text NOT NULL,
  content_hash text NOT NULL,
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(organization_id, consent_type, version)
);
CREATE INDEX IF NOT EXISTS audit_logs_entity_idx ON audit_logs(entity_type, entity_id, created_at DESC);
CREATE INDEX IF NOT EXISTS notifications_patient_idx ON notifications(patient_id, created_at DESC);

-- V5 longitudinal identity / interoperability
CREATE TABLE IF NOT EXISTS patient_identifiers (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE, patient_id uuid NOT NULL REFERENCES patients(id) ON DELETE CASCADE, system text NOT NULL, value text NOT NULL, identifier_type text, use text NOT NULL DEFAULT 'usual', period_start timestamptz, period_end timestamptz, created_at timestamptz NOT NULL DEFAULT now(), UNIQUE(organization_id, system, value));
CREATE INDEX IF NOT EXISTS patient_identifiers_patient_idx ON patient_identifiers(patient_id, created_at DESC);
CREATE INDEX IF NOT EXISTS patient_identifiers_lookup_idx ON patient_identifiers(organization_id, system, value);
CREATE TABLE IF NOT EXISTS maternal_care_records (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE, patient_id uuid NOT NULL REFERENCES patients(id) ON DELETE CASCADE, gravida integer, para integer, lmp date, estimated_due_date date, gestational_age_weeks numeric, risk_status text NOT NULL DEFAULT 'not-assessed', risk_factors jsonb NOT NULL DEFAULT '{}', birth_plan jsonb NOT NULL DEFAULT '{}', source_guideline text, created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now());
CREATE INDEX IF NOT EXISTS maternal_records_patient_idx ON maternal_care_records(patient_id, created_at DESC);
CREATE TABLE IF NOT EXISTS maternal_care_contacts (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE, patient_id uuid NOT NULL REFERENCES patients(id) ON DELETE CASCADE, maternal_record_id uuid REFERENCES maternal_care_records(id) ON DELETE SET NULL, contact_number integer NOT NULL, contact_date timestamptz NOT NULL, gestational_age_weeks numeric, blood_pressure jsonb NOT NULL DEFAULT '{}', symphysio_fundal_height numeric, fetal_assessment jsonb NOT NULL DEFAULT '{}', laboratory jsonb NOT NULL DEFAULT '{}', preventive_care jsonb NOT NULL DEFAULT '{}', counselling jsonb NOT NULL DEFAULT '{}', danger_signs jsonb NOT NULL DEFAULT '{}', assessment text, plan text, referral_required boolean NOT NULL DEFAULT false, source_guideline text, created_at timestamptz NOT NULL DEFAULT now());
CREATE INDEX IF NOT EXISTS maternal_contacts_patient_idx ON maternal_care_contacts(patient_id, contact_date DESC);
CREATE TABLE IF NOT EXISTS birth_events (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE, mother_patient_id uuid NOT NULL REFERENCES patients(id) ON DELETE CASCADE, birth_datetime timestamptz NOT NULL, mode text NOT NULL, place_type text, facility_id uuid REFERENCES facilities(id) ON DELETE SET NULL, gestational_age_weeks numeric, multiple_birth boolean NOT NULL DEFAULT false, complications jsonb NOT NULL DEFAULT '{}', outcome text, referral jsonb NOT NULL DEFAULT '{}', source_guideline text, created_at timestamptz NOT NULL DEFAULT now());
CREATE INDEX IF NOT EXISTS birth_events_mother_idx ON birth_events(mother_patient_id, birth_datetime DESC);
CREATE TABLE IF NOT EXISTS newborn_records (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE, patient_id uuid REFERENCES patients(id) ON DELETE SET NULL, mother_patient_id uuid NOT NULL REFERENCES patients(id) ON DELETE CASCADE, birth_event_id uuid REFERENCES birth_events(id) ON DELETE SET NULL, sex text, birth_weight_grams numeric, gestational_age_weeks numeric, apgar jsonb NOT NULL DEFAULT '{}', feeding jsonb NOT NULL DEFAULT '{}', resuscitation jsonb NOT NULL DEFAULT '{}', danger_signs jsonb NOT NULL DEFAULT '{}', birth_defects_screening jsonb NOT NULL DEFAULT '{}', kangaroo_care jsonb NOT NULL DEFAULT '{}', referral jsonb NOT NULL DEFAULT '{}', source_guideline text, created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now());
CREATE INDEX IF NOT EXISTS newborns_mother_idx ON newborn_records(mother_patient_id, created_at DESC);
CREATE TABLE IF NOT EXISTS postnatal_contacts (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE, patient_id uuid NOT NULL REFERENCES patients(id) ON DELETE CASCADE, newborn_id uuid REFERENCES newborn_records(id) ON DELETE SET NULL, contact_date timestamptz NOT NULL, contact_timing text NOT NULL, maternal_assessment jsonb NOT NULL DEFAULT '{}', newborn_assessment jsonb NOT NULL DEFAULT '{}', feeding_support jsonb NOT NULL DEFAULT '{}', family_planning jsonb NOT NULL DEFAULT '{}', mental_health jsonb NOT NULL DEFAULT '{}', danger_signs jsonb NOT NULL DEFAULT '{}', referral_required boolean NOT NULL DEFAULT false, plan text, source_guideline text, created_at timestamptz NOT NULL DEFAULT now());
CREATE INDEX IF NOT EXISTS pnc_contacts_patient_idx ON postnatal_contacts(patient_id, contact_date DESC);

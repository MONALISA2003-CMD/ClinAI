CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE organizations (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), name text NOT NULL, status text NOT NULL DEFAULT 'active', created_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE facilities (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), organization_id uuid NOT NULL REFERENCES organizations(id), name text NOT NULL, type text NOT NULL, timezone text NOT NULL DEFAULT 'Africa/Kampala', created_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE users (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), firebase_uid text UNIQUE NOT NULL, email text, display_name text, status text NOT NULL DEFAULT 'active', created_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE roles (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), organization_id uuid NOT NULL REFERENCES organizations(id), code text NOT NULL, name text NOT NULL, UNIQUE(organization_id, code));
CREATE TABLE user_roles (user_id uuid NOT NULL REFERENCES users(id), role_id uuid NOT NULL REFERENCES roles(id), PRIMARY KEY(user_id, role_id));

CREATE TABLE patients (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), organization_id uuid NOT NULL REFERENCES organizations(id), facility_id uuid REFERENCES facilities(id), patient_number text NOT NULL, first_name text NOT NULL, middle_name text, last_name text NOT NULL, date_of_birth date, sex text, phone text, email text, address jsonb, national_identifier text, preferred_language text, status text NOT NULL DEFAULT 'active', created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(), UNIQUE(organization_id, patient_number));
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

-- V7 Uganda clinical pathway execution, reporting and offline synchronization
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

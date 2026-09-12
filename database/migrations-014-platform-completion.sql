-- ClinAI platform completion additions. Non-destructive: all objects use IF NOT EXISTS.
CREATE TABLE IF NOT EXISTS referral_transfers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  referral_id uuid NOT NULL REFERENCES referrals(id) ON DELETE CASCADE, from_facility_id uuid REFERENCES facilities(id) ON DELETE SET NULL,
  to_facility_id uuid REFERENCES facilities(id) ON DELETE SET NULL, service_code text, urgency text NOT NULL DEFAULT 'routine',
  status text NOT NULL DEFAULT 'requested' CHECK(status IN ('requested','accepted','declined','ready','departed','arrived','completed','cancelled')),
  requested_at timestamptz NOT NULL DEFAULT now(), accepted_at timestamptz, departed_at timestamptz, arrived_at timestamptz,
  outcome text, handover jsonb NOT NULL DEFAULT '{}', transport jsonb NOT NULL DEFAULT '{}', notes text,
  created_by uuid REFERENCES users(id), created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS referral_transfers_referral_idx ON referral_transfers(organization_id,referral_id,created_at DESC);
CREATE TABLE IF NOT EXISTS facility_beds (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  facility_id uuid NOT NULL REFERENCES facilities(id) ON DELETE CASCADE, ward text NOT NULL, room text, bed_number text NOT NULL,
  bed_type text, status text NOT NULL DEFAULT 'available' CHECK(status IN ('available','occupied','cleaning','blocked','reserved')),
  patient_id uuid REFERENCES patients(id) ON DELETE SET NULL, admission_id uuid REFERENCES admissions(id) ON DELETE SET NULL,
  observed_at timestamptz NOT NULL DEFAULT now(), metadata jsonb NOT NULL DEFAULT '{}', UNIQUE(facility_id,ward,bed_number)
);
CREATE INDEX IF NOT EXISTS facility_beds_status_idx ON facility_beds(organization_id,facility_id,status);
CREATE TABLE IF NOT EXISTS imaging_studies (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  patient_id uuid NOT NULL REFERENCES patients(id) ON DELETE CASCADE, encounter_id uuid REFERENCES encounters(id) ON DELETE SET NULL,
  order_id uuid REFERENCES clinical_orders(id) ON DELETE SET NULL, study_code text, study_name text NOT NULL, modality text,
  body_site text, priority text NOT NULL DEFAULT 'routine', status text NOT NULL DEFAULT 'ordered', scheduled_at timestamptz,
  performed_at timestamptz, report text, critical boolean NOT NULL DEFAULT false, report_verified_at timestamptz,
  report_released_at timestamptz, created_by uuid REFERENCES users(id), created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS imaging_studies_patient_idx ON imaging_studies(organization_id,patient_id,created_at DESC);
CREATE TABLE IF NOT EXISTS medication_reconciliation (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  patient_id uuid NOT NULL REFERENCES patients(id) ON DELETE CASCADE, encounter_id uuid REFERENCES encounters(id) ON DELETE SET NULL,
  source text NOT NULL DEFAULT 'clinical-review', status text NOT NULL DEFAULT 'in-review', medicines jsonb NOT NULL DEFAULT '[]', discrepancies jsonb NOT NULL DEFAULT '[]',
  resolved_count integer NOT NULL DEFAULT 0, reviewed_by uuid REFERENCES users(id), reviewed_at timestamptz, created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS medication_reconciliation_patient_idx ON medication_reconciliation(organization_id,patient_id,created_at DESC);
CREATE TABLE IF NOT EXISTS accounting_entries (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  entry_date date NOT NULL DEFAULT current_date, account_code text, description text NOT NULL, entry_type text NOT NULL CHECK(entry_type IN ('income','expense','adjustment')),
  amount numeric NOT NULL, currency char(3) NOT NULL DEFAULT 'UGX', reference_type text, reference_id uuid, status text NOT NULL DEFAULT 'posted', created_by uuid REFERENCES users(id), created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS accounting_entries_date_idx ON accounting_entries(organization_id,entry_date DESC);
CREATE TABLE IF NOT EXISTS procurement_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  supplier_id uuid REFERENCES suppliers(id) ON DELETE SET NULL, requested_by uuid REFERENCES users(id), description text NOT NULL, quantity numeric NOT NULL DEFAULT 1,
  status text NOT NULL DEFAULT 'requested', requested_at timestamptz NOT NULL DEFAULT now(), approved_at timestamptz, received_at timestamptz, notes jsonb NOT NULL DEFAULT '{}'
);
CREATE INDEX IF NOT EXISTS procurement_requests_status_idx ON procurement_requests(organization_id,status,requested_at DESC);
CREATE TABLE IF NOT EXISTS patient_portal_accounts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  patient_id uuid NOT NULL REFERENCES patients(id) ON DELETE CASCADE, email text, phone text, status text NOT NULL DEFAULT 'invited',
  last_login_at timestamptz, notification_preferences jsonb NOT NULL DEFAULT '{}', created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(), UNIQUE(organization_id,patient_id)
);
CREATE TABLE IF NOT EXISTS communication_deliveries (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  notification_id uuid REFERENCES notifications(id) ON DELETE SET NULL, patient_id uuid REFERENCES patients(id) ON DELETE SET NULL,
  channel text NOT NULL, status text NOT NULL DEFAULT 'queued', provider_reference text, attempts integer NOT NULL DEFAULT 0, last_error text,
  scheduled_at timestamptz, sent_at timestamptz, created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS communication_deliveries_status_idx ON communication_deliveries(organization_id,status,created_at DESC);

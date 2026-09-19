BEGIN;
CREATE TABLE IF NOT EXISTS organization_settings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  category text NOT NULL,
  name text NOT NULL,
  value text NOT NULL,
  value_type text NOT NULL DEFAULT 'text' CHECK (value_type IN ('text','number','boolean','json')),
  description text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organization_id, category, name)
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
CREATE INDEX IF NOT EXISTS health_worker_profiles_org_status_idx ON health_worker_profiles(organization_id,status,facility_id);
CREATE INDEX IF NOT EXISTS facilities_org_name_idx ON facilities(organization_id,name);
CREATE INDEX IF NOT EXISTS hie_connections_org_status_idx ON hie_connections(organization_id,status,updated_at DESC);
CREATE INDEX IF NOT EXISTS hie_messages_org_status_idx ON hie_messages(organization_id,status,created_at DESC);
CREATE INDEX IF NOT EXISTS security_events_org_severity_idx ON security_events(organization_id,severity,created_at DESC);
CREATE INDEX IF NOT EXISTS reporting_submissions_org_status_idx ON reporting_submissions(organization_id,status,created_at DESC);
CREATE INDEX IF NOT EXISTS offline_sync_org_status_idx ON offline_sync_queue(organization_id,status,created_at DESC);
CREATE INDEX IF NOT EXISTS encounters_org_status_idx ON encounters(organization_id,status);
CREATE INDEX IF NOT EXISTS facility_beds_org_status_idx ON facility_beds(organization_id,status);
CREATE INDEX IF NOT EXISTS clinical_orders_patient_type_status_idx ON clinical_orders(patient_id,order_type,status,created_at DESC);
COMMIT;

CREATE TABLE IF NOT EXISTS districts (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
 name text NOT NULL, code text, region text, status text NOT NULL DEFAULT 'active', metadata jsonb NOT NULL DEFAULT '{}', created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(), UNIQUE(organization_id,name)
);
CREATE TABLE IF NOT EXISTS district_facility_links (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
 district_id uuid NOT NULL REFERENCES districts(id) ON DELETE CASCADE, facility_id uuid NOT NULL REFERENCES facilities(id) ON DELETE CASCADE,
 relationship text NOT NULL DEFAULT 'serves', effective_from timestamptz, effective_to timestamptz, metadata jsonb NOT NULL DEFAULT '{}', created_at timestamptz NOT NULL DEFAULT now(), UNIQUE(organization_id,district_id,facility_id)
);
CREATE TABLE IF NOT EXISTS facility_service_capacity (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
 facility_id uuid NOT NULL REFERENCES facilities(id) ON DELETE CASCADE, service_code text NOT NULL, service_name text NOT NULL,
 status text NOT NULL DEFAULT 'available' CHECK(status IN ('available','limited','unavailable','planned')),
 capacity_total integer, capacity_available integer, wait_minutes integer, operating_hours jsonb NOT NULL DEFAULT '{}', metadata jsonb NOT NULL DEFAULT '{}', observed_at timestamptz NOT NULL DEFAULT now(), created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS facility_service_capacity_idx ON facility_service_capacity(organization_id,facility_id,service_code,observed_at DESC);
CREATE TABLE IF NOT EXISTS facility_resource_status (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
 facility_id uuid NOT NULL REFERENCES facilities(id) ON DELETE CASCADE, resource_type text NOT NULL, resource_name text NOT NULL,
 status text NOT NULL DEFAULT 'available' CHECK(status IN ('available','low','critical','unavailable','unknown')),
 quantity numeric, unit text, threshold numeric, notes jsonb NOT NULL DEFAULT '{}', observed_at timestamptz NOT NULL DEFAULT now(), created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS facility_resource_status_idx ON facility_resource_status(organization_id,facility_id,status,observed_at DESC);
CREATE TABLE IF NOT EXISTS workforce_capacity_snapshots (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
 facility_id uuid REFERENCES facilities(id) ON DELETE CASCADE, district_id uuid REFERENCES districts(id) ON DELETE CASCADE,
 cadre text NOT NULL, scheduled_count integer NOT NULL DEFAULT 0, available_count integer NOT NULL DEFAULT 0, on_duty_count integer NOT NULL DEFAULT 0,
 vacancy_count integer NOT NULL DEFAULT 0, snapshot_at timestamptz NOT NULL DEFAULT now(), metadata jsonb NOT NULL DEFAULT '{}'
);
CREATE INDEX IF NOT EXISTS workforce_capacity_idx ON workforce_capacity_snapshots(organization_id,facility_id,cadre,snapshot_at DESC);
CREATE TABLE IF NOT EXISTS facility_operational_incidents (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
 facility_id uuid REFERENCES facilities(id) ON DELETE SET NULL, district_id uuid REFERENCES districts(id) ON DELETE SET NULL,
 incident_type text NOT NULL, severity text NOT NULL DEFAULT 'moderate' CHECK(severity IN ('low','moderate','high','critical')),
 status text NOT NULL DEFAULT 'open' CHECK(status IN ('open','acknowledged','mitigating','resolved','closed')),
 title text NOT NULL, description text, started_at timestamptz NOT NULL DEFAULT now(), resolved_at timestamptz,
 response_owner uuid REFERENCES users(id), impact jsonb NOT NULL DEFAULT '{}', created_by uuid REFERENCES users(id), created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS facility_incidents_idx ON facility_operational_incidents(organization_id,status,severity,started_at DESC);
CREATE TABLE IF NOT EXISTS facility_performance_snapshots (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
 facility_id uuid REFERENCES facilities(id) ON DELETE CASCADE, district_id uuid REFERENCES districts(id) ON DELETE CASCADE,
 period_start date NOT NULL, period_end date NOT NULL, indicator_code text NOT NULL, indicator_name text NOT NULL,
 numerator numeric, denominator numeric, value_numeric numeric, unit text, quality_status text NOT NULL DEFAULT 'unreviewed', dimensions jsonb NOT NULL DEFAULT '{}', source text, created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS facility_performance_idx ON facility_performance_snapshots(organization_id,period_end DESC,indicator_code,facility_id);
CREATE TABLE IF NOT EXISTS referral_network_nodes (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
 from_facility_id uuid NOT NULL REFERENCES facilities(id) ON DELETE CASCADE, to_facility_id uuid NOT NULL REFERENCES facilities(id) ON DELETE CASCADE,
 service_code text, status text NOT NULL DEFAULT 'active' CHECK(status IN ('active','restricted','inactive')),
 typical_wait_minutes integer, transport_notes jsonb NOT NULL DEFAULT '{}', metadata jsonb NOT NULL DEFAULT '{}', created_at timestamptz NOT NULL DEFAULT now(), UNIQUE(organization_id,from_facility_id,to_facility_id,service_code)
);
CREATE INDEX IF NOT EXISTS referral_network_idx ON referral_network_nodes(organization_id,from_facility_id,status);

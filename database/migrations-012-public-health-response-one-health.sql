CREATE TABLE IF NOT EXISTS public_health_investigations (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
 surveillance_case_id uuid REFERENCES surveillance_cases(id) ON DELETE SET NULL, event_id uuid REFERENCES surveillance_events(id) ON DELETE SET NULL,
 investigation_type text NOT NULL, status text NOT NULL DEFAULT 'open' CHECK(status IN ('open','under-review','completed','closed')),
 lead_user_id uuid REFERENCES users(id), started_at timestamptz NOT NULL DEFAULT now(), completed_at timestamptz,
 findings jsonb NOT NULL DEFAULT '{}', verification jsonb NOT NULL DEFAULT '{}', risk_assessment jsonb NOT NULL DEFAULT '{}', source_guideline text,
 created_by uuid REFERENCES users(id), created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS public_health_investigations_org_status_idx ON public_health_investigations(organization_id,status,started_at DESC);

CREATE TABLE IF NOT EXISTS public_health_contacts (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
 investigation_id uuid REFERENCES public_health_investigations(id) ON DELETE CASCADE, patient_id uuid REFERENCES patients(id) ON DELETE SET NULL,
 contact_type text NOT NULL, exposure_start timestamptz, exposure_end timestamptz, relationship text, location jsonb NOT NULL DEFAULT '{}',
 risk_level text NOT NULL DEFAULT 'routine' CHECK(risk_level IN ('routine','moderate','high','urgent')),
 status text NOT NULL DEFAULT 'identified' CHECK(status IN ('identified','notified','monitoring','cleared','lost-to-follow-up')),
 notes jsonb NOT NULL DEFAULT '{}', created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS public_health_contacts_investigation_idx ON public_health_contacts(organization_id,investigation_id,status);

CREATE TABLE IF NOT EXISTS public_health_response_tasks (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
 investigation_id uuid REFERENCES public_health_investigations(id) ON DELETE CASCADE, event_id uuid REFERENCES surveillance_events(id) ON DELETE SET NULL,
 task_type text NOT NULL, title text NOT NULL, priority text NOT NULL DEFAULT 'routine' CHECK(priority IN ('routine','high','urgent','critical')),
 status text NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','assigned','in-progress','blocked','completed','cancelled')),
 assigned_to uuid REFERENCES users(id), due_at timestamptz, completed_at timestamptz, escalation_level integer NOT NULL DEFAULT 0,
 evidence jsonb NOT NULL DEFAULT '{}', requires_human_approval boolean NOT NULL DEFAULT true, created_by uuid REFERENCES users(id), created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS public_health_response_tasks_queue_idx ON public_health_response_tasks(organization_id,status,priority,due_at);

CREATE TABLE IF NOT EXISTS public_health_alerts (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
 alert_type text NOT NULL, severity text NOT NULL DEFAULT 'high' CHECK(severity IN ('routine','high','urgent','critical')),
 title text NOT NULL, message text NOT NULL, source_event_id uuid REFERENCES surveillance_events(id) ON DELETE SET NULL,
 source_investigation_id uuid REFERENCES public_health_investigations(id) ON DELETE SET NULL,
 status text NOT NULL DEFAULT 'pending-review' CHECK(status IN ('pending-review','acknowledged','escalated','resolved','dismissed')),
 generated_reason jsonb NOT NULL DEFAULT '{}', reviewed_by uuid REFERENCES users(id), reviewed_at timestamptz,
 created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS public_health_alerts_org_status_idx ON public_health_alerts(organization_id,status,created_at DESC);

CREATE TABLE IF NOT EXISTS mortality_surveillance_records (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
 patient_id uuid REFERENCES patients(id) ON DELETE SET NULL, facility_id uuid REFERENCES facilities(id) ON DELETE SET NULL,
 death_datetime timestamptz NOT NULL, place_of_death text, immediate_cause text, underlying_cause text, contributing_conditions jsonb NOT NULL DEFAULT '[]',
 maternal_death boolean NOT NULL DEFAULT false, neonatal_death boolean NOT NULL DEFAULT false, review_status text NOT NULL DEFAULT 'pending' CHECK(review_status IN ('pending','under-review','reviewed','closed')),
 review_findings jsonb NOT NULL DEFAULT '{}', source_guideline text, created_by uuid REFERENCES users(id), created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS mortality_surveillance_org_date_idx ON mortality_surveillance_records(organization_id,death_datetime DESC);

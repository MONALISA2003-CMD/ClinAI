CREATE TABLE IF NOT EXISTS child_care_gaps (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
 patient_id uuid NOT NULL REFERENCES patients(id) ON DELETE CASCADE,
 gap_type text NOT NULL,
 status text NOT NULL DEFAULT 'open' CHECK (status IN ('open','acknowledged','resolved','dismissed')),
 priority text NOT NULL DEFAULT 'routine' CHECK (priority IN ('routine','high','urgent')),
 title text NOT NULL,
 description text,
 evidence jsonb NOT NULL DEFAULT '{}',
 source_guideline text,
 detected_at timestamptz NOT NULL DEFAULT now(),
 resolved_at timestamptz,
 resolved_by uuid REFERENCES users(id),
 created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS child_care_gaps_patient_idx ON child_care_gaps(patient_id,status,detected_at DESC);

CREATE TABLE IF NOT EXISTS immunization_catchup_plans (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
 patient_id uuid NOT NULL REFERENCES patients(id) ON DELETE CASCADE,
 jurisdiction text NOT NULL DEFAULT 'UG',
 status text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','active','completed','cancelled')),
 plan_items jsonb NOT NULL DEFAULT '[]',
 rationale jsonb NOT NULL DEFAULT '{}',
 source_guideline text,
 clinician_review_required boolean NOT NULL DEFAULT true,
 reviewed_by uuid REFERENCES users(id),
 reviewed_at timestamptz,
 created_by uuid REFERENCES users(id),
 created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS immunization_catchup_patient_idx ON immunization_catchup_plans(patient_id,status,created_at DESC);

CREATE TABLE IF NOT EXISTS care_graph_edges (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
 patient_id uuid NOT NULL REFERENCES patients(id) ON DELETE CASCADE,
 source_type text NOT NULL,
 source_id uuid,
 target_type text NOT NULL,
 target_id uuid,
 relationship text NOT NULL,
 metadata jsonb NOT NULL DEFAULT '{}',
 created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS care_graph_patient_idx ON care_graph_edges(patient_id,created_at DESC);

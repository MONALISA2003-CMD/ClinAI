CREATE TABLE IF NOT EXISTS child_health_visits (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
 patient_id uuid NOT NULL REFERENCES patients(id) ON DELETE CASCADE,
 encounter_id uuid REFERENCES encounters(id) ON DELETE SET NULL,
 visit_date timestamptz NOT NULL DEFAULT now(),
 age_days integer,
 age_months numeric,
 weight_kg numeric,
 length_height_cm numeric,
 head_circumference_cm numeric,
 muac_mm numeric,
 temperature_c numeric,
 respiratory_rate numeric,
 spo2 numeric,
 feeding_assessment jsonb NOT NULL DEFAULT '{}',
 developmental_assessment jsonb NOT NULL DEFAULT '{}',
 danger_signs jsonb NOT NULL DEFAULT '{}',
 clinical_assessment jsonb NOT NULL DEFAULT '{}',
 plan jsonb NOT NULL DEFAULT '{}',
 referral_required boolean NOT NULL DEFAULT false,
 source_guideline text,
 created_by uuid REFERENCES users(id),
 created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS child_health_visits_patient_idx ON child_health_visits(patient_id, visit_date DESC);

CREATE TABLE IF NOT EXISTS child_growth_measurements (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
 patient_id uuid NOT NULL REFERENCES patients(id) ON DELETE CASCADE,
 measured_at timestamptz NOT NULL DEFAULT now(),
 age_days integer,
 weight_kg numeric,
 length_height_cm numeric,
 head_circumference_cm numeric,
 muac_mm numeric,
 z_scores jsonb NOT NULL DEFAULT '{}',
 growth_interpretation text,
 source_standard text,
 created_by uuid REFERENCES users(id),
 created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS child_growth_patient_idx ON child_growth_measurements(patient_id, measured_at DESC);

CREATE TABLE IF NOT EXISTS child_imci_assessments (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
 patient_id uuid NOT NULL REFERENCES patients(id) ON DELETE CASCADE,
 encounter_id uuid REFERENCES encounters(id) ON DELETE SET NULL,
 assessed_at timestamptz NOT NULL DEFAULT now(),
 age_months numeric,
 general_danger_signs jsonb NOT NULL DEFAULT '{}',
 cough_breathing jsonb NOT NULL DEFAULT '{}',
 diarrhoea jsonb NOT NULL DEFAULT '{}',
 fever jsonb NOT NULL DEFAULT '{}',
 ear_problem jsonb NOT NULL DEFAULT '{}',
 nutrition_anemia jsonb NOT NULL DEFAULT '{}',
 immunization_status jsonb NOT NULL DEFAULT '{}',
 feeding_status jsonb NOT NULL DEFAULT '{}',
 classifications jsonb NOT NULL DEFAULT '{}',
 plan jsonb NOT NULL DEFAULT '{}',
 referral_required boolean NOT NULL DEFAULT false,
 source_guideline text,
 created_by uuid REFERENCES users(id),
 created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS child_imci_patient_idx ON child_imci_assessments(patient_id, assessed_at DESC);

CREATE TABLE IF NOT EXISTS immunization_reviews (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
 patient_id uuid NOT NULL REFERENCES patients(id) ON DELETE CASCADE,
 reviewed_at timestamptz NOT NULL DEFAULT now(),
 jurisdiction text NOT NULL DEFAULT 'UG',
 due_items jsonb NOT NULL DEFAULT '[]',
 overdue_items jsonb NOT NULL DEFAULT '[]',
 completed_items jsonb NOT NULL DEFAULT '[]',
 next_review_at timestamptz,
 source_guideline text,
 created_by uuid REFERENCES users(id),
 created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS immunization_reviews_patient_idx ON immunization_reviews(patient_id, reviewed_at DESC);

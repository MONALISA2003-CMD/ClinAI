-- ClinAI Phase 3: diagnostics and medication depth.
-- Additive only. No DROP, TRUNCATE or DELETE.
-- Existing protected/non-test records are never rewritten by this migration.

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

CREATE TABLE IF NOT EXISTS imaging_studies (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  patient_id uuid NOT NULL REFERENCES patients(id) ON DELETE CASCADE,
  encounter_id uuid REFERENCES encounters(id) ON DELETE SET NULL,
  order_id uuid REFERENCES clinical_orders(id) ON DELETE SET NULL,
  study_code text, study_name text NOT NULL, modality text, body_site text,
  priority text NOT NULL DEFAULT 'routine', status text NOT NULL DEFAULT 'scheduled',
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

CREATE TABLE IF NOT EXISTS medication_reconciliation (
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
CREATE TABLE IF NOT EXISTS medication_reconciliation_items (
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

-- Synthetic continuity depth: only TEST patients, and only where no equivalent row exists.
INSERT INTO imaging_studies(organization_id,patient_id,encounter_id,study_code,study_name,modality,body_site,priority,status,scheduled_at,performed_at,report,findings,impression,critical,report_verified_at,report_released_at,created_at,updated_at)
SELECT p.organization_id,p.id,e.id,v.study_code,v.study_name,v.modality,v.body_site,v.priority,v.status,v.scheduled_at,v.performed_at,v.report,v.findings,v.impression,v.critical,v.verified_at,v.released_at,v.created_at,v.created_at
FROM patients p
LEFT JOIN LATERAL (SELECT id FROM encounters WHERE patient_id=p.id AND organization_id=p.organization_id ORDER BY started_at DESC LIMIT 1) e ON true
JOIN (VALUES
 ('TEST-005','XR-CHEST-005','Chest X-ray','X-ray','chest','urgent','released',current_timestamp-interval '10 hours',current_timestamp-interval '9 hours','Synthetic chest radiograph report','Bilateral air-space changes documented in the synthetic scenario.','Findings require clinical correlation with the recorded respiratory presentation.',true,current_timestamp-interval '8 hours',current_timestamp-interval '7 hours',current_timestamp-interval '10 hours'),
 ('TEST-016','XR-TRAUMA-016','Trauma radiograph','X-ray','lower limb','stat','released',current_timestamp-interval '2 days',current_timestamp-interval '46 hours','Synthetic trauma imaging report','Fracture findings documented in the synthetic trauma journey.','Report supports the recorded surgical pathway.',false,current_timestamp-interval '44 hours',current_timestamp-interval '43 hours',current_timestamp-interval '2 days'),
 ('TEST-018','US-ABD-018','Abdominal ultrasound','Ultrasound','abdomen','urgent','verified',current_timestamp-interval '6 hours',current_timestamp-interval '5 hours','Synthetic abdominal imaging report','Localized abdominal findings documented for the synthetic appendicitis journey.','Verified imaging result is ready for clinician review.',false,current_timestamp-interval '4 hours',NULL,current_timestamp-interval '6 hours'),
 ('TEST-020','XR-CHEST-020','Chest X-ray','X-ray','chest','routine','scheduled',current_timestamp+interval '2 hours',NULL,NULL,NULL,NULL,false,NULL,NULL,current_timestamp)
) v(patient_number,study_code,study_name,modality,body_site,priority,status,scheduled_at,performed_at,report,findings,impression,critical,verified_at,released_at,created_at) ON v.patient_number=p.patient_number
WHERE p.is_test_data=true
  AND NOT EXISTS (SELECT 1 FROM imaging_studies i WHERE i.patient_id=p.id AND i.study_code=v.study_code);

INSERT INTO medication_reconciliation_items(reconciliation_id,patient_id,medication_order_id,medication_id,medication_name,dose,frequency,route,discrepancy_type,status,notes)
SELECT mr.id,p.id,mo.id,mo.medication_id,m.name,mo.dose,mo.frequency,mo.route,v.discrepancy_type,'open',v.notes
FROM patients p
JOIN medication_reconciliation mr ON mr.patient_id=p.id
JOIN medication_orders mo ON mo.patient_id=p.id
JOIN medications m ON m.id=mo.medication_id
JOIN (VALUES
 ('TEST-004','Metformin discrepancy','Recorded home dose requires confirmation.'),
 ('TEST-019','Duplicate medication history','Medication history contains an item requiring pharmacist review.'),
 ('TEST-030','Dose reconciliation','Longitudinal medication dose should be confirmed against the current treatment record.')
) v(patient_number,discrepancy_type,notes) ON v.patient_number=p.patient_number
WHERE p.is_test_data=true AND mr.status='in-review'
  AND NOT EXISTS (SELECT 1 FROM medication_reconciliation_items x WHERE x.reconciliation_id=mr.id AND x.patient_id=p.id);

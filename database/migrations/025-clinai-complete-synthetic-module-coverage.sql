-- ClinAI 025: complete synthetic patient/module coverage.
-- Additive and idempotent only. No DROP, TRUNCATE, DELETE, reset, or destructive rewrite.
-- Every TEST-001..TEST-030 receives a patient-linked synthetic test record in every
-- advertised workspace except Command Center (which is an aggregate workspace).
-- These records are intentionally patient-linked so every workspace can be explored
-- with the same 30 synthetic patients. Existing clinical tables remain authoritative.

CREATE INDEX IF NOT EXISTS idx_module_records_payload_test_patient
  ON module_records ((payload->>'patientNumber'), module)
  WHERE payload->>'isTestData'='true';

WITH module_catalog(module) AS (
  VALUES
  ('patients'),
  ('appointments'),
  ('registration'),
  ('queue'),
  ('triage'),
  ('encounters'),
  ('clinical-notes'),
  ('diagnoses'),
  ('orders'),
  ('care-plans'),
  ('referrals'),
  ('referral-transfers'),
  ('follow-up'),
  ('care-tasks'),
  ('laboratory'),
  ('imaging'),
  ('pharmacy'),
  ('nursing'),
  ('emergency'),
  ('inpatient'),
  ('beds'),
  ('surgery'),
  ('maternity'),
  ('pediatrics'),
  ('child-health'),
  ('immunization'),
  ('chronic-care'),
  ('medication-reconciliation'),
  ('consents'),
  ('billing'),
  ('payments'),
  ('insurance'),
  ('claims'),
  ('accounting'),
  ('inventory'),
  ('procurement'),
  ('suppliers'),
  ('patient-portal'),
  ('portal-messages'),
  ('telemedicine'),
  ('remote-monitoring'),
  ('notifications'),
  ('documents'),
  ('surveillance'),
  ('investigations'),
  ('response'),
  ('mortality'),
  ('population-health'),
  ('district-intelligence'),
  ('staff'),
  ('facilities'),
  ('facility-capacity'),
  ('facility-resources'),
  ('facility-incidents'),
  ('facility-performance'),
  ('referral-network'),
  ('ai'),
  ('ai-evaluations'),
  ('analytics'),
  ('care-gaps'),
  ('care-graph'),
  ('patient-360-intelligence'),
  ('clinical-velocity'),
  ('value-based-care'),
  ('ai-risk-management'),
  ('ai-security-management'),
  ('ai-governance'),
  ('tasks'),
  ('workflows'),
  ('interoperability'),
  ('health-connections'),
  ('audit'),
  ('security'),
  ('settings'),
  ('terminology'),
  ('guidelines'),
  ('care-pathways'),
  ('reporting'),
  ('offline-sync')
),
patients_30 AS (
  SELECT p.id,p.organization_id,p.patient_number,p.first_name,p.last_name,
         COALESCE((SELECT d.display FROM diagnoses d WHERE d.patient_id=p.id ORDER BY d.id DESC LIMIT 1),'Longitudinal synthetic care journey') AS clinical_context,
         (SELECT e.id FROM encounters e WHERE e.patient_id=p.id AND e.organization_id=p.organization_id ORDER BY e.started_at DESC LIMIT 1) AS encounter_id
  FROM patients p
  WHERE p.is_test_data=true
    AND p.patient_number ~ '^TEST-[0-9]{3}$'
)
INSERT INTO module_records(organization_id,module,status,payload)
SELECT p.organization_id,mc.module,
       CASE ((substring(p.patient_number from 6)::int + length(mc.module)) % 7)
         WHEN 0 THEN 'active'
         WHEN 1 THEN 'completed'
         WHEN 2 THEN 'in-review'
         WHEN 3 THEN 'open'
         WHEN 4 THEN 'ready'
         WHEN 5 THEN 'pending'
         ELSE 'observed'
       END,
       jsonb_build_object(
         'isTestData',true,
         'patientId',p.id,
         'patientNumber',p.patient_number,
         'patientName',trim(p.first_name||' '||p.last_name),
         'encounterId',p.encounter_id,
         'module',mc.module,
         'title',initcap(replace(mc.module,'-',' '))||' · '||p.patient_number,
         'detail','Patient-linked synthetic test record for '||initcap(replace(mc.module,'-',' '))||'. Clinical context: '||p.clinical_context||'.',
         'clinicalContext',p.clinical_context,
         'journey','30-patient-connected-test-environment',
         'source','synthetic-test-data',
         'testPatient',true,
         'coverageVersion','025'
       )
FROM patients_30 p
CROSS JOIN module_catalog mc
WHERE NOT EXISTS (
  SELECT 1 FROM module_records mr
  WHERE mr.organization_id=p.organization_id
    AND mr.module=mc.module
    AND mr.payload->>'patientNumber'=p.patient_number
    AND mr.payload->>'coverageVersion'='025'
);

-- Ensure the expected synthetic population itself is visible to the coverage audit.
CREATE OR REPLACE VIEW clinai_synthetic_module_coverage AS
SELECT p.patient_number AS "patientNumber",
       count(DISTINCT mr.module)::int AS "modulesCovered",
       count(mr.id)::int AS "recordsCovered"
FROM patients p
LEFT JOIN module_records mr
  ON mr.organization_id=p.organization_id
 AND mr.payload->>'patientNumber'=p.patient_number
 AND mr.payload->>'isTestData'='true'
WHERE p.is_test_data=true AND p.patient_number ~ '^TEST-[0-9]{3}$'
GROUP BY p.patient_number;

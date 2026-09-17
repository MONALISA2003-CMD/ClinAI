-- ClinAI Phase 2 longitudinal completion. Additive and idempotent.
-- No DROP, TRUNCATE, DELETE, or UPDATE of existing clinical data.
-- Extends the 30 synthetic journeys already seeded by clinai-synthetic-test-data.sql.

INSERT INTO clinical_notes(encounter_id,note_type,subjective,objective,assessment,plan)
SELECT e.id,'progress',
       'Synthetic longitudinal visit for '||p.patient_number,
       'Vitals and structured findings recorded in the test journey.',
       'Synthetic assessment: '||COALESCE((SELECT string_agg(d.display,', ') FROM diagnoses d WHERE d.patient_id=p.id),'active care episode'),
       'Continue documented care pathway and arrange follow-up.'
FROM encounters e
JOIN patients p ON p.id=e.patient_id
WHERE p.is_test_data
  AND NOT EXISTS (SELECT 1 FROM clinical_notes n WHERE n.encounter_id=e.id);

INSERT INTO care_plans(patient_id,encounter_id,title,status,goals)
SELECT p.id,e.id,'Synthetic longitudinal care plan','active',
       jsonb_build_array(
         jsonb_build_object('goal','Resolve or stabilize the presenting condition','target','Follow-up documented'),
         jsonb_build_object('goal','Close outstanding care gaps','target','Tasks completed')
       )
FROM patients p
JOIN LATERAL (SELECT id FROM encounters WHERE patient_id=p.id ORDER BY started_at DESC LIMIT 1) e ON true
WHERE p.is_test_data
  AND NOT EXISTS (SELECT 1 FROM care_plans cp WHERE cp.patient_id=p.id);

INSERT INTO allergies(patient_id,substance,reaction,severity,status)
SELECT p.id,v.substance,v.reaction,v.severity,'active'
FROM patients p
JOIN (VALUES
 ('TEST-004','Penicillin','rash','moderate'),
 ('TEST-019','NSAIDs','gastric symptoms','moderate'),
 ('TEST-030','Sulfonamides','rash','mild'),
 ('TEST-007','Cotrimoxazole','rash','moderate')
) v(patient_number,substance,reaction,severity) ON v.patient_number=p.patient_number
WHERE p.is_test_data
  AND NOT EXISTS (SELECT 1 FROM allergies a WHERE a.patient_id=p.id);

INSERT INTO procedures(patient_id,encounter_id,code_system,code,display,performed_at)
SELECT p.id,e.id,'SNOMED-CT',v.code,v.display,now()-interval '1 day'
FROM patients p
JOIN (VALUES
 ('TEST-007','ART-REVIEW','HIV treatment review'),
 ('TEST-012','SCD-REVIEW','Sickle cell pain management review'),
 ('TEST-016','ORIF','Open reduction internal fixation'),
 ('TEST-018','APPENDECTOMY','Appendectomy'),
 ('TEST-020','NEB','Nebulization treatment'),
 ('TEST-024','DM-REVIEW','Diabetes management review'),
 ('TEST-030','RENAL-REVIEW','Renal and diabetes review')
) v(patient_number,code,display) ON v.patient_number=p.patient_number
JOIN LATERAL (SELECT id FROM encounters WHERE patient_id=p.id ORDER BY started_at DESC LIMIT 1) e ON true
WHERE p.is_test_data
  AND NOT EXISTS (SELECT 1 FROM procedures pr WHERE pr.patient_id=p.id AND pr.code=v.code);

-- Give the contract-driven modules an explicit patient-linked journey marker.
-- Domain-specific tables remain the source of truth; these markers are only for
-- modules whose source is intentionally represented through the contract layer.
INSERT INTO module_records(organization_id,module,status,payload)
SELECT p.organization_id,v.module,'active',
       jsonb_build_object(
         'source','synthetic-longitudinal-journey',
         'patientId',p.id,
         'patientNumber',p.patient_number,
         'scenario',v.scenario,
         'journeyStage',v.stage,
         'testData',true
       )
FROM patients p
JOIN (VALUES
 ('TEST-001','registration','malaria','registration'),
 ('TEST-002','chronic-care','diabetes','follow-up'),
 ('TEST-003','vitals','hypertension','monitoring'),
 ('TEST-004','medication-reconciliation','diabetes-hypertension','reconciliation'),
 ('TEST-005','emergency','pneumonia','acute-care'),
 ('TEST-006','laboratory','tuberculosis-suspect','investigation'),
 ('TEST-007','hiv-care','hiv-follow-up','follow-up'),
 ('TEST-008','maternity','maternal-anaemia','antenatal'),
 ('TEST-009','maternity','high-risk-pregnancy','antenatal'),
 ('TEST-010','pediatrics','paediatric-anaemia','child-care'),
 ('TEST-011','pediatrics','paediatric-pneumonia','child-care'),
 ('TEST-012','chronic-care','sickle-cell','follow-up'),
 ('TEST-013','chronic-care','heart-failure','monitoring'),
 ('TEST-014','laboratory','ckd','abnormal-result'),
 ('TEST-015','laboratory','uti','follow-up'),
 ('TEST-016','surgery','fracture','postoperative'),
 ('TEST-017','surgery','postoperative-infection','review'),
 ('TEST-018','surgery','appendicitis','postoperative'),
 ('TEST-019','medication-reconciliation','polypharmacy','reconciliation'),
 ('TEST-020','emergency','asthma','acute-care'),
 ('TEST-021','laboratory','acute-diarrhoea','follow-up'),
 ('TEST-022','pediatrics','malnutrition','child-care'),
 ('TEST-023','postnatal','postnatal-anaemia','follow-up'),
 ('TEST-024','chronic-care','diabetes','follow-up'),
 ('TEST-025','laboratory','uti','result-review'),
 ('TEST-026','chronic-care','hypertensive-heart-disease','follow-up'),
 ('TEST-027','immunization','febrile-illness','review'),
 ('TEST-028','laboratory','anaemia','investigation'),
 ('TEST-029','referrals','pregnancy-follow-up','referral'),
 ('TEST-030','chronic-care','diabetes-htn-ckd','multimorbidity')
) v(patient_number,module,scenario,stage) ON v.patient_number=p.patient_number
WHERE p.is_test_data
  AND NOT EXISTS (
    SELECT 1 FROM module_records mr
    WHERE mr.module=v.module
      AND mr.payload->>'patientId'=p.id::text
      AND mr.payload->>'source'='synthetic-longitudinal-journey'
  );

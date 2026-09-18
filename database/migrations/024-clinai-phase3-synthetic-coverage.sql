-- ClinAI 024: Phase 3 synthetic coverage and end-to-end workspace validation.
-- SAFETY: additive only. No DROP, TRUNCATE, DELETE, destructive rewrite or reset.
-- All records are explicitly synthetic and remain inside the existing Neon PostgreSQL database.

CREATE TABLE IF NOT EXISTS module_records (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  module text NOT NULL,
  status text NOT NULL DEFAULT 'active',
  payload jsonb NOT NULL DEFAULT '{}',
  created_by uuid REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_module_records_org_module_created
  ON module_records(organization_id,module,created_at DESC);
CREATE INDEX IF NOT EXISTS idx_module_records_payload_gin
  ON module_records USING gin(payload);

-- Core longitudinal extensions. These add records for patients that previously had thin module coverage.
INSERT INTO care_plans(patient_id,encounter_id,title,status,goals)
SELECT p.id,e.id,v.title,'active',v.goals::jsonb
FROM patients p
LEFT JOIN LATERAL (SELECT id FROM encounters WHERE patient_id=p.id ORDER BY started_at DESC LIMIT 1) e ON true
JOIN (VALUES
  ('TEST-002','Diabetes follow-up plan','["improve follow-up continuity","review glucose trend"]'),
  ('TEST-003','Hypertension monitoring plan','["review blood pressure trend","confirm treatment adherence"]'),
  ('TEST-004','Medication reconciliation plan','["resolve recorded medication discrepancy","repeat medication review"]'),
  ('TEST-012','Sickle cell continuity plan','["monitor pain episodes","maintain planned follow-up"]'),
  ('TEST-013','Heart failure monitoring plan','["monitor symptoms and weight","review blood pressure"]'),
  ('TEST-014','Renal function review plan','["repeat renal monitoring","review nephrology follow-up"]'),
  ('TEST-024','Diabetes monitoring plan','["repeat glucose monitoring","close overdue review"]'),
  ('TEST-026','Cardiovascular follow-up plan','["review blood pressure","complete overdue chronic review"]'),
  ('TEST-030','Multimorbidity coordination plan','["coordinate diabetes hypertension and CKD care","review outstanding referrals"]')
) v(patient_number,title,goals) ON true
WHERE p.is_test_data AND p.patient_number=v.patient_number
  AND NOT EXISTS (SELECT 1 FROM care_plans c WHERE c.patient_id=p.id AND c.title=v.title);

INSERT INTO procedures(patient_id,encounter_id,code_system,code,display,performed_at)
SELECT p.id,e.id,'SNOMED-CT',v.code,v.display,now()-v.offset_days * interval '1 day'
FROM patients p
LEFT JOIN LATERAL (SELECT id FROM encounters WHERE patient_id=p.id ORDER BY started_at DESC LIMIT 1) e ON true
JOIN (VALUES
  ('TEST-016','29824','Open reduction internal fixation',2),
  ('TEST-018','80146002','Appendectomy',3),
  ('TEST-017','119857002','Wound exploration and drainage',1)
) v(patient_number,code,display,offset_days) ON true
WHERE p.is_test_data AND p.patient_number=v.patient_number
  AND NOT EXISTS (SELECT 1 FROM procedures pr WHERE pr.patient_id=p.id AND pr.display=v.display);

INSERT INTO telemedicine_sessions(organization_id,patient_id,appointment_id,encounter_id,scheduled_at,status,meeting_url,identity_verified,consent_confirmed,started_at,ended_at,notes)
SELECT p.organization_id,p.id,a.id,e.id,v.scheduled_at,v.status,'https://telemedicine.example.test/clinai/'||p.patient_number,true,true,
       CASE WHEN v.status='completed' THEN v.scheduled_at ELSE NULL END,
       CASE WHEN v.status='completed' THEN v.scheduled_at + interval '24 minutes' ELSE NULL END,
       jsonb_build_object('source','synthetic-test-data','journey',v.journey)
FROM patients p
LEFT JOIN LATERAL (SELECT id FROM appointments WHERE patient_id=p.id ORDER BY start_at DESC LIMIT 1) a ON true
LEFT JOIN LATERAL (SELECT id FROM encounters WHERE patient_id=p.id ORDER BY started_at DESC LIMIT 1) e ON true
JOIN (VALUES
  ('TEST-007',now()-interval '2 days','completed','chronic follow-up'),
  ('TEST-024',now()+interval '2 hours','scheduled','diabetes review'),
  ('TEST-029',now()+interval '1 day','scheduled','pregnancy referral review')
) v(patient_number,scheduled_at,status,journey) ON true
WHERE p.is_test_data AND p.patient_number=v.patient_number
  AND NOT EXISTS (SELECT 1 FROM telemedicine_sessions t WHERE t.patient_id=p.id AND t.notes->>'journey'=v.journey);

INSERT INTO remote_monitoring_readings(organization_id,patient_id,device_id,metric,value_numeric,unit,measured_at,source,validation_status,alert_status,metadata)
SELECT p.organization_id,p.id,v.device_id,v.metric,v.value_numeric,v.unit,now()-v.offset_hours * interval '1 hour','synthetic-test-device','validated',v.alert,jsonb_build_object('source','synthetic-test-data','seedKey','rm-'||p.patient_number||'-'||v.metric)
FROM patients p
JOIN (VALUES
  ('TEST-003','bp-systolic','RM-003',152,'mmHg',2,'review'),
  ('TEST-013','weight','RM-013',82.4,'kg',3,'none'),
  ('TEST-024','glucose','RM-024',11.8,'mmol/L',1,'review'),
  ('TEST-030','bp-systolic','RM-030',158,'mmHg',4,'review'),
  ('TEST-030','glucose','RM-030',10.9,'mmol/L',4,'review')
) v(patient_number,metric,device_id,value_numeric,unit,offset_hours,alert) ON true
WHERE p.is_test_data AND p.patient_number=v.patient_number
  AND NOT EXISTS (SELECT 1 FROM remote_monitoring_readings r WHERE r.patient_id=p.id AND r.metadata->>'seedKey'='rm-'||p.patient_number||'-'||v.metric);

INSERT INTO immunizations(organization_id,patient_id,vaccine_code,vaccine_name,dose_number,administered_at,status,next_due_at,notes)
SELECT p.organization_id,p.id,v.code,v.name,v.dose,now()-v.offset_days * interval '1 day','administered',now()+v.next_days * interval '1 day','Synthetic test immunization record'
FROM patients p
JOIN (VALUES
  ('TEST-010','BCG','BCG','birth',120),
  ('TEST-010','OPV1','Oral polio vaccine','1',90),
  ('TEST-011','PENTA3','Pentavalent vaccine','3',60),
  ('TEST-022','MR1','Measles-rubella vaccine','1',180),
  ('TEST-027','DPT3','DPT-containing vaccine','3',90)
) v(patient_number,code,name,dose,next_days) ON true
CROSS JOIN LATERAL (SELECT 30::int AS offset_days) x
WHERE p.is_test_data AND p.patient_number=v.patient_number
  AND NOT EXISTS (SELECT 1 FROM immunizations i WHERE i.patient_id=p.id AND i.vaccine_code=v.code AND i.dose_number=v.dose);

-- Additional inpatient and safety records for the emergency/surgical journeys.
INSERT INTO emergency_cases(organization_id,patient_id,encounter_id,acuity,chief_complaint,triage_level,status,arrival_at,disposition,notes)
SELECT p.organization_id,p.id,e.id,v.acuity,v.complaint,v.triage,v.status,now()-v.hours * interval '1 hour',v.disposition,jsonb_build_object('source','synthetic-test-data','journey',v.journey)
FROM patients p
LEFT JOIN LATERAL (SELECT id FROM encounters WHERE patient_id=p.id ORDER BY started_at DESC LIMIT 1) e ON true
JOIN (VALUES
  ('TEST-005','urgent','Hypoxia with pneumonia','red','admitted',6,'admit','emergency pneumonia'),
  ('TEST-016','urgent','Road traffic injury with fracture','red','disposed',30,'admit','trauma to surgery'),
  ('TEST-018','urgent','Acute right lower abdominal pain','orange','disposed',46,'admit','emergency appendicitis'),
  ('TEST-020','urgent','Recurrent shortness of breath','orange','in-review',4,NULL,'asthma emergency review')
) v(patient_number,acuity,complaint,triage,status,hours,disposition,journey) ON true
WHERE p.is_test_data AND p.patient_number=v.patient_number
  AND NOT EXISTS (SELECT 1 FROM emergency_cases ec WHERE ec.patient_id=p.id AND ec.notes->>'journey'=v.journey);

INSERT INTO nursing_assessments(organization_id,patient_id,encounter_id,assessment_type,findings,pain_score,risk_flags,status)
SELECT p.organization_id,p.id,e.id,'synthetic-journey',v.findings,v.pain,v.risk,'completed'
FROM patients p
LEFT JOIN LATERAL (SELECT id FROM encounters WHERE patient_id=p.id ORDER BY started_at DESC LIMIT 1) e ON true
JOIN (VALUES
  ('TEST-005','{"respiratory":"tachypnoea","oxygen":"requires review"}',2,'respiratory-risk'),
  ('TEST-016','{"mobility":"assisted","wound":"post-operative"}',6,'falls-risk'),
  ('TEST-017','{"wound":"drainage","pain":"moderate"}',5,'infection-risk'),
  ('TEST-018','{"abdomen":"post-operative review","mobility":"assisted"}',4,'falls-risk')
) v(patient_number,findings,pain,risk) ON true
WHERE p.is_test_data AND p.patient_number=v.patient_number
  AND NOT EXISTS (SELECT 1 FROM nursing_assessments n WHERE n.patient_id=p.id AND n.assessment_type='synthetic-journey');

INSERT INTO medication_administrations(medication_order_id,dose,route,scheduled_at,administered_at,status,reason)
SELECT mo.id,mo.dose,mo.route,now()-interval '1 hour',now()-interval '45 minutes','administered','Synthetic test medication administration'
FROM medication_orders mo
JOIN patients p ON p.id=mo.patient_id
WHERE p.is_test_data
  AND p.patient_number IN ('TEST-005','TEST-016','TEST-018')
  AND NOT EXISTS (SELECT 1 FROM medication_administrations ma WHERE ma.medication_order_id=mo.id);

-- Deterministic clinical signals and AI governance records are explicitly marked as synthetic.
INSERT INTO clinical_signals(organization_id,patient_id,signal_type,severity,status,title,summary,evidence)
SELECT p.organization_id,p.id,v.signal,v.severity,'open',v.title,v.summary,jsonb_build_object('source','synthetic-test-data','seedKey','signal-'||p.patient_number)
FROM patients p
JOIN (VALUES
  ('TEST-005','hypoxia-review','high','Oxygen saturation needs clinician review','Recent recorded oxygen saturation is below the synthetic care-review threshold.'),
  ('TEST-009','high-risk-pregnancy','critical','High risk pregnancy review','Recorded pregnancy information includes elevated blood pressure and an open care gap.'),
  ('TEST-014','renal-function-review','high','Renal function review','The synthetic test journey includes an abnormal renal monitoring pathway.'),
  ('TEST-024','glucose-trend','high','Glucose trend review','Recent synthetic monitoring indicates elevated glucose requiring follow-up.'),
  ('TEST-030','multimorbidity-review','critical','Multimorbidity coordination review','Diabetes, hypertension and CKD are connected in the synthetic longitudinal record.')
) v(patient_number,signal,severity,title,summary) ON true
WHERE p.is_test_data AND p.patient_number=v.patient_number
  AND NOT EXISTS (SELECT 1 FROM clinical_signals s WHERE s.patient_id=p.id AND s.evidence->>'seedKey'='signal-'||p.patient_number);

INSERT INTO ai_risk_assessments(organization_id,capability_id,patient_id,risk_level,risk_type,status,source,findings,mitigations)
SELECT p.organization_id,v.capability_id,p.id,v.risk_level,v.risk_type,'open','synthetic-test-data',v.findings::jsonb,v.mitigations::jsonb
FROM patients p
JOIN (VALUES
  ('TEST-005','patient-cross-module-synthesis','level-3','clinical-safety','{"summary":"Synthetic record contains unresolved respiratory review signals."}','["clinician review","retain source links"]'),
  ('TEST-009','patient-cross-module-synthesis','level-3','clinical-safety','{"summary":"Synthetic high-risk pregnancy record requires human review."}','["human clinical review","avoid autonomous recommendation"]'),
  ('TEST-030','diagnostic-support','level-3','interpretive','{"summary":"Multimorbidity creates a higher context requirement."}','["minimum necessary context","human review"]')
) v(patient_number,capability_id,risk_level,risk_type,findings,mitigations) ON true
WHERE p.is_test_data AND p.patient_number=v.patient_number
  AND NOT EXISTS (SELECT 1 FROM ai_risk_assessments r WHERE r.patient_id=p.id AND r.findings->>'summary'=v.findings::jsonb->>'summary');

INSERT INTO ai_security_events(organization_id,patient_id,capability_id,event_type,severity,status,source,metadata)
SELECT p.organization_id,p.id,v.capability_id,v.event_type,v.severity,'observed','synthetic-test-data',jsonb_build_object('source','synthetic-test-data','seedKey','security-'||p.patient_number||'-'||v.event_type)
FROM patients p
JOIN (VALUES
  ('TEST-004','patient-cross-module-synthesis','prompt-injection','info'),
  ('TEST-005','patient-cross-module-synthesis','unauthorized-patient-lookup','high'),
  ('TEST-030','diagnostic-support','provider-leakage','medium')
) v(patient_number,capability_id,event_type,severity) ON true
WHERE p.is_test_data AND p.patient_number=v.patient_number
  AND NOT EXISTS (SELECT 1 FROM ai_security_events s WHERE s.metadata->>'seedKey'='security-'||p.patient_number||'-'||v.event_type);

INSERT INTO ai_incidents(organization_id,capability_id,severity,status,incident_type,patient_id,description,containment,corrective_action,created_by)
SELECT p.organization_id,v.capability_id,v.severity,'closed',v.incident_type,p.id,v.description,v.containment::jsonb,v.correction::jsonb,NULL
FROM patients p
JOIN (VALUES
  ('TEST-005','patient-cross-module-synthesis','high','synthetic-unauthorized-lookup','Synthetic security exercise representing an unauthorized patient lookup attempt.','{"blocked":true}','{"control":"patient-level authorization"}')
) v(patient_number,capability_id,severity,incident_type,description,containment,correction) ON true
WHERE p.is_test_data AND p.patient_number=v.patient_number
  AND NOT EXISTS (SELECT 1 FROM ai_incidents i WHERE i.description=v.description AND i.patient_id=p.id);

-- A small synthetic lifecycle/evaluation footprint makes AI Governance testable without using real user data.
INSERT INTO ai_capability_evaluations(organization_id,capability_id,version,evaluation_type,status,sample_size,metrics,findings)
SELECT p.organization_id,v.capability_id,'1.0','synthetic-release-check','passed',v.sample_size,v.metrics::jsonb,v.findings::jsonb
FROM patients p
JOIN (VALUES
  ('TEST-001','patient-cross-module-synthesis',12,'{"sourceGrounding":1.0,"boundaryCompliance":1.0}','{"note":"Synthetic public release verification dataset"}'),
  ('TEST-024','clinical-velocity',10,'{"deterministicMetrics":1.0}','{"note":"Synthetic workflow timing validation"}')
) v(patient_number,capability_id,sample_size,metrics,findings) ON true
WHERE p.is_test_data AND NOT EXISTS (SELECT 1 FROM ai_capability_evaluations e WHERE e.organization_id=p.organization_id AND e.capability_id=v.capability_id AND e.evaluation_type='synthetic-release-check');

INSERT INTO ai_model_lifecycle_events(organization_id,capability_id,model_id,event_type,environment,outcome,metrics,notes)
SELECT DISTINCT p.organization_id,'patient-cross-module-synthesis','clinai-synthetic-router',v.event_type,'test','observed',v.metrics::jsonb,'Synthetic governance lifecycle event'
FROM patients p
JOIN (VALUES
  ('design','{"stage":"design"}'),('evaluation','{"stage":"evaluation"}'),('validation','{"stage":"validation"}'),('monitoring','{"stage":"monitoring"}')
) v(event_type,metrics) ON true
WHERE p.is_test_data
  AND NOT EXISTS (SELECT 1 FROM ai_model_lifecycle_events l WHERE l.organization_id=p.organization_id AND l.model_id='clinai-synthetic-router' AND l.event_type=v.event_type);

-- Broad read coverage for modules that use the platform's normalized module record surface.
-- These are connected to real synthetic patient IDs and are intentionally descriptive rather than decorative.
WITH records(module,patient_number,status,seed_key,title,detail) AS (
  VALUES
  ('registration','TEST-001','completed','m3-registration-001','Synthetic patient registration','Registration completed for a synthetic outpatient journey.'),
  ('triage','TEST-005','completed','m3-triage-005','Respiratory triage','Synthetic triage record connected to emergency presentation.'),
  ('follow-up','TEST-002','open','m3-followup-002','Diabetes follow-up','Follow-up remains open for the synthetic chronic care journey.'),
  ('follow-up','TEST-024','open','m3-followup-024','Glucose review follow-up','Follow-up scheduled after elevated synthetic monitoring.'),
  ('referral-transfers','TEST-029','in-transit','m3-transfer-029','Pregnancy referral transfer','Synthetic referral transfer awaiting receiving-facility review.'),
  ('billing','TEST-030','open','m3-billing-030','Multimorbidity billing record','Synthetic invoice is connected to the longitudinal care journey.'),
  ('insurance','TEST-030','active','m3-insurance-030','Synthetic insurance eligibility','Test coverage record connected to the same patient journey.'),
  ('claims','TEST-030','submitted','m3-claim-030','Synthetic claim','Test claim linked to a synthetic invoice.'),
  ('accounting','TEST-030','posted','m3-accounting-030','Synthetic accounting entry','Test financial ledger record derived from a synthetic invoice.'),
  ('inventory','TEST-005','attention','m3-inventory-005','Respiratory medicine stock check','Synthetic pharmacy supply review linked to a patient need.'),
  ('procurement','TEST-005','requested','m3-procurement-005','Synthetic procurement request','Test replenishment request for a medicine used in the synthetic journey.'),
  ('suppliers','TEST-005','active','m3-supplier-005','Synthetic medicine supplier','Test supplier record supporting synthetic inventory flow.'),
  ('pharmacy','TEST-004','in-review','m3-pharmacy-004','Medication reconciliation pharmacy review','Synthetic discrepancy requires pharmacist review.'),
  ('imaging','TEST-016','completed','m3-imaging-016','Trauma imaging result','Synthetic imaging record connected to the trauma and surgery journey.'),
  ('nursing','TEST-005','completed','m3-nursing-005','Inpatient respiratory nursing review','Synthetic nursing assessment connected to the admission.'),
  ('emergency','TEST-005','admitted','m3-emergency-005','Emergency pneumonia case','Synthetic emergency case progressed to inpatient care.'),
  ('inpatient','TEST-005','admitted','m3-inpatient-005','Inpatient respiratory care','Synthetic admission remains under review.'),
  ('beds','TEST-005','occupied','m3-bed-005','Assigned inpatient bed','Synthetic patient occupies a synthetic test bed.'),
  ('surgery','TEST-016','completed','m3-surgery-016','Trauma surgery','Synthetic surgical journey completed after emergency arrival.'),
  ('maternity','TEST-009','active','m3-maternity-009','High-risk antenatal review','Synthetic maternal care pathway requires review.'),
  ('pediatrics','TEST-011','active','m3-peds-011','Pediatric pneumonia review','Synthetic pediatric respiratory pathway connected to low oxygen saturation.'),
  ('child-health','TEST-022','active','m3-child-022','Child nutrition review','Synthetic child health visit includes nutrition follow-up.'),
  ('immunization','TEST-022','review','m3-immunization-022','Immunization review','Synthetic immunization record includes a next review point.'),
  ('chronic-care','TEST-030','active','m3-chronic-030','Multimorbidity chronic care','Synthetic chronic care record coordinates three active conditions.'),
  ('medication-reconciliation','TEST-019','in-review','m3-medrec-019','Polypharmacy reconciliation','Synthetic medication discrepancy review is open.'),
  ('consents','TEST-024','active','m3-consent-024','Telemedicine consent','Synthetic consent supports a remote review workflow.'),
  ('payments','TEST-001','completed','m3-payment-001','Synthetic payment','Synthetic invoice was settled through a test payment.'),
  ('patient-portal','TEST-002','active','m3-portal-002','Patient portal profile','Synthetic portal profile supports the chronic care journey.'),
  ('portal-messages','TEST-002','sent','m3-message-002','Follow-up message','Synthetic patient message confirms the follow-up request.'),
  ('telemedicine','TEST-007','completed','m3-telemed-007','Remote chronic care review','Synthetic telemedicine encounter is completed.'),
  ('remote-monitoring','TEST-024','attention','m3-remote-024','Glucose monitoring alert','Synthetic remote monitoring value triggered review.'),
  ('notifications','TEST-009','open','m3-notification-009','Maternal review notification','Synthetic notification prompts high-risk pregnancy review.'),
  ('documents','TEST-016','available','m3-document-016','Surgical discharge document','Synthetic document belongs to the trauma journey.'),
  ('surveillance','TEST-006','under-review','m3-surveillance-006','Tuberculosis surveillance case','Synthetic public health surveillance pathway awaits result review.'),
  ('investigations','TEST-006','open','m3-investigation-006','TB investigation','Synthetic investigation connected to suspected TB.'),
  ('response','TEST-006','open','m3-response-006','Public health response task','Synthetic response task supports the investigation.'),
  ('mortality','TEST-003','screening','m3-mortality-003','Mortality surveillance check','Synthetic surveillance review with no mortality event recorded.'),
  ('population-health','TEST-024','active','m3-population-024','Diabetes cohort','Synthetic patient is included in a chronic disease cohort.'),
  ('district-intelligence','TEST-024','review','m3-district-024','District chronic care signal','Synthetic aggregate signal for service planning.'),
  ('analytics','TEST-030','available','m3-analytics-030','Longitudinal trend summary','Synthetic longitudinal trends are available for review.'),
  ('care-gaps','TEST-030','open','m3-gap-030','Multimorbidity care gap','Synthetic care gap is connected to chronic care and follow-up.'),
  ('care-graph','TEST-016','connected','m3-graph-016','Trauma care graph','Synthetic graph connects emergency, imaging, surgery, admission and discharge.'),
  ('patient-360-intelligence','TEST-030','ready','m3-360-030','Patient 360 synthesis','Synthetic Patient 360 combines clinical, operational and financial records.'),
  ('clinical-velocity','TEST-005','ready','m3-velocity-005','Emergency response timing','Synthetic workflow timing is available for review.'),
  ('value-based-care','TEST-024','ready','m3-value-024','Diabetes continuity measure','Synthetic chronic care continuity measure is available.'),
  ('ai-risk-management','TEST-030','review','m3-risk-030','AI risk review','Synthetic multimorbidity reasoning risk requires human review.'),
  ('ai-security-management','TEST-005','observed','m3-security-005','AI security event','Synthetic patient authorization event was recorded and contained.'),
  ('ai-governance','TEST-001','validated','m3-governance-001','AI capability validation','Synthetic release evaluation passed governance checks.'),
  ('ai-evaluations','TEST-001','passed','m3-eval-001','AI evaluation result','Synthetic release evaluation recorded a passing result.'),
  ('tasks','TEST-024','open','m3-task-024','Glucose review task','Synthetic task is linked to remote monitoring.'),
  ('workflows','TEST-016','completed','m3-workflow-016','Trauma workflow','Synthetic workflow connected emergency, imaging, surgery and inpatient care.'),
  ('interoperability','TEST-016','ready','m3-interoperability-016','Synthetic exchange package','Test interoperability record references the trauma journey.'),
  ('health-connections','TEST-029','active','m3-health-connection-029','Referral network connection','Synthetic referral network path is available.'),
  ('audit','TEST-030','recorded','m3-audit-030','Synthetic audit trail','Synthetic audit record tracks a reviewed intelligence interaction.'),
  ('security','TEST-005','observed','m3-security-core-005','Synthetic security control','Synthetic access control event remained within the test boundary.'),
  ('guidelines','TEST-009','referenced','m3-guideline-009','Maternal guideline reference','Synthetic record references a maternal review guideline.'),
  ('care-pathways','TEST-018','completed','m3-pathway-018','Appendicitis care pathway','Synthetic pathway connects emergency to surgery and discharge.'),
  ('reporting','TEST-030','ready','m3-report-030','Synthetic longitudinal report','Test reporting view summarizes the connected journey.'),
  ('offline-sync','TEST-024','queued','m3-offline-024','Offline care task sync','Synthetic queued operation represents safe offline synchronization.'),
  ('settings','TEST-001','active','m3-settings-001','Test environment settings','Synthetic workspace configuration marker.'),
  ('terminology','TEST-030','mapped','m3-terminology-030','Terminology mapping','Synthetic diagnosis set has a mapped terminology record.')
)
INSERT INTO module_records(organization_id,module,status,payload)
SELECT p.organization_id,r.module,r.status,
       jsonb_build_object('isTestData',true,'patientId',p.id,'patientNumber',p.patient_number,'seedKey',r.seed_key,'title',r.title,'detail',r.detail,'journey','phase3-synthetic-coverage')
FROM records r
JOIN patients p ON p.patient_number=r.patient_number
WHERE p.is_test_data
  AND NOT EXISTS (SELECT 1 FROM module_records mr WHERE mr.organization_id=p.organization_id AND mr.module=r.module AND mr.payload->>'seedKey'=r.seed_key);

-- A few synthetic governance rows are available to the dashboard even when no patient is selected.
INSERT INTO module_records(organization_id,module,status,payload)
SELECT DISTINCT p.organization_id,r.module,r.status,
       jsonb_build_object('isTestData',true,'seedKey',r.seed_key,'title',r.title,'detail',r.detail,'journey','phase3-synthetic-coverage')
FROM patients p
JOIN (VALUES
  ('governance-forms','active','m3-governance-form','Synthetic AI governance form catalog'),
  ('governance-order-sets','active','m3-governance-order-set','Synthetic governed order set'),
  ('governance-protocols','active','m3-governance-protocol','Synthetic clinical protocol reference'),
  ('governance-workflow-rules','active','m3-governance-rule','Synthetic workflow governance rule'),
  ('governance-terminology','active','m3-governance-terminology','Synthetic terminology governance entry')
) r(module,status,seed_key,title) ON true
WHERE p.is_test_data
  AND NOT EXISTS (SELECT 1 FROM module_records mr WHERE mr.organization_id=p.organization_id AND mr.module=r.module AND mr.payload->>'seedKey'=r.seed_key);

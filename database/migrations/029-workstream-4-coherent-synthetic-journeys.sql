-- ClinAI Workstream 4. Additive, idempotent synthetic journey architecture using TEST-001..TEST-030. No destructive operations.

CREATE TABLE IF NOT EXISTS synthetic_journeys (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
 patient_id uuid NOT NULL REFERENCES patients(id) ON DELETE CASCADE, journey_key text NOT NULL, title text NOT NULL,
 status text NOT NULL, scenario text NOT NULL, source text NOT NULL DEFAULT 'workstream4-synthetic',
 started_at timestamptz NOT NULL DEFAULT now(), completed_at timestamptz, metadata jsonb NOT NULL DEFAULT '{}',
 created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(), UNIQUE(organization_id,patient_id,journey_key));

CREATE INDEX IF NOT EXISTS synthetic_journeys_patient_idx ON synthetic_journeys(organization_id,patient_id,started_at DESC);

CREATE INDEX IF NOT EXISTS synthetic_journeys_status_idx ON synthetic_journeys(organization_id,status,updated_at DESC);

CREATE TABLE IF NOT EXISTS synthetic_journey_step_catalog (
 step_key text PRIMARY KEY, title text NOT NULL, event_type text NOT NULL, authoritative_table text NOT NULL,
 consequence text NOT NULL, authoritative_scope text NOT NULL DEFAULT 'patient', metadata jsonb NOT NULL DEFAULT '{}');

CREATE TABLE IF NOT EXISTS synthetic_journey_templates (
 template_key text PRIMARY KEY, version text NOT NULL, title text NOT NULL, step_keys text[] NOT NULL,
 active boolean NOT NULL DEFAULT true, created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now());

CREATE INDEX IF NOT EXISTS synthetic_journey_templates_active_idx ON synthetic_journey_templates(active,template_key);

CREATE TABLE IF NOT EXISTS synthetic_journey_steps (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
 journey_id uuid NOT NULL REFERENCES synthetic_journeys(id) ON DELETE CASCADE, patient_id uuid NOT NULL REFERENCES patients(id) ON DELETE CASCADE,
 sequence_no integer NOT NULL, step_key text NOT NULL, title text NOT NULL, event_type text NOT NULL,
 authoritative_table text NOT NULL, authoritative_id uuid, authoritative_scope text NOT NULL DEFAULT 'patient', consequence text NOT NULL,
 status text NOT NULL, occurred_at timestamptz NOT NULL, outbox_event_id uuid NOT NULL DEFAULT gen_random_uuid(), metadata jsonb NOT NULL DEFAULT '{}',
 UNIQUE(journey_id,sequence_no), UNIQUE(journey_id,step_key), UNIQUE(outbox_event_id));

CREATE INDEX IF NOT EXISTS synthetic_journey_steps_patient_idx ON synthetic_journey_steps(organization_id,patient_id,occurred_at DESC);

CREATE INDEX IF NOT EXISTS synthetic_journey_steps_event_idx ON synthetic_journey_steps(organization_id,event_type,occurred_at DESC);

INSERT INTO synthetic_journey_step_catalog(step_key,title,event_type,authoritative_table,consequence,authoritative_scope,metadata) VALUES
('registration','Patient registered','patient.registered','patients','Patient enters the synthetic longitudinal record.','patient','{"source":"workstream4-synthetic","version":"WS4.1"}'::jsonb),
('appointment','Appointment created','appointment.created','appointments','Scheduled care is connected to intake.','patient','{"source":"workstream4-synthetic","version":"WS4.1"}'::jsonb),
('checkin','Care intake','appointment.checked_in','queue_entries','Patient enters active operational flow.','patient','{"source":"workstream4-synthetic","version":"WS4.1"}'::jsonb),
('encounter','Encounter started','encounter.started','encounters','The clinical episode becomes authoritative.','patient','{"source":"workstream4-synthetic","version":"WS4.1"}'::jsonb),
('assessment','Assessment documented','assessment.recorded','clinical_notes','Clinical findings are captured.','patient','{"source":"workstream4-synthetic","version":"WS4.1"}'::jsonb),
('diagnosis','Problem recorded','diagnosis.recorded','diagnoses','The documented problem drives the next action.','patient','{"source":"workstream4-synthetic","version":"WS4.1"}'::jsonb),
('order','Clinical order','order.created','clinical_orders','Diagnostic or treatment work is ordered.','patient','{"source":"workstream4-synthetic","version":"WS4.1"}'::jsonb),
('result','Clinical review','result.released','clinical_notes','Available findings become actionable context.','patient','{"source":"workstream4-synthetic","version":"WS4.1"}'::jsonb),
('treatment','Treatment/resource use','medication.dispensed','stock_movements','Treatment creates a supply consequence.','facility','{"source":"workstream4-synthetic","version":"WS4.1"}'::jsonb),
('billing','Invoice captured','invoice.created','invoices','Clinical activity produces a billable episode.','patient','{"source":"workstream4-synthetic","version":"WS4.1"}'::jsonb),
('insurance','Claim submitted','claim.submitted','claims','The episode enters payer processing.','patient','{"source":"workstream4-synthetic","version":"WS4.1"}'::jsonb),
('reconciliation','Financial reconciliation','reconciliation.completed','finance_reconciliations','Clinical, payer and payment state is reconciled.','patient','{"source":"workstream4-synthetic","version":"WS4.1"}'::jsonb),
('followup','Follow-up due','followup.due','clinical_signals','Continuity is monitored.','patient','{"source":"workstream4-synthetic","version":"WS4.1"}'::jsonb),
('care-task','Care-management task','task.created','care_tasks','Longitudinal work is operationalized.','patient','{"source":"workstream4-synthetic","version":"WS4.1"}'::jsonb),
('safety','Medication safety signal','medication.safety.signal','clinical_signals','Potential medication discrepancy is surfaced for human review.','patient','{"source":"workstream4-synthetic","version":"WS4.1"}'::jsonb),
('task','Reconciliation task','task.created','care_tasks','Medication reconciliation becomes an operational task.','patient','{"source":"workstream4-synthetic","version":"WS4.1"}'::jsonb),
('arrival','Emergency arrival','emergency.arrived','encounters','Emergency episode starts.','patient','{"source":"workstream4-synthetic","version":"WS4.1"}'::jsonb),
('triage','Triage','triage.recorded','encounters','Acuity is recorded.','patient','{"source":"workstream4-synthetic","version":"WS4.1"}'::jsonb),
('disposition','Disposition','discharge.started','encounters','Emergency state transitions to discharge or further care.','patient','{"source":"workstream4-synthetic","version":"WS4.1"}'::jsonb),
('referral','Referral sent','referral.sent','referrals','Referral handoff becomes authoritative.','patient','{"source":"workstream4-synthetic","version":"WS4.1"}'::jsonb),
('anc','ANC record','maternity.anc.recorded','maternity_records','Pregnancy stage and maternal observations are recorded.','patient','{"source":"workstream4-synthetic","version":"WS4.1"}'::jsonb),
('risk','Maternal risk review','maternity.risk.assessed','maternity_records','Maternal risk is evaluated.','patient','{"source":"workstream4-synthetic","version":"WS4.1"}'::jsonb),
('preventive','Preventive-care task','task.created','care_tasks','Nutrition/immunization continuity is operationalized.','patient','{"source":"workstream4-synthetic","version":"WS4.1"}'::jsonb),
('procedure','Surgical procedure','procedure.completed','procedures','Operative treatment is recorded.','patient','{"source":"workstream4-synthetic","version":"WS4.1"}'::jsonb),
('admission','Post-operative admission','admission.started','admissions','Recovery requires inpatient observation.','patient','{"source":"workstream4-synthetic","version":"WS4.1"}'::jsonb),
('discharge','Discharge','discharge.started','admissions','Inpatient episode transitions to discharge.','patient','{"source":"workstream4-synthetic","version":"WS4.1"}'::jsonb),
('birth','Birth event','maternity.birth.recorded','birth_events','Delivery outcome is linked to the maternal journey.','patient','{"source":"workstream4-synthetic","version":"WS4.1"}'::jsonb),
('newborn','Newborn record','maternity.newborn.recorded','newborn_records','Mother-baby relationship is represented.','patient','{"source":"workstream4-synthetic","version":"WS4.1"}'::jsonb),
('pnc','Postnatal contact','maternity.pnc.recorded','postnatal_contacts','Postnatal assessment closes the immediate maternity loop.','patient','{"source":"workstream4-synthetic","version":"WS4.1"}'::jsonb),
('monitoring','Care task','task.created','care_tasks','Longitudinal monitoring is operationalized.','patient','{"source":"workstream4-synthetic","version":"WS4.1"}'::jsonb),
('inventory','Supply consequence','inventory.dispensed','stock_movements','Clinical care produces a facility supply consequence.','facility','{"source":"workstream4-synthetic","version":"WS4.1"}'::jsonb)
ON CONFLICT(step_key) DO UPDATE SET title=EXCLUDED.title,event_type=EXCLUDED.event_type,authoritative_table=EXCLUDED.authoritative_table,consequence=EXCLUDED.consequence,authoritative_scope=EXCLUDED.authoritative_scope,metadata=EXCLUDED.metadata;

INSERT INTO synthetic_journey_templates(template_key,version,title,step_keys,active) VALUES
('outpatient','WS4.1','Outpatient synthetic pathway',ARRAY['registration','appointment','checkin','encounter','assessment','diagnosis','order','result','treatment','billing','insurance','reconciliation','followup'],true),
('chronic','WS4.1','Chronic synthetic pathway',ARRAY['registration','appointment','encounter','assessment','diagnosis','order','care-task','billing','insurance','reconciliation','followup'],true),
('medication','WS4.1','Medication synthetic pathway',ARRAY['registration','appointment','encounter','diagnosis','order','safety','task','billing','insurance','reconciliation','followup'],true),
('emergency','WS4.1','Emergency synthetic pathway',ARRAY['arrival','triage','assessment','diagnosis','order','result','treatment','disposition','billing','insurance','reconciliation','followup'],true),
('referral','WS4.1','Referral synthetic pathway',ARRAY['registration','encounter','assessment','diagnosis','order','result','referral','task','billing','insurance','reconciliation','followup'],true),
('maternity','WS4.1','Maternity synthetic pathway',ARRAY['registration','appointment','encounter','anc','risk','diagnosis','order','task','billing','insurance','reconciliation','followup'],true),
('maternity_referral','WS4.1','Maternity Referral synthetic pathway',ARRAY['registration','appointment','encounter','anc','risk','diagnosis','order','referral','task','billing','insurance','reconciliation','followup'],true),
('pediatric','WS4.1','Pediatric synthetic pathway',ARRAY['registration','appointment','encounter','assessment','diagnosis','order','treatment','preventive','billing','insurance','reconciliation','followup'],true),
('surgery','WS4.1','Surgery synthetic pathway',ARRAY['arrival','diagnosis','referral','procedure','admission','treatment','discharge','assessment','billing','insurance','reconciliation','followup'],true),
('surgery_followup','WS4.1','Surgery Followup synthetic pathway',ARRAY['appointment','encounter','diagnosis','procedure','order','task','billing','insurance','reconciliation','followup'],true),
('postnatal','WS4.1','Postnatal synthetic pathway',ARRAY['registration','appointment','encounter','birth','newborn','pnc','diagnosis','task','billing','insurance','reconciliation','followup'],true),
('multimorbidity','WS4.1','Multimorbidity synthetic pathway',ARRAY['registration','appointment','encounter','assessment','diagnosis','order','monitoring','inventory','billing','insurance','reconciliation','followup'],true)
ON CONFLICT(template_key) DO UPDATE SET version=EXCLUDED.version,title=EXCLUDED.title,step_keys=EXCLUDED.step_keys,active=EXCLUDED.active,updated_at=now();

WITH p AS (SELECT id,organization_id,patient_number FROM patients WHERE is_test_data=true AND patient_number LIKE 'TEST-%'), profiles(patient_number,journey_key,title,status,template_key,age_days) AS (VALUES
('TEST-001','acute-malaria','Acute malaria with anaemia','completed','outpatient',3),
('TEST-002','diabetes-continuity','Diabetes continuity and missed follow-up','needs-follow-up','chronic',5),
('TEST-003','hypertension-review','Hypertension control review','active','chronic',7),
('TEST-004','medication-reconciliation','Medication reconciliation safety review','needs-follow-up','medication',9),
('TEST-005','emergency-pneumonia','Emergency pneumonia with hypoxia','active','emergency',11),
('TEST-006','tb-diagnostic-referral','Suspected TB diagnostic referral','referred','referral',13),
('TEST-007','hiv-continuity','HIV care continuity','needs-follow-up','chronic',15),
('TEST-008','antenatal-anaemia','Antenatal care with maternal anaemia','active','maternity',17),
('TEST-009','high-risk-pregnancy','High-risk pregnancy escalation','referred','maternity',19),
('TEST-010','paediatric-fever','Paediatric fever and nutrition review','completed','pediatric',21),
('TEST-011','paediatric-pneumonia','Paediatric pneumonia with hypoxia','active','pediatric',23),
('TEST-012','sickle-cell-pain','Sickle cell pain episode','active','chronic',25),
('TEST-013','heart-failure-monitoring','Heart failure monitoring','active','chronic',27),
('TEST-014','ckd-monitoring','Chronic kidney disease monitoring','needs-follow-up','chronic',29),
('TEST-015','uti-workup','Recurrent urinary symptoms workup','completed','outpatient',31),
('TEST-016','trauma-surgery','Road trauma fracture through surgery','completed','surgery',33),
('TEST-017','postoperative-infection','Postoperative wound infection review','needs-follow-up','surgery_followup',35),
('TEST-018','appendicitis-surgery','Acute appendicitis through surgery','completed','surgery',37),
('TEST-019','polypharmacy-safety','Polypharmacy medication safety','needs-follow-up','medication',39),
('TEST-020','asthma-emergency','Recurrent asthma emergency review','active','emergency',41),
('TEST-021','dehydration','Dehydration risk management','completed','outpatient',43),
('TEST-022','child-nutrition-immunization','Child nutrition and immunization review','needs-follow-up','pediatric',3),
('TEST-023','postnatal-follow-up','Postnatal maternal anaemia follow-up','active','postnatal',5),
('TEST-024','diabetes-remote-monitoring','Diabetes remote monitoring','active','chronic',7),
('TEST-025','uti-lab-delay','UTI with delayed laboratory review','needs-follow-up','outpatient',9),
('TEST-026','hypertensive-heart','Hypertensive heart disease review','needs-follow-up','chronic',11),
('TEST-027','febrile-immunization','Febrile illness with immunization review','active','pediatric',13),
('TEST-028','anaemia-workup','Gastrointestinal symptoms and anaemia workup','active','outpatient',15),
('TEST-029','pregnancy-referral','Pregnancy follow-up with pending referral','referred','maternity_referral',17),
('TEST-030','multimorbidity','Diabetes, hypertension and CKD multimorbidity','needs-follow-up','multimorbidity',19)
) INSERT INTO synthetic_journeys(organization_id,patient_id,journey_key,title,status,scenario,started_at,completed_at,metadata)
SELECT p.organization_id,p.id,pr.journey_key,pr.title,pr.status,pr.template_key,now()-(pr.age_days||' days')::interval,CASE WHEN pr.status='completed' THEN now()-(pr.age_days||' days')::interval+interval '4 hours' ELSE NULL END,jsonb_build_object('isTestData',true,'journeyVersion','WS4.1','patientNumber',p.patient_number,'templateKey',pr.template_key)
FROM p JOIN profiles pr ON pr.patient_number=p.patient_number
ON CONFLICT(organization_id,patient_id,journey_key) DO UPDATE SET title=EXCLUDED.title,status=EXCLUDED.status,scenario=EXCLUDED.scenario,metadata=EXCLUDED.metadata,updated_at=now();

INSERT INTO birth_events(organization_id,mother_patient_id,birth_datetime,mode,place_type,facility_id,gestational_age_weeks,multiple_birth,complications,outcome,referral,source_guideline)
SELECT p.organization_id,p.id,now()-interval '12 days','vaginal','facility',p.facility_id,39,false,'{}','live','{}','synthetic-workstream4'
FROM patients p WHERE p.patient_number='TEST-023' AND p.is_test_data=true
AND NOT EXISTS(SELECT 1 FROM birth_events b WHERE b.mother_patient_id=p.id);

INSERT INTO newborn_records(organization_id,mother_patient_id,birth_event_id,sex,birth_weight_grams,gestational_age_weeks,apgar,feeding,resuscitation,danger_signs,birth_defects_screening,kangaroo_care,referral,source_guideline)
SELECT p.organization_id,p.id,b.id,'female',3200,39,jsonb_build_object('oneMinute',8,'fiveMinute',9),jsonb_build_object('mode','exclusive-breastfeeding'),jsonb_build_object('required',false),'{}','{}','{}','{}','synthetic-workstream4'
FROM patients p JOIN birth_events b ON b.mother_patient_id=p.id WHERE p.patient_number='TEST-023' AND p.is_test_data=true
AND NOT EXISTS(SELECT 1 FROM newborn_records n WHERE n.mother_patient_id=p.id);

INSERT INTO postnatal_contacts(organization_id,patient_id,newborn_id,contact_date,contact_timing,maternal_assessment,newborn_assessment,feeding_support,family_planning,mental_health,danger_signs,referral_required,plan,source_guideline)
SELECT p.organization_id,p.id,n.id,now()-interval '5 days','within-7-days',jsonb_build_object('anaemia','under-review'),jsonb_build_object('status','stable'),jsonb_build_object('supported',true),jsonb_build_object('counselling','provided'),jsonb_build_object('screened',true),'{}',false,'Continue maternal iron support and newborn follow-up.','synthetic-workstream4'
FROM patients p JOIN newborn_records n ON n.mother_patient_id=p.id WHERE p.patient_number='TEST-023' AND p.is_test_data=true
AND NOT EXISTS(SELECT 1 FROM postnatal_contacts c WHERE c.patient_id=p.id);

WITH p AS (SELECT id,organization_id,patient_number FROM patients WHERE is_test_data=true AND patient_number LIKE 'TEST-%')
INSERT INTO synthetic_journey_steps(organization_id,journey_id,patient_id,sequence_no,step_key,title,event_type,authoritative_table,authoritative_id,authoritative_scope,consequence,status,occurred_at,metadata)
SELECT p.organization_id,j.id,p.id,x.ord::int,c.step_key,c.title,c.event_type,c.authoritative_table,CASE c.authoritative_table
 WHEN 'patients' THEN p.id
 WHEN 'appointments' THEN (SELECT a.id FROM appointments a WHERE a.patient_id=p.id AND a.organization_id=p.organization_id ORDER BY a.start_at DESC LIMIT 1)
 WHEN 'queue_entries' THEN (SELECT q.id FROM queue_entries q WHERE q.patient_id=p.id ORDER BY q.joined_at DESC LIMIT 1)
 WHEN 'encounters' THEN (SELECT e.id FROM encounters e WHERE e.patient_id=p.id AND e.organization_id=p.organization_id ORDER BY e.started_at DESC LIMIT 1)
 WHEN 'clinical_notes' THEN (SELECT n.id FROM clinical_notes n JOIN encounters e ON e.id=n.encounter_id WHERE e.patient_id=p.id ORDER BY n.id DESC LIMIT 1)
 WHEN 'diagnoses' THEN (SELECT d.id FROM diagnoses d WHERE d.patient_id=p.id ORDER BY d.id DESC LIMIT 1)
 WHEN 'clinical_orders' THEN (SELECT o.id FROM clinical_orders o WHERE o.patient_id=p.id ORDER BY o.created_at DESC LIMIT 1)
 WHEN 'admissions' THEN (SELECT a.id FROM admissions a WHERE a.patient_id=p.id AND a.organization_id=p.organization_id ORDER BY a.admitted_at DESC LIMIT 1)
 WHEN 'procedures' THEN (SELECT pr.id FROM procedures pr WHERE pr.patient_id=p.id ORDER BY pr.performed_at DESC NULLS LAST LIMIT 1)
 WHEN 'referrals' THEN (SELECT r.id FROM referrals r WHERE r.patient_id=p.id ORDER BY r.created_at DESC LIMIT 1)
 WHEN 'maternity_records' THEN (SELECT m.id FROM maternity_records m WHERE m.patient_id=p.id ORDER BY m.event_at DESC LIMIT 1)
 WHEN 'birth_events' THEN (SELECT b.id FROM birth_events b WHERE b.mother_patient_id=p.id ORDER BY b.birth_datetime DESC LIMIT 1)
 WHEN 'newborn_records' THEN (SELECT n.id FROM newborn_records n WHERE n.mother_patient_id=p.id ORDER BY n.created_at DESC LIMIT 1)
 WHEN 'postnatal_contacts' THEN (SELECT c.id FROM postnatal_contacts c WHERE c.patient_id=p.id ORDER BY c.contact_date DESC LIMIT 1)
 WHEN 'care_tasks' THEN (SELECT t.id FROM care_tasks t WHERE t.patient_id=p.id ORDER BY t.created_at DESC LIMIT 1)
 WHEN 'clinical_signals' THEN (SELECT s.id FROM clinical_signals s WHERE s.patient_id=p.id ORDER BY s.created_at DESC LIMIT 1)
 WHEN 'invoices' THEN (SELECT i.id FROM invoices i WHERE i.patient_id=p.id AND i.organization_id=p.organization_id ORDER BY i.created_at DESC LIMIT 1)
 WHEN 'claims' THEN (SELECT c.id FROM claims c WHERE c.patient_id=p.id ORDER BY c.submitted_at DESC NULLS LAST LIMIT 1)
 WHEN 'finance_reconciliations' THEN (SELECT fr.id FROM finance_reconciliations fr JOIN invoices i ON i.id=fr.invoice_id WHERE i.patient_id=p.id ORDER BY fr.created_at DESC LIMIT 1)
 WHEN 'stock_movements' THEN (SELECT sm.id FROM stock_movements sm WHERE sm.reference_type='synthetic_journey_step' AND sm.reference_id IN (SELECT sj.id FROM synthetic_journey_steps sj WHERE sj.journey_id=j.id) ORDER BY sm.created_at DESC LIMIT 1)
 WHEN 'care_gap_snapshots' THEN (SELECT g.id FROM care_gap_snapshots g WHERE g.patient_id=p.id ORDER BY g.detected_at DESC LIMIT 1)
 ELSE NULL END,c.authoritative_scope,c.consequence,CASE WHEN j.status<>'completed' AND c.step_key IN ('followup','task','care-task','referral-task','preventive','monitoring','safety') THEN 'open' ELSE 'completed' END,j.started_at+((x.ord-1)*interval '18 minutes'),jsonb_build_object('isTestData',true,'journeyKey',j.journey_key,'patientNumber',p.patient_number,'templateKey',j.scenario,'step',c.step_key,'source','workstream4-synthetic')
FROM p JOIN synthetic_journeys j ON j.patient_id=p.id AND j.organization_id=p.organization_id JOIN synthetic_journey_templates t ON t.template_key=j.scenario AND t.active=true CROSS JOIN LATERAL unnest(t.step_keys) WITH ORDINALITY x(step_key,ord) JOIN synthetic_journey_step_catalog c ON c.step_key=x.step_key
ON CONFLICT(journey_id,sequence_no) DO UPDATE SET title=EXCLUDED.title,event_type=EXCLUDED.event_type,authoritative_table=EXCLUDED.authoritative_table,authoritative_id=EXCLUDED.authoritative_id,authoritative_scope=EXCLUDED.authoritative_scope,consequence=EXCLUDED.consequence,status=EXCLUDED.status,occurred_at=EXCLUDED.occurred_at,metadata=EXCLUDED.metadata;

INSERT INTO care_tasks(organization_id,patient_id,encounter_id,task_type,title,priority,status,due_at,payload,created_at,completed_at)
SELECT j.organization_id,j.patient_id,(SELECT e.id FROM encounters e WHERE e.patient_id=j.patient_id ORDER BY e.started_at DESC LIMIT 1),'workstream4.'||c.step_key,c.title,CASE WHEN j.status='referred' THEN 'high' ELSE 'normal' END,CASE WHEN j.status='completed' THEN 'completed' ELSE 'open' END,CASE WHEN j.status='completed' THEN j.started_at+((x.ord-1)*interval '18 minutes') ELSE now()+interval '3 days' END,jsonb_build_object('source','workstream4-synthetic','isTestData',true,'journeyId',j.id,'journeyKey',j.journey_key,'stepKey',c.step_key),j.started_at+((x.ord-1)*interval '18 minutes'),CASE WHEN j.status='completed' THEN j.started_at+((x.ord-1)*interval '18 minutes') ELSE NULL END
FROM synthetic_journeys j JOIN synthetic_journey_templates t ON t.template_key=j.scenario AND t.active=true CROSS JOIN LATERAL unnest(t.step_keys) WITH ORDINALITY x(step_key,ord) JOIN synthetic_journey_step_catalog c ON c.step_key=x.step_key
WHERE c.authoritative_table='care_tasks' AND NOT EXISTS(SELECT 1 FROM care_tasks ct WHERE ct.patient_id=j.patient_id AND ct.title=c.title);

INSERT INTO queue_entries(queue_id,patient_id,appointment_id,priority,status,joined_at,called_at,completed_at)
SELECT 'd7b6c1f4-7d3a-4c8e-bd64-3d4f8e600001'::uuid,j.patient_id,(SELECT a.id FROM appointments a WHERE a.patient_id=j.patient_id ORDER BY a.start_at DESC LIMIT 1),'normal',CASE WHEN j.status='completed' THEN 'completed' ELSE 'waiting' END,j.started_at+((x.ord-1)*interval '18 minutes'),CASE WHEN j.status='completed' THEN j.started_at+((x.ord-1)*interval '18 minutes') ELSE NULL END,CASE WHEN j.status='completed' THEN j.started_at+((x.ord-1)*interval '18 minutes') ELSE NULL END
FROM synthetic_journeys j JOIN synthetic_journey_templates t ON t.template_key=j.scenario AND t.active=true CROSS JOIN LATERAL unnest(t.step_keys) WITH ORDINALITY x(step_key,ord) JOIN synthetic_journey_step_catalog c ON c.step_key=x.step_key
WHERE c.authoritative_table='queue_entries' AND NOT EXISTS(SELECT 1 FROM queue_entries q WHERE q.patient_id=j.patient_id);

INSERT INTO procedures(patient_id,encounter_id,code_system,code,display,performed_at)
SELECT j.patient_id,(SELECT e.id FROM encounters e WHERE e.patient_id=j.patient_id ORDER BY e.started_at DESC LIMIT 1),'SNOMED','WS4-PROC',c.title||' [synthetic]',j.started_at+((x.ord-1)*interval '18 minutes')
FROM synthetic_journeys j JOIN synthetic_journey_templates t ON t.template_key=j.scenario AND t.active=true CROSS JOIN LATERAL unnest(t.step_keys) WITH ORDINALITY x(step_key,ord) JOIN synthetic_journey_step_catalog c ON c.step_key=x.step_key
WHERE c.authoritative_table='procedures' AND NOT EXISTS(SELECT 1 FROM procedures pr WHERE pr.patient_id=j.patient_id);

INSERT INTO referrals(patient_id,encounter_id,destination,reason,status,created_at)
SELECT j.patient_id,(SELECT e.id FROM encounters e WHERE e.patient_id=j.patient_id ORDER BY e.started_at DESC LIMIT 1),'Surgical Service','Surgical continuity referral [synthetic]',CASE WHEN j.status='completed' THEN 'completed' ELSE 'active' END,j.started_at+((x.ord-1)*interval '18 minutes')
FROM synthetic_journeys j JOIN synthetic_journey_templates t ON t.template_key=j.scenario AND t.active=true CROSS JOIN LATERAL unnest(t.step_keys) WITH ORDINALITY x(step_key,ord) JOIN synthetic_journey_step_catalog c ON c.step_key=x.step_key
WHERE c.authoritative_table='referrals' AND NOT EXISTS(SELECT 1 FROM referrals r WHERE r.patient_id=j.patient_id);

INSERT INTO stock_movements(item_id,batch_id,movement_type,quantity,reference_type,reference_id,created_at)
SELECT '3f4615bd-26ab-4ca6-9d21-07bc7ee6023d'::uuid,'d8875e49-1ab8-4109-bf6e-bce9d005ae3a'::uuid,'issue',1,'synthetic_journey_step',s.id,s.occurred_at
FROM synthetic_journey_steps s
WHERE s.step_key IN ('treatment','inventory') AND s.authoritative_table='stock_movements'
AND NOT EXISTS(SELECT 1 FROM stock_movements sm WHERE sm.reference_type='synthetic_journey_step' AND sm.reference_id=s.id);

UPDATE inventory_batches ib SET quantity=GREATEST(0,720-(SELECT count(*) FROM stock_movements sm WHERE sm.batch_id=ib.id AND sm.reference_type='synthetic_journey_step'))
WHERE ib.id='d8875e49-1ab8-4109-bf6e-bce9d005ae3a'::uuid;

WITH p AS (SELECT id,organization_id,patient_number FROM patients WHERE is_test_data=true AND patient_number LIKE 'TEST-%')
INSERT INTO synthetic_journey_steps(organization_id,journey_id,patient_id,sequence_no,step_key,title,event_type,authoritative_table,authoritative_id,authoritative_scope,consequence,status,occurred_at,metadata)
SELECT p.organization_id,j.id,p.id,x.ord::int,c.step_key,c.title,c.event_type,c.authoritative_table,CASE c.authoritative_table
 WHEN 'patients' THEN p.id
 WHEN 'appointments' THEN (SELECT a.id FROM appointments a WHERE a.patient_id=p.id AND a.organization_id=p.organization_id ORDER BY a.start_at DESC LIMIT 1)
 WHEN 'queue_entries' THEN (SELECT q.id FROM queue_entries q WHERE q.patient_id=p.id ORDER BY q.joined_at DESC LIMIT 1)
 WHEN 'encounters' THEN (SELECT e.id FROM encounters e WHERE e.patient_id=p.id AND e.organization_id=p.organization_id ORDER BY e.started_at DESC LIMIT 1)
 WHEN 'clinical_notes' THEN (SELECT n.id FROM clinical_notes n JOIN encounters e ON e.id=n.encounter_id WHERE e.patient_id=p.id ORDER BY n.id DESC LIMIT 1)
 WHEN 'diagnoses' THEN (SELECT d.id FROM diagnoses d WHERE d.patient_id=p.id ORDER BY d.id DESC LIMIT 1)
 WHEN 'clinical_orders' THEN (SELECT o.id FROM clinical_orders o WHERE o.patient_id=p.id ORDER BY o.created_at DESC LIMIT 1)
 WHEN 'admissions' THEN (SELECT a.id FROM admissions a WHERE a.patient_id=p.id AND a.organization_id=p.organization_id ORDER BY a.admitted_at DESC LIMIT 1)
 WHEN 'procedures' THEN (SELECT pr.id FROM procedures pr WHERE pr.patient_id=p.id ORDER BY pr.performed_at DESC NULLS LAST LIMIT 1)
 WHEN 'referrals' THEN (SELECT r.id FROM referrals r WHERE r.patient_id=p.id ORDER BY r.created_at DESC LIMIT 1)
 WHEN 'maternity_records' THEN (SELECT m.id FROM maternity_records m WHERE m.patient_id=p.id ORDER BY m.event_at DESC LIMIT 1)
 WHEN 'birth_events' THEN (SELECT b.id FROM birth_events b WHERE b.mother_patient_id=p.id ORDER BY b.birth_datetime DESC LIMIT 1)
 WHEN 'newborn_records' THEN (SELECT n.id FROM newborn_records n WHERE n.mother_patient_id=p.id ORDER BY n.created_at DESC LIMIT 1)
 WHEN 'postnatal_contacts' THEN (SELECT c.id FROM postnatal_contacts c WHERE c.patient_id=p.id ORDER BY c.contact_date DESC LIMIT 1)
 WHEN 'care_tasks' THEN (SELECT t.id FROM care_tasks t WHERE t.patient_id=p.id ORDER BY t.created_at DESC LIMIT 1)
 WHEN 'clinical_signals' THEN (SELECT s.id FROM clinical_signals s WHERE s.patient_id=p.id ORDER BY s.created_at DESC LIMIT 1)
 WHEN 'invoices' THEN (SELECT i.id FROM invoices i WHERE i.patient_id=p.id AND i.organization_id=p.organization_id ORDER BY i.created_at DESC LIMIT 1)
 WHEN 'claims' THEN (SELECT c.id FROM claims c WHERE c.patient_id=p.id ORDER BY c.submitted_at DESC NULLS LAST LIMIT 1)
 WHEN 'finance_reconciliations' THEN (SELECT fr.id FROM finance_reconciliations fr JOIN invoices i ON i.id=fr.invoice_id WHERE i.patient_id=p.id ORDER BY fr.created_at DESC LIMIT 1)
 WHEN 'stock_movements' THEN (SELECT sm.id FROM stock_movements sm WHERE sm.reference_type='synthetic_journey_step' AND sm.reference_id IN (SELECT sj.id FROM synthetic_journey_steps sj WHERE sj.journey_id=j.id) ORDER BY sm.created_at DESC LIMIT 1)
 WHEN 'care_gap_snapshots' THEN (SELECT g.id FROM care_gap_snapshots g WHERE g.patient_id=p.id ORDER BY g.detected_at DESC LIMIT 1)
 ELSE NULL END,c.authoritative_scope,c.consequence,CASE WHEN j.status<>'completed' AND c.step_key IN ('followup','task','care-task','referral-task','preventive','monitoring','safety') THEN 'open' ELSE 'completed' END,j.started_at+((x.ord-1)*interval '18 minutes'),jsonb_build_object('isTestData',true,'journeyKey',j.journey_key,'patientNumber',p.patient_number,'templateKey',j.scenario,'step',c.step_key,'source','workstream4-synthetic')
FROM p JOIN synthetic_journeys j ON j.patient_id=p.id AND j.organization_id=p.organization_id JOIN synthetic_journey_templates t ON t.template_key=j.scenario AND t.active=true CROSS JOIN LATERAL unnest(t.step_keys) WITH ORDINALITY x(step_key,ord) JOIN synthetic_journey_step_catalog c ON c.step_key=x.step_key
ON CONFLICT(journey_id,sequence_no) DO UPDATE SET title=EXCLUDED.title,event_type=EXCLUDED.event_type,authoritative_table=EXCLUDED.authoritative_table,authoritative_id=EXCLUDED.authoritative_id,authoritative_scope=EXCLUDED.authoritative_scope,consequence=EXCLUDED.consequence,status=EXCLUDED.status,occurred_at=EXCLUDED.occurred_at,metadata=EXCLUDED.metadata;

INSERT INTO outbox_events(id,organization_id,event_type,aggregate_type,aggregate_id,payload,event_key,status,attempts,available_at,processed_at,correlation_id,causation_id,schema_version)
SELECT s.outbox_event_id,s.organization_id,s.event_type,s.authoritative_table,s.authoritative_id,jsonb_build_object('patientId',s.patient_id,'patientNumber',p.patient_number,'encounterId',(SELECT e.id FROM encounters e WHERE e.patient_id=s.patient_id ORDER BY e.started_at DESC LIMIT 1),'journeyId',s.journey_id,'journeyKey',j.journey_key,'stepKey',s.step_key,'authoritativeTable',s.authoritative_table,'authoritativeId',s.authoritative_id,'consequence',s.consequence,'syntheticTestData',true,'source','workstream4-synthetic'),'ws4:'||p.patient_number||':'||j.journey_key||':'||s.sequence_no,'processed',1,s.occurred_at,s.occurred_at,j.id::text,lag(s.outbox_event_id) OVER(PARTITION BY s.journey_id ORDER BY s.sequence_no),1 FROM synthetic_journey_steps s JOIN synthetic_journeys j ON j.id=s.journey_id JOIN patients p ON p.id=s.patient_id WHERE NOT EXISTS(SELECT 1 FROM outbox_events o WHERE o.id=s.outbox_event_id);

INSERT INTO clinical_workflow_events(organization_id,patient_id,encounter_id,event_type,from_state,to_state,payload,actor_id,source_event_id,correlation_id,causation_id,schema_version,created_at)
SELECT s.organization_id,s.patient_id,(SELECT e.id FROM encounters e WHERE e.patient_id=s.patient_id ORDER BY e.started_at DESC LIMIT 1),s.event_type,lag(s.step_key) OVER(PARTITION BY s.journey_id ORDER BY s.sequence_no),s.step_key,jsonb_build_object('patientId',s.patient_id,'patientNumber',p.patient_number,'journeyId',s.journey_id,'journeyKey',j.journey_key,'stepKey',s.step_key,'authoritativeTable',s.authoritative_table,'authoritativeId',s.authoritative_id,'consequence',s.consequence,'syntheticTestData',true,'source','workstream4-synthetic'),NULL,s.outbox_event_id,j.id::text,lag(s.outbox_event_id) OVER(PARTITION BY s.journey_id ORDER BY s.sequence_no),1,s.occurred_at FROM synthetic_journey_steps s JOIN synthetic_journeys j ON j.id=s.journey_id JOIN patients p ON p.id=s.patient_id WHERE NOT EXISTS(SELECT 1 FROM clinical_workflow_events cw WHERE cw.source_event_id=s.outbox_event_id);

INSERT INTO clinical_signals(organization_id,patient_id,encounter_id,source_event_id,signal_type,severity,status,title,summary,evidence,recommendation,action_url,detected_at,resolved_at)
SELECT j.organization_id,j.patient_id,(SELECT e.id FROM encounters e WHERE e.patient_id=j.patient_id ORDER BY e.started_at DESC LIMIT 1),cw.id,'synthetic-journey',CASE WHEN j.status='referred' THEN 'high' WHEN j.status='completed' THEN 'low' ELSE 'moderate' END,CASE WHEN j.status='completed' THEN 'resolved' ELSE 'open' END,j.title||' continuity checkpoint',CASE WHEN j.status='completed' THEN 'Completed synthetic journey checkpoint retained for longitudinal traceability.' ELSE 'Synthetic journey remains active or requires follow-up.' END,jsonb_build_object('journeyId',j.id,'journeyKey',j.journey_key,'status',j.status,'patientNumber',p.patient_number,'syntheticTestData',true,'stepKey',s.step_key),'Review the synthetic journey state and document the next appropriate action. This signal does not prescribe treatment.','/patients/'||j.patient_id::text,s.occurred_at,CASE WHEN j.status='completed' THEN s.occurred_at ELSE NULL END
FROM synthetic_journeys j JOIN patients p ON p.id=j.patient_id JOIN LATERAL(SELECT s.* FROM synthetic_journey_steps s WHERE s.journey_id=j.id AND s.step_key='followup' ORDER BY s.sequence_no DESC LIMIT 1) s ON true JOIN clinical_workflow_events cw ON cw.source_event_id=s.outbox_event_id
WHERE NOT EXISTS(SELECT 1 FROM clinical_signals cs WHERE cs.patient_id=j.patient_id AND cs.signal_type='synthetic-journey' AND cs.evidence->>'journeyId'=j.id::text);

WITH p AS (SELECT id,organization_id,patient_number FROM patients WHERE is_test_data=true AND patient_number LIKE 'TEST-%')
INSERT INTO synthetic_journey_steps(organization_id,journey_id,patient_id,sequence_no,step_key,title,event_type,authoritative_table,authoritative_id,authoritative_scope,consequence,status,occurred_at,metadata)
SELECT p.organization_id,j.id,p.id,x.ord::int,c.step_key,c.title,c.event_type,c.authoritative_table,CASE c.authoritative_table
 WHEN 'patients' THEN p.id
 WHEN 'appointments' THEN (SELECT a.id FROM appointments a WHERE a.patient_id=p.id AND a.organization_id=p.organization_id ORDER BY a.start_at DESC LIMIT 1)
 WHEN 'queue_entries' THEN (SELECT q.id FROM queue_entries q WHERE q.patient_id=p.id ORDER BY q.joined_at DESC LIMIT 1)
 WHEN 'encounters' THEN (SELECT e.id FROM encounters e WHERE e.patient_id=p.id AND e.organization_id=p.organization_id ORDER BY e.started_at DESC LIMIT 1)
 WHEN 'clinical_notes' THEN (SELECT n.id FROM clinical_notes n JOIN encounters e ON e.id=n.encounter_id WHERE e.patient_id=p.id ORDER BY n.id DESC LIMIT 1)
 WHEN 'diagnoses' THEN (SELECT d.id FROM diagnoses d WHERE d.patient_id=p.id ORDER BY d.id DESC LIMIT 1)
 WHEN 'clinical_orders' THEN (SELECT o.id FROM clinical_orders o WHERE o.patient_id=p.id ORDER BY o.created_at DESC LIMIT 1)
 WHEN 'admissions' THEN (SELECT a.id FROM admissions a WHERE a.patient_id=p.id AND a.organization_id=p.organization_id ORDER BY a.admitted_at DESC LIMIT 1)
 WHEN 'procedures' THEN (SELECT pr.id FROM procedures pr WHERE pr.patient_id=p.id ORDER BY pr.performed_at DESC NULLS LAST LIMIT 1)
 WHEN 'referrals' THEN (SELECT r.id FROM referrals r WHERE r.patient_id=p.id ORDER BY r.created_at DESC LIMIT 1)
 WHEN 'maternity_records' THEN (SELECT m.id FROM maternity_records m WHERE m.patient_id=p.id ORDER BY m.event_at DESC LIMIT 1)
 WHEN 'birth_events' THEN (SELECT b.id FROM birth_events b WHERE b.mother_patient_id=p.id ORDER BY b.birth_datetime DESC LIMIT 1)
 WHEN 'newborn_records' THEN (SELECT n.id FROM newborn_records n WHERE n.mother_patient_id=p.id ORDER BY n.created_at DESC LIMIT 1)
 WHEN 'postnatal_contacts' THEN (SELECT c.id FROM postnatal_contacts c WHERE c.patient_id=p.id ORDER BY c.contact_date DESC LIMIT 1)
 WHEN 'care_tasks' THEN (SELECT t.id FROM care_tasks t WHERE t.patient_id=p.id ORDER BY t.created_at DESC LIMIT 1)
 WHEN 'clinical_signals' THEN (SELECT s.id FROM clinical_signals s WHERE s.patient_id=p.id ORDER BY s.created_at DESC LIMIT 1)
 WHEN 'invoices' THEN (SELECT i.id FROM invoices i WHERE i.patient_id=p.id AND i.organization_id=p.organization_id ORDER BY i.created_at DESC LIMIT 1)
 WHEN 'claims' THEN (SELECT c.id FROM claims c WHERE c.patient_id=p.id ORDER BY c.submitted_at DESC NULLS LAST LIMIT 1)
 WHEN 'finance_reconciliations' THEN (SELECT fr.id FROM finance_reconciliations fr JOIN invoices i ON i.id=fr.invoice_id WHERE i.patient_id=p.id ORDER BY fr.created_at DESC LIMIT 1)
 WHEN 'stock_movements' THEN (SELECT sm.id FROM stock_movements sm WHERE sm.reference_type='synthetic_journey_step' AND sm.reference_id IN (SELECT sj.id FROM synthetic_journey_steps sj WHERE sj.journey_id=j.id) ORDER BY sm.created_at DESC LIMIT 1)
 WHEN 'care_gap_snapshots' THEN (SELECT g.id FROM care_gap_snapshots g WHERE g.patient_id=p.id ORDER BY g.detected_at DESC LIMIT 1)
 ELSE NULL END,c.authoritative_scope,c.consequence,CASE WHEN j.status<>'completed' AND c.step_key IN ('followup','task','care-task','referral-task','preventive','monitoring','safety') THEN 'open' ELSE 'completed' END,j.started_at+((x.ord-1)*interval '18 minutes'),jsonb_build_object('isTestData',true,'journeyKey',j.journey_key,'patientNumber',p.patient_number,'templateKey',j.scenario,'step',c.step_key,'source','workstream4-synthetic')
FROM p JOIN synthetic_journeys j ON j.patient_id=p.id AND j.organization_id=p.organization_id JOIN synthetic_journey_templates t ON t.template_key=j.scenario AND t.active=true CROSS JOIN LATERAL unnest(t.step_keys) WITH ORDINALITY x(step_key,ord) JOIN synthetic_journey_step_catalog c ON c.step_key=x.step_key
ON CONFLICT(journey_id,sequence_no) DO UPDATE SET title=EXCLUDED.title,event_type=EXCLUDED.event_type,authoritative_table=EXCLUDED.authoritative_table,authoritative_id=EXCLUDED.authoritative_id,authoritative_scope=EXCLUDED.authoritative_scope,consequence=EXCLUDED.consequence,status=EXCLUDED.status,occurred_at=EXCLUDED.occurred_at,metadata=EXCLUDED.metadata;

UPDATE outbox_events o SET aggregate_id=s.authoritative_id,payload=jsonb_set(o.payload,'{authoritativeId}',to_jsonb(s.authoritative_id),true)
FROM synthetic_journey_steps s WHERE o.id=s.outbox_event_id AND s.authoritative_table='clinical_signals' AND s.authoritative_id IS NOT NULL;

UPDATE clinical_workflow_events cw SET payload=jsonb_set(cw.payload,'{authoritativeId}',to_jsonb(s.authoritative_id),true)
FROM synthetic_journey_steps s WHERE cw.source_event_id=s.outbox_event_id AND s.authoritative_table='clinical_signals' AND s.authoritative_id IS NOT NULL;

INSERT INTO care_graph_edges(organization_id,patient_id,source_type,source_id,target_type,target_id,relationship,metadata)
SELECT s.organization_id,s.patient_id,'patient',s.patient_id,'synthetic_journey_step',s.id,'journey-starts',jsonb_build_object('journeyId',s.journey_id,'source','workstream4') FROM synthetic_journey_steps s WHERE s.sequence_no=1 AND NOT EXISTS(SELECT 1 FROM care_graph_edges e WHERE e.patient_id=s.patient_id AND e.target_type='synthetic_journey_step' AND e.target_id=s.id AND e.relationship='journey-starts');

INSERT INTO care_graph_edges(organization_id,patient_id,source_type,source_id,target_type,target_id,relationship,metadata)
SELECT s.organization_id,s.patient_id,'synthetic_journey_step',lag(s.id) OVER(PARTITION BY s.journey_id ORDER BY s.sequence_no),'synthetic_journey_step',s.id,'precedes',jsonb_build_object('journeyId',s.journey_id,'eventType',s.event_type,'source','workstream4') FROM synthetic_journey_steps s WHERE s.sequence_no>1 AND NOT EXISTS(SELECT 1 FROM care_graph_edges e WHERE e.patient_id=s.patient_id AND e.target_type='synthetic_journey_step' AND e.target_id=s.id AND e.relationship='precedes');

CREATE OR REPLACE VIEW clinai_workstream4_journey_coverage AS SELECT p.patient_number AS "patientNumber",j.journey_key AS "journeyKey",j.title,j.status,count(s.id)::int AS "stepCount",count(s.authoritative_id)::int AS "linkedAuthoritativeSteps",count(DISTINCT cw.id)::int AS "workflowEvents" FROM synthetic_journeys j JOIN patients p ON p.id=j.patient_id LEFT JOIN synthetic_journey_steps s ON s.journey_id=j.id LEFT JOIN clinical_workflow_events cw ON cw.source_event_id=s.outbox_event_id GROUP BY p.patient_number,j.journey_key,j.title,j.status;


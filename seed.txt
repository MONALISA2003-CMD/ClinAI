-- ClinAI synthetic test dataset. Additive and idempotent. No real patient information.

ALTER TABLE patients ADD COLUMN IF NOT EXISTS is_test_data boolean NOT NULL DEFAULT false;
CREATE INDEX IF NOT EXISTS patients_test_data_idx ON patients(organization_id,is_test_data,created_at DESC);
DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='patients_test_email_domain') THEN ALTER TABLE patients ADD CONSTRAINT patients_test_email_domain CHECK (NOT is_test_data OR email IS NULL OR email ILIKE '%@clinaidemoemail.com'); END IF; END $$;

INSERT INTO patients(organization_id,facility_id,patient_number,first_name,last_name,date_of_birth,sex,phone,email,address,preferred_language,status,is_test_data)
SELECT o.id,f.id,v.patient_number,v.first_name,v.last_name,(current_date - (v.age_years || ' years')::interval)::date,v.sex,NULL,v.email,jsonb_build_object('district','Kampala','source','synthetic-test-data'),'English','active',true FROM organizations o JOIN facilities f ON f.organization_id=o.id CROSS JOIN (VALUES
('TEST-001','Mustafa','Lameka',34,'male','lameka@clinaidemoemail.com'),
('TEST-002','Amina','Nabirye',29,'female','nabirye@clinaidemoemail.com'),
('TEST-003','Daniel','Okello',58,'male','okello@clinaidemoemail.com'),
('TEST-004','Grace','Namirembe',42,'female','namirembe@clinaidemoemail.com'),
('TEST-005','Peter','Ssentongo',27,'male','ssentongo@clinaidemoemail.com'),
('TEST-006','Sarah','Atim',31,'female','atim@clinaidemoemail.com'),
('TEST-007','Joseph','Ouma',46,'male','ouma@clinaidemoemail.com'),
('TEST-008','Mariam','Nakato',24,'female','nakato@clinaidemoemail.com'),
('TEST-009','Rebecca','Aciro',36,'female','aciro@clinaidemoemail.com'),
('TEST-010','Brian','Kato',2,'male','kato@clinaidemoemail.com'),
('TEST-011','Esther','Nansubuga',7,'female','nansubuga@clinaidemoemail.com'),
('TEST-012','Isaac','Mugisha',19,'male','mugisha@clinaidemoemail.com'),
('TEST-013','Ruth','Akello',63,'female','akello@clinaidemoemail.com'),
('TEST-014','Samuel','Waiswa',51,'male','waiswa@clinaidemoemail.com'),
('TEST-015','Janet','Nambooze',38,'female','namboozo@clinaidemoemail.com'),
('TEST-016','Emmanuel','Turyasingura',22,'male','turyasingura@clinaidemoemail.com'),
('TEST-017','Florence','Nakanwagi',47,'female','nakanwagi@clinaidemoemail.com'),
('TEST-018','Patrick','Mwesigwa',33,'male','mwesigwa@clinaidemoemail.com'),
('TEST-019','Agnes','Lukwago',70,'female','lukwago@clinaidemoemail.com'),
('TEST-020','Michael','Bukenya',41,'male','bukenya@clinaidemoemail.com'),
('TEST-021','Hawa','Ssenyonga',55,'female','ssenyonga@clinaidemoemail.com'),
('TEST-022','Alex','Kisakye',14,'male','kisakye@clinaidemoemail.com'),
('TEST-023','Mary','Namutebi',30,'female','namutebi@clinaidemoemail.com'),
('TEST-024','John','Ocen',44,'male','ocen@clinaidemoemail.com'),
('TEST-025','Lydia','Kiconco',26,'female','kiconco@clinaidemoemail.com'),
('TEST-026','Robert','Byaruhanga',61,'male','byaruhanga@clinaidemoemail.com'),
('TEST-027','Susan','Nakitende',9,'female','nakitende@clinaidemoemail.com'),
('TEST-028','George','Tumusiime',39,'male','tumusiime@clinaidemoemail.com'),
('TEST-029','Irene','Chebet',35,'female','chebet@clinaidemoemail.com'),
('TEST-030','Moses','Kisembo',49,'male','kisembo@clinaidemoemail.com')) v(patient_number,first_name,last_name,age_years,sex,email) WHERE o.name='ClinAI Demo Organization' AND f.name='Main Facility' AND NOT EXISTS (SELECT 1 FROM patients p WHERE p.organization_id=o.id AND p.patient_number=v.patient_number);

INSERT INTO diagnoses(patient_id,encounter_id,code_system,code,display,diagnosis_type,status)
SELECT p.id,NULL,'SNOMED-CT',v.code,v.display,'working','active' FROM patients p JOIN (VALUES
('TEST-001','malaria','malaria with persistent fever and anaemia'),
('TEST-002','diabetes','type 2 diabetes with missed follow-up'),
('TEST-003','hypertension','hypertension with poor recent control'),
('TEST-004','diabetes-hypertension','diabetes and hypertension with medication discrepancy'),
('TEST-005','pneumonia','community acquired pneumonia with hypoxia'),
('TEST-006','tuberculosis-suspect','suspected tuberculosis with pending confirmatory result'),
('TEST-007','hiv-follow-up','HIV care follow-up with missed appointment'),
('TEST-008','maternal-anaemia','antenatal care with maternal anaemia'),
('TEST-009','high-risk-pregnancy','high risk pregnancy with elevated blood pressure'),
('TEST-010','paediatric-anaemia','paediatric fever with anaemia and nutrition concern'),
('TEST-011','paediatric-pneumonia','paediatric pneumonia with low oxygen saturation'),
('TEST-012','sickle-cell','sickle cell disease follow-up with pain episode'),
('TEST-013','heart-failure','heart failure and hypertension monitoring'),
('TEST-014','ckd','chronic kidney disease with abnormal renal function'),
('TEST-015','uti','recurrent urinary symptoms with abnormal urinalysis'),
('TEST-016','fracture','road traffic trauma with fracture requiring surgery'),
('TEST-017','postoperative-infection','postoperative wound infection under review'),
('TEST-018','appendicitis','acute appendicitis after emergency presentation'),
('TEST-019','polypharmacy','polypharmacy with medication reconciliation gap'),
('TEST-020','asthma','asthma with recurrent emergency visits'),
('TEST-021','acute-diarrhoea','diarrhoeal illness with dehydration risk'),
('TEST-022','malnutrition','malnutrition with incomplete immunization review'),
('TEST-023','postnatal-anaemia','postnatal follow-up with maternal anaemia'),
('TEST-024','diabetes','type 2 diabetes with elevated glucose trend'),
('TEST-025','uti','UTI with delayed laboratory review'),
('TEST-026','hypertensive-heart-disease','hypertensive heart disease with overdue review'),
('TEST-027','febrile-illness','febrile illness with incomplete vaccination record'),
('TEST-028','anaemia','gastrointestinal symptoms with anaemia workup'),
('TEST-029','pregnancy-follow-up','pregnancy follow-up with pending referral'),
('TEST-030','diabetes-htn-ckd','multimorbidity with diabetes, hypertension and CKD')) v(patient_number,code,display) ON v.patient_number=p.patient_number WHERE p.is_test_data AND NOT EXISTS (SELECT 1 FROM diagnoses d WHERE d.patient_id=p.id AND d.code=v.code);

INSERT INTO encounters(organization_id,facility_id,patient_id,type,status,started_at,ended_at)
SELECT p.organization_id,p.facility_id,p.id,'outpatient','completed',now()-((substring(p.patient_number from 6))::int)*interval '1 day',now()-((substring(p.patient_number from 6))::int)*interval '1 day'+interval '35 minutes' FROM patients p WHERE p.is_test_data AND NOT EXISTS (SELECT 1 FROM encounters e WHERE e.patient_id=p.id);

INSERT INTO observations(patient_id,code,display,value_numeric,unit,observed_at) SELECT p.id,v.code,v.code,v.value,v.unit,now()-interval '2 hours' FROM patients p JOIN (VALUES
('TEST-001','temperature',38.7,'C'),
('TEST-001','spo2',96,'%'),
('TEST-001','systolic-bp',124,'mmHg'),
('TEST-002','temperature',37.5,'C'),
('TEST-002','spo2',97,'%'),
('TEST-002','systolic-bp',142,'mmHg'),
('TEST-003','temperature',37.1,'C'),
('TEST-003','spo2',96,'%'),
('TEST-003','systolic-bp',154,'mmHg'),
('TEST-004','temperature',37.300000000000004,'C'),
('TEST-004','spo2',97,'%'),
('TEST-004','systolic-bp',142,'mmHg'),
('TEST-005','temperature',38.7,'C'),
('TEST-005','spo2',91,'%'),
('TEST-005','systolic-bp',124,'mmHg'),
('TEST-006','temperature',38.7,'C'),
('TEST-006','spo2',97,'%'),
('TEST-006','systolic-bp',126,'mmHg'),
('TEST-007','temperature',37.300000000000004,'C'),
('TEST-007','spo2',96,'%'),
('TEST-007','systolic-bp',128,'mmHg'),
('TEST-008','temperature',37.5,'C'),
('TEST-008','spo2',97,'%'),
('TEST-008','systolic-bp',122,'mmHg'),
('TEST-009','temperature',37.1,'C'),
('TEST-009','spo2',96,'%'),
('TEST-009','systolic-bp',154,'mmHg'),
('TEST-010','temperature',38.7,'C'),
('TEST-010','spo2',97,'%'),
('TEST-010','systolic-bp',126,'mmHg'),
('TEST-011','temperature',38.7,'C'),
('TEST-011','spo2',92,'%'),
('TEST-011','systolic-bp',128,'mmHg'),
('TEST-012','temperature',37.1,'C'),
('TEST-012','spo2',97,'%'),
('TEST-012','systolic-bp',122,'mmHg'),
('TEST-013','temperature',37.300000000000004,'C'),
('TEST-013','spo2',96,'%'),
('TEST-013','systolic-bp',154,'mmHg'),
('TEST-014','temperature',37.5,'C'),
('TEST-014','spo2',97,'%'),
('TEST-014','systolic-bp',126,'mmHg'),
('TEST-015','temperature',37.1,'C'),
('TEST-015','spo2',96,'%'),
('TEST-015','systolic-bp',128,'mmHg'),
('TEST-016','temperature',37.300000000000004,'C'),
('TEST-016','spo2',97,'%'),
('TEST-016','systolic-bp',122,'mmHg'),
('TEST-017','temperature',37.5,'C'),
('TEST-017','spo2',96,'%'),
('TEST-017','systolic-bp',124,'mmHg'),
('TEST-018','temperature',37.1,'C'),
('TEST-018','spo2',97,'%'),
('TEST-018','systolic-bp',126,'mmHg'),
('TEST-019','temperature',37.300000000000004,'C'),
('TEST-019','spo2',96,'%'),
('TEST-019','systolic-bp',128,'mmHg'),
('TEST-020','temperature',37.5,'C'),
('TEST-020','spo2',97,'%'),
('TEST-020','systolic-bp',122,'mmHg'),
('TEST-021','temperature',38.7,'C'),
('TEST-021','spo2',96,'%'),
('TEST-021','systolic-bp',124,'mmHg'),
('TEST-022','temperature',37.300000000000004,'C'),
('TEST-022','spo2',97,'%'),
('TEST-022','systolic-bp',126,'mmHg'),
('TEST-023','temperature',37.5,'C'),
('TEST-023','spo2',96,'%'),
('TEST-023','systolic-bp',128,'mmHg'),
('TEST-024','temperature',37.1,'C'),
('TEST-024','spo2',97,'%'),
('TEST-024','systolic-bp',142,'mmHg'),
('TEST-025','temperature',37.300000000000004,'C'),
('TEST-025','spo2',96,'%'),
('TEST-025','systolic-bp',124,'mmHg'),
('TEST-026','temperature',37.5,'C'),
('TEST-026','spo2',97,'%'),
('TEST-026','systolic-bp',154,'mmHg'),
('TEST-027','temperature',38.7,'C'),
('TEST-027','spo2',96,'%'),
('TEST-027','systolic-bp',128,'mmHg'),
('TEST-028','temperature',37.300000000000004,'C'),
('TEST-028','spo2',97,'%'),
('TEST-028','systolic-bp',122,'mmHg'),
('TEST-029','temperature',37.5,'C'),
('TEST-029','spo2',96,'%'),
('TEST-029','systolic-bp',124,'mmHg'),
('TEST-030','temperature',37.1,'C'),
('TEST-030','spo2',97,'%'),
('TEST-030','systolic-bp',154,'mmHg')) v(patient_number,code,value,unit) ON v.patient_number=p.patient_number WHERE p.is_test_data AND NOT EXISTS (SELECT 1 FROM observations o WHERE o.patient_id=p.id AND o.code=v.code AND o.observed_at>now()-interval '1 day');

INSERT INTO clinical_orders(patient_id,order_type,priority,status,details,created_at) SELECT p.id,v.order_type,v.priority,'ordered',jsonb_build_object('seedKey',v.seed_key,'description',v.description),now()-interval '1 day' FROM patients p JOIN (VALUES
('TEST-001','laboratory','routine','lab-1','Laboratory review for malaria with persistent fever and anaemia'),
('TEST-005','laboratory','urgent','lab-5','Laboratory review for community acquired pneumonia with hypoxia'),
('TEST-006','laboratory','urgent','lab-6','Laboratory review for suspected tuberculosis with pending confirmatory result'),
('TEST-010','laboratory','routine','lab-10','Laboratory review for paediatric fever with anaemia and nutrition concern'),
('TEST-011','laboratory','urgent','lab-11','Laboratory review for paediatric pneumonia with low oxygen saturation'),
('TEST-014','laboratory','routine','lab-14','Laboratory review for chronic kidney disease with abnormal renal function'),
('TEST-015','laboratory','routine','lab-15','Laboratory review for recurrent urinary symptoms with abnormal urinalysis'),
('TEST-021','laboratory','routine','lab-21','Laboratory review for diarrhoeal illness with dehydration risk'),
('TEST-024','laboratory','routine','lab-24','Laboratory review for type 2 diabetes with elevated glucose trend'),
('TEST-027','laboratory','routine','lab-27','Laboratory review for febrile illness with incomplete vaccination record'),
('TEST-028','laboratory','routine','lab-28','Laboratory review for gastrointestinal symptoms with anaemia workup'),
('TEST-030','laboratory','routine','lab-30','Laboratory review for multimorbidity with diabetes, hypertension and CKD'),
('TEST-016','procedure','urgent','proc-16','Procedure review for road traffic trauma with fracture requiring surgery'),
('TEST-017','procedure','urgent','proc-17','Procedure review for postoperative wound infection under review'),
('TEST-018','procedure','urgent','proc-18','Procedure review for acute appendicitis after emergency presentation'),
('TEST-020','procedure','urgent','proc-20','Procedure review for asthma with recurrent emergency visits'),
('TEST-029','procedure','urgent','proc-29','Procedure review for pregnancy follow-up with pending referral')) v(patient_number,order_type,priority,seed_key,description) ON v.patient_number=p.patient_number WHERE p.is_test_data AND NOT EXISTS (SELECT 1 FROM clinical_orders co WHERE co.patient_id=p.id AND co.details->>'seedKey'=v.seed_key);

INSERT INTO lab_tests(organization_id,code,name,unit,active) SELECT o.id,v.code,v.name,v.unit,true FROM organizations o JOIN (VALUES
('RDT-MAL','Malaria rapid diagnostic test','result'),
('FBC-HB','Haemoglobin','g/dL'),
('O2','Oxygen saturation','%'),
('CREAT','Creatinine','µmol/L'),
('URINE','Urinalysis','result'),
('AFB','TB microscopy','result'),
('GLU','Random blood glucose','mmol/L')) v(code,name,unit) ON true WHERE o.name='ClinAI Demo Organization' AND NOT EXISTS (SELECT 1 FROM lab_tests lt WHERE lt.organization_id=o.id AND lt.code=v.code);

INSERT INTO lab_samples(order_id,barcode,specimen_type,status,collected_at,received_at,processed_at) SELECT co.id,'CLINAI-TEST-'||substring(co.details->>'seedKey' from 5),'blood','processed',now()-interval '20 hours',now()-interval '18 hours',now()-interval '12 hours' FROM clinical_orders co JOIN patients p ON p.id=co.patient_id WHERE p.is_test_data AND co.order_type='laboratory' AND NOT EXISTS (SELECT 1 FROM lab_samples ls WHERE ls.order_id=co.id);

INSERT INTO lab_results(sample_id,test_id,value_numeric,value_text,unit,abnormal_flag,critical,status,verified_at) SELECT ls.id,lt.id,v.value_numeric,v.value_text,lt.unit,v.abnormal,v.critical,CASE WHEN v.value_text='pending' THEN 'preliminary' ELSE 'preliminary' END,NULL FROM lab_samples ls JOIN clinical_orders co ON co.id=ls.order_id JOIN patients p ON p.id=co.patient_id JOIN (VALUES
('TEST-001','RDT-MAL',NULL,'positive','abnormal',false),
('TEST-005','O2',91,NULL,'critical',true),
('TEST-006','AFB',NULL,'pending','pending',false),
('TEST-010','FBC-HB',NULL,'8.9','low',false),
('TEST-011','O2',90,NULL,'critical',true),
('TEST-014','CREAT',NULL,'260','high',true),
('TEST-015','URINE',NULL,'positive','abnormal',false),
('TEST-021','FBC-HB',NULL,'9.4','low',false),
('TEST-024','GLU',NULL,'14.8','high',false),
('TEST-027','FBC-HB',NULL,'10.1','low',false),
('TEST-028','FBC-HB',NULL,'8.7','low',false),
('TEST-030','CREAT',NULL,'310','high',true)) v(patient_number,test_code,value_numeric,value_text,abnormal,critical) ON v.patient_number=p.patient_number JOIN lab_tests lt ON lt.organization_id=p.organization_id AND lt.code=v.test_code WHERE p.is_test_data AND NOT EXISTS (SELECT 1 FROM lab_results lr WHERE lr.sample_id=ls.id);

INSERT INTO medications(organization_id,code,name,form,active) SELECT o.id,v.code,v.name,v.form,true FROM organizations o JOIN (VALUES
('ART-TEST','Antiretroviral therapy','tablet'),
('MET-TEST','Metformin','tablet'),
('AML-TEST','Amlodipine','tablet'),
('PCM-TEST','Paracetamol','tablet'),
('ACT-TEST','Artemether-lumefantrine','tablet'),
('AMX-TEST','Amoxicillin','capsule'),
('INS-TEST','Insulin','injection'),
('SAL-TEST','Salbutamol','inhaler'),
('FUR-TEST','Furosemide','tablet'),
('CEF-TEST','Ceftriaxone','injection')) v(code,name,form) ON true WHERE o.name='ClinAI Demo Organization' AND NOT EXISTS (SELECT 1 FROM medications m WHERE m.organization_id=o.id AND m.code=v.code);

INSERT INTO medication_orders(patient_id,medication_id,dose,frequency,route,duration,quantity,status) SELECT p.id,m.id,CASE m.code WHEN 'ART-TEST' THEN '1 tablet' WHEN 'SAL-TEST' THEN '2 puffs' ELSE '1 tablet' END,'twice daily','oral','30 days',30,'active' FROM patients p JOIN medications m ON m.organization_id=p.organization_id AND m.code IN ('SAL-TEST','MET-TEST','ACT-TEST','FUR-TEST','AML-TEST','ART-TEST','AMX-TEST') JOIN (VALUES ('TEST-001','ACT-TEST'),('TEST-002','MET-TEST'),('TEST-003','AML-TEST'),('TEST-004','MET-TEST'),('TEST-005','AMX-TEST'),('TEST-007','ART-TEST'),('TEST-013','FUR-TEST'),('TEST-020','SAL-TEST'),('TEST-024','MET-TEST'),('TEST-026','AML-TEST'),('TEST-030','MET-TEST')) v(patient_number,med_code) ON v.patient_number=p.patient_number AND v.med_code=m.code WHERE p.is_test_data AND NOT EXISTS (SELECT 1 FROM medication_orders mo WHERE mo.patient_id=p.id AND mo.medication_id=m.id);

INSERT INTO referrals(patient_id,reason,destination,status,created_at) SELECT p.id,v.reason,v.destination,v.status,now()-interval '2 days' FROM patients p JOIN (VALUES
('TEST-006','TB diagnostic referral pending','Regional TB clinic','pending'),
('TEST-009','High risk pregnancy review','Maternity specialist','sent'),
('TEST-016','Orthopaedic surgery referral','Orthopaedic theatre','accepted'),
('TEST-019','Medication reconciliation review','Clinical pharmacy','pending'),
('TEST-029','Antenatal referral','Maternity specialist','pending'),
('TEST-030','Renal review','Renal clinic','pending')) v(patient_number,reason,destination,status) ON v.patient_number=p.patient_number WHERE p.is_test_data AND NOT EXISTS (SELECT 1 FROM referrals r WHERE r.patient_id=p.id AND r.reason=v.reason);

INSERT INTO care_tasks(organization_id,patient_id,task_type,title,priority,status,due_at,payload) SELECT p.organization_id,p.id,'clinical-review',v.title,v.priority,'open',now()+interval '1 day',jsonb_build_object('seedKey','task-'||v.patient_number,'source','synthetic-test-data') FROM patients p JOIN (VALUES
('TEST-001','Review malaria result and anaemia','urgent'),
('TEST-002','Follow-up diabetes review overdue','high'),
('TEST-004','Reconcile medication list','high'),
('TEST-005','Review critical oxygen result','urgent'),
('TEST-006','Follow up TB confirmatory test','high'),
('TEST-009','Review high risk pregnancy referral','urgent'),
('TEST-014','Review renal function','high'),
('TEST-017','Review postoperative wound','high'),
('TEST-019','Complete medication reconciliation','high'),
('TEST-021','Assess hydration status','high'),
('TEST-022','Immunization review','normal'),
('TEST-024','Review glucose trend','high'),
('TEST-025','Laboratory result follow-up','high'),
('TEST-029','Track antenatal referral','high'),
('TEST-030','Coordinate renal and diabetes review','urgent')) v(patient_number,title,priority) ON v.patient_number=p.patient_number WHERE p.is_test_data AND NOT EXISTS (SELECT 1 FROM care_tasks ct WHERE ct.patient_id=p.id AND ct.payload->>'seedKey'='task-'||v.patient_number);

INSERT INTO chronic_care_records(organization_id,patient_id,condition_code,condition_name,status,goals,measures,medications,next_review_at,risk_level,care_plan) SELECT p.organization_id,p.id,v.code,v.name,'active','[]','{}','[]',now()+interval '14 days',v.risk,jsonb_build_object('seed','synthetic-test-data') FROM patients p JOIN (VALUES
('TEST-002','E11','Type 2 diabetes','high'),
('TEST-003','I10','Hypertension','moderate'),
('TEST-004','E11','Type 2 diabetes','high'),
('TEST-004','I10','Hypertension','high'),
('TEST-007','Z21','HIV follow-up','moderate'),
('TEST-013','I50','Heart failure','high'),
('TEST-014','N18','Chronic kidney disease','high'),
('TEST-030','E11','Type 2 diabetes','high'),
('TEST-030','I10','Hypertension','high'),
('TEST-030','N18','Chronic kidney disease','high')) v(patient_number,code,name,risk) ON v.patient_number=p.patient_number WHERE p.is_test_data AND NOT EXISTS (SELECT 1 FROM chronic_care_records c WHERE c.patient_id=p.id AND c.condition_code=v.code);

INSERT INTO maternity_records(organization_id,patient_id,event_type,gestational_age_weeks,gravida,para,maternal_observations,fetal_observations,status,event_at,notes) SELECT p.organization_id,p.id,v.event_type,v.ga,v.g,v.pa,jsonb_build_object('bloodPressure',v.bp),jsonb_build_object('fetalHeartRate',145),'active',now()-interval '3 days',v.notes FROM patients p JOIN (VALUES
('TEST-008',28,2,1,'118/76','antenatal','maternal anaemia noted; review pending'),
('TEST-009',32,4,2,'150/96','antenatal','elevated blood pressure requires review'),
('TEST-023',6,2,1,'120/78','postnatal','maternal anaemia follow-up'),
('TEST-029',24,1,0,'120/78','antenatal','referral pending')) v(patient_number,ga,g,pa,bp,event_type,notes) ON v.patient_number=p.patient_number WHERE p.is_test_data AND NOT EXISTS (SELECT 1 FROM maternity_records m WHERE m.patient_id=p.id AND m.event_type=v.event_type AND m.event_at>now()-interval '7 days');

INSERT INTO pediatric_assessments(organization_id,patient_id,age_months,weight_kg,height_cm,muac_mm,temperature,respiratory_rate,spo2,assessment,imci_classification,nutrition_status,referral_required) SELECT p.organization_id,p.id,v.age,v.weight,v.height,v.muac,v.temp,v.rr,v.spo2,jsonb_build_object('problem',v.problem),jsonb_build_object('classification',v.problem),CASE WHEN v.problem ILIKE '%malnutrition%' THEN 'moderate acute malnutrition' ELSE 'not-assessed' END,v.referral FROM patients p JOIN (VALUES
('TEST-010',24,10.2,82,112,38.8,58,95,'moderate acute malnutrition',false),
('TEST-011',84,18.5,112,140,39.1,42,90,'pneumonia',true),
('TEST-022',168,36,142,135,37.8,22,98,'moderate acute malnutrition',false),
('TEST-027',108,25,128,112,38.4,28,97,'febrile illness',false)) v(patient_number,age,weight,height,muac,temp,rr,spo2,problem,referral) WHERE p.patient_number=v.patient_number AND p.is_test_data AND NOT EXISTS (SELECT 1 FROM pediatric_assessments pa WHERE pa.patient_id=p.id);

INSERT INTO surgery_cases(organization_id,patient_id,procedure_name,scheduled_at,status,consent_confirmed,checklist,notes) SELECT p.organization_id,p.id,v.proc,now()-interval '1 day',v.status,true,jsonb_build_object('identity','complete','site','complete'),jsonb_build_object('seed','synthetic-test-data') FROM patients p JOIN (VALUES
('TEST-016','Open reduction internal fixation','completed'),
('TEST-018','Appendectomy','completed'),
('TEST-017','Wound exploration and drainage','scheduled')) v(patient_number,proc,status) ON v.patient_number=p.patient_number WHERE p.is_test_data AND NOT EXISTS (SELECT 1 FROM surgery_cases s WHERE s.patient_id=p.id AND s.procedure_name=v.proc);

INSERT INTO admissions(organization_id,patient_id,ward,bed,status,admitted_at,discharge_summary) SELECT p.organization_id,p.id,v.ward,v.bed,v.status,now()-interval '8 hours',v.summary FROM patients p JOIN (VALUES
('TEST-005','Medical','M-12','admitted','Pneumonia with low oxygen saturation under inpatient review'),('TEST-016','Surgical','S-04','discharged','Road traffic trauma with fracture treated surgically'),('TEST-018','Surgical','S-02','discharged','Appendicitis treated with appendectomy')) v(patient_number,ward,bed,status,summary) ON v.patient_number=p.patient_number WHERE p.is_test_data AND NOT EXISTS (SELECT 1 FROM admissions a WHERE a.patient_id=p.id);


INSERT INTO appointments(organization_id,facility_id,patient_id,start_at,end_at,type,status,reason)
SELECT p.organization_id,p.facility_id,p.id,CASE WHEN p.patient_number IN ('TEST-002','TEST-004','TEST-009','TEST-014','TEST-024','TEST-030') THEN now()+interval '1 hour' ELSE now()-interval '2 hours' END,CASE WHEN p.patient_number IN ('TEST-002','TEST-004','TEST-009','TEST-014','TEST-024','TEST-030') THEN now()+interval '1 hour 30 minutes' ELSE now()-interval '90 minutes' END,'test-care-review',CASE WHEN p.patient_number IN ('TEST-002','TEST-004','TEST-009','TEST-014','TEST-024','TEST-030') THEN 'scheduled' ELSE 'completed' END,'Synthetic test patient care review'
FROM patients p WHERE p.is_test_data AND NOT EXISTS (SELECT 1 FROM appointments a WHERE a.patient_id=p.id AND a.type='test-care-review');

INSERT INTO facility_beds(organization_id,facility_id,ward,room,bed_number,bed_type,status,patient_id,observed_at,metadata)
SELECT f.organization_id,f.id,'Medical','Test Ward','TB-'||lpad(g::text,2,'0'),'standard',CASE WHEN g<=4 THEN 'occupied' ELSE 'available' END,CASE WHEN g=1 THEN (SELECT id FROM patients WHERE patient_number='TEST-005') WHEN g=2 THEN (SELECT id FROM patients WHERE patient_number='TEST-009') WHEN g=3 THEN (SELECT id FROM patients WHERE patient_number='TEST-014') WHEN g=4 THEN (SELECT id FROM patients WHERE patient_number='TEST-030') ELSE NULL END,now(),jsonb_build_object('source','synthetic-test-data')
FROM facilities f CROSS JOIN generate_series(1,12) g WHERE f.name='Main Facility' AND NOT EXISTS (SELECT 1 FROM facility_beds b WHERE b.facility_id=f.id AND b.bed_number='TB-'||lpad(g::text,2,'0'));

INSERT INTO facility_operational_incidents(organization_id,facility_id,incident_type,severity,status,title,description,started_at,impact)
SELECT f.organization_id,f.id,'service-pressure','moderate','open','Synthetic test queue pressure','Test dataset includes several urgent and waiting patients for dashboard validation.',now()-interval '3 hours',jsonb_build_object('source','synthetic-test-data')
FROM facilities f WHERE f.name='Main Facility' AND NOT EXISTS (SELECT 1 FROM facility_operational_incidents i WHERE i.facility_id=f.id AND i.title='Synthetic test queue pressure');

INSERT INTO queues(organization_id,facility_id,code,name) SELECT o.id,f.id,'TEST-QUEUE','Test patient care queue' FROM organizations o JOIN facilities f ON f.organization_id=o.id WHERE o.name='ClinAI Demo Organization' AND f.name='Main Facility' AND NOT EXISTS (SELECT 1 FROM queues q WHERE q.organization_id=o.id AND q.code='TEST-QUEUE');

INSERT INTO queue_entries(queue_id,patient_id,priority,status,joined_at) SELECT q.id,p.id,CASE WHEN p.patient_number IN ('TEST-005','TEST-009','TEST-011','TEST-030') THEN 'urgent' ELSE 'normal' END,CASE WHEN p.patient_number IN ('TEST-005','TEST-011') THEN 'emergency' ELSE 'waiting-doctor' END,now()-interval '35 minutes' FROM queues q CROSS JOIN patients p WHERE q.code='TEST-QUEUE' AND p.is_test_data AND p.patient_number IN ('TEST-001','TEST-002','TEST-004','TEST-005','TEST-009','TEST-011','TEST-014','TEST-021','TEST-024','TEST-030') AND NOT EXISTS (SELECT 1 FROM queue_entries qe WHERE qe.queue_id=q.id AND qe.patient_id=p.id);

INSERT INTO invoices(organization_id,patient_id,status,currency,total,created_at) SELECT p.organization_id,p.id,CASE WHEN p.patient_number IN ('TEST-002','TEST-004','TEST-014','TEST-030') THEN 'open' ELSE 'paid' END,'UGX',v.amount,now()-interval '3 days' FROM patients p JOIN (VALUES
('TEST-001',45000),
('TEST-002',180000),
('TEST-003',95000),
('TEST-004',240000),
('TEST-005',320000),
('TEST-006',210000),
('TEST-007',160000),
('TEST-008',125000),
('TEST-009',280000),
('TEST-010',70000),
('TEST-014',360000),
('TEST-016',1200000),
('TEST-017',280000),
('TEST-018',650000),
('TEST-019',90000),
('TEST-021',85000),
('TEST-024',140000),
('TEST-025',110000),
('TEST-029',200000),
('TEST-030',450000)) v(patient_number,amount) ON v.patient_number=p.patient_number WHERE p.is_test_data AND NOT EXISTS (SELECT 1 FROM invoices i WHERE i.patient_id=p.id);

INSERT INTO payments(invoice_id,method,provider_reference,amount,status,paid_at) SELECT i.id,'mobile-money','TEST-PAY-'||p.patient_number,i.total,'completed',now()-interval '2 days' FROM invoices i JOIN patients p ON p.id=i.patient_id WHERE p.is_test_data AND i.status='paid' AND NOT EXISTS (SELECT 1 FROM payments py WHERE py.invoice_id=i.id);

INSERT INTO medication_reconciliation(organization_id,patient_id,status,medicines,discrepancies,resolved_count) SELECT p.organization_id,p.id,'in-review','[]',jsonb_build_array(jsonb_build_object('type','missing-history','detail','Medication list needs confirmation')),0 FROM patients p WHERE p.is_test_data AND p.patient_number IN ('TEST-004','TEST-019','TEST-030') AND NOT EXISTS (SELECT 1 FROM medication_reconciliation mr WHERE mr.patient_id=p.id);

INSERT INTO clinical_workflow_events(organization_id,patient_id,event_type,from_state,to_state,payload) SELECT p.organization_id,p.id,v.event_type,v.from_state,v.to_state,jsonb_build_object('source','synthetic-test-data','seedKey',v.seed) FROM patients p JOIN (VALUES
('TEST-001','registration','new','registered','evt-001'),('TEST-001','triage','registered','triaged','evt-002'),('TEST-001','diagnosis','triaged','diagnosed','evt-003'),('TEST-005','emergency','arrived','admitted','evt-005'),('TEST-016','surgery','planned','completed','evt-016'),('TEST-029','referral','created','pending','evt-029'),('TEST-030','chronic-review','active','attention','evt-030')) v(patient_number,event_type,from_state,to_state,seed) ON v.patient_number=p.patient_number WHERE p.is_test_data AND NOT EXISTS (SELECT 1 FROM clinical_workflow_events e WHERE e.patient_id=p.id AND e.payload->>'seedKey'=v.seed);

INSERT INTO module_records(organization_id,module,status,payload) SELECT p.organization_id,'care-gaps','open',jsonb_build_object('seedKey','gap-'||p.patient_number,'patientId',p.id,'title',v.title,'severity',v.severity,'sourceModule',v.source) FROM patients p JOIN (VALUES
('TEST-002','Overdue diabetes follow-up','high','chronic-care'),('TEST-004','Medication reconciliation discrepancy','high','medication-reconciliation'),('TEST-006','TB result follow-up pending','high','laboratory'),('TEST-009','High risk pregnancy review','urgent','maternity'),('TEST-014','Renal function requires review','high','laboratory'),('TEST-019','Polypharmacy reconciliation gap','high','medication-reconciliation'),('TEST-025','Delayed laboratory review','high','laboratory'),('TEST-029','Referral follow-up pending','high','referrals'),('TEST-030','Multimorbidity review needed','urgent','chronic-care')) v(patient_number,title,severity,source) ON v.patient_number=p.patient_number WHERE p.is_test_data AND NOT EXISTS (SELECT 1 FROM module_records mr WHERE mr.module='care-gaps' AND mr.payload->>'seedKey'='gap-'||p.patient_number);

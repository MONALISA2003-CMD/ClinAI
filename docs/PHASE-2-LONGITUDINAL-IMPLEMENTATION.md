# ClinAI Phase 2 Longitudinal Test Patients

Phase 2 establishes 30 synthetic patients as connected longitudinal test journeys.

## Safety

The Phase 2 completion seed is additive and idempotent. It contains no DROP, TRUNCATE, DELETE, or patient UPDATE operations.

## Patient journeys

TEST-001 through TEST-030 are preserved as the named synthetic scenarios defined by the platform plan, including malaria, diabetes, hypertension, pneumonia, pregnancy/ANC, pediatric illness, trauma, surgery, postoperative infection, TB investigation, HIV follow-up, CKD, asthma, heart failure, malnutrition, UTI, sickle cell/anemia, diarrhoeal illness, polypharmacy, medication reconciliation, abnormal laboratory follow-up, missed follow-up, referral, emergency, chronic follow-up, maternal/newborn, immunization/child health, remote monitoring, telemedicine, and multimorbidity.

## Connected baseline

Each test patient has a real patient ID and organization/facility relationship. The production Neon verification for the 30 patients currently shows:

- 30 patients
- 30 encounters
- 30 appointments
- 30 diagnoses
- 90 observations
- 30 clinical notes
- 30 care plans
- 20 invoices
- 15 care tasks
- 6 referrals
- 12 medication orders
- 13 laboratory results
- 12 chronic care records
- 4 maternity records
- 4 pediatric assessments
- 3 surgery cases
- 3 medication reconciliation records
- 10 queue entries
- 4 occupied test beds

Additional procedures and explicit patient-linked module journey markers were added by the Phase 2 completion seed.

## Patient 360 principle

The records are linked by the actual patient UUID. Patient 360 and contract-driven module reads should retrieve the same underlying records rather than fabricated frontend metrics.

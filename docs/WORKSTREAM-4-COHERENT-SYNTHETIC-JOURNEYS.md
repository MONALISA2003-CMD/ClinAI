# ClinAI Workstream 4: 30 Coherent Synthetic Patient Journeys

Workstream 4 converts the existing TEST patient population into coherent longitudinal scenarios without replacing the authoritative clinical, operational, finance, insurance, inventory, procurement or public-health tables.

## Scope

Exactly 30 synthetic journeys are anchored to TEST-001 through TEST-030. The journey layer is additive and uses the existing patient UUIDs. No real patient or real PHI is introduced.

The architecture is:

`authoritative domain record → journey milestone → transactional outbox history → clinical workflow projection → care graph → continuity signal`

## Reusable journey architecture

The implementation adds:

- `synthetic_journeys`: one longitudinal scenario per TEST patient.
- `synthetic_journey_step_catalog`: reusable event and authority vocabulary.
- `synthetic_journey_templates`: reusable ordered step compositions.
- `synthetic_journey_steps`: patient-specific milestone instances with authoritative IDs and provenance.
- `clinai_workstream4_journey_coverage`: operational verification view.

There are **12 reusable templates**, **31 catalog step definitions**, and **354 instantiated journey steps**.

Every instantiated step is linked to an authoritative record. Where the previous dataset did not contain the required consequence, Workstream 4 creates a minimal synthetic operational record first, then links the journey step to it.

## Scenario families

| Patient | Journey | Status | Template | Steps |
|---|---|---|---|---:|
| TEST-001 | Acute malaria with anaemia | completed | outpatient | 13 |
| TEST-002 | Diabetes continuity and missed follow-up | needs-follow-up | chronic | 11 |
| TEST-003 | Hypertension control review | active | chronic | 11 |
| TEST-004 | Medication reconciliation safety review | needs-follow-up | medication | 11 |
| TEST-005 | Emergency pneumonia with hypoxia | active | emergency | 12 |
| TEST-006 | Suspected TB diagnostic referral | referred | referral | 12 |
| TEST-007 | HIV care continuity | needs-follow-up | chronic | 11 |
| TEST-008 | Antenatal care with maternal anaemia | active | maternity | 12 |
| TEST-009 | High-risk pregnancy escalation | referred | maternity | 12 |
| TEST-010 | Paediatric fever and nutrition review | completed | pediatric | 12 |
| TEST-011 | Paediatric pneumonia with hypoxia | active | pediatric | 12 |
| TEST-012 | Sickle cell pain episode | active | chronic | 11 |
| TEST-013 | Heart failure monitoring | active | chronic | 11 |
| TEST-014 | Chronic kidney disease monitoring | needs-follow-up | chronic | 11 |
| TEST-015 | Recurrent urinary symptoms workup | completed | outpatient | 13 |
| TEST-016 | Road trauma fracture through surgery | completed | surgery | 12 |
| TEST-017 | Postoperative wound infection review | needs-follow-up | surgery_followup | 10 |
| TEST-018 | Acute appendicitis through surgery | completed | surgery | 12 |
| TEST-019 | Polypharmacy medication safety | needs-follow-up | medication | 11 |
| TEST-020 | Recurrent asthma emergency review | active | emergency | 12 |
| TEST-021 | Dehydration risk management | completed | outpatient | 13 |
| TEST-022 | Child nutrition and immunization review | needs-follow-up | pediatric | 12 |
| TEST-023 | Postnatal maternal anaemia follow-up | active | postnatal | 12 |
| TEST-024 | Diabetes remote monitoring | active | chronic | 11 |
| TEST-025 | UTI with delayed laboratory review | needs-follow-up | outpatient | 13 |
| TEST-026 | Hypertensive heart disease review | needs-follow-up | chronic | 11 |
| TEST-027 | Febrile illness with immunization review | active | pediatric | 12 |
| TEST-028 | Gastrointestinal symptoms and anaemia workup | active | outpatient | 13 |
| TEST-029 | Pregnancy follow-up with pending referral | referred | maternity_referral | 13 |
| TEST-030 | Diabetes, hypertension and CKD multimorbidity | needs-follow-up | multimorbidity | 12 |

## Connected consequences

The journeys intentionally cross domain boundaries instead of producing isolated screen data.

Emergency journeys use:

`arrival → triage → assessment → diagnosis → order → result → treatment → disposition → billing → insurance → reconciliation → follow-up`

Surgical journeys use:

`indication → diagnosis → referral → procedure → admission → treatment → discharge → recovery assessment → billing → insurance → reconciliation → follow-up`

Maternity journeys use:

`ANC → risk → diagnosis → order → continuity task/referral → billing → insurance → reconciliation → follow-up`

The postnatal journey additionally links an actual synthetic `birth_event`, `newborn_record`, and `postnatal_contact` for TEST-023.

Finance-linked journeys preserve:

`clinical episode → invoice → claim → reconciliation`

Supply-linked journeys preserve:

`clinical treatment → stock consequence`

## Event provenance

Each journey step receives a stable event ID and an idempotency key:

`ws4:<patientNumber>:<journeyKey>:<sequence>`

The seeded history is inserted as already processed so the live worker does not replay a historical scenario as if it were a new patient event.

Every later step carries the previous step as its causation relationship and the journey ID as its correlation ID.

## Continuity signals

Each journey has one `synthetic-journey` signal tied to its final follow-up milestone. Twenty-four journeys remain open and six completed journeys retain resolved traceability signals.

These signals are orchestration metadata for the synthetic dataset. They do not prescribe clinical treatment.

## API surfaces

Private organization-scoped routes:

- `GET /api/journeys/synthetic`
- `GET /api/journeys/synthetic/:patientId`
- `GET /api/journeys/synthetic/by-number/:patientNumber`

Public synthetic route:

- `GET /api/public/test-patients/:patientNumber/journeys`

The public endpoint only accepts TEST patient numbers and returns the synthetic journey projection without exposing internal patient UUIDs or internal event IDs.

## Live verification snapshot

The live Neon branch verifies:

- 30 journeys
- 30 distinct TEST patients
- 354 journey steps
- 354 processed Workstream 4 outbox events
- 354 clinical workflow projections
- 354 care graph edges
- 30 synthetic journey signals
- 324 causal outbox links
- 14 patient-journey inventory issue movements linked to treatment/inventory milestones.
- the seeded paracetamol batch reflects the synthetic issue consequence at quantity 706.
- 0 journey steps without an authoritative ID
- 30 journey coverage rows with step count equal to workflow event count

No destructive database operation is used by Workstream 4.

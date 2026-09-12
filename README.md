# ClinAI

ClinAI is a connected healthcare operating platform baseline built around PostgreSQL clinical source-of-truth data, modular workflows, FHIR-oriented interoperability, governed AI boundaries, and a responsive web workspace.

## Current release

The current implementation extends the PostgreSQL core into a connected patient journey:

**Patient → Appointment → Check in → Queue → Triage → Encounter → Note → Diagnosis/Orders → Laboratory/Imaging → Results → Prescription → Pharmacy → Billing → Discharge → Follow up**

### Included

- Next.js web workspace
- Fastify TypeScript API
- PostgreSQL persistence
- Patient 360
- Search
- Clinical encounter workspace
- Contextual workflow actions
- Triage observations
- Laboratory samples and results
- Pharmacy dispensing
- Billing and payments
- Referrals and follow up
- Audit and outbox events
- FHIR-oriented Patient, Encounter, Observation, ServiceRequest, MedicationRequest and DiagnosticReport endpoints
- Python AI service boundary
- Docker and Vercel/Render deployment configuration

## Deployment

Frontend: Vercel from the repository root, using `vercel.json` and `apps/web/.next` as the output directory.

API: Render with root directory `services/api`, build command `npm install && npm run build`, start command `npm start`, and `DATABASE_URL` plus `JWT_SECRET` environment variables.

## Database

For a fresh database, run `database/schema.sql`.
For an existing deployment, run `database/migrations/002_connected_workflows.sql`; the API also performs safe runtime creation of its `module_records` table and the notifications `created_at` column.

## Verification

Run the API contract smoke test with the API running:

```bash
API_URL=https://your-api.example.com node tests/api-contract.mjs
```

The smoke test exercises patient registration, appointment check-in, queue transition, encounter/note/sign, triage observations, laboratory order/sample/result/verify/release, pharmacy dispensing, billing/payment, referral/send, discharge/follow-up, FHIR Patient and Patient 360, and audit access.

## Safety boundary

This repository is a software development baseline. It does not claim clinical safety, regulatory certification, privacy compliance, medical-device validation, interoperability certification, or readiness for real patient data. Those require institution-specific clinical validation, security and privacy review, legal/regulatory review, real provider/device integrations, operational policies, backup/disaster-recovery testing, and AI governance.

## Next V3: Intelligence, Governance and Care Coordination

The platform now includes governance resources, deterministic clinical decision support, care-gap management, consent-aware communication queuing, clinical alerts, and PostgreSQL-backed operational analytics. See `docs/IMPLEMENTATION-NEXT-V3.md`.

## Advanced Clinical Layer V4

This build adds dedicated PostgreSQL-backed workflows for emergency care, inpatient admissions/discharge, nursing assessments, surgery safety workflow, maternity, pediatrics/IMCI-oriented assessment, immunization, chronic care, telemedicine and remote monitoring.

Research basis is documented in `docs/ADVANCED-CLINICAL-RESEARCH.md`. Clinical content is intentionally configurable and must be localized and clinically governed before production use.

New migration: `database/migrations/004-advanced-clinical-services.sql`.

Important: these workflows are software infrastructure, not medical advice or a substitute for facility protocols, national guidelines, clinician judgment, credentialing, privacy/security review or regulatory approval.

## V5: Uganda-aware Patient 360 + FHIR

V5 deepens the longitudinal clinical record and makes Uganda a first-class localization context. It adds PostgreSQL-backed Patient 360 aggregation, extensible patient identifiers, FHIR R4 resources for Immunization, CarePlan, Procedure, MedicationAdministration and Appointment, ServiceRequest search, and an explicit Uganda configuration boundary.

Research and implementation rationale: `docs/V5-UGANDA-PATIENT360-FHIR-RESEARCH.md`. The implementation follows the direction of Uganda MoH DH-ASK and Health Information Exchange/Interoperability guidance while retaining international FHIR/WHO SMART interoperability.

The `/api/uganda/profile` endpoint intentionally reports national integrations as not connected until approved interfaces and credentials are configured.

## V6: Uganda Clinical Interoperability + Governance Layer

V6 deepens the Uganda-first architecture using current Uganda Ministry of Health material and current WHO SMART/FHIR material.

### Added persistence
- facility_identifiers
- health_worker_profiles
- terminology_concepts
- clinical_guidelines
- clinical_guideline_rules
- care_pathways
- care_pathway_steps
- immunization_schedule_rules
- hie_connections
- hie_messages
- reporting_mappings
- offline_sync_queue

### Added API
- `/api/uganda/architecture`
- `/api/facilities/:facilityId/identifiers`
- `/api/health-workers`
- `/api/terminology`
- `/api/guidelines`
- `/api/guidelines/:id/rules`
- `/api/care-pathways`
- `/api/care-pathways/:id/steps`
- `/api/immunization/schedule`
- `/api/hie/connections`
- `/api/hie/messages`
- `/api/reporting/mappings`
- `/api/offline/sync`

### V6 research boundary
ClinAI does not claim live connection to Uganda national HIE, facility registry, health-worker registry, terminology registry or external reporting services. The architecture is adapter-ready and requires approved interfaces, credentials, data-sharing agreements, conformance testing and governance before activation.

Clinical content is configuration-driven. Uganda-approved protocols and WHO SMART content should be loaded, versioned, reviewed and tested through the governance layer rather than hard-coded into application logic.

See `docs/V6-UGANDA-CLINICAL-INTEROPERABILITY-RESEARCH.md`.

## V8 — Uganda maternal, newborn and postnatal layer
V8 adds source-linked maternal care, ANC contacts, birth events, newborn records and postnatal contacts. It is based on current Uganda MoH maternal-health publications and the latest WHO SMART/DAK material reviewed on 2026-09-12. National guidance remains authoritative for Uganda-specific content; WHO SMART provides the computable structure. See `docs/V8-UGANDA-MATERNAL-NEWBORN-RESEARCH.md`.


## V9
Uganda child health, growth, IMCI and immunization continuity. See `docs/V9-UGANDA-CHILD-HEALTH-IMMUNIZATION-RESEARCH.md` and `database/migrations-009-uganda-child-health-immunization.sql`.

## V11
Population health and surveillance intelligence adds surveillance events/cases, population cohorts and members, population indicators, surveillance summary, cohort management and dashboard APIs. It is designed for Uganda-first interoperability while remaining country-adaptable. National surveillance endpoints are not claimed as connected.

## V16 ClinAI Intelligence Engine

The V16 build adds a server-side Gemini Interactions API v1 gateway, patient and organization context assembly, Ask ClinAI, patient intelligence, attention analysis, documentation drafts, role briefings, translation, AI usage/audit tracking, knowledge-source registry, evaluation workflow, responsive AI UI and a controlled human-review boundary. Configure `GEMINI_AUTHORIZATION_KEY` on the API service. `GEMINI_API_KEY` remains a compatibility fallback. Do not expose either key to the browser.

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

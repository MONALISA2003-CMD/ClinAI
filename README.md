# ClinAI Full 22-Module Implementation

ClinAI is an AI-native healthcare operating platform organized around one connected care journey:

Patient → Registration → Appointment → Check-in → Queue → Triage → Encounter → Orders → Laboratory/Imaging/Pharmacy → Treatment → Billing/Insurance → Discharge → Follow-up → Population Health.

## Run locally

1. Copy `.env.example` to `.env`.
2. Install dependencies with `npm install`.
3. Run `npm run dev`.
4. API defaults to `http://localhost:4000`.
5. Web defaults to the Next.js development port.

The development API uses a persistent JSON store when `DATABASE_URL` is not configured. PostgreSQL schema is provided in `database/schema.sql` for production persistence work.

## Important

This is a software implementation baseline, not a clinical certification. Do not connect real patient data until identity, access control, encryption, audit, backup, disaster recovery, interoperability, AI governance and local/institutional regulatory requirements have been independently validated.

## Latest implementation pass
The API now includes tenant-aware authorization boundaries, FHIR Patient endpoints, appointment check-in, note signing, lab release, task completion, PostgreSQL health detection, and reliability/governance database primitives (idempotency, outbox, consent versions). Demo JSON persistence remains available for local development while PostgreSQL is the production target.

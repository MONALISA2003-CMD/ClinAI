# ClinAI V24 Stability and Schema Contract Audit

Date: 2026-09-14

## Purpose

Pause feature expansion and correct confirmed API/database contract drift before continuing the clinical roadmap.

## Confirmed issues fixed

### 1. Render TypeScript build failure

Fastify 5 uses `reply.redirect(url, code)`. The FHIR canonical routes had been using the older argument order. All affected redirects now use the Fastify 5 signature.

### 2. Appointment check-in failure

The `queues` table does not contain `created_at`. Appointment check-in and related queue selection paths previously ordered by `queues.created_at`.

Queue selection now uses the existing stable queue code and facility relationship instead of inventing a timestamp dependency.

### 3. Additional schema drift found during audit

The audit also found production tables that intentionally do not contain `organization_id` or `created_at`, while some newer queries incorrectly assumed those columns existed.

Corrected paths include:

- dashboard referral counts
- dashboard laboratory counts
- patient timeline observations
- patient timeline diagnoses
- patient timeline medication orders
- patient timeline referrals
- patient flow clinical orders
- patient flow referrals
- laboratory workflow queries
- CDSS observation evaluation
- CDSS medication/allergy evaluation
- CDSS unresolved order evaluation

Where a table lacks `organization_id`, tenant scoping now comes through the patient relationship rather than adding an unnecessary schema column.

Where a clinical table lacks `created_at`, the query now uses the table's actual domain timestamp or the related encounter timestamp. No synthetic timestamps are introduced merely to make a query work.

## Database safety

No migration was required for V24.

No DROP, TRUNCATE, DELETE, reset, or production data rewrite was performed.

## Verification performed

- Live Neon schema inspected.
- Exact failing queue query reproduced before correction.
- Appointment schema verified.
- Corrected dashboard queries executed successfully against Neon.
- Corrected patient timeline query executed successfully against Neon.
- Corrected CDSS observation/allergy/medication/order queries executed successfully against Neon.
- All ClinAI TypeScript source files passed TypeScript transpilation syntax checks.
- Static schema contract regression test added.

## Build limitation

A complete `tsc` production build could not be executed in the local container because the dependency installation timed out and `node_modules` were unavailable. Therefore this phase is not labelled as a production build pass.

Render remains the authoritative production build check after the corrected source is deployed.

## Next gate

Do not add another major clinical feature until:

1. Render API build passes.
2. API contract smoke test passes.
3. Appointment check-in passes.
4. Queue transitions pass.
5. Triage passes.
6. Encounter and order workflows pass.
7. Laboratory verification passes.
8. Pharmacy dispense passes.
9. Billing/payment passes.
10. Referral and discharge workflows pass.
11. Patient 360/timeline passes.
12. CDSS event processing is observed without runtime SQL errors.

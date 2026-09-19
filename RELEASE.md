# ClinAI Phase 1 Release

## Scope
Security, access boundary and AI scope hardening only.

## Implemented
- Production demo authentication is disabled regardless of the demo-auth flag.
- Sandbox demo authentication, when explicitly enabled outside production, issues a read-only `viewer` JWT rather than an admin JWT.
- Production startup no longer creates/uses the demo tenant unless demo auth is explicitly enabled outside production.
- Anonymous API access is restricted to health/build/public preview/public feedback/public assistant compatibility routes.
- Public preview endpoint is explicitly synthetic and read-only.
- Generic module POST/PATCH/DELETE routes require authorized write permission.
- Clinical/operational mutations require an authorized write role and are denied in public preview.
- Public health assistant endpoint is retired with HTTP 410 rather than exposing general health-chat behavior.
- AI clinical assistance requires an authenticated workspace.
- AI role context is derived from the authenticated JWT; client-supplied `role` is ignored for AI execution.
- AI scope now fails closed when a request has no ClinAI-related topic signal, while retaining explicit security/off-topic blocking.
- Frontend no longer auto-mints demo tokens or sends a client-selected AI role.
- Frontend Command Center no longer exposes a role-switching control.

## Database
No migration was added and no reset, truncate, destructive delete, or destructive rewrite was performed.

## Verification
- `node tests/phase1-security-boundary-audit.mjs` passed.
- TypeScript parsing/checking was attempted with the globally available TypeScript compiler. Full dependency-backed compilation could not run because `npm install` timed out and `node_modules` is absent. Existing source-level TypeScript errors remain unverified until dependencies are installed.


## Phase 1 platform restoration pass

This pass restores the public read-only navigation and patient inspection path without weakening the production write boundary.

- Public preview can open the full module navigation using `/api/public/test-modules/:module`.
- Public module reads are limited to synthetic patient-linked records and never create, update, or delete data.
- A dedicated `/api/public/test-patients/:patientNumber/360` endpoint exposes a read-only synthetic Patient 360 record.
- Public Patient 360 includes identity-safe demographics, appointments, encounters, diagnoses, observations, notes, orders, medicines, allergies, admissions, immunization, chronic care, referrals, follow-up, tasks, monitoring, telemedicine, contacts, alerts, and a longitudinal timeline.
- Public patient cards and the Patients workspace can open Patient 360 directly.
- The existing authenticated Patient 360 endpoint remains organization-scoped and unchanged.
- Neon PostgreSQL remains the source of truth; no reset, truncate, destructive delete, or schema rewrite was performed by this pass.

### Verification limitation
The source tree in this environment does not contain installed npm dependencies, so a full dependency-backed Next.js/TypeScript production build could not be executed here. The existing source-level checks therefore remain the authoritative local validation available in this workspace until dependencies are installed and the deployment pipeline runs.

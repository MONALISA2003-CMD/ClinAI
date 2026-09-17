# ClinAI Phase 3 — Global Validation & Data Integrity

Implemented from the Production Integrity specification.

## Contract layer

- Added `packages/domain/validation/index.ts` as the shared validation framework.
- 62 create-capable module contracts now govern 297 user-entered fields.
- Every create-capable contract has required fields, types, ID/date rules, allowed values where defined, organization scoping, relationship metadata, permission awareness and independent backend validation markers.
- Workflow mutations (`checkin`, `triage`, `lab_result`, `dispense`, `discharge`, `payment`, `referral`) also use the same validation framework.

## Frontend

- Required fields are marked.
- Field-level validation errors are shown inline.
- Whitespace-only values are rejected.
- Invalid dates, identifiers, email addresses, numbers, booleans and allowed-value selections are rejected.
- Create is disabled until the current form validates.
- Validation is driven from the module contract rather than ad-hoc field lists.

## Backend

- Contract-aware validation runs before create/update handlers.
- Validation is independent of frontend validation.
- Role permission is checked against the module contract.
- Organization identifiers cannot be supplied by the client.
- Relationship IDs are validated against the authorized organization.
- Patient/encounter relationships are cross-checked.
- Partial PATCH requests validate supplied fields without requiring unrelated fields again.

## Database

- No reset, truncate, delete, or destructive migration was performed.
- A safe `NOT VALID` check constraint was added to `module_records` to prevent future empty `{}` payloads:
  `module_records_nonempty_payload`.
- Existing legacy empty payloads were intentionally preserved because inventing data or deleting records would violate production-integrity requirements.

## Live Neon verification

Project: `clinai-production`
Branch: `production`
Database: `neondb`

Observed before/after implementation:

- 22 `module_records`
- 13 existing legacy `{}` payloads
- 0 NULL payloads
- 0 patients missing organization
- 0 appointments missing organization
- 0 encounters missing organization

The 13 empty records predate the constraint and remain because the constraint is `NOT VALID`. PostgreSQL will enforce it for new inserts/updates while leaving historical rows untouched.

Constraint verified live:

`module_records_nonempty_payload`

`CHECK ((jsonb_typeof(payload) = 'object') AND (payload <> '{}'::jsonb)) NOT VALID`

## Automated verification

Passed:

- Phase 1 security boundary audit
- Phase 2 module contract audit
- Phase 3 global validation audit
- TypeScript compilation of the shared validation package

The complete API/web production build remains environment-limited because repository dependencies are not installed in the supplied archive.

# ClinAI Phase 2 — One Real Module Contract System

## Implemented

Phase 2 replaces the shallow module fallback architecture with a central contract catalog at `packages/module-contracts/contracts.json`.

Every advertised frontend module is represented by a contract containing:

- identity and category
- frontend route
- backend endpoint and create endpoint where applicable
- PostgreSQL source
- field definitions and required fields
- relationships
- read/write permissions
- supported actions
- validation policy
- production empty state
- workflow event connection
- intelligence connections

The catalog contains 80 contracts, including the 79 modules advertised by the frontend and the Command Center contract.

## Routing

- Domain-specific modules continue to use their existing dedicated endpoints.
- Modules without a domain-specific endpoint use `/api/contracts/modules/:module`, which is contract-driven and organization-scoped.
- The old `/api/:module` GET/POST/PATCH/DELETE fallback routes were removed.
- The frontend no longer falls back to `/api/:module` and no longer falls back to `Name / Description / Status` forms.

## Care Gaps

Care Gaps now has an explicit contract with:

`patientId`, `type`, `priority`, `dueAt`, `description`, `status`

and connects to Patient 360, Value Based Care, and AI intelligence.

## Automated release gate

`tests/phase2-module-contract-audit.mjs` verifies:

- all advertised modules have contracts
- required contract sections exist
- every module has a backend endpoint
- every module has a PostgreSQL source
- every module has required workflow event and intelligence connections
- the frontend consumes the central registry
- generic field fallback is absent
- generic `/api/:module` routes are absent
- the contract read/create routes exist

When `CLINAI_BASE_URL` and `CLINAI_MODULE_TOKEN` are supplied, the same test performs runtime HTTP checks and fails deployment if an advertised module endpoint returns HTTP 404.

## Database safety

No Phase 2 database migration was required. No table was dropped, reset, truncated, or rewritten.

Live Neon verification confirmed all 100 PostgreSQL tables referenced by the contract catalog exist.

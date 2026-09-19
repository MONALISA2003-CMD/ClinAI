# ClinAI Phase 1 Backend Correctness Build

Date: 2026-09-18

## Implemented

### Clinical workflow event projection

Updated `services/api/src/events/clinicalJourneyEngine.ts` so workflow projection uses the existing partial unique index correctly:

`ON CONFLICT (source_event_id) WHERE source_event_id IS NOT NULL DO NOTHING`

This preserves idempotent projection without requiring a destructive index replacement.

### Outbox retry and dead-letter behavior

Updated `services/api/src/events/clinicalEventWorker.ts` so an event is returned to `pending` only while `attempts < max_attempts`. Once the maximum is reached it is moved to `dead_lettered`, with `dead_lettered_at` recorded and the latest failure retained in `last_error`.

This prevents the previously observed infinite retry condition.

### Laboratory contract repair

Updated the laboratory list query in `services/api/src/main.ts` to read the order code from the authoritative live representation:

`clinical_orders.details->>'code'`

instead of the nonexistent `clinical_orders.code` column.

### AI provider telemetry compatibility

Restored the provider registry and provider usage tables expected by the current AI orchestration source:

- `ai_providers`
- `ai_models`
- `ai_provider_usage`

The runtime schema bootstrap now creates these tables/indexes when missing.

### AI intelligence coverage reconciliation

Updated `clinai_workstream5_intelligence_coverage` so current AI work runs are represented by `ai_work_runs`, while preserving the existing view contract.

### Outbox observability

Added an additive index on `outbox_events(dead_lettered_at)` for tenant-scoped dead-letter inspection.

## Production database action

Applied the Phase 1 additive schema migration to the live Neon production branch.

No `DROP`, `TRUNCATE`, destructive `DELETE`, data reset, or table replacement was performed.

## Verification

Focused Phase 1 structural audit: PASS.

Existing regression audits passed:

- domain restoration
- full module domain coverage
- module contracts
- frontend/backend routes
- public writable boundary
- schema contract
- responsive UI structure
- multi-model AI
- free-only runtime
- AI intelligence core

Live Neon verification after migration:

- AI provider tables present
- dead-letter index present
- Workstream 5 view now reports 113 current AI work runs, all completed
- 5 historical outbox events remain pending with recorded errors; they are intentionally not deleted or reset and will be reprocessed by the corrected worker after the API build is deployed

## Remaining deployment step

The source build must be deployed so the corrected worker and laboratory query are active in the hosted API. The database schema is already aligned for that release.

ClinAI Workstream 4 implementation manifest

This archive contains the source snapshot after Workstream 4 Coherent Synthetic Patient Journeys implementation, including the preserved Workstream 2 and Workstream 3 foundations.

Workstream 4 additions:
- services/api/src/routes/workstream4Journeys.ts
- database/migrations/029-workstream-4-coherent-synthetic-journeys.sql
- docs/WORKSTREAM-4-COHERENT-SYNTHETIC-JOURNEYS.md
- tests/workstream4-coherent-journeys.mjs
- 30 TEST patient journey profiles
- 12 reusable journey templates
- 31 reusable journey step definitions
- 354 authoritative journey milestones
- 354 processed Workstream 4 outbox events with correlation and causation chains
- 354 clinical workflow projections
- 354 care graph edges
- 30 synthetic continuity signals
- private organization-scoped journey API surfaces
- public synthetic journey projection API surface

Workstream 4 live verification:
- 30 journeys and 30 distinct TEST patients verified on Neon.
- 354 journey steps verified with 0 missing authoritative IDs.
- 354 Workstream 4 outbox events verified as processed.
- 354 clinical workflow projections verified.
- 354 care graph edges verified.
- 324 causal outbox links verified.
- 30 synthetic journey signals verified: 24 open, 6 resolved.
- 30 coverage rows verified with journey step count equal to workflow projection count.
- TEST-023 includes a synthetic birth event, newborn record and postnatal contact.
- Signal authoritative IDs and workflow payload authoritative IDs verified for all signal steps.
- No destructive database operation is used by Workstream 4.

Workstream 3 preserved:
- services/api/src/events/connectedDataMap.ts
- services/api/src/events/clinicalEventWorker.ts
- database/migrations/028-workstream-3-event-platform-completion.sql
- docs/CLINAI-CONNECTED-EVENT-DATA-MAP.md
- docs/WORKSTREAM-3-CONNECTED-DATA-EVENT-ARCHITECTURE.md
- tests/workstream3-connected-event-map.mjs

Workstream 2 preserved:
- services/api/src/routes/workstream2Domains.ts
- database/migrations/026-workstream-2-domain-depth.sql
- database/migrations/027-workstream-2-integrity-hardening.sql
- tests/workstream2-domain-integrity.mjs

Verification notes:
- Workstream 4 static integrity audit passes.
- Live Neon verification passes for the metrics listed above.
- Full local TypeScript production build is not claimed in this snapshot because the source workspace does not contain a complete installable dependency tree.
- Existing deployment and stability artifacts from prior workstreams are preserved in the archive.

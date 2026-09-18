# ClinAI Workstream 3 Completion

## Connected Data + Event Architecture

Workstream 3 establishes the canonical connectivity contract for ClinAI without creating a new synthetic population and without replacing authoritative domain tables.

### Implemented

- Added `services/api/src/events/connectedDataMap.ts` as the canonical connected workflow registry.
- Added 19 workflow definitions covering patient lifecycle, core clinical care, emergency, inpatient, surgery, maternity, pharmacy, laboratory, imaging, referrals, billing, insurance, finance, inventory, procurement, suppliers, facilities, public health and intelligence.
- Each workflow maps source events to authoritative tables, downstream tables, operational consequence, optional signals and the next workflow step.
- Added organization-scoped read APIs for the connected data map, individual workflow contracts and the event catalog.
- Added an organization-scoped projected workflow event stream with patient and event-type filtering.
- Added an event health surface covering map validation, pending work, active processing and dead-lettered events.
- Completed the transactional outbox contract with idempotency, correlation, causation, schema versioning, stale-claim recovery and bounded retries.
- Completed workflow projection metadata so mapped events carry normalized from/to workflow states and correlation/causation metadata.
- Preserved the existing transactional outbox, workflow projection, care graph and deterministic signal architecture.
- Added a Workstream 3 architecture document describing the source-of-truth and downstream-consequence rules.
- Added a Workstream 3 integrity audit.
- Corrected an existing Workstream 2 claim-response parameter binding defect discovered during this pass.

### New API surfaces

- `GET /api/events/connected-data-map`
- `GET /api/events/connected-data-map/:workflow`
- `GET /api/events/catalog`
- `GET /api/events/health`
- `GET /api/events/stream`

### Database boundary

Added `database/migrations/028-workstream-3-event-platform-completion.sql` with additive outbox and workflow-event hardening. The same additive columns/indexes were applied to the live Neon branch. The implementation uses the existing `outbox_events`, `clinical_workflow_events`, `care_graph_edges`, `clinical_signals` and authoritative domain tables.

The live Neon branch currently contains the existing event infrastructure and projected workflow data. No reset, truncate, destructive cleanup or synthetic journey generation was performed as part of Workstream 3.

### Verification

Passed:

- Workstream 3 connected event/data map audit: 19 workflows, 4 API surfaces.
- Workstream 2 domain integrity audit.
- Frontend/backend route audit: no missing frontend/backend route mappings.
- Schema contract audit.
- TypeScript compiler check for the new connected-data map module.
- Full repository stability suite passed.
- Deployment layout and API artifact audits passed.
- Live Neon event-platform schema verification passed: idempotency, retry/claim and correlation fields are present.
- Live Neon event snapshot: 5 pending, 0 processing, 0 dead-lettered, 37 projected workflow events. The pending rows are retained for the deployed worker to process; no synthetic or destructive operation was used to clear them.

A complete dependency-backed monorepo production build still belongs in the deployment environment because the extracted workspace does not contain a complete installed dependency tree.

### Workstream boundary

Workstream 3 defines the connectivity architecture. Workstream 4 is the synthetic journey implementation and should use this map to build coherent journeys across the existing 30 TEST patients. Do not populate every patient into every module merely for coverage.

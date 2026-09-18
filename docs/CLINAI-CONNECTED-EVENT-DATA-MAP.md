# ClinAI Connected Event/Data Map

## Workstream 3: Connected Data + Event Architecture

This document defines the canonical architecture for turning ClinAI's existing authoritative domain tables into connected workflows. It does not create synthetic patient data and it does not replace domain tables with `module_records`.

## Architecture contract

```text
transactional domain write
        ↓
transaction-safe outbox event
        ↓
clinical workflow event projection
        ↓
care graph / deterministic signal
        ↓
downstream domain consequence
        ↓
next workflow step
        ↓
Patient 360 / intelligence / governed AI context
```

### Authority rules

- Domain tables remain the source of truth.
- `outbox_events` records transactional integration events.
- `clinical_workflow_events` is the normalized longitudinal workflow projection.
- `care_graph_edges` represents relationships between workflow events and source events.
- `clinical_signals` represents deterministic follow-through or safety/workflow signals.
- `module_records` is not a replacement for domain records.
- AI consumes structured, minimum-necessary context after deterministic processing.

## Canonical workflow chains

### Patient lifecycle

`patient.registered → appointment.created → appointment.checked_in/queue.entered → encounter.started → clinical work → encounter.completed → follow-up`

### Clinical

`assessment → diagnosis → order → result → treatment → monitoring`

### Emergency

`arrival → triage → assessment → orders → results → treatment → disposition`

### Inpatient

`admission → nursing → treatment → discharge → follow-up`

### Surgery

`indication → imaging → pre-op → procedure → recovery → discharge → follow-up`

### Maternity

`ANC/risk → labs → delivery → newborn → PNC → child health`

### Laboratory

`order → specimen collection/receipt → result → verification → release → clinical action`

### Imaging

`order → worklist → report → clinical action`

### Pharmacy

`prescription → availability → dispensing → administration → monitoring → safety signal`

### Referrals

`referral created → referral sent → receiving workflow → referral completed → continuity`

### Billing

`charge → invoice → payment → reconciliation → accounting`

### Insurance

`policy → eligibility → authorization where required → claim → claim items → submission → payer response → settlement/patient responsibility`

### Inventory

`stock → threshold → procurement request → purchase order → receipt → available stock → dispensing/consumption`

### Procurement

`requirement → request → approval → purchase order → supplier delivery → receipt → reconciliation`

### Supplier

`supplier selection → purchase order → delivery → receipt → performance measurement`

### Facilities

`capacity/resource observation → operational incident → response task → resolution → operational intelligence`

### Public health

`surveillance → investigation → response task → resolution → surveillance/intelligence`

### Intelligence

`domain events → workflow projection → deterministic signals → minimum-necessary context → governed AI interpretation`

## Event design rules

Every event should carry, where applicable:

- organization context
- event type
- aggregate type and aggregate ID
- patient ID
- encounter ID
- event key for idempotency
- correlation ID for the business workflow
- causation ID for the upstream event
- schema version for payload evolution
- source/domain record reference
- actor where available
- structured payload
- creation timestamp

Events should be emitted in the same database transaction as the authoritative write. Retries must be safe through the event-key/idempotency boundary. The worker claims events with row locking, recovers stale claims, retries transient failures, and dead-letters events that exceed their configured attempt limit. No event should remain indefinitely in a processing state after a worker failure.

## Downstream consequence rules

A workflow event is useful only when it can identify the next consequence. Examples:

- A medication order checks inventory availability.
- A dispense creates stock movement and reduces the selected batch quantity.
- A low-stock state can create procurement work.
- A purchase order receipt increases traceable inventory.
- An encounter creates or updates billable activity where appropriate.
- An invoice can be connected to policy and claim responsibility.
- A payer response changes claim settlement and patient responsibility.
- A payment creates reconciliation/accounting consequences.
- A verified result can create a care task or workflow signal.
- A referral completion returns information to the originating patient journey.

## API architecture surfaces

- `GET /api/events/connected-data-map` exposes the canonical workflow registry.
- `GET /api/events/connected-data-map/:workflow` exposes one workflow contract.
- `GET /api/events/catalog` exposes the event catalog and workflow mappings, including unmapped event types.
- `GET /api/events/health` exposes event-map validation plus pending, processing and dead-letter counts.
- `GET /api/events/stream` exposes organization-scoped projected workflow events, with optional patient and event-type filtering.
- The event projection includes correlation, causation and schema-version metadata.
- Existing `/api/intelligence/journeys` remains the unfinished-journey signal surface.
- Existing `/api/care-graph` remains the relationship graph surface.

These are read surfaces. Domain mutations continue to use their authoritative module routes and transactional event writers.

## Workstream 3 boundary

Workstream 3 establishes the connectivity contract. Workstream 4 is responsible for turning the existing 30 TEST patients into coherent synthetic journeys using this map. Large synthetic population changes should not be introduced as part of this architecture pass.

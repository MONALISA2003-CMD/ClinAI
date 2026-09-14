# ClinAI V25 Gate 1 — EMR Clinical Event Communication

## Scope
Gate 1 completes the first integration layer between existing EMR mutations and the transactional outbox.

## Implemented
- Reused `enqueueClinicalEvent` as the single outbox publication path.
- Added deterministic SHA-256 event keys from event type, aggregate identity and bounded event payload.
- Added event publication to existing transactional patient, allergy, appointment, queue, clinical order, medication order, laboratory, imaging, inpatient, bed, referral-transfer and care-task paths.
- Normalized existing connected-action events onto the same transactional publisher.
- Added `allergy.recorded` to the deterministic CDSS event boundary so a new allergy can trigger the existing medication/allergy safety rule.
- Added patient/encounter identifiers to event payloads where needed for downstream clinical intelligence.
- Converted imaging status and bed release/care-task creation writes to preserve an atomic domain-write + event publication transaction.

## Not changed
- AI prompts or system instructions
- AI model registry semantics
- AI model selection/provider routing/fallback policy
- Gemini interaction protocol
- Python clinical reasoning
- multilingual safety behavior
- AI response formatting/security boundaries
- production database data
- production schema

## Database
No new migration is required for Gate 1. Existing `outbox_events` and its V21 hardening are reused.

## Event flow

```text
EMR write
  -> same PostgreSQL transaction
  -> clinical event with stable event_key
  -> outbox_events
  -> clinical event worker
  -> deterministic CDSS evaluator
  -> clinical signal / audit where a rule matches
```

## Reliability requirements
- Domain write and event publication commit or roll back together.
- Duplicate publication with the same stable event key is ignored by the existing unique event-key constraint.
- Unsupported informational events remain durable but do not enter the current CDSS rule evaluator.
- AI is not part of the EMR write transaction.
- CDSS worker failure does not roll back the originating clinical record.

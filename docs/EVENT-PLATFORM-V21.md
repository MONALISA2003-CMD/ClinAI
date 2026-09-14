# ClinAI Event Platform v21

## Purpose
Strengthen the existing PostgreSQL outbox without replacing the current architecture.

## Rules
- Additive database changes only.
- Existing clinical records remain the source of truth.
- Domain writes and outbox publication should occur in the same transaction.
- Consumers must be idempotent.
- Event payloads contain only operational clinical context required by the consumer.
- Never place AI prompts, chain of thought, secrets, or credentials in events.

## Canonical event types
patient.registered
encounter.started
vital.recorded
diagnosis.recorded
order.created
specimen.collected
result.verified
medication.ordered
medication.dispensed
referral.created
referral.completed
discharge.started
followup.due

## Processing model
Clinical write -> outbox_events -> worker -> CDSS/integrations/notifications.

`event_key` provides idempotency. `last_error`, `locked_at`, and `worker_id` provide operational visibility without changing existing event history.

## Next step
Connect high-value existing write paths to `enqueueClinicalEvent`, then introduce the deterministic CDSS evaluator. Do not put an LLM in the safety decision path.

# ClinAI V23: Event Driven CDSS Activation

## Purpose

V23 connects the existing PostgreSQL outbox to the deterministic CDSS foundation. Important clinical writes now publish typed clinical events in the same transaction as the domain write, and a lightweight worker consumes those events and evaluates active governed CDSS rules.

## Flow

```text
Clinical write
   -> PostgreSQL transaction
      -> outbox_events
         -> CDSS worker
            -> active rule versions
               -> deterministic evaluator
                  -> cdss_evaluations
                  -> clinical_signals
                     -> clinician workflow
```

## Event coverage added

- `encounter.started`
- `vital.recorded` from completed triage
- `result.verified`
- `medication.dispensed`
- Existing `appointment.checked_in` remains connected

## Deterministic rule families

- Critical or flagged laboratory result
- Very low oxygen saturation
- Markedly elevated systolic blood pressure
- Medication and active allergy overlap
- Unresolved clinical order

The evaluator does not call an LLM and does not make autonomous treatment decisions.

## Reliability

The worker claims pending outbox rows with `FOR UPDATE SKIP LOCKED`, marks them as processing, evaluates them, then marks them processed. Failures return to pending with a short retry delay and a bounded non-sensitive error summary.

The existing `event_key` uniqueness constraint provides idempotent event publication. Signal persistence also avoids creating repeated open signals for the same event/rule combination.

## Safety boundary

CDSS output is a clinician review signal. It is not a diagnosis, prescription, or irreversible clinical action. Local clinical governance and validation remain required before real patient use.

## Database safety

V23 requires no schema migration. It uses the already applied V20 CDSS tables and V21 outbox hardening. No destructive SQL, reset, truncate, delete, or existing-row rewrite was introduced.

## AI boundary

AI prompts, model routing, orchestration, Python clinical reasoning logic, multilingual behavior, and AI safety boundaries were not modified.

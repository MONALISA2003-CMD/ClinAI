# ClinAI V25 Gate 3 — CDSS Gateway

## Purpose

Gate 3 introduces one stable evaluation boundary between the EMR/event platform and the existing deterministic CDSS evaluator.

```text
Async
EMR transaction → outbox → worker → CDSS gateway/evaluator → evaluation → signal

Sync
EMR action → /api/cdss/evaluate → CDSS gateway → approved deterministic rules → ALLOW/WARN/REVIEW
```

## What changed

- Added `services/api/src/intelligence/cdssGateway.ts`.
- Kept `cdssEvaluator.ts` as the clinical rule execution engine.
- Added an optional rule scope to the evaluator without changing the existing worker contract.
- Added a controlled synchronous endpoint: `POST /api/cdss/evaluate`.
- Synchronous evaluation is limited to explicitly approved deterministic safety rules:
  - `clinai.critical-lab`
  - `clinai.low-spo2`
  - `clinai.severe-bp`
  - `clinai.medication-allergy-conflict`
- Patient ownership is checked against the authenticated organization before synchronous evaluation.
- Missing patient context in synchronous mode fails closed to `REVIEW`.
- Existing async worker behavior remains unchanged and continues to evaluate the active rule set.
- Triggered deterministic signals remain persisted and auditable through the existing CDSS tables.

## Decision semantics

- `ALLOW`: no approved rule triggered.
- `WARN`: one or more approved rules triggered without a critical signal.
- `REVIEW`: at least one critical signal triggered, or synchronous patient context is missing.

The gateway does not diagnose, prescribe, authorize treatment, or replace clinician judgment.

## Database

No migration was added. Existing tables are reused:

- `cdss_rule_versions`
- `cdss_evaluations`
- `clinical_signals`
- `clinical_signal_actions`

No reset, DROP, TRUNCATE, destructive rewrite, or production data deletion was performed.

## AI boundary

No AI prompts, model routing, provider selection, fallback strategy, Python clinical reasoning, multilingual policy, or AI security behavior was changed.

## Verification

Run:

```bash
node tests/v25-gate3-cdss-gateway-audit.mjs
```

Also run the existing Gate 1 and Gate 2 audits plus the schema contract audit. TypeScript transpilation should include the new gateway and modified evaluator.

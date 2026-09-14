# ClinAI CDSS Foundation V20

Implemented as an additive foundation for EMR + CDSS integration.

## Added

- Versioned CDSS rules linked to the existing `clinical_guideline_rules` model.
- Clinician-facing `clinical_signals` with severity, evidence, recommendation, status and audit lifecycle.
- `clinical_signal_actions` for acknowledge, snooze, resolve, dismiss, reopen and view actions.
- `cdss_evaluations` for evaluation/audit telemetry.
- API endpoints for signals, signal actions, rule versions and CDSS summary.

## Safety boundaries

- No existing AI prompts, routing, model selection, orchestration or Python clinical reasoning changed.
- No destructive SQL.
- No reset, truncate, delete or production data rewrite.
- Existing guideline and workflow-event infrastructure is reused.
- CDSS signals are distinct from generative AI output.

## Neon

Migration: `database/migrations/020-clinai-cdss-foundation.sql`

The migration is additive and uses `CREATE TABLE IF NOT EXISTS` plus indexes only.

# ClinAI Production Integrity AI Implementation

## What changed

This release hardens the existing V28 architecture without resetting or replacing the PostgreSQL database.

### AI response intelligence
- Expanded the internal structured AI contract with current situation, attention items, care gaps, cross-module evidence, safety signals and provenance.
- Added an explicit clinical-intelligence method to the AI orchestration prompt.
- Prioritizes deterministic CDSS and consistency signals over generative interpretation.
- Reconciles longitudinal patient and operational context across encounters, diagnoses, orders, laboratory, imaging, medicines, referrals, follow-up, tasks and observations when available.
- Detects unfinished care journeys and missing follow-through already supported by the deterministic intelligence layer.
- Preserves uncertainty and avoids invented clinical facts.
- Stores the complete structured result in `ai_work_runs.result_summary` rather than only the direct answer.

### Frontend response presentation
- ClinAI now renders structured intelligence sections instead of exposing raw model JSON, Markdown tables or HTML fragments.
- Added structured presentation for current situation, attention, care gaps, cross-module evidence, safety signals, calculations, next checks, uncertainty and provenance.
- The AI workspace displays the authorized role returned by the session rather than offering a role-changing selector.
- Public `HEALTH INFO` assistant UI was replaced by an `ABOUT CLINAI` entry point.

### Security boundary
- Demo authentication is explicitly disabled in production unless `CLINAI_ENABLE_DEMO_AUTH=true` is deliberately configured.
- The fallback demo identity is no longer issued the `admin` role when no seeded demo tenant exists.

### Database
Only additive performance indexes were applied to the existing Neon PostgreSQL database. No tables were reset, dropped or truncated.

Indexes:
- `idx_ai_work_runs_org_patient_created`
- `idx_ai_work_runs_org_purpose_created`
- `idx_ai_usage_events_org_patient_created`
- `idx_ai_usage_events_org_purpose_created`
- `idx_ai_security_events_org_status_created`
- `idx_ai_risk_assessments_org_status`

Migration source: `database/migrations/20260917_ai_intelligence_indexes.sql`.

## Verification

Passed:
- production-integrity AI audit
- V28 completion audit
- V27 full page audit
- V26 AI reliability audit
- AI security/scope audit

The local environment did not contain installed npm dependencies, and network package installation timed out, so a full Next.js/TypeScript dependency-backed build could not be executed in this environment. TypeScript source parsing was nevertheless checked successfully for the modified API and web files.

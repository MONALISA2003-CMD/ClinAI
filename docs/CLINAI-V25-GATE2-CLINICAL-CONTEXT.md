# ClinAI V25 Gate 2 — Clinical Context Layer

## Purpose
Gate 2 formalizes the existing Patient 360 / AI patient context behind one reusable Clinical Context Layer. It does not replace the EMR source of truth, the deterministic clinical-intelligence engine, or the multi-model AI Router.

## Contract
`buildClinicalContext({ pool, organizationId, patientId, purpose, role, userId, query, rawBuilder })`

The layer:

1. Verifies that the patient belongs to the authenticated organization.
2. Reads explicit patient consent records when available.
3. Treats an explicit active consent scope as an allow-list for context modules.
4. Honors an explicit AI/clinical-intelligence withdrawal by refusing patient context.
5. Applies a purpose-specific module allow-list.
6. Applies a role-aware allow-list for internal clinical/operational contexts.
7. Recomputes deterministic intelligence and evidence indexes from the permitted context only.
8. Returns a small `contextPolicy` metadata object describing the access decision.

## Purpose classes

- `clinical`: longitudinal clinical assistance.
- `documentation`: note/referral/discharge/handover assistance.
- `communication`: patient communication and translation; excludes clinical record modules.
- `operations`: operational patient context only.
- `patient-portal`: portal-relevant patient context.
- `cdss`: deterministic clinical safety context.
- `research`: internal research context subject to the same organization and consent boundary.

## Important compatibility decision
Missing consent is represented as `not-recorded`; it is not converted into a fabricated affirmative consent. Existing V24 tenants therefore continue to work unless there is an explicit withdrawal. An explicit withdrawal of AI/clinical-intelligence consent blocks patient context.

## AI Router integration
The existing `patientContext` function remains the compatibility wrapper. `runAgent` now passes the request purpose and authenticated request into that wrapper, so AI tasks receive a purpose-limited context without changing model/provider selection, prompts, fallback strategy, Gemini protocol, multilingual safety, or response formatting.

The CDSS `clinical_reasoning_review` tool also uses the `cdss` context purpose.

## Database policy
No migration was added. Existing `patient_consents` is reused. No clinical records are changed. No destructive SQL is introduced.

## Verification
- Gate 1 event coverage audit: passed.
- Gate 2 context-layer structural audit: passed.
- TypeScript transpile check: 10 source files, 0 diagnostics.
- Full `npm run build` was not available in this environment because the project dependency tree is not installed (`node_modules` absent).

## Next gate
V25 Gate 3: create a single internal CDSS evaluation gateway around the existing deterministic evaluator, preserving the current async worker path and adding only explicitly approved synchronous checks.

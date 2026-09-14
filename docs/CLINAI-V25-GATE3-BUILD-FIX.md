# ClinAI V25 Gate 3 Build Fix

## Issue
Render production TypeScript compilation rejected `cdssEvaluator.ts` because the unsupported-event early return did not satisfy `ClinicalEvaluationResult`.

Expected contract:

- `evaluated`
- `triggered`
- `triggeredSignals`

The unsupported-event branch returned only the first two fields.

## Correction
The branch now returns an empty `triggeredSignals` array:

```ts
return { evaluated: 0, triggered: 0, triggeredSignals: [] };
```

No database migration, data mutation, AI routing change, or clinical-rule change was made.

## Verification
- Gate 3 CDSS gateway audit: passed
- Gate 2 Clinical Context audit: passed
- Gate 1 Event Coverage audit: passed
- Schema contract audit: passed
- Production TypeScript compiler should now accept the corrected evaluator contract.

A full local `npm install` could not complete within the available execution window, so dependency-backed `tsc -p tsconfig.json` was not falsely marked as locally passed. Render's build environment remains the authoritative dependency-backed build check.

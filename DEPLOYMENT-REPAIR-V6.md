# ClinAI Deployment Repair V6

## Render runtime module hardening

The Sep 17 2026 Render failure was a Node ESM/CJS boundary error, not a missing artifact anymore. The API entrypoint was emitted, but `services/api/src/main.ts` imports `packages/domain/validation/index.js` as an ESM module with named exports. Because `packages/domain` had no package boundary declaring ESM, TypeScript compiled that package source as CommonJS under NodeNext. Node 24 then loaded the generated CommonJS module and correctly reported that `WORKFLOW_VALIDATION_CONTRACTS` was not an ESM named export.

V6 fixes this at the package boundary:

- Added `packages/domain/package.json` with `"type": "module"`.
- Kept the API compiled layout at `services/api/build/services/api/src/main.js`.
- Changed `services/api` start script to the canonical compiled entrypoint so the fix works even if Render is still using the previously saved workspace start command.
- Kept the build artifact audit and added a runtime module-boundary audit.
- No database changes.

A local TypeScript emission check confirms the compiled validation module is now ESM and exports `WORKFLOW_VALIDATION_CONTRACTS` as a real named export.

## Vercel

The V5 strict endpoint narrowing remains in place.

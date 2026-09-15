# ClinAI V26.1 — TypeScript + Deployment Hotfix

This hotfix completes the V26 integration/reliability package without changing the Neon database schema or production data.

## Fixed

- Corrected the frontend `fetchJSON` result destructuring from `{r,d}` to `{r,data}` in the module loader and AI assistant flow.
- Updated all related response references to `data.error` and `data.data`.
- Fixed two strict-TypeScript empty-array inference errors in the API by explicitly typing accumulator arrays used by deterministic CDS and child-care-gap creation.
- Added an explicit Next.js web `tsconfig.json` and `next-env.d.ts` so the web workspace has a stable, strict TypeScript contract instead of relying on Next.js to generate one during build.
- Added workspace `typecheck`, `typecheck:web`, and `typecheck:api` scripts.
- Bumped API/web version to `0.18.2` and `/api/build-info` to `0.18.2` so deployment version mismatches are easier to detect.

## Preserved

- No Neon reset, drop, truncate, or destructive migration.
- No changes to AI prompts, model routing policy, clinical reasoning, safety boundaries, or internal AI response structures.
- V26 explicit module endpoint contracts and additive domain collection routes remain intact.
- Patient-data restrictions for public/free AI models remain intact.

## Verification

- V26 module contract audit: passed, 73 frontend modules.
- V26 AI reliability audit: passed.
- Schema contract audit: passed.
- V25 Gate 1 event coverage: passed.
- V25 Gate 2 clinical context: passed.
- V25 Gate 3 CDSS gateway: passed.
- TypeScript transpilation diagnostics: 0 across 14 TypeScript/TSX source files.
- Strict web typecheck with React/DOM type-contract stubs: passed.
- Dependency-backed `tsc`/Next production build could not be executed in this environment because `npm install` timed out before dependencies were available. Vercel's dependency-backed build remains the final deployment gate.

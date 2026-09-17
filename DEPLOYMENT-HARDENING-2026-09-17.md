# ClinAI Deployment Hardening Repair — 2026-09-17

## Scope
This repair is based on the V3 source that produced commit `550a425` deployment logs. It changes deployment/runtime integrity only plus the Vercel TypeScript failure. No database migration, reset, truncation, deletion, or data rewrite is included.

## Vercel repair
- Typed the module contract catalog and contract fields in `apps/web/app/page.tsx`.
- Removed the implicit-`any` callback at the failing `fs.map(f => ...)` form renderer.
- The contract type is aligned with the shared validation contract so `validateRecord()` remains type-safe.

## Render API repair
The Render log showed:
1. `tsc -p tsconfig.json` completed successfully.
2. Render uploaded the build.
3. Runtime then failed because `services/api/dist/main.js` did not exist.

The repair removes the fragile `dist` runtime path:
- API TypeScript `outDir` is now `services/api/build`.
- API `start` is now `node build/main.js`.
- Render starts the verified artifact directly: `node services/api/build/main.js`.
- Render's build command explicitly checks that `services/api/build/main.js` exists before deployment completes.
- The API package build script also verifies `build/main.js` immediately after TypeScript compilation.
- The API Dockerfile was aligned with the monorepo workspace layout and the same `build/main.js` artifact.
- The AI response-boundary audit no longer depends on a checked-in/generated `dist` tree; it transpiles the source under test in memory.

## Why this is safer
The previous logs proved compilation succeeded but did not prove the runtime artifact survived into the deployed service. The new build has an explicit artifact existence gate and a non-ignored output directory. The runtime command points to exactly that artifact rather than relying on a workspace-relative `dist` directory that disappeared between build and start.

## Verification completed
- Canonical stability suite: PASS.
- Deployment layout hardening audit: PASS.
- AI V5 response-boundary audit: PASS.
- Source transpile check: 16 TypeScript/TSX files, 0 syntax/transpile failures.
- Vercel `page.tsx` transpile diagnostics: 0.
- No migration files were changed by this repair.

## Environment limitation
A full dependency-installed `next build` / API `tsc` could not be reproduced in the isolated repair environment because the npm registry/cache was unavailable. Render already supplied authoritative evidence that the API TypeScript compilation succeeds, and the current source transpile plus canonical structural suites pass. Vercel's next deployment remains the final cloud typecheck/build gate.

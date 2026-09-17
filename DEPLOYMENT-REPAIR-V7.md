# ClinAI Deployment Hardening Repair V7

Date: 2026-09-17

## Root causes confirmed from cloud logs

### Render API artifact

The API workspace TypeScript project imports source files from `packages/*` using relative imports. Without an explicit `rootDir`, TypeScript infers a common source root above `services/api`, so `outDir: build` does not emit `build/main.js`. It emits the entrypoint at:

`services/api/build/services/api/src/main.js`

The previous deployment hardening changed `dist` to `build` but incorrectly assumed the entrypoint would be at the top level of that directory. The new configuration explicitly sets `rootDir: ../..` and verifies the actual monorepo-safe output path.

The compiled output also contains the required workspace package artifacts under:

`services/api/build/packages/`

so the compiled relative imports remain self-contained.

### Vercel web type error

`Object.fromEntries()` was receiving `createEndpoint: string | undefined` after a truthiness filter. Strict TypeScript correctly inferred a possible undefined value. A type-predicate filter now narrows contracts to those with a definite non-empty string create endpoint before building `Record<string,string>`.

## Repairs

- API TypeScript `rootDir` explicitly set to `../..`.
- API runtime entrypoint standardized to `build/services/api/src/main.js`.
- API build verifies both runtime entrypoint and compiled module contract catalog.
- Render build verifies the same artifact and starts the exact verified path.
- API Docker build/runtime paths aligned with the monorepo output layout.
- Deployment layout audit updated to enforce the actual artifact path and rootDir.
- V26 module audit converted from an obsolete literal-map regex into a compatibility wrapper around the canonical contract audit.
- Vercel `MODULE_CREATE_ENDPOINTS` made strictly type-safe without weakening TypeScript.
- Added a reusable API build artifact audit script.
- Added a deployment layout npm script.

## Verification

- Deployment layout audit: PASS
- API build artifact audit against a TypeScript emission: PASS
- Phase 1 security boundary: PASS
- Phase 2 module contracts: 80 contracts / 79 advertised modules: PASS
- Phase 3 validation: 62 create-capable contracts / 297 governed fields: PASS
- Phase 4/5 clinical intelligence: PASS
- Phase 6/7 Patient 360 and six intelligence workspaces: PASS
- Public release audit: 15 checks: PASS
- V28 completion: 14 checks / 9 AI capabilities / 5 CDS hooks: PASS
- Schema contract: PASS
- Responsive structural check: PASS
- Intelligence Core: PASS
- AI language policy: PASS
- AI security/scope/presentation: PASS
- AI V4 response/speed: 9 checks: PASS
- V26 compatibility contract audit: PASS

## Dependency/lockfile note

The repository currently contains no committed package-lock, npm-shrinkwrap, pnpm lockfile, or yarn lockfile in the repair source. The isolated repair environment could not reach the npm registry to generate a production lockfile. Therefore no fabricated lockfile is included. The Vercel SWC message remains a dependency reproducibility warning rather than the cause of the current TypeScript failure.

## Database safety

No database migration, reset, truncate, delete, or schema-destructive operation is part of this repair.

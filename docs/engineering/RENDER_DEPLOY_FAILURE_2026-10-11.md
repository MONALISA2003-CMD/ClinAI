# Render API deployment incident — 11 October 2026

## Service and commits

- Render service: `clinai-api` (`srv-daicrqlg1s2s73eqklm0`)
- Render deploy reviewed: `dep-db5hscv79l7c73fle220`
- Deploy commit: `d78551c606c574dd76d0450268b21c366afed50a`
- Previous TypeScript-failing deploy in the same log window: `0653fad657483ed9575049052203a938da3a293f`

## Every distinct root error observed in the supplied time window

1. **Earlier deploy `0653fad`:** `TS2339` at `services/api/src/main.ts(651,19)`, direct `organizationId` access on Fastify JWT's `string | object | Buffer` union. The subsequent source commit added explicit structural narrowing and the API compilation then succeeded.
2. **Deploy `d78551c`:** `ERR_MODULE_NOT_FOUND` for `services/api/build/services/api/src/security/tenant-scope.js`, imported by the compiled `main.js`. The source existed only as `.js` plus `.d.ts`, while `services/api/tsconfig.json` only includes `src/**/*.ts`. TypeScript could use the declaration for typechecking but did not emit the JavaScript helper; the post-build audit only checked `main.js` and the JSON contract catalog and therefore missed the missing runtime dependency.
3. NPM `start` lifecycle errors (`code 1`) are cascading errors from item 2, not independent causes. The module-not-found error was emitted twice during restart/start attempts.

## Fixes in this source package

- Ported tenant-scope helpers to `services/api/src/security/tenant-scope.ts` so the existing NodeNext import `./security/tenant-scope.js` resolves to the TypeScript source and produces the `.js` artifact during compilation.
- Removed the misleading JS source and declaration file, and changed the helper audit to import the TypeScript module under Node's strip-types mode.
- Strengthened `scripts/api-build-artifact-audit.mjs` to require the emitted tenant-scope artifact and validate all relative imports across every emitted JavaScript file under the API build tree. Missing runtime targets now fail the build before deployment.
- Added a runtime-artifact regression test and included it in the main stability command.

## Validation

The package build must run `npm run build:api`. Success requires TypeScript compilation, existence of the compiled tenant-scope helper, and all relative imports from compiled `main.js` resolving. The unit/static regression suite is also run from `npm run test:render:runtime-artifacts`.

The Render service remains on its prior live deployment until this source is committed and pushed to GitHub. This incident package itself does not deploy or change Render settings.

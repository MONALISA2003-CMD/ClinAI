# P1 — Production boundary and foundation hardening

**Status:** Implementation increment prepared; rollout acceptance remains gated on a representative database, integration tests, and operational review.  
**Baseline:** GitHub `main` SHA `05fe7732c58631fd5bd89c89b75efb54bf7674ed` was last verified during this implementation.  
**Scope:** Source/configuration changes only. No database was modified and no deployment was triggered.

## What changed

### Production configuration is fail-closed

`services/api/src/config/runtime-config.ts` centralizes API runtime configuration. Production requires a PostgreSQL URL using `sslmode=require`, `verify-ca`, or `verify-full`; a JWT secret of at least 32 bytes; explicit JWT issuer and audience; a non-empty exact-origin HTTPS allowlist; an absolute HTTPS `PUBLIC_BASE_URL`; public test data disabled; no demo auth; no JSON-store override; runtime DDL disabled; and migration history enforcement enabled. Startup throws when these conditions are not met.

Development can use localhost CORS defaults, but its missing JWT secret is generated randomly per process rather than relying on a known constant. This is a development convenience, not a production identity strategy.

### CORS and JWT policy

The API now returns CORS headers only for origins on the explicit configured allowlist. JWT signing declares `HS256`, issuer and audience; verification limits algorithms, issuer, audience, and token age. Deployments must set the issuer/audience consistently with token consumers. This change does not by itself implement token revocation or an organization membership/session lifecycle.

### JSON-file persistence cannot activate in production

Local JSON store loading and writes now reject production mode, and store loading only occurs outside production. The local store directory is ignored by Git. Production startup requires a real database configuration.

### Runtime schema DDL moved to an explicit migration entry point

The startup-only DDL blocks in `services/api/src/main.ts` are gated off in production. Their consolidated SQL is registered as `034-runtime-schema-consolidation` in `database/migrations/manifest.json` and run by `scripts/db-migrate.mjs` only after explicit `--apply`. The runner validates a SHA-256 checksum, preflights required base tables, serializes concurrent runs using a PostgreSQL advisory lock, applies the SQL in a transaction, and records applied status in `clinai_schema_migrations`.

**Important legacy-migration limitation:** the repository's existing migration directory has duplicate numeric versions and no reliable evidence in this source snapshot that all historical SQL files match a deployed database. They are deliberately preserved and are not replayed or falsely marked applied. P1's single new migration ledger covers the registered consolidation only. Completing a truthful ledger for the historic set requires schema/provenance reconciliation against a safe database snapshot.

Commands:

```sh
# Manifest/checksum validation and DB-state inspection; does not write schema.
npm run db:migrate:plan

# Explicit apply in non-production after backup, dependency and staging review.
npm run db:migrate -- --apply

# Production requires BOTH controls plus the ordinary production environment.
CLINAI_ALLOW_PRODUCTION_MIGRATIONS=true npm run db:migrate -- --apply --allow-production
```

Never apply the migration to a production database before a backup, schema comparison, data-integrity review, and successful staging replay. The production service will refuse to start until the required registered migration is recorded as applied.

### Service-worker cache limited to static assets

`apps/web/public/sw.js` now caches only a known list of static icon/manifest assets and immutable `/_next/static/` build assets. It does not cache HTML navigation, application/API JSON, authorized content, or non-GET requests; it also removes earlier ClinAI shell caches that may have retained broader responses. Responses marked `private`/`no-store` or carrying `Set-Cookie` are not stored.

### Offline clinical request replay disabled

Public synthetic session tokens now use a viewer role, and the API write gate does not treat a synthetic token as write permission. Public workspace selection now counts all patient records in each candidate organization and only accepts an organization where every patient is both marked synthetic and has the approved demo email domain; it no longer prefilters away non-synthetic rows before comparing the counts. Tokens minted before the new global issuer/audience checks will no longer validate; plan a controlled re-authentication rollout. The web app labels the workspace as read-only. `apps/web/lib/offline.ts` no longer persists or replays clinical write requests. Existing legacy IndexedDB operations are counted and the legacy database is deleted; the UI warns that queued writes were not sent and must be entered again. If the browser is offline, the form explicitly says the mutation was **not saved**. This is intentionally conservative until device binding, user/tenant/session lifecycle, expiry, logout cleanup, idempotency, and replay authorization can be independently tested.

### Cross-tenant isolation hardening

`services/api/src/security/tenant-scope.ts` provides fail-closed in-memory row filtering, organization-constrained single-record lookups, patient-child filtering, and same-tenant/same-patient encounter-link validation. API fallback reads/counts use tenant-scoped helpers, patient summaries only include records from an authorized organization, write helpers make the authenticated organization authoritative, and event/audit entries carry organization context. A database-backed pre-handler checks patient, facility, district, encounter, appointment, and invoice ownership for relevant write requests, rejects a conflicting organization ID in the body, and enforces same-patient links for encounter, appointment, and invoice references; route-specific checks remain for transactional/domain behavior. Contract relationship validation uses tenant joins for resources without a direct `organization_id` column, including lab samples, medication orders, and referrals, and resolves user membership through organization-scoped roles. Store-mode clinical writes validate patient and encounter relationships where the local implementation supports the domain.

`tests/p1-tenant-isolation-audit.mjs` contains 10 dependency-free checks covering cross-organization reads/lookups, patient-related rows, encounter consistency, DB write-boundary assertions, sensitive clinical create handlers, payment/pharmacy fallback, scoped collection results/counts, and patient care summaries. All 10 pass. These are focused helper/source-boundary regression checks, **not** a substitute for live HTTP tests against a staging database; that end-to-end negative-test matrix remains a release gate.

### Reproducible installation

The repository had no lockfile. Generating one requires registry metadata, but the environment could not reach `registry.npmjs.org` (`EAI_AGAIN`) and no prior lockfile was present in the ZIP or `main`. I did not fabricate one or change deployment commands to `npm ci`, which would make the package fail to install. Reproducible dependency installation remains an explicit P1 blocker: generate a real lockfile in a network-enabled environment, replace floating manifest selectors with reviewed exact versions, commit the lockfile, then switch deploy commands to `npm ci` and verify from a clean checkout.

## Environment setup

See `.env.example`. Production operators must supply real values from a secret manager; never copy example credentials. At minimum configure:

- `DATABASE_URL` with TLS verification appropriate to the database provider.
- `JWT_SECRET` (unique and at least 32 bytes), `JWT_ISSUER`, `JWT_AUDIENCE`.
- `CLINAI_ALLOWED_ORIGINS` as a comma-separated exact HTTPS origin list with no paths or wildcard.
- `PUBLIC_BASE_URL` as the canonical HTTPS API issuer/base URL.
- `CLINAI_PUBLIC_TEST_DATA=false`, `CLINAI_PUBLIC_PREVIEW=false`, and `CLINAI_ENABLE_DEMO_AUTH=false`.
- `CLINAI_ENABLE_RUNTIME_SCHEMA_DDL=false` and `CLINAI_ENFORCE_SCHEMA_MIGRATION_HISTORY=true`. Leave runtime DDL off in all environments except a deliberate, temporary local compatibility case.
- Do not set `CLINAI_STORE` in production.

## Verification implemented

`scripts/p1-production-hardening-check.mjs` checks production fail-closed configuration, exact origin validation, secret length and TLS mode, random non-production secret generation, immutable migration checksum registration, explicit migration guardrails, offline queue disablement, and static-only service-worker caching.

Run the dependency-free hardening checks first:

```sh
node --experimental-strip-types scripts/p1-production-hardening-check.mjs
node tests/p1-tenant-isolation-audit.mjs
node scripts/db-migrate.mjs --plan
node tests/phase1-security-boundary-audit.mjs
node tests/phase1-backend-correctness-audit.mjs
node tests/public-test-data-audit.mjs
node tests/public-release-audit.mjs
node tests/production-integrity-ai-audit.mjs
```

A full build/typecheck and `npm ci` verification could not be performed in the packaging environment because the registry was unreachable and dependencies were not preinstalled. Once a real lockfile is generated in a network-enabled environment, run `npm ci`, `npm run build:api`, `npm run typecheck:web`, and the full regression suite before approving the release.

The complete original audit suite remains included. Because parts of the app depend on external providers and live database schema, static/unit checks do not replace a staging integration test. P1 adds `services/api/src/security/tenant-scope.ts` for fail-closed tenant-aware in-memory lookups, authoritative tenant assignment on writes, scoped event/audit rows, and related-record filtering. The Render follow-up also verifies the emitted `tenant-scope.js` runtime module and relative imports across the compiled API output. `tests/p1-tenant-isolation-audit.mjs` verifies tenant-scope helpers and key source boundaries without requiring patient data or a live service.

## External connector observations during this increment

- GitHub: read access verified; current main SHA matched the API file in the uploaded source ZIP. The GitHub connector denied branch creation with `403 Resource not accessible by integration`; no remote source was pushed.
- Vercel: project/deployment records were read-only checked. No deployment was started.
- Render: `clinai-api` configuration was inspected read-only. Auto-deploy is enabled on `main`; no environment variables were changed and no deploy was triggered. No Render PostgreSQL instance was listed.
- Neon: the advertised project-search/list actions returned a connector-side `Tool ... not found` error, so the live Neon schema could not be inspected. No Neon database operation was attempted.

## P1 status / remaining acceptance gates

| Gate | Status | Evidence / next step |
|---|---|---|
| Production config fails closed | Implemented; unit-tested below | Validate deployed environment names against this config without disclosing secret values |
| No known JWT fallback | Implemented | Rotate any previously deployed fallback secret and expire/revoke old sessions as applicable |
| Exact CORS origin allowlist | Implemented | Verify deployment's canonical frontend origins and preflight behavior end-to-end |
| No production JSON fallback | Implemented | Confirm production `DATABASE_URL` and storage paths using secret-safe runtime checks |
| Explicit migration runner/history | Initial registered migration implemented | Reconcile historic migration provenance; run plan and apply only in a backed-up staging database; verify idempotent second plan |
| Tenant/facility isolation negative tests | Partial: 10 static/helper tests pass | Added fail-closed tenant-scoped helper tests, same-patient encounter/appointment checks, and DB-backed write-boundary assertions. Still needs live API + staging DB negative tests for every sensitive API, export, job, cache, and AI retrieval path |
| Public synthetic workspace is read-only | Viewer token + server-side write denial + UI banner implemented | Exercise a route-by-route mutation denial matrix in staging |
| Offline write restrictions | Browser queue/replay disabled | Independently confirm old queue deletion behavior across tabs and supported browsers |
| Dependency lock/reproducible install | Blocked: lockfile absent; registry unreachable in this environment | Generate a genuine lockfile in a network-enabled environment, pin floating dependency selectors, run clean install/build, then dependency vulnerability/license review |
| Deploy verification | Not run by design | Use a staging deployment after access, migration, and release approvals |

**Release decision:** Do not promote this increment directly to production solely on a successful build. P1 has meaningful code hardening, but the migration provenance, full tenant-isolation test matrix, deployment environment validation, and staged migration replay remain required release gates.

## Full source-snapshot regression sweep

An automated differential sweep ran all `tests/*.mjs` scripts available in each tree: 65 in the modified working tree and 64 in the untouched uploaded ZIP. The modified tree reports 57 passing and 8 failing checks; the untouched ZIP reports 56 passing and 8 failing checks. All 8 failures are common to both trees; no new failing test was observed. The extra modified-tree test is `tests/p1-tenant-isolation-audit.mjs`, which passes 10/10. The common failures are:

- `tests/ai-security-scope-audit.mjs`: existing assertion for a bounded provider timeout.
- `tests/ai-v4-response-speed-audit.mjs`: existing provider-timeout tightening assertion.
- `tests/api-contract.mjs`: integration test expects an API server listening at localhost:4000; no server/dependencies/DB were available in this run.
- `tests/multilingual-python-safety-audit.mjs`: existing Python intelligence-engine safety check cannot complete in this environment.
- `tests/phase1-7-full-integrity-audit.mjs`: uploaded baseline fails its AI orchestrator file hash check.
- `tests/phase10-11-integrity-audit.mjs`: uploaded baseline fails three pre-existing phase-completion/hash checks.
- `tests/phase45-5-completion-audit.mjs`: uploaded baseline expects an import that is absent from its own source snapshot.
- `tests/v15-full-system-audit.mjs`: uploaded baseline fails the `research record` assertion.

The P1-specific hardening check passes 7/7, and `tests/p1-tenant-isolation-audit.mjs` passes 10/10. Four TypeScript harness configurations (`web`, `api-route`, `api-main`, `phase89`) pass. A direct TypeScript build cannot be verified here: dependencies are not installed, `@types/node` is missing, and npm registry access fails with `EAI_AGAIN`; no lockfile has been fabricated. `scripts/db-migrate.mjs --plan` loads and checksum-validates the registered migration but reports `DATABASE_URL is not set`; no real database state was inspected and no staged migration replay occurred. Render has no PostgreSQL instance in the connected workspace, and the Neon project listing actions fail at the connector layer. GitHub branch creation is blocked by the connector 403 permission response. Therefore the lockfile/build, live DB migration replay, and end-to-end route tenant-negative tests remain outstanding. The Phase 1 security-boundary audit, backend correctness audit, public synthetic test-data audit, public release audit (26 checks), and production-integrity/AI audit (6 checks) all pass. These static checks do not replace a clean dependency install/build or staging database and route-level tests.

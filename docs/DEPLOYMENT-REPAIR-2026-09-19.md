# ClinAI Deployment Repair Report — 2026-09-19

## Deployment failures addressed

The failing GitHub commit reported two independent strict-build failures:

1. Render / API build failed in `services/api/src/routes/phase67FinancePublicHealth.ts` because PostgreSQL's `rowCount` is typed as `number | null`, while the route contract requires `count: number`.
2. Vercel / Next.js build failed in `apps/web/app/page.tsx` because `actionList` inferred an `any[]`, causing the callback parameter `a` to become an implicit `any` under the real Next.js strict typecheck.

## Repairs

### Backend

- Normalized all 20 Phase 6/7 list handler counts with `r.rowCount ?? 0`.
- Kept the organization-scoped read contracts unchanged.
- Removed an unsafe duplicate retry of the same `UPDATE` in the response-task action route. Arbitrary database errors must not silently re-run a write.
- Fixed procurement purchase-order transaction ordering so the transaction begins before `FOR UPDATE` locking.
- Added organization ownership validation when a purchase-order line is linked to an inventory item.
- Fixed procurement receipt locking to occur inside the transaction and made rollback conditional on an active transaction.
- Regenerated the compiled Phase 6/7 route artifact from the corrected TypeScript.

### Frontend

- Added an explicit `string[]` return type to the Phase 3 `actionList` function. This removes the implicit-`any` callback failure reported by Vercel.

### Regression-test corrections

The Phase 1–7 integrity audit had accidentally omitted `portal-messages` from its Phase 7 module list, so it reported 19 Phase 6/7 modules even though the runtime route registry contains 20. The audit now includes `portal-messages` and verifies all 20 modules.

New guards also verify:

- all 20 list handlers normalize nullable PostgreSQL `rowCount`
- the Phase 3 action list is explicitly typed
- procurement transactions begin before row locking
- procurement inventory links are organization-scoped
- response writes do not retry automatically after arbitrary DB errors

## Validation

Source-level validation after the repair:

- Phase 1–7 integrity audit: PASS, 20 Phase 6/7 modules, 80 contracts
- All-stability regression suite: PASS
- Deployment layout audit: PASS
- API build artifact audit: PASS
- Vercel web type-safety audit: PASS
- Render build regression audit: PASS
- Workstream 6 validation: PASS
- Workstream 7/8 validation: PASS
- Domain restoration validation: PASS
- Public writable validation: PASS
- Phase 2 depth audit: PASS, 20 checks
- Phase 3 diagnostics/medication depth audit: PASS, 27 checks
- Phase 4/5 completion audit: PASS, 18 modules
- Phase 6/7 Patient 360 audit: PASS
- Frontend/backend route audit: 62 frontend API paths, 300 backend routes, missing 0
- Python compilation: PASS
- AI baseline files remain byte-for-byte preserved

## Production database verification

Neon production branch checked:

- project: `summer-dust-19354872`
- branch: `br-bold-hill-b2ubvgwa`
- database: `neondb`

Observed production health remains intact:

- 42 patients total
- 30 synthetic TEST patients
- 12 protected/non-test patients
- 30 insurance policies, 0 missing organization IDs
- 30 invoices
- 26 payments
- 30 claims
- 1 accounting entry
- 5 inventory items
- 1 procurement request
- 3 suppliers
- 5 surveillance events
- 31 notifications
- 30 documents
- 30 portal messages
- 1 telemedicine session
- 8 remote-monitoring readings

Tenant-safety checks returned zero mismatches for the audited patient-linked finance, engagement, surveillance, monitoring and organization-scoped supply/accounting records.

## Important deployment limitation

The local environment does not contain the repository's installed npm dependency tree, and `npm install` timed out in this environment. Therefore a complete local `next build` / `tsc -p services/api/tsconfig.json` was not available here. The strict deployment failures from the supplied Render/Vercel logs were repaired, and the repository's semantic TypeScript harness plus deployment and regression audits all pass.

The GitHub connector is read-only for this repository in this environment, so the fix could not be pushed directly to `main`. The package and patch below are ready to apply to the repository so Render and Vercel can rebuild commit `main`.

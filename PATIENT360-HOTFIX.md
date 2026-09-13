# Patient 360 Surgical Hotfix

Scope: Patient 360 only.

Changed only the clinical-alerts/care-gaps query in `services/api/src/main.ts` and the checked-in compiled `services/api/dist/main.js`.

Before:
`SELECT id,kind,severity,status,payload,created_at AS "createdAt" FROM module_records ...`

After:
`SELECT id,COALESCE(payload->>'kind',module) AS kind,COALESCE(payload->>'severity','') AS severity,status,payload,created_at AS "createdAt" FROM module_records ...`

Reason: production `public.module_records` has no `kind` or `severity` columns. Both values are safely derived from the existing JSONB `payload` (with module/empty-string fallbacks), preserving the existing Patient 360 response shape.

No database schema changes were made.
No AI code was changed.
No other module code was changed.
No patient data was changed.

## 2026-09-13 surgical repair

- Fixed the two Patient 360 `module_records` queries that referenced the nonexistent `patient_id` column. They now scope by `organization_id` and read the patient relationship from `payload->>'patientId'`.
- Preserved the existing Patient 360 response shape; no database migration or reset was performed.
- Kept the compiled API `dist` files synchronized with the source repair.
- Added a defensive user-facing AI formatting boundary so structured JSON cannot leak into the clinician conversation even if a provider returns structured content unexpectedly.
- Strengthened the AI safety wording around hidden reasoning and autonomous clinical actions without changing the AI provider architecture.
- Fixed Patient 360 journey navigation so Check-in maps to the existing `queue` module and added a human-readable journey/timeline error state instead of silently failing.
- Verified the live Neon schema read-only; no schema changes were made.
- Verified the corrected Patient 360 follow-up and clinical-alert queries against the production schema and sample patient records.
- Passed the V6/V8/V9/V10/V11/V12/V13/V14/V15/V16/V17 structural and AI audits, public-release audit, and security/scope audit.

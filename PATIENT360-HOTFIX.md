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

## 2026-09-13 intelligence expansion

- Added deterministic cross-module patient intelligence without replacing the existing multi-model AI architecture.
- Patient context now includes laboratory results, imaging studies, appointments, admissions, chronic care, telemedicine, remote monitoring and clinical alerts/care gaps in addition to the existing modules.
- Added review signals for order/result gaps, imaging gaps, appointment/encounter gaps, delayed referrals, overdue follow-up, priority tasks, medication/allergy overlap and duplicate medication review.
- Added longitudinal observation change detection and a source evidence index for cross-checkable AI answers.
- Added authenticated patient cross-check endpoint and clinician AI feedback endpoint.
- Added public anonymous feedback and a public health-information assistant with explicit separation from patient/facility records.
- Expanded the Python deterministic intelligence engine with additional analytics and screening operations.
- Added additive `ai_feedback` and `public_feedback` persistence only; no patient rows were deleted or reset.
- Updated the 10 QA patients with the generic phone `0703000000` and synthetic region/district addresses spanning Central, Eastern, Western, Northern, West Nile, Teso and Karamoja. Original non-QA patients were not modified.
- Footer/contact information was intentionally left unchanged.

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

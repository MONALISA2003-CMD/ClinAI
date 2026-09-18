# ClinAI Domain Restoration and Public Writable Architecture

## Purpose
ClinAI must behave as a connected healthcare operating platform, not a read-only demo. Public review remains synthetic-only, but the synthetic workspace is writable and isolated.

## Source of truth
For modules with authoritative PostgreSQL domain tables, the UI reads and writes those tables through the authoritative domain adapter or an existing specialised workflow route. `module_records` is retained for flexible projections and legacy workflow records, not as the primary source for serious clinical domains.

## Synthetic coverage isolation
Migration 025 and earlier synthetic coverage populated 2,340 generic `module_records` rows with `recordPurpose=connected synthetic testing`. Those rows are preserved, not deleted, but operational module reads exclude them. A live view `clinai_live_module_records` was added for the same rule.

Live Neon verification on 2026-09-18:
- total `module_records`: 2,401
- hidden synthetic coverage placeholders: 2,340
- operational module records: 61
- synthetic TEST patients: 30
- authoritative table registry used by the domain adapter: 61 tables, all present

## Writable architecture
The public synthetic session receives a short-lived token with `publicSynthetic=true`. Write authorization accepts that synthetic role while retaining the normal organization and patient boundary checks. New public patients are marked `is_test_data=true`; related patient operations are restricted to synthetic patients.

Each domain form is validated in the frontend and again in the backend. Required fields reject blank values, dates/numbers/UUIDs are type checked, enumerated values are constrained, and key patient/encounter relationships are checked before insert. Database constraints remain the final persistence boundary.

## Domain field coverage
The module contract catalog now contains 80 module contracts and 561 field definitions. Six modules are intentionally dashboard/intelligence workspaces rather than fake CRUD surfaces:
- Command Center
- District Intelligence
- Patient 360 Intelligence
- Clinical Velocity
- Value Based Care
- AI Governance

The other advertised data modules have domain fields and explicit create/read behavior.

## UI/UX direction
Forms are grouped into clinical sections instead of flat generic fields. UUID relationships that can be resolved from the current workspace use record selectors where available. JSON is presented as structured information input rather than raw internal implementation. Every module receives a data-derived dashboard strip showing records, linked patients, active work, priority signals and latest activity.

The design follows health IT usability guidance emphasizing patient-centered workflows, safe patient identification, clear information presentation, interoperability, and reducing unnecessary clinician burden. See ONC Health IT implementation and usability guidance.

## Verification performed
- module contract audit: passed
- full domain restoration audit: passed
- frontend/backend route audit: passed, no missing routes
- public writable domain audit: passed
- schema contract audit: passed
- responsive structural audit: passed
- Workstream 6 Vercel regression audit: passed
- Workstream 7/8 behavioral audit: passed
- frontend TSX parse audit: no TSX syntax errors; dependency/type packages were unavailable locally
- backend TypeScript parse audit: no TS syntax errors; dependency/type packages were unavailable locally
- Python intelligence syntax: passed
- live Neon authoritative table registry: 61/61 tables present
- live required-field spot checks: 0 violations for patients, appointments, encounters, orders, claims, inventory, care tasks and invoices

## Deployment boundary
The GitHub integration available to this workspace is read-only. The source ZIP is therefore verified locally but has not been pushed to GitHub and has not been rebuilt by Vercel or Render from this pass. Production deployment must be rebuilt from this source before claiming the deployed URL contains these changes.

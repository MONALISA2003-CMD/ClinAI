# ClinAI FHIR R4 Canonical Layer

## Status
Release 1 implementation step. Additive only.

## What changed
- Added a FHIR R4 CapabilityStatement at `/api/fhir/R4/metadata`.
- Added canonical `/api/fhir/R4/...` resource paths for the existing FHIR resource handlers.
- Preserved the existing `/api/fhir/...` routes and database model.
- No schema reset, table replacement, data rewrite, delete, truncate, or AI behavior change.

## Supported resource surface
- Patient
- Encounter
- Observation
- MedicationRequest
- ServiceRequest
- DiagnosticReport
- Immunization
- CarePlan
- Procedure
- MedicationAdministration
- Appointment

## Architecture rule
The existing ClinAI domain model remains the source of truth. FHIR is an interoperability representation and API contract, not a reason to replace the internal clinical model.

## Next safe step
Harden resource mapping and validation, then introduce the event/outbox layer before expanding into SMART on FHIR and CDS Hooks.

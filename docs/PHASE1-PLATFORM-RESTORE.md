# ClinAI Phase 1 Platform Restore

## Objective
Restore the complete ClinAI navigation and a usable Patient 360 entry point while preserving the Neon database and the public read-only security boundary.

## Implemented

1. Full public read-only module navigation remains available from the same ClinAI shell.
2. Public module reads use a dedicated synthetic-data endpoint and cannot write records.
3. Public Patients can open a real longitudinal Patient 360 response by `TEST-001` style patient number.
4. Patient 360 reads connected clinical records from Neon using the same patient identifier across modules.
5. Public Patient 360 is restricted to `is_test_data=true` records and the approved synthetic email domain.
6. Authenticated Patient 360 continues to use the organization-scoped endpoint.

## Patient 360 scope
Demographics, contacts, allergies, appointments, encounters, diagnoses, observations, notes, orders, medications, admissions, immunizations, chronic care, telemedicine, remote monitoring, care plans, referrals, follow-up, care tasks, clinical alerts, and a longitudinal timeline are returned where records exist.

## Safety boundary
Public reads never expose national identifiers, phone numbers, addresses, or other direct contact fields from the patient master record. Public routes do not accept clinical writes.

## Database integrity
No database reset, truncate, destructive deletion, or replacement was performed.

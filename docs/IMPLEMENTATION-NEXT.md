# ClinAI Implementation Pass: Connected Clinical Workflows

This build continues from the ClinAI Complete Platform Blueprint and the previous PostgreSQL clinical core.

## Implemented in this pass

1. Contextual UI actions for appointment check-in, queue transitions, note signing, laboratory verification/release, pharmacy dispensing, billing payment, task completion, referral sending and inpatient discharge.
2. Database-backed workflow transactions with audit records and outbox events.
3. PostgreSQL-backed global search across patients, encounters, appointments and orders.
4. Patient 360 view with demographics, contacts, emergency contacts, allergies, appointments, encounters, orders, diagnoses, observations, notes and notifications.
5. Clinical encounter workspace for SOAP notes, diagnoses and orders.
6. Laboratory sample creation from laboratory orders plus preliminary result entry and verification/release workflow.
7. Pharmacy dispensing supports optional inventory batch decrement with stock movement and insufficient-stock protection.
8. Billing payment remains transactional with outstanding-balance protection; insurance policies and claims now persist in PostgreSQL.
9. FHIR R4 endpoints expanded to Encounter, Observation, MedicationRequest, ServiceRequest and DiagnosticReport plus CapabilityStatement metadata.
10. PostgreSQL audit and outbox event reads.
11. AI gateway boundary persists AI interaction provenance and calls a separately configured AI service. The AI service remains review-gated and does not autonomously diagnose or treat.
12. Web shell includes a service worker and manifest for offline shell tolerance.
13. Inventory, suppliers, insurance, claims, notifications and documents read paths use PostgreSQL when configured.

## Important production boundary

This is an implementation build, not a declaration of clinical safety, regulatory compliance or production readiness for real patient data. Real deployment still requires clinical validation, privacy/security review, MFA, least privilege, provider integrations, backups/disaster recovery, interoperability conformance, AI evaluation/governance and local legal/regulatory review.

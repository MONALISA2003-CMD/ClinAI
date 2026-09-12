# ClinAI V5: Uganda-aware Patient 360 and FHIR research

## Research basis

ClinAI is being built as a Uganda-based healthcare platform that can also operate internationally. The V5 design therefore treats Uganda requirements as a first-class localization layer rather than a hard-coded replacement for international standards.

### Uganda Ministry of Health

The Uganda Ministry of Health's **Digital Health Architecture, Standards and Knowledge products (DH-ASK)** were published to standardise digitally enabled healthcare in Uganda. The architecture describes patients/clients, healthcare providers and managers, community/social-care practitioners, insurers, researchers and implementation partners as users of the digital health ecosystem. Its information layer includes a patient/client registry, facility registry, health-worker registry, terminology registry, shared patient records and health-management information. The architecture also identifies interoperability and security/privacy as cross-cutting concerns.

The Uganda **Health Information Exchange and Interoperability Guidelines** describe how national digital-health standards should be applied to strengthen information exchange across the health system.

Uganda's digital-health standards explicitly reference FHIR and HL7 messaging. The standards document states that FHIR/HL7 should support exchange of admission/discharge/transfer data, encounters and observations, treatments, prescriptions and dispensing, laboratory orders/results and appointment schedules.

The Ministry's newer **Health Ministry Strategic Plan II 2025/26–2029/30** and the **Uganda National Health Compact 2025–2030** provide the current strategic context for strengthening healthcare services and health-system capacity. ClinAI should therefore remain integration-ready instead of assuming that a private facility's database is the national source of truth.

### WHO SMART Guidelines

WHO SMART Guidelines are **Standards-based, Machine-readable, Adaptive, Requirements-based and Testable**. WHO's current SMART ecosystem includes Digital Adaptation Kits and FHIR implementation guidance for areas such as antenatal care, HIV, immunization and other health domains. WHO specifically describes localization to country policies, procedures and digital-health infrastructure as a required implementation step.

WHO also describes FHIR as an open healthcare data-exchange standard and highlights the importance of offline-capable Android implementations in resource-constrained settings. This supports ClinAI's longer-term offline/mobile strategy.

## V5 design decisions

### 1. PostgreSQL remains the clinical source of truth

Patient 360 aggregates the patient's longitudinal record from the relational clinical tables rather than storing a second duplicated clinical profile.

### 2. Patient identifiers are extensible

`patient_identifiers` supports multiple identifiers using a `system + value` model. The existing `patients.national_identifier` remains available for the core patient record, while the new table allows facility-specific, external and future national identifiers without redesigning the patient table.

ClinAI must not invent or claim a live Ugandan national identifier service. Actual national integrations require approved interfaces and credentials.

### 3. Patient 360 is longitudinal

The V5 Patient 360 endpoint aggregates:

- Identity and contact information
- Patient identifiers
- Emergency contacts
- Allergies
- Appointments
- Encounters
- Clinical observations
- Diagnoses
- Procedures
- Clinical orders
- Medications
- Dispensing
- Medication administration
- Care plans
- Referrals
- Follow-up tasks
- Clinical alerts
- Clinical notes
- Notifications
- Admissions
- Nursing
- Surgery
- Maternity
- Pediatrics
- Immunizations
- Chronic care
- Telemedicine
- Remote monitoring

### 4. FHIR R4 remains the interoperability boundary

V5 adds FHIR representations for:

- Patient
- Encounter
- Observation
- MedicationRequest
- DiagnosticReport
- ServiceRequest
- Immunization
- CarePlan
- Procedure
- MedicationAdministration
- Appointment

ServiceRequest also has a search endpoint scoped to the current organization and optionally a patient identifier.

### 5. Uganda localization is configuration, not clinical hard-coding

ClinAI exposes `/api/uganda/profile` as an explicit localization boundary. It records Uganda defaults such as UGX and `en-UG`, but it does not pretend that national HIE, facility registry or terminology services are already connected.

Clinical schedules, immunization policy, ANC protocols, pediatric decision support, chronic-care protocols and reporting rules should be governed and versioned through the governance layer after review by appropriate Ugandan clinical and health-information stakeholders.

## Safety and governance boundary

This implementation is software infrastructure. It does not certify clinical correctness, regulatory compliance, national interoperability conformance or approval for real patient data. Before production use, ClinAI requires clinical validation, privacy/security review, role-based access enforcement, appropriate consent controls, national/local protocol adaptation, interoperability conformance testing, backup/disaster recovery, and governed AI evaluation.

AI remains assistive. Diagnosis, treatment, prescribing, triage disposition and other high-impact clinical decisions require qualified human review.

## Sources

- Uganda Ministry of Health, Digital Health Architecture Vision for Uganda and DH-ASK materials.
- Uganda Ministry of Health, Health Information Exchange and Interoperability Guidelines.
- Uganda Ministry of Health, Guidelines for the Introduction of Digital Health Solutions and Innovations in Uganda.
- Uganda Ministry of Health, Health Ministry Strategic Plan II 2025/26–2029/30.
- Uganda Ministry of Health, Uganda National Health Compact 2025–2030.
- WHO SMART Guidelines and WHO FHIR-based SMART Guidelines materials.

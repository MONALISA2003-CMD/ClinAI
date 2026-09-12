# ClinAI V7 — Uganda Clinical Pathways, Reporting and Offline Execution

## Research basis

V7 was designed after reviewing current Uganda Ministry of Health digital-health material and the current WHO SMART Guidelines ecosystem. Uganda MoH’s Strategic Plan II (2025/26–2029/30) is the current strategic reference used here. Uganda’s 2023 digital-health introduction guideline, last modified in 2025, emphasizes interoperable and secure solutions integrated with the national health information environment.

WHO SMART Guidelines are currently published as standards-based, machine-readable, adaptive, requirements-based and testable content. The current SMART Base is FHIR R4 and was published as active on 2026-08-27. WHO’s published SMART catalogue includes ANC, HIV, TB, child health, immunization, postnatal care, pregnancy blood-pressure self-monitoring and infectious-disease surveillance.

## V7 implementation

### Clinical pathways
- Pathway enrollment per patient and encounter.
- Ordered pathway steps.
- Step execution and completion state.
- Structured clinical facts and results.
- Rule references to versioned clinical guideline rules.
- Declarative rule evaluator supporting all/any and common comparisons.
- Audit trail for pathway execution.
- No protocol is treated as clinically authoritative merely because it is stored in the system.

### Uganda domains prepared
- Antenatal care
- Postnatal care
- Child health
- Immunization
- HIV
- Tuberculosis
- Infectious-disease surveillance

The application does not hard-code national treatment schedules. Clinical content must be loaded from approved, versioned Ugandan or adopted guideline sources through governance.

### Reporting
- Uganda reporting-system mapping records.
- Indicator metadata and source references.
- Reporting submission staging.
- Period-based submissions.
- External-reference/error fields for later approved integrations.
- No claim of live national submission.

### Offline
- Device registration.
- Operation identifiers for idempotent synchronization.
- Push queue.
- Pull queue.
- Acknowledgement/conflict state.
- Device last-seen and sync metadata.

WHO’s current guidance on FHIR-based SMART Guidelines specifically describes offline Android use cases and local storage, search and sync APIs. ClinAI therefore treats offline execution as a first-class capability rather than a later UI feature.

## Production boundary

Before live clinical use, each pathway and decision-support rule requires qualified clinical review, national/local policy adaptation, terminology validation, usability testing, security/privacy assessment, interoperability conformance testing and operational approval.

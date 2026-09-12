# ClinAI V11 — Uganda Population Health + Surveillance Intelligence

Research date: 2026-09-12

## Research basis

1. Uganda Ministry of Health's May 2026 Event-Based Surveillance Guidelines emphasize early detection, reporting, verification and response to public-health events, including community and facility reporting and a One Health approach.
2. Uganda Ministry of Health digital-health guidance emphasizes interoperable and secure digital solutions and reducing fragmented independent platforms.
3. Uganda health data access/sharing guidance emphasizes secure access, exchange and use of health data.
4. Uganda's current strategic direction calls for integrated national digital health data, early-warning capabilities, interoperability and expansion of electronic reporting.
5. WHO SMART DAK Surveillance v1.0.0 is the current published surveillance DAK as of 2026-03-23. It is based on FHIR R4 and provides structured workflows, core data elements, decision-support logic, indicators and functional/non-functional requirements.
6. WHO Surveillance DAK Volume 1 includes disease-agnostic content and disease-specific modules for cholera, measles, bacterial meningitis and yellow fever.

## V11 implementation boundary

ClinAI implements a software-neutral surveillance and population-health foundation. It does not assert that ClinAI is connected to Uganda's national surveillance systems, DHIS2, eCHIS, HMIS, national HIE or disease-specific notification endpoints.

Case definitions, thresholds, indicators and reporting mappings remain versioned and source-linked. The system stores surveillance observations and investigation data without autonomously declaring a public-health outbreak.

## Population-health model

Patient-level Care Graph -> Cohort membership -> Population indicators -> Surveillance events/cases -> Reporting/interoperability adapters.

## Governance

- Public-health decisions remain under authorized surveillance/public-health personnel.
- AI may summarize, prioritize and detect data patterns but does not autonomously confirm a disease or outbreak.
- National reporting should only be enabled after approved endpoints, credentials, mappings and conformance testing exist.
- Disease-specific logic must reference an approved case-definition version.

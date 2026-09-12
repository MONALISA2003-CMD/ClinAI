# ClinAI V6 Research Basis: Uganda Clinical Interoperability and Governance

## Research date
12 September 2026

## Design principle
ClinAI is Uganda-based and must be able to operate in Uganda without pretending that a national integration already exists. National interfaces are therefore represented as governed adapters and queues, with explicit disabled/not-connected states until approved endpoints, credentials, contracts and conformance tests are available.

## Primary Uganda sources
1. Uganda Ministry of Health, **Health Ministry Strategic Plan II 2025/26-2029/30**, published 1 February 2026 and last modified 21 May 2026.
2. Uganda Ministry of Health, **Digital Health Architecture, Standards and Knowledge products (DH-ASK)**, April 2024.
3. Uganda Ministry of Health, **Compendium of the National Digital Health Guidelines**, September 2024.
4. Uganda Ministry of Health, **Health Information Exchange and Interoperability Guidelines**, 2023, last modified June 2025.
5. Uganda Ministry of Health, **Guidelines for the Implementation of Electronic Medical Records Systems**, 2024.
6. Uganda Ministry of Health, **Antenatal Care Service**, June 2025.
7. Uganda Ministry of Health, **Essential Maternal & Neonatal Care Clinical Guidelines**, August 2022.

## Current WHO/SMART research used
1. WHO SMART Guidelines programme, current material checked September 2026.
2. WHO SMART Base FHIR R4 v1.0.0, active 27 August 2026.
3. WHO Immunization Digital Adaptation Kit / SMART DAK IMMZ v1.1.0, FHIR R4, active 6 March 2025.
4. WHO SMART Guidelines catalogue, updated November 2025.
5. WHO Digital Adaptation Kit for immunizations, published 27 January 2025.
6. WHO Digital Adaptation Kit for postnatal care, published July 2025.
7. WHO Digital Adaptation Kit for self-monitoring blood pressure during pregnancy, published July 2025.
8. WHO Digital Adaptation Kit for infectious disease surveillance, published March 2026.
9. WHO Android FHIR/SMART work for offline-capable health applications.

## What the research means for ClinAI

### 1. Uganda is the jurisdictional configuration, not a cosmetic locale
The platform uses UG as a first-class jurisdiction. Currency and locale are useful defaults, but the important localization layer is governed clinical content, identifiers, facility/health-worker metadata, reporting mappings and interoperability adapters.

### 2. Clinical guidance must be versioned and adaptable
WHO SMART Guidelines explicitly use Standards-based, Machine-readable, Adaptive, Requirements-based and Testable components. ClinAI therefore adds a guideline registry, rule registry, care pathways and pathway steps. The database does not hard-code national treatment algorithms into application code.

### 3. FHIR remains the interoperability foundation
WHO's current SMART Base is based on FHIR R4. ClinAI continues its FHIR R4 implementation and adds an integration boundary for national/external systems rather than inventing proprietary patient exchange formats.

### 4. Offline operation is a first-class requirement
WHO notes that a significant share of digital health delivery in low-resource contexts occurs offline on Android devices and describes local storage, data access and sync APIs in its Android FHIR work. ClinAI therefore adds an offline synchronization queue with operation IDs, base versions and explicit conflict states.

### 5. Immunization schedules must not be frozen in code
The 2025 WHO immunization DAK provides data elements, scheduling/decision-support logic, indicators and system requirements, while its implementation guidance says country programmes need adaptation. ClinAI stores immunization schedule rules with jurisdiction, effective dates and source guideline references. Uganda's approved schedule should be loaded through governance rather than guessed from a global schedule.

### 6. National HIE integration must be an adapter boundary
Uganda's HIE/interoperability guidance exists to strengthen information exchange in the national health services network. ClinAI therefore models HIE connections, outbound/inbound messages, correlation IDs, attempts, errors and delivery state. It deliberately does not claim a live national HIE connection.

### 7. Health worker and facility identity matter
ClinAI adds facility identifiers and health-worker profiles with cadre, profession, registration system/number, specialty, facility and verification status. This makes the system capable of mapping to approved external registries without embedding unverified identifiers.

### 8. Terminology is governed data
ClinAI adds a terminology registry so local, national and international codes can be versioned and mapped. This is safer than scattering diagnosis, laboratory, immunization and reporting codes throughout UI source code.

### 9. Reporting is mapped, not improvised
ClinAI adds reporting mappings with numerator/denominator query metadata, indicator codes, jurisdiction and version. External reporting submission is not enabled until the target system's approved interface and conformance requirements are known.

## Research-to-implementation matrix

| Research finding | ClinAI V6 implementation |
|---|---|
| Uganda HIE/interoperability guidance | `hie_connections`, `hie_messages` |
| Uganda digital-health standardization | governance + terminology + adapters |
| 2026 Uganda MoH strategic direction | Uganda architecture metadata and extensible reporting layer |
| WHO SMART Guidelines | `clinical_guidelines`, `clinical_guideline_rules`, `care_pathways`, `care_pathway_steps` |
| WHO FHIR R4 | existing FHIR API + V6 integration boundary |
| WHO immunization DAK | `immunization_schedule_rules` |
| Offline Android/FHIR direction | `offline_sync_queue` |
| Facility/worker identity | `facility_identifiers`, `health_worker_profiles` |
| Reporting interoperability | `reporting_mappings` |

## Safety and governance boundary
No V6 rule should be treated as a clinical protocol merely because it is stored in the database. A rule becomes active only after the responsible clinical/governance authority has reviewed its source, version, effective dates, terminology, workflow, decision-support logic and test cases.

AI remains assistive. It must not autonomously diagnose, prescribe, triage, discharge or submit clinical decisions to external systems.

## Official source locations
- Uganda Ministry of Health Knowledge Management Portal: https://library.health.go.ug/
- Uganda HIE and Interoperability Guidelines: https://library.health.go.ug/node/1671
- Uganda EMR Guidelines: https://library.health.go.ug/index.php/health-information-systems/digital-health/guidelines-implementation-electronic-medical-records
- Uganda MoH Strategic Plan II 2025/26-2029/30: https://library.health.go.ug/monitoring-and-evaluation/strategic-plan/health-ministry-strategic-plan-ii-202526-202930
- WHO SMART Guidelines: https://www.who.int/teams/digital-health-and-innovation/smart-guidelines
- WHO SMART Base: https://smart.who.int/base/1.0.0/index.html
- WHO SMART Immunization DAK: https://smart.who.int/dak-immz/
- WHO Immunization DAK publication: https://www.who.int/publications/i/item/9789240099456

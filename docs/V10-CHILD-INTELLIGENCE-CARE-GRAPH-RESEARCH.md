# ClinAI V10 Research: Child Intelligence, Care Gaps, Immunization Catch-up and Longitudinal Care Graph

Research date: 2026-09-12

## Research basis

WHO SMART Guidelines describe a standards-based, machine-readable, adaptive, requirements-based and testable approach for converting recommendations into digital systems. WHO's child-health DAK explicitly includes workflows, core data elements, decision-support logic, indicators and system requirements, while noting that generic content must be contextualized to local policy. The immunization DAK similarly provides structured workflows, data elements, decision support and requirements for person-centred immunization systems.

Primary references:
- WHO SMART Guidelines: https://www.who.int/teams/digital-health-and-innovation/smart-guidelines
- WHO child health DAK, 0-59 months in humanitarian emergencies: https://www.who.int/publications/i/item/9789240089907
- WHO immunization DAK, 2025: https://www.who.int/publications/i/item/9789240099456
- WHO SMART Base v1.0.0, FHIR R4: https://smart.who.int/base/1.0.0/index.html
- WHO birth defects surveillance DAK, 2025: https://www.who.int/publications/i/item/9789240110250

## Implementation decisions

1. Growth intelligence is trajectory-aware but does not fabricate clinical z-scores. Stored z-scores are clinician/system supplied and source-linked.
2. Care-gap detection identifies operational gaps from recorded data. It does not diagnose disease.
3. Immunization catch-up plans are persisted as draft plans and explicitly require clinician review.
4. The Care Graph connects longitudinal maternal, birth, newborn, postnatal, child, growth, IMCI, immunization and referral events without replacing the underlying clinical records.
5. Uganda remains the first-class jurisdiction, while the structures remain adaptable to other countries.
6. Clinical rules remain versioned and source-linked; no autonomous diagnosis or treatment is introduced.

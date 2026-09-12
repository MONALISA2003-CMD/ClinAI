# ClinAI V8: Uganda maternal, newborn and postnatal research basis

## Current sources reviewed 2026-09-12
- Uganda Ministry of Health, **Antenatal Care Service Edited version**, published 25 Jun 2025 and last modified 25 Mar 2026.
- Uganda Ministry of Health, **Essential Maternal & Neonatal Care Clinical Guidelines**, publication record 1 Aug 2022, last modified 23 Oct 2024.
- Uganda Ministry of Health, **Goal Oriented ANC Protocol**, minimum eight contacts for uncomplicated pregnancy.
- WHO, **Digital Adaptation Kit for Antenatal Care**, 2021.
- WHO, **Toolkit for adaptation of the WHO recommendations for a positive pregnancy and postnatal experience**, 2025.
- WHO, **Digital Adaptation Kit for Postnatal Care**, 6 Jul 2025.
- WHO SMART catalogue and **SMART Base v1.0.0**, active 27 Aug 2026, FHIR R4.
- WHO, **Digital Adaptation Kit for birth defects surveillance**, 15 Jun 2025.

## Design decisions
1. Uganda national content is the country-specific source of truth where an approved national source exists.
2. WHO SMART DAKs provide the computable structure and generic evidence basis, not permission to replace Uganda policy.
3. Clinical rules remain versioned and source-linked.
4. No medication dosing or autonomous diagnosis is embedded by this layer.
5. Referral, danger-sign and treatment decisions remain clinician-governed and configurable.
6. PNC records cover both mother and newborn because the WHO PNC DAK is explicitly person-centred and includes maternal, newborn/infant and family workflows.
7. Birth-defect screening is represented as structured data and surveillance-ready content, not as an autonomous diagnostic classifier.
8. FHIR R4 remains the interoperability baseline through the current WHO SMART Base.

## Uganda-specific observations
The current MoH ANC material explicitly describes at least eight contacts for uncomplicated pregnancy and emphasizes early booking, routine assessment and danger-sign recognition. The 2025 MoH publication is therefore the preferred source reference for the V8 ANC workflow. The older goal-oriented protocol remains useful as a provenance reference but should not silently override newer national material.

## Implementation boundary
This is a clinical software implementation layer, not a clinical validation claim. Before live patient use, each pathway must be reviewed and approved by the responsible Ugandan clinical governance authority and adapted to the facility level, national policy version, staffing model, referral network and approved medicines/diagnostics.

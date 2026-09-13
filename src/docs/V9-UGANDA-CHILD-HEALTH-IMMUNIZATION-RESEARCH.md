# ClinAI V9: Uganda Child Health, Growth, IMCI and Immunization Continuity

Research date: 2026-09-12

## Evidence base

### Uganda national sources
- Uganda National IMNCI Chart Booklet, Ministry of Health, published 2020 and last modified 2024. It describes urgent attention for children with general danger signs and integrates assessment of common childhood illness, immunization status and feeding for children under two.
- Uganda Clinical Guidelines 2023, Chapter 17: Childhood Illness. Used as a national clinical reference layer. ClinAI stores the source identifier and does not hard-code treatment or dosing decisions from the document.
- Uganda Routine Immunization Schedule, Ministry of Health, created and last updated 2025-11-06.
- Uganda Media Brief on Routine Immunization Services 2026, Ministry of Health, created 2026-01-27 and last updated 2026-02-04.

### WHO digital standards
- WHO SMART DAK Immunizations v1.1.0 is the current published immunization SMART DAK and is based on FHIR R4. It defines structured data, workflows, decision-support and indicator requirements, while the L3 FHIR implementation guide is not yet published.
- WHO SMART Guidelines explicitly require country adaptation. ClinAI therefore treats Uganda sources as the jurisdictional authority for Uganda workflows and WHO SMART material as the interoperability and digital-implementation reference.
- WHO child-health SMART material located during research is focused on child health in humanitarian emergencies. It is not treated as a replacement for Uganda routine child-health guidance.

## V9 implementation boundary

ClinAI now provides infrastructure for:
- longitudinal child health visits
- growth measurements and storage of standardized z-score payloads
- structured IMCI assessment domains
- immunization history continuity
- configurable immunization schedule rules
- due/overdue immunization evaluation from configured schedule rules
- immunization review snapshots
- source-linked clinical content

The system does not autonomously diagnose, prescribe, calculate medication doses, or replace clinician review.

## Continuum

Pregnancy → Birth → Newborn → Postnatal Care → Child Health Visit → Growth → IMCI → Immunization Review → Referral → Patient 360

## Important implementation principle

The immunization engine intentionally evaluates configured `immunization_schedule_rules`. It does not invent a Uganda vaccine schedule in application code. The Uganda schedule must be loaded and versioned from the approved national source before a facility treats the due-status output as operational clinical guidance.

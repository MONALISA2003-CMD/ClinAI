# ClinAI V15 Platform Completion Research

## Design basis
ClinAI is implemented around a connected patient journey rather than isolated CRUD screens. The primary journey remains registration, check-in, queue, triage, care visit, orders, results, treatment, pharmacy, billing, discharge, follow-up and monitoring.

The platform blueprint requires PostgreSQL as the clinical source of truth, FHIR as the interoperability contract, Google Cloud healthcare services as the long-term healthcare integration layer, Firebase for selected identity and messaging capabilities, and a separate safety-controlled AI layer.

## Standards used for V15

### WHO SMART Guidelines
WHO describes SMART Guidelines as Standards-based, Machine-readable, Adaptive, Requirements-based and Testable. The current WHO SMART Base release is based on FHIR R4 and is active as of 2026-08-27.

ClinAI V15 therefore strengthens:
- standards-oriented clinical data structures
- explicit workflow states
- computable indicators and analytics surfaces
- guideline and terminology modules
- testable workflow boundaries
- human review for clinical AI output

Source: https://www.who.int/teams/digital-health-and-innovation/smart-guidelines
Source: https://smart.who.int/base/1.0.0/

### FHIR
HL7 defines FHIR as a standard for exchanging healthcare data. ClinAI keeps its internal PostgreSQL model independent from FHIR while exposing a mapping/interoperability layer.

Source: https://www.hl7.org/fhir/R4/

### Google Cloud Healthcare API
Google Cloud Healthcare API supports managed FHIR, HL7v2 and DICOM stores. ClinAI keeps these as interoperability adapters rather than making the transactional PostgreSQL model depend directly on an external healthcare datastore.

Source: https://cloud.google.com/healthcare-api

## V15 implementation priorities

1. Command Center analytics now combines operational, clinical, financial and facility signals.
2. Role-focused dashboard views are provided for leadership, doctors, nurses and pharmacists.
3. Seven-day activity trends are surfaced without requiring a separate analytics page.
4. Patient merge lineage is retained through patient aliases and merge audit history, with controlled re-parenting attempts across patient-linked tables.
5. Walk-in check-in and queue queries respect the actual queue data model instead of assuming an organization_id column directly on queue entries.
6. Web offline operations are queued in IndexedDB and retried when connectivity returns.
7. Responsive dashboard layouts reorganize for tablet and phone rather than simply shrinking desktop layouts.

## Clinical safety boundary
AI remains assistive. The platform does not automatically prescribe, diagnose, dispense or otherwise execute a clinical decision solely because an AI model generated a suggestion. Clinicians retain responsibility for approval and action.

## Uganda-first context
The existing ClinAI research and implementation lineage includes Uganda facility, district, public-health, maternal, newborn, child-health, immunization, surveillance, interoperability and reporting workflows. V15 builds on those surfaces rather than replacing them with a generic international-only model.

# ClinAI V13 Research: Facility Operations + District Health Intelligence

Research date: 2026-09-12.

## Basis

ClinAI V13 is designed around Uganda-first facility and district operations while remaining standards-ready for international deployment.

### WHO SMART / FHIR
WHO SMART Guidelines are standards-based, machine-readable, adaptive, requirements-based and testable. WHO states that digital systems should be localized to country policies and should support interoperability across care pathways, facilities and providers. SMART Base v1.0.0 is based on FHIR R4 and is active as of 2026-08-27.

Relevant WHO digital-health classifications include assessing health facilities, data collection/management/use, data synthesis and visualization, location mapping for facilities and health events, and data exchange/interoperability.

### Facility and district data use
WHO's 2023 toolkit for routine health facility data promotes integrated, standards-based analysis using standardized core indicators, data-quality review, facility-level and district-level analysis, and dashboards.

## V13 implementation principles

1. Facility operational state is separate from clinical patient records.
2. Capacity, resource status, workforce and incidents are time-stamped observations.
3. Districts are organization-scoped and can link multiple facilities.
4. Referral network relationships are explicit rather than inferred.
5. Performance indicators preserve numerator, denominator, period and quality status.
6. ClinAI does not infer national facility capacity without observed or imported data.
7. National facility-registry and district-system integrations remain adapter-ready and are not claimed to be connected.
8. Operational intelligence supports managers and authorized responders; it does not autonomously make clinical or public-health decisions.

## New persistence

- districts
- district_facility_links
- facility_service_capacity
- facility_resource_status
- workforce_capacity_snapshots
- facility_operational_incidents
- facility_performance_snapshots
- referral_network_nodes

## Main workflows

Facility -> Service capacity -> Resource availability -> Workforce -> Operational incident -> Referral network -> District intelligence -> Performance indicator.

## Sources

- WHO SMART Guidelines
- WHO SMART Base v1.0.0
- WHO Toolkit for analysis and use of routine health facility data: integrated health services analysis: district and facility level
- WHO digital health system-strengthening guidance

This document describes software architecture and does not establish clinical policy, national reporting requirements, or regulatory certification.

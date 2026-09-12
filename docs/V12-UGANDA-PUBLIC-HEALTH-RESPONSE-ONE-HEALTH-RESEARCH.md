# ClinAI V12 — Uganda Public Health Response + One Health Research

Research date: 2026-09-12

## Uganda source

Uganda Ministry of Health, **Event-Based Surveillance Guidelines for Uganda, May 2026**. The Ministry describes the guidance as supporting early detection, reporting, verification and response to public-health events, with community and facility reporting, coordinated stakeholder action and a One Health approach.

## WHO source

WHO SMART DAK Surveillance v1.0.0 is the current published surveillance DAK and is based on FHIR R4. It structures surveillance workflows, data elements, decision-support logic and indicators. The WHO publication states that the L3 FHIR implementation guide, L4 executable reference implementation and L5 dynamic implementation are not yet published.

WHO SMART Base v1.0.0 also describes a public-health and disease-surveillance system capable of detecting, monitoring, investigating and responding to outbreaks and public-health threats, including event notification, population alerts, geographic mapping, outbreak-response visualization and automated analysis.

## V12 implementation

ClinAI now models:

- public-health investigations
- investigation verification and findings
- exposure/contact records
- response tasks
- escalation levels
- public-health alerts requiring review
- mortality surveillance
- maternal and neonatal mortality flags
- response dashboard

## Governance

ClinAI does not autonomously declare an outbreak, confirm a public-health event, or issue clinical/public-health orders. Alerts are reviewable records and response tasks default to `requires_human_approval=true`.

National reporting integrations remain adapter-ready rather than falsely represented as connected. Actual integration requires approved endpoints, credentials, data-sharing arrangements, mappings and conformance testing.

# ClinAI 22-workstream implementation map

1. Core clinical: patients, registration, appointments, queues, triage, encounters, notes, diagnoses, orders.
2. Laboratory: order routing, result workflow and critical-result task/notification path.
3. Pharmacy: prescription routing, dispensing event and inventory deduction event.
4. Inventory/procurement: inventory resources, stock movement records and procurement workspace.
5. Billing/insurance: billing, payment, insurance and claim resources plus payment workflow.
6. Hospital: emergency, inpatient, beds, nursing, surgery, maternity and pediatrics workspaces.
7. Imaging: order routing and imaging worklist resource.
8. Patient ecosystem: portal, notifications, telemedicine and remote monitoring boundaries.
9. Communications: notification resources and channel-ready event payloads.
10. AI: governed AI boundary with review-required output contract.
11. Python intelligence: FastAPI service boundary for future ML/NLP/risk/forecasting services.
12. Interoperability: dedicated module boundary for FHIR, HL7v2, DICOM and DHIS2 adapters.
13. Security/governance: protected API, organization context, audit events and explicit AI approval status.
14. Offline: architecture remains ready for client-side queue/sync implementation; production sync needs IndexedDB/SQLite and conflict policy.
15. Workflow engine: named transactional workflow endpoints with chained side effects.
16. Clinical governance: configurable module resources provide the administrative surface; clinical policy content remains facility-configured.
17. Analytics: dashboard metrics and analytics/population-health resources.
18. Enterprise: organization/facility/staff resources and organization-scoped records.
19. UI/UX: responsive command center and all major workspaces represented in the navigation.
20. Production engineering: Docker, service separation, environment config and deployment boundaries.
21. Testing: implementation checklist and testable API boundaries; full clinical test suite should be run in CI before release.
22. Deployment: Docker Compose local environment plus cloud-ready service boundaries.

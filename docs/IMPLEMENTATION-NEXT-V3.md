# ClinAI Next V3

Implemented the next platform layer on top of Connected Workflows V2.

## Included
- Clinical governance resources: forms, order sets, protocols, workflow rules and terminology definitions.
- Care-gap tracking and resolution.
- Clinical alert records with severity and deterministic CDS evaluation endpoint.
- Consent-aware patient communication queue for in-app, SMS, email, WhatsApp and push channels.
- Operations analytics endpoint backed by PostgreSQL.
- Expanded audit coverage for governance, alerts, messages and care-gap resolution.
- Deterministic CDS kept separate from generative AI. AI remains clinician-assistive and requires human review for consequential clinical actions.

## Endpoints
- GET/POST `/api/governance/:kind`
- GET/POST `/api/care-gaps`
- POST `/api/care-gaps/:id/resolve`
- GET/POST `/api/alerts`
- POST `/api/cds/evaluate`
- GET/POST `/api/messages`
- GET `/api/analytics/operations`

This layer follows the blueprint's governance, workflow, task, escalation, communication, CDS and analytics direction.

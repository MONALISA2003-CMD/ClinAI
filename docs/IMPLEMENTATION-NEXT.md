# ClinAI implementation pass

This pass hardens the application boundary and adds:

- organization-aware record reads/writes
- role-gated mutations
- PostgreSQL connectivity health check
- FHIR Patient read/search representations
- appointment check-in workflow
- clinical note signing guard
- lab verify -> release workflow
- task completion workflow
- reliability schema for idempotency and outbox events
- consent version governance schema
- audit indexes

## Production note
The JSON store remains available for local/demo development. PostgreSQL is the intended production persistence layer. The next migration step is to move the core write paths to transactional repositories and emit outbox events from those transactions.

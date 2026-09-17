# ClinAI V27 Cross-Module Intelligence and Governance

## Scope
V27 adds the cross-module intelligence layer discussed for ClinAI while preserving the existing EMR, CDSS and multi-model AI architecture.

## Implemented
- Clinical Context now carries cross-module intelligence derived from the longitudinal record.
- Patient 360 receives deterministic care gaps, risk signals and journey context from multiple clinical modules.
- Clinical velocity metrics are calculated from the existing workflow event platform.
- Value-based care intelligence exposes care-gap, coordination and outcome-oriented measures with CQL-compatible measurement definitions.
- AI capability registry, AI risk assessment storage, AI security event storage and value measure definitions are additive database objects.
- AI security events record blocked security/scope requests without storing the user's prompt.
- AI governance, risk and security read surfaces are available to authorized management roles.
- CDS Hooks discovery and service endpoints are added as a deterministic CDSS integration boundary. Generative AI is not invoked by CDS Hooks.
- Existing FHIR R4 compatibility routes remain the interoperability boundary. WHO SMART Guidelines, FHIR R4, CQL/FHIRPath, SMART on FHIR and CDS Hooks remain the standards spine.
- Six intelligence workspaces are added: Patient 360 Intelligence, Clinical Velocity, Value-Based Care, AI Risk Management, AI Security Management and AI Governance.
- Existing module read/create contracts remain intact.

## AI protection
The existing AI Router, provider routing, model registry, fallback behavior, prompt organization, response schema and multilingual policy were not replaced. The cross-module layer supplies better governed context and deterministic signals to the existing AI orchestration boundary.

## Database safety
Migration `database/migrations/022-clinai-cross-module-intelligence-governance.sql` is additive only. It uses `CREATE TABLE IF NOT EXISTS`, indexes, seed definitions and foreign keys. It does not reset, drop, truncate or delete clinical records.

## Standards positioning
WHO SMART Guidelines are designed as computable, interoperable clinical content on FHIR R4, with CQL and related implementation-guide artifacts. ClinAI V27 adds the architectural contracts and governed integration surfaces without claiming that a full external CQL execution engine or SMART authorization server has been installed. Those remain future standards-integration components when external deployment requirements demand them.

## Audit requirement
Before release, run:
- `node tests/v27-full-page-audit.mjs`
- `node tests/v26-module-contract-audit.mjs`
- `node tests/v26-ai-reliability-audit.mjs`
- `node tests/schema-contract-audit.mjs`
- TypeScript production build when dependencies are available
- ZIP integrity check with `unzip -t`

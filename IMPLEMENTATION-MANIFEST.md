ClinAI Workstream 2 implementation manifest

This archive contains the source snapshot after the Workstream 2 domain-depth implementation.

Implemented:
- additive database migration 026-workstream-2-domain-depth.sql
- integrity hardening migration 027-workstream-2-integrity-hardening.sql
- insurance eligibility and authorization workflows
- claim items and payer response workflow
- finance reconciliation workflow
- inventory receipt and low-stock derived views
- procurement approval, purchase order and receipt workflows
- supplier performance history
- Patient 360 finance and insurance context
- finance/payment to accounting and reconciliation integration
- pharmacy to inventory batch and stock-movement integration
- line-level purchase-order receipt controls
- authenticated domain workspaces for finance, insurance, claims, inventory, procurement and suppliers
- source-level Workstream 2 domain integrity audit
- implementation documentation

Live Neon verification was performed against the existing project/branch without resetting the database.

No deployment success is claimed by this manifest.

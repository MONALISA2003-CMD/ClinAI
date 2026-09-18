# ClinAI Workstream 2 Domain Depth Completion

Status: Implemented incrementally against the existing ClinAI source and Neon environment.

## Scope

This workstream deepens the non-clinical domain layer without replacing the existing clinical foundation.

### Insurance

- Insurance providers retain organization-scoped lifecycle data.
- Policies now support member number, effective dates, copay and annual limits.
- Eligibility checks are recorded against a real policy and patient.
- Service authorization requests can be recorded and decided.
- Claims retain patient, invoice, policy, amount and payer response context.
- Claim items connect claims to invoice items.
- Claim responses preserve payer decisions and reasons.

### Finance

- Invoice items are materialized from existing invoices where missing.
- Patient payments remain linked to invoices.
- Payment processing now creates a posted accounting entry and updates invoice-level finance reconciliation in the same transaction.
- Finance reconciliation records connect invoice, claim and payment state.
- Patient 360 now exposes invoices, paid amount, outstanding amount, claims and insurance policies.

### Inventory

- Inventory items support reorder quantity, unit cost, category and metadata.
- Inventory overview derives on-hand quantities from inventory batches.
- Receipt workflow updates the batch and records a stock movement in one transaction.
- Pharmacy dispensing resolves an inventory batch when possible, prevents over-dispensing, decrements stock, and records the stock movement before completing the dispense.
- Low-stock views are derived from reorder levels rather than decorative counts.

### Procurement

- Procurement requests connect to purchase orders.
- Purchase orders contain line items tied to inventory items.
- Approved requests can become issued purchase orders.
- Purchase order receipt updates inventory and procurement state transactionally.
- Receipt processing is line-aware, prevents over-receipt, supports partial receipt status, and updates `purchase_order_items.received_quantity`.

### Suppliers

- Suppliers support lifecycle/status and purchasing metadata.
- Supplier performance is derived from purchase order history.
- Performance snapshots record order volume, receipt activity and order value.

## Backend

New responsibility-based route module:

`services/api/src/routes/workstream2Domains.ts`

The existing `main.ts` registers this module without removing the existing routes.

## Database

New additive migration:

`database/migrations/026-workstream-2-domain-depth.sql`

Integrity hardening: `database/migrations/027-workstream-2-integrity-hardening.sql`

It is safe to apply to an existing deployment and does not reset, truncate or replace data.

## Verification

The following source-level audit is included:

`tests/workstream2-domain-integrity.mjs`

Verified live Neon relationships include:

- 30 invoice items
- 30 eligibility checks
- 30 claim items
- 30 finance reconciliations
- 1 purchase order line item
- 3 supplier performance snapshots
- 30 claims with patient, policy and invoice relationships
- 5 stock movements linked to inventory batches/items
- 1 purchase order linked to a procurement request

Additional source checks were run after the workflow integration changes. The static Workstream 2 audit passed. A full local TypeScript compilation was attempted. The environment did not have the repository's Node type definitions installed, and dependency installation timed out. Therefore this package does not claim a successful local production build from this environment.

## Architectural rule retained

`module_records` remains a projection/flexible-record mechanism. Core insurance, finance, inventory, procurement and supplier workflows use authoritative domain tables.

No authentication layer was added and the existing synthetic patient UUIDs were not replaced.

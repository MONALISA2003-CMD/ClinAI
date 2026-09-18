# ClinAI Public Writable Synthetic Workspace

## Purpose

The public ClinAI environment is a writable product-testing workspace, not a read-only demo. Public writes are isolated to the dedicated synthetic organization and are intended for synthetic test records only.

## Session boundary

`POST /api/public/test-session` creates a short-lived synthetic workspace session. The API only issues the session when the selected organization contains a dedicated synthetic patient population. The session carries a `publicSynthetic` claim and an administrator write role so the existing domain workflows can be exercised without asking an investor or reviewer to create an account.

Patients created through a public synthetic session are stored with `is_test_data=true`.

## Authoritative domain writes

The following public-testing create workflows use the authoritative database tables rather than generic `module_records` projections:

- Billing: invoices and invoice items
- Payments: existing payment workflow with accounting and reconciliation effects
- Insurance: policies and provider creation when needed
- Claims: claims linked to patients, policies and invoices
- Accounting: accounting entries
- Inventory: inventory items, optional opening batch and stock movement
- Procurement: procurement requests
- Suppliers: supplier master records

This keeps dashboards, Patient 360 and intelligence connected to the newly created records.

## Frontend behavior

The public workspace receives a synthetic session after the introductory disclaimer. The disclaimer remains visible, but forms are not disabled. Domain forms use the same contract-driven validation and writable workflows as the authenticated workspace.

Analytical workspaces remain analytical. Their calculated views are not converted into fake CRUD screens.

## Safety expectation

The public banner tells reviewers to use synthetic information. The server also enforces the synthetic workspace boundary. Public testing must never be treated as permission to enter real patient information.

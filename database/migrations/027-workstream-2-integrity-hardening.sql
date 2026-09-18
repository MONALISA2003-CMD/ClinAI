-- Workstream 2 integrity hardening. Additive and idempotent.
-- Prevent duplicate invoice-level reconciliation rows and duplicate payment ledger entries.
CREATE UNIQUE INDEX IF NOT EXISTS finance_reconciliation_invoice_claim_null_payment_uq
  ON finance_reconciliations(invoice_id,claim_id)
  WHERE payment_id IS NULL;

CREATE UNIQUE INDEX IF NOT EXISTS accounting_entries_reference_uq
  ON accounting_entries(organization_id,reference_type,reference_id,entry_type)
  WHERE reference_id IS NOT NULL;

COMMENT ON TABLE finance_reconciliations IS 'Connected invoice, insurance claim and payment reconciliation ledger.';
COMMENT ON TABLE purchase_order_items IS 'Line-level purchasing quantities including partial receipt tracking.';

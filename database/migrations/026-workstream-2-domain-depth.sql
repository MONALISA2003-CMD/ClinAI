-- ClinAI Workstream 2 domain depth and workflow integrity
-- Additive and idempotent. Never resets or replaces existing data.

CREATE TABLE IF NOT EXISTS insurance_eligibility_checks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  policy_id uuid NOT NULL REFERENCES insurance_policies(id) ON DELETE CASCADE,
  patient_id uuid NOT NULL REFERENCES patients(id) ON DELETE CASCADE,
  encounter_id uuid REFERENCES encounters(id) ON DELETE SET NULL,
  service_code text,
  status text NOT NULL DEFAULT 'pending',
  checked_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz,
  response jsonb NOT NULL DEFAULT '{}',
  created_by uuid REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_insurance_eligibility_patient ON insurance_eligibility_checks(organization_id,patient_id,checked_at DESC);
CREATE INDEX IF NOT EXISTS idx_insurance_eligibility_policy ON insurance_eligibility_checks(policy_id,checked_at DESC);

CREATE TABLE IF NOT EXISTS insurance_authorizations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  policy_id uuid NOT NULL REFERENCES insurance_policies(id) ON DELETE CASCADE,
  patient_id uuid NOT NULL REFERENCES patients(id) ON DELETE CASCADE,
  encounter_id uuid REFERENCES encounters(id) ON DELETE SET NULL,
  service_code text NOT NULL,
  requested_amount numeric NOT NULL DEFAULT 0,
  approved_amount numeric,
  status text NOT NULL DEFAULT 'requested',
  authorization_number text,
  requested_at timestamptz NOT NULL DEFAULT now(),
  decided_at timestamptz,
  response jsonb NOT NULL DEFAULT '{}',
  created_by uuid REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_insurance_auth_patient ON insurance_authorizations(organization_id,patient_id,requested_at DESC);
CREATE INDEX IF NOT EXISTS idx_insurance_auth_policy ON insurance_authorizations(policy_id,status);

CREATE TABLE IF NOT EXISTS claim_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  claim_id uuid NOT NULL REFERENCES claims(id) ON DELETE CASCADE,
  invoice_item_id uuid REFERENCES invoice_items(id) ON DELETE SET NULL,
  service_code text,
  description text NOT NULL,
  quantity numeric NOT NULL DEFAULT 1,
  unit_amount numeric NOT NULL DEFAULT 0,
  amount numeric NOT NULL DEFAULT 0,
  approved_amount numeric,
  status text NOT NULL DEFAULT 'submitted',
  metadata jsonb NOT NULL DEFAULT '{}',
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_claim_items_claim ON claim_items(claim_id);

CREATE TABLE IF NOT EXISTS claim_responses (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  claim_id uuid NOT NULL REFERENCES claims(id) ON DELETE CASCADE,
  response_type text NOT NULL,
  status text NOT NULL,
  payer_reference text,
  approved_amount numeric,
  rejected_amount numeric,
  reason text,
  payload jsonb NOT NULL DEFAULT '{}',
  received_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid REFERENCES users(id)
);
CREATE INDEX IF NOT EXISTS idx_claim_responses_claim ON claim_responses(claim_id,received_at DESC);

CREATE TABLE IF NOT EXISTS finance_reconciliations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  invoice_id uuid NOT NULL REFERENCES invoices(id) ON DELETE CASCADE,
  claim_id uuid REFERENCES claims(id) ON DELETE SET NULL,
  payment_id uuid REFERENCES payments(id) ON DELETE SET NULL,
  invoice_amount numeric NOT NULL DEFAULT 0,
  claimed_amount numeric NOT NULL DEFAULT 0,
  approved_amount numeric NOT NULL DEFAULT 0,
  paid_amount numeric NOT NULL DEFAULT 0,
  patient_responsibility numeric NOT NULL DEFAULT 0,
  status text NOT NULL DEFAULT 'open',
  notes jsonb NOT NULL DEFAULT '{}',
  reconciled_at timestamptz,
  created_by uuid REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(invoice_id,claim_id,payment_id)
);
CREATE INDEX IF NOT EXISTS idx_finance_reconciliation_org ON finance_reconciliations(organization_id,status,created_at DESC);
CREATE INDEX IF NOT EXISTS idx_finance_reconciliation_invoice ON finance_reconciliations(invoice_id);

CREATE TABLE IF NOT EXISTS purchase_order_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  purchase_order_id uuid NOT NULL REFERENCES purchase_orders(id) ON DELETE CASCADE,
  inventory_item_id uuid REFERENCES inventory_items(id) ON DELETE SET NULL,
  description text NOT NULL,
  quantity numeric NOT NULL DEFAULT 1,
  unit_price numeric NOT NULL DEFAULT 0,
  total numeric NOT NULL DEFAULT 0,
  received_quantity numeric NOT NULL DEFAULT 0,
  status text NOT NULL DEFAULT 'ordered',
  metadata jsonb NOT NULL DEFAULT '{}',
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_purchase_order_items_order ON purchase_order_items(purchase_order_id);
CREATE INDEX IF NOT EXISTS idx_purchase_order_items_inventory ON purchase_order_items(inventory_item_id);

CREATE TABLE IF NOT EXISTS supplier_performance_snapshots (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  supplier_id uuid NOT NULL REFERENCES suppliers(id) ON DELETE CASCADE,
  period_start date NOT NULL,
  period_end date NOT NULL,
  orders_count integer NOT NULL DEFAULT 0,
  issued_orders integer NOT NULL DEFAULT 0,
  received_orders integer NOT NULL DEFAULT 0,
  on_time_orders integer NOT NULL DEFAULT 0,
  discrepancy_count integer NOT NULL DEFAULT 0,
  total_order_value numeric NOT NULL DEFAULT 0,
  notes jsonb NOT NULL DEFAULT '{}',
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(supplier_id,period_start,period_end)
);
CREATE INDEX IF NOT EXISTS idx_supplier_performance_org ON supplier_performance_snapshots(organization_id,supplier_id,period_end DESC);

ALTER TABLE inventory_items ADD COLUMN IF NOT EXISTS reorder_quantity numeric NOT NULL DEFAULT 0;
ALTER TABLE inventory_items ADD COLUMN IF NOT EXISTS unit_cost numeric NOT NULL DEFAULT 0;
ALTER TABLE inventory_items ADD COLUMN IF NOT EXISTS category text;
ALTER TABLE inventory_items ADD COLUMN IF NOT EXISTS metadata jsonb NOT NULL DEFAULT '{}';
ALTER TABLE suppliers ADD COLUMN IF NOT EXISTS status text NOT NULL DEFAULT 'active';
ALTER TABLE suppliers ADD COLUMN IF NOT EXISTS category text;
ALTER TABLE suppliers ADD COLUMN IF NOT EXISTS payment_terms text;
ALTER TABLE suppliers ADD COLUMN IF NOT EXISTS metadata jsonb NOT NULL DEFAULT '{}';
ALTER TABLE insurance_providers ADD COLUMN IF NOT EXISTS status text NOT NULL DEFAULT 'active';
ALTER TABLE insurance_providers ADD COLUMN IF NOT EXISTS contact jsonb NOT NULL DEFAULT '{}';
ALTER TABLE insurance_policies ADD COLUMN IF NOT EXISTS member_number text;
ALTER TABLE insurance_policies ADD COLUMN IF NOT EXISTS effective_from date;
ALTER TABLE insurance_policies ADD COLUMN IF NOT EXISTS effective_to date;
ALTER TABLE insurance_policies ADD COLUMN IF NOT EXISTS copay_percent numeric NOT NULL DEFAULT 0;
ALTER TABLE insurance_policies ADD COLUMN IF NOT EXISTS annual_limit numeric;
ALTER TABLE claims ADD COLUMN IF NOT EXISTS claim_number text;
ALTER TABLE claims ADD COLUMN IF NOT EXISTS coverage_amount numeric;
ALTER TABLE claims ADD COLUMN IF NOT EXISTS patient_responsibility numeric NOT NULL DEFAULT 0;

UPDATE claims SET claim_number=COALESCE(claim_number,external_reference) WHERE claim_number IS NULL;
UPDATE insurance_policies SET member_number=COALESCE(member_number,policy_number) WHERE member_number IS NULL;

CREATE UNIQUE INDEX IF NOT EXISTS finance_reconciliation_invoice_claim_null_payment_uq ON finance_reconciliations(invoice_id,claim_id) WHERE payment_id IS NULL;
CREATE UNIQUE INDEX IF NOT EXISTS accounting_entries_reference_uq ON accounting_entries(organization_id,reference_type,reference_id,entry_type) WHERE reference_id IS NOT NULL;

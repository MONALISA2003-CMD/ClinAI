BEGIN;

ALTER TABLE insurance_policies ADD COLUMN IF NOT EXISTS organization_id uuid;
UPDATE insurance_policies ip SET organization_id=p.organization_id FROM patients p WHERE ip.organization_id IS NULL AND ip.patient_id=p.id;
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM insurance_policies WHERE organization_id IS NULL) THEN
    RAISE EXCEPTION 'insurance_policies organization backfill incomplete';
  END IF;
END $$;
ALTER TABLE insurance_policies ALTER COLUMN organization_id SET NOT NULL;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='insurance_policies_organization_id_fkey') THEN
    ALTER TABLE insurance_policies ADD CONSTRAINT insurance_policies_organization_id_fkey FOREIGN KEY (organization_id) REFERENCES organizations(id) ON DELETE CASCADE;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS insurance_policies_org_status_effective_idx ON insurance_policies (organization_id,status,effective_from DESC,effective_to);
CREATE INDEX IF NOT EXISTS insurance_policies_org_provider_idx ON insurance_policies (organization_id,provider_id,status);
CREATE INDEX IF NOT EXISTS invoices_org_status_created_idx ON invoices (organization_id,status,created_at DESC);
CREATE INDEX IF NOT EXISTS payments_invoice_status_paid_idx ON payments (invoice_id,status,paid_at DESC);
CREATE INDEX IF NOT EXISTS claims_patient_status_submitted_idx ON claims (patient_id,status,submitted_at DESC);
CREATE INDEX IF NOT EXISTS accounting_entries_org_date_status_idx ON accounting_entries (organization_id,entry_date DESC,status);
CREATE INDEX IF NOT EXISTS insurance_eligibility_org_status_checked_idx ON insurance_eligibility_checks (organization_id,status,checked_at DESC);
CREATE INDEX IF NOT EXISTS insurance_authorizations_org_status_requested_idx ON insurance_authorizations (organization_id,status,requested_at DESC);
CREATE INDEX IF NOT EXISTS inventory_items_org_active_category_idx ON inventory_items (organization_id,active,category);
CREATE INDEX IF NOT EXISTS inventory_batches_item_expiry_idx ON inventory_batches (item_id,expiry_date,quantity);
CREATE INDEX IF NOT EXISTS stock_movements_item_created_idx ON stock_movements (item_id,created_at DESC);
CREATE INDEX IF NOT EXISTS procurement_requests_org_status_requested_idx ON procurement_requests (organization_id,status,requested_at DESC);
CREATE INDEX IF NOT EXISTS purchase_orders_org_status_received_idx ON purchase_orders (organization_id,status,received_at DESC,created_at DESC);
CREATE INDEX IF NOT EXISTS purchase_order_items_order_status_idx ON purchase_order_items (purchase_order_id,status,received_quantity);
CREATE INDEX IF NOT EXISTS suppliers_org_status_category_idx ON suppliers (organization_id,status,category);
CREATE INDEX IF NOT EXISTS supplier_performance_org_supplier_period_idx ON supplier_performance_snapshots (organization_id,supplier_id,period_end DESC);
CREATE INDEX IF NOT EXISTS population_cohorts_org_status_idx ON population_cohorts (organization_id,status,updated_at DESC);
CREATE INDEX IF NOT EXISTS population_cohort_members_org_cohort_risk_idx ON population_cohort_members (organization_id,cohort_id,risk_level,status);
CREATE INDEX IF NOT EXISTS population_indicators_org_period_idx ON population_indicators (organization_id,period_end DESC,indicator_code);
CREATE INDEX IF NOT EXISTS surveillance_events_org_event_status_idx ON surveillance_events (organization_id,event_date DESC,case_status,severity);
CREATE INDEX IF NOT EXISTS surveillance_cases_org_status_updated_idx ON surveillance_cases (organization_id,status,updated_at DESC);
CREATE INDEX IF NOT EXISTS public_health_investigations_org_status_started_idx ON public_health_investigations (organization_id,status,started_at DESC);
CREATE INDEX IF NOT EXISTS public_health_response_tasks_org_status_due_idx ON public_health_response_tasks (organization_id,status,due_at);
CREATE INDEX IF NOT EXISTS mortality_surveillance_org_review_death_idx ON mortality_surveillance_records (organization_id,review_status,death_datetime DESC);
CREATE INDEX IF NOT EXISTS districts_org_status_region_idx ON districts (organization_id,status,region);
CREATE INDEX IF NOT EXISTS district_facility_links_org_district_facility_idx ON district_facility_links (organization_id,district_id,facility_id);
CREATE INDEX IF NOT EXISTS notifications_org_status_created_idx ON notifications (organization_id,status,created_at DESC);
CREATE INDEX IF NOT EXISTS documents_org_created_type_idx ON documents (organization_id,created_at DESC,document_type);

COMMIT;

import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const sql=await readFile(new URL('../database/migrations/026-workstream-2-domain-depth.sql',import.meta.url),'utf8');
for (const marker of ['insurance_eligibility_checks','insurance_authorizations','claim_items','claim_responses','finance_reconciliations','purchase_order_items','supplier_performance_snapshots']) assert(sql.includes(marker),`Missing ${marker}`);
const api=await readFile(new URL('../services/api/src/routes/workstream2Domains.ts',import.meta.url),'utf8');
for (const route of ['/api/domains/finance/overview','/api/domains/insurance/overview','/api/domains/insurance/eligibility','/api/domains/insurance/authorizations','/api/domains/claims','/api/domains/claims/:id/respond','/api/domains/inventory/overview','/api/domains/inventory/receive','/api/domains/procurement/overview','/api/domains/procurement/:id/approve','/api/domains/procurement/:id/purchase-order','/api/domains/purchase-orders/:id/receive','/api/domains/suppliers/:id/performance']) assert(api.includes(route),`Missing ${route}`);
assert(api.includes("status='received'"));
assert(api.includes("status='approved'"));
assert(api.includes('purchaseOrderItemId'));
const hardening=await readFile(new URL('../database/migrations/027-workstream-2-integrity-hardening.sql',import.meta.url),'utf8');
for (const marker of ['finance_reconciliation_invoice_claim_null_payment_uq','accounting_entries_reference_uq']) assert(hardening.includes(marker),`Missing ${marker}`);
const main=await readFile(new URL('../services/api/src/main.ts',import.meta.url),'utf8');
for (const marker of ['Patient payment received','Dispensing quantity exceeds the remaining prescribed quantity','stock_movements','finance_reconciliations']) assert(main.includes(marker),`Missing integrated workflow marker ${marker}`);
console.log('Workstream 2 domain integrity audit passed');

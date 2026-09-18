import fs from 'node:fs';
import assert from 'node:assert/strict';

const page=fs.readFileSync('apps/web/app/page.tsx','utf8');
const api=fs.readFileSync('services/api/src/routes/workstream2Domains.ts','utf8');

for (const marker of ['billing','insurance','claims','inventory','procurement','suppliers']) assert.ok(page.includes(`module==='${marker}'`),`Missing ${marker} domain workspace`);
for (const marker of ['payments:payments.rows','accounting:accounting.rows','claims:claims.rows','batches:batches.rows']) assert.ok(api.includes(marker),`Missing connected API payload: ${marker}`);
for (const marker of ['Patient 360','Batches','Approve','Create PO','Receive','Supplier performance','CLAIM DETAIL','ACCOUNTING']) assert.ok(page.includes(marker),`Missing Workstream 6 workflow/UI marker: ${marker}`);
assert.ok(page.includes('onHand'),'Inventory workspace must display computed on-hand quantity.');
assert.ok(page.includes('patientResponsibility'),'Insurance/claims workspace must surface patient responsibility.');
assert.ok(api.includes('finance_reconciliations'),'Finance backend must remain tied to reconciliation records.');
console.log('ClinAI Workstream 6 domain workspace audit passed');

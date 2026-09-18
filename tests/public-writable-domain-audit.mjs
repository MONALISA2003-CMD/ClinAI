import fs from 'node:fs';
import assert from 'node:assert/strict';
const main=fs.readFileSync('services/api/src/main.ts','utf8');
const domains=fs.readFileSync('services/api/src/routes/workstream2Domains.ts','utf8');
const page=fs.readFileSync('apps/web/app/page.tsx','utf8');
const contracts=JSON.parse(fs.readFileSync('packages/module-contracts/contracts.json','utf8'));
assert(main.includes("'/api/public/test-session'"),'Public test session is not exposed');
assert(main.includes("publicSynthetic:true"),'Public synthetic claim is missing');
assert(main.includes("is_test_data=true"),'Public session does not resolve synthetic data');
assert(main.includes('Boolean(req.user?.publicSynthetic)'),'Public-created patients are not marked synthetic');
for(const p of [
 '/api/domains/finance/invoices','/api/domains/finance/accounting','/api/domains/insurance/policies','/api/domains/claims','/api/domains/inventory/items','/api/domains/procurement/requests','/api/domains/procurement/suppliers'
]) assert(domains.includes(`app.post('${p}'`),`Missing authoritative write route: ${p}`);
for(const id of ['billing','payments','insurance','claims','accounting','inventory','procurement','suppliers']){
 const c=contracts.modules.find(x=>x.id===id);
 assert(c?.backend?.createEndpoint,`Missing create endpoint contract for ${id}`);
 assert((c.fields||[]).length>=3,`Insufficient domain fields for ${id}`);
}
assert(page.includes('enterPublicWorkspace'),'Frontend does not open the writable public session');
assert(page.includes('publicWorkspace={publicWorkspace}'),'Public workspace state is not passed to modules');
assert(page.includes('<Action module={module} token={token}'),'Domain create form is not rendered');
console.log('Public writable domain audit passed');

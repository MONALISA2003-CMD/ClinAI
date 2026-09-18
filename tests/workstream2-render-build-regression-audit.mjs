import fs from 'node:fs';
import assert from 'node:assert/strict';

const file = 'services/api/src/routes/workstream2Domains.ts';
const src = fs.readFileSync(file, 'utf8');

assert.match(src, /const \[summary,recent,recon,payments,accounting\]=await Promise\.all\(\[/, 'Finance overview must expose invoices, reconciliation, payments and accounting together.');
assert.doesNotMatch(src, /const \[summary,recent,recon\]=await Promise\.all\(\[/, 'Regression: finance overview must not drop connected finance records.');
assert.match(src, /return \{claimId:req\.params\.id,status:b\.status,response:response\.rows\[0\],reconciliationId\};/, 'Claim response must return the scoped reconciliationId.');
assert.doesNotMatch(src, /return \{claimId:req\.params\.id,status:b\.status,response:response\.rows\[0\],reconciliationId:rec\.rows\[0\]\?\.id\|\|null\};/, 'Regression: claim response must not reference out-of-scope rec.');

console.log('Workstream 2 Render build regression audit passed');

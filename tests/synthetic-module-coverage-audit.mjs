import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';

const root=process.cwd();
const contracts=JSON.parse(fs.readFileSync(path.join(root,'packages/module-contracts/contracts.json'),'utf8'));
const modules=contracts.modules.map(x=>x.id).filter(x=>x!=='command-center');
const migration=fs.readFileSync(path.join(root,'database/migrations/025-clinai-complete-synthetic-module-coverage.sql'),'utf8');
const page=fs.readFileSync(path.join(root,'apps/web/app/page.tsx'),'utf8');
assert.equal(modules.length,79,'Expected 79 non-aggregate workspaces');
assert.match(migration,/patients_30/);
assert.match(migration,/CROSS JOIN module_catalog/);
assert.match(migration,/coverageVersion.*025/);
assert.doesNotMatch(migration,/^\s*(DROP|TRUNCATE|DELETE)\b/im,'Synthetic coverage migration must be additive');
assert.doesNotMatch(page,/This area is available for review\. Changes are made from the workflow that manages these records\./);
assert.doesNotMatch(page,/MODULE_READ_ONLY/);
assert.match(page,/All 30 test patients/);
assert.match(page,/api\/public\/test-modules\/\$\{module\}/);
console.log(`Synthetic module coverage audit passed: ${modules.length} workspaces × TEST-001..TEST-030.`);

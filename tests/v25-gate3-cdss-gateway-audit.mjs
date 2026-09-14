import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const root = path.resolve(new URL('..', import.meta.url).pathname);
const gateway = fs.readFileSync(path.join(root, 'services/api/src/intelligence/cdssGateway.ts'), 'utf8');
const evaluator = fs.readFileSync(path.join(root, 'services/api/src/events/cdssEvaluator.ts'), 'utf8');
const worker = fs.readFileSync(path.join(root, 'services/api/src/events/clinicalEventWorker.ts'), 'utf8');
const main = fs.readFileSync(path.join(root, 'services/api/src/main.ts'), 'utf8');

for (const rule of ['clinai.critical-lab','clinai.low-spo2','clinai.severe-bp','clinai.medication-allergy-conflict']) {
  assert.match(gateway, new RegExp(rule.replaceAll('.', '\\.'), 'm'), `sync rule missing: ${rule}`);
}
assert.match(gateway, /evaluateClinicalEvent\(pool, event, \{ ruleScope \}\)/);
assert.match(gateway, /decision: 'ALLOW' \| 'WARN' \| 'REVIEW'/);
assert.match(gateway, /type EvaluationMode = 'sync' \| 'async'/);
assert.match(evaluator, /options\.ruleScope/);
assert.match(evaluator, /triggeredSignals/);
assert.match(worker, /evaluateClinicalContext\(pool, \{/);
assert.match(worker, /mode: 'async'/);
assert.match(main, /app\.post\('\/api\/cdss\/evaluate'/);
assert.match(main, /evaluateClinicalContext/);
assert.match(main, /SYNCHRONOUS_CDSS_RULES/);
console.log('ClinAI V25 Gate 3 CDSS gateway audit passed');

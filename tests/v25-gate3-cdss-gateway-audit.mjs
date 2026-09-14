import assert from 'node:assert/strict';
import fs from 'node:fs';

const gateway = fs.readFileSync('services/api/src/intelligence/cdssGateway.ts', 'utf8');
const evaluator = fs.readFileSync('services/api/src/events/cdssEvaluator.ts', 'utf8');

assert.match(gateway, /export async function evaluateClinicalContext/);
assert.match(gateway, /evaluateClinicalEvent\(pool, event, \{ ruleScope \}\)/);
assert.match(gateway, /SYNCHRONOUS_CDSS_RULES/);
assert.match(gateway, /decision: 'ALLOW' \| 'WARN' \| 'REVIEW'/);
assert.match(evaluator, /triggeredSignals: Signal\[\]/);
assert.match(evaluator, /return \{ evaluated: 0, triggered: 0, triggeredSignals: \[\] \};/);

// Every direct ClinicalEvaluationResult return in the evaluator must expose the
// complete result contract. This guards the exact production failure caught by Render.
for (const match of evaluator.matchAll(/return\s*\{([^}]*)\};/gms)) {
  const body = match[1];
  if (/evaluated\s*:|evaluated\s*,/.test(body) && /triggered\s*:|triggered\s*,/.test(body)) {
    assert.ok(/triggeredSignals\s*(?::|[,}]|$)/.test(body), 'ClinicalEvaluationResult return is missing triggeredSignals');
  }
}

console.log('ClinAI V25 Gate 3 CDSS gateway audit passed');

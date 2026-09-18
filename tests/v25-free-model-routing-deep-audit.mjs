import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';

const root = path.resolve(new URL('..', import.meta.url).pathname);
const providersPath = path.join(root, 'services/api/src/ai/ai-providers.ts');
const orchPath = path.join(root, 'services/api/src/ai/ai-orchestrator.ts');

const providers = fs.readFileSync(providersPath, 'utf8');
const orch = fs.readFileSync(orchPath, 'utf8');

const required = [
  'patientDataEligible',
  'modalities',
  "if (capability && !compatible.length) return null;",
  'function patientDataAllowed',
  'patientDataAvailable',
];
for (const needle of required) {
  if (!providers.includes(needle)) throw new Error(`Missing routing invariant: ${needle}`);
}

if (!orch.includes('STRICT_CAPABILITY_ROUTING')) throw new Error('Strict capability routing flag missing');
if (!orch.includes("code: 'AI_CAPABILITY_UNAVAILABLE'")) throw new Error('Capability-unavailable error missing');
if (!orch.includes("code: 'AI_PROVIDER_POLICY_BLOCKED'")) throw new Error('Patient-data policy error missing');
if (!orch.includes('clinicalRecordsProvided: true')) throw new Error('Synthetic public patient context marker missing');
if (!orch.includes('syntheticData: true')) throw new Error('Synthetic public patient marker missing');
if (orch.includes('public-models-receive-redacted context')) throw new Error('Legacy unsafe redacted-public context policy still present');

const modelLines = providers.split('\n').filter(x => x.trim().startsWith('{ id:'));
if (modelLines.length !== 16) throw new Error(`Expected 16 free model entries, found ${modelLines.length}`);
const openRouterLines = modelLines.filter(x => x.includes("provider: 'openrouter'"));
if (openRouterLines.length !== 14) throw new Error(`Expected 14 OpenRouter models, found ${openRouterLines.length}`);
for (const line of openRouterLines) {
  if (!line.includes('patientDataEligible: false')) throw new Error('An OpenRouter public/free model is marked patient-data eligible');
}

console.log('ClinAI V25 deep free-model routing audit passed');
console.log(`Models: ${modelLines.length}; OpenRouter: ${openRouterLines.length}`);
console.log('Strict capability routing: enforced');
console.log('Public/free patient clinical context: blocked');

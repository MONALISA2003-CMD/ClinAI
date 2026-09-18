import fs from 'node:fs';
import assert from 'node:assert/strict';
const orch=fs.readFileSync('services/api/src/ai/ai-orchestrator.ts','utf8');
const providers=fs.readFileSync('services/api/src/ai/ai-providers.ts','utf8');
const migration=fs.readFileSync('database/migrations/018-ai-multi-model-router.sql','utf8');
for (const x of ['AI_MODELS','selectModel','callOpenAICompatible','configuredProviders','buildPublicPatientContext','MULTI_MODEL_MODE','AI_FALLBACK_ATTEMPTS']) assert.ok(providers.includes(x)||orch.includes(x),`missing ${x}`);
for (const id of ['nvidia/nemotron-3-ultra:free','nvidia/nemotron-3-super-120b-a12b:free','inclusionai/ling-3.0-flash-sante:free','thinkingmachines/inkling:free','minimax/minimax-m3:free','nex-agi/nex-n2.5-mini:free']) assert.ok(providers.includes(id),`missing model ${id}`);
for (const route of ['/api/ai/providers','/api/ai/router']) assert.ok(orch.includes(route),`missing route ${route}`);
for (const table of ['ai_providers','ai_models','ai_provider_usage']) assert.ok(migration.includes(`CREATE TABLE IF NOT EXISTS ${table}`),`missing ${table}`);
assert.ok(orch.includes('CLINAI_ALLOW_PUBLIC_AI_WITH_PATIENT_DATA'));
assert.ok(orch.includes('CLINAI_STRICT_CAPABILITY_ROUTING'));
assert.ok(orch.includes('AI_CAPABILITY_UNAVAILABLE'));
assert.ok(orch.includes('clinicalRecordsProvided: true'));
assert.ok(orch.includes('syntheticData: true'));
assert.ok(/organizationId|patientId|encounterId/.test(orch), 'Public-context identifier stripping policy missing');
assert.ok(providers.includes('patientDataEligible'));
assert.ok(providers.includes('modalities'));
console.log('ClinAI multi-model AI audit passed.');

assert.ok(orch.includes('runOpenAICompatibleAgent'));
assert.ok(orch.includes('openAIToolDeclarations'));
assert.ok(orch.includes('CLINAI_ALLOW_PUBLIC_AI_WITH_PATIENT_DATA'));

assert.ok(orch.includes('AI_FREE_TOOL_ROUNDS'));
assert.ok(orch.includes('AI_PROVIDER_TIMEOUT_MS'));
assert.ok(orch.includes('AI_QUICK_MAX_TOKENS'));
assert.ok(orch.includes('contextCache'));
console.log('ClinAI performance/free-tier safeguards passed.');

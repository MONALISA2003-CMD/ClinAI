import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const providers = fs.readFileSync(path.join(root, 'services/api/src/ai/ai-providers.ts'), 'utf8');
const budget = fs.readFileSync(path.join(root, 'services/api/src/ai/free-ai-budget.ts'), 'utf8');
const orch = fs.readFileSync(path.join(root, 'services/api/src/ai/ai-orchestrator.ts'), 'utf8');
const env = fs.readFileSync(path.join(root, '.env.example'), 'utf8');
const migration = fs.readFileSync(path.join(root, 'database/migrations/028-free-ai-runtime-governance.sql'), 'utf8');
const py = fs.readFileSync(path.join(root, 'services/intelligence/clinical_reasoning.py'), 'utf8');

const checks = [
  ['runtime provider type excludes paid providers', !providers.includes("provider: 'openai'") && !providers.includes("provider: 'cerebras'")],
  ['all registered models are free', !providers.split('\n').filter(x => x.trim().startsWith('{ id:')).some(x => !x.includes("tier: 'free'"))],
  ['free-only hard gate', providers.includes('const FREE_ONLY_RUNTIME = true;') && providers.includes("m.tier === 'free'"),],
  ['non-free network call blocked', providers.includes("AI_NON_FREE_BLOCKED")],
  ['Gemini quota budget', budget.includes('GEMINI_FREE_DAILY_LIMIT') && budget.includes('GEMINI_FREE_RPM_LIMIT') && budget.includes('GEMINI_FREE_MIN_INTERVAL_MS')],
  ['OpenRouter 50/day headroom', budget.includes("OPENROUTER_FREE_DAILY_LIMIT', 45") && budget.includes("OPENROUTER_FREE_RPM_LIMIT', 18")],
  ['database-backed quota ledger', budget.includes('ai_free_quota_state') && migration.includes('CREATE TABLE IF NOT EXISTS ai_free_quota_state')],
  ['quota reserved before OpenAI-compatible request', providers.includes('await reserveFreeAIRequest(opts.pool || null, model.provider);')],
  ['free-only orchestration guard', orch.includes("AI_FREE_ONLY_REQUIRED") && orch.includes("x.tier === 'free'")],
  ['zero free tool continuation by default', env.includes('CLINAI_FREE_TOOL_ROUNDS=0')],
  ['Python deterministic medication/trend intelligence expanded', py.includes('duplicate-medication') && py.includes('laboratory-trend') && py.includes('repeated-no-show')],
  ['Cerebras removed from runtime env', !env.includes('CEREBRAS_API_KEY')],
];
for (const [name, ok] of checks) if (!ok) throw new Error(`FAIL: ${name}`);
const models = providers.split('\n').filter(x => x.trim().startsWith('{ id:'));
if (models.length !== 16) throw new Error(`Expected 16 free model entries, found ${models.length}`);
const or = models.filter(x => x.includes("provider: 'openrouter'"));
if (or.length !== 14) throw new Error(`Expected 14 OpenRouter free models, found ${or.length}`);
console.log(`ClinAI free-only runtime audit passed: ${checks.length} checks; models=${models.length}; openrouter=${or.length}.`);

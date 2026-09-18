import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const ai = fs.readFileSync(path.join(root, 'services/api/src/ai/ai-orchestrator.ts'), 'utf8');
const providers = fs.readFileSync(path.join(root, 'services/api/src/ai/ai-providers.ts'), 'utf8');
const budget = fs.readFileSync(path.join(root, 'services/api/src/ai/free-ai-budget.ts'), 'utf8');
const env = fs.readFileSync(path.join(root, '.env.example'), 'utf8');

const checks = [
  ['free-only runtime enabled by default', providers.includes('const FREE_ONLY_RUNTIME = true;') && ai.includes('const FREE_ONLY_RUNTIME = true;')],
  ['Gemini native path is free-tier governed', ai.includes('const FREE_TIER_MODE = true;') && ai.includes("reserveFreeAIRequest(pool, 'gemini')")],
  ['Gemini model tool rounds disabled', ai.includes('const GEMINI_MAX_TOOL_ROUNDS = 0;')],
  ['all free-model network calls reserve quota', providers.includes('reserveFreeAIRequest(opts.pool || null, model.provider)')],
  ['OpenRouter safety budget', budget.includes('OPENROUTER_FREE_DAILY_LIMIT') && budget.includes('OPENROUTER_FREE_RPM_LIMIT')],
  ['Gemini safety budget', budget.includes('GEMINI_FREE_DAILY_LIMIT') && budget.includes('GEMINI_FREE_RPM_LIMIT')],
  ['cross-instance quota ledger', budget.includes('ai_free_quota_state')],
  ['free tool rounds default zero', env.includes('CLINAI_FREE_TOOL_ROUNDS=0')],
  ['input cap remains', ai.includes('GEMINI_FREE_MAX_INPUT_CHARS') && env.includes('GEMINI_FREE_MAX_INPUT_CHARS=18000')],
  ['429 is humanized', ai.includes('ClinAI could not reach Gemini because the configured project quota is exhausted.')],
];
for (const [name, ok] of checks) if (!ok) throw new Error(`FAIL: ${name}`);
console.log(`ClinAI unified free-tier quota audit passed: ${checks.length} checks.`);

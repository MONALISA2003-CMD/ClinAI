import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const ai = fs.readFileSync(path.join(root, 'services/api/src/ai/ai-orchestrator.ts'), 'utf8');
const env = fs.readFileSync(path.join(root, '.env.example'), 'utf8');
const docs = fs.readFileSync(path.join(root, 'docs/AI-INTELLIGENCE-DEPLOYMENT.md'), 'utf8');

const checks = [
  ['free-tier mode defaults on', /GEMINI_FREE_TIER_MODE !== 'false'/.test(ai)],
  ['tool rounds disabled in free-tier mode', /GEMINI_MAX_TOOL_ROUNDS = FREE_TIER_MODE \? 0/.test(ai)],
  ['Gemini tools remain quota-safe in free-tier mode', ai.includes('freeGemini ? [] : [...toolDeclarations]')],
  ['multi-model tool gateway restored', ai.includes('runOpenAICompatibleAgent') && ai.includes('openAIToolDeclarations')],
  ['research/code tools blocked in free-tier mode', ai.includes('!freeGemini && options.allowResearch') && ai.includes('!freeGemini && options.allowCodeExecution')],
  ['local daily safety budget', /GEMINI_FREE_DAILY_LIMIT/.test(ai) && /GEMINI_FREE_DAILY_LIMIT=4/.test(env)],
  ['request spacing', /GEMINI_FREE_MIN_INTERVAL_MS/.test(ai) && /GEMINI_FREE_MIN_INTERVAL_MS=15000/.test(env)],
  ['duplicate request cache', /freeTierCache/.test(ai) && /GEMINI_FREE_CACHE_MS=300000/.test(env)],
  ['input cap', /GEMINI_FREE_MAX_INPUT_CHARS/.test(ai) && /GEMINI_FREE_MAX_INPUT_CHARS=18000/.test(env)],
  ['quota-safe deployment documentation', docs.includes('Free-tier mode') && docs.includes('one Gemini request maximum per user interaction')],
  ['provider 429 is humanized', ai.includes('ClinAI could not reach Gemini because the configured project quota is exhausted.')],
  ['lock recovers after local limit errors', ai.includes('freeTierLock = current.catch(() => undefined)')],
];
for (const [name, ok] of checks) if (!ok) throw new Error(`FAIL: ${name}`);
console.log(`ClinAI Free Tier quota audit passed: ${checks.length} checks.`);

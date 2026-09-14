import fs from 'node:fs';
import path from 'node:path';

const root = path.resolve(new URL('..', import.meta.url).pathname);
const providers = fs.readFileSync(path.join(root, 'services/api/src/ai/ai-providers.ts'), 'utf8');
const orchestrator = fs.readFileSync(path.join(root, 'services/api/src/ai/ai-orchestrator.ts'), 'utf8');

if (!providers.includes("url = 'https://api.cerebras.ai/v1/chat/completions'")) throw new Error('Cerebras endpoint mapping missing');
if (!providers.includes("model.id === 'gpt-oss-120b'")) throw new Error('Cerebras GPT-OSS reasoning guard missing');
if (!providers.includes("body.reasoning_effort = opts.reasoning ? 'high' : 'low'")) throw new Error('Cerebras reasoning_effort mapping missing');
if (!providers.includes('const toolsEnabled = Boolean(opts.tools?.length && model.toolCalling);')) throw new Error('Provider tool-state guard missing');
if (!providers.includes('if (model.structuredOutput && !toolsEnabled)')) throw new Error('Structured output must be disabled during tool rounds');

if (!orchestrator.includes('additionalProperties: false')) throw new Error('Strict JSON schema additionalProperties=false missing');
if (!orchestrator.includes('tools: allowTools && round < maxRounds ? openAIToolDeclarations() : undefined')) throw new Error('Final no-tool round not enforced');
if (!orchestrator.includes("code: 'AI_PROVIDER_EXHAUSTED'")) throw new Error('Expected exhausted-provider code marker absent');

console.log('ClinAI Cerebras GPT-OSS regression audit passed');
console.log('Tools and structured output are separated; strict schema is closed; reasoning_effort is mapped; provider failures are hidden behind a generic user error.');

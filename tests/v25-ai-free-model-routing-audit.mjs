import fs from 'node:fs';
import path from 'node:path';

const root = path.resolve(new URL('..', import.meta.url).pathname);
const providers = fs.readFileSync(path.join(root, 'services/api/src/ai/ai-providers.ts'), 'utf8');
const orchestrator = fs.readFileSync(path.join(root, 'services/api/src/ai/ai-orchestrator.ts'), 'utf8');

const required = [
  'google/gemma-4-31b-it:free',
  'google/gemma-4-26b-a4b-it:free',
  'nvidia/nemotron-3-nano-omni-30b-a3b-reasoning:free',
  'inclusionai/ling-3.0-flash-vl:free',
  'nex-agi/nex-n2.5-pro:free',
  'minimax/minimax-m2.7:free',
  'nvidia/nemotron-3.5-lightning:free',
  'thinkingmachines/inkling-small:free',
];
for (const id of required) if (!providers.includes(`id: '${id}'`)) throw new Error(`Missing model: ${id}`);
if (!providers.includes("export function modelSupportsCapability")) throw new Error('Capability matcher missing');
if (!providers.includes("capability === 'multimodal'")) throw new Error('Multimodal routing missing');
if (!orchestrator.includes('capability: options.capability')) throw new Error('Run-agent capability propagation missing');
if (!orchestrator.includes("capability:z.enum(['text','multimodal','image','audio','video','agentic','medical','coding','research','fast']).optional()")) throw new Error('AI router capability contract missing');
if (!orchestrator.includes("capability: body.capability")) throw new Error('AI assist capability propagation missing');
if (!orchestrator.includes("capability: options.capability || ''")) throw new Error('AI cache key capability isolation missing');
console.log('ClinAI V25 free-model routing audit passed');

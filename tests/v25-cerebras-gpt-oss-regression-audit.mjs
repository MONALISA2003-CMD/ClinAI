import fs from 'node:fs';
import path from 'node:path';

const root = path.resolve(new URL('..', import.meta.url).pathname);
const providers = fs.readFileSync(path.join(root, 'services/api/src/ai/ai-providers.ts'), 'utf8');
const env = fs.readFileSync(path.join(root, '.env.example'), 'utf8');

if (providers.includes("provider: 'cerebras'")) throw new Error('Retired Cerebras provider is still registered');
if (providers.includes('api.cerebras.ai')) throw new Error('Retired Cerebras endpoint is still wired');
if (env.includes('CEREBRAS_API_KEY')) throw new Error('Retired Cerebras credential remains in the runtime environment example');
if (!providers.includes("provider: 'groq'")) throw new Error('Groq free replacement path is missing');
if (!providers.includes('reserveFreeAIRequest')) throw new Error('Free provider quota reservation guard is missing');

console.log('ClinAI retired-trial-provider audit passed');
console.log('Cerebras trial runtime path is removed; free Groq/OpenRouter/Gemini paths remain governed.');

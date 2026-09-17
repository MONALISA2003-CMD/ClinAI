import fs from 'node:fs';
import vm from 'node:vm';
import ts from '/opt/nvm/versions/node/v22.16.0/lib/node_modules/typescript/lib/typescript.js';

const source = fs.readFileSync(new URL('../services/api/src/ai/ai-orchestrator.ts', import.meta.url), 'utf8');
const transpiledSource = ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }).outputText;

for (const [name, text] of [['source', source], ['transpiled', transpiledSource]]) {
  for (const forbidden of ['JSON.stringify(result.answer)', 'JSON.stringify(d.data.answer)', 'Stringify AI response for display']) {
    if (text.includes(forbidden)) throw new Error(`${name}: forbidden display serialization found: ${forbidden}`);
  }
  if (!text.includes('function responseToPlain') || !text.includes('function stripStructuredDisplayLeak') || !text.includes('function clinicianResponse')) {
    throw new Error(`${name}: response boundary functions missing`);
  }
}

// Execute the pure response-boundary functions from the transpiled API source without starting the service.
const start = transpiledSource.indexOf('function sanitizeClinAIResponse');
const end = transpiledSource.indexOf('async function recordWork', start);
const pure = transpiledSource.slice(start, end);
const context = { console, String, JSON, RegExp, Set, Object, Array };
vm.createContext(context);
vm.runInContext(`${pure}\nthis.__responseToPlain=responseToPlain;`, context);

const cases = [
  {
    name: 'plain structured object',
    input: { directAnswer: 'There are 5 appointments today.', recordedFacts: ['1 checked in', '3 completed'], suggestedReview: [], uncertainty: [] },
    expect: 'There are 5 appointments today.',
  },
  {
    name: 'JSON string from provider',
    input: JSON.stringify({ directAnswer: 'There are 5 appointments today.', recordedFacts: ['1 checked in'], suggestedReview: [], uncertainty: [] }),
    expect: 'There are 5 appointments today.',
  },
  {
    name: 'nested provider envelope',
    input: { data: { answer: JSON.stringify({ directAnswer: 'Habari. Niko tayari kukusaidia.', recordedFacts: [], suggestedReview: [], uncertainty: [] }) } },
    expect: 'Habari. Niko tayari kukusaidia.',
  },
  {
    name: 'double nested object',
    input: { answer: { data: { result: { directAnswer: 'Muraho. Niteguye kugufasha.', recordedFacts: [], suggestedReview: [], uncertainty: [] } } } },
    expect: 'Muraho. Niteguye kugufasha.',
  },
];

for (const c of cases) {
  const out = context.__responseToPlain(c.input, 'Fallback', c.name.includes('nested provider') ? 'Kiswahili' : c.name.includes('double') ? 'Kinyarwanda' : 'English');
  if (typeof out !== 'string') throw new Error(`${c.name}: output is not a string`);
  if (out.includes('directAnswer') || out.includes('recordedFacts') || out.includes('reasoningSummary') || out.includes('suggestedReview') || /^\s*[{[]/.test(out)) {
    throw new Error(`${c.name}: internal structured data leaked: ${out}`);
  }
  if (!out.includes(c.expect)) throw new Error(`${c.name}: expected ${c.expect}, got ${out}`);
}

const bad = context.__responseToPlain('{"directAnswer":"x","recordedFacts":["y"],"reasoningSummary":"z"}', 'Fallback', 'English');
if (bad.includes('"directAnswer"') || bad.includes('recordedFacts')) throw new Error('Raw JSON leaked through the final response boundary.');

console.log('AI V5 response-boundary audit: PASS');

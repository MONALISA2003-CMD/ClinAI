import fs from 'node:fs';
const api=fs.readFileSync('services/api/src/ai/ai-orchestrator.ts','utf8');
const web=fs.readFileSync('apps/web/app/page.tsx','utf8');
const checks=[
 ['fast deterministic intent router',/function fastIntent\(/],
 ['simple task fast path',/tryFastPath\(/],
 ['zero default free-tier delay',/GEMINI_FREE_MIN_INTERVAL_MS.*\|\| 0/],
 ['provider timeout tightened',/CLINAI_PROVIDER_TIMEOUT_MS.*\|\| 9000/],
 ['natural language response rendering',/function responseToPlain\(/],
 ['localized response headings',/responseHeadings\(/],
 ['frontend handles structured legacy responses',/JSON\.stringify\(value\)/],
 ['no developer-facing implementation wording in base prompt',/You are NOT a developer assistant/],
 ['multi-model routing retained',/selectModel\(/],
];
for (const [name,re] of checks) if(!re.test(api+web)) throw new Error(`Missing ${name}`);
if(/ORDER BY COALESCE\(ls\.received_at,lr\.id::text::timestamptz/.test(api)) throw new Error('Invalid lab ordering remains');
console.log('AI V4 response/speed audit passed:',checks.length,'checks');

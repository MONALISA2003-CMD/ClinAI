import fs from 'node:fs';
const web=fs.readFileSync('apps/web/app/page.tsx','utf8');
const ai=fs.readFileSync('services/api/src/ai/ai-orchestrator.ts','utf8');
const checks=[
 ['structured clinical response fields', ['currentSituation','attentionItems','careGaps','crossModuleEvidence','safetySignals','provenance'].every(x=>ai.includes(x))],
 ['structured response renderer', web.includes('AIResponse({text,structured}') && web.includes('WHAT REQUIRES ATTENTION') && web.includes('CROSS-MODULE EVIDENCE')],
 ['authorized role display', web.includes('AUTHORIZED ROLE') && !web.includes('Choose your role')],
 ['public assistant removed', !web.includes('/api/public/health-assistant') && web.includes('ABOUT CLINAI')],
 ['production demo auth guard', fs.readFileSync('services/api/src/main.ts','utf8').includes('CLINAI_ENABLE_DEMO_AUTH')],
 ['additive AI indexes migration', fs.existsSync('database/migrations/20260917_ai_intelligence_indexes.sql')],
];
const failed=checks.filter(([,ok])=>!ok);
console.log(JSON.stringify({ok:!failed.length,checks:checks.length,failed:failed.map(x=>x[0])},null,2));
if(failed.length)process.exit(1);

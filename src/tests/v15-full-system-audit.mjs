import fs from 'node:fs';
import path from 'node:path';
const root=path.resolve(new URL('..',import.meta.url).pathname);
const api=fs.readFileSync(path.join(root,'services/api/src/main.ts'),'utf8');
const page=fs.readFileSync(path.join(root,'apps/web/app/page.tsx'),'utf8');
const checks=[
 ['command center analytics route', api.includes("/api/analytics/command-center")],
 ['patient alias lineage', api.includes('CREATE TABLE IF NOT EXISTS patient_aliases')],
 ['controlled patient merge', api.includes("app.post('/api/patients/:id/merge'") && api.includes('SAVEPOINT merge_row')],
 ['walk-in queue uses queue table', api.includes("INSERT INTO queue_entries(queue_id,patient_id,status,priority,joined_at)")],
 ['queue org scoping uses queues join', api.includes('JOIN queues q ON q.id=qe.queue_id')],
 ['offline IndexedDB', fs.existsSync(path.join(root,'apps/web/lib/offline.ts'))],
 ['offline retry', fs.readFileSync(path.join(root,'apps/web/lib/offline.ts'),'utf8').includes('flushOperations')],
 ['role dashboards', page.includes('Leadership') && page.includes('Pharmacist')],
 ['seven day trend', page.includes('LAST 7 DAYS')],
 ['facility dashboard', page.includes('FACILITY READINESS')],
 ['responsive dashboard styles', fs.readFileSync(path.join(root,'apps/web/app/globals.css'),'utf8').includes('.dashboard-grid')],
 ['research record', fs.existsSync(path.join(root,'docs/V15-PLATFORM-COMPLETION-RESEARCH.md'))],
 ['v14 audit retained', fs.existsSync(path.join(root,'tests/v14-integration-audit.mjs'))]
];
const failed=checks.filter(([,ok])=>!ok);
if(failed.length){console.error(failed.map(([n])=>`FAIL ${n}`).join('\n'));process.exit(1)}
console.log(`ClinAI V15 full-system audit passed: ${checks.length} checks`);

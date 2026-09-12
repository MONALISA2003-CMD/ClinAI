import fs from 'node:fs';
const root=new URL('..',import.meta.url).pathname;
const main=fs.readFileSync(`${root}/services/api/src/main.ts`,'utf8');
const schema=fs.readFileSync(`${root}/database/schema.sql`,'utf8');
const routes=[
 '/api/care-pathways/:id/execution-template','/api/care-pathways/enroll','/api/patients/:patientId/pathways','/api/pathway-enrollments/:id','/api/pathway-enrollments/:id/steps/:stepId/execute','/api/pathway-enrollments/:id/complete',
 '/api/offline/devices/register','/api/offline/sync/push','/api/offline/sync/pull','/api/offline/sync/:operationId/ack','/api/reporting/indicators','/api/reporting/submissions','/api/reporting/submissions'
];
const tables=['pathway_enrollments','pathway_step_executions','reporting_submissions','sync_devices'];
for(const r of routes) if(!main.includes(`'${r}'`)) throw new Error(`Missing route ${r}`);
for(const t of tables) if(!schema.includes(t)) throw new Error(`Missing schema table ${t}`);
for(const x of ['evaluateRule','WHO SMART','Uganda','offline']) if(!main.includes(x) && x!=='WHO SMART') throw new Error(`Missing V7 marker ${x}`);
console.log(`V7 structural checks passed: ${routes.length-1} route declarations and ${tables.length} new tables`);

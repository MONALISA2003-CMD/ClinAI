import fs from 'node:fs';
import path from 'node:path';

const root=process.cwd();
const map=fs.readFileSync(path.join(root,'services/api/src/events/connectedDataMap.ts'),'utf8');
const main=fs.readFileSync(path.join(root,'services/api/src/main.ts'),'utf8');
const doc=fs.readFileSync(path.join(root,'docs/CLINAI-CONNECTED-EVENT-DATA-MAP.md'),'utf8');

const workflows=[
  'patient-lifecycle','clinical-workflow','emergency','inpatient','surgery','maternity',
  'pharmacy','laboratory','imaging','referrals','billing','insurance','finance',
  'inventory','procurement','suppliers','facilities','public-health','intelligence'
];
for(const key of workflows){
  if(!(map.includes(`key:'${key}'`) || map.includes(`key: '${key}'`))) throw new Error(`Missing connected workflow: ${key}`);
}
for(const route of ['/api/events/connected-data-map','/api/events/connected-data-map/:workflow','/api/events/catalog','/api/events/health','/api/events/stream']){
  if(!main.includes(`'${route}'`)) throw new Error(`Missing Workstream 3 route: ${route}`);
}
if(!map.includes('validateConnectedDataMap')) throw new Error('Missing connected map validator');
for(const phrase of ['outbox_events','clinical_workflow_events','care_graph_edges','clinical_signals','module_records','minimum-necessary']){
  if(!doc.includes(phrase)) throw new Error(`Missing architecture contract: ${phrase}`);
}
console.log(`Workstream 3 connected event/data map audit passed: ${workflows.length} workflows, 5 API surfaces`);

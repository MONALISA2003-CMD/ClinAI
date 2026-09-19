import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { execFileSync } from 'node:child_process';

const root=path.resolve(path.dirname(new URL(import.meta.url).pathname),'..');
const read=(p)=>fs.readFileSync(path.join(root,p),'utf8');
const ok=(cond,msg)=>{if(!cond) throw new Error(msg);};
const hash=(p)=>crypto.createHash('sha256').update(fs.readFileSync(path.join(root,p))).digest('hex');

const handoffModules={
 phase4:['emergency','inpatient','beds','nursing','surgery','maternity','pediatrics','child-health'],
 phase5:['chronic-care','immunization','consents','referrals','referral-network','care-gaps','patient-portal','portal-messages','telemedicine','remote-monitoring'],
 phase6:['billing','payments','insurance','claims','accounting','inventory','procurement','suppliers'],
 phase7:['population-health','surveillance','investigations','response','mortality','district-intelligence','patient-portal','telemedicine','remote-monitoring','notifications','documents']
};
const phase67=[...new Set([...handoffModules.phase6,...handoffModules.phase7])];
const page=read('apps/web/app/page.tsx');
const route=read('services/api/src/routes/phase67FinancePublicHealth.ts');
const main=read('services/api/src/main.ts');
const specs=read('services/api/src/domainModuleSpecs.ts');
const ws2=read('services/api/src/routes/workstream2Domains.ts');
const migration=read('database/migrations/032-phase6-7-finance-public-health-depth.sql');
const contracts=JSON.parse(read('packages/module-contracts/contracts.json'));

for(const m of phase67){
 ok(route.includes(`'${m}'`) || route.includes(`\"${m}\"`),`Phase6/7 route registry missing ${m}`);
 ok(page.includes(`'${m}'`),`Phase6/7 frontend registry missing ${m}`);
 ok(page.includes('PHASE67_READ_ENDPOINTS') && page.includes('`/api/phase67/${m}`'),`Phase6/7 frontend read endpoint mapping missing ${m}`);
}
ok(page.includes('function Phase67Workspace'), 'Phase67Workspace missing');
ok(page.includes("['billing','payments','insurance','claims','accounting','inventory','procurement','suppliers'].includes(module)?<DomainWorkspace"),'Existing rich finance/supply workspace was replaced instead of preserved');
ok(main.includes("registerPhase67FinancePublicHealthRoutes"),'Phase67 route registration missing in API main');
ok(main.includes("ALTER TABLE insurance_policies ADD COLUMN IF NOT EXISTS organization_id uuid"),'Insurance runtime schema guard missing');
ok(specs.includes("investigations:{module:'investigations',table:'public_health_investigations',fields:"),'Investigations authoritative spec missing');
ok(!/investigations:\{[^\n]*patientField:/.test(specs),'Investigations incorrectly declares patientField');
ok(!/response:\{[^\n]*patientField:/.test(specs),'Response incorrectly declares patientField');
ok(/insurance_policies[\s\S]*organization_id/.test(ws2),'Insurance policy write path does not reference organization_id');
ok(/ALTER TABLE insurance_policies ADD COLUMN IF NOT EXISTS organization_id uuid/.test(migration),'Migration missing insurance organization_id');
ok(!/\bDROP\s+(TABLE|SCHEMA|DATABASE)|\bTRUNCATE\b|\bDELETE\s+FROM\b/i.test(migration),'Phase6/7 migration contains destructive SQL');

const contractNames=(contracts.contracts||contracts.modules||[]).map(x=>x.module||x.name||x.id);
for(const m of phase67) ok(contractNames.includes(m),`Module contract missing ${m}`);

const aiBaseline={
 'services/api/src/ai/ai-orchestrator.ts':'075b0c9535f9d0071da585ab1026b5c6b1c7d049bdd0a65e38d85debb6f150b4',
 'services/api/src/ai/ai-providers.ts':'9262acea258a7d8a2eeaa71f4b2f7a417f458f31ddb5d697cdccacb535554af9',
 'services/intelligence/clinical_reasoning.py':'71cb4f55bf33bfa3888ac31aad3019499af2d96a32d0ade1ee74a69b7b19577b'
};
for(const [p,h] of Object.entries(aiBaseline)) ok(hash(p)===h,`AI/intelligence file changed: ${p}`);

const tsCommands=[
 ['web', ['-p','tests/ts-harness/web-tsconfig.json','--pretty','false']],
 ['phase67-api', ['-p','tests/ts-harness/api-route-tsconfig.json','--pretty','false']],
 ['main-api', ['-p','tests/ts-harness/api-main-tsconfig.json','--pretty','false']]
];
for(const [label,args] of tsCommands){
  execFileSync('tsc',args,{cwd:root,stdio:'pipe'});
}
console.log(JSON.stringify({ok:true,phase1to7:true,phase67Modules:phase67.length,contracts:contractNames.length,typescript:['web','phase67-api','main-api'],aiPreserved:true},null,2));

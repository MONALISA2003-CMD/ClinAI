import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const read = p => fs.readFileSync(path.join(root,p),'utf8');
const checks=[];
function ok(name, condition, detail=''){ checks.push({name,pass:Boolean(condition),detail}); }

const migration = read('database/migrations/031-phase2-core-clinical-depth.sql');
const route = read('services/api/src/routes/phase2CoreClinical.ts');
const main = read('services/api/src/main.ts');
const page = read('apps/web/app/page.tsx');
const css = read('apps/web/app/globals.css');
const contracts = JSON.parse(read('packages/module-contracts/contracts.json'));
const phase2 = new Set(['triage','diagnoses','clinical-notes','care-plans','referrals','referral-transfers','care-tasks','workflows']);

ok('authoritative triage table', /CREATE TABLE IF NOT EXISTS triage_assessments/.test(migration));
ok('deeper Phase 2 schema', ['verification_status','documentation_status','interventions','destination_facility_id','receiving_contact','escalation_level'].every(x=>migration.includes(x)));
const migrationSql = migration.replace(/--.*$/gm,''); ok('migration is additive', !/\b(DROP|TRUNCATE|DELETE FROM)\b/i.test(migrationSql));
ok('Phase 2 route registered', /registerPhase2CoreClinicalRoutes\(app,pool/.test(main));
ok('Phase 2 route modules', [...phase2].every(x=>route.includes(`'${x}'`)));
ok('Phase 2 CRUD/action endpoints', ['/api/core-clinical/:module','/api/core-clinical/:module/:id','/api/core-clinical/:module/:id/action'].every(x=>route.includes(x)));
ok('dashboard endpoint', route.includes('/api/core-clinical/:module/dashboard'));
ok('workflow activity endpoint', route.includes('/api/core-clinical/workflows/activity'));
ok('triage queues and observations', route.includes('INSERT INTO observations') && route.includes('INSERT INTO queue_entries'));
ok('workflow events emitted', ['triage.assessment.recorded','diagnosis.recorded','clinical-note.recorded','care-plan.created','referral.created','referral.transfer.created','care-task.created'].every(x=>route.includes(x)));
ok('legacy triage compatibility writes authoritative table', /app\.post\('\/api\/triage'/.test(main) && /INSERT INTO triage_assessments/.test(main));
const legacyTriageBlock = main.slice(main.indexOf("app.post('/api/triage'"), main.indexOf("app.get('/api/orders'"));
ok('legacy triage schema covers persistence fields', ['arrivedAt','arrivalMode','acuity','triageCategory','mentalStatus','mobilityStatus','infectionPrecautions','riskFlags','notes','disposition'].every(field=>new RegExp('\\bt\\.'+field+'\\b').test(legacyTriageBlock)) && ['arrivedAt','arrivalMode','acuity','triageCategory','mentalStatus','mobilityStatus','infectionPrecautions','riskFlags','notes','disposition'].every(field=>new RegExp('\\b'+field+'\\s*:').test(main.slice(main.indexOf('const triage=z.object'), main.indexOf('const generic')))));
ok('frontend Phase 2 workspace', page.includes('CoreClinicalWorkspace') && page.includes('Phase2Trend') && page.includes('Phase2Bars'));
ok('frontend Phase 2 API', page.includes('/api/core-clinical/') && page.includes('WorkflowActivity'));
ok('responsive Phase 2 CSS', css.includes('.phase2-workspace') && css.includes('@media(max-width:620px)'));
ok('AI response code untouched', !page.includes('private chain') && page.includes('AI')); // structural guard, not a prose comparison
ok('contract scope limited', [...contracts.modules].filter(m=>m.identity?.contractVersion==='2.1.0').every(m=>phase2.has(m.id)));
ok('all Phase 2 contracts upgraded', [...contracts.modules].filter(m=>phase2.has(m.id)).every(m=>m.identity?.contractVersion==='2.1.0'));

const tsc = spawnSync('tsc',['-p','/tmp/clinai-ts-harness/web-tsconfig.json'],{encoding:'utf8'});
ok('TSX semantic harness', tsc.status===0, (tsc.stdout||'')+(tsc.stderr||''));
const routeTsc = spawnSync('tsc',['-p','/tmp/clinai-ts-harness/api-route-tsconfig.json'],{encoding:'utf8'});
ok('Phase 2 API route semantic harness', routeTsc.status===0, (routeTsc.stdout||'')+(routeTsc.stderr||''));

const failed=checks.filter(x=>!x.pass);
for (const x of checks) console.log(`${x.pass?'PASS':'FAIL'} | ${x.name}${x.detail?` | ${x.detail.trim().split('\n')[0]}`:''}`);
if(failed.length){ console.error(`\n${failed.length} checks failed.`); process.exit(1); }
console.log(`\nPhase 2 audit passed: ${checks.length} checks.`);

import fs from 'node:fs';

const page=fs.readFileSync('apps/web/app/page.tsx','utf8');
const api=fs.readFileSync('services/api/src/main.ts','utf8');
const ai=fs.readFileSync('services/api/src/ai/ai-orchestrator.ts','utf8');
const migration=fs.readFileSync('database/migrations/024-clinai-phase3-synthetic-coverage.sql','utf8');
const css=fs.readFileSync('apps/web/app/globals.css','utf8');
const fail=[];

for(const workspace of ['patient-360','clinical-velocity','value-based-care','ai-risk','ai-security','ai-governance']){
  if(!page.includes(`['patient-360','Patient 360'`) && workspace==='patient-360') fail.push('frontend Patient 360 intelligence card missing');
  if(!page.includes(`['clinical-velocity','Clinical Velocity'`) && workspace==='clinical-velocity') fail.push('frontend Clinical Velocity intelligence card missing');
  if(!page.includes(`['value-based-care','Value Based Care'`) && workspace==='value-based-care') fail.push('frontend Value Based Care intelligence card missing');
  if(!page.includes(`['ai-risk','AI Risk'`) && workspace==='ai-risk') fail.push('frontend AI Risk intelligence card missing');
  if(!page.includes(`['ai-security','AI Security'`) && workspace==='ai-security') fail.push('frontend AI Security intelligence card missing');
  if(!page.includes(`['ai-governance','AI Governance'`) && workspace==='ai-governance') fail.push('frontend AI Governance intelligence card missing');
  if(!api.includes(`workspace==='${workspace}'`)) fail.push(`backend public intelligence route missing ${workspace}`);
}
if(!page.includes('function IntelligenceWorkspaceHub')) fail.push('six-workspace hub component missing');
if(!page.includes('className="ai-response-section-title"')) fail.push('AI response headings are not explicitly bolded');
if(page.includes('<h3>{heading}</h3>')) fail.push('AI response still renders variable headings as h3 instead of explicit bold headings');
if(!page.includes('/api/public/ai-assist')) fail.push('public patient AI endpoint not wired');
if(!page.includes('publicTestPatientNumber={data.publicTestPatient?p.patientNumber:undefined}')) fail.push('public Patient 360 AI does not pass synthetic patient number');
if(!page.includes('openPublicPatient(selected)')) fail.push('public Patient 360 action does not use public patient route');
if(!ai.includes('Never output JSON')) fail.push('AI output policy does not explicitly prohibit JSON');
if(!ai.includes('implementation notes')) fail.push('AI output policy does not explicitly prohibit implementation notes');
const migrationSql=migration.replace(/--[^\n]*\n/g,'\n');
if(/\b(?:DROP|TRUNCATE)\b/i.test(migrationSql) || /\bDELETE\s+FROM\b/i.test(migrationSql) || /ALTER TABLE[^\n;]*\bDROP\b/i.test(migrationSql)) fail.push('Phase 3 migration contains destructive SQL');
if(!migration.includes('INSERT INTO module_records')) fail.push('Phase 3 synthetic module coverage is missing');
if(!css.includes('.ai-response-section-title')) fail.push('AI heading styling is missing');
if(!css.includes('.intelligence-workspace-grid')) fail.push('intelligence workspace responsive styling is missing');
if(fail.length){console.error('Phase 3 end-to-end audit failed'); for(const x of fail) console.error('- '+x); process.exit(1);}
console.log('Phase 3 end-to-end audit passed: public intelligence, Patient 360 AI boundary, bold AI headings, synthetic coverage and additive migration checks are present.');

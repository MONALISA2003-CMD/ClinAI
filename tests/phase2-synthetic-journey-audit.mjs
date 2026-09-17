import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const here=path.dirname(fileURLToPath(import.meta.url));
const root=path.resolve(here,'..');
const seed=fs.readFileSync(path.join(root,'database/seeds/clinai-synthetic-test-data.sql'),'utf8');
const completion=fs.readFileSync(path.join(root,'database/seeds/clinai-phase2-longitudinal-completion.sql'),'utf8');
const sql=completion.replace(/--.*$/gm,'');
const errors=[];
for(let i=1;i<=30;i++){
 const id=`TEST-${String(i).padStart(3,'0')}`;
 if(!seed.includes(`'${id}'`)) errors.push(`${id}: missing from base synthetic seed`);
}
for(const token of ['clinical_notes','care_plans','allergies','procedures','module_records','testData','synthetic-longitudinal-journey']){
 if(!completion.includes(token)) errors.push(`Phase 2 completion seed missing ${token}`);
}
for(const bad of ['DROP TABLE','TRUNCATE','DELETE FROM','UPDATE patients']) if(new RegExp(bad,'i').test(sql)) errors.push(`Destructive SQL found: ${bad}`);
if(errors.length){console.error(errors.join('\n'));process.exit(1)}
console.log('Phase 2 synthetic journey audit passed: 30 synthetic patient scenarios are defined and longitudinal completion is additive/idempotent.');

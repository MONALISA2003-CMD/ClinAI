import fs from 'node:fs';
const root = new URL('..', import.meta.url).pathname;
const main=fs.readFileSync(`${root}/services/api/src/main.ts`,'utf8');
const migration=fs.readFileSync(`${root}/database/migrations-008-uganda-maternal-newborn-pnc.sql`,'utf8');
const routes=[
'/api/clinical-content/sources','/api/maternal-care/:patientId','/api/maternal-care/records','/api/maternal-care/contacts','/api/maternal-care/births','/api/newborns','/api/postnatal-care/contacts','/api/postnatal-care/:patientId'];
for(const r of routes) if(!main.includes(r)) throw new Error(`missing route ${r}`);
for(const t of ['maternal_care_records','maternal_care_contacts','birth_events','newborn_records','postnatal_contacts']) if(!migration.includes(`CREATE TABLE IF NOT EXISTS ${t}`)) throw new Error(`missing table ${t}`);
for(const s of ['UG-MOH-ANC-2025','WHO-ANC-DAK-2021','WHO-PNC-DAK-2025','UG-MOH-EMNCC-2022','WHO-SMART-BASE-1.0.0']) if(!main.includes(s)) throw new Error(`missing source ${s}`);
console.log('ClinAI V8 structural check passed');

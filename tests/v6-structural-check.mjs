import fs from 'node:fs';
const api=fs.readFileSync(new URL('../services/api/src/main.ts',import.meta.url),'utf8');
const migration=fs.readFileSync(new URL('../database/migrations/006-uganda-clinical-interoperability-v6.sql',import.meta.url),'utf8');
const required=[
  '/api/uganda/architecture','/api/facilities/:facilityId/identifiers','/api/health-workers','/api/terminology',
  '/api/guidelines','/api/care-pathways','/api/immunization/schedule','/api/hie/connections','/api/hie/messages',
  '/api/reporting/mappings','/api/offline/sync'
];
const tables=['facility_identifiers','health_worker_profiles','terminology_concepts','clinical_guidelines','clinical_guideline_rules','care_pathways','care_pathway_steps','immunization_schedule_rules','hie_connections','hie_messages','reporting_mappings','offline_sync_queue'];
for(const r of required) if(!api.includes(r)) throw new Error(`missing route ${r}`);
for(const t of tables){ if(!api.includes(`CREATE TABLE IF NOT EXISTS ${t}`)) throw new Error(`missing runtime table ${t}`); if(!migration.includes(`CREATE TABLE IF NOT EXISTS ${t}`)) throw new Error(`missing migration table ${t}`); }
console.log(`V6 structural checks passed: ${required.length} routes, ${tables.length} tables`);

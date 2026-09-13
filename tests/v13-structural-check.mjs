import fs from 'node:fs';
import assert from 'node:assert/strict';
const root=new URL('..',import.meta.url).pathname;
const api=fs.readFileSync(root+'services/api/src/main.ts','utf8');
const mig=fs.readFileSync(root+'database/migrations-013-facility-district-intelligence.sql','utf8');
for(const t of ['districts','district_facility_links','facility_service_capacity','facility_resource_status','workforce_capacity_snapshots','facility_operational_incidents','facility_performance_snapshots','referral_network_nodes']) assert(mig.includes(`CREATE TABLE IF NOT EXISTS ${t}`),`missing table ${t}`);
for(const r of ['/api/districts','/api/facilities/operations','/api/facilities/:facilityId/capacity','/api/facilities/:facilityId/resources','/api/workforce/capacity','/api/facility-incidents','/api/facility-performance','/api/districts/:districtId/intelligence']) assert(api.includes(r),`missing route ${r}`);
assert(api.includes('V13 Facility Operations + District Health Intelligence'),'missing V13 marker');
console.log('ClinAI V13 structural check passed');

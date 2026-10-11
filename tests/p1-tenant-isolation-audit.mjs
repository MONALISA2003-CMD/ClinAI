import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import {
  rowsForOrganization,
  findForOrganization,
  rowsForPatientInOrganization,
  patientEncounterLinkIsValid,
} from '../services/api/src/security/tenant-scope.ts';

const main = await readFile('services/api/src/main.ts', 'utf8');

function routeBlock(method, route) {
  const needle = `app.${method}('${route}'`;
  const start = main.indexOf(needle);
  assert.notEqual(start, -1, `Expected route ${method.toUpperCase()} ${route} to exist`);
  const next = main.indexOf('\napp.', start + needle.length);
  return main.slice(start, next === -1 ? main.length : next);
}

test('in-memory reads fail closed and never mix organization records', () => {
  const rows = [
    { id: 'patient-a', organizationId: 'org-a', firstName: 'A' },
    { id: 'patient-b', organizationId: 'org-b', firstName: 'B' },
    { id: 'legacy', organizationId: null, firstName: 'Legacy' },
  ];
  assert.deepEqual(rowsForOrganization(rows, 'org-a').map((row) => row.id), ['patient-a']);
  assert.deepEqual(rowsForOrganization(rows, 'org-b').map((row) => row.id), ['patient-b']);
  assert.deepEqual(rowsForOrganization(rows, null), []);
  assert.deepEqual(rowsForOrganization(rows, undefined), []);
});

test('single-record lookup cannot find another tenant record or run without tenant context', () => {
  const rows = [{ id: 'invoice-a', organizationId: 'org-a' }, { id: 'invoice-b', organizationId: 'org-b' }];
  assert.equal(findForOrganization(rows, 'invoice-a', 'org-a')?.id, 'invoice-a');
  assert.equal(findForOrganization(rows, 'invoice-b', 'org-a'), undefined);
  assert.equal(findForOrganization(rows, 'invoice-a', undefined), undefined);
  assert.equal(findForOrganization(rows, undefined, 'org-a'), undefined);
});

test('patient-related records require an authorized parent and matching organization', () => {
  const records = [
    { id: 'allergy-a', organizationId: 'org-a', patientId: 'patient-a' },
    { id: 'allergy-cross-linked', organizationId: 'org-b', patientId: 'patient-a' },
    { id: 'allergy-b', organizationId: 'org-b', patientId: 'patient-b' },
  ];
  assert.deepEqual(rowsForPatientInOrganization(records, 'patient-a', 'org-a', true).map((row) => row.id), ['allergy-a']);
  assert.deepEqual(rowsForPatientInOrganization(records, 'patient-a', 'org-a', false), []);
  assert.deepEqual(rowsForPatientInOrganization(records, 'patient-b', null, true), []);
});

test('patient-to-encounter links are valid only for the same tenant and patient', () => {
  assert.equal(patientEncounterLinkIsValid('p1', 'p1', 'org-a', 'org-a'), true);
  assert.equal(patientEncounterLinkIsValid('p1', 'p2', 'org-a', 'org-a'), false);
  assert.equal(patientEncounterLinkIsValid('p1', 'p1', 'org-b', 'org-a'), false);
  assert.equal(patientEncounterLinkIsValid('p1', null, 'org-a', 'org-a'), false);
});

test('API in-memory helper and write paths make organization context authoritative', () => {
  assert.match(main, /function tenantRows\(m:Mod, req:any\):Row\[\]\{ return rowsForOrganization/);
  assert.match(main, /function tenantFind\(m:Mod, id:string, req:any\):Row\|undefined \{ return findForOrganization/);
  assert.match(main, /function tenantPatientRows\(m:Mod, patientId:string, req:any\):Row\[\]\{ const hasPatient=Boolean\(tenantFind\('patients',patientId,req\)\)/);
  assert.match(main, /const row=\{id:data\.id\|\|randomUUID\(\), createdAt:data\.createdAt\|\|now\(\), updatedAt:now\(\), \.\.\.data, organizationId\}/);
  assert.match(main, /if\(!organizationId\) throw Object\.assign\(new Error\('Organization context is required\.'\)/);
  assert.match(main, /typeof claims === 'object'[\s\S]*'organizationId' in claims/, 'the JWT user must be structurally narrowed before reading organizationId');
  assert.match(main, /typeof organizationId !== 'string' \|\| organizationId\.trim\(\)\.length === 0/, 'the organization claim must be a non-empty string');
});

test('DB-backed write boundary verifies tenant-owned patients, facilities, districts, invoices, and related care records', () => {
  assert.match(main, /Enforce tenant ownership for patient and related-resource identifiers across every DB-backed write route/);
  assert.match(main, /SELECT id,is_test_data FROM patients WHERE id=\$1 AND organization_id=\$2 LIMIT 1/);
  assert.match(main, /SELECT patient_id FROM encounters WHERE id=\$1 AND organization_id=\$2 LIMIT 1/);
  assert.match(main, /SELECT patient_id FROM appointments WHERE id=\$1 AND organization_id=\$2 LIMIT 1/);
  assert.match(main, /SELECT id FROM facilities WHERE id=\$1 AND organization_id=\$2 LIMIT 1/);
  assert.match(main, /SELECT id FROM districts WHERE id=\$1 AND organization_id=\$2 LIMIT 1/);
  assert.match(main, /SELECT patient_id FROM invoices WHERE id=\$1 AND organization_id=\$2 LIMIT 1/);
  assert.match(main, /ORGANIZATION_SCOPE_MISMATCH/);
  assert.match(main, /RELATION_TENANT_QUERIES/);
  assert.match(main, /JOIN clinical_orders co ON co.id=ls.order_id JOIN patients p ON p.id=co.patient_id/);
  assert.match(main, /JOIN user_roles ur ON ur.user_id=u.id JOIN roles r ON r.id=ur.role_id/);
  assert.match(main, /patientEncounterLinkIsValid\(String\(patientId\),String\(encounter\.rows\[0\]\.patient_id\),organizationId,organizationId\)/);
});

test('high-risk clinical create routes use explicit patient and encounter ownership checks', () => {
  for (const [method, route] of [
    ['post', '/api/nursing/assessments'],
    ['post', '/api/surgery/cases'],
    ['post', '/api/maternity/records'],
    ['post', '/api/pediatrics/assessments'],
    ['post', '/api/immunizations'],
    ['post', '/api/chronic-care/records'],
    ['post', '/api/telemedicine/sessions'],
    ['post', '/api/remote-monitoring/readings'],
  ]) {
    const block = routeBlock(method, route);
    assert.match(block, /requirePatient\(/, `${route} needs a database-backed patient ownership check`);
    assert.match(block, /fallbackAdvanced\(/, `${route} needs a tenant-safe fallback path`);
  }
});

test('payment and pharmacy fallback mutations cannot operate on another tenant record', () => {
  assert.match(routeBlock('post', '/api/billing/:id/pay'), /tenantFind\('billing',req\.params\.id,req\)/);
  assert.match(routeBlock('post', '/api/pharmacy/:id/dispense'), /tenantFind\('pharmacy',req\.params\.id,req\)/);
  assert.match(routeBlock('post', '/api/billing/:id/pay'), /tenantRows\('payments',req\)/);
});

test('critical collection fallbacks are organization-scoped and report scoped counts', () => {
  for (const route of [
    '/api/dashboard', '/api/events', '/api/patients', '/api/appointments', '/api/encounters',
    '/api/orders', '/api/laboratory', '/api/imaging', '/api/queue', '/api/emergency/cases',
    '/api/inpatient/admissions', '/api/nursing/assessments', '/api/surgery/cases',
    '/api/maternity/records', '/api/pediatrics/assessments', '/api/immunizations',
    '/api/chronic-care/records', '/api/telemedicine/sessions', '/api/remote-monitoring/readings',
    '/api/audit', '/api/search', '/api/messages', '/api/care-gaps', '/api/alerts',
  ]) {
    const method = route === '/api/dashboard' || route === '/api/events' || route === '/api/search' ? 'get' : 'get';
    const block = routeBlock(method, route);
    if (route === '/api/events') assert.match(block, /tenantEvents\(req\)/);
    else if (route === '/api/audit') assert.match(block, /entry\.organizationId===org\(req\)/);
    else assert.match(block, /tenantRows\(/, `${route} must use organization-scoped records`);
  }
});

test('nested patient summaries only return records from the authorized organization', () => {
  assert.match(routeBlock('get', '/api/patients/:id/care-summary'), /tenantFind\('patients',id,req\)/);
  assert.match(routeBlock('get', '/api/patients/:id/care-summary'), /tenantPatientRows\('diagnoses',id,req\)/);
  assert.match(routeBlock('get', '/api/patients/:id/care-summary'), /tenantPatientRows\('pharmacy',id,req\)/);
});

console.log('P1 tenant-isolation negative and source-boundary checks passed.');

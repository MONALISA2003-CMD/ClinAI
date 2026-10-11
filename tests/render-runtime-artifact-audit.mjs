import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';

const tenantTs = 'services/api/src/security/tenant-scope.ts';
const tenantJs = 'services/api/src/security/tenant-scope.js';
const tenantDts = 'services/api/src/security/tenant-scope.d.ts';
const mainPath = 'services/api/src/main.ts';
const tsconfigPath = 'services/api/tsconfig.json';
const auditPath = 'scripts/api-build-artifact-audit.mjs';

assert.ok(existsSync(tenantTs), 'tenant-scope must be a TypeScript source file so tsc emits its runtime artifact');
assert.ok(!existsSync(tenantJs), 'JS-only tenant-scope source must not shadow the emitted runtime module');
assert.ok(!existsSync(tenantDts), 'stale declaration file must not conceal missing JS emission');
assert.match(readFileSync(mainPath, 'utf8'), /from ['"]\.\/security\/tenant-scope\.js['"]/, 'main imports the NodeNext .js runtime specifier');
const tsconfig = JSON.parse(readFileSync(tsconfigPath, 'utf8'));
assert.ok(tsconfig.include?.includes('src/**/*.ts'), 'tsconfig compiles the tenant-scope TypeScript file');
assert.match(readFileSync(auditPath, 'utf8'), /services\/api\/src\/security\/tenant-scope\.js/, 'post-build audit must require emitted tenant-scope runtime module');
assert.match(readFileSync(auditPath, 'utf8'), /Relative runtime imports checked:/, 'post-build audit must validate relative imports across emitted JS modules');

// Exercise the actual build audit in a temporary fixture that mimics the missing-artifact
// failure Render previously allowed to pass. The test has no dependency on a live database.
import { mkdtempSync, mkdirSync, writeFileSync, copyFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';

const fixture = mkdtempSync(join(tmpdir(), 'clinai-render-build-audit-'));
try {
  const fixtureScripts = join(fixture, 'scripts');
  const apiBuild = join(fixture, 'services/api/build');
  const mainDir = join(apiBuild, 'services/api/src');
  const securityDir = join(mainDir, 'security');
  const packageDir = join(apiBuild, 'packages/module-contracts');
  mkdirSync(fixtureScripts, { recursive: true });
  mkdirSync(securityDir, { recursive: true });
  mkdirSync(packageDir, { recursive: true });
  copyFileSync(auditPath, join(fixtureScripts, 'api-build-artifact-audit.mjs'));
  writeFileSync(join(mainDir, 'main.js'), "import { rowsForOrganization } from './security/tenant-scope.js';\n");
  writeFileSync(join(packageDir, 'contracts.json'), '{\"modules\":[]}');

  const missingRequiredModule = spawnSync(process.execPath, [join(fixtureScripts, 'api-build-artifact-audit.mjs')], { encoding: 'utf8' });
  assert.notEqual(missingRequiredModule.status, 0, 'build audit must fail when tenant-scope was not emitted');
  assert.match(missingRequiredModule.stderr, /Required API runtime artifact missing: services\/api\/build\/services\/api\/src\/security\/tenant-scope\.js/);

  writeFileSync(join(securityDir, 'tenant-scope.js'), 'export function rowsForOrganization() { return []; }\n');
  const completeFixture = spawnSync(process.execPath, [join(fixtureScripts, 'api-build-artifact-audit.mjs')], { encoding: 'utf8' });
  assert.equal(completeFixture.status, 0, `complete build fixture should pass: ${completeFixture.stderr}`);
  assert.match(completeFixture.stdout, /API_BUILD_ARTIFACT_PASS/);

  writeFileSync(join(mainDir, 'route.js'), "import './nonexistent-route-helper.js';\n");
  const missingNestedModule = spawnSync(process.execPath, [join(fixtureScripts, 'api-build-artifact-audit.mjs')], { encoding: 'utf8' });
  assert.notEqual(missingNestedModule.status, 0, 'build audit must fail on any missing transitive relative import');
  assert.match(missingNestedModule.stderr, /API runtime import target missing: .\/nonexistent-route-helper\.js/);
} finally {
  rmSync(fixture, { recursive: true, force: true });
}

console.log('RENDER_RUNTIME_ARTIFACT_AUDIT_PASS');

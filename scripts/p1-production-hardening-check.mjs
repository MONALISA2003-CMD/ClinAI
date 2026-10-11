import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import { resolveRuntimeConfig } from '../services/api/src/config/runtime-config.ts';

const root = process.cwd();
const productionEnvironment = {
  NODE_ENV: 'production',
  DATABASE_URL: 'postgresql://clinai:example@db.example.com:5432/clinai?sslmode=require',
  JWT_SECRET: 'example-production-only-secret-with-40-bytes',
  JWT_ISSUER: 'https://api.example.health',
  JWT_AUDIENCE: 'clinai-api-prod',
  CLINAI_ALLOWED_ORIGINS: 'https://app.example.health,https://patient.example.health',
  PUBLIC_BASE_URL: 'https://api.example.health',
  CLINAI_PUBLIC_TEST_DATA: 'false',
  CLINAI_PUBLIC_PREVIEW: 'false',
  CLINAI_ENABLE_DEMO_AUTH: 'false',
  CLINAI_ENABLE_RUNTIME_SCHEMA_DDL: 'false',
  CLINAI_ENFORCE_SCHEMA_MIGRATION_HISTORY: 'true',
};

test('production config fails closed when required configuration is missing', () => {
  assert.throws(() => resolveRuntimeConfig({ NODE_ENV: 'production' }), /Invalid production runtime configuration/);
});

test('production accepts explicit origins and disables startup DDL', () => {
  const config = resolveRuntimeConfig(productionEnvironment);
  assert.equal(config.isProduction, true);
  assert.deepEqual(config.allowedOrigins, ['https://app.example.health', 'https://patient.example.health']);
  assert.equal(config.runtimeSchemaDdlEnabled, false);
  assert.equal(config.publicTestDataEnabled, false);
  assert.equal(config.enforceMigrationHistory, true);
  assert.equal(config.jwtIssuer, 'https://api.example.health');
  assert.equal(config.jwtAudience, 'clinai-api-prod');
});

test('production rejects weak secrets, wildcard/path origins and non-TLS database URLs', () => {
  assert.throws(() => resolveRuntimeConfig({ ...productionEnvironment, JWT_SECRET: 'short' }), /JWT_SECRET/);
  assert.throws(() => resolveRuntimeConfig({ ...productionEnvironment, CLINAI_ALLOWED_ORIGINS: '*' }), /exact origins/);
  assert.throws(() => resolveRuntimeConfig({ ...productionEnvironment, CLINAI_ALLOWED_ORIGINS: 'https://app.example.health/path' }), /exact origins/);
  assert.throws(() => resolveRuntimeConfig({ ...productionEnvironment, DATABASE_URL: 'postgresql://clinai:example@db.example.com:5432/clinai' }), /sslmode/);
});

test('production refuses public demo, preview mode, demo auth and runtime DDL', () => {
  assert.throws(() => resolveRuntimeConfig({ ...productionEnvironment, CLINAI_PUBLIC_TEST_DATA: 'true' }), /CLINAI_PUBLIC_TEST_DATA=false/);
  assert.throws(() => resolveRuntimeConfig({ ...productionEnvironment, CLINAI_PUBLIC_PREVIEW: 'true' }), /CLINAI_PUBLIC_PREVIEW=false/);
  assert.throws(() => resolveRuntimeConfig({ ...productionEnvironment, CLINAI_ENABLE_DEMO_AUTH: 'true' }), /CLINAI_ENABLE_DEMO_AUTH/);
  assert.throws(() => resolveRuntimeConfig({ ...productionEnvironment, CLINAI_ENABLE_RUNTIME_SCHEMA_DDL: 'true' }), /CLINAI_ENABLE_RUNTIME_SCHEMA_DDL/);
});

test('development uses no known fallback secret and runtime DDL is off by default', () => {
  const first = resolveRuntimeConfig({ NODE_ENV: 'development' });
  const second = resolveRuntimeConfig({ NODE_ENV: 'development' });
  assert.notEqual(first.jwtSecret, 'clinai-local-development-secret');
  assert.notEqual(first.jwtSecret, second.jwtSecret);
  assert.equal(first.runtimeSchemaDdlEnabled, false);
  assert.ok(first.allowedOrigins.includes('http://localhost:3000'));
});

test('migration manifest checksums and production safeguards are valid', async () => {
  const sql = await readFile(path.join(root, 'database/migrations/034-runtime-schema-consolidation.sql'));
  const manifest = JSON.parse(await readFile(path.join(root, 'database/migrations/manifest.json'), 'utf8'));
  assert.equal(manifest.schemaVersion, 1);
  const record = manifest.migrations.find((item) => item.version === '034-runtime-schema-consolidation');
  assert.ok(record);
  assert.equal(createHash('sha256').update(sql).digest('hex'), record.sha256);
  const main = await readFile(path.join(root, 'services/api/src/main.ts'), 'utf8');
  assert.match(main, new RegExp(`REQUIRED_SCHEMA_MIGRATION_SHA256 = '${record.sha256}'`));
  assert.match(main, /result\.rows\[0\]\.checksum !== REQUIRED_SCHEMA_MIGRATION_SHA256/);
  const runner = await readFile(path.join(root, 'scripts/db-migrate.mjs'), 'utf8');
  assert.match(runner, /const planOnly = !apply/);
  assert.match(runner, /--allow-production/);
  assert.match(runner, /CLINAI_ALLOW_PRODUCTION_MIGRATIONS/);
  assert.match(runner, /pg_advisory_lock/);
  assert.match(runner, /BEGIN/);
  assert.match(runner, /ROLLBACK/);
});

test('known unsafe production fallbacks and browser offline replay are blocked', async () => {
  const main = await readFile(path.join(root, 'services/api/src/main.ts'), 'utf8');
  const offline = await readFile(path.join(root, 'apps/web/lib/offline.ts'), 'utf8');
  const page = await readFile(path.join(root, 'apps/web/app/page.tsx'), 'utf8');
  const sw = await readFile(path.join(root, 'apps/web/public/sw.js'), 'utf8');
  assert.doesNotMatch(main, /clinai-local-development-secret/);
  assert.doesNotMatch(main, /cors,\s*\{\s*origin:\s*true/);
  assert.match(main, /runtimeConfig\.jwtSecret/);
  assert.match(main, /assertRequiredSchemaMigrationHistory/);
  assert.match(main, /if \(RUNTIME_SCHEMA_DDL_ENABLED\) await ensureRuntimeSchema\(\)/);
  assert.match(main, /if \(!PRODUCTION\) await loadStore\(\)/);
  assert.match(main, /function canWrite\(req:any\)\{ return !req\.user\?\.publicSynthetic/);
  assert.match(main, /organizationId,role:'viewer',publicSynthetic:true/);
  assert.doesNotMatch(main, /organizationId,role:'admin',publicSynthetic:true/);
  const testSessionQuery = main.match(/app\.post\('\/api\/public\/test-session'[\s\S]*?const orgQ=await pool\.query\(`([^`]+)`\)/)?.[1] || '';
  assert.match(testSessionQuery, /GROUP BY p\.organization_id HAVING COUNT\(\*\) FILTER/);
  assert.match(testSessionQuery, /COUNT\(\*\) FILTER \(WHERE p\.is_test_data=true AND p\.email ILIKE '%@clinaidemoemail\.com'\)::int AS synthetic/);
  assert.doesNotMatch(testSessionQuery, /FROM patients p WHERE p\.is_test_data=true/);
  assert.match(offline, /return false/);
  assert.match(offline, /return \[\]/);
  assert.match(offline, /return 0/);
  assert.match(page, /NOT SAVED: Offline clinical changes are disabled/);
  assert.match(page, /READ-ONLY DEMO/);
  assert.doesNotMatch(page, /SAVED FOR SYNC/);
  assert.match(sw, /const isStaticAsset/);
  assert.match(sw, /if \(!isStaticAsset\) return/);
  assert.doesNotMatch(sw, /caches\.match\('\/'\)/);
});

#!/usr/bin/env node
/**
 * ClinAI's explicit, checksum-validated database migration entry point.
 * It is intentionally plan-only unless --apply is provided.
 */
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '..');
const manifestPath = path.join(root, 'database/migrations/manifest.json');
const apply = process.argv.includes('--apply');
const allowProduction = process.argv.includes('--allow-production');
const planOnly = !apply || process.argv.includes('--plan');
const isProduction = process.env.NODE_ENV === 'production';
const ADVISORY_LOCK_KEY = 'clinai_schema_migrations_v1';
const BASE_TABLES_REQUIRED_BY_P1 = [
  'public.organizations',
  'public.users',
  'public.patients',
  'public.facilities',
  'public.encounters',
  'public.appointments',
  'public.notifications',
  'public.idempotency_keys',
  'public.insurance_policies',
  'public.population_cohorts',
  'public.surveillance_cases',
  'public.surveillance_events',
];

function say(message) { process.stdout.write(`${message}\n`); }
function fail(message, code = 1) {
  process.stderr.write(`Migration ${planOnly ? 'plan' : 'apply'} failed: ${message}\n`);
  process.exitCode = code;
}

async function loadManifest() {
  const raw = await readFile(manifestPath, 'utf8');
  const manifest = JSON.parse(raw);
  if (manifest.schemaVersion !== 1 || !Array.isArray(manifest.migrations) || manifest.migrations.length === 0) {
    throw new Error('Migration manifest has an unsupported shape or contains no migrations.');
  }
  const ids = new Set();
  for (const migration of manifest.migrations) {
    if (!/^[a-z0-9][a-z0-9-]+$/.test(migration.version) || ids.has(migration.version)) {
      throw new Error(`Invalid or duplicate migration version: ${migration.version}`);
    }
    ids.add(migration.version);
    if (path.basename(migration.file) !== migration.file || !migration.file.endsWith('.sql')) {
      throw new Error(`Migration ${migration.version} must use a single SQL filename.`);
    }
    const sqlPath = path.join(root, 'database/migrations', migration.file);
    const sql = await readFile(sqlPath, 'utf8');
    const checksum = createHash('sha256').update(sql).digest('hex');
    if (checksum !== migration.sha256) {
      throw new Error(`Checksum mismatch for ${migration.version}; migration files are immutable after registration.`);
    }
    migration.sql = sql;
  }
  return manifest.migrations;
}

async function main() {
  if (isProduction && apply && (!allowProduction || process.env.CLINAI_ALLOW_PRODUCTION_MIGRATIONS !== 'true')) {
    throw new Error('Production apply requires both --allow-production and CLINAI_ALLOW_PRODUCTION_MIGRATIONS=true. Use --plan to inspect first.');
  }
  if (isProduction && !apply) {
    say('Production-safe plan mode: no schema writes will be performed.');
  }

  const migrations = await loadManifest();
  say(`Loaded and checksum-verified ${migrations.length} registered migration(s).`);
  say('Legacy migration files remain preserved but are not auto-replayed; their duplicate version numbers and deployed-schema provenance require separate baseline reconciliation.');

  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    say('DATABASE_URL is not set; local manifest-only validation completed. Database state was not inspected.');
    if (apply) throw new Error('DATABASE_URL is required with --apply.');
    return;
  }

  const { default: pg } = await import('pg');
  const { Pool } = pg;
  const pool = new Pool({ connectionString, max: 1, connectionTimeoutMillis: 10000, idleTimeoutMillis: 1000 });
  let client;
  try {
    client = await pool.connect();
    await client.query('SELECT 1');

    const prereqResult = await client.query(
      `SELECT requested.name, to_regclass(requested.name) IS NOT NULL AS present
       FROM unnest($1::text[]) AS requested(name)`,
      [BASE_TABLES_REQUIRED_BY_P1],
    );
    const missingPrereqs = prereqResult.rows.filter((row) => !row.present).map((row) => row.name);
    if (missingPrereqs.length) {
      say(`Schema prerequisite tables missing: ${missingPrereqs.join(', ')}`);
      say('Do not apply until the existing schema/migration provenance has been reconciled on a disposable or staging database.');
      if (apply) throw new Error('Base-table prerequisite check failed. No migration was applied.');
    } else {
      say(`Base-table prerequisite check passed (${BASE_TABLES_REQUIRED_BY_P1.length} tables).`);
    }

    const tableResult = await client.query("SELECT to_regclass('public.clinai_schema_migrations') AS table_name");
    const historyExists = Boolean(tableResult.rows[0]?.table_name);
    const applied = new Map();
    if (historyExists) {
      const history = await client.query('SELECT version, checksum, status, applied_at FROM public.clinai_schema_migrations ORDER BY version');
      for (const row of history.rows) applied.set(row.version, row);
    } else {
      say('Migration history table does not exist yet; this is expected for an uninitialized P1 migration ledger.');
    }

    const pending = [];
    for (const migration of migrations) {
      const existing = applied.get(migration.version);
      if (existing && existing.checksum !== migration.sha256) {
        throw new Error(`Applied checksum for ${migration.version} differs from the manifest; manual reconciliation is required.`);
      }
      if (existing?.status === 'applied') {
        say(`APPLIED  ${migration.version}  ${existing.applied_at || ''}`);
      } else {
        say(`PENDING  ${migration.version}  sha256:${migration.sha256}`);
        pending.push(migration);
      }
    }

    if (planOnly) {
      say(`Plan complete. Pending registered migrations: ${pending.length}. No schema writes were performed.`);
      if (missingPrereqs.length) process.exitCode = 2;
      return;
    }
    if (missingPrereqs.length) throw new Error('Cannot apply while required base tables are missing.');
    if (pending.length === 0) {
      say('No pending migrations.');
      return;
    }

    await client.query('SELECT pg_advisory_lock(hashtext($1))', [ADVISORY_LOCK_KEY]);
    try {
      await client.query('CREATE TABLE IF NOT EXISTS public.clinai_schema_migrations (version text PRIMARY KEY, checksum text NOT NULL, status text NOT NULL CHECK (status IN (\'applied\')), applied_at timestamptz NOT NULL DEFAULT now(), execution_mode text NOT NULL)');
      // Refresh ledger after acquiring the lock so concurrent runners cannot
      // both act on a stale pending list.
      const lockedHistory = await client.query('SELECT version, checksum, status FROM public.clinai_schema_migrations ORDER BY version');
      const lockedApplied = new Map(lockedHistory.rows.map((row) => [row.version, row]));
      const pendingAfterLock = migrations.filter((migration) => {
        const existing = lockedApplied.get(migration.version);
        if (existing && existing.checksum !== migration.sha256) {
          throw new Error(`Applied checksum for ${migration.version} differs from the manifest; manual reconciliation is required.`);
        }
        return existing?.status !== 'applied';
      });
      if (pendingAfterLock.length === 0) {
        say('No pending migrations after acquiring the advisory lock.');
        return;
      }
      for (const migration of pendingAfterLock) {
        say(`APPLYING ${migration.version}`);
        await client.query('BEGIN');
        try {
          // No user input is interpolated: SQL is read from a checksum-verified, versioned source file.
          await client.query(migration.sql);
          await client.query(
            `INSERT INTO public.clinai_schema_migrations(version, checksum, status, execution_mode)
             VALUES ($1, $2, 'applied', $3)`,
            [migration.version, migration.sha256, isProduction ? 'explicit-production-cli' : 'explicit-cli'],
          );
          await client.query('COMMIT');
          say(`APPLIED  ${migration.version}`);
        } catch (error) {
          await client.query('ROLLBACK').catch(() => {});
          throw error;
        }
      }
      say('All registered migrations applied. Legacy migration reconciliation is still a separate required gate.');
    } finally {
      await client.query('SELECT pg_advisory_unlock(hashtext($1))', [ADVISORY_LOCK_KEY]).catch(() => {});
    }
  } finally {
    client?.release();
    await pool.end();
  }
}

main().catch((error) => fail(error instanceof Error ? error.message : String(error)));

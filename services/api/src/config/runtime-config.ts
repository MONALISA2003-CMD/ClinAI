import { randomBytes } from 'node:crypto';

export interface ClinAIRuntimeConfig {
  isProduction: boolean;
  databaseUrl?: string;
  jwtSecret: string;
  jwtIssuer: string;
  jwtAudience: string;
  allowedOrigins: string[];
  publicBaseUrl: string;
  port: number;
  publicTestDataEnabled: boolean;
  demoAuthEnabled: boolean;
  jsonStorePath: string;
  runtimeSchemaDdlEnabled: boolean;
  enforceMigrationHistory: boolean;
}

const DEVELOPMENT_ORIGINS = ['http://localhost:3000', 'http://127.0.0.1:3000'];
const DEVELOPMENT_BASE_URL = 'http://localhost:4000';
const DEVELOPMENT_AUDIENCE = 'clinai-api';

function parseOriginList(raw: string | undefined, isProduction: boolean): string[] {
  const values = (raw || '').split(',').map((value) => value.trim()).filter(Boolean);
  const origins = values.length ? values : (isProduction ? [] : DEVELOPMENT_ORIGINS);
  const result: string[] = [];

  for (const origin of origins) {
    let parsed: URL;
    try {
      parsed = new URL(origin);
    } catch {
      throw new Error('Invalid runtime configuration: CLINAI_ALLOWED_ORIGINS must contain exact origins.');
    }
    if (parsed.origin !== origin || parsed.username || parsed.password || parsed.pathname !== '/' || parsed.search || parsed.hash) {
      throw new Error('Invalid runtime configuration: CLINAI_ALLOWED_ORIGINS must contain exact origins, not paths or credentials.');
    }
    if (origin === '*' || (isProduction && parsed.protocol !== 'https:')) {
      throw new Error('Invalid runtime configuration: production allowed origins must be explicit HTTPS origins.');
    }
    if (!result.includes(origin)) result.push(origin);
  }

  return result;
}

function parseBaseUrl(raw: string | undefined, isProduction: boolean): string {
  const value = (raw || '').trim() || (isProduction ? '' : DEVELOPMENT_BASE_URL);
  if (!value) throw new Error('Invalid production runtime configuration: PUBLIC_BASE_URL is required.');

  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    throw new Error('Invalid runtime configuration: PUBLIC_BASE_URL must be an absolute URL.');
  }
  if (parsed.username || parsed.password || parsed.search || parsed.hash || (isProduction && parsed.protocol !== 'https:')) {
    throw new Error('Invalid runtime configuration: PUBLIC_BASE_URL must be a safe absolute HTTPS URL in production.');
  }
  return value.replace(/\/$/, '');
}

function validateDatabaseUrl(raw: string | undefined): string | undefined {
  if (!raw?.trim()) return undefined;
  let parsed: URL;
  try {
    parsed = new URL(raw);
  } catch {
    throw new Error('Invalid runtime configuration: DATABASE_URL must be a PostgreSQL connection URL.');
  }
  if (!['postgres:', 'postgresql:'].includes(parsed.protocol)) {
    throw new Error('Invalid runtime configuration: DATABASE_URL must use postgres:// or postgresql://.');
  }
  return raw;
}

export function resolveRuntimeConfig(env: Record<string, string | undefined> = process.env): ClinAIRuntimeConfig {
  const isProduction = env.NODE_ENV === 'production';
  const databaseUrl = validateDatabaseUrl(env.DATABASE_URL);
  const rawSecret = env.JWT_SECRET?.trim();
  const jwtSecret = rawSecret || (isProduction ? '' : randomBytes(48).toString('base64url'));
  const publicBaseUrl = parseBaseUrl(env.PUBLIC_BASE_URL, isProduction);
  const jwtIssuer = env.JWT_ISSUER?.trim() || (isProduction ? '' : publicBaseUrl);
  const jwtAudience = env.JWT_AUDIENCE?.trim() || (isProduction ? '' : DEVELOPMENT_AUDIENCE);
  const allowedOrigins = parseOriginList(env.CLINAI_ALLOWED_ORIGINS, isProduction);
  const port = Number(env.PORT || 4000);

  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error('Invalid runtime configuration: PORT must be an integer from 1 to 65535.');
  }

  if (isProduction) {
    const missing: string[] = [];
    if (!databaseUrl) missing.push('DATABASE_URL');
    if (!rawSecret || Buffer.byteLength(rawSecret, 'utf8') < 32) missing.push('JWT_SECRET (at least 32 bytes)');
    if (!env.JWT_ISSUER?.trim()) missing.push('JWT_ISSUER');
    if (!env.JWT_AUDIENCE?.trim()) missing.push('JWT_AUDIENCE');
    if (!env.CLINAI_ALLOWED_ORIGINS?.trim()) missing.push('CLINAI_ALLOWED_ORIGINS');
    if (!env.PUBLIC_BASE_URL?.trim()) missing.push('PUBLIC_BASE_URL');
    if (env.CLINAI_PUBLIC_TEST_DATA !== 'false') missing.push('CLINAI_PUBLIC_TEST_DATA=false');
    if (env.CLINAI_PUBLIC_PREVIEW !== 'false') missing.push('CLINAI_PUBLIC_PREVIEW=false');
    if (env.CLINAI_ENABLE_DEMO_AUTH === 'true') missing.push('CLINAI_ENABLE_DEMO_AUTH must not be true');
    if (env.CLINAI_STORE?.trim()) missing.push('CLINAI_STORE must not be set');
    if (env.CLINAI_ENABLE_RUNTIME_SCHEMA_DDL === 'true') missing.push('CLINAI_ENABLE_RUNTIME_SCHEMA_DDL must not be true');
    if (env.CLINAI_ENFORCE_SCHEMA_MIGRATION_HISTORY !== 'true') missing.push('CLINAI_ENFORCE_SCHEMA_MIGRATION_HISTORY=true');
    if (databaseUrl) {
      const db = new URL(databaseUrl);
      const sslMode = (db.searchParams.get('sslmode') || '').toLowerCase();
      if (!['require', 'verify-ca', 'verify-full'].includes(sslMode)) missing.push('DATABASE_URL sslmode=require (or verify-ca/verify-full)');
    }
    if (missing.length) {
      throw new Error(`Invalid production runtime configuration: ${missing.join(', ')} must be configured before the service can start.`);
    }
  } else if (jwtSecret && Buffer.byteLength(jwtSecret, 'utf8') < 32) {
    throw new Error('Invalid runtime configuration: JWT_SECRET must be at least 32 bytes when provided.');
  }

  return {
    isProduction,
    databaseUrl,
    jwtSecret,
    jwtIssuer,
    jwtAudience,
    allowedOrigins,
    publicBaseUrl,
    port,
    publicTestDataEnabled: env.CLINAI_PUBLIC_TEST_DATA !== 'false',
    demoAuthEnabled: !isProduction && env.CLINAI_ENABLE_DEMO_AUTH === 'true',
    jsonStorePath: env.CLINAI_STORE?.trim() || '.clinai-data/store.json',
    runtimeSchemaDdlEnabled: !isProduction && env.CLINAI_ENABLE_RUNTIME_SCHEMA_DDL === 'true',
    enforceMigrationHistory: isProduction || env.CLINAI_ENFORCE_SCHEMA_MIGRATION_HISTORY === 'true',
  };
}

import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import yaml from 'js-yaml';

const REPO_ROOT = path.resolve(__dirname, '../../../..');

function read(rel: string): string {
  return fs.readFileSync(path.join(REPO_ROOT, rel), 'utf8');
}

function envKeysFromEnvSchema(source: string): Set<string> {
  const keys = new Set<string>();
  const schemaStart = source.indexOf('export const envSchema = z.object({');
  const schemaEnd = source.indexOf('\n});', schemaStart);
  const schemaSource = source.slice(schemaStart, schemaEnd);
  const schemaKeyRe = /^\s{2}([A-Z][A-Z0-9_]*):/gm;
  let schemaMatch: RegExpExecArray | null;
  while ((schemaMatch = schemaKeyRe.exec(schemaSource)) !== null) {
    if (schemaMatch[1]) keys.add(schemaMatch[1]);
  }

  return keys;
}

function envKeysForService(compose: string, service: 'api' | 'worker'): Set<string> {
  const doc = yaml.load(compose) as {
    services?: Record<string, { environment?: Record<string, unknown> }>;
  };
  return new Set(Object.keys(doc.services?.[service]?.environment ?? {}));
}

const API_ONLY_ENV = new Map<string, string>([
  ['PORT', 'api internal HTTP listener; worker exposes WORKER_PORT instead'],
  ['SUPERADMIN_EMAIL', 'api boot seeder owns SuperAdmin bootstrap'],
  ['SUPERADMIN_PASSWORD', 'api boot seeder owns SuperAdmin bootstrap'],
]);

const WORKER_ONLY_ENV = new Map<string, string>([
  ['WORKER_CONCURRENCY', 'worker queue consumers need concurrency tuning'],
  ['WORKER_PORT', 'worker-only internal health endpoint'],
]);

const WEB_ONLY_ENV = new Map<string, string>([
  ['WEB_PORT', 'web host port is compose/web-only'],
  ['API_INTERNAL_URL', 'web SSR reverse proxy target only'],
]);

const COMPOSE_ONLY_ENV = new Map<string, string>([
  ['POSTGRES_USER', 'postgres container provisioning only'],
  ['POSTGRES_PASSWORD', 'postgres container provisioning only'],
  ['POSTGRES_DB', 'postgres container provisioning only'],
  ['API_PORT', 'api host-port mapping only'],
  ['VITE_API_BASE_URL', 'client build argument only'],
  ['VITE_SITE_URL', 'client build argument only'],
  ['VITE_SOCKET_URL', 'client build argument only'],
  ['TEST_REDIS_URL', 'test runner override only'],
]);

const SERVICE_SPECIFIC_ALLOWLIST = new Set([
  ...API_ONLY_ENV.keys(),
  ...WORKER_ONLY_ENV.keys(),
  ...WEB_ONLY_ENV.keys(),
  ...COMPOSE_ONLY_ENV.keys(),
]);

describe('docker-compose env parity (api / worker)', () => {
  const compose = read('docker-compose.yml');
  const apiKeys = envKeysForService(compose, 'api');
  const workerKeys = envKeysForService(compose, 'worker');

  it('forwards every shared runtime var to BOTH api and worker blocks', () => {
    const schemaKeys = envKeysFromEnvSchema(read('server/src/config/env.ts'));
    const shared = [...schemaKeys].filter((key) => !SERVICE_SPECIFIC_ALLOWLIST.has(key));

    for (const key of shared) {
      expect(apiKeys.has(key), `api missing ${key}`).toBe(true);
      expect(workerKeys.has(key), `worker missing ${key}`).toBe(true);
    }
  });

  it('keeps deliberate single-service vars OUT of the other block', () => {
    for (const [key, reason] of API_ONLY_ENV) {
      expect(workerKeys.has(key), `${key} must stay api-only: ${reason}`).toBe(false);
    }
    for (const [key, reason] of WORKER_ONLY_ENV) {
      expect(apiKeys.has(key), `${key} must stay worker-only: ${reason}`).toBe(false);
    }
  });
});

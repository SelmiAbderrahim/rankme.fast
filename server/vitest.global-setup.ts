/**
 * Global test setup — real Redis for the queue suites.
 *
 * DECISION: BullMQ executes Lua scripts and blocking stream reads that no
 * in-process mock reproduces faithfully, so queue tests run against a REAL
 * Redis:
 *
 *   1. `TEST_REDIS_URL` set (CI: a `redis:7-alpine` service container,
 *      `redis://redis:6379`) → use it as-is.
 *   2. Otherwise (dev host) → start a throwaway `redis:7-alpine` container
 *      on an ephemeral loopback port via the Docker CLI (Testcontainers
 *      without the dependency) and remove it on teardown.
 *
 * Queue tests read the URL via shared/testing/redis.ts and isolate
 * themselves in Redis db 15 with a flush per suite.
 *
 * This file is test tooling (like vitest.config.ts) — coverage-excluded.
 */
import { execFileSync } from 'node:child_process';

let containerId: string | null = null;

function docker(...args: string[]): string {
  return execFileSync('docker', args, { encoding: 'utf8' }).trim();
}

export async function setup(): Promise<void> {
  if (process.env.TEST_REDIS_URL) return;

  try {
    containerId = docker(
      'run',
      '--rm',
      '-d',
      '-p',
      '127.0.0.1:0:6379',
      'redis:7-alpine',
    );
  } catch (err) {
    throw new Error(
      'Queue tests need Redis: set TEST_REDIS_URL or make the Docker CLI available ' +
        `(failed to start redis:7-alpine: ${err instanceof Error ? err.message : String(err)})`,
    );
  }

  // "0.0.0.0:49153" (or multiple lines with IPv6) → take the first port.
  const portLine = docker('port', containerId, '6379/tcp').split('\n')[0];
  const port = portLine.slice(portLine.lastIndexOf(':') + 1);
  const url = `redis://127.0.0.1:${port}`;

  // Wait for readiness — redis:7-alpine boots in well under 5s.
  const deadline = Date.now() + 30_000;
  for (;;) {
    try {
      docker('exec', containerId, 'redis-cli', 'ping');
      break;
    } catch {
      if (Date.now() > deadline) {
        throw new Error('ephemeral test Redis did not become ready within 30s');
      }
      await new Promise((resolve) => setTimeout(resolve, 250));
    }
  }

  // globalSetup runs in the main vitest process before workers fork — env
  // set here propagates to every test worker.
  process.env.TEST_REDIS_URL = url;
}

export async function teardown(): Promise<void> {
  if (containerId) {
    try {
      docker('stop', containerId); // --rm removes it
    } catch {
      // container already gone — nothing to clean
    }
    containerId = null;
  }
}

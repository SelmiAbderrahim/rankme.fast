import type { AddressInfo } from 'node:net';
import type http from 'node:http';
import { pino } from 'pino';
import { afterEach, describe, expect, it } from 'vitest';
import {
  runHealthChecks,
  runHealthReport,
  startHealthServer,
  type QueueSnapshot,
} from './index.js';

const logger = pino({ level: 'silent' });

let server: http.Server | null = null;

afterEach(async () => {
  if (server) {
    await new Promise<void>((resolve) => server!.close(() => resolve()));
    server = null;
  }
});

describe('runHealthChecks', () => {
  it('ok when every check passes', async () => {
    const report = await runHealthChecks({
      redis: async () => true,
      mongo: async () => true,
    });
    expect(report).toEqual({ status: 'ok', checks: { redis: true, mongo: true } });
  });

  it('degraded when a check returns false', async () => {
    const report = await runHealthChecks({
      redis: async () => true,
      postgres: async () => false,
    });
    expect(report).toEqual({ status: 'degraded', checks: { redis: true, postgres: false } });
  });

  it('degraded when a check throws (down ≠ crash)', async () => {
    const report = await runHealthChecks({
      redis: async () => {
        throw new Error('ECONNREFUSED');
      },
      mongo: async () => true,
    });
    expect(report).toEqual({ status: 'degraded', checks: { redis: false, mongo: true } });
  });
});

describe('startHealthServer', () => {
  async function boot(checks: Parameters<typeof runHealthChecks>[0]) {
    server = await startHealthServer({ port: 0, logger, checks });
    const { port } = server.address() as AddressInfo;
    return `http://127.0.0.1:${port}`;
  }

  it('serves 200 + report when healthy', async () => {
    const base = await boot({ redis: async () => true });
    const res = await fetch(`${base}/healthz`);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ status: 'ok', checks: { redis: true } });
  });

  it('serves 503 when a dependency is down', async () => {
    const base = await boot({ redis: async () => true, mongo: async () => false });
    const res = await fetch(`${base}/healthz`);
    expect(res.status).toBe(503);
    expect(await res.json()).toEqual({
      status: 'degraded',
      checks: { redis: true, mongo: false },
    });
  });

  it('404s everything that is not GET /healthz or /health', async () => {
    const base = await boot({ redis: async () => true });
    expect((await fetch(`${base}/other`)).status).toBe(404);
    expect((await fetch(`${base}/healthz`, { method: 'POST' })).status).toBe(404);
    expect((await fetch(`${base}/health`, { method: 'POST' })).status).toBe(404);
  });
});

describe('runHealthReport (queue snapshot)', () => {
  const snapshot: QueueSnapshot = {
    audits: { waiting: 3, active: 1, failed: 2 },
    ranks: { waiting: 0, active: 0, failed: 0 },
    audienceResearch: { waiting: 2, active: 1, failed: 0 },
    weeklyPulse: { waiting: 1, active: 0, failed: 1 },
    competitorLandscapes: { waiting: 1, active: 1, failed: 0 },
    dlq: { size: 4, oldest: '2026-06-01T00:00:00.000Z' },
  };

  it('appends queues + dlq when a snapshot provider is wired', async () => {
    const report = await runHealthReport({
      checks: { redis: async () => true },
      queueSnapshot: async () => snapshot,
    });
    expect(report.status).toBe('ok');
    expect(report.queues).toEqual({
      audits: snapshot.audits,
      ranks: snapshot.ranks,
      audienceResearch: snapshot.audienceResearch,
      weeklyPulse: snapshot.weeklyPulse,
      competitorLandscapes: snapshot.competitorLandscapes,
    });
    expect(report.dlq).toEqual(snapshot.dlq);
  });

  it('leaves queues + dlq undefined when no snapshot provider is wired', async () => {
    const report = await runHealthReport({ checks: { redis: async () => true } });
    expect(report.queues).toBeUndefined();
    expect(report.dlq).toBeUndefined();
  });

  it('reports oldest as null when the DLQ is empty (status stays ok)', async () => {
    const report = await runHealthReport({
      checks: { redis: async () => true },
      queueSnapshot: async () => ({
        audits: { waiting: 0, active: 0, failed: 0 },
        ranks: { waiting: 0, active: 0, failed: 0 },
        audienceResearch: { waiting: 0, active: 0, failed: 0 },
        weeklyPulse: { waiting: 0, active: 0, failed: 0 },
        dlq: { size: 0, oldest: null },
      }),
    });
    expect(report.status).toBe('ok');
    expect(report.dlq).toEqual({ size: 0, oldest: null });
  });

  it('flips status to degraded when a datastore ping fails (empty queue does not)', async () => {
    const report = await runHealthReport({
      checks: {
        redis: async () => true,
        mongo: async () => false,
      },
      queueSnapshot: async () => snapshot,
    });
    expect(report.status).toBe('degraded');
    // Non-empty queues + failing datastore → still degraded.
    expect(report.queues).toBeDefined();
  });

  it('a snapshot provider throw does NOT flip status or crash the report', async () => {
    const report = await runHealthReport({
      checks: { redis: async () => true },
      queueSnapshot: async () => {
        throw new Error('redis timeout');
      },
    });
    // status derives only from the datastore pings.
    expect(report.status).toBe('ok');
    expect(report.queues).toBeUndefined();
    expect(report.dlq).toBeUndefined();
  });
});

describe('GET /health (full report)', () => {
  async function bootWithQueues(
    checks: Parameters<typeof runHealthChecks>[0],
    snap: QueueSnapshot,
  ) {
    server = await startHealthServer({
      port: 0,
      logger,
      checks,
      queueSnapshot: async () => snap,
    });
    const { port } = server.address() as AddressInfo;
    return `http://127.0.0.1:${port}`;
  }

  it('serves queue depths + DLQ size + oldest when healthy', async () => {
    const base = await bootWithQueues(
      { redis: async () => true },
      {
        audits: { waiting: 5, active: 1, failed: 2 },
        ranks: { waiting: 0, active: 0, failed: 0 },
        audienceResearch: { waiting: 4, active: 2, failed: 1 },
        weeklyPulse: { waiting: 2, active: 0, failed: 0 },
        dlq: { size: 3, oldest: '2026-06-02T00:00:00.000Z' },
      },
    );
    const res = await fetch(`${base}/health`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      status: string;
      queues: {
        audits: unknown;
        ranks: unknown;
        audienceResearch: unknown;
        weeklyPulse: unknown;
      };
      dlq: { size: number; oldest: string | null };
    };
    expect(body.status).toBe('ok');
    expect(body.queues.audits).toEqual({ waiting: 5, active: 1, failed: 2 });
    expect(body.queues.audienceResearch).toEqual({ waiting: 4, active: 2, failed: 1 });
    expect(body.queues.weeklyPulse).toEqual({ waiting: 2, active: 0, failed: 0 });
    expect(body.dlq).toEqual({ size: 3, oldest: '2026-06-02T00:00:00.000Z' });
  });

  it('reports 503 when a datastore is down but still includes queue depths', async () => {
    const base = await bootWithQueues(
      { redis: async () => true, mongo: async () => false },
      {
        audits: { waiting: 0, active: 0, failed: 0 },
        ranks: { waiting: 0, active: 0, failed: 0 },
        audienceResearch: { waiting: 0, active: 0, failed: 0 },
        weeklyPulse: { waiting: 0, active: 0, failed: 0 },
        dlq: { size: 0, oldest: null },
      },
    );
    const res = await fetch(`${base}/health`);
    expect(res.status).toBe(503);
    const body = (await res.json()) as {
      status: string;
      dlq: { size: number; oldest: string | null };
    };
    expect(body.status).toBe('degraded');
    expect(body.dlq).toEqual({ size: 0, oldest: null });
  });

  it('/healthz stays purely liveness even when queue snapshot is wired', async () => {
    const base = await bootWithQueues(
      { redis: async () => true },
      {
        audits: { waiting: 9, active: 0, failed: 0 },
        ranks: { waiting: 0, active: 0, failed: 0 },
        audienceResearch: { waiting: 0, active: 0, failed: 0 },
        weeklyPulse: { waiting: 0, active: 0, failed: 0 },
        dlq: { size: 1, oldest: '2026-06-02T00:00:00.000Z' },
      },
    );
    const res = await fetch(`${base}/healthz`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as Record<string, unknown>;
    expect(body.status).toBe('ok');
    expect(body.queues).toBeUndefined();
    expect(body.dlq).toBeUndefined();
  });
});

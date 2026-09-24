/**
 * Weekly Pulse — router integration tests (spec §11).
 *
 * Real Express app via `createApp()`, real PGlite Postgres, real
 * `mongodb-memory-server`, real Better Auth via the shared test auth
 * harness. Covers: auth 401, cross-account 404, preview purity
 * (no counter mutation), enable/disable idempotency, history cursor,
 * detail projection.
 */
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import type { NextFunction, Request, RequestHandler, Response } from 'express';
import type { Queue } from 'bullmq';
import { and, eq } from 'drizzle-orm';
import pino from 'pino';
import { createApp } from '../../app.js';
import {
  clearCollections,
  startMemoryMongo,
  stopMemoryMongo,
} from '../../shared/testing/mongo.js';
import {
  getTestDb,
  startTestPostgres,
  stopTestPostgres,
  truncateAllTables,
} from '../../shared/testing/postgres.js';
import {
  installTestAuth,
  signupVerifiedUser,
  uninstallTestAuth,
  type TestUser,
} from '../../shared/testing/auth.js';
import { setSitesDb } from '../sites/index.js';
import {
  setRateLimitMetricsDb,
  setRateLimitMetricsLogger,
} from '../../shared/middleware/rate-limit-metrics.js';
import {
  getPulseStateController,
  resolveWeeklyPulseDb,
  setPulseSubscriptionController,
  setWeeklyPulseDb,
  setWeeklyPulseQueue,
} from './weekly-pulse.controller.js';
import {
  sitePulseSettings,
  sitePulseSubscriptions,
  weeklyPulseCitationChanges,
  weeklyPulseCitations,
  weeklyPulseDigestProjections,
  weeklyPulseRuns,
} from '../../db/schema/weekly-pulse.js';

const app = createApp();

function fakeQueue() {
  const upserts: string[] = [];
  const removes: string[] = [];
  const queue = {
    async upsertJobScheduler(key: string) {
      upserts.push(key);
    },
    async removeJobScheduler(key: string) {
      removes.push(key);
      return true;
    },
  } as unknown as Queue;
  return { queue, upserts, removes };
}

async function addSite(user: TestUser, origin = 'https://example.com'): Promise<string> {
  const res = await request(app)
    .post('/api/sites')
    .set('Cookie', user.cookie)
    .send({ url: origin });
  return (res.body as { site: { id: string } }).site.id;
}

interface CapturedResponse {
  status: number | null;
  body: unknown;
  error: unknown;
}

interface FakeResponse {
  status(code: number): FakeResponse;
  json(body: unknown): FakeResponse;
}

/**
 * Invokes a controller outside Express. `asyncHandler` does not return its
 * promise, so the settle signal is the controller either answering through
 * `res.json` or handing an error to `next`.
 *
 * Used only for the two seams the router cannot reach: a request that arrives
 * without `req.user`, and one without a resolvable `req.language`.
 */
function callController(
  handler: RequestHandler,
  req: Partial<Request>,
): Promise<CapturedResponse> {
  return new Promise((resolve) => {
    let statusCode: number | null = null;
    const res: FakeResponse = {
      status(code) {
        statusCode = code;
        return res;
      },
      json(body) {
        resolve({ status: statusCode, body, error: null });
        return res;
      },
    };
    const next: NextFunction = ((error: unknown) => {
      resolve({ status: statusCode, body: null, error });
    }) as unknown as NextFunction;
    handler(req as Request, res as unknown as Response, next);
  });
}

beforeAll(async () => {
  await startMemoryMongo();
  await startTestPostgres();
  setSitesDb(getTestDb() as unknown as never);
  setWeeklyPulseDb(getTestDb() as unknown as never);
  setRateLimitMetricsDb(getTestDb() as unknown as never);
  setRateLimitMetricsLogger(pino({ level: 'silent' }));
  installTestAuth();
});

afterAll(async () => {
  uninstallTestAuth();
  setSitesDb(null);
  setWeeklyPulseDb(null);
  setWeeklyPulseQueue(null);
  setRateLimitMetricsDb(null);
  setRateLimitMetricsLogger(null);
  await stopTestPostgres();
  await stopMemoryMongo();
});

beforeEach(async () => {
  await clearCollections();
  await truncateAllTables();
  const { queue } = fakeQueue();
  setWeeklyPulseQueue(queue);
});

afterEach(() => {
  setWeeklyPulseQueue(null);
});

describe('/api/sites/:siteId/weekly-pulse — auth + ownership', () => {
  it('GET returns 401 without a cookie', async () => {
    const res = await request(app).get('/api/sites/aaaaaaaaaaaaaaaaaaaaaaaa/weekly-pulse');
    expect(res.status).toBe(401);
  });

  it('POST preview returns 401 without a cookie', async () => {
    const res = await request(app)
      .post('/api/sites/aaaaaaaaaaaaaaaaaaaaaaaa/weekly-pulse/preview')
      .send({});
    expect(res.status).toBe(401);
  });

  it('GET returns the pulse state for a site the caller owns', async () => {
    const user = await signupVerifiedUser(app, { email: 'state@example.com' });
    const siteId = await addSite(user);
    const res = await request(app)
      .get(`/api/sites/${siteId}/weekly-pulse`)
      .set('Cookie', user.cookie);
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      siteId,
      subscription: null,
      setting: null,
      lastRun: null,
    });
    expect(res.body.coverage).toEqual([
      {
        observationType: 'weekly_pulse',
        state: 'supported',
        coverageNoteKey: 'weeklyPulse.optIn.unitDisclosure',
      },
    ]);
  });

  it('GET on a site belonging to another account returns 404', async () => {
    const owner = await signupVerifiedUser(app, { email: 'own-a@example.com' });
    const siteId = await addSite(owner);

    const other = await signupVerifiedUser(app, { email: 'own-b@example.com' });

    const res = await request(app)
      .get(`/api/sites/${siteId}/weekly-pulse`)
      .set('Cookie', other.cookie);
    expect(res.status).toBe(404);
  });
});

describe('POST preview — purity', () => {
  it('returns the community SpendPreview and never runs the pulse', async () => {
    const user = await signupVerifiedUser(app, { email: 'pv@example.com' });
    const siteId = await addSite(user);
    const res = await request(app)
      .post(`/api/sites/${siteId}/weekly-pulse/preview`)
      .set('Cookie', user.cookie)
      .send({});
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ deploymentMode: 'community', capacityEnforced: false });
    // Preview MUST NOT run the pulse — no run row is written.
    const rows = await getTestDb()
      .select()
      .from(weeklyPulseRuns)
      .where(eq(weeklyPulseRuns.accountId, user.id));
    expect(rows).toHaveLength(0);
  });
});

describe('PUT — subscription mutation', () => {
  it('enable=true without acknowledgedPreviewAt returns 400', async () => {
    const user = await signupVerifiedUser(app, { email: 'noack@example.com' });
    const siteId = await addSite(user);
    const res = await request(app)
      .put(`/api/sites/${siteId}/weekly-pulse`)
      .set('Cookie', user.cookie)
      .send({ enabled: true });
    expect(res.status).toBe(400);
  });

  it('enable=true followed by disable=false leaves setting.enabled=false', async () => {
    const user = await signupVerifiedUser(app, { email: 'toggle@example.com' });
    const siteId = await addSite(user);
    const now = new Date().toISOString();
    const on = await request(app)
      .put(`/api/sites/${siteId}/weekly-pulse`)
      .set('Cookie', user.cookie)
      .send({ enabled: true, acknowledgedPreviewAt: now });
    expect(on.status).toBe(200);
    expect(on.body.subscription.enabled).toBe(true);
    expect(on.body.setting.enabled).toBe(true);

    const off = await request(app)
      .put(`/api/sites/${siteId}/weekly-pulse`)
      .set('Cookie', user.cookie)
      .send({ enabled: false });
    expect(off.status).toBe(200);
    expect(off.body.setting.enabled).toBe(false);

    const settings = await getTestDb()
      .select()
      .from(sitePulseSettings)
      .where(
        and(
          eq(sitePulseSettings.accountId, user.id),
          eq(sitePulseSettings.siteId, siteId),
        ),
      );
    expect(settings[0]!.enabled).toBe(false);
  });

  it('stores an explicit body locale as the delivery locale', async () => {
    const user = await signupVerifiedUser(app, { email: 'loc@example.com' });
    const siteId = await addSite(user);
    const res = await request(app)
      .put(`/api/sites/${siteId}/weekly-pulse`)
      // The request itself is English; the explicit body locale must win so
      // the digest arrives in the language the user consented to.
      .set('Accept-Language', 'en')
      .set('Cookie', user.cookie)
      .send({
        enabled: true,
        acknowledgedPreviewAt: new Date().toISOString(),
        locale: 'ar',
      });
    expect(res.status).toBe(200);
    expect(res.body.subscription.locale).toBe('ar');
    const rows = await getTestDb()
      .select()
      .from(sitePulseSubscriptions)
      .where(eq(sitePulseSubscriptions.siteId, siteId));
    expect(rows[0]!.locale).toBe('ar');
  });

  it('rejects a body locale outside the seven shipped locales', async () => {
    const user = await signupVerifiedUser(app, { email: 'badloc@example.com' });
    const siteId = await addSite(user);
    const res = await request(app)
      .put(`/api/sites/${siteId}/weekly-pulse`)
      .set('Cookie', user.cookie)
      .send({
        enabled: true,
        acknowledgedPreviewAt: new Date().toISOString(),
        locale: 'kl',
      });
    expect(res.status).toBe(400);
    const rows = await getTestDb()
      .select()
      .from(sitePulseSubscriptions)
      .where(eq(sitePulseSubscriptions.siteId, siteId));
    expect(rows).toHaveLength(0);
  });

  it('only mutates the caller row (multi-user isolation)', async () => {
    const alice = await signupVerifiedUser(app, { email: 'alice-multi@example.com' });
    const siteId = await addSite(alice);

    // Alice subscribes.
    await request(app)
      .put(`/api/sites/${siteId}/weekly-pulse`)
      .set('Cookie', alice.cookie)
      .send({ enabled: true, acknowledgedPreviewAt: new Date().toISOString() });

    // Bob cannot mutate Alice's site — 404 because he doesn't own it.
    const bob = await signupVerifiedUser(app, { email: 'bob-multi@example.com' });
    const res = await request(app)
      .put(`/api/sites/${siteId}/weekly-pulse`)
      .set('Cookie', bob.cookie)
      .send({ enabled: false });
    expect(res.status).toBe(404);

    // Alice's row is still active.
    const rows = await getTestDb()
      .select()
      .from(sitePulseSubscriptions)
      .where(
        and(
          eq(sitePulseSubscriptions.accountId, alice.id),
          eq(sitePulseSubscriptions.siteId, siteId),
        ),
      );
    expect(rows[0]!.disabledAt).toBeNull();
  });
});

describe('GET history + detail', () => {
  it('returns the paginated history for the caller', async () => {
    const user = await signupVerifiedUser(app, { email: 'hist@example.com' });
    const siteId = await addSite(user);
    await getTestDb().insert(weeklyPulseRuns).values({
      accountId: user.id,
      siteId,
      isoWeek: '2026-W01',
      status: 'completed',
      marketSnapshot: {},
      promptCohortId: 'c',
      promptCohortVersion: 1,
      engineSurfaceSet: [],
      observationMeta: {},
      usageReference: {},
      counts: {},
    });
    const res = await request(app)
      .get(`/api/sites/${siteId}/weekly-pulse/history?limit=10`)
      .set('Cookie', user.cookie);
    expect(res.status).toBe(200);
    expect(res.body.runs).toHaveLength(1);
  });

  it('walks the history with the returned cursor without repeating a run', async () => {
    const user = await signupVerifiedUser(app, { email: 'cursor@example.com' });
    const siteId = await addSite(user);
    for (let i = 0; i < 3; i += 1) {
      await getTestDb().insert(weeklyPulseRuns).values({
        accountId: user.id,
        siteId,
        isoWeek: `2026-W0${i + 1}`,
        status: 'completed',
        marketSnapshot: {},
        promptCohortId: 'c',
        promptCohortVersion: 1,
        engineSurfaceSet: [],
        observationMeta: {},
        usageReference: {},
        counts: {},
      });
      // Postgres stamps `created_at` per statement; space them so the
      // newest-first ordering is unambiguous.
      await new Promise((r) => setTimeout(r, 20));
    }

    const first = await request(app)
      .get(`/api/sites/${siteId}/weekly-pulse/history?limit=2`)
      .set('Cookie', user.cookie);
    expect(first.status).toBe(200);
    expect(first.body.runs).toHaveLength(2);
    expect(first.body.nextCursor).toEqual(expect.any(String));

    const second = await request(app)
      .get(
        `/api/sites/${siteId}/weekly-pulse/history?limit=2&cursor=${encodeURIComponent(
          first.body.nextCursor as string,
        )}`,
      )
      .set('Cookie', user.cookie);
    expect(second.status).toBe(200);
    expect(second.body.nextCursor).toBeNull();

    const firstIds = (first.body.runs as Array<{ runId: string }>).map((r) => r.runId);
    const secondIds = (second.body.runs as Array<{ runId: string }>).map((r) => r.runId);
    // A cursor page must never hand back a run the caller already saw.
    expect(secondIds.filter((id) => firstIds.includes(id))).toEqual([]);
  });

  it('detail returns the frozen projection and the derived citation changes', async () => {
    const user = await signupVerifiedUser(app, { email: 'detail@example.com' });
    const siteId = await addSite(user);
    const insRun = await getTestDb()
      .insert(weeklyPulseRuns)
      .values({
        accountId: user.id,
        siteId,
        isoWeek: '2026-W03',
        status: 'completed',
        marketSnapshot: {},
        promptCohortId: 'c',
        promptCohortVersion: 1,
        engineSurfaceSet: [],
        observationMeta: {},
        usageReference: {},
        counts: {},
      })
      .returning({ id: weeklyPulseRuns.id });
    const runId = insRun[0]!.id;
    const insCitation = await getTestDb()
      .insert(weeklyPulseCitations)
      .values({
        pulseRunId: runId,
        engine: 'chatgpt',
        surface: 'mentions',
        promptCohortId: 'c',
        promptCohortVersion: 1,
        canonicalUrl: 'https://a.example/x',
        host: 'a.example',
      })
      .returning({ id: weeklyPulseCitations.id });
    await getTestDb().insert(weeklyPulseCitationChanges).values({
      pulseRunId: runId,
      change: 'new',
      engine: 'chatgpt',
      surface: 'mentions',
      promptCohortId: 'c',
      promptCohortVersion: 1,
      canonicalUrl: 'https://a.example/x',
      host: 'a.example',
      citationId: insCitation[0]!.id,
    });
    await getTestDb().insert(weeklyPulseDigestProjections).values({
      pulseRunId: runId,
      payload: { header: { isoWeek: '2026-W03' } } as unknown as object,
    });

    const res = await request(app)
      .get(`/api/sites/${siteId}/weekly-pulse/history/${runId}`)
      .set('Cookie', user.cookie);
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      siteId,
      runId,
      isoWeek: '2026-W03',
      status: 'completed',
    });
    expect(res.body.projection.header.isoWeek).toBe('2026-W03');
    expect(res.body.citationChanges).toEqual([
      {
        change: 'new',
        engine: 'chatgpt',
        surface: 'mentions',
        host: 'a.example',
        canonicalUrl: 'https://a.example/x',
        citationId: insCitation[0]!.id,
      },
    ]);
  });

  it('detail 404 for another account', async () => {
    const owner = await signupVerifiedUser(app, { email: 'own-x@example.com' });
    const siteId = await addSite(owner);
    const insRun = await getTestDb()
      .insert(weeklyPulseRuns)
      .values({
        accountId: owner.id,
        siteId,
        isoWeek: '2026-W01',
        status: 'completed',
        marketSnapshot: {},
        promptCohortId: 'c',
        promptCohortVersion: 1,
        engineSurfaceSet: [],
        observationMeta: {},
        usageReference: {},
        counts: {},
      })
      .returning({ id: weeklyPulseRuns.id });
    const runId = insRun[0]!.id;

    const other = await signupVerifiedUser(app, { email: 'own-y@example.com' });
    const res = await request(app)
      .get(`/api/sites/${siteId}/weekly-pulse/history/${runId}`)
      .set('Cookie', other.cookie);
    expect(res.status).toBe(404);
  });
});

describe('controller seams the router cannot reach', () => {
  it('refuses a request that arrives without an authenticated user', async () => {
    // `requireAuth` always populates `req.user` on the mounted routes, so this
    // guard only fires if the controller is ever reused behind a chain that
    // forgets it — it must 401 rather than read `undefined.id` as an account.
    const captured = await callController(getPulseStateController, {
      workspaceAccountId: 'account-1',
      params: { siteId: 'aaaaaaaaaaaaaaaaaaaaaaaa' },
      query: {},
      body: {},
    });
    expect(captured.body).toBeNull();
    expect(captured.error).toMatchObject({
      status: 401,
      message: 'errors.unauthorized',
    });
  });

  it('falls back to the default locale when the request carries no resolved language', async () => {
    // The language middleware always stamps `req.language`, so this guard only
    // matters if the controller is reused behind a chain that omits it. It
    // must persist the default locale rather than `undefined`, which would
    // violate the NOT NULL locale column and drop the subscription entirely.
    const user = await signupVerifiedUser(app, { email: 'deflocale@example.com' });
    const siteId = await addSite(user);

    const captured = await callController(setPulseSubscriptionController, {
      user: { id: user.id } as Request['user'],
      params: { siteId },
      query: {},
      body: { enabled: true, acknowledgedPreviewAt: new Date().toISOString() },
    });
    expect(captured.error).toBeNull();
    expect(captured.status).toBe(200);

    const rows = await getTestDb()
      .select()
      .from(sitePulseSubscriptions)
      .where(eq(sitePulseSubscriptions.siteId, siteId));
    expect(rows).toHaveLength(1);
    expect(rows[0]!.locale).toBe('en');
  });

  it('falls back to the production db handle when no test db is injected', async () => {
    // At boot nothing has called `setWeeklyPulseDb` yet. Ownership is checked
    // in Mongo first, so an unknown site 404s before the Postgres handle is
    // ever used — proving the fallback resolves without a live connection.
    const user = await signupVerifiedUser(app, { email: 'nodb@example.com' });
    setWeeklyPulseDb(null);
    try {
      expect(resolveWeeklyPulseDb()).toBeDefined();
      const res = await request(app)
        .get('/api/sites/aaaaaaaaaaaaaaaaaaaaaaaa/weekly-pulse')
        .set('Cookie', user.cookie);
      expect(res.status).toBe(404);
    } finally {
      setWeeklyPulseDb(getTestDb() as unknown as never);
      expect(resolveWeeklyPulseDb()).toBe(getTestDb());
    }
  });
});

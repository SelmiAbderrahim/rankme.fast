import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import request from 'supertest';
import { Types } from 'mongoose';
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
import {
  domainStates,
  keywords,
  rankings,
} from '../../db/schema/keywords.js';
import { backlinkSnapshots } from '../../db/schema/backlinks.js';
import { competitorIntersections, competitors } from '../../db/schema/competitors.js';
import { and, eq } from 'drizzle-orm';
import { DICTIONARIES } from '../../shared/i18n/index.js';
import { AuditLog } from '../audit/index.js';
import { Site } from './sites.model.js';
import {
  createSite,
  deleteSite,
  getSite,
  listSites,
  sitesServiceTestables,
  toPublicSite,
  updateSite,
} from './sites.service.js';
import { setSitesDb } from './sites.holder.js';
import * as sitesHolder from './sites.holder.js';
import { AuditRun } from '../audits/audit-run.model.js';
import { AuditedPage } from '../audits/audited-page.model.js';
import { ReportSnapshot } from '../audits/report-snapshot.model.js';
import { setRanksQueue } from '../ranks/ranks.queue-holder.js';
import * as scheduler from '../../shared/queue/schedulers.js';
import { setPulseQueue } from '../weekly-pulse/pulse.queue-holder.js';
import * as pulseScheduler from '../weekly-pulse/scheduler.js';
import type { SiteHydrated } from './sites.model.js';
import { __setCsrfBypassForTests } from '../../shared/middleware/csrf.js';
import type { Queues } from '../../shared/queue/index.js';
import { setSiteLifecycleQueues } from './site-lifecycle-queues.holder.js';
import {
  teamMembers,
  teamMemberSiteGrants,
} from '../../db/schema/team-members.js';
import { setTeamDb } from '../team/team.holder.js';
import { WORKSPACE_HEADER } from '../../shared/middleware/workspace-context.js';
import { User } from '../users/users.model.js';
import { claimSiteDeletionAttempt } from './site-lifecycle.js';

const app = createApp();

const ISO_8601 = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;

async function seedUser(email = 'owner@x.co'): Promise<TestUser> {
  const user = await signupVerifiedUser(app, { email });
  return user;
}

/** Insert a site directly (bypasses the route) for list fixtures. */
function insertSite(accountId: string, domain: string) {
  return Site.create({
    accountId,
    url: `https://${domain}`,
    domain,
    displayName: '',
  });
}

function lifecycleQueues(queue: Record<string, unknown>): Queues {
  return {
    audits: queue,
    ranks: queue,
    accountPurge: queue,
    gscSync: queue,
    ga4Sync: queue,
    contentAnalysis: queue,
    contentInventory: queue,
    internalLinks: queue,
    keywordClusters: queue,
    competitorContent: queue,
    competitorLandscapes: queue,
    contentMonitor: queue,
    audienceResearch: queue,
    weeklyPulse: queue,
    clientReports: queue,
    backlinkDeep: queue,
    trafficSnapshots: queue,
    reviewSync: queue,
    brandRadar: queue,
    contentBrief: queue,
    geogrid: queue,
    alertDispatch: queue,
    deadLetter: queue,
    close: vi.fn(async () => undefined),
  } as unknown as Queues;
}

beforeAll(async () => {
  await startMemoryMongo();
  const db = await startTestPostgres();
  installTestAuth();
  setSitesDb(db as unknown as never);
  setTeamDb(db as unknown as never);
});

afterAll(async () => {
  uninstallTestAuth();
  setSitesDb(null);
  setTeamDb(null);
  await stopTestPostgres();
  await stopMemoryMongo();
});

beforeEach(async () => {
  // A timed-out clock-sensitive test must never leak fake event-loop timers
  // into the database-backed request that follows it.
  vi.useRealTimers();
  setSiteLifecycleQueues(null);
  await clearCollections();
  await truncateAllTables();
  setRanksQueue(null);
  setPulseQueue(null);
  vi.restoreAllMocks();
});

describe('site service defensive reads and writes', () => {
  it('returns the same 404 for absent owned reads and updates', async () => {
    const accountId = new Types.ObjectId().toString();
    const missing = new Types.ObjectId().toString();
    await expect(getSite(accountId, missing)).rejects.toMatchObject({ status: 404 });
    await expect(
      updateSite(accountId, missing, { displayName: 'Missing' }),
    ).rejects.toMatchObject({ status: 404 });
  });

  it('combines a selected-site grant with cursor pagination', async () => {
    const accountId = new Types.ObjectId().toString();
    const older = await insertSite(accountId, 'selected-old.example.com');
    const newest = await insertSite(accountId, 'selected-new.example.com');
    const page = await listSites(
      accountId,
      { cursor: String(newest._id), limit: 1 },
      { allowedSiteIds: [String(newest._id), String(older._id)] },
    );
    expect(page.sites.map((site) => site.id)).toEqual([String(older._id)]);
    expect(page.nextCursor).toBeNull();
  });
});

describe('CSRF chain on cookie-authed product mutations', () => {
  it('gates POST /api/sites via double-submit; GETs + bearer requests are exempt', async () => {
    const user = await seedUser('csrf-shared@x.co');
    __setCsrfBypassForTests(false);
    try {
      // 1. Missing header → 403.
      const noHeader = await request(app)
        .post('/api/sites')
        .set('Cookie', user.cookie)
        .send({ url: 'https://csrf-noheader.example.com' });
      expect(noHeader.status).toBe(403);
      expect(String(noHeader.body.error?.message ?? '').length).toBeGreaterThan(0);

      // 2. GET is a safe method — exempt.
      const getRes = await request(app).get('/api/sites').set('Cookie', user.cookie);
      expect(getRes.status).toBe(200);

      // 3. Matching cookie + header → success.
      const tokenRes = await request(app).get('/api/security/csrf-token');
      expect(tokenRes.status).toBe(200);
      const setCookie = tokenRes.headers['set-cookie'] as unknown as string[];
      const csrfCookiePair = (setCookie ?? [])
        .map((c) => c.split(';')[0]!)
        .find((c) => c.toLowerCase().startsWith('x-csrf-token='));
      expect(csrfCookiePair).toBeTruthy();
      const token: string = tokenRes.body.csrfToken;
      const ok = await request(app)
        .post('/api/sites')
        .set('Cookie', `${user.cookie}; ${csrfCookiePair}`)
        .set('x-csrf-token', token)
        .send({ url: 'https://csrf-ok.example.com' });
      expect(ok.status).toBe(201);

      // 4. A well-formed public-API bearer key (`Bearer rmf_…`) on a mutation →
      // CSRF exempts (positive match on the api-key shape), then requireAuth
      // takes over and 401s (no cookie session on this chain).
      const bearer = await request(app)
        .post('/api/sites')
        .set('Authorization', 'Bearer rmf_notarealkey123')
        .send({ url: 'https://bearer.example.com' });
      expect(bearer.status).toBe(401);

      // 4b. A non-api-key Authorization header must NOT exempt CSRF — the
      // cookie-less mutation is blocked at requireCsrf (403), not waved through.
      const forged = await request(app)
        .post('/api/sites')
        .set('Authorization', 'Bearer whatever')
        .send({ url: 'https://forged.example.com' });
      expect(forged.status).toBe(403);
    } finally {
      __setCsrfBypassForTests(true);
    }
  });
});

describe('auth gating', () => {
  it('rejects unauthenticated and tampered-cookie requests with 401', async () => {
    const bare = await request(app).get('/api/sites');
    expect(bare.status).toBe(401);

    const tampered = await request(app)
      .get('/api/sites')
      .set('Cookie', 'better-auth.session_token=tampered');
    expect(tampered.status).toBe(401);

    const post = await request(app).post('/api/sites').send({ url: 'https://example.com' });
    expect(post.status).toBe(401);
  });
});

describe('POST /api/sites', () => {
  it('creates a site: 201, camelCase payload, ISO 8601 dates, localized message', async () => {
    const user = await seedUser();
    const res = await request(app)
      .post('/api/sites')
      .set('Cookie', user.cookie)
      .send({ url: 'https://example.com/some/path?q=1#top', displayName: 'My site' });

    expect(res.status).toBe(201);
    expect(res.body.message).toBe(DICTIONARIES.en.sites.created);
    expect(res.body.site).toMatchObject({
      url: 'https://example.com',
      domain: 'example.com',
      displayName: 'My site',
    });
    expect(typeof res.body.site.id).toBe('string');
    expect(res.body.site.createdAt).toMatch(ISO_8601);
    expect(res.body.site.updatedAt).toMatch(ISO_8601);
    const auditRows = await AuditLog.find({ actorUserId: user.id }).lean();
    expect(auditRows).toHaveLength(1);
    expect(auditRows[0]?.action).toBe('site.create');
    expect(auditRows[0]?.targetType).toBe('site');
    expect(auditRows[0]?.targetId).toBe(res.body.site.id);
  });

  it('normalizes HTTPS://Example.COM:443/ → https://example.com', async () => {
    const user = await seedUser();
    const res = await request(app)
      .post('/api/sites')
      .set('Cookie', user.cookie)
      .send({ url: 'HTTPS://Example.COM:443/' });
    expect(res.status).toBe(201);
    expect(res.body.site.url).toBe('https://example.com');
    expect(res.body.site.domain).toBe('example.com');
  });

  it('defaults displayName to empty string', async () => {
    const user = await seedUser();
    const res = await request(app)
      .post('/api/sites')
      .set('Cookie', user.cookie)
      .send({ url: 'https://example.com' });
    expect(res.status).toBe(201);
    expect(res.body.site.displayName).toBe('');
  });

  it.each([
    ['data: scheme', 'data:text/html,x', DICTIONARIES.en.sites.errors.urlScheme],
    ['javascript: scheme', 'javascript:alert(1)', DICTIONARIES.en.sites.errors.urlScheme],
    ['file: scheme', 'file:///etc/passwd', DICTIONARIES.en.sites.errors.urlScheme],
    ['ftp: scheme', 'ftp://example.com', DICTIONARIES.en.sites.errors.urlScheme],
    ['IPv4 literal', 'https://192.168.0.1', DICTIONARIES.en.sites.errors.urlIpLiteral],
    ['IPv6 literal', 'http://[::1]:8080', DICTIONARIES.en.sites.errors.urlIpLiteral],
    ['no TLD', 'https://intranet', DICTIONARIES.en.sites.errors.urlNoTld],
    ['userinfo', 'https://user:pass@example.com', DICTIONARIES.en.sites.errors.urlUserinfo],
    ['malformed', 'not a url at all', DICTIONARIES.en.sites.errors.urlInvalid],
    ['empty', '   ', DICTIONARIES.en.sites.errors.urlRequired],
    [
      'over 2048 chars',
      `https://example.com/${'a'.repeat(2048)}`,
      DICTIONARIES.en.sites.errors.urlTooLong,
    ],
  ])('rejects %s with a localized 400', async (_label, url, message) => {
    const user = await seedUser();
    const res = await request(app)
      .post('/api/sites')
      .set('Cookie', user.cookie)
      .send({ url });
    expect(res.status).toBe(400);
    expect(res.body.error.message).toBe(message);
  });

  it('localizes validation errors from the request language (fr)', async () => {
    const user = await seedUser();
    const res = await request(app)
      .post('/api/sites')
      .set('Cookie', user.cookie)
      .set('x-lang', 'fr')
      .send({ url: 'ftp://example.com' });
    expect(res.status).toBe(400);
    expect(res.body.error.message).toBe(DICTIONARIES.fr.sites.errors.urlScheme);
  });

  it('allows localhost in the test env only (explicit escape hatch)', async () => {
    const user = await seedUser();
    const res = await request(app)
      .post('/api/sites')
      .set('Cookie', user.cookie)
      .send({ url: 'http://localhost:3000' });
    expect(res.status).toBe(201);
    expect(res.body.site.domain).toBe('localhost');
  });

  it('rejects a non-string body with 400 validationFailed (zod)', async () => {
    const user = await seedUser();
    const res = await request(app)
      .post('/api/sites')
      .set('Cookie', user.cookie)
      .send({ url: 42 });
    expect(res.status).toBe(400);
    expect(res.body.error.message).toBe(DICTIONARIES.en.errors.validationFailed);
  });

  it('returns a localized 409 for a duplicate domain', async () => {
    const user = await seedUser();
    const first = await request(app)
      .post('/api/sites')
      .set('Cookie', user.cookie)
      .send({ url: 'https://example.com' });
    expect(first.status).toBe(201);

    const dup = await request(app)
      .post('/api/sites')
      .set('Cookie', user.cookie)
      .send({ url: 'http://EXAMPLE.com/other-path' });
    expect(dup.status).toBe(409);
    expect(dup.body.error.message).toBe(DICTIONARIES.en.sites.errors.duplicate);
  });

  it('maps a unique-index race (E11000) to the same localized 409', async () => {
    const user = await seedUser();
    await insertSite(user.id, 'example.com');
    // Simulate the race: the pre-check misses the concurrent insert.
    vi.spyOn(Site, 'findOne').mockResolvedValueOnce(null);
    await expect(createSite(user.id, { url: 'https://example.com' })).rejects.toMatchObject({
      status: 409,
      message: 'sites.errors.duplicate',
    });
  });

  it('rethrows non-duplicate create failures (Error without code, non-Error)', async () => {
    const user = await seedUser();
    vi.spyOn(Site, 'findOne').mockResolvedValue(null as never);

    const plainError = new Error('mongo down');
    vi.spyOn(Site, 'create').mockRejectedValueOnce(plainError as never);
    await expect(createSite(user.id, { url: 'https://example.com' })).rejects.toBe(plainError);

    vi.spyOn(Site, 'create').mockRejectedValueOnce('boom' as never);
    await expect(createSite(user.id, { url: 'https://example.com' })).rejects.toBe('boom');
  });

  it('toPublicSite defaults a missing displayName to an empty string', () => {
    const now = new Date();
    const doc = {
      _id: new Types.ObjectId(),
      url: 'https://example.com',
      domain: 'example.com',
      displayName: undefined,
      createdAt: now,
      updatedAt: now,
    } as unknown as SiteHydrated;
    expect(toPublicSite(doc).displayName).toBe('');
  });

  it('concurrent creates for fresh domains all succeed under the account lock', async () => {
    const user = await seedUser('conc-sites@x.co');
    await insertSite(user.id, 'preseed.example.com');
    const results = await Promise.allSettled([
      createSite(user.id, { url: 'https://conc-a.example.com' }),
      createSite(user.id, { url: 'https://conc-b.example.com' }),
      createSite(user.id, { url: 'https://conc-c.example.com' }),
    ]);
    expect(results.every((r) => r.status === 'fulfilled')).toBe(true);
    expect(await Site.countDocuments({ accountId: user.id })).toBe(4);
  });

  it('advisory lock is issued once per createSite call', async () => {
    const user = await seedUser('lock-sites@x.co');
    const realDb = getTestDb();
    let executeCalls = 0;
    let transactionCalls = 0;
    const wrapped = new Proxy(realDb, {
      get(target, prop) {
        if (prop === 'transaction') {
          return async (cb: (tx: unknown) => Promise<unknown>) => {
            transactionCalls += 1;
            return target.transaction(async (tx) => {
              const txExecute = tx.execute.bind(tx);
              (tx as { execute: unknown }).execute = async (q: unknown) => {
                executeCalls += 1;
                return txExecute(q as never);
              };
              return cb(tx);
            });
          };
        }
        return Reflect.get(target, prop);
      },
    });
    vi.spyOn(sitesHolder, 'getSitesDb').mockReturnValue(wrapped as never);
    await createSite(user.id, { url: 'https://lock-a.example.com' });
    // Every createSite opens exactly one transaction and issues at least the
    // advisory-lock statement inside it (execute() only fires for the raw
    // `sql\`...\`` calls — drizzle query builder methods bypass execute).
    expect(transactionCalls).toBe(1);
    expect(executeCalls).toBeGreaterThanOrEqual(1);
  });
});

describe('GET /api/sites (cursor pagination)', () => {
  it('lists own sites newest-first with a working cursor', async () => {
    const user = await seedUser();
    await insertSite(user.id, 'a.example.com');
    await insertSite(user.id, 'b.example.com');
    await insertSite(user.id, 'c.example.com');

    const page1 = await request(app)
      .get('/api/sites')
      .query({ limit: 2 })
      .set('Cookie', user.cookie);
    expect(page1.status).toBe(200);
    expect(page1.body.sites.map((s: { domain: string }) => s.domain)).toEqual([
      'c.example.com',
      'b.example.com',
    ]);
    expect(page1.body.nextCursor).toBe(page1.body.sites[1].id);

    const page2 = await request(app)
      .get('/api/sites')
      .query({ limit: 2, cursor: page1.body.nextCursor })
      .set('Cookie', user.cookie);
    expect(page2.status).toBe(200);
    expect(page2.body.sites.map((s: { domain: string }) => s.domain)).toEqual([
      'a.example.com',
    ]);
    expect(page2.body.nextCursor).toBeNull();
  });

  it('returns an empty page with null cursor when the account has no sites', async () => {
    const user = await seedUser();
    const res = await request(app).get('/api/sites').set('Cookie', user.cookie);
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ sites: [], nextCursor: null });
  });

  it('never returns another account’s sites', async () => {
    const alice = await seedUser('alice@x.co');
    const bob = await seedUser('bob@x.co');
    await insertSite(alice.id, 'alice.example.com');

    const res = await request(app).get('/api/sites').set('Cookie', bob.cookie);
    expect(res.status).toBe(200);
    expect(res.body.sites).toEqual([]);
  });

  it('rejects a malformed cursor with a localized 400', async () => {
    const user = await seedUser();
    const res = await request(app)
      .get('/api/sites')
      .query({ cursor: 'not-an-object-id' })
      .set('Cookie', user.cookie);
    expect(res.status).toBe(400);
    expect(res.body.error.message).toBe(DICTIONARIES.en.errors.badRequest);
  });

  it('rejects out-of-range limits with 400 (zod)', async () => {
    const user = await seedUser();
    const zero = await request(app)
      .get('/api/sites')
      .query({ limit: 0 })
      .set('Cookie', user.cookie);
    expect(zero.status).toBe(400);

    const huge = await request(app)
      .get('/api/sites')
      .query({ limit: 101 })
      .set('Cookie', user.cookie);
    expect(huge.status).toBe(400);
  });

  it('filters a selected-scope teammate before pagination and hides direct access', async () => {
    const owner = await seedUser('site-scope-owner@x.co');
    const member = await seedUser('site-scope-member@x.co');
    const siteA = await insertSite(owner.id, 'scope-a.example.com');
    const siteB = await insertSite(owner.id, 'scope-b.example.com');
    const [membership] = await getTestDb()
      .insert(teamMembers)
      .values({
        teamId: owner.id,
        userId: member.id,
        email: member.email,
        role: 'member',
        siteAccessMode: 'selected',
        inviteTokenHash: '7'.repeat(64),
        invitedBy: owner.id,
        acceptedAt: new Date(),
        expiresAt: new Date('2099-01-01T00:00:00Z'),
      })
      .returning({ id: teamMembers.id });
    await getTestDb().insert(teamMemberSiteGrants).values({
      teamMemberId: membership!.id,
      siteId: String(siteA._id),
    });

    const list = await request(app)
      .get('/api/sites')
      .query({ limit: 1 })
      .set('Cookie', member.cookie)
      .set(WORKSPACE_HEADER, owner.id);
    expect(list.status).toBe(200);
    expect(list.body.sites.map((site: { id: string }) => site.id)).toEqual([
      String(siteA._id),
    ]);
    expect(list.body.nextCursor).toBeNull();

    const allowed = await request(app)
      .get(`/api/sites/${String(siteA._id)}`)
      .set('Cookie', member.cookie)
      .set(WORKSPACE_HEADER, owner.id);
    expect(allowed.status).toBe(200);

    const denied = await request(app)
      .get(`/api/sites/${String(siteB._id)}`)
      .set('Cookie', member.cookie)
      .set(WORKSPACE_HEADER, owner.id);
    expect(denied.status).toBe(404);
    expect(denied.body.error.message).toBe(DICTIONARIES.en.sites.errors.notFound);
  });

  it('lets All-sites teammates see sites created after their membership', async () => {
    const owner = await seedUser('all-sites-owner@x.co');
    const member = await seedUser('all-sites-member@x.co');
    await getTestDb().insert(teamMembers).values({
      teamId: owner.id,
      userId: member.id,
      email: member.email,
      role: 'member',
      siteAccessMode: 'all',
      inviteTokenHash: '8'.repeat(64),
      invitedBy: owner.id,
      acceptedAt: new Date(),
      expiresAt: new Date('2099-01-01T00:00:00Z'),
    });
    const futureSite = await insertSite(owner.id, 'future.example.com');

    const list = await request(app)
      .get('/api/sites')
      .set('Cookie', member.cookie)
      .set(WORKSPACE_HEADER, owner.id);
    expect(list.status).toBe(200);
    expect(list.body.sites.map((site: { id: string }) => site.id)).toContain(
      String(futureSite._id),
    );
  });

  it('keeps site lifecycle actions owner-only while allowing scoped edits', async () => {
    const owner = await seedUser('lifecycle-owner@x.co');
    const admin = await seedUser('lifecycle-admin@x.co');
    const site = await insertSite(owner.id, 'lifecycle.example.com');
    const [membership] = await getTestDb()
      .insert(teamMembers)
      .values({
        teamId: owner.id,
        userId: admin.id,
        email: admin.email,
        role: 'admin',
        siteAccessMode: 'selected',
        inviteTokenHash: '9'.repeat(64),
        invitedBy: owner.id,
        acceptedAt: new Date(),
        expiresAt: new Date('2099-01-01T00:00:00Z'),
      })
      .returning({ id: teamMembers.id });
    await getTestDb().insert(teamMemberSiteGrants).values({
      teamMemberId: membership!.id,
      siteId: String(site._id),
    });
    const headers = { Cookie: admin.cookie, [WORKSPACE_HEADER]: owner.id };

    const edit = await request(app)
      .patch(`/api/sites/${String(site._id)}`)
      .set(headers)
      .send({ displayName: 'Scoped edit' });
    expect(edit.status).toBe(200);

    for (const [method, path] of [
      ['post', '/api/sites'],
      ['post', `/api/sites/${String(site._id)}/pause`],
      ['post', `/api/sites/${String(site._id)}/resume`],
      ['delete', `/api/sites/${String(site._id)}`],
    ] as const) {
      const call = request(app)[method](path).set(headers);
      if (path === '/api/sites') call.send({ url: 'https://forbidden.example.com' });
      const response = await call;
      expect(response.status, `${method.toUpperCase()} ${path}`).toBe(404);
    }
    expect(await Site.exists({ _id: site._id })).toBeTruthy();
  });
});

describe('GET /api/sites/:id', () => {
  it('fetches an owned site', async () => {
    const user = await seedUser();
    const created = await insertSite(user.id, 'example.com');
    const res = await request(app)
      .get(`/api/sites/${created._id.toString()}`)
      .set('Cookie', user.cookie);
    expect(res.status).toBe(200);
    expect(res.body.site).toMatchObject({
      id: created._id.toString(),
      url: 'https://example.com',
      domain: 'example.com',
    });
  });

  it('returns 404 (not 403) for another account’s site — no existence leak', async () => {
    const alice = await seedUser('alice@x.co');
    const bob = await seedUser('bob@x.co');
    const site = await insertSite(alice.id, 'alice.example.com');

    const res = await request(app)
      .get(`/api/sites/${site._id.toString()}`)
      .set('Cookie', bob.cookie);
    expect(res.status).toBe(404);
    expect(res.body.error.message).toBe(DICTIONARIES.en.sites.errors.notFound);
  });

  it('returns 404 for a malformed id and for an unknown id', async () => {
    const user = await seedUser();
    const malformed = await request(app)
      .get('/api/sites/definitely-not-an-id')
      .set('Cookie', user.cookie);
    expect(malformed.status).toBe(404);

    const unknown = await request(app)
      .get(`/api/sites/${new Types.ObjectId().toString()}`)
      .set('Cookie', user.cookie);
    expect(unknown.status).toBe(404);
  });
});

describe('PATCH /api/sites/:id', () => {
  it('updates the displayName and returns the updated site', async () => {
    const user = await seedUser();
    const site = await insertSite(user.id, 'rename.example.com');

    const res = await request(app)
      .patch(`/api/sites/${site._id.toString()}`)
      .set('Cookie', user.cookie)
      .send({ displayName: '  My renamed blog  ' });
    expect(res.status).toBe(200);
    expect(res.body.site.displayName).toBe('My renamed blog');
    expect(res.body.site.id).toBe(site._id.toString());
    expect(res.body.message).toBe(DICTIONARIES.en.sites.updated);

    const reread = await Site.findById(site._id);
    expect(reread?.displayName).toBe('My renamed blog');
  });

  it('accepts an empty displayName to clear the rename', async () => {
    const user = await seedUser();
    const site = await insertSite(user.id, 'clear.example.com');
    site.displayName = 'Old';
    await site.save();

    const res = await request(app)
      .patch(`/api/sites/${site._id.toString()}`)
      .set('Cookie', user.cookie)
      .send({ displayName: '' });
    expect(res.status).toBe(200);
    expect(res.body.site.displayName).toBe('');
  });

  it('rejects a displayName over 120 chars with 400', async () => {
    const user = await seedUser();
    const site = await insertSite(user.id, 'toolong.example.com');
    const res = await request(app)
      .patch(`/api/sites/${site._id.toString()}`)
      .set('Cookie', user.cookie)
      .send({ displayName: 'x'.repeat(121) });
    expect(res.status).toBe(400);
  });

  it('returns 404 for another account’s site and leaves it intact', async () => {
    const alice = await seedUser('alice@x.co');
    const bob = await seedUser('bob@x.co');
    const site = await insertSite(alice.id, 'alice-rename.example.com');
    site.displayName = 'Untouched';
    await site.save();

    const res = await request(app)
      .patch(`/api/sites/${site._id.toString()}`)
      .set('Cookie', bob.cookie)
      .send({ displayName: 'Hacked' });
    expect(res.status).toBe(404);

    const reread = await Site.findById(site._id);
    expect(reread?.displayName).toBe('Untouched');
  });

  it('returns 404 for malformed and unknown ids', async () => {
    const user = await seedUser();
    const malformed = await request(app)
      .patch('/api/sites/nope')
      .set('Cookie', user.cookie)
      .send({ displayName: 'X' });
    expect(malformed.status).toBe(404);

    const unknown = await request(app)
      .patch(`/api/sites/${new Types.ObjectId().toString()}`)
      .set('Cookie', user.cookie)
      .send({ displayName: 'X' });
    expect(unknown.status).toBe(404);
  });
});

describe('DELETE /api/sites/:id', () => {
  it('deletes an owned site with a localized message', async () => {
    const user = await seedUser();
    const site = await insertSite(user.id, 'example.com');

    const res = await request(app)
      .delete(`/api/sites/${site._id.toString()}`)
      .set('Cookie', user.cookie);
    expect(res.status).toBe(200);
    expect(res.body.message).toBe(DICTIONARIES.en.sites.deleted);
    expect(await Site.countDocuments({})).toBe(0);
    const auditRows = await AuditLog.find({
      actorUserId: user.id,
      action: 'site.delete',
    }).lean();
    expect(auditRows).toHaveLength(1);
    expect(auditRows[0]?.targetType).toBe('site');
    expect(auditRows[0]?.targetId).toBe(site._id.toString());
  });

  it('returns 404 for another account’s site and leaves it intact', async () => {
    const alice = await seedUser('alice@x.co');
    const bob = await seedUser('bob@x.co');
    const site = await insertSite(alice.id, 'alice.example.com');

    const res = await request(app)
      .delete(`/api/sites/${site._id.toString()}`)
      .set('Cookie', bob.cookie);
    expect(res.status).toBe(404);
    expect(await Site.countDocuments({})).toBe(1);
  });

  it('returns 404 for malformed and unknown ids', async () => {
    const user = await seedUser();
    const malformed = await request(app)
      .delete('/api/sites/nope')
      .set('Cookie', user.cookie);
    expect(malformed.status).toBe(404);

    const unknown = await request(app)
      .delete(`/api/sites/${new Types.ObjectId().toString()}`)
      .set('Cookie', user.cookie);
    expect(unknown.status).toBe(404);
  });
});

describe('site deletion lifecycle boundaries', () => {
  it('fails closed when ownership disappears before or inside the locked claim', async () => {
    const user = await seedUser('delete-race@x.co');
    const missingId = new Types.ObjectId().toString();
    await expect(
      sitesServiceTestables.deleteSiteWithAccountBoundary(user.id, missingId),
    ).rejects.toMatchObject({ status: 404 });

    const site = await insertSite(user.id, 'delete-race.example.com');
    await expect(
      sitesServiceTestables.deleteSiteWithAccountBoundary(
        user.id,
        site._id.toString(),
        {},
        'transaction-race',
        {
          afterTransactionLock: async () => {
            await Site.collection.deleteOne({ _id: site._id });
          },
        },
      ),
    ).rejects.toMatchObject({ status: 404 });
  });

  it('returns conflict while another deletion attempt owns the site', async () => {
    const user = await seedUser('delete-attempt-busy@x.co');
    const site = await insertSite(user.id, 'delete-attempt-busy.example.com');
    await expect(
      claimSiteDeletionAttempt(
        { accountId: user.id, siteId: site._id.toString() },
        'existing-attempt',
      ),
    ).resolves.toMatchObject({ status: 'claimed' });

    await expect(deleteSite(user.id, site._id.toString())).rejects.toMatchObject({ status: 409 });
  });

  it('tears down a legacy pulse scheduler and records explicit audit provenance', async () => {
    const user = await seedUser('delete-self-host@x.co');
    const site = await insertSite(user.id, 'delete-self-host.example.com');
    const pulseQueue = { removeJobScheduler: vi.fn(async () => true) };
    setPulseQueue(pulseQueue as never);
    const removePulse = vi.spyOn(pulseScheduler, 'removePulseScheduler').mockResolvedValue(true);
    try {
      await expect(
        deleteSite(user.id, site._id.toString(), {
          actorUserId: user.id,
          auditSource: 'site-boundary-test',
        }),
      ).resolves.toBeUndefined();
    } finally {
      setPulseQueue(null);
    }

    expect(removePulse).toHaveBeenCalledTimes(2);
    expect(removePulse).toHaveBeenCalledWith(pulseQueue, site._id.toString());
    await expect(
      AuditLog.findOne({ action: 'site.delete', targetId: site._id.toString() }).lean(),
    ).resolves.toMatchObject({ metadata: { source: 'site-boundary-test' } });
  });

  it('maps active Redis work to conflict and preserves unrelated Redis failures', async () => {
    const user = await seedUser('delete-queue-boundaries@x.co');
    const busySite = await insertSite(user.id, 'delete-queue-busy.example.com');
    const activeJob = {
      data: { nested: { siteId: busySite._id.toString() } },
      remove: vi.fn(async () => undefined),
    };
    setSiteLifecycleQueues(
      lifecycleQueues({
        getJobs: vi.fn(async () => [activeJob]),
      }),
    );
    await expect(deleteSite(user.id, busySite._id.toString())).rejects.toMatchObject({
      status: 409,
    });

    const failedSite = await insertSite(user.id, 'delete-queue-failure.example.com');
    setSiteLifecycleQueues(
      lifecycleQueues({
        getJobs: vi.fn(async () => {
          throw new Error('redis read unavailable');
        }),
      }),
    );
    await expect(deleteSite(user.id, failedSite._id.toString())).rejects.toThrow(
      'redis read unavailable',
    );
  });

  it('rejects deletion after the owning account has entered its purge boundary', async () => {
    const user = await seedUser('delete-account-boundary@x.co');
    const site = await insertSite(user.id, 'delete-account-boundary.example.com');
    await User.collection.updateOne(
      { _id: new Types.ObjectId(user.id) },
      { $set: { deletionStartedAt: new Date() } },
    );

    await expect(deleteSite(user.id, site._id.toString())).rejects.toMatchObject({ status: 409 });
    await expect(Site.exists({ _id: site._id })).resolves.not.toBeNull();
  });
});

describe('DELETE /api/sites/:id — cascade (audit-fixes 13)', () => {
  async function seedFullSite(accountId: string, domain = 'cascade.example.com') {
    const site = await insertSite(accountId, domain);
    const siteId = site._id.toString();

    // 3 AuditRuns, each with 2 AuditedPage rows + 1 ReportSnapshot.
    const runs = await Promise.all(
      Array.from({ length: 3 }, () =>
        AuditRun.create({
          accountId,
          siteId: site._id,
          status: 'succeeded',
          pageCap: 10,
        }),
      ),
    );
    for (const run of runs) {
      await AuditedPage.create([
        { runId: run._id, url: 'https://a', statusCode: 200, onPageScore: 90 },
        { runId: run._id, url: 'https://b', statusCode: 200, onPageScore: 80 },
      ]);
      await ReportSnapshot.create({
        runId: run._id,
        siteId: site._id,
        accountId,
        findings: [],
        counts: { fixNow: 0, watch: 0, passed: 0 },
      });
    }

    // 10 keywords, each with a ranking row.
    const db = getTestDb();
    const keywordRows = await db
      .insert(keywords)
      .values(
        Array.from({ length: 10 }, (_, i) => ({
          accountId,
          siteId,
          phrase: `phrase-${i}`,
          locationCode: 2840,
          languageCode: 'en',
          device: 'desktop' as const,
        })),
      )
      .returning({ id: keywords.id });
    await db.insert(rankings).values(
      keywordRows.map((k) => ({
        keywordId: k.id,
        position: 1,
        rankAbsolute: 1,
        foundUrl: 'https://example.com',
        checkedAt: new Date(),
        source: 'fresh' as const,
      })),
    );

    // domain_states, backlink snapshots, competitors.
    await db.insert(domainStates).values({ siteId, cadence: 'weekly' });
    await db.insert(backlinkSnapshots).values([
      {
        siteId,
        accountId,
        domainRating: 30,
        backlinks: 100,
        referringDomains: 20,
        brokenBacklinks: 2,
        fetchedAt: new Date(),
      },
      {
        siteId,
        accountId,
        domainRating: 32,
        backlinks: 110,
        referringDomains: 22,
        brokenBacklinks: 1,
        fetchedAt: new Date(),
      },
    ]);
    const now = new Date();
    await db.insert(competitors).values({
      siteId,
      accountId,
      competitorDomain: 'rival.example.com',
      intersections: 4,
      fetchedAt: now,
      snapshotDay: now.toISOString().slice(0, 10),
    });
    await db.insert(competitorIntersections).values({
      siteId,
      accountId,
      competitorDomain: 'rival.example.com',
      keywords: [],
      fetchedAt: new Date(),
    });

    return { site, siteId, runIds: runs.map((r) => r._id) };
  }

  it('full cascade: purges Mongo + Postgres + BullMQ scheduler for the siteId', async () => {
    const user = await seedUser('cascade@x.co');
    const { siteId, runIds } = await seedFullSite(user.id);

    // Fake ranks queue: assert removeRankSchedule is invoked with our siteId.
    const q = { removeJobScheduler: vi.fn(async () => true) };
    setRanksQueue(q as never);
    const removeSpy = vi
      .spyOn(scheduler, 'removeRankSchedule')
      .mockResolvedValue(true);

    const res = await request(app)
      .delete(`/api/sites/${siteId}`)
      .set('Cookie', user.cookie);
    expect(res.status).toBe(200);
    expect(removeSpy).toHaveBeenCalledWith(q, siteId);

    // Mongo — zero rows for this site or its runs remain.
    expect(await Site.countDocuments({ _id: siteId })).toBe(0);
    expect(await AuditRun.countDocuments({ siteId })).toBe(0);
    expect(await AuditedPage.countDocuments({ runId: { $in: runIds } })).toBe(0);
    expect(await ReportSnapshot.countDocuments({ runId: { $in: runIds } })).toBe(0);

    // Postgres — zero rows for this siteId across every table.
    const db = getTestDb();
    expect(
      (await db.select().from(keywords).where(eq(keywords.siteId, siteId))).length,
    ).toBe(0);
    expect(
      (await db.select().from(rankings)).length,
    ).toBe(0);
    expect(
      (await db.select().from(domainStates).where(eq(domainStates.siteId, siteId)))
        .length,
    ).toBe(0);
    expect(
      (
        await db
          .select()
          .from(backlinkSnapshots)
          .where(eq(backlinkSnapshots.siteId, siteId))
      ).length,
    ).toBe(0);
    expect(
      (await db.select().from(competitors).where(eq(competitors.siteId, siteId)))
        .length,
    ).toBe(0);
    expect(
      (
        await db
          .select()
          .from(competitorIntersections)
          .where(eq(competitorIntersections.siteId, siteId))
      ).length,
    ).toBe(0);

    // AuditLog target rows are intentionally kept — audit trail is history,
    // not a cascade target. The controller has appended a `site.delete` row.
    const trail = await AuditLog.find({
      actorUserId: user.id,
      action: 'site.delete',
    }).lean();
    expect(trail).toHaveLength(1);
    expect(trail[0]?.targetId).toBe(siteId);
  });

  it('cross-account delete → 404, nothing deleted in either store', async () => {
    const alice = await seedUser('alice-cascade@x.co');
    const bob = await seedUser('bob-cascade@x.co');
    const { siteId, runIds } = await seedFullSite(alice.id, 'alice-cascade.example.com');

    const res = await request(app)
      .delete(`/api/sites/${siteId}`)
      .set('Cookie', bob.cookie);
    expect(res.status).toBe(404);
    expect(res.body.error.message).toBe(DICTIONARIES.en.sites.errors.notFound);

    // Alice's site + every downstream row is still intact.
    expect(await Site.countDocuments({ _id: siteId })).toBe(1);
    expect(await AuditRun.countDocuments({ siteId })).toBe(3);
    expect(await AuditedPage.countDocuments({ runId: { $in: runIds } })).toBe(6);
    expect(await ReportSnapshot.countDocuments({ runId: { $in: runIds } })).toBe(3);
    const db = getTestDb();
    expect(
      (await db.select().from(keywords).where(eq(keywords.siteId, siteId))).length,
    ).toBe(10);
    expect((await db.select().from(rankings)).length).toBe(10);
    expect(
      (await db.select().from(backlinkSnapshots).where(eq(backlinkSnapshots.siteId, siteId)))
        .length,
    ).toBe(2);
    expect(
      (await db.select().from(competitors).where(eq(competitors.siteId, siteId)))
        .length,
    ).toBe(1);
  });

  it.each(['queued' as const, 'running' as const])(
    'refuses delete with 409 while an audit is %s',
    async (status) => {
      const user = await seedUser(`inflight-${status}@x.co`);
      const { siteId } = await seedFullSite(user.id, `inflight-${status}.example.com`);
      // Flip one AuditRun to the non-terminal state.
      const run = await AuditRun.findOne({ siteId });
      if (run) {
        run.status = status;
        await run.save();
      }

      const res = await request(app)
        .delete(`/api/sites/${siteId}`)
        .set('Cookie', user.cookie);
      expect(res.status).toBe(409);
      expect(res.body.error.message).toBe(
        DICTIONARIES.en.sites.errors.deleteWhileRunning,
      );

      // Nothing was deleted anywhere.
      expect(await Site.countDocuments({ _id: siteId })).toBe(1);
      expect(await AuditRun.countDocuments({ siteId })).toBe(3);
      const db = getTestDb();
      expect(
        (await db.select().from(keywords).where(eq(keywords.siteId, siteId))).length,
      ).toBe(10);
    },
  );

  it('is idempotent: a second delete of the same siteId is a plain 404', async () => {
    const user = await seedUser('idem@x.co');
    const site = await insertSite(user.id, 'idem.example.com');
    const siteId = site._id.toString();

    const first = await request(app)
      .delete(`/api/sites/${siteId}`)
      .set('Cookie', user.cookie);
    expect(first.status).toBe(200);
    const second = await request(app)
      .delete(`/api/sites/${siteId}`)
      .set('Cookie', user.cookie);
    expect(second.status).toBe(404);
    expect(second.body.error.message).toBe(DICTIONARIES.en.sites.errors.notFound);
  });

  it('Postgres cascade is transactional: mid-tx failure leaves every row intact', async () => {
    const user = await seedUser('atomic@x.co');
    const { siteId } = await seedFullSite(user.id, 'atomic.example.com');

    // Wrap the real db so the tx runs but throws AFTER the deletes complete —
    // drizzle/PGlite must roll back every delete atomically. Other calls
    // proxy straight through to the real db.
    const realDb = getTestDb();
    const wrapped = new Proxy(realDb, {
      get(target, prop) {
        if (prop === 'transaction') {
          return async (cb: (tx: unknown) => Promise<unknown>) => {
            await target.transaction(async (tx) => {
              await cb(tx);
              throw new Error('mid-tx failure');
            });
          };
        }
        return Reflect.get(target, prop);
      },
    });
    vi.spyOn(sitesHolder, 'getSitesDb').mockReturnValue(wrapped as never);

    await expect(deleteSite(user.id, siteId)).rejects.toThrow('mid-tx failure');

    // Every Postgres row for this site survived — no partial cascade.
    const db = getTestDb();
    expect(
      (await db.select().from(keywords).where(eq(keywords.siteId, siteId))).length,
    ).toBe(10);
    expect((await db.select().from(rankings)).length).toBe(10);
    expect(
      (await db.select().from(domainStates).where(eq(domainStates.siteId, siteId)))
        .length,
    ).toBe(1);
    expect(
      (
        await db
          .select()
          .from(backlinkSnapshots)
          .where(
            and(eq(backlinkSnapshots.siteId, siteId), eq(backlinkSnapshots.accountId, user.id)),
          )
      ).length,
    ).toBe(2);
    expect(
      (await db.select().from(competitors).where(eq(competitors.siteId, siteId)))
        .length,
    ).toBe(1);
    // Mongo untouched — Site doc, AuditRuns, pages, snapshots still there.
    expect(await Site.countDocuments({ _id: siteId })).toBe(1);
    expect(await AuditRun.countDocuments({ siteId })).toBe(3);
  });

  it('retries a failed final queue sweep with the frozen resource manifest', async () => {
    const user = await seedUser('queue-retry@x.co');
    const { siteId, runIds } = await seedFullSite(user.id, 'queue-retry.example.com');
    const runId = String(runIds[0]);
    let sweep = 0;
    let removed = false;
    let failFinalSweep = true;
    const targetJob = {
      data: { nested: { runId } },
      remove: vi.fn(async () => {
        removed = true;
      }),
    };
    const queue = {
      removeJobScheduler: vi.fn(async (key: string) => {
        if (key === `rank-schedule:${siteId}`) sweep += 1;
        return true;
      }),
      getJobs: vi.fn(async (states: string[]) => {
        if (states.includes('active')) return [];
        if (sweep === 2 && failFinalSweep) {
          failFinalSweep = false;
          throw new Error('hostile final queue sweep failure');
        }
        if (sweep >= 3 && !removed && states.includes('wait')) return [targetJob];
        return [];
      }),
    };
    const queues = {
      audits: queue,
      ranks: queue,
      accountPurge: queue,
      gscSync: queue,
      ga4Sync: queue,
      contentAnalysis: queue,
      contentInventory: queue,
      internalLinks: queue,
      keywordClusters: queue,
      competitorContent: queue,
      competitorLandscapes: queue,
      contentMonitor: queue,
      audienceResearch: queue,
      weeklyPulse: queue,
      clientReports: queue,
      backlinkDeep: queue,
      trafficSnapshots: queue,
      reviewSync: queue,
      brandRadar: queue,
      contentBrief: queue,
      geogrid: queue,
      alertDispatch: queue,
      deadLetter: queue,
      close: vi.fn(async () => undefined),
    } as unknown as Queues;
    setSiteLifecycleQueues(queues);

    await expect(deleteSite(user.id, siteId)).rejects.toThrow(
      'hostile final queue sweep failure',
    );
    expect(await AuditRun.countDocuments({ siteId })).toBe(0);
    const claimed = await Site.findById(siteId).lean();
    expect(claimed?.deletionQueueResources.all).toContain(runId);
    expect(targetJob.remove).not.toHaveBeenCalled();

    await expect(deleteSite(user.id, siteId)).resolves.toBeUndefined();
    expect(targetJob.remove).toHaveBeenCalledOnce();
    expect(await Site.exists({ _id: siteId })).toBeNull();
  });

  it('site with no keywords skips the rankings delete branch cleanly', async () => {
    const user = await seedUser('nokw@x.co');
    const site = await insertSite(user.id, 'nokw.example.com');

    // Seed a backlink + competitor row but NO keywords → the "kws.length > 0"
    // branch inside the tx is intentionally skipped.
    const db = getTestDb();
    await db.insert(backlinkSnapshots).values({
      siteId: site._id.toString(),
      accountId: user.id,
      domainRating: 10,
      backlinks: 1,
      referringDomains: 1,
      brokenBacklinks: 0,
      fetchedAt: new Date(),
    });

    const res = await request(app)
      .delete(`/api/sites/${site._id.toString()}`)
      .set('Cookie', user.cookie);
    expect(res.status).toBe(200);
    expect(await Site.countDocuments({ _id: site._id })).toBe(0);
    expect(
      (
        await db
          .select()
          .from(backlinkSnapshots)
          .where(eq(backlinkSnapshots.siteId, site._id.toString()))
      ).length,
    ).toBe(0);
  });
});

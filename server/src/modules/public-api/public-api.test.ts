/**
 * Workstream C — public read-only API v1: bearer-key auth,
 * account scoping (404 not 403), rate limiting, last-used bookkeeping.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import request from 'supertest';
import express from 'express';
import mongoose from 'mongoose';
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
} from '../../shared/testing/auth.js';
import { apiKeys } from '../../db/schema/api-keys.js';
import { keywords, rankings } from '../../db/schema/keywords.js';
import { rateLimitHits } from '../../db/schema/rate-limit-hits.js';
import { eq } from 'drizzle-orm';
import { DICTIONARIES, SUPPORTED_LOCALES } from '../../shared/i18n/index.js';
import { language } from '../../shared/middleware/language.js';
import {
  apiRateLimitKey,
  createApiRateLimiter,
  markTokenAuthenticated,
  resetAuthenticatedTokens,
} from '../../shared/middleware/rate-limit.js';
import { createHash } from 'node:crypto';
import { env } from '../../config/env.js';
import { setRateLimitMetricsDb } from '../../shared/middleware/rate-limit-metrics.js';
import { Site } from '../sites/index.js';
import { AuditRun, writeReportSnapshot } from '../audits/index.js';
import { makeAuditResult } from '../audits/rules/fixtures.js';
import { setRanksDb } from '../ranks/index.js';
import { User } from '../users/index.js';
import { createApiKey, setApiKeysDb, touchLastUsed } from '../api-keys/index.js';
import { createApiKeyAuth } from './api-key-auth.js';

const app = createApp();

type ServiceDb = Parameters<typeof createApiKey>[0];

function db(): ServiceDb {
  return getTestDb() as unknown as ServiceDb;
}

/** Verified account + a live API key minted through the real service. */
async function seedUserWithKey(email: string) {
  const user = await signupVerifiedUser(app, { email });
  const created = await createApiKey(db(), { accountId: user.id, name: 'test key' });
  return { user, key: created.key, keyId: created.id };
}

async function seedSite(accountId: string, domain = 'example.com') {
  const site = await Site.create({
    accountId: new mongoose.Types.ObjectId(accountId),
    url: `https://${domain}`,
    domain,
  });
  return String(site._id);
}

async function seedSucceededRun(accountId: string, siteId: string) {
  const run = await AuditRun.create({
    accountId: new mongoose.Types.ObjectId(accountId),
    siteId: new mongoose.Types.ObjectId(siteId),
    pageCap: 100,
    status: 'succeeded',
  });
  await writeReportSnapshot({
    runId: String(run._id),
    siteId,
    accountId,
    result: makeAuditResult(),
  });
  return String(run._id);
}

async function seedKeywordWithHistory(accountId: string, siteId: string, phrase: string) {
  const [kw] = await getTestDb()
    .insert(keywords)
    .values({
      accountId,
      siteId,
      phrase,
      locationCode: 2840,
      languageCode: 'en',
    })
    .returning();
  if (!kw) throw new Error('keyword seed failed');
  await getTestDb()
    .insert(rankings)
    .values([
      {
        keywordId: kw.id,
        position: 12,
        rankAbsolute: 14,
        foundUrl: `https://${phrase}.example.com/`,
        aiOverviewPresent: true,
        aiCited: false,
        aiCitedUrl: null,
        checkedAt: new Date('2026-07-01T00:00:00Z'),
        source: 'fresh',
      },
      {
        keywordId: kw.id,
        position: 8,
        rankAbsolute: 9,
        foundUrl: `https://${phrase}.example.com/`,
        aiOverviewPresent: true,
        aiCited: true,
        aiCitedUrl: `https://${phrase}.example.com/cited`,
        checkedAt: new Date('2026-07-03T00:00:00Z'),
        source: 'fresh',
      },
    ]);
  return kw.id;
}

beforeAll(async () => {
  await startMemoryMongo();
  const testDb = await startTestPostgres();
  installTestAuth();
  setApiKeysDb(testDb as unknown as never);
  setRanksDb(testDb as unknown as never);
  setRateLimitMetricsDb(testDb as unknown as never);
});
afterAll(async () => {
  uninstallTestAuth();
  setApiKeysDb(null);
  setRanksDb(null);
  setRateLimitMetricsDb(null);
  await stopTestPostgres();
  await stopMemoryMongo();
});
beforeEach(async () => {
  await clearCollections();
  await truncateAllTables();
  vi.restoreAllMocks();
  resetAuthenticatedTokens();
});

describe('bearer-key authentication', () => {
  it('401 missingKey when no Authorization header is present', async () => {
    const res = await request(app).get('/api/v1/sites');
    expect(res.status).toBe(401);
    expect(res.body.error.message).toBe(DICTIONARIES.en.publicApi.errors.missingKey);
  });

  it('401 invalidKey for a malformed Authorization header', async () => {
    const res = await request(app)
      .get('/api/v1/sites')
      .set('Authorization', 'Basic dXNlcjpwYXNz');
    expect(res.status).toBe(401);
    expect(res.body.error.message).toBe(DICTIONARIES.en.publicApi.errors.invalidKey);
  });

  it('401 invalidKey for an unknown key — localized (Accept-Language: fr)', async () => {
    const res = await request(app)
      .get('/api/v1/sites')
      .set('Accept-Language', 'fr')
      .set('Authorization', 'Bearer rmf_AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA');
    expect(res.status).toBe(401);
    expect(res.body.error.message).toBe(DICTIONARIES.fr.publicApi.errors.invalidKey);
  });

  it('uses bearer precedence, normalizes regional tags, and ignores language cookies', async () => {
    const headerOverride = await request(app)
      .get('/api/v1/sites')
      .set('x-lang', 'fr-CA')
      .set('Accept-Language', 'de-DE')
      .set('Cookie', 'lang=ru');
    expect(headerOverride.status).toBe(401);
    expect(headerOverride.body.error.message).toBe(DICTIONARIES.fr.publicApi.errors.missingKey);
    expect(headerOverride.headers['content-language']).toBe('fr');
    expect(headerOverride.headers.vary).toContain('x-lang');
    expect(headerOverride.headers.vary).toContain('Accept-Language');
    expect(headerOverride.headers.vary).not.toContain('Cookie');

    const negotiated = await request(app)
      .get('/api/v1/sites')
      .set('x-lang', 'unsupported')
      .set('Accept-Language', 'de-DE')
      .set('Cookie', 'lang=ar');
    expect(negotiated.body.error.message).toBe(DICTIONARIES.de.publicApi.errors.missingKey);
    expect(negotiated.headers['content-language']).toBe('de');

    const fixedDefault = await request(app)
      .get('/api/v1/sites')
      .set('Cookie', 'lang=zh');
    expect(fixedDefault.body.error.message).toBe(DICTIONARIES.en.publicApi.errors.missingKey);
    expect(fixedDefault.headers['content-language']).toBe('en');
  });

  it('a key WITH MCP scopes still authenticates /api/v1 unchanged (scopes only restrict MCP)', async () => {
    const { key, keyId } = await seedUserWithKey('scoped-public@x.co');
    await getTestDb()
      .update(apiKeys)
      .set({ scopes: { tools: { start_audit: false }, allowSpend: false } })
      .where(eq(apiKeys.id, keyId));
    const res = await request(app)
      .get('/api/v1/sites')
      .set('Authorization', `Bearer ${key}`);
    expect(res.status).toBe(200);
  });

  it('401 invalidKey for a revoked key', async () => {
    const { key, keyId } = await seedUserWithKey('revoked@x.co');
    await getTestDb()
      .update(apiKeys)
      .set({ revokedAt: new Date() })
      .where(eq(apiKeys.id, keyId));
    const res = await request(app)
      .get('/api/v1/sites')
      .set('Authorization', `Bearer ${key}`);
    expect(res.status).toBe(401);
    expect(res.body.error.message).toBe(DICTIONARIES.en.publicApi.errors.invalidKey);
  });

  it('401 invalidKey when the owning account is suspended', async () => {
    const { user, key } = await seedUserWithKey('suspended@x.co');
    await User.updateOne({ _id: user.id }, { suspended: true, suspendedAt: new Date() });
    const res = await request(app)
      .get('/api/v1/sites')
      .set('Authorization', `Bearer ${key}`);
    expect(res.status).toBe(401);
    expect(res.body.error.message).toBe(DICTIONARIES.en.publicApi.errors.invalidKey);
  });

  it('401 invalidKey when the owning account has a scheduled deletion', async () => {
    const { user, key } = await seedUserWithKey('deleting@x.co');
    await User.updateOne({ _id: user.id }, { deletionScheduledAt: new Date() });
    const res = await request(app)
      .get('/api/v1/sites')
      .set('Authorization', `Bearer ${key}`);
    expect(res.status).toBe(401);
  });

  it('updates lastUsedAt after a successful call — and throttles the second immediate bump', async () => {
    const { key, keyId } = await seedUserWithKey('lastused@x.co');
    await request(app)
      .get('/api/v1/sites')
      .set('Authorization', `Bearer ${key}`)
      .expect(200);
    // The bump is fire-and-forget — poll until it lands.
    const firstTouched = await vi.waitFor(async () => {
      const [row] = await getTestDb().select().from(apiKeys).where(eq(apiKeys.id, keyId));
      expect(row?.lastUsedAt).toBeInstanceOf(Date);
      return row?.lastUsedAt as Date;
    });

    await request(app)
      .get('/api/v1/sites')
      .set('Authorization', `Bearer ${key}`)
      .expect(200);
    await new Promise((resolve) => setTimeout(resolve, 50));
    const [after] = await getTestDb().select().from(apiKeys).where(eq(apiKeys.id, keyId));
    // Second immediate call: stored value is < 60s old → write skipped.
    expect(after?.lastUsedAt?.getTime()).toBe(firstTouched.getTime());
  });

  it('a failed lastUsedAt bump is swallowed — the request still succeeds', async () => {
    const { user, key } = await seedUserWithKey('swallow@x.co');
    // Hybrid db: reads delegate to PGlite (resolveApiKey works); the
    // fire-and-forget update rejects.
    const real = getTestDb();
    const failing = {
      select: real.select.bind(real),
      update: () => ({
        set: () => ({ where: () => Promise.reject(new Error('boom')) }),
      }),
    };
    const middleware = createApiKeyAuth(() => failing as unknown as ServiceDb);
    const req = {
      get: (name: string) => (name === 'authorization' ? `Bearer ${key}` : undefined),
    } as unknown as express.Request;
    const next = vi.fn();
    // The middleware continues under the account work lease, which releases on
    // `res` finish/close — a bare object would blow up on `res.once`.
    const res = { once: () => res } as unknown as express.Response;
    middleware(req, res, next);
    await vi.waitFor(() => expect(next).toHaveBeenCalledWith());
    expect((req as { user?: { id: string } }).user?.id).toBe(user.id);
    expect((req as { apiKeyId?: string }).apiKeyId).toBeTruthy();
    // Let the rejected touch settle through the .catch swallow.
    await new Promise((resolve) => setTimeout(resolve, 20));
  });
});

describe('GET /api/v1/sites', () => {
  it('returns only the sites owned by the key account', async () => {
    const { user, key } = await seedUserWithKey('sites-a@x.co');
    const other = await seedUserWithKey('sites-b@x.co');
    const siteId = await seedSite(user.id, 'mine.example.com');
    await seedSite(other.user.id, 'theirs.example.com');

    const res = await request(app)
      .get('/api/v1/sites')
      .set('Authorization', `Bearer ${key}`);
    expect(res.status).toBe(200);
    expect(res.body.sites).toHaveLength(1);
    expect(res.body.sites[0]).toMatchObject({
      id: siteId,
      domain: 'mine.example.com',
      url: 'https://mine.example.com',
    });
    expect(res.body.sites[0].createdAt).toBeTruthy();
  });

  it('keeps machine-only site JSON exactly equal across all seven locales', async () => {
    const { user, key } = await seedUserWithKey('sites-locales@x.co');
    await seedSite(user.id, 'raw-source.example.com');
    let baseline: unknown;

    for (const locale of SUPPORTED_LOCALES) {
      const response = await request(app)
        .get('/api/v1/sites')
        .set('Authorization', `Bearer ${key}`)
        .set('x-lang', locale)
        .set('Cookie', 'lang=fr');
      expect(response.status).toBe(200);
      expect(response.headers['content-language']).toBe(locale);
      if (baseline === undefined) baseline = response.body;
      else expect(response.body).toEqual(baseline);
    }
  });
});

describe('GET /api/v1/sites/:siteId/report/latest', () => {
  it('returns the latest succeeded report', async () => {
    const { user, key } = await seedUserWithKey('report@x.co');
    const siteId = await seedSite(user.id, 'report.example.com');
    // An older succeeded run plus a newer one — the newest must win.
    await seedSucceededRun(user.id, siteId);
    const latestRunId = await seedSucceededRun(user.id, siteId);
    // A trailing failed run must not shadow the succeeded one.
    await AuditRun.create({
      accountId: new mongoose.Types.ObjectId(user.id),
      siteId: new mongoose.Types.ObjectId(siteId),
      pageCap: 100,
      status: 'failed',
    });

    const res = await request(app)
      .get(`/api/v1/sites/${siteId}/report/latest`)
      .set('Authorization', `Bearer ${key}`);
    expect(res.status).toBe(200);
    expect(res.body.runId).toBe(latestRunId);
    expect(Array.isArray(res.body.report.findings)).toBe(true);
  });

  it('localizes authored report copy while preserving finding machine/source fields', async () => {
    const { user, key } = await seedUserWithKey('report-language@x.co');
    const siteId = await seedSite(user.id, 'report-language.example.com');
    await seedSucceededRun(user.id, siteId);

    const english = await request(app)
      .get(`/api/v1/sites/${siteId}/report/latest`)
      .set('Authorization', `Bearer ${key}`)
      .set('x-lang', 'en');
    const arabic = await request(app)
      .get(`/api/v1/sites/${siteId}/report/latest`)
      .set('Authorization', `Bearer ${key}`)
      .set('x-lang', 'ar-EG');

    expect(english.status).toBe(200);
    expect(arabic.status).toBe(200);
    expect(arabic.headers['content-language']).toBe('ar');
    expect(arabic.headers.vary).toContain('x-lang');
    expect(arabic.headers.vary).toContain('Accept-Language');

    const enFinding = english.body.report.findings.find(
      (finding: { ruleId: string }) => finding.ruleId === 'mobile-unfriendly',
    );
    const arFinding = arabic.body.report.findings.find(
      (finding: { ruleId: string }) => finding.ruleId === 'mobile-unfriendly',
    );
    expect(enFinding.copy.title).toBe(DICTIONARIES.en.auditRules['mobile-unfriendly'].title);
    expect(arFinding.copy.title).toBe(DICTIONARIES.ar.auditRules['mobile-unfriendly'].title);
    expect(arFinding.copy.title).not.toBe(enFinding.copy.title);
    expect(arFinding.copy.titleKey).toBe(enFinding.copy.titleKey);
    expect(arFinding.ruleId).toBe(enFinding.ruleId);
    expect(arFinding.bucket).toBe(enFinding.bucket);
    expect(arFinding.severity).toBe(enFinding.severity);
    expect(arFinding.affectedUrls).toEqual(enFinding.affectedUrls);
    expect(arabic.body.runId).toBe(english.body.runId);
    expect(arabic.body.report.counts).toEqual(english.body.report.counts);
  });

  it("404 for another account's siteId (no existence leak)", async () => {
    const { key } = await seedUserWithKey('report-a@x.co');
    const other = await seedUserWithKey('report-b@x.co');
    const foreignSiteId = await seedSite(other.user.id, 'foreign.example.com');
    const res = await request(app)
      .get(`/api/v1/sites/${foreignSiteId}/report/latest`)
      .set('Authorization', `Bearer ${key}`)
      .set('x-lang', 'es-MX')
      .set('Cookie', 'lang=ru');
    expect(res.status).toBe(404);
    expect(res.body.error.message).toBe(DICTIONARIES.es.sites.errors.notFound);
    expect(res.headers['content-language']).toBe('es');
  });

  it('404 when the site has no succeeded run', async () => {
    const { user, key } = await seedUserWithKey('report-none@x.co');
    const siteId = await seedSite(user.id, 'norun.example.com');
    await AuditRun.create({
      accountId: new mongoose.Types.ObjectId(user.id),
      siteId: new mongoose.Types.ObjectId(siteId),
      pageCap: 100,
      status: 'failed',
    });
    const res = await request(app)
      .get(`/api/v1/sites/${siteId}/report/latest`)
      .set('Authorization', `Bearer ${key}`);
    expect(res.status).toBe(404);
    expect(res.body.error.message).toBe(DICTIONARIES.en.audits.errors.notFound);
  });

  it('400 for a malformed siteId', async () => {
    const { key } = await seedUserWithKey('report-bad@x.co');
    const res = await request(app)
      .get('/api/v1/sites/not-hex/report/latest')
      .set('Authorization', `Bearer ${key}`);
    expect(res.status).toBe(400);
  });
});

describe('GET /api/v1/sites/:siteId/rank-history', () => {
  it('returns per-keyword series with the AI-overview fields', async () => {
    const { user, key } = await seedUserWithKey('history@x.co');
    const siteId = await seedSite(user.id, 'history.example.com');
    const keywordId = await seedKeywordWithHistory(user.id, siteId, 'seo-audit');

    const res = await request(app)
      .get(`/api/v1/sites/${siteId}/rank-history`)
      .set('Authorization', `Bearer ${key}`);
    expect(res.status).toBe(200);
    expect(res.body.keywords).toHaveLength(1);
    const entry = res.body.keywords[0];
    expect(entry.id).toBe(keywordId);
    expect(entry.phrase).toBe('seo-audit');
    expect(entry.series).toHaveLength(2);
    expect(entry.series[0]).toMatchObject({
      position: 12,
      aiOverviewPresent: true,
      aiCited: false,
    });
    expect(entry.series[1]).toMatchObject({
      position: 8,
      aiOverviewPresent: true,
      aiCited: true,
      aiCitedUrl: 'https://seo-audit.example.com/cited',
    });
  });

  it('honours from/to bounds', async () => {
    const { user, key } = await seedUserWithKey('history-window@x.co');
    const siteId = await seedSite(user.id, 'window.example.com');
    await seedKeywordWithHistory(user.id, siteId, 'windowed');

    const res = await request(app)
      .get(`/api/v1/sites/${siteId}/rank-history`)
      .query({ from: '2026-07-02T00:00:00Z', to: '2026-07-04T00:00:00Z' })
      .set('Authorization', `Bearer ${key}`);
    expect(res.status).toBe(200);
    expect(res.body.keywords[0].series).toHaveLength(1);
    expect(res.body.keywords[0].series[0].position).toBe(8);
  });

  it('400 for an unparseable from date', async () => {
    const { user, key } = await seedUserWithKey('history-bad@x.co');
    const siteId = await seedSite(user.id, 'bad.example.com');
    const res = await request(app)
      .get(`/api/v1/sites/${siteId}/rank-history`)
      .query({ from: 'not-a-date' })
      .set('Authorization', `Bearer ${key}`);
    expect(res.status).toBe(400);
  });

  it("404 for another account's siteId", async () => {
    const { key } = await seedUserWithKey('history-a@x.co');
    const other = await seedUserWithKey('history-b@x.co');
    const foreignSiteId = await seedSite(other.user.id, 'foreign2.example.com');
    const res = await request(app)
      .get(`/api/v1/sites/${foreignSiteId}/rank-history`)
      .set('Authorization', `Bearer ${key}`);
    expect(res.status).toBe(404);
  });
});

describe('GET /api/v1/keywords', () => {
  it("aggregates tracked keywords across all the account's sites with latest position + AI fields", async () => {
    const { user, key } = await seedUserWithKey('kw@x.co');
    const other = await seedUserWithKey('kw-other@x.co');
    const siteA = await seedSite(user.id, 'a.example.com');
    const siteB = await seedSite(user.id, 'b.example.com');
    const foreign = await seedSite(other.user.id, 'c.example.com');
    await seedKeywordWithHistory(user.id, siteA, 'alpha');
    await seedKeywordWithHistory(user.id, siteB, 'beta');
    await seedKeywordWithHistory(other.user.id, foreign, 'gamma');

    const res = await request(app)
      .get('/api/v1/keywords')
      .set('Authorization', `Bearer ${key}`);
    expect(res.status).toBe(200);
    expect(res.body.keywords).toHaveLength(2);
    const phrases = res.body.keywords.map((k: { phrase: string }) => k.phrase).sort();
    expect(phrases).toEqual(['alpha', 'beta']);
    for (const kw of res.body.keywords) {
      expect(kw.latestPosition).toBe(8);
      expect(kw.aiOverviewPresent).toBe(true);
      expect(kw.aiCited).toBe(true);
    }
  });

  it('returns an empty list for an account with no sites', async () => {
    const { key } = await seedUserWithKey('kw-empty@x.co');
    const res = await request(app)
      .get('/api/v1/keywords')
      .set('Authorization', `Bearer ${key}`);
    expect(res.status).toBe(200);
    expect(res.body.keywords).toEqual([]);
  });
});

describe('rate limiting (/api/v1)', () => {
  it('emits a localized 429 and records a rate_limit_hits row with route=api', async () => {
    // Dedicated mini-app so the tiny bucket never leaks into other tests.
    // The bearer token is pre-marked authenticated so the per-token key path
    // exercises (an unproven token would bucket by IP instead).
    markTokenAuthenticated(createHash('sha256').update('rmf_tinybucket').digest('hex'));
    const mini = express();
    mini.use(language);
    mini.use('/api/v1', createApiRateLimiter({ max: 1, windowMs: 60_000 }));
    mini.get('/api/v1/sites', (_req, res) => {
      res.status(200).json({ ok: true });
    });

    await request(mini)
      .get('/api/v1/sites')
      .set('Authorization', 'Bearer rmf_tinybucket')
      .expect(200);
    const overflow = await request(mini)
      .get('/api/v1/sites')
      .set('Accept-Language', 'fr')
      .set('Authorization', 'Bearer rmf_tinybucket');
    expect(overflow.status).toBe(429);
    expect(overflow.body.error).toBe(DICTIONARIES.fr.security.error.rateLimited);

    await new Promise((resolve) => setImmediate(resolve));
    const rows = await getTestDb().select().from(rateLimitHits);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.route).toBe('api');
  });

  it('proven tokens get their own bucket — a second proven key is not throttled by the first', async () => {
    markTokenAuthenticated(createHash('sha256').update('rmf_keyone').digest('hex'));
    markTokenAuthenticated(createHash('sha256').update('rmf_keytwo').digest('hex'));
    const mini = express();
    mini.use(language);
    mini.use('/api/v1', createApiRateLimiter({ max: 1, windowMs: 60_000 }));
    mini.get('/api/v1/sites', (_req, res) => {
      res.status(200).json({ ok: true });
    });

    await request(mini)
      .get('/api/v1/sites')
      .set('Authorization', 'Bearer rmf_keyone')
      .expect(200);
    await request(mini)
      .get('/api/v1/sites')
      .set('Authorization', 'Bearer rmf_keyone')
      .expect(429);
    await request(mini)
      .get('/api/v1/sites')
      .set('Authorization', 'Bearer rmf_keytwo')
      .expect(200);
  });

  it('apiRateLimitKey unit contract', () => {
    // Unproven token → IP fallback.
    const unproven = {
      get: (name: string) => (name === 'authorization' ? 'Bearer rmf_abc' : undefined),
      ip: '10.1.2.3',
    } as unknown as express.Request;
    expect(apiRateLimitKey(unproven)).toBe('10.1.2.3');
    // Prove it and the same request now buckets per hash.
    const hash = createHash('sha256').update('rmf_abc').digest('hex');
    markTokenAuthenticated(hash);
    expect(apiRateLimitKey(unproven)).toBe(hash);
    // No token + no IP → 'unknown'.
    const withoutIp = { get: () => undefined } as unknown as express.Request;
    expect(apiRateLimitKey(withoutIp)).toBe('unknown');
    // No token + IP → IP.
    const withIp = {
      get: () => undefined,
      ip: '10.1.2.3',
    } as unknown as express.Request;
    expect(apiRateLimitKey(withIp)).toBe('10.1.2.3');
  });

  it('a flood of distinct random bearer tokens from one IP is 429d before the key lookup', async () => {
    // Build a dedicated app whose IP limiter is tiny so the flood tests are
    // fast AND the counter start point is clean. The per-token limiter that
    // comes after is dwarfed by the IP limiter and never fires here.
    const realDb = getTestDb();
    let selectCalls = 0;
    const spyDb = new Proxy(realDb, {
      get(target, prop, receiver) {
        if (prop === 'select') selectCalls += 1;
        return Reflect.get(target, prop, receiver);
      },
    }) as unknown as ServiceDb;
    setApiKeysDb(spyDb as unknown as never);
    try {
      const originalMax = env.RATE_LIMIT_API_MAX;
      (env as { RATE_LIMIT_API_MAX: number }).RATE_LIMIT_API_MAX = 3;
      const scopedApp = createApp();
      let last: request.Response | null = null;
      // Fire enough distinct random bearers to exhaust the IP bucket.
      for (let i = 0; i < 10; i += 1) {
        last = await request(scopedApp)
          .get('/api/v1/sites')
          .set('Authorization', `Bearer rmf_${i.toString().padStart(8, '0')}`);
      }
      expect(last?.status).toBe(429);
      const stopped = selectCalls;
      // Send another handful — the DB SELECT counter must NOT rise.
      for (let i = 0; i < 5; i += 1) {
        await request(scopedApp)
          .get('/api/v1/sites')
          .set('Authorization', `Bearer rmf_extra_${i}`);
      }
      expect(selectCalls).toBe(stopped);
      (env as { RATE_LIMIT_API_MAX: number }).RATE_LIMIT_API_MAX = originalMax;
    } finally {
      setApiKeysDb(realDb as unknown as never);
    }
  });

  it('a valid key gets a per-token bucket after first auth', async () => {
    const { key } = await seedUserWithKey('bucket@x.co');
    // The first request goes through IP limiter → per-token limiter (buckets
    // by IP because the token is not yet proven) → auth. Auth marks the
    // token as proven. Subsequent requests bucket per-token.
    const first = await request(app)
      .get('/api/v1/sites')
      .set('Authorization', `Bearer ${key}`);
    expect(first.status).toBe(200);
    const hash = createHash('sha256').update(key).digest('hex');
    // After a successful auth the token is proven — apiRateLimitKey now
    // returns the hash rather than the IP for this bearer.
    const req = {
      get: (name: string) => (name === 'authorization' ? `Bearer ${key}` : undefined),
      ip: '::ffff:127.0.0.1',
    } as unknown as express.Request;
    expect(apiRateLimitKey(req)).toBe(hash);
    const second = await request(app)
      .get('/api/v1/sites')
      .set('Authorization', `Bearer ${key}`);
    expect(second.status).toBe(200);
  });
});

describe('CODEBASE-REVIEW §4.1 — v1 rank-history batched query', () => {
  it('rank-history handler is batched: multiple keywords take one grouped query', async () => {
    const { user, key } = await seedUserWithKey('history-batch@x.co');
    const siteId = await seedSite(user.id, 'batched.example.com');
    // Three keywords, each with one ranking row.
    await seedKeywordWithHistory(user.id, siteId, 'alpha');
    await seedKeywordWithHistory(user.id, siteId, 'beta');
    await seedKeywordWithHistory(user.id, siteId, 'gamma');

    const res = await request(app)
      .get(`/api/v1/sites/${siteId}/rank-history`)
      .set('Authorization', `Bearer ${key}`);
    expect(res.status).toBe(200);
    // One entry per keyword — shape identical to the pre-batching contract.
    expect(res.body.keywords).toHaveLength(3);
    for (const entry of res.body.keywords) {
      expect(entry).toHaveProperty('id');
      expect(entry).toHaveProperty('phrase');
      expect(Array.isArray(entry.series)).toBe(true);
    }
  });

  it('empty account: rank-history returns an empty keyword list', async () => {
    const { user, key } = await seedUserWithKey('history-empty@x.co');
    const siteId = await seedSite(user.id, 'norkw.example.com');
    void user;
    const res = await request(app)
      .get(`/api/v1/sites/${siteId}/rank-history`)
      .set('Authorization', `Bearer ${key}`);
    expect(res.status).toBe(200);
    expect(res.body.keywords).toEqual([]);
  });
});

describe('touchLastUsed re-export smoke', () => {
  it('is reachable through the api-keys public API', async () => {
    const created = await createApiKey(db(), { accountId: 'acct-x', name: 'smoke' });
    await touchLastUsed(db(), created.id);
    const [row] = await getTestDb()
      .select()
      .from(apiKeys)
      .where(eq(apiKeys.id, created.id));
    expect(row?.lastUsedAt).toBeInstanceOf(Date);
  });
});

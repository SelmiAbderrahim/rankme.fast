/**
 * Competitor run service tests (spec §3) — fine-grained branches the router
 * test cannot reach: queue-null 503, kill switch, no-confirmed-competitors 400,
 * owned-URL safety/off-origin (never creates a run), the dup-key race, enqueue
 * compensation, pagination, and cancel edge cases.
 */
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import type { Queue } from 'bullmq';
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
import { env } from '../../config/env.js';
import { Site } from '../sites/index.js';
import { competitorProfiles } from '../../db/schema/index.js';
import type { FrozenReviewedPageMatch } from '../competitors/index.js';
import { CompetitorContentRun } from './competitor-content.model.js';
import {
  cancelCompetitorRun,
  getCompetitorRun,
  listCompetitorRuns,
  startCompetitorRun,
  toPublicCompetitorRun,
} from './competitor-content.runs.service.js';

const ACCOUNT = '000000000000000000000abc';
const db = (): ApplicationDb => getTestDb() as unknown as ApplicationDb;
const okQueue = (): Queue => ({ async add() { return { id: 'x' }; } } as unknown as Queue);

async function ownedSite(origin = 'https://example.com'): Promise<string> {
  const site = await Site.create({ accountId: ACCOUNT, url: origin, domain: new URL(origin).hostname, label: 's' });
  return String(site._id);
}
async function seedCompetitor(siteId: string, domain = 'example.org'): Promise<string> {
  const rows = await db()
    .insert(competitorProfiles)
    .values({ accountId: ACCOUNT, siteId, origin: `https://${domain}`, registrableDomain: domain, source: 'manual', status: 'active' })
    .returning();
  return rows[0]!.id;
}
async function runCount(): Promise<number> {
  return CompetitorContentRun.countDocuments({ accountId: ACCOUNT });
}
function body(over: Record<string, unknown> = {}) {
  const value = {
    competitorIds: [] as string[],
    ownedUrl: 'https://example.com/page',
    reviewedPageMatches: [] as Array<{ landscapeReportId: string; suggestionId: string }>,
    competitorUrls: [] as Array<{ competitorId: string; url: string }>,
    pageLimit: 15,
    locale: 'en' as const,
    ...over,
  };
  if (value.competitorIds.length > 0 && value.competitorUrls.length === 0) {
    value.competitorUrls = value.competitorIds.map((competitorId) => ({
      competitorId,
      url: 'https://example.org/ranking-page',
    }));
  }
  return value;
}

function reviewedLoader(
  competitorProfileId: string,
  overrides: Partial<FrozenReviewedPageMatch> = {},
) {
  return vi.fn(async (
    _db: ApplicationDb,
    reference: {
      reportId: string;
      suggestionId: string;
      opportunityId?: string | null;
    },
  ): Promise<FrozenReviewedPageMatch> => ({
    landscapeReportId: reference.reportId,
    landscapeOpportunityId: reference.opportunityId ?? null,
    suggestionId: reference.suggestionId,
    competitorProfileId,
    suggestedUrl: 'https://example.org/suggested',
    selectedUrl: 'https://example.org/selected',
    ownedUrl: 'https://example.com/page',
    keywordEvidence: [],
    ...overrides,
  }));
}

beforeAll(async () => {
  await startMemoryMongo();
  await startTestPostgres();
});
afterAll(async () => {
  await stopMemoryMongo();
  await stopTestPostgres();
});
afterEach(async () => {
  await clearCollections();
  await truncateAllTables();
});

describe('startCompetitorRun — guards (never create a run on failure)', () => {
  it('503 when the queue is unavailable', async () => {
    const siteId = await ownedSite();
    await expect(
      startCompetitorRun({ accountId: ACCOUNT, ownerUserId: ACCOUNT, siteId, body: body() }, { db: db(), queue: null }),
    ).rejects.toMatchObject({ status: 503 });
  });

  it('404 for an invalid or unowned site id', async () => {
    await expect(
      startCompetitorRun({ accountId: ACCOUNT, ownerUserId: ACCOUNT, siteId: 'nope', body: body() }, { db: db(), queue: okQueue() }),
    ).rejects.toMatchObject({ status: 404 });
    // A well-formed but non-existent ObjectId → findOne miss → 404.
    await expect(
      startCompetitorRun({ accountId: ACCOUNT, ownerUserId: ACCOUNT, siteId: '0000000000000000000000ff', body: body() }, { db: db(), queue: okQueue() }),
    ).rejects.toMatchObject({ status: 404 });
  });

  it('503 when the kill switch is off', async () => {
    const siteId = await ownedSite();
    const prior = env.COMPETITOR_CONTENT_INTELLIGENCE_ENABLED;
    (env as { COMPETITOR_CONTENT_INTELLIGENCE_ENABLED: boolean }).COMPETITOR_CONTENT_INTELLIGENCE_ENABLED = false;
    try {
      await expect(
        startCompetitorRun({ accountId: ACCOUNT, ownerUserId: ACCOUNT, siteId, body: body() }, { db: db(), queue: okQueue() }),
      ).rejects.toMatchObject({ status: 503 });
    } finally {
      (env as { COMPETITOR_CONTENT_INTELLIGENCE_ENABLED: boolean }).COMPETITOR_CONTENT_INTELLIGENCE_ENABLED = prior;
    }
  });

  it('400 when none of the selected competitors are confirmed (no run created)', async () => {
    const siteId = await ownedSite();
    await expect(
      startCompetitorRun({ accountId: ACCOUNT, ownerUserId: ACCOUNT, siteId, body: body({ competitorIds: ['ghost'] }) }, { db: db(), queue: okQueue() }),
    ).rejects.toMatchObject({ status: 404 });
    expect(await runCount()).toBe(0);
  });

  it('requires at least one reviewed page or explicit compatibility URL', async () => {
    const siteId = await ownedSite();
    await expect(
      startCompetitorRun(
        { accountId: ACCOUNT, ownerUserId: ACCOUNT, siteId, body: body() },
        { db: db(), queue: okQueue() },
      ),
    ).rejects.toMatchObject({
      status: 400,
      message: 'contentIntelligence.competitorContent.errors.reviewedPagesRequired',
    });
    expect(await runCount()).toBe(0);
  });

  it('freezes distinct reviewed ranking-page legs for one active competitor', async () => {
    const siteId = await ownedSite();
    const competitorId = await seedCompetitor(siteId);
    const loadReviewedPageMatch = reviewedLoader(competitorId);
    const reviewedPageMatches = [
      { landscapeReportId: '000000000000000000000031', suggestionId: 'suggestion-1' },
      {
        landscapeReportId: '000000000000000000000031',
        landscapeOpportunityId: 'opportunity-2',
        suggestionId: 'suggestion-2',
      },
    ];
    const started = await startCompetitorRun(
      {
        accountId: ACCOUNT,
        ownerUserId: ACCOUNT,
        siteId,
        body: body({ reviewedPageMatches, pageLimit: 2 }),
      },
      { db: db(), queue: okQueue(), loadReviewedPageMatch },
    );
    expect(loadReviewedPageMatch).toHaveBeenCalledTimes(2);
    const run = await CompetitorContentRun.findById(started.runId).lean();
    expect(run?.input.compatibilityMode).toBe('reviewed_pages');
    expect(run?.input.competitorIds).toEqual([competitorId]);
    expect(run?.input.pageMatches).toEqual([
      expect.objectContaining({
        source: 'landscape_review',
        landscapeOpportunityId: null,
        suggestionId: 'suggestion-1',
      }),
      expect.objectContaining({
        source: 'landscape_review',
        landscapeOpportunityId: 'opportunity-2',
        suggestionId: 'suggestion-2',
      }),
    ]);
  });

  it('rejects duplicate reviewed legs and a reviewed set above the page limit', async () => {
    const siteId = await ownedSite();
    const competitorId = await seedCompetitor(siteId);
    const loadReviewedPageMatch = reviewedLoader(competitorId);
    const duplicate = {
      landscapeReportId: '000000000000000000000032',
      suggestionId: 'duplicate-suggestion',
    };
    await expect(
      startCompetitorRun(
        {
          accountId: ACCOUNT,
          ownerUserId: ACCOUNT,
          siteId,
          body: body({ reviewedPageMatches: [duplicate, duplicate], pageLimit: 2 }),
        },
        { db: db(), queue: okQueue(), loadReviewedPageMatch },
      ),
    ).rejects.toMatchObject({
      status: 400,
      message: 'contentIntelligence.competitorContent.errors.duplicatePageMatch',
    });

    await expect(
      startCompetitorRun(
        {
          accountId: ACCOUNT,
          ownerUserId: ACCOUNT,
          siteId,
          body: body({
            reviewedPageMatches: [
              { ...duplicate, suggestionId: 'one' },
              { ...duplicate, suggestionId: 'two' },
            ],
            pageLimit: 1,
          }),
        },
        { db: db(), queue: okQueue(), loadReviewedPageMatch },
      ),
    ).rejects.toMatchObject({
      status: 400,
      message: 'contentIntelligence.competitorContent.errors.pageLimitExceeded',
    });
  });

  it.each([
    {
      name: 'missing owned URL',
      overrides: { ownedUrl: '' },
      message: 'contentIntelligence.competitorContent.errors.ownedUrlRequired',
    },
    {
      name: 'unsafe selected URL',
      overrides: { selectedUrl: 'https://127.0.0.1/private' },
      message: 'contentIntelligence.competitorContent.errors.urlUnsafe',
    },
    {
      name: 'off-domain selected URL',
      overrides: { selectedUrl: 'https://example.net/page' },
      message: 'contentIntelligence.competitorContent.errors.competitorUrlOffDomain',
    },
    {
      name: 'off-origin owned URL',
      overrides: { ownedUrl: 'https://example.net/page' },
      message: 'contentIntelligence.competitorContent.errors.ownedUrlOffOrigin',
    },
  ])('rejects a reviewed page with $name before creating a run', async ({ overrides, message }) => {
    const siteId = await ownedSite();
    const competitorId = await seedCompetitor(siteId);
    await expect(
      startCompetitorRun(
        {
          accountId: ACCOUNT,
          ownerUserId: ACCOUNT,
          siteId,
          body: body({
            reviewedPageMatches: [
              {
                landscapeReportId: '000000000000000000000033',
                suggestionId: 'reviewed-suggestion',
              },
            ],
          }),
        },
        {
          db: db(),
          queue: okQueue(),
          loadReviewedPageMatch: reviewedLoader(competitorId, overrides),
        },
      ),
    ).rejects.toMatchObject({ status: 400, message });
    expect(await runCount()).toBe(0);
  });

  it('400 for an unsafe owned URL — never creates a run', async () => {
    const siteId = await ownedSite();
    const cid = await seedCompetitor(siteId);
    await expect(
      startCompetitorRun({ accountId: ACCOUNT, ownerUserId: ACCOUNT, siteId, body: body({ competitorIds: [cid], ownedUrl: 'https://127.0.0.1/' }) }, { db: db(), queue: okQueue() }),
    ).rejects.toMatchObject({ status: 400 });
    expect(await runCount()).toBe(0);
  });

  it('400 for an owned URL off the site origin — never creates a run', async () => {
    const siteId = await ownedSite();
    const cid = await seedCompetitor(siteId);
    await expect(
      startCompetitorRun({ accountId: ACCOUNT, ownerUserId: ACCOUNT, siteId, body: body({ competitorIds: [cid], ownedUrl: 'https://example.org/page' }) }, { db: db(), queue: okQueue() }),
    ).rejects.toMatchObject({ status: 400 });
    expect(await runCount()).toBe(0);
  });

  it('creates one run and enqueues on the happy path', async () => {
    const siteId = await ownedSite();
    const cid = await seedCompetitor(siteId);
    const res = await startCompetitorRun(
      { accountId: ACCOUNT, ownerUserId: ACCOUNT, siteId, body: body({ competitorIds: [cid] }) },
      { db: db(), queue: okQueue() },
    );
    expect(res.duplicate).toBe(false);
    expect(await runCount()).toBe(1);
  });

  it('canonicalizes multiple explicit compatibility URLs in the idempotency scope', async () => {
    const siteId = await ownedSite();
    const firstId = await seedCompetitor(siteId, 'example.org');
    const secondId = await seedCompetitor(siteId, 'example.net');
    const started = await startCompetitorRun(
      {
        accountId: ACCOUNT,
        ownerUserId: ACCOUNT,
        siteId,
        body: body({
          competitorIds: [secondId, firstId],
          competitorUrls: [
            { competitorId: secondId, url: 'https://example.net/ranking-page' },
            { competitorId: firstId, url: 'https://example.org/ranking-page' },
          ],
        }),
      },
      { db: db(), queue: okQueue() },
    );
    const run = await CompetitorContentRun.findById(started.runId).lean();
    expect(run?.input.compatibilityMode).toBe('legacy_explicit');
    expect(new Set(run?.input.competitorDomains)).toEqual(
      new Set(['example.org', 'example.net']),
    );
  });

  it('rejects explicit compatibility URLs when their owned page is omitted', async () => {
    const siteId = await ownedSite();
    const competitorId = await seedCompetitor(siteId);
    await expect(
      startCompetitorRun(
        {
          accountId: ACCOUNT,
          ownerUserId: ACCOUNT,
          siteId,
          body: body({ competitorIds: [competitorId], ownedUrl: undefined }),
        },
        { db: db(), queue: okQueue() },
      ),
    ).rejects.toMatchObject({
      status: 400,
      message: 'contentIntelligence.competitorContent.errors.ownedUrlRequired',
    });
  });

  it('resolves a concurrent identical request to a single run', async () => {
    const siteId = await ownedSite();
    const cid = await seedCompetitor(siteId);
    const start = () => startCompetitorRun({ accountId: ACCOUNT, ownerUserId: ACCOUNT, siteId, body: body({ competitorIds: [cid] }) }, { db: db(), queue: okQueue() });
    const [a, b] = await Promise.all([start(), start()]);
    expect(a.runId).toBe(b.runId);
    expect(a.duplicate !== b.duplicate).toBe(true);
    expect(await CompetitorContentRun.countDocuments({ accountId: ACCOUNT })).toBe(1);
  });

  it('409 when a different run is already in flight', async () => {
    const siteId = await ownedSite();
    const cid = await seedCompetitor(siteId);
    await startCompetitorRun({ accountId: ACCOUNT, ownerUserId: ACCOUNT, siteId, body: body({ competitorIds: [cid], clientKey: 'k1' }) }, { db: db(), queue: okQueue() });
    await expect(
      startCompetitorRun({ accountId: ACCOUNT, ownerUserId: ACCOUNT, siteId, body: body({ competitorIds: [cid], clientKey: 'k2' }) }, { db: db(), queue: okQueue() }),
    ).rejects.toMatchObject({ status: 409 });
  });

  it('rethrows a non-duplicate create failure', async () => {
    const siteId = await ownedSite();
    const cid = await seedCompetitor(siteId);
    const spy = vi.spyOn(CompetitorContentRun, 'create').mockRejectedValueOnce('boom' as never);
    await expect(
      startCompetitorRun({ accountId: ACCOUNT, ownerUserId: ACCOUNT, siteId, body: body({ competitorIds: [cid] }) }, { db: db(), queue: okQueue() }),
    ).rejects.toBe('boom');
    expect(await runCount()).toBe(0);
    spy.mockRestore();
  });

  it('rethrows a duplicate-key failure when the racing run is not visible', async () => {
    const siteId = await ownedSite();
    const cid = await seedCompetitor(siteId);
    const spy = vi.spyOn(CompetitorContentRun, 'create').mockRejectedValueOnce({ name: 'MongoServerError' } as never);
    await expect(
      startCompetitorRun({ accountId: ACCOUNT, ownerUserId: ACCOUNT, siteId, body: body({ competitorIds: [cid] }) }, { db: db(), queue: okQueue() }),
    ).rejects.toMatchObject({ name: 'MongoServerError' });
    spy.mockRestore();
  });

  it('returns the racing run when a duplicate-key create becomes visible', async () => {
    const siteId = await ownedSite();
    const cid = await seedCompetitor(siteId);
    const race = {
      _id: '0000000000000000000000aa',
      status: 'queued',
    };
    const findSpy = vi
      .spyOn(CompetitorContentRun, 'findOne')
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(race as never);
    const createSpy = vi
      .spyOn(CompetitorContentRun, 'create')
      .mockRejectedValueOnce({ name: 'MongoServerError' } as never);

    const result = await startCompetitorRun(
      {
        accountId: ACCOUNT,
        ownerUserId: ACCOUNT,
        siteId,
        body: body({ competitorIds: [cid] }),
      },
      { db: db(), queue: okQueue() },
    );

    expect(result).toEqual({
      runId: race._id,
      status: 'queued',
      duplicate: true,
    });
    createSpy.mockRestore();
    findSpy.mockRestore();
  });

  it('compensates (marks the run failed) when the enqueue throws', async () => {
    const siteId = await ownedSite();
    const cid = await seedCompetitor(siteId);
    const throwingQueue = { async add() { throw new Error('redis down'); } } as unknown as Queue;
    await expect(
      startCompetitorRun({ accountId: ACCOUNT, ownerUserId: ACCOUNT, siteId, body: body({ competitorIds: [cid] }) }, { db: db(), queue: throwingQueue }),
    ).rejects.toMatchObject({ status: 503 });
    const run = await CompetitorContentRun.findOne({ accountId: ACCOUNT });
    expect(run!.status).toBe('failed');
  });

  it('short-circuits an identical resend to the existing run', async () => {
    const siteId = await ownedSite();
    const cid = await seedCompetitor(siteId);
    const first = await startCompetitorRun({ accountId: ACCOUNT, ownerUserId: ACCOUNT, siteId, body: body({ competitorIds: [cid] }) }, { db: db(), queue: okQueue() });
    const second = await startCompetitorRun({ accountId: ACCOUNT, ownerUserId: ACCOUNT, siteId, body: body({ competitorIds: [cid] }) }, { db: db(), queue: okQueue() });
    expect(second.duplicate).toBe(true);
    expect(second.runId).toBe(first.runId);
    expect(await runCount()).toBe(1);
  });
});

describe('serialization + reads', () => {
  it('toPublicCompetitorRun fills every missing field on a bare document', () => {
    const view = toPublicCompetitorRun({
      _id: 'r1', siteId: 's', origin: 'https://example.com',
      ownedUrl: 'https://example.com/p', locale: 'ar', status: 'queued',
      warnings: [{
        code: 'competitor_partial',
        messageKey: 'contentIntelligence.competitorContent.warnings.partialPortfolio',
      }],
    } as never);
    expect(view.input.pageLimit).toBe(0);
    expect(view.progress.competitorsRequested).toBe(0);
    expect(view.findings).toBeNull();
    expect(view).not.toHaveProperty('reservation');
    expect(view.keyword).toBeNull();
    expect(view.requestedAt).toBeNull();
    expect(view.warnings[0]).toMatchObject({
      code: 'competitor_partial',
      messageKey: 'contentIntelligence.competitorContent.warnings.partialPortfolio',
    });
    expect(toPublicCompetitorRun({
      _id: 'legacy-r1',
      siteId: 's',
      origin: 'https://example.com',
      ownedUrl: 'https://example.com/p',
      locale: 'en',
      status: 'queued',
    } as never).warnings).toEqual([]);
  });

  it('paginates with an HMAC cursor and rejects a tampered cursor', async () => {
    const siteId = await ownedSite();
    for (let i = 0; i < 2; i += 1) {
      await CompetitorContentRun.create(makeRun(siteId, { requestedAt: new Date(2026, 0, i + 1) }));
    }
    const first = await listCompetitorRuns({ accountId: ACCOUNT, siteId, limit: 1 });
    expect(first.items).toHaveLength(1);
    expect(first.nextCursor).not.toBeNull();
    const second = await listCompetitorRuns({ accountId: ACCOUNT, siteId, limit: 1, cursor: first.nextCursor! });
    expect(second.items[0]!.runId).not.toBe(first.items[0]!.runId);
    await expect(listCompetitorRuns({ accountId: ACCOUNT, siteId, limit: 1, cursor: 'garbage' })).rejects.toMatchObject({ status: 400 });
  });

  it('getCompetitorRun serializes findings + page facts and drops invalid page rows', async () => {
    const siteId = await ownedSite();
    const findings = { version: '1', thresholdsVersion: '1', ownedUrl: 'https://example.com/p', keyword: null, deltas: [], opportunities: [], partialDomains: [], aiExplanation: 'ok' };
    const run = await CompetitorContentRun.create(makeRun(siteId, { status: 'completed', findings }));
    const { CompetitorPageFacts } = await import('./competitor-content.model.js');
    await CompetitorPageFacts.create({ runId: run._id, accountId: ACCOUNT, siteId, role: 'owned', url: 'https://example.com/p', contentHash: 'h', createdAtMs: Date.now(), facts: validFacts('https://example.com/p') });
    await CompetitorPageFacts.create({ runId: run._id, accountId: ACCOUNT, siteId, role: 'competitor', url: 'https://rival.com/', contentHash: 'h2', createdAtMs: Date.now(), facts: { bad: true } });
    const view = await getCompetitorRun({ accountId: ACCOUNT, runId: String(run._id) });
    expect(view.findings?.aiExplanation).toBe('ok');
    expect(view.pages).toHaveLength(1);
    expect(view.pages[0]!.role).toBe('owned');
  });

  it('getCompetitorRun 404s for an invalid or non-existent id', async () => {
    await expect(getCompetitorRun({ accountId: ACCOUNT, runId: 'nope' })).rejects.toMatchObject({ status: 404 });
    await expect(getCompetitorRun({ accountId: ACCOUNT, runId: '0000000000000000000000ff' })).rejects.toMatchObject({ status: 404 });
  });
});

describe('cancelCompetitorRun', () => {
  it('404s for an invalid id and a missing run', async () => {
    await expect(cancelCompetitorRun({ accountId: ACCOUNT, runId: 'nope' })).rejects.toMatchObject({ status: 404 });
    await expect(cancelCompetitorRun({ accountId: ACCOUNT, runId: '0000000000000000000000ff' })).rejects.toMatchObject({ status: 404 });
  });

  it('409s a terminal run and cancels a live one', async () => {
    const siteId = await ownedSite();
    const done = await CompetitorContentRun.create(makeRun(siteId, { status: 'completed' }));
    await expect(cancelCompetitorRun({ accountId: ACCOUNT, runId: String(done._id) })).rejects.toMatchObject({ status: 409 });
    const live = await CompetitorContentRun.create(makeRun(siteId, { status: 'collecting' }));
    await cancelCompetitorRun({ accountId: ACCOUNT, runId: String(live._id) });
    expect((await CompetitorContentRun.findById(live._id))!.status).toBe('cancelled');
  });
});

function validFacts(url: string) {
  return { url, role: 'owned', competitorDomain: null, statusCode: 200, title: 't', description: null, headings: [], wordCount: 10, schemaTypes: [], hasSchemaOrgArticle: false, internalLinkCount: 0, externalLinkCount: 0, contentHash: 'h', primaryTopics: [], secondaryTopics: [], snippet: '' };
}

function makeRun(siteId: string, over: Record<string, unknown> = {}) {
  const key = `res_${Math.random().toString(36).slice(2)}`;
  return {
    accountId: ACCOUNT, ownerUserId: ACCOUNT, siteId, origin: 'https://example.com', ownedUrl: 'https://example.com/page', locale: 'en', status: 'queued',
    input: { competitorIds: ['a'], competitorDomains: ['example.org'], pageLimit: 15 },
    stages: [], warnings: [], error: null, inputFingerprint: `fp_${key}`, idempotencyKey: key, requestedAt: new Date(), ...over,
  };
}

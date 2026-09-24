import express, { type RequestHandler } from 'express';
import request from 'supertest';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type * as CompareService from './compare.service.js';

vi.mock('./app-seo.holder.js', () => ({
  getAppSeoDb: vi.fn(() => ({ kind: 'app-seo-test-db' })),
}));

vi.mock('./charts.service.js', () => ({
  createAppChartSubscription: vi.fn(async () => ({ id: 'chart-subscription' })),
  deleteAppChartSubscription: vi.fn(async () => undefined),
  getAppChartHistory: vi.fn(async () => []),
  listAppChartSubscriptions: vi.fn(async () => ({ items: [] })),
  recheckAppChartSubscription: vi.fn(async () => ({ queued: true })),
}));

vi.mock('./keywords.service.js', () => ({
  deleteAppKeyword: vi.fn(async () => undefined),
  getAppKeywordHistory: vi.fn(async () => []),
  listAppKeywords: vi.fn(async () => ({ items: [] })),
  mintAppKeyword: vi.fn(async () => ({ id: 'keyword' })),
  previewMintAppKeyword: vi.fn(async () => ({ check: { deploymentMode: 'community', capacityEnforced: false } })),
  recheckAppKeyword: vi.fn(async () => ({ queued: true })),
}));

vi.mock('./listing.service.js', () => ({
  createAppListingRun: vi.fn(async () => ({ queued: true })),
  readAppListingHistory: vi.fn(async () => ({ items: [] })),
  readLatestAppListing: vi.fn(async () => ({ snapshot: null })),
}));

vi.mock('./research.service.js', () => ({
  previewAppResearch: vi.fn(async () => ({ deploymentMode: 'community', capacityEnforced: false })),
  readLatestAppResearch: vi.fn(async () => ({ result: null })),
  runAppCompetitorDiscovery: vi.fn(async () => ({ surface: 'competitors' })),
  runAppGapResearch: vi.fn(async () => ({ surface: 'gap' })),
  runAppKeywordResearch: vi.fn(async () => ({ surface: 'keywords' })),
}));

vi.mock('./reviews.service.js', () => ({
  createAppReviewRun: vi.fn(async () => ({ queued: true })),
  getAppReviewRun: vi.fn(async () => ({ id: 'review-run' })),
  listAppReviewRuns: vi.fn(async () => ({ items: [] })),
}));

vi.mock('./compare.service.js', async (importOriginal) => {
  const actual = await importOriginal<typeof CompareService>();
  return {
    ...actual,
    readAppSeoComparison: vi.fn(async () => ({ pairingProvenance: 'user-paired' })),
  };
});

import * as chartService from './charts.service.js';
import * as keywordService from './keywords.service.js';
import * as listingService from './listing.service.js';
import * as researchService from './research.service.js';
import * as reviewService from './reviews.service.js';
import * as compareService from './compare.service.js';
import { createAppChartRouter } from './charts.routes.js';
import { createAppKeywordRouter } from './keywords.routes.js';
import { createAppListingRouter } from './listing.routes.js';
import { createAppResearchRouter } from './research.routes.js';
import { createAppReviewRouter } from './reviews.routes.js';
import { createAppSeoCompareRouter } from './compare.routes.js';
import { getAppSeoTrackingQueue, setAppSeoTrackingQueue } from './keywords.queue-holder.js';
import { mintAppKeywordBodySchema } from './keywords.schema.js';
import { appResearchGapBodySchema } from './research.schema.js';
import {
  APP_REVIEW_RUN_MAX_REVIEWS,
  AppReviewRun,
  canTransitionAppReviewRunStatus,
} from './reviews.model.js';

const pass: RequestHandler = (_req, _res, next) => next();
const keywordId = '11111111-1111-4111-8111-111111111111';
const preview = { deploymentMode: 'community', capacityEnforced: false } as const;

function controllerApp() {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    req.workspaceAccountId = 'controller-account';
    req.language = 'fr';
    next();
  });
  app.use('/sites/:siteId/charts', createAppChartRouter({ createLimiter: pass, pollLimiter: pass }));
  app.use('/sites/:siteId/keywords', createAppKeywordRouter({ createLimiter: pass, pollLimiter: pass }));
  app.use('/sites/:siteId/listing', createAppListingRouter({ createLimiter: pass, pollLimiter: pass }));
  app.use('/sites/:siteId/research', createAppResearchRouter({ createLimiter: pass, pollLimiter: pass }));
  app.use('/sites/:siteId/reviews', createAppReviewRouter({ createLimiter: pass, pollLimiter: pass }));
  app.use('/sites/:siteId/compare', createAppSeoCompareRouter(pass));
  return app;
}

describe('App SEO thin controllers and routers', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(chartService.recheckAppChartSubscription).mockResolvedValue({
      preview,
      queued: true,
      reservationStamp: '2026-W01',
    });
    vi.mocked(keywordService.recheckAppKeyword).mockResolvedValue({
      preview,
      queued: true,
      reservationStamp: '2026-W01',
    });
    vi.mocked(listingService.createAppListingRun).mockResolvedValue({
      preview,
      queued: true,
      runId: 'run',
      capturedAt: '2026-08-01T00:00:00.000Z',
    });
    vi.mocked(reviewService.createAppReviewRun).mockResolvedValue({
      preview,
      queued: true,
      run: null,
    });
  });

  it('maps every chart and keyword route to its owner-scoped service contract', async () => {
    const app = controllerApp();
    const chartBody = {
      profileId: 'profile',
      store: 'google_play',
      chartId: 'top-free',
      categoryId: 'business',
    };
    expect((await request(app).post('/sites/site/charts').send(chartBody)).status).toBe(201);
    expect((await request(app).get('/sites/site/charts?profileId=profile')).status).toBe(200);
    expect((await request(app).delete('/sites/site/charts/subscription')).status).toBe(204);
    expect(
      (await request(app).post('/sites/site/charts/subscription/recheck').send({ confirm: true }))
        .status,
    ).toBe(202);
    expect(
      (await request(app).post('/sites/site/charts/subscription/recheck').send({ confirm: false }))
        .status,
    ).toBe(200);
    expect((await request(app).get('/sites/site/charts/subscription/history?limit=4')).status)
      .toBe(200);

    const keywordBody = { phrase: ' Branded Phrase ', store: 'app_store' };
    expect(
      (await request(app).post('/sites/site/keywords?profileId=profile&preview=true').send(keywordBody))
        .status,
    ).toBe(200);
    expect(
      (await request(app).post('/sites/site/keywords?profileId=profile').send(keywordBody)).status,
    ).toBe(201);
    expect((await request(app).get('/sites/site/keywords?profileId=profile')).status).toBe(200);
    expect((await request(app).delete(`/sites/site/keywords/${keywordId}`)).status).toBe(204);
    expect(
      (await request(app).post(`/sites/site/keywords/${keywordId}/recheck`).send({ confirm: true }))
        .status,
    ).toBe(202);
    expect(
      (await request(app).post(`/sites/site/keywords/${keywordId}/recheck`).send({ confirm: false }))
        .status,
    ).toBe(200);
    expect((await request(app).get(`/sites/site/keywords/${keywordId}/history?limit=4`)).status)
      .toBe(200);

    expect(keywordService.previewMintAppKeyword).toHaveBeenCalledWith({
      accountId: 'controller-account',
      siteId: 'site',
      profileId: 'profile',
      store: 'app_store',
    });
    expect(keywordService.mintAppKeyword).toHaveBeenCalledWith(
      expect.objectContaining({
        accountId: 'controller-account',
        siteId: 'site',
        keyword: expect.objectContaining({ phrase: 'branded phrase' }),
      }),
      expect.anything(),
    );
  });

  it('maps listing, research, review, and compare routes including conditional statuses', async () => {
    const app = controllerApp();
    const listingBody = { profileId: 'profile', confirm: true };
    expect((await request(app).post('/sites/site/listing/runs').send(listingBody)).status).toBe(202);
    vi.mocked(listingService.createAppListingRun).mockResolvedValueOnce({
      preview,
      queued: false,
      runId: null,
      capturedAt: null,
    });
    expect((await request(app).post('/sites/site/listing/runs').send(listingBody)).status).toBe(200);
    const latestListing = await request(app).get('/sites/site/listing/latest?profileId=profile');
    expect(latestListing.status).toBe(200);
    expect(latestListing.headers['content-language']).toBe('fr');
    expect((await request(app).get('/sites/site/listing/history?profileId=profile&limit=5')).status)
      .toBe(200);

    const researchBody = { profileId: 'profile', store: 'google_play' };
    expect(
      (await request(app).get('/sites/site/research/keywords/preview?profileId=profile&store=google_play'))
        .status,
    ).toBe(200);
    expect(
      (await request(app).get('/sites/site/research/gap/preview?profileId=profile&store=google_play&appIds=fast.one.app,%20,%20fast.two.app'))
        .status,
    ).toBe(200);
    expect(
      (await request(app).get('/sites/site/research/competitors/preview?profileId=profile&store=google_play'))
        .status,
    ).toBe(200);
    expect((await request(app).post('/sites/site/research/keywords').send(researchBody)).status)
      .toBe(200);
    expect(
      (await request(app).post('/sites/site/research/gap').send({
        ...researchBody,
        appIds: ['fast.one.app', 'fast.two.app'],
      })).status,
    ).toBe(200);
    expect((await request(app).post('/sites/site/research/competitors').send(researchBody)).status)
      .toBe(200);
    for (const surface of ['keywords', 'gap', 'competitors']) {
      expect(
        (await request(app).get(`/sites/site/research/${surface}?profileId=profile&store=google_play`))
          .status,
      ).toBe(200);
    }

    const reviewBody = { profileId: 'profile', store: 'app_store', confirm: true };
    expect((await request(app).post('/sites/site/reviews/runs').send(reviewBody)).status).toBe(202);
    vi.mocked(reviewService.createAppReviewRun).mockResolvedValueOnce({
      preview,
      queued: false,
      run: null,
    });
    expect((await request(app).post('/sites/site/reviews/runs').send(reviewBody)).status).toBe(200);
    expect((await request(app).get('/sites/site/reviews/runs')).status).toBe(200);
    expect(
      (await request(app).get('/sites/site/reviews/runs?profileId=profile&store=app_store&limit=5'))
        .status,
    ).toBe(200);
    expect((await request(app).get('/sites/site/reviews/runs/run')).status).toBe(200);
    const comparison = await request(app).get('/sites/site/compare?profileId=profile');
    expect(comparison.status).toBe(200);
    expect(comparison.headers['content-language']).toBe('fr');

    expect(researchService.previewAppResearch).toHaveBeenCalledWith(
      expect.objectContaining({ surface: 'gap', appIds: ['fast.one.app', 'fast.two.app'] }),
      expect.anything(),
    );
    expect(reviewService.createAppReviewRun).toHaveBeenCalledWith(
      expect.objectContaining({ locale: 'fr' }),
    );
    expect(listingService.createAppListingRun).toHaveBeenCalledWith({
      accountId: 'controller-account',
      siteId: 'site',
      run: expect.objectContaining({ profileId: 'profile', confirm: true }),
    });
    expect(reviewService.listAppReviewRuns).toHaveBeenLastCalledWith({
      accountId: 'controller-account',
      siteId: 'site',
      profileId: 'profile',
      store: 'app_store',
      limit: 5,
    });
    expect(listingService.readLatestAppListing).toHaveBeenCalledWith(
      expect.objectContaining({ locale: 'fr' }),
      expect.anything(),
    );
    expect(compareService.readAppSeoComparison).toHaveBeenCalledWith(
      expect.objectContaining({ locale: 'fr' }),
      expect.anything(),
    );
  });
});

describe('App SEO edge schemas, queue holder, and review validators', () => {
  it('normalizes keyword phrases and validates both store identifier formats', () => {
    expect(mintAppKeywordBodySchema.parse({ phrase: '  MiXeD  ', store: 'app_store' }).phrase)
      .toBe('mixed');
    expect(appResearchGapBodySchema.safeParse({
      profileId: 'profile',
      store: 'google_play',
      appIds: ['fast.one.app', 'fast.two.app'],
    }).success).toBe(true);
    expect(appResearchGapBodySchema.safeParse({
      profileId: 'profile',
      store: 'app_store',
      appIds: ['123456789', '987654321'],
    }).success).toBe(true);
    expect(appResearchGapBodySchema.safeParse({
      profileId: 'profile',
      store: 'app_store',
      appIds: ['not-an-id', '987654321'],
    }).success).toBe(false);
  });

  it('reads and clears the dedicated tracking queue', () => {
    expect(getAppSeoTrackingQueue()).toBeNull();
    setAppSeoTrackingQueue(null);
    expect(getAppSeoTrackingQueue()).toBeNull();
  });

  it('executes every review transition and bounded embedded-array validator', () => {
    expect(canTransitionAppReviewRunStatus('queued', 'pulling')).toBe(true);
    expect(canTransitionAppReviewRunStatus('completed', 'queued')).toBe(false);

    const base = {
      accountId: '66b8b30b9f7a2b1785fa0001',
      siteId: '66b8b30b9f7a2b1785fa0002',
      profileId: '66b8b30b9f7a2b1785fa0003',
      store: 'google_play',
    };
    const histogram = Array.from({ length: 5 }, (_, index) => ({ star: index + 1, count: 0 }));
    const valid = new AppReviewRun({
      ...base,
      reviews: [],
      stats: { total: 0, histogram, ratingMix: { positive: 0, neutral: 0, negative: 0 }, volumeTrend: [] },
      clusters: [],
    });
    expect(valid.validateSync()).toBeUndefined();

    const invalidValues = [
      { stats: { total: 0, histogram: histogram.slice(0, 4), ratingMix: { positive: 0, neutral: 0, negative: 0 }, volumeTrend: [] } },
      { stats: { total: 0, histogram, ratingMix: { positive: 0, neutral: 0, negative: 0 }, volumeTrend: Array.from({ length: 25 }, (_, index) => ({ period: `2024-${String((index % 12) + 1).padStart(2, '0')}`, count: 1, averageRating: 4 })) } },
      { clusters: [{ label: 'thin', sentiment: 'mixed', citedReviewIds: ['review-001'], quotes: [{ reviewId: 'review-001', quote: 'one' }], observationMeta: { sourceKind: 'ai_interpretation', observedAt: '2026-08-01T00:00:00.000Z', freshness: 'fresh', sampleCount: 1 } }] },
      { clusters: [{ label: 'wide', sentiment: 'mixed', citedReviewIds: Array.from({ length: 9 }, (_, index) => `review-${String(index + 1).padStart(3, '0')}`), quotes: [{ reviewId: 'review-001', quote: 'one' }, { reviewId: 'review-002', quote: 'two' }], observationMeta: { sourceKind: 'ai_interpretation', observedAt: '2026-08-01T00:00:00.000Z', freshness: 'fresh', sampleCount: 9 } }] },
      { clusters: [{ label: 'wide-quotes', sentiment: 'mixed', citedReviewIds: ['review-001', 'review-002'], quotes: Array.from({ length: 9 }, (_, index) => ({ reviewId: `review-${String(index + 1).padStart(3, '0')}`, quote: `quote-${index}` })), observationMeta: { sourceKind: 'ai_interpretation', observedAt: '2026-08-01T00:00:00.000Z', freshness: 'fresh', sampleCount: 9 } }] },
      { reviews: Array.from({ length: APP_REVIEW_RUN_MAX_REVIEWS + 1 }, (_, index) => ({ id: `review-${String(index % 1_000).padStart(3, '0')}`, rating: 4, text: 'bounded' })) },
      { clusters: Array.from({ length: 13 }, (_, index) => ({ label: `cluster-${index}`, sentiment: 'mixed', citedReviewIds: ['review-001', 'review-002'], quotes: [{ reviewId: 'review-001', quote: 'one' }, { reviewId: 'review-002', quote: 'two' }], observationMeta: { sourceKind: 'ai_interpretation', observedAt: '2026-08-01T00:00:00.000Z', freshness: 'fresh', sampleCount: 2 } })) },
    ];
    for (const override of invalidValues) {
      expect(new AppReviewRun({ ...base, ...override }).validateSync()).toBeDefined();
    }
  });
});

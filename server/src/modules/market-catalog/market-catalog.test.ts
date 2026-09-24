import express from 'express';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  createFakeAppDataProvider,
  createFakeContentAnalysisProvider,
  createFakeKeywordProvider,
} from '../../shared/providers/fakes.js';
import { VendorUnavailableError } from '../../shared/providers/errors.js';
import { vendorResponses } from '../../db/schema/index.js';
import {
  getTestDb,
  startTestPostgres,
  stopTestPostgres,
  truncateAllTables,
} from '../../shared/testing/postgres.js';
import { getMarketCatalogDeps, setMarketCatalogDeps } from './market-catalog.holder.js';
import { marketCatalogRouter } from './market-catalog.routes.js';
import { marketCatalogSurfaceSchema } from './market-catalog.schemas.js';
import { getMarketCatalog, MARKET_CATALOG_TTL_MS } from './market-catalog.service.js';

const now = new Date('2026-08-11T12:00:00.000Z');

function makeDeps() {
  return {
    db: getTestDb() as never,
    keywordProvider: createFakeKeywordProvider(),
    contentAnalysisProvider: createFakeContentAnalysisProvider(),
    appDataProvider: createFakeAppDataProvider(),
    now: () => now,
  };
}

beforeAll(startTestPostgres);
afterAll(async () => {
  setMarketCatalogDeps(null);
  await stopTestPostgres();
});
beforeEach(async () => {
  setMarketCatalogDeps(null);
  await truncateAllTables();
});

describe('market catalog service', () => {
  it('normalizes, sorts, and caches SEO markets for 24 hours', async () => {
    const deps = makeDeps();
    const listMarkets = vi.fn().mockResolvedValue([
      { countryCode: 'US', locationCode: 2840, languageCodes: ['es', 'en', 'en'] },
      { countryCode: 'FR', locationCode: 2250, languageCodes: ['fr'] },
    ]);
    deps.keywordProvider.listMarkets = listMarkets;

    await expect(getMarketCatalog('seo', deps)).resolves.toEqual({
      surface: 'seo',
      markets: [
        { countryCode: 'FR', locationCode: 2250, languageCodes: ['fr'] },
        { countryCode: 'US', locationCode: 2840, languageCodes: ['en', 'es'] },
      ],
      fetchedAt: now.toISOString(),
      cached: false,
    });
    await expect(getMarketCatalog('seo', deps)).resolves.toMatchObject({ cached: true });
    expect(listMarkets).toHaveBeenCalledTimes(1);
    expect(MARKET_CATALOG_TTL_MS).toBe(86_400_000);
  });

  it('uses the system clock and location fallback when markets share a country', async () => {
    const { now: _now, ...deps } = makeDeps();
    deps.keywordProvider.listMarkets = vi.fn().mockResolvedValue([
      { countryCode: 'US', locationCode: 2840, languageCodes: ['en'] },
      { countryCode: 'US', locationCode: null, languageCodes: ['en'] },
      { countryCode: 'US', locationCode: 1, languageCodes: ['en'] },
    ]);

    const result = await getMarketCatalog('seo', deps);

    expect(result.markets.map((market) => market.locationCode)).toEqual([
      null,
      1,
      2840,
    ]);
    expect(Number.isNaN(Date.parse(result.fetchedAt))).toBe(false);
  });

  it('routes Brand Radar and both app stores to the matching provider operation', async () => {
    const deps = makeDeps();
    const content = vi.spyOn(deps.contentAnalysisProvider, 'listMarkets');
    const apps = vi.spyOn(deps.appDataProvider, 'listMarkets');

    await expect(getMarketCatalog('brand-radar', deps)).resolves.toMatchObject({
      surface: 'brand-radar',
    });
    await getMarketCatalog('app-google-play', deps);
    await getMarketCatalog('app-store', deps);
    expect(content).toHaveBeenCalledTimes(1);
    expect(apps).toHaveBeenNthCalledWith(1, 'google_play');
    expect(apps).toHaveBeenNthCalledWith(2, 'app_store');
  });

  it('archives every catalog read', async () => {
    const deps = makeDeps();
    for (const surface of ['seo', 'brand-radar', 'app-google-play', 'app-store'] as const) {
      await getMarketCatalog(surface, deps);
    }

    expect(await getTestDb().select().from(vendorResponses)).toHaveLength(4);
  });

  it('fails closed when a configured provider has no catalog operation', async () => {
    const deps = makeDeps();
    deps.keywordProvider.listMarkets = undefined;
    deps.contentAnalysisProvider.listMarkets = undefined;
    deps.appDataProvider.listMarkets = undefined;
    await expect(getMarketCatalog('seo', deps)).rejects.toBeInstanceOf(VendorUnavailableError);
    await expect(getMarketCatalog('brand-radar', deps)).rejects.toBeInstanceOf(
      VendorUnavailableError,
    );
    await expect(getMarketCatalog('app-store', deps)).rejects.toBeInstanceOf(
      VendorUnavailableError,
    );
  });
});

describe('market catalog route and holder', () => {
  it('serves a configured catalog and rejects an unknown surface schema', async () => {
    const deps = makeDeps();
    setMarketCatalogDeps(deps);
    expect(getMarketCatalogDeps()).toBe(deps);
    const app = express();
    app.use('/api/market-catalogs', marketCatalogRouter);
    const response = await request(app).get('/api/market-catalogs/seo').expect(200);
    expect(response.body).toMatchObject({ surface: 'seo', cached: false });
    expect(marketCatalogSurfaceSchema.safeParse('unknown').success).toBe(false);
  });

  it('requires boot-time dependency registration', () => {
    expect(() => getMarketCatalogDeps()).toThrow('market catalog not configured');
  });
});

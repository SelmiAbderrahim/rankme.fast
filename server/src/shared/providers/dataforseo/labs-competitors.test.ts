/**
 * DataForSEO Labs Competitors adapter tests (prompt 15).
 *
 * Two contracts + behaviour tests: normalization, limit clamping, gap
 * parameter mapping (intersections: false), null field guards, unknown-status
 * guards, empty-input rejection.
 */
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { http, HttpResponse, type JsonBodyType } from 'msw';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { providerContractTests } from '../../testing/fixtures/contract.js';
import { mockVendor, vendorMockServer } from '../../testing/fixtures/mock-vendor.js';
import { VendorMalformedError } from '../errors.js';
import { captureVendorCost, usdToMicros } from '../cost-capture.js';
import {
  DOMAIN_COMPARISON_LEG_COUNT,
  DOMAIN_COMPARISON_MAX_ROWS,
} from '../domain-comparison.js';
import { clearDataForSeoClientCache } from '../http.js';
import type { CompetitorProvider } from '../types.js';
import {
  COMPETITORS_DEFAULT_LIMIT,
  COMPETITORS_MAX_LIMIT,
  HISTORICAL_RANK_MAX_POINTS,
  INTERSECTION_DEFAULT_LIMIT,
  INTERSECTION_MAX_LIMIT,
  SERP_COMPETITORS_MAX_KEYWORDS,
  TRAFFIC_ESTIMATION_MAX_DOMAINS,
  TRAFFIC_ESTIMATION_TOP_COUNTRIES,
  clampCompetitorLimit,
  clampHistoricalRankLimit,
  clampIntersectionLimit,
  createDataForSeoCompetitorProvider,
  DOMAIN_INTERSECTION_ROW_COST_MICROS,
  DOMAIN_INTERSECTION_TASK_COST_MICROS,
  mapVendorTechCategory,
  normalizeCompetitorDomain,
  normalizeComparisonOrigin,
  normalizeRankingUrl,
  normalizeSerpKeywords,
  normalizeTechnologies,
  normalizeTrafficCountries,
  normalizeTrafficDomains,
  normalizeTrafficOutputDomain,
  stripWwwPrefix,
  type DataForSeoCompetitorProviderConfig,
} from './labs-competitors.js';

const FIXTURES_ROOT = join(
  dirname(fileURLToPath(import.meta.url)),
  '..',
  '..',
  'testing',
  'fixtures',
  'dataforseo-labs-competitors',
);

function readFixture(operation: string, kase: string): JsonBodyType {
  return JSON.parse(
    readFileSync(join(FIXTURES_ROOT, operation, `${kase}.json`), 'utf8'),
  ) as JsonBodyType;
}

const cfg: DataForSeoCompetitorProviderConfig = {
  login: 'sandbox-login',
  password: 'sandbox-password',
  baseUrl: 'https://dataforseo.mock/v3',
  timeoutMs: 60,
  maxRetries: 0,
  backoffBaseMs: 1,
  random: () => 0,
};

const provider = createDataForSeoCompetitorProvider(cfg);
const COMPARISON_TIME = new Date('2026-08-09T12:00:00.000Z');
const comparisonProvider = createDataForSeoCompetitorProvider({
  ...cfg,
  now: () => COMPARISON_TIME,
});
const comparisonInput = {
  ownedDomain: 'example.com',
  ownedOrigin: 'https://example.com/site-profile',
  competitorDomain: 'rival-one.example',
  competitorOrigin: 'https://rival-one.example/profile',
  locationCode: 2840,
  languageCode: 'en',
};

function comparisonFixtureForBody(body: Record<string, unknown>): string {
  if (body.intersections === true) return 'success';
  return body.target1 === comparisonInput.ownedDomain
    ? 'owned-only'
    : 'competitor-only';
}

function mockComparisonCase(
  kase: 'success' | 'timeout' | 'malformed' | 'quota',
): void {
  if (kase !== 'success') {
    mockVendor('dataforseo-labs-competitors', 'domain-comparison', kase);
    return;
  }
  vendorMockServer.use(
    http.post('https://dataforseo.mock/v3/*', async ({ request }) => {
      const tasks = (await request.json()) as Record<string, unknown>[];
      return HttpResponse.json(
        readFixture(
          'domain-comparison',
          comparisonFixtureForBody(tasks[0] ?? {}),
        ) as JsonBodyType,
      );
    }),
  );
}

// ---------------------------------------------------------------------------
// Provider contract — one per endpoint
// ---------------------------------------------------------------------------

providerContractTests({
  title: 'DataForSeoCompetitorProvider.getCompetitors',
  fixtureProvider: 'dataforseo-labs-competitors',
  fixtureOperation: 'competitors',
  makeCall: () => provider.getCompetitors('example.com', 2840, 'en', 10),
  assertSuccess: (result) => {
    expect(result).toHaveLength(2);
    const first = result[0];
    if (!first) throw new Error('expected first');
    expect(first.domain).toBe('rival-one.example');
    expect(first.avgPosition).toBeCloseTo(4.2);
    expect(first.intersections).toBe(118);
    expect(first.estimatedTraffic).toBe(20500);
  },
});

providerContractTests({
  title: 'DataForSeoCompetitorProvider.getSerpCompetitors',
  fixtureProvider: 'dataforseo-labs-competitors',
  fixtureOperation: 'serp-competitors',
  makeCall: () =>
    provider.getSerpCompetitors(
      ['uptime monitor', 'uptime monitor github', 'uptime kuma'],
      2840,
      'en',
      20,
    ),
  assertSuccess: (result) => {
    expect(result).toHaveLength(4);
    const first = result[0];
    if (!first) throw new Error('expected first');
    // `www.` stripped from the SERP-reported host.
    expect(first.domain).toBe('site24x7.com');
    expect(first.avgPosition).toBe(9);
    expect(first.intersections).toBe(1);
    expect(first.estimatedTraffic).toBeCloseTo(75.142);
    // Null vendor fields survive as null / zero (last fixture item).
    const last = result[3];
    if (!last) throw new Error('expected last');
    expect(last.domain).toBe('pingdom.com');
    expect(last.avgPosition).toBeNull();
    expect(last.intersections).toBe(0);
    expect(last.estimatedTraffic).toBeNull();
  },
});

providerContractTests({
  title: 'DataForSeoCompetitorProvider.getDomainIntersection',
  fixtureProvider: 'dataforseo-labs-competitors',
  fixtureOperation: 'domain-intersection',
  makeCall: () =>
    provider.getDomainIntersection('example.com', 'rival-one.example', {
      locationCode: 2840,
      languageCode: 'en',
      limit: 100,
    }),
  assertSuccess: (result) => {
    expect(result).toHaveLength(2);
    const first = result[0];
    if (!first) throw new Error('expected first');
    expect(first.keyword).toBe('seo audit tool');
    expect(first.target1Position).toBeNull();
    expect(first.target2Position).toBe(7);
    expect(first.searchVolume).toBe(5400);
  },
});

providerContractTests({
  title: 'DataForSeoCompetitorProvider.compareDomains',
  fixtureProvider: 'dataforseo-labs-competitors',
  fixtureOperation: 'domain-comparison',
  makeCall: () => comparisonProvider.compareDomains(comparisonInput),
  mockCase: mockComparisonCase,
  assertSuccess: (result) => {
    expect(result.shared.map((row) => row.normalizedKeyword)).toEqual([
      'brand query',
      'seo audit tool',
    ]);
    expect(result.shared[1]).toMatchObject({
      keyword: 'seo audit tool',
      ownedPosition: 2,
      competitorPosition: 3,
      ownedRankAbsolute: 2,
      competitorRankAbsolute: 4,
      ownedUrl: 'https://example.com/seo-audit',
      competitorUrl: 'https://rival-one.example/seo-audit',
      searchVolume: 5_400,
      keywordDifficulty: 68,
      intent: 'commercial',
      observationMeta: {
        sourceKind: 'provider_observation',
        sourceLabel: 'dataforseo',
        observedAt: COMPARISON_TIME.toISOString(),
        sampleCount: 1,
      },
    });
    expect(result.ownedOnly).toEqual([
      expect.objectContaining({
        normalizedKeyword: 'owned keyword',
        ownedPosition: 4,
        competitorPosition: null,
        ownedUrl: 'https://example.com/owned-keyword',
        competitorUrl: null,
      }),
    ]);
    expect(result.competitorOnly).toEqual([
      expect.objectContaining({
        normalizedKeyword: 'missing keyword',
        ownedPosition: null,
        competitorPosition: 2,
        ownedUrl: null,
        competitorUrl: 'https://rival-one.example/missing-keyword',
      }),
    ]);
  },
});

describe('DataForSeoCompetitorProvider.getDomainIntersection — empty', () => {
  beforeAll(() => vendorMockServer.listen({ onUnhandledRequest: 'error' }));
  afterEach(() => vendorMockServer.resetHandlers());
  afterAll(() => vendorMockServer.close());

  it('returns an empty array when the vendor reports no intersecting keywords (spec 13 §4.5)', async () => {
    vendorMockServer.use(
      http.post('https://dataforseo.mock/v3/*', () =>
        HttpResponse.json(
          readFixture('domain-intersection', 'empty-intersection') as JsonBodyType,
        ),
      ),
    );
    await expect(
      provider.getDomainIntersection('example.com', 'no-overlap.example', {
        locationCode: 2840,
        languageCode: 'en',
      }),
    ).resolves.toEqual([]);
  });
});

providerContractTests({
  title: 'DataForSeoCompetitorProvider.getTechnologies',
  fixtureProvider: 'dataforseo-labs-competitors',
  fixtureOperation: 'technologies',
  makeCall: () => provider.getTechnologies('example.com'),
  assertSuccess: (result) => {
    // group→category→name[] flattened + de-duped, GROUP key drives the bucket.
    expect(result).toContainEqual({ category: 'cms', name: 'WordPress' });
    expect(result).toContainEqual({ category: 'analytics', name: 'Google Analytics' });
    expect(result).toContainEqual({ category: 'analytics', name: 'Google Tag Manager' });
    expect(result).toContainEqual({ category: 'hosting', name: 'Cloudflare' });
    expect(result).toContainEqual({ category: 'ecommerce', name: 'WooCommerce' });
    // 'widgets' is an unrecognized group → normalizes to 'other'.
    expect(result).toContainEqual({ category: 'other', name: 'Intercom' });
    expect(result).toHaveLength(6);
  },
});

// ---------------------------------------------------------------------------
// Pure helpers
// ---------------------------------------------------------------------------

describe('normalizeCompetitorDomain', () => {
  it('strips scheme + trailing slashes + lowercases', () => {
    expect(normalizeCompetitorDomain('HTTPS://Rival.EXAMPLE/')).toBe('rival.example');
  });
});

describe('stripWwwPrefix', () => {
  it('strips a leading www. case-insensitively, once, at the start only', () => {
    expect(stripWwwPrefix('www.site24x7.com')).toBe('site24x7.com');
    expect(stripWwwPrefix('WWW.Example.com')).toBe('Example.com');
    expect(stripWwwPrefix('example.com')).toBe('example.com');
    // Interior "www." untouched — only the prefix is a presentation artifact.
    expect(stripWwwPrefix('sub.www.example.com')).toBe('sub.www.example.com');
  });
});

describe('normalizeSerpKeywords', () => {
  it('trims, drops empties, lowercases, de-dupes, and sorts', () => {
    expect(
      normalizeSerpKeywords(['  Uptime Monitor ', '', 'uptime kuma', 'uptime monitor', '   ']),
    ).toEqual(['uptime kuma', 'uptime monitor']);
  });

  it('caps the list at SERP_COMPETITORS_MAX_KEYWORDS', () => {
    const many = Array.from({ length: SERP_COMPETITORS_MAX_KEYWORDS + 25 }, (_, i) =>
      `keyword ${String(i).padStart(3, '0')}`,
    );
    expect(normalizeSerpKeywords(many)).toHaveLength(SERP_COMPETITORS_MAX_KEYWORDS);
  });
});

describe('clampCompetitorLimit', () => {
  it('honours the default for non-numeric / non-finite input', () => {
    expect(clampCompetitorLimit(undefined)).toBe(COMPETITORS_DEFAULT_LIMIT);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect(clampCompetitorLimit('x' as any)).toBe(COMPETITORS_DEFAULT_LIMIT);
    expect(clampCompetitorLimit(Number.NaN)).toBe(COMPETITORS_DEFAULT_LIMIT);
  });
  it('clamps at ceiling / floors at 1 / floors fractions', () => {
    expect(clampCompetitorLimit(9_999)).toBe(COMPETITORS_MAX_LIMIT);
    expect(clampCompetitorLimit(0)).toBe(1);
    expect(clampCompetitorLimit(-3)).toBe(1);
    expect(clampCompetitorLimit(9.9)).toBe(9);
  });
});

describe('clampIntersectionLimit', () => {
  it('honours the default for non-numeric / non-finite input', () => {
    expect(clampIntersectionLimit(undefined)).toBe(INTERSECTION_DEFAULT_LIMIT);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect(clampIntersectionLimit('x' as any)).toBe(INTERSECTION_DEFAULT_LIMIT);
  });
  it('clamps and floors as expected', () => {
    expect(clampIntersectionLimit(9_999)).toBe(INTERSECTION_MAX_LIMIT);
    expect(clampIntersectionLimit(0)).toBe(1);
    expect(clampIntersectionLimit(5.4)).toBe(5);
  });
});

describe('limit ceilings — vendor spend bound', () => {
  it('caps both list limits at 100 items', () => {
    // Labs bills $0.012/task + $0.00012/item — the 100-item ceilings bound
    // the per-call vendor spend.
    expect(COMPETITORS_MAX_LIMIT).toBe(100);
    expect(INTERSECTION_MAX_LIMIT).toBe(100);
  });
});

describe('domain-comparison URL normalization', () => {
  it('canonicalizes safe absolute URLs and strips fragments/default ports', () => {
    expect(
      normalizeRankingUrl(
        'HTTPS://Blog.Example.com:443/path?q=1#fragment',
        null,
        'example.com',
        'https://example.com',
      ),
    ).toBe('https://blog.example.com/path?q=1');
  });

  it('falls back to a safe relative path, but never to a homepage', () => {
    expect(
      normalizeRankingUrl(
        'https://attacker.invalid/path',
        '/observed-path',
        'example.com',
        'https://example.com',
      ),
    ).toBe('https://example.com/observed-path');
    expect(
      normalizeRankingUrl(null, null, 'example.com', 'https://example.com'),
    ).toBeNull();
    expect(
      normalizeRankingUrl(null, '//attacker.invalid', 'example.com', 'https://example.com'),
    ).toBeNull();
    expect(
      normalizeRankingUrl(
        'https://user:pass@example.com/path',
        null,
        'example.com',
        'https://example.com',
      ),
    ).toBeNull();
  });

  it('rejects empty, oversized, malformed, and unresolvable ranking URLs', () => {
    expect(normalizeRankingUrl('', null, 'example.com', 'https://example.com')).toBeNull();
    expect(
      normalizeRankingUrl('x'.repeat(2_049), null, 'example.com', 'https://example.com'),
    ).toBeNull();
    expect(normalizeRankingUrl('not a URL', null, 'example.com', 'https://example.com')).toBeNull();
    expect(
      normalizeRankingUrl(
        `https://example.com/${'é'.repeat(1_000)}`,
        null,
        'example.com',
        'https://example.com',
      ),
    ).toBeNull();
    expect(normalizeRankingUrl(null, '/path', 'example.com', 'not an origin')).toBeNull();
  });

  it('validates frozen origins against their canonical target', () => {
    expect(normalizeComparisonOrigin('HTTPS://WWW.Example.com:443/path', 'example.com')).toBe(
      'https://www.example.com',
    );
    expect(() =>
      normalizeComparisonOrigin('https://attacker.invalid', 'example.com'),
    ).toThrow(VendorMalformedError);
  });
});

describe('DataForSeoCompetitorProvider — compareDomains normalization', () => {
  beforeAll(() => vendorMockServer.listen({ onUnhandledRequest: 'error' }));
  afterEach(() => vendorMockServer.resetHandlers());
  afterAll(() => vendorMockServer.close());

  it('sends exactly the shared, owned-only, and swapped competitor-only organic requests', async () => {
    const bodies: Record<string, unknown>[] = [];
    vendorMockServer.use(
      http.post('https://dataforseo.mock/v3/*', async ({ request }) => {
        const tasks = (await request.json()) as Record<string, unknown>[];
        const body = tasks[0] ?? {};
        bodies.push(body);
        return HttpResponse.json(
          readFixture(
            'domain-comparison',
            comparisonFixtureForBody(body),
          ) as JsonBodyType,
        );
      }),
    );

    await comparisonProvider.compareDomains({
      ...comparisonInput,
      ownedDomain: 'WWW.EXAMPLE.COM',
      competitorDomain: 'RIVAL-ONE.EXAMPLE',
      languageCode: 'EN',
    });

    expect(bodies).toEqual([
      {
        target1: 'example.com',
        target2: 'rival-one.example',
        location_code: 2840,
        language_code: 'en',
        intersections: true,
        item_types: ['organic'],
        limit: DOMAIN_COMPARISON_MAX_ROWS,
      },
      {
        target1: 'example.com',
        target2: 'rival-one.example',
        location_code: 2840,
        language_code: 'en',
        intersections: false,
        item_types: ['organic'],
        limit: DOMAIN_COMPARISON_MAX_ROWS,
      },
      {
        target1: 'rival-one.example',
        target2: 'example.com',
        location_code: 2840,
        language_code: 'en',
        intersections: false,
        item_types: ['organic'],
        limit: DOMAIN_COMPARISON_MAX_ROWS,
      },
    ]);
    expect(bodies).toHaveLength(DOMAIN_COMPARISON_LEG_COUNT);
  });

  it('aggregates vendor-reported envelope cost across all three legs', async () => {
    mockComparisonCase('success');
    const captured = await captureVendorCost(() =>
      comparisonProvider.compareDomains(comparisonInput),
    );
    expect(captured.costMicros).toBe(72_000n);
    expect(captured.costMicros).toBe(
      BigInt(DOMAIN_COMPARISON_LEG_COUNT) *
        (DOMAIN_INTERSECTION_TASK_COST_MICROS +
          BigInt(DOMAIN_COMPARISON_MAX_ROWS) * DOMAIN_INTERSECTION_ROW_COST_MICROS),
    );
  });

  it('uses the system clock when a comparison clock is not injected', async () => {
    mockComparisonCase('success');
    const result = await createDataForSeoCompetitorProvider(cfg).compareDomains(comparisonInput);
    expect(Date.parse(result.shared[0]?.observationMeta.observedAt ?? '')).not.toBeNaN();
  });

  it.each(['empty', 'partial', 'null-url'] as const)(
    'normalizes the recorded %s response without manufacturing data',
    async (fixtureCase) => {
      vendorMockServer.use(
        http.post('https://dataforseo.mock/v3/*', () =>
          HttpResponse.json(
            readFixture('domain-comparison', fixtureCase) as JsonBodyType,
          ),
        ),
      );
      const result = await comparisonProvider.compareDomains(comparisonInput);
      if (fixtureCase === 'empty') {
        expect(result).toEqual({ shared: [], ownedOnly: [], competitorOnly: [] });
        return;
      }
      expect(result.shared).toHaveLength(1);
      if (fixtureCase === 'partial') {
        expect(result.shared[0]).toMatchObject({
          ownedPosition: null,
          competitorPosition: 9,
          searchVolume: null,
          keywordDifficulty: null,
          intent: null,
        });
      } else {
        expect(result.shared[0]).toMatchObject({
          ownedUrl: null,
          competitorUrl: null,
        });
      }
    },
  );

  it('hard-caps every returned class even if the vendor over-returns', async () => {
    const items = Array.from({ length: DOMAIN_COMPARISON_MAX_ROWS + 7 }, (_, index) => ({
      keyword_data: { keyword: `keyword ${String(index).padStart(3, '0')}` },
      first_domain_serp_element: { type: 'organic', rank_group: index + 1 },
      second_domain_serp_element: { type: 'organic', rank_group: index + 2 },
    }));
    vendorMockServer.use(
      http.post('https://dataforseo.mock/v3/*', () =>
        HttpResponse.json({
          status_code: 20000,
          status_message: 'Ok.',
          cost: 0.024,
          tasks_count: 1,
          tasks_error: 0,
          tasks: [
            {
              id: 'TASK_ID',
              status_code: 20000,
              status_message: 'Ok.',
              cost: 0.024,
              result: [{ items }],
            },
          ],
        }),
      ),
    );
    const result = await comparisonProvider.compareDomains(comparisonInput);
    expect(result.shared).toHaveLength(DOMAIN_COMPARISON_MAX_ROWS);
    expect(result.ownedOnly).toHaveLength(DOMAIN_COMPARISON_MAX_ROWS);
    expect(result.competitorOnly).toHaveLength(DOMAIN_COMPARISON_MAX_ROWS);
  });

  it('rejects unexpected SERP item types through the shared malformed taxonomy', async () => {
    vendorMockServer.use(
      http.post('https://dataforseo.mock/v3/*', () =>
        HttpResponse.json({
          status_code: 20000,
          status_message: 'Ok.',
          tasks_count: 1,
          tasks_error: 0,
          tasks: [
            {
              id: 'TASK_ID',
              status_code: 20000,
              status_message: 'Ok.',
              result: [
                {
                  items: [
                    {
                      keyword_data: { keyword: 'paid row' },
                      first_domain_serp_element: { type: 'paid', rank_group: 1 },
                    },
                  ],
                },
              ],
            },
          ],
        }),
      ),
    );
    await expect(
      comparisonProvider.compareDomains(comparisonInput),
    ).rejects.toBeInstanceOf(VendorMalformedError);
  });

  it('rejects malformed targets, origins, markets, and identical domains before HTTP', async () => {
    await expect(
      comparisonProvider.compareDomains({ ...comparisonInput, ownedDomain: 'example.com/path' }),
    ).rejects.toBeInstanceOf(VendorMalformedError);
    await expect(
      comparisonProvider.compareDomains({
        ...comparisonInput,
        competitorOrigin: 'https://attacker.invalid',
      }),
    ).rejects.toBeInstanceOf(VendorMalformedError);
    await expect(
      comparisonProvider.compareDomains({ ...comparisonInput, locationCode: 0 }),
    ).rejects.toBeInstanceOf(VendorMalformedError);
    await expect(
      comparisonProvider.compareDomains({ ...comparisonInput, languageCode: 'english' }),
    ).rejects.toBeInstanceOf(VendorMalformedError);
    await expect(
      comparisonProvider.compareDomains({
        ...comparisonInput,
        competitorDomain: 'example.com',
        competitorOrigin: 'https://example.com',
      }),
    ).rejects.toBeInstanceOf(VendorMalformedError);
  });
});

// ---------------------------------------------------------------------------
// getCompetitors — end-to-end
// ---------------------------------------------------------------------------

describe('DataForSeoCompetitorProvider — getCompetitors', () => {
  beforeAll(() => vendorMockServer.listen({ onUnhandledRequest: 'error' }));
  afterEach(() => vendorMockServer.resetHandlers());
  afterAll(() => vendorMockServer.close());

  it('rejects empty target', async () => {
    await expect(
      provider.getCompetitors('   ', 2840, 'en', 10),
    ).rejects.toBeInstanceOf(VendorMalformedError);
  });

  it('sends location/language + clamped limit + exclude_top_domains', async () => {
    let capturedPath = '';
    let capturedBody: unknown = null;
    vendorMockServer.use(
      http.post('https://dataforseo.mock/v3/*', async ({ request }) => {
        capturedPath = new URL(request.url).pathname;
        capturedBody = await request.json();
        return HttpResponse.json(readFixture('competitors', 'success') as JsonBodyType);
      }),
    );
    await provider.getCompetitors('EXAMPLE.com', 2840, 'EN', 999_999);
    expect(capturedPath).toBe(
      '/v3/dataforseo_labs/google/competitors_domain/live',
    );
    expect(capturedBody).toEqual([
      expect.objectContaining({
        target: 'example.com',
        location_code: 2840,
        language_code: 'en',
        limit: COMPETITORS_MAX_LIMIT,
        exclude_top_domains: true,
      }),
    ]);
  });

  it('maps null vendor fields to nulls / zero', async () => {
    vendorMockServer.use(
      http.post('https://dataforseo.mock/v3/*', () =>
        HttpResponse.json({
          version: '0.1.20260101',
          status_code: 20000,
          status_message: 'Ok.',
          tasks_count: 1,
          tasks_error: 0,
          tasks: [
            {
              id: 'TASK_ID',
              status_code: 20000,
              status_message: 'Ok.',
              cost: 0.01,
              result: [
                {
                  items: [
                    {
                      domain: 'weird.example',
                      avg_position: null,
                      intersections: null,
                      metrics: { organic: null },
                    },
                  ],
                },
              ],
            },
          ],
        }),
      ),
    );
    const rows = await provider.getCompetitors('example.com', 2840, 'en', 10);
    expect(rows).toEqual([
      {
        domain: 'weird.example',
        avgPosition: null,
        intersections: 0,
        estimatedTraffic: null,
      },
    ]);
  });

  it('handles missing metrics block gracefully', async () => {
    vendorMockServer.use(
      http.post('https://dataforseo.mock/v3/*', () =>
        HttpResponse.json({
          version: '0.1.20260101',
          status_code: 20000,
          status_message: 'Ok.',
          tasks_count: 1,
          tasks_error: 0,
          tasks: [
            {
              id: 'TASK_ID',
              status_code: 20000,
              status_message: 'Ok.',
              cost: 0.01,
              result: [{ items: [{ domain: 'x.example' }] }],
            },
          ],
        }),
      ),
    );
    const rows = await provider.getCompetitors('example.com', 2840, 'en', 10);
    expect(rows[0]?.estimatedTraffic).toBeNull();
    expect(rows[0]?.intersections).toBe(0);
  });

  it('returns [] on null items', async () => {
    vendorMockServer.use(
      http.post('https://dataforseo.mock/v3/*', () =>
        HttpResponse.json({
          version: '0.1.20260101',
          status_code: 20000,
          status_message: 'Ok.',
          tasks_count: 1,
          tasks_error: 0,
          tasks: [
            {
              id: 'TASK_ID',
              status_code: 20000,
              status_message: 'Ok.',
              cost: 0.01,
              result: [{ items: null }],
            },
          ],
        }),
      ),
    );
    await expect(provider.getCompetitors('example.com', 2840, 'en', 10)).resolves.toEqual([]);
  });

  it('treats unknown task status as malformed', async () => {
    vendorMockServer.use(
      http.post('https://dataforseo.mock/v3/*', () =>
        HttpResponse.json({
          version: '0.1.20260101',
          status_code: 20000,
          status_message: 'Ok.',
          tasks_count: 1,
          tasks_error: 0,
          tasks: [
            {
              id: 'TASK_ID',
              status_code: 40602,
              status_message: 'Task In Queue.',
              cost: 0,
              result: null,
            },
          ],
        }),
      ),
    );
    await expect(
      provider.getCompetitors('example.com', 2840, 'en', 10),
    ).rejects.toBeInstanceOf(VendorMalformedError);
  });
});

// ---------------------------------------------------------------------------
// getSerpCompetitors — end-to-end
// ---------------------------------------------------------------------------

describe('DataForSeoCompetitorProvider — getSerpCompetitors', () => {
  beforeAll(() => vendorMockServer.listen({ onUnhandledRequest: 'error' }));
  afterEach(() => vendorMockServer.resetHandlers());
  afterAll(() => vendorMockServer.close());

  it('rejects an empty / whitespace-only keyword list', async () => {
    await expect(
      provider.getSerpCompetitors([], 2840, 'en', 20),
    ).rejects.toBeInstanceOf(VendorMalformedError);
    await expect(
      provider.getSerpCompetitors(['   ', ''], 2840, 'en', 20),
    ).rejects.toBeInstanceOf(VendorMalformedError);
  });

  it('sends canonical keywords, organic-only item_types, lowercased language, clamped limit', async () => {
    let capturedPath = '';
    let capturedBody: unknown = null;
    vendorMockServer.use(
      http.post('https://dataforseo.mock/v3/*', async ({ request }) => {
        capturedPath = new URL(request.url).pathname;
        capturedBody = await request.json();
        return HttpResponse.json(readFixture('serp-competitors', 'success') as JsonBodyType);
      }),
    );
    await provider.getSerpCompetitors(
      ['  Uptime Monitor ', 'uptime kuma', 'uptime monitor'],
      2840,
      'EN',
      999_999,
    );
    expect(capturedPath).toBe('/v3/dataforseo_labs/google/serp_competitors/live');
    expect(capturedBody).toEqual([
      expect.objectContaining({
        // trimmed, de-duped, sorted — the canonical set, matching the cache key.
        keywords: ['uptime kuma', 'uptime monitor'],
        location_code: 2840,
        language_code: 'en',
        limit: COMPETITORS_MAX_LIMIT,
        item_types: ['organic'],
      }),
    ]);
  });

  it('de-dupes www/bare variants of the same host, keeping the first (strongest) entry', async () => {
    vendorMockServer.use(
      http.post('https://dataforseo.mock/v3/*', () =>
        HttpResponse.json({
          version: '0.1.20260101',
          status_code: 20000,
          status_message: 'Ok.',
          tasks_count: 1,
          tasks_error: 0,
          tasks: [
            {
              id: 'TASK_ID',
              status_code: 20000,
              status_message: 'Ok.',
              cost: 0.0144,
              result: [
                {
                  items: [
                    { domain: 'www.rival.example', avg_position: 2, keywords_count: 3, etv: 90 },
                    { domain: 'rival.example', avg_position: 8, keywords_count: 1, etv: 10 },
                    { domain: 'other.example', avg_position: 5, keywords_count: 2, etv: 40 },
                  ],
                },
              ],
            },
          ],
        }),
      ),
    );
    const rows = await provider.getSerpCompetitors(['uptime monitor'], 2840, 'en', 20);
    expect(rows).toEqual([
      { domain: 'rival.example', avgPosition: 2, intersections: 3, estimatedTraffic: 90 },
      { domain: 'other.example', avgPosition: 5, intersections: 2, estimatedTraffic: 40 },
    ]);
  });

  it('returns [] on null items', async () => {
    vendorMockServer.use(
      http.post('https://dataforseo.mock/v3/*', () =>
        HttpResponse.json({
          version: '0.1.20260101',
          status_code: 20000,
          status_message: 'Ok.',
          tasks_count: 1,
          tasks_error: 0,
          tasks: [
            {
              id: 'TASK_ID',
              status_code: 20000,
              status_message: 'Ok.',
              cost: 0.012,
              result: [{ items: null }],
            },
          ],
        }),
      ),
    );
    await expect(
      provider.getSerpCompetitors(['uptime monitor'], 2840, 'en', 20),
    ).resolves.toEqual([]);
  });

  it('treats unknown task status as malformed', async () => {
    vendorMockServer.use(
      http.post('https://dataforseo.mock/v3/*', () =>
        HttpResponse.json({
          version: '0.1.20260101',
          status_code: 20000,
          status_message: 'Ok.',
          tasks_count: 1,
          tasks_error: 0,
          tasks: [
            {
              id: 'TASK_ID',
              status_code: 40602,
              status_message: 'Task In Queue.',
              cost: 0,
              result: null,
            },
          ],
        }),
      ),
    );
    await expect(
      provider.getSerpCompetitors(['uptime monitor'], 2840, 'en', 20),
    ).rejects.toBeInstanceOf(VendorMalformedError);
  });
});

// ---------------------------------------------------------------------------
// getDomainIntersection — end-to-end
// ---------------------------------------------------------------------------

describe('DataForSeoCompetitorProvider — getDomainIntersection', () => {
  beforeAll(() => vendorMockServer.listen({ onUnhandledRequest: 'error' }));
  afterEach(() => vendorMockServer.resetHandlers());
  afterAll(() => vendorMockServer.close());

  it('rejects empty targets', async () => {
    await expect(
      provider.getDomainIntersection('  ', 'rival.example', {
        locationCode: 2840,
        languageCode: 'en',
      }),
    ).rejects.toBeInstanceOf(VendorMalformedError);
    await expect(
      provider.getDomainIntersection('example.com', '', {
        locationCode: 2840,
        languageCode: 'en',
      }),
    ).rejects.toBeInstanceOf(VendorMalformedError);
  });

  it('swaps targets for competitor-only semantics and pins organic items', async () => {
    let capturedBody: unknown = null;
    vendorMockServer.use(
      http.post('https://dataforseo.mock/v3/*', async ({ request }) => {
        capturedBody = await request.json();
        return HttpResponse.json(readFixture('domain-intersection', 'success') as JsonBodyType);
      }),
    );
    await provider.getDomainIntersection('EXAMPLE.com', 'RIVAL.example', {
      locationCode: 2840,
      languageCode: 'EN',
      limit: 999_999,
    });
    expect(capturedBody).toEqual([
      expect.objectContaining({
        target1: 'rival.example',
        target2: 'example.com',
        location_code: 2840,
        language_code: 'en',
        intersections: false,
        item_types: ['organic'],
        limit: INTERSECTION_MAX_LIMIT,
      }),
    ]);
  });

  it('honours the default intersection limit when unset', async () => {
    let capturedBody: Record<string, unknown> = {};
    vendorMockServer.use(
      http.post('https://dataforseo.mock/v3/*', async ({ request }) => {
        const arr = (await request.json()) as Record<string, unknown>[];
        capturedBody = arr[0] ?? {};
        return HttpResponse.json(readFixture('domain-intersection', 'success') as JsonBodyType);
      }),
    );
    await provider.getDomainIntersection('example.com', 'rival.example', {
      locationCode: 2840,
      languageCode: 'en',
    });
    expect(capturedBody.limit).toBe(INTERSECTION_DEFAULT_LIMIT);
  });

  it('maps missing/null serp elements + keyword_info', async () => {
    vendorMockServer.use(
      http.post('https://dataforseo.mock/v3/*', () =>
        HttpResponse.json({
          version: '0.1.20260101',
          status_code: 20000,
          status_message: 'Ok.',
          tasks_count: 1,
          tasks_error: 0,
          tasks: [
            {
              id: 'TASK_ID',
              status_code: 20000,
              status_message: 'Ok.',
              cost: 0.01,
              result: [
                {
                  items: [
                    {
                      keyword_data: { keyword: 'orphan kw' },
                    },
                  ],
                },
              ],
            },
          ],
        }),
      ),
    );
    const rows = await provider.getDomainIntersection('example.com', 'rival.example', {
      locationCode: 2840,
      languageCode: 'en',
    });
    expect(rows).toEqual([
      {
        keyword: 'orphan kw',
        target1Position: null,
        target2Position: null,
        searchVolume: null,
      },
    ]);
  });

  it('returns [] on null items', async () => {
    vendorMockServer.use(
      http.post('https://dataforseo.mock/v3/*', () =>
        HttpResponse.json({
          version: '0.1.20260101',
          status_code: 20000,
          status_message: 'Ok.',
          tasks_count: 1,
          tasks_error: 0,
          tasks: [
            {
              id: 'TASK_ID',
              status_code: 20000,
              status_message: 'Ok.',
              cost: 0.01,
              result: [{ items: null }],
            },
          ],
        }),
      ),
    );
    await expect(
      provider.getDomainIntersection('example.com', 'rival.example', {
        locationCode: 2840,
        languageCode: 'en',
      }),
    ).resolves.toEqual([]);
  });

  it('treats unknown task status as malformed', async () => {
    vendorMockServer.use(
      http.post('https://dataforseo.mock/v3/*', () =>
        HttpResponse.json({
          version: '0.1.20260101',
          status_code: 20000,
          status_message: 'Ok.',
          tasks_count: 1,
          tasks_error: 0,
          tasks: [
            {
              id: 'TASK_ID',
              status_code: 40602,
              status_message: 'Task In Queue.',
              cost: 0,
              result: null,
            },
          ],
        }),
      ),
    );
    await expect(
      provider.getDomainIntersection('example.com', 'rival.example', {
        locationCode: 2840,
        languageCode: 'en',
      }),
    ).rejects.toBeInstanceOf(VendorMalformedError);
  });
});

// ---------------------------------------------------------------------------
// Tech-stack normalization — pure helpers
// ---------------------------------------------------------------------------

describe('mapVendorTechCategory', () => {
  it('maps known groups and folds the rest to other', () => {
    expect(mapVendorTechCategory('cms')).toBe('cms');
    expect(mapVendorTechCategory('Analytics')).toBe('analytics');
    expect(mapVendorTechCategory('tag_managers')).toBe('analytics');
    expect(mapVendorTechCategory('ecommerce')).toBe('ecommerce');
    expect(mapVendorTechCategory('cdn')).toBe('hosting');
    expect(mapVendorTechCategory('web_servers')).toBe('hosting');
    // Unrecognized vendor group → other, never dropped.
    expect(mapVendorTechCategory('programming_languages')).toBe('other');
  });
});

describe('normalizeTechnologies', () => {
  it('returns [] for absent / null technologies', () => {
    expect(normalizeTechnologies(undefined)).toEqual([]);
    expect(normalizeTechnologies(null)).toEqual([]);
    expect(normalizeTechnologies({})).toEqual([]);
  });

  it('flattens group→category→name[] and de-dupes by (category, name)', () => {
    const entries = normalizeTechnologies({
      cms: { cms: ['WordPress'], blogs: ['WordPress'] }, // dup name, same bucket
      analytics: { analytics: ['Google Analytics'] },
    });
    expect(entries).toEqual([
      { category: 'cms', name: 'WordPress' },
      { category: 'analytics', name: 'Google Analytics' },
    ]);
  });

  it('folds an unrecognized group to the other bucket', () => {
    expect(normalizeTechnologies({ widgets: { widgets: ['Intercom'] } })).toEqual([
      { category: 'other', name: 'Intercom' },
    ]);
  });
});

// ---------------------------------------------------------------------------
// getTechnologies — end-to-end
// ---------------------------------------------------------------------------

describe('DataForSeoCompetitorProvider — getTechnologies', () => {
  beforeAll(() => vendorMockServer.listen({ onUnhandledRequest: 'error' }));
  afterEach(() => vendorMockServer.resetHandlers());
  afterAll(() => vendorMockServer.close());

  it('rejects empty target', async () => {
    await expect(provider.getTechnologies('   ')).rejects.toBeInstanceOf(
      VendorMalformedError,
    );
  });

  it('normalizes the target and POSTs to the domain_technologies endpoint', async () => {
    let capturedPath = '';
    let capturedBody: unknown = null;
    vendorMockServer.use(
      http.post('https://dataforseo.mock/v3/*', async ({ request }) => {
        capturedPath = new URL(request.url).pathname;
        capturedBody = await request.json();
        return HttpResponse.json(readFixture('technologies', 'success') as JsonBodyType);
      }),
    );
    await provider.getTechnologies('HTTPS://Example.com/');
    expect(capturedPath).toBe(
      '/v3/domain_analytics/technologies/domain_technologies/live',
    );
    expect(capturedBody).toEqual([{ target: 'example.com' }]);
  });

  it('maps an unrecognized vendor category to other (fixture)', async () => {
    vendorMockServer.use(
      http.post('https://dataforseo.mock/v3/*', () =>
        HttpResponse.json(
          readFixture('technologies', 'unrecognized-category') as JsonBodyType,
        ),
      ),
    );
    await expect(provider.getTechnologies('example.com')).resolves.toEqual([
      { category: 'other', name: 'PHP' },
    ]);
  });

  it('returns [] when the vendor reports no technologies', async () => {
    vendorMockServer.use(
      http.post('https://dataforseo.mock/v3/*', () =>
        HttpResponse.json({
          version: '0.1.20260101',
          status_code: 20000,
          status_message: 'Ok.',
          tasks_count: 1,
          tasks_error: 0,
          tasks: [
            {
              id: 'TASK_ID',
              status_code: 20000,
              status_message: 'Ok.',
              cost: 0.0132,
              result: [{ domain: 'example.com', technologies: {} }],
            },
          ],
        }),
      ),
    );
    await expect(provider.getTechnologies('example.com')).resolves.toEqual([]);
  });

  it('returns [] when the result item has null technologies', async () => {
    vendorMockServer.use(
      http.post('https://dataforseo.mock/v3/*', () =>
        HttpResponse.json({
          version: '0.1.20260101',
          status_code: 20000,
          status_message: 'Ok.',
          tasks_count: 1,
          tasks_error: 0,
          tasks: [
            {
              id: 'TASK_ID',
              status_code: 20000,
              status_message: 'Ok.',
              cost: 0.0132,
              result: [{ domain: 'example.com', technologies: null }],
            },
          ],
        }),
      ),
    );
    await expect(provider.getTechnologies('example.com')).resolves.toEqual([]);
  });

  it('treats unknown task status as malformed', async () => {
    vendorMockServer.use(
      http.post('https://dataforseo.mock/v3/*', () =>
        HttpResponse.json({
          version: '0.1.20260101',
          status_code: 20000,
          status_message: 'Ok.',
          tasks_count: 1,
          tasks_error: 0,
          tasks: [
            {
              id: 'TASK_ID',
              status_code: 40602,
              status_message: 'Task In Queue.',
              cost: 0,
              result: null,
            },
          ],
        }),
      ),
    );
    await expect(provider.getTechnologies('example.com')).rejects.toBeInstanceOf(
      VendorMalformedError,
    );
  });
});

// ---------------------------------------------------------------------------
// Traffic ops — provider contract (spec 01b — child 01b-3)
// ---------------------------------------------------------------------------

providerContractTests({
  title: 'DataForSeoCompetitorProvider.getTrafficEstimation',
  fixtureProvider: 'dataforseo-labs-competitors',
  fixtureOperation: 'bulk-traffic-estimation',
  makeCall: () =>
    provider.getTrafficEstimation(
      ['example.com', 'rival-one.example', 'niche-three.example'],
      { locationCode: 2840, languageCode: 'en' },
    ),
  assertSuccess: (result) => {
    expect(result).toHaveLength(3);
    const first = result[0];
    if (!first) throw new Error('expected first');
    expect(first.domain).toBe('example.com');
    expect(first.monthlyOrganicVisits).toBe(12_400);
    expect(first.topCountries).toEqual([
      { countryCode: 'US', visits: 8_200 },
      { countryCode: 'DE', visits: 2_100 },
      { countryCode: 'FR', visits: 900 },
    ]);
    const last = result[2];
    if (!last) throw new Error('expected last');
    expect(last.monthlyOrganicVisits).toBe(0);
    expect(last.topCountries).toEqual([]);
  },
});

providerContractTests({
  title: 'DataForSeoCompetitorProvider.getDomainRankOverview',
  fixtureProvider: 'dataforseo-labs-competitors',
  fixtureOperation: 'domain-rank-overview',
  makeCall: () =>
    provider.getDomainRankOverview('example.com', {
      locationCode: 2840,
      languageCode: 'en',
    }),
  assertSuccess: (result) => {
    expect(result).toEqual({
      domain: 'example.com',
      rank: 64,
      keywordsCount: 1_820,
      estimatedMonthlyOrganicVisits: 12_400,
    });
  },
});

providerContractTests({
  title: 'DataForSeoCompetitorProvider.getHistoricalRankOverview',
  fixtureProvider: 'dataforseo-labs-competitors',
  fixtureOperation: 'historical-rank-overview',
  makeCall: () =>
    provider.getHistoricalRankOverview('example.com', {
      locationCode: 2840,
      languageCode: 'en',
      limit: 24,
    }),
  assertSuccess: (result) => {
    expect(result.domain).toBe('example.com');
    expect(result.points).toHaveLength(3);
    const last = result.points[2];
    if (!last) throw new Error('expected last');
    expect(last).toEqual({
      year: 2024,
      month: 12,
      rank: 64,
      organicKeywords: 1_820,
      organicEtv: 12_400,
    });
  },
});

// ---------------------------------------------------------------------------
// Pure helpers — traffic ops
// ---------------------------------------------------------------------------

describe('normalizeTrafficOutputDomain', () => {
  it('strips scheme + `www.` + trailing slash + lowercases', () => {
    expect(normalizeTrafficOutputDomain('HTTPS://WWW.Example.COM/')).toBe('example.com');
    expect(normalizeTrafficOutputDomain('  Sub.Example.co ')).toBe('sub.example.co');
    expect(normalizeTrafficOutputDomain('')).toBe('');
  });
});

describe('normalizeTrafficDomains', () => {
  it('dedupes (case-insensitive), drops empties, caps at TRAFFIC_ESTIMATION_MAX_DOMAINS', () => {
    expect(
      normalizeTrafficDomains([
        'Example.com',
        'https://example.com/',
        '  ',
        'rival-one.example',
      ]),
    ).toEqual(['example.com', 'rival-one.example']);

    const many = Array.from({ length: TRAFFIC_ESTIMATION_MAX_DOMAINS + 10 }, (_, i) =>
      `domain-${String(i).padStart(3, '0')}.example`,
    );
    expect(normalizeTrafficDomains(many)).toHaveLength(TRAFFIC_ESTIMATION_MAX_DOMAINS);
  });
  it('drops non-string entries silently', () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect(normalizeTrafficDomains(['ok.example', 42 as any, null as any])).toEqual([
      'ok.example',
    ]);
  });
});

describe('clampHistoricalRankLimit', () => {
  it('clamps into [1, HISTORICAL_RANK_MAX_POINTS] with sensible defaults', () => {
    expect(clampHistoricalRankLimit(undefined)).toBe(HISTORICAL_RANK_MAX_POINTS);
    expect(clampHistoricalRankLimit(Number.NaN)).toBe(HISTORICAL_RANK_MAX_POINTS);
    expect(clampHistoricalRankLimit(0)).toBe(1);
    expect(clampHistoricalRankLimit(999)).toBe(HISTORICAL_RANK_MAX_POINTS);
    expect(clampHistoricalRankLimit(4.9)).toBe(4);
  });
});

describe('normalizeTrafficCountries', () => {
  it('sorts descending by visits and clips to TRAFFIC_ESTIMATION_TOP_COUNTRIES', () => {
    const distribution: Record<string, { etv?: number | null }> = {};
    for (let i = 0; i < TRAFFIC_ESTIMATION_TOP_COUNTRIES + 4; i += 1) {
      distribution[`c${String(i).padStart(2, '0')}`] = { etv: 100 + i };
    }
    const rows = normalizeTrafficCountries(distribution);
    expect(rows).toHaveLength(TRAFFIC_ESTIMATION_TOP_COUNTRIES);
    // Highest etv first.
    expect(rows[0]?.visits).toBeGreaterThan(rows[1]?.visits ?? 0);
  });
  it('null distribution → [], non-numeric etv → 0 visits, uppercases country codes', () => {
    expect(normalizeTrafficCountries(null)).toEqual([]);
    expect(normalizeTrafficCountries(undefined)).toEqual([]);
    expect(normalizeTrafficCountries({ ' us ': { etv: 100 }, de: { etv: null } })).toEqual([
      { countryCode: 'US', visits: 100 },
      { countryCode: 'DE', visits: 0 },
    ]);
  });
  it('drops entries with empty/whitespace country codes', () => {
    expect(normalizeTrafficCountries({ '': { etv: 5 }, '   ': { etv: 3 } })).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// Traffic ops — boundary + behavioural
// ---------------------------------------------------------------------------

describe('DataForSeoCompetitorProvider.getTrafficEstimation — boundary', () => {
  beforeAll(() => vendorMockServer.listen({ onUnhandledRequest: 'error' }));
  afterEach(() => vendorMockServer.resetHandlers());
  afterAll(() => vendorMockServer.close());

  it('refuses empty input after normalization', async () => {
    await expect(
      provider.getTrafficEstimation([], { locationCode: 2840, languageCode: 'en' }),
    ).rejects.toBeInstanceOf(VendorMalformedError);
    await expect(
      provider.getTrafficEstimation(['', '  '], {
        locationCode: 2840,
        languageCode: 'en',
      }),
    ).rejects.toBeInstanceOf(VendorMalformedError);
  });

  it('rejects non-positive location codes', async () => {
    await expect(
      provider.getTrafficEstimation(['ok.example'], {
        locationCode: 0,
        languageCode: 'en',
      }),
    ).rejects.toBeInstanceOf(VendorMalformedError);
    await expect(
      provider.getTrafficEstimation(['ok.example'], {
        locationCode: -5,
        languageCode: 'en',
      }),
    ).rejects.toBeInstanceOf(VendorMalformedError);
    await expect(
      provider.getTrafficEstimation(['ok.example'], {
        locationCode: 1.5,
        languageCode: 'en',
      }),
    ).rejects.toBeInstanceOf(VendorMalformedError);
  });

  it('rejects non-ISO-639-1 language codes', async () => {
    await expect(
      provider.getTrafficEstimation(['ok.example'], {
        locationCode: 2840,
        languageCode: '',
      }),
    ).rejects.toBeInstanceOf(VendorMalformedError);
    await expect(
      provider.getTrafficEstimation(['ok.example'], {
        locationCode: 2840,
        languageCode: 'english',
      }),
    ).rejects.toBeInstanceOf(VendorMalformedError);
    await expect(
      provider.getTrafficEstimation(['ok.example'], {
        locationCode: 2840,
        languageCode: 'e1',
      }),
    ).rejects.toBeInstanceOf(VendorMalformedError);
  });

  it('sends normalized + deduped + lowercased targets', async () => {
    let capturedBody: unknown;
    vendorMockServer.use(
      http.post('https://dataforseo.mock/v3/*', async ({ request }) => {
        capturedBody = await request.json();
        return HttpResponse.json(readFixture('bulk-traffic-estimation', 'success'));
      }),
    );
    await provider.getTrafficEstimation(
      ['HTTPS://WWW.Example.com/', 'example.com', 'Rival-One.Example'],
      { locationCode: 2840, languageCode: 'EN' },
    );
    expect(capturedBody).toEqual([
      {
        targets: ['example.com', 'rival-one.example'],
        location_code: 2840,
        language_code: 'en',
      },
    ]);
  });

  it('drops result rows with an empty target', async () => {
    vendorMockServer.use(
      http.post('https://dataforseo.mock/v3/*', () =>
        HttpResponse.json({
          version: '0.1.20260101',
          status_code: 20000,
          status_message: 'Ok.',
          tasks_count: 1,
          tasks_error: 0,
          tasks: [
            {
              id: 'TASK_ID',
              status_code: 20000,
              status_message: 'Ok.',
              cost: 0.0072,
              result: [
                {
                  items: [
                    { target: '', metrics: { organic: { etv: 100, count: 1 } } },
                    {
                      target: 'ok.example',
                      metrics: { organic: { etv: 50, count: 1 } },
                    },
                  ],
                },
              ],
            },
          ],
        }),
      ),
    );
    const rows = await provider.getTrafficEstimation(['ok.example'], {
      locationCode: 2840,
      languageCode: 'en',
    });
    expect(rows).toHaveLength(1);
    expect(rows[0]?.domain).toBe('ok.example');
  });

  it('rejects unknown task status as malformed', async () => {
    vendorMockServer.use(
      http.post('https://dataforseo.mock/v3/*', () =>
        HttpResponse.json({
          version: '0.1.20260101',
          status_code: 20000,
          status_message: 'Ok.',
          tasks_count: 1,
          tasks_error: 0,
          tasks: [
            {
              id: 'TASK_ID',
              status_code: 40602,
              status_message: 'Task In Queue.',
              cost: 0,
              result: null,
            },
          ],
        }),
      ),
    );
    await expect(
      provider.getTrafficEstimation(['ok.example'], {
        locationCode: 2840,
        languageCode: 'en',
      }),
    ).rejects.toBeInstanceOf(VendorMalformedError);
  });
});

describe('DataForSeoCompetitorProvider.getDomainRankOverview — boundary', () => {
  beforeAll(() => vendorMockServer.listen({ onUnhandledRequest: 'error' }));
  afterEach(() => vendorMockServer.resetHandlers());
  afterAll(() => vendorMockServer.close());

  it('refuses empty target', async () => {
    await expect(
      provider.getDomainRankOverview('  ', { locationCode: 2840, languageCode: 'en' }),
    ).rejects.toBeInstanceOf(VendorMalformedError);
  });

  it('rejects non-positive location codes and bad language codes', async () => {
    await expect(
      provider.getDomainRankOverview('example.com', {
        locationCode: 0,
        languageCode: 'en',
      }),
    ).rejects.toBeInstanceOf(VendorMalformedError);
    await expect(
      provider.getDomainRankOverview('example.com', {
        locationCode: 2840,
        languageCode: 'zzz',
      }),
    ).rejects.toBeInstanceOf(VendorMalformedError);
  });

  it('returns a zero row when the vendor reports no result item', async () => {
    vendorMockServer.use(
      http.post('https://dataforseo.mock/v3/*', () =>
        HttpResponse.json({
          version: '0.1.20260101',
          status_code: 20000,
          status_message: 'Ok.',
          tasks_count: 1,
          tasks_error: 0,
          tasks: [
            {
              id: 'TASK_ID',
              status_code: 20000,
              status_message: 'Ok.',
              cost: 0.006,
              result: [{ items: [] }],
            },
          ],
        }),
      ),
    );
    const row = await provider.getDomainRankOverview('unknown.example', {
      locationCode: 2840,
      languageCode: 'en',
    });
    expect(row).toEqual({
      domain: 'unknown.example',
      rank: null,
      keywordsCount: 0,
      estimatedMonthlyOrganicVisits: 0,
    });
  });

  it('falls back to the caller target when the vendor item target is empty', async () => {
    vendorMockServer.use(
      http.post('https://dataforseo.mock/v3/*', () =>
        HttpResponse.json({
          version: '0.1.20260101',
          status_code: 20000,
          status_message: 'Ok.',
          tasks_count: 1,
          tasks_error: 0,
          tasks: [
            {
              id: 'TASK_ID',
              status_code: 20000,
              status_message: 'Ok.',
              cost: 0.006,
              result: [
                {
                  items: [
                    {
                      target: '',
                      metrics: {
                        organic: { rank: 12, count: 3, etv: 44 },
                      },
                    },
                  ],
                },
              ],
            },
          ],
        }),
      ),
    );
    const row = await provider.getDomainRankOverview('  Fallback.Example  ', {
      locationCode: 2840,
      languageCode: 'en',
    });
    expect(row.domain).toBe('fallback.example');
  });

  it('rejects unknown task status', async () => {
    vendorMockServer.use(
      http.post('https://dataforseo.mock/v3/*', () =>
        HttpResponse.json({
          version: '0.1.20260101',
          status_code: 20000,
          status_message: 'Ok.',
          tasks_count: 1,
          tasks_error: 0,
          tasks: [
            {
              id: 'TASK_ID',
              status_code: 40602,
              status_message: 'Task In Queue.',
              cost: 0,
              result: null,
            },
          ],
        }),
      ),
    );
    await expect(
      provider.getDomainRankOverview('example.com', {
        locationCode: 2840,
        languageCode: 'en',
      }),
    ).rejects.toBeInstanceOf(VendorMalformedError);
  });
});

describe('DataForSeoCompetitorProvider.getHistoricalRankOverview — boundary', () => {
  beforeAll(() => vendorMockServer.listen({ onUnhandledRequest: 'error' }));
  afterEach(() => vendorMockServer.resetHandlers());
  afterAll(() => vendorMockServer.close());

  it('refuses empty target', async () => {
    await expect(
      provider.getHistoricalRankOverview('', {
        locationCode: 2840,
        languageCode: 'en',
        limit: 24,
      }),
    ).rejects.toBeInstanceOf(VendorMalformedError);
  });

  it('caps to the newest `limit` points in ascending order', async () => {
    vendorMockServer.use(
      http.post('https://dataforseo.mock/v3/*', () =>
        HttpResponse.json({
          version: '0.1.20260101',
          status_code: 20000,
          status_message: 'Ok.',
          tasks_count: 1,
          tasks_error: 0,
          tasks: [
            {
              id: 'TASK_ID',
              status_code: 20000,
              status_message: 'Ok.',
              cost: 0.0066,
              result: [
                {
                  items: [
                    {
                      target: 'example.com',
                      items: [
                        {
                          year: 2024,
                          month: 12,
                          metrics: { organic: { rank: 64, count: 1820, etv: 12400 } },
                        },
                        {
                          year: 2024,
                          month: 10,
                          metrics: { organic: { rank: 58, count: 1540, etv: 9800 } },
                        },
                        {
                          year: 2024,
                          month: 11,
                          metrics: { organic: { rank: 61, count: 1680, etv: 10950 } },
                        },
                      ],
                    },
                  ],
                },
              ],
            },
          ],
        }),
      ),
    );
    const result = await provider.getHistoricalRankOverview('example.com', {
      locationCode: 2840,
      languageCode: 'en',
      limit: 2,
    });
    expect(result.points).toEqual([
      {
        year: 2024,
        month: 11,
        rank: 61,
        organicKeywords: 1_680,
        organicEtv: 10_950,
      },
      {
        year: 2024,
        month: 12,
        rank: 64,
        organicKeywords: 1_820,
        organicEtv: 12_400,
      },
    ]);
  });

  it('drops invalid (year, month) points, keeps valid ones', async () => {
    vendorMockServer.use(
      http.post('https://dataforseo.mock/v3/*', () =>
        HttpResponse.json({
          version: '0.1.20260101',
          status_code: 20000,
          status_message: 'Ok.',
          tasks_count: 1,
          tasks_error: 0,
          tasks: [
            {
              id: 'TASK_ID',
              status_code: 20000,
              status_message: 'Ok.',
              cost: 0.0066,
              result: [
                {
                  items: [
                    {
                      target: 'example.com',
                      items: [
                        { year: null, month: 12, metrics: {} },
                        { year: 2024, month: 13, metrics: {} },
                        {
                          year: 2024,
                          month: 12,
                          metrics: { organic: { rank: 64, count: 1, etv: 2 } },
                        },
                      ],
                    },
                  ],
                },
              ],
            },
          ],
        }),
      ),
    );
    const result = await provider.getHistoricalRankOverview('example.com', {
      locationCode: 2840,
      languageCode: 'en',
      limit: 24,
    });
    expect(result.points).toHaveLength(1);
    expect(result.points[0]?.month).toBe(12);
  });

  it('rejects unknown task status', async () => {
    vendorMockServer.use(
      http.post('https://dataforseo.mock/v3/*', () =>
        HttpResponse.json({
          version: '0.1.20260101',
          status_code: 20000,
          status_message: 'Ok.',
          tasks_count: 1,
          tasks_error: 0,
          tasks: [
            {
              id: 'TASK_ID',
              status_code: 40602,
              status_message: 'Task In Queue.',
              cost: 0,
              result: null,
            },
          ],
        }),
      ),
    );
    await expect(
      provider.getHistoricalRankOverview('example.com', {
        locationCode: 2840,
        languageCode: 'en',
        limit: 24,
      }),
    ).rejects.toBeInstanceOf(VendorMalformedError);
  });
});

describe('DataForSeoCompetitorProvider — traffic normalization fallbacks', () => {
  beforeAll(() => vendorMockServer.listen({ onUnhandledRequest: 'error' }));
  afterEach(() => vendorMockServer.resetHandlers());
  afterAll(() => vendorMockServer.close());

  const envelope = (items: unknown[]) => ({
    status_code: 20000,
    tasks: [{ status_code: 20000, result: [{ items }] }],
  });

  it('drops non-string traffic targets and defaults missing organic metrics', async () => {
    vendorMockServer.use(
      http.post('*', () => HttpResponse.json(envelope([
        { target: null },
        { target: 'ok.example', metrics: null, country_distribution: null },
      ]))),
    );
    await expect(
      provider.getTrafficEstimation(['ok.example'], { locationCode: 2840, languageCode: 'en' }),
    ).resolves.toEqual([
      { domain: 'ok.example', monthlyOrganicVisits: 0, topCountries: [] },
    ]);
    vendorMockServer.use(
      http.post('*', () => HttpResponse.json({
        status_code: 20000,
        tasks: [{ status_code: 20000, result: null }],
      })),
    );
    await expect(
      provider.getTrafficEstimation(['ok.example'], { locationCode: 2840, languageCode: 'en' }),
    ).resolves.toEqual([]);
  });

  it('falls back to the requested rank domain and zeroes missing metrics', async () => {
    vendorMockServer.use(
      http.post('*', () => HttpResponse.json(envelope([{ target: null, metrics: null }]))),
    );
    await expect(
      provider.getDomainRankOverview('Fallback.Example', { locationCode: 2840, languageCode: 'en' }),
    ).resolves.toEqual({
      domain: 'fallback.example',
      rank: null,
      keywordsCount: 0,
      estimatedMonthlyOrganicVisits: 0,
    });
  });

  it('defaults the historical target and metrics while dropping null dates', async () => {
    vendorMockServer.use(
      http.post('*', () => HttpResponse.json(envelope([{
        target: null,
        items: [
          { year: null, month: 1 },
          { year: 2025, month: null },
          { year: 2025, month: 6, metrics: null },
        ],
      }]))),
    );
    await expect(
      provider.getHistoricalRankOverview('Fallback.Example', {
        locationCode: 2840,
        languageCode: 'en',
        limit: 24,
      }),
    ).resolves.toEqual({
      domain: 'fallback.example',
      points: [{ year: 2025, month: 6, rank: null, organicKeywords: 0, organicEtv: 0 }],
    });
    vendorMockServer.use(
      http.post('*', () => HttpResponse.json({
        status_code: 20000,
        tasks: [{ status_code: 20000, result: null }],
      })),
    );
    await expect(
      provider.getHistoricalRankOverview('Fallback.Example', {
        locationCode: 2840,
        languageCode: 'en',
        limit: 24,
      }),
    ).resolves.toEqual({ domain: 'fallback.example', points: [] });
  });
});

// ---------------------------------------------------------------------------
// Cost capture — pinned to Prompt 00 sheet math
// ---------------------------------------------------------------------------

/**
 * Task base pinned at 6_000 micros ($0.006 — the labs "light" task tier).
 * Rates from spec 01b table: 400 micros/domain (bulk traffic) and 200
 * micros/point (historical). Combined worst-case envelope check below
 * proves the trio fits inside the 40_000 micros `traffic_snapshots` cap for
 * a 3-task, 30-domain, 24-point run.
 */
const TRAFFIC_TASK_BASE_MICROS = 6_000n;
const TRAFFIC_DOMAIN_MICROS = 400n;
const HISTORICAL_POINT_MICROS = 200n;

describe('DataForSeoCompetitorProvider — traffic-op cost capture (Prompt 00 sheet)', () => {
  beforeAll(() => vendorMockServer.listen({ onUnhandledRequest: 'error' }));
  afterEach(() => vendorMockServer.resetHandlers());
  afterAll(() => vendorMockServer.close());

  it('getTrafficEstimation: envelope cost sums task + 400 micros/domain (3 domains)', async () => {
    clearDataForSeoClientCache();
    mockVendor('dataforseo-labs-competitors', 'bulk-traffic-estimation', 'success');
    const { costMicros } = await captureVendorCost(() =>
      provider.getTrafficEstimation(
        ['example.com', 'rival-one.example', 'niche-three.example'],
        { locationCode: 2840, languageCode: 'en' },
      ),
    );
    // Fixture envelope cost 0.0072 USD → 7_200 micros = 6_000 task + 400 × 3 domains.
    expect(costMicros).toBe(usdToMicros(0.0072));
    expect(costMicros).toBe(TRAFFIC_TASK_BASE_MICROS + TRAFFIC_DOMAIN_MICROS * 3n);
  });

  it('getDomainRankOverview: envelope cost is task-only (no per-item bill)', async () => {
    mockVendor('dataforseo-labs-competitors', 'domain-rank-overview', 'success');
    const { costMicros } = await captureVendorCost(() =>
      provider.getDomainRankOverview('example.com', {
        locationCode: 2840,
        languageCode: 'en',
      }),
    );
    // Fixture envelope cost 0.006 USD → 6_000 micros = task base only.
    expect(costMicros).toBe(usdToMicros(0.006));
    expect(costMicros).toBe(TRAFFIC_TASK_BASE_MICROS);
  });

  it('getHistoricalRankOverview: envelope cost sums task + 200 micros/point (3 points)', async () => {
    mockVendor('dataforseo-labs-competitors', 'historical-rank-overview', 'success');
    const { costMicros } = await captureVendorCost(() =>
      provider.getHistoricalRankOverview('example.com', {
        locationCode: 2840,
        languageCode: 'en',
        limit: 24,
      }),
    );
    // Fixture envelope cost 0.0066 USD → 6_600 micros = 6_000 task + 200 × 3 points.
    expect(costMicros).toBe(usdToMicros(0.0066));
    expect(costMicros).toBe(TRAFFIC_TASK_BASE_MICROS + HISTORICAL_POINT_MICROS * 3n);
  });

  it('combined worst case (3 tasks, 30 domains, 24 points) stays under 40 000 micros', () => {
    // Traffic estimation: 1 task + up to TRAFFIC_ESTIMATION_MAX_DOMAINS domains.
    const traffic =
      TRAFFIC_TASK_BASE_MICROS +
      TRAFFIC_DOMAIN_MICROS * BigInt(TRAFFIC_ESTIMATION_MAX_DOMAINS);
    // Domain rank overview: task-only.
    const rank = TRAFFIC_TASK_BASE_MICROS;
    // Historical rank overview: 1 task + up to HISTORICAL_RANK_MAX_POINTS points.
    const historical =
      TRAFFIC_TASK_BASE_MICROS +
      HISTORICAL_POINT_MICROS * BigInt(HISTORICAL_RANK_MAX_POINTS);
    const combined = traffic + rank + historical;
    // Structural sanity: 18_000 + 6_000 + 10_800 = 34_800 micros.
    expect(combined).toBe(34_800n);
    // Stays inside the 40_000-micro per-snapshot spend bound.
    expect(combined).toBeLessThanOrEqual(40_000n);
  });
});

// ---------------------------------------------------------------------------
// JSON round-trip — cache serializability of every traffic-op result shape
// ---------------------------------------------------------------------------

describe('DataForSeoCompetitorProvider — traffic-op JSON round-trip', () => {
  beforeAll(() => vendorMockServer.listen({ onUnhandledRequest: 'error' }));
  afterEach(() => vendorMockServer.resetHandlers());
  afterAll(() => vendorMockServer.close());

  it('traffic-estimation result JSON round-trips', async () => {
    mockVendor('dataforseo-labs-competitors', 'bulk-traffic-estimation', 'success');
    const rows = await provider.getTrafficEstimation(
      ['example.com', 'rival-one.example', 'niche-three.example'],
      { locationCode: 2840, languageCode: 'en' },
    );
    expect(JSON.parse(JSON.stringify(rows))).toEqual(rows);
  });

  it('domain-rank-overview result JSON round-trips', async () => {
    mockVendor('dataforseo-labs-competitors', 'domain-rank-overview', 'success');
    const row = await provider.getDomainRankOverview('example.com', {
      locationCode: 2840,
      languageCode: 'en',
    });
    expect(JSON.parse(JSON.stringify(row))).toEqual(row);
  });

  it('historical-rank-overview result JSON round-trips', async () => {
    mockVendor('dataforseo-labs-competitors', 'historical-rank-overview', 'success');
    const result = await provider.getHistoricalRankOverview('example.com', {
      locationCode: 2840,
      languageCode: 'en',
      limit: 24,
    });
    expect(JSON.parse(JSON.stringify(result))).toEqual(result);
  });
});

// ---------------------------------------------------------------------------
// Additive backward compatibility — a caller that stubs only the shipped
// methods on `CompetitorProvider` still type-checks (optional at interface).
// ---------------------------------------------------------------------------

describe('CompetitorProvider — additive backward compatibility', () => {
  it('a shipped-only stub satisfies the CompetitorProvider structural shape', () => {
    // Purely a type-level assertion: this file compiles with strict mode iff
    // the four additive operations remain OPTIONAL on the interface. If a later
    // change flips them to required, this const errors under `tsc`.
    const stub: CompetitorProvider = {
      async getCompetitors() {
        return [];
      },
      async getSerpCompetitors() {
        return [];
      },
      async getDomainIntersection() {
        return [];
      },
      async getTechnologies() {
        return [];
      },
    };
    expect(typeof stub.getCompetitors).toBe('function');
    expect(stub.compareDomains).toBeUndefined();
    expect(stub.getTrafficEstimation).toBeUndefined();
    expect(stub.getDomainRankOverview).toBeUndefined();
    expect(stub.getHistoricalRankOverview).toBeUndefined();
  });
});

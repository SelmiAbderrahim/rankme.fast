import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { delay, http, HttpResponse, type JsonBodyType } from 'msw';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { vendorMockServer } from '../../testing/fixtures/mock-vendor.js';
import {
  VendorMalformedError,
  VendorQuotaError,
  VendorTimeoutError,
} from '../errors.js';
import {
  computeNapConsistency,
  createDataForSeoLocalListingsProvider,
  normalizeBusinessListings,
  normalizeQaSummary,
  normalizeReviewsSummary,
  type DataForSeoLocalListingsProviderConfig,
} from './local-listings.js';

const FIXTURES_ROOT = join(
  dirname(fileURLToPath(import.meta.url)),
  '..',
  '..',
  'testing',
  'fixtures',
  'dataforseo-business-data',
);

interface FixtureMeta {
  timeout?: boolean;
}

function readFixture(name: string): JsonBodyType {
  return JSON.parse(readFileSync(join(FIXTURES_ROOT, `${name}.json`), 'utf8')) as JsonBodyType;
}

function readMeta(name: string): FixtureMeta {
  return JSON.parse(
    readFileSync(join(FIXTURES_ROOT, `${name}.meta.json`), 'utf8'),
  ) as FixtureMeta;
}

function mockBusinessData(name: string): void {
  if (name.endsWith('-timeout') && readMeta(name).timeout === true) {
    vendorMockServer.use(http.all('*', () => delay('infinite') as unknown as Promise<Response>));
    return;
  }
  vendorMockServer.use(http.all('*', () => HttpResponse.json(readFixture(name))));
}

const cfg: DataForSeoLocalListingsProviderConfig = {
  login: 'sandbox-login',
  password: 'sandbox-password',
  baseUrl: 'https://dataforseo.mock/v3',
  timeoutMs: 60,
  maxRetries: 0,
  backoffBaseMs: 1,
  random: () => 0,
};

const provider = createDataForSeoLocalListingsProvider(cfg);

interface BusinessDataContractOptions<T> {
  title: string;
  fixturePrefix: 'listings' | 'reviews' | 'qa';
  makeCall: () => Promise<T>;
  assertSuccess: (result: T) => void;
}

function businessDataContractTests<T>(opts: BusinessDataContractOptions<T>): void {
  describe(`${opts.title} — provider contract`, () => {
    beforeAll(() => vendorMockServer.listen({ onUnhandledRequest: 'error' }));
    afterEach(() => vendorMockServer.resetHandlers());
    afterAll(() => vendorMockServer.close());

    it('success: parses the recorded response to the interface shape', async () => {
      mockBusinessData(`${opts.fixturePrefix}-success`);
      opts.assertSuccess(await opts.makeCall());
    });

    it('timeout: rejects with VendorTimeoutError', async () => {
      mockBusinessData(`${opts.fixturePrefix}-timeout`);
      await expect(opts.makeCall()).rejects.toBeInstanceOf(VendorTimeoutError);
    });

    it('malformed: rejects with VendorMalformedError', async () => {
      mockBusinessData(`${opts.fixturePrefix}-malformed`);
      await expect(opts.makeCall()).rejects.toBeInstanceOf(VendorMalformedError);
    });

    it('quota: rejects with VendorQuotaError', async () => {
      mockBusinessData(`${opts.fixturePrefix}-quota`);
      await expect(opts.makeCall()).rejects.toBeInstanceOf(VendorQuotaError);
    });
  });
}

businessDataContractTests({
  title: 'DataForSeoLocalListingsProvider.getBusinessListings',
  fixturePrefix: 'listings',
  makeCall: () => provider.getBusinessListings('example.com'),
  assertSuccess: (result) => {
    expect(result).toHaveLength(3);
    expect(result.every((row) => row.consistent)).toBe(true);
    expect(result[0]).toMatchObject({
      source: 'google',
      name: 'Example Dental Studio',
      phone: '+1 512-555-0100',
    });
  },
});

businessDataContractTests({
  title: 'DataForSeoLocalListingsProvider.getReviews',
  fixturePrefix: 'reviews',
  makeCall: () => provider.getReviews('example.com'),
  assertSuccess: (result) => {
    expect(result).toEqual({
      averageRating: 4.7,
      reviewCount: 1226,
      recentReviewCount: 10,
    });
  },
});

businessDataContractTests({
  title: 'DataForSeoLocalListingsProvider.getQuestionsAndAnswers',
  fixturePrefix: 'qa',
  makeCall: () => provider.getQuestionsAndAnswers('example.com'),
  assertSuccess: (result) => {
    expect(result).toEqual({ questionCount: 3, unansweredCount: 1 });
  },
});

describe('DataForSeoLocalListingsProvider — behaviours', () => {
  beforeAll(() => vendorMockServer.listen({ onUnhandledRequest: 'error' }));
  afterEach(() => vendorMockServer.resetHandlers());
  afterAll(() => vendorMockServer.close());

  it('computes NAP mismatch against the Google listing row', async () => {
    mockBusinessData('listings-nap-mismatch');
    const result = await provider.getBusinessListings('https://example.com/');
    expect(result.map((row) => ({ source: row.source, consistent: row.consistent }))).toEqual([
      { source: 'google', consistent: true },
      { source: 'bing-places', consistent: false },
      { source: 'yelp', consistent: true },
    ]);
  });

  it('sends normalized bodies to all three Business Data endpoints', async () => {
    const calls: Array<{ path: string; body: unknown }> = [];
    vendorMockServer.use(
      http.post('https://dataforseo.mock/v3/*', async ({ request }) => {
        const path = new URL(request.url).pathname;
        const body = await request.json();
        calls.push({ path, body });
        if (path.endsWith('/business_data/business_listings/search/live')) {
          return HttpResponse.json(readFixture('listings-success'));
        }
        if (path.endsWith('/business_data/google/my_business_info/live')) {
          return HttpResponse.json(readFixture('reviews-success'));
        }
        return HttpResponse.json(readFixture('qa-success'));
      }),
    );

    await provider.getBusinessListings('HTTPS://Example.com/');
    await provider.getReviews('HTTPS://Example.com/');
    await provider.getQuestionsAndAnswers('HTTPS://Example.com/');

    expect(calls).toEqual([
      {
        path: '/v3/business_data/business_listings/search/live',
        body: [
          {
            title: 'example.com',
            filters: [['domain', '=', 'example.com']],
            limit: 20,
          },
        ],
      },
      {
        path: '/v3/business_data/google/my_business_info/live',
        body: [{ keyword: 'example.com', location_code: 2840, language_code: 'en' }],
      },
      {
        path: '/v3/business_data/google/questions_and_answers/live',
        body: [
          {
            keyword: 'example.com',
            location_code: 2840,
            language_code: 'en',
            depth: 100,
          },
        ],
      },
    ]);
  });

  it('throws taxonomy errors for empty targets before spending', async () => {
    await expect(provider.getBusinessListings('   ')).rejects.toBeInstanceOf(
      VendorMalformedError,
    );
    await expect(provider.getReviews('   ')).rejects.toBeInstanceOf(VendorMalformedError);
    await expect(provider.getQuestionsAndAnswers('   ')).rejects.toBeInstanceOf(
      VendorMalformedError,
    );
  });

  it('treats created/non-ok task outcomes as malformed for live methods', async () => {
    vendorMockServer.use(
      http.post('*', () =>
        HttpResponse.json({
          status_code: 20000,
          tasks: [{ id: 'TASK_ID', status_code: 20100, cost: 0 }],
        }),
      ),
    );
    await expect(provider.getBusinessListings('example.com')).rejects.toBeInstanceOf(
      VendorMalformedError,
    );
    await expect(provider.getReviews('example.com')).rejects.toBeInstanceOf(
      VendorMalformedError,
    );
    await expect(provider.getQuestionsAndAnswers('example.com')).rejects.toBeInstanceOf(
      VendorMalformedError,
    );
  });

  it('falls back through url → normalized domain, then type → "unknown" when the row lacks source labels', async () => {
    vendorMockServer.use(
      http.post('*/business_data/business_listings/search/live', () =>
        HttpResponse.json({
          status_code: 20000,
          tasks: [
            {
              id: 'TASK_ID',
              status_code: 20000,
              cost: 0,
              result: [
                {
                  items: [
                    { url: 'https://YELP.com/biz/x', title: 'Example', address: '1 A', phone: '1' },
                    { type: 'apple_maps', title: 'Example', address: '1 A', phone: '1' },
                    { title: 'Example', address: '1 A', phone: '1' },
                  ],
                },
              ],
            },
          ],
        }),
      ),
    );
    const result = await provider.getBusinessListings('example.com');
    expect(result.map((r) => r.source)).toEqual(['yelp.com/biz/x', 'apple_maps', 'unknown']);
  });
});

describe('local listings pure normalizers', () => {
  it('marks rows consistent when no Google source row exists', () => {
    expect(
      computeNapConsistency([
        {
          source: 'yelp',
          name: 'Example Dental',
          address: '100 Main',
          phone: '+1 512-555-0100',
        },
      ]),
    ).toEqual([
      {
        source: 'yelp',
        name: 'Example Dental',
        address: '100 Main',
        phone: '+1 512-555-0100',
        consistent: true,
      },
    ]);
  });

  it('falls back from reviews_count to rating votes and reports no recent window', () => {
    expect(
      normalizeReviewsSummary([
        {
          items: [
            {
              rating: { value: null, votes_count: 42 },
              reviews: null,
            },
          ],
        },
      ]),
    ).toEqual({ averageRating: null, reviewCount: 42, recentReviewCount: null });
  });

  it('counts recent reviews from an inline reviews array when items_count is absent', () => {
    expect(
      normalizeReviewsSummary([
        {
          items: [
            {
              rating: { value: 5, votes_count: 2 },
              reviews: [{}, {}],
            },
          ],
        },
      ]),
    ).toEqual({ averageRating: 5, reviewCount: 2, recentReviewCount: 2 });
  });

  it('defaults review summary to zeros/nulls when no item is present', () => {
    expect(normalizeReviewsSummary([{ items: null }])).toEqual({
      averageRating: null,
      reviewCount: 0,
      recentReviewCount: null,
    });
  });

  it('falls back Q&A count to items length and supports answers[]', () => {
    expect(
      normalizeQaSummary([
        {
          items: [
            { question_text: 'Answered', answers: [{}] },
            { question_text: 'Unanswered', answers: [] },
          ],
        },
      ]),
    ).toEqual({ questionCount: 2, unansweredCount: 1 });
  });

  it('falls back Q&A to empty items and matches items_count when supplied', () => {
    expect(normalizeQaSummary([{ items_count: 5 }])).toEqual({
      questionCount: 5,
      unansweredCount: 0,
    });
  });

  it('normalizeBusinessListings uses name/title/original_title fallbacks and drops empty rows', () => {
    const rows = normalizeBusinessListings([
      {
        items: [
          { name: 'First Row', domain: 'a.example', address: '1 A', phone: '1' },
          { title: 'Titled Row', domain: 'b.example', address: '1 B', phone: '2' },
          { original_title: 'Original', domain: 'c.example', address: '1 C', phone: '3' },
          { name: '   ', domain: 'd.example', address: '1 D', phone: '4' },
          { domain: 'e.example', address: '1 E', phone: '5' },
        ],
      },
    ]);
    expect(rows.map((r) => r.name)).toEqual(['First Row', 'Titled Row', 'Original']);
  });

  it('normalizeBusinessListings returns [] when the response has no bucket', () => {
    expect(normalizeBusinessListings([])).toEqual([]);
  });

  it('normalizeBusinessListings defaults missing address to null and picks the first non-empty phone_numbers entry', () => {
    const rows = normalizeBusinessListings([
      {
        items: [
          { name: 'A', domain: 'a.example', phone_numbers: ['+1-555-0100'] },
          { name: 'B', domain: 'b.example', phone_numbers: [] },
        ],
      },
    ]);
    expect(rows[0]?.address).toBeNull();
    expect(rows[0]?.phone).toBe('+1-555-0100');
    expect(rows[1]?.phone).toBeNull();
  });

  it('computeNapConsistency normalizes null name/address/phone on the google row', () => {
    const rows = computeNapConsistency([
      { source: 'google', name: 'Example', address: null, phone: null },
      { source: 'yelp', name: 'example', address: null, phone: null },
    ]);
    expect(rows.every((r) => r.consistent)).toBe(true);
  });

  it('normalizeQaSummary treats items[].items === null as unanswered via the answers[] fallback', () => {
    expect(
      normalizeQaSummary([
        {
          items: [
            { items: [{}] },
            { answers: [] },
            {},
          ],
        },
      ]),
    ).toEqual({ questionCount: 3, unansweredCount: 2 });
  });
});

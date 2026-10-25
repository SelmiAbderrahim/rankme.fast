import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { delay, http, HttpResponse, type JsonBodyType } from 'msw';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { vendorMockServer } from '../../testing/fixtures/mock-vendor.js';
import type { LocalBusinessIdentity, LocalListingTarget } from '../types.js';
import {
  VendorMalformedError,
  VendorQuotaError,
  VendorTimeoutError,
} from '../errors.js';
import {
  businessKeyword,
  candidateFromListing,
  candidateFromProfile,
  computeNapConsistency,
  createDataForSeoLocalListingsProvider,
  normalizeBusinessCandidates,
  normalizeBusinessListings,
  normalizeIdentityListings,
  parseBusinessIdQuery,
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

/** A domain-only target, as stored before business setup existed. */
function legacy(domain: string): LocalListingTarget {
  return { domain, business: null, locationCode: 2840, languageCode: 'en' };
}

const DOWNTOWN: LocalBusinessIdentity = {
  placeId: 'ChIJFakeDentalDowntown01',
  cid: '1000000000000000001',
  name: 'Example Dental Studio',
};

function selected(business: LocalBusinessIdentity = DOWNTOWN): LocalListingTarget {
  return { domain: 'example.com', business, locationCode: 2682, languageCode: 'ar' };
}

interface BusinessDataContractOptions<T> {
  title: string;
  fixturePrefix: 'listings' | 'reviews' | 'qa' | 'search';
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
  makeCall: () => provider.getBusinessListings(legacy('example.com')),
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
  makeCall: () => provider.getReviews(legacy('example.com')),
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
  makeCall: () => provider.getQuestionsAndAnswers(legacy('example.com')),
  assertSuccess: (result) => {
    expect(result).toEqual({ questionCount: 3, unansweredCount: 1 });
  },
});

businessDataContractTests({
  title: 'DataForSeoLocalListingsProvider.searchBusinesses',
  fixturePrefix: 'search',
  makeCall: () =>
    provider.searchBusinesses({ query: 'Example Dental Studio', locationCode: 2840, languageCode: 'en' }),
  assertSuccess: (result) => {
    // Duplicates collapse by place ID; a row without any identifier is dropped.
    expect(result).toEqual([
      {
        placeId: 'ChIJFakeDentalDowntown01',
        cid: '1000000000000000001',
        name: 'Example Dental Studio',
        address: '100 Main St, Austin, TX 78701',
        phone: '+1 512-555-0100',
        domain: 'example.com',
        category: 'Dentist',
        latitude: 30.2672,
        longitude: -97.7431,
      },
      {
        placeId: 'ChIJFakeDentalNorth00002',
        cid: '1000000000000000002',
        name: 'Example Dental Studio North',
        address: '9000 Research Blvd, Austin, TX 78758',
        phone: '+1 512-555-0200',
        domain: null,
        category: 'Dentist',
        latitude: 30.3751,
        longitude: -97.7194,
      },
    ]);
  },
});

describe('DataForSeoLocalListingsProvider — business search and selected-business refresh', () => {
  beforeAll(() => vendorMockServer.listen({ onUnhandledRequest: 'error' }));
  afterEach(() => vendorMockServer.resetHandlers());
  afterAll(() => vendorMockServer.close());

  function record(responses: Record<string, string | null>) {
    const calls: Array<{ path: string; body: unknown }> = [];
    vendorMockServer.use(
      http.post('https://dataforseo.mock/v3/*', async ({ request }) => {
        const path = new URL(request.url).pathname.replace('/v3', '');
        calls.push({ path, body: await request.json() });
        const fixture = responses[path];
        if (fixture === null || fixture === undefined) {
          return HttpResponse.json({
            status_code: 20000,
            tasks: [{ id: 'TASK_ID', status_code: 20000, cost: 0, result: [{ items: [] }] }],
          });
        }
        return HttpResponse.json(readFixture(fixture));
      }),
    );
    return calls;
  }

  const INFO = '/business_data/google/my_business_info/live';
  const LISTINGS = '/business_data/business_listings/search/live';
  const QA = '/business_data/google/questions_and_answers/live';

  it.each([
    ['place_id:ChIJFakeDentalDowntown01', 'place_id:ChIJFakeDentalDowntown01'],
    ['ChIJFakeDentalDowntown01', 'place_id:ChIJFakeDentalDowntown01'],
    ['CID:1000000000000000001', 'cid:1000000000000000001'],
    ['1000000000000000001', 'cid:1000000000000000001'],
  ])('looks up %s by its identifier in the business profile, once', async (query, keyword) => {
    const calls = record({ [INFO]: 'search-profile-success' });
    const result = await provider.searchBusinesses({ query, locationCode: 2682, languageCode: 'ar' });
    expect(calls).toEqual([
      { path: INFO, body: [{ keyword, location_code: 2682, language_code: 'ar' }] },
    ]);
    expect(result.map((c) => c.placeId)).toEqual(['ChIJFakeDentalDowntown01']);
  });

  it('searches names in listings and does not call the profile lookup when that finds the business', async () => {
    const calls = record({ [LISTINGS]: 'search-success' });
    await provider.searchBusinesses({ query: '  Example Dental Studio ', locationCode: 2840, languageCode: 'en' });
    expect(calls).toEqual([{ path: LISTINGS, body: [{ title: 'Example Dental Studio', limit: 10 }] }]);
  });

  it('falls back to one profile lookup when listings find nothing (an address, say)', async () => {
    const calls = record({ [LISTINGS]: null, [INFO]: 'search-profile-success' });
    const result = await provider.searchBusinesses({
      query: '100 Main St, Austin',
      locationCode: 2840,
      languageCode: 'en',
    });
    expect(calls.map((c) => c.path)).toEqual([LISTINGS, INFO]);
    expect(calls[1]!.body).toEqual([{ keyword: '100 Main St, Austin', location_code: 2840, language_code: 'en' }]);
    expect(result).toHaveLength(1);
  });

  it('returns no candidates when neither lookup finds anything', async () => {
    record({});
    await expect(
      provider.searchBusinesses({ query: 'Nowhere Bakery', locationCode: 2840, languageCode: 'en' }),
    ).resolves.toEqual([]);
  });

  it('refuses an empty query before any vendor call', async () => {
    const calls = record({});
    await expect(
      provider.searchBusinesses({ query: '   ', locationCode: 2840, languageCode: 'en' }),
    ).rejects.toBeInstanceOf(VendorMalformedError);
    expect(calls).toEqual([]);
  });

  it('treats non-ok search tasks as malformed on both lookup paths', async () => {
    vendorMockServer.use(
      http.post('*', () =>
        HttpResponse.json({ status_code: 20000, tasks: [{ id: 'TASK_ID', status_code: 20100, cost: 0 }] }),
      ),
    );
    await expect(
      provider.searchBusinesses({ query: 'Example', locationCode: 2840, languageCode: 'en' }),
    ).rejects.toBeInstanceOf(VendorMalformedError);
    await expect(
      provider.searchBusinesses({ query: 'cid:12345678', locationCode: 2840, languageCode: 'en' }),
    ).rejects.toBeInstanceOf(VendorMalformedError);
  });

  it('tolerates empty result buckets on every lookup path', async () => {
    vendorMockServer.use(
      http.post('*/business_data/business_listings/search/live', () =>
        HttpResponse.json({ status_code: 20000, tasks: [{ id: 'TASK_ID', status_code: 20000, cost: 0, result: [{ items: null }] }] }),
      ),
      http.post('*/business_data/google/my_business_info/live', () =>
        HttpResponse.json({ status_code: 20000, tasks: [{ id: 'TASK_ID', status_code: 20000, cost: 0, result: [{ items: null }] }] }),
      ),
    );
    const market = { locationCode: 2840, languageCode: 'en' };
    await expect(provider.searchBusinesses({ query: 'Example', ...market })).resolves.toEqual([]);
    await expect(provider.searchBusinesses({ query: 'cid:123456', ...market })).resolves.toEqual([]);
  });

  it('refreshes the selected business by its identity in its own market', async () => {
    const calls = record({ [LISTINGS]: 'listings-identity', [INFO]: 'reviews-success', [QA]: 'qa-success' });
    const target = selected();
    const listings = await provider.getBusinessListings(target);
    await provider.getReviews(target);
    await provider.getQuestionsAndAnswers(target);
    expect(calls).toEqual([
      { path: LISTINGS, body: [{ title: 'Example Dental Studio', limit: 20 }] },
      {
        path: INFO,
        body: [{ keyword: 'place_id:ChIJFakeDentalDowntown01', location_code: 2682, language_code: 'ar' }],
      },
      {
        path: QA,
        body: [
          {
            keyword: 'place_id:ChIJFakeDentalDowntown01',
            location_code: 2682,
            language_code: 'ar',
            depth: 100,
          },
        ],
      },
    ]);
    // Its own row is the reference; same-website rows are compared to it; the
    // other branch and an unrelated business are left out.
    expect(listings).toEqual([
      {
        source: 'google',
        name: 'Example Dental Studio',
        address: '100 Main St, Austin, TX 78701',
        phone: '+1 512-555-0100',
        consistent: true,
      },
      {
        source: 'yelp',
        name: 'Example Dental',
        address: '100 Main Street, Austin, TX 78701',
        phone: '+1 512-555-0100',
        consistent: false,
      },
    ]);
  });

  it('names a CID-only business with the cid: keyword', async () => {
    const calls = record({ [INFO]: 'reviews-success' });
    await provider.getReviews(selected({ placeId: null, cid: '1000000000000000001', name: 'Example Dental Studio' }));
    expect(calls[0]!.body).toEqual([
      { keyword: 'cid:1000000000000000001', location_code: 2682, language_code: 'ar' },
    ]);
  });
});

describe('DataForSeoLocalListingsProvider — behaviours', () => {
  beforeAll(() => vendorMockServer.listen({ onUnhandledRequest: 'error' }));
  afterEach(() => vendorMockServer.resetHandlers());
  afterAll(() => vendorMockServer.close());

  it('computes NAP mismatch against the Google listing row', async () => {
    mockBusinessData('listings-nap-mismatch');
    const result = await provider.getBusinessListings(legacy('https://example.com/'));
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

    await provider.getBusinessListings(legacy('HTTPS://Example.com/'));
    await provider.getReviews(legacy('HTTPS://Example.com/'));
    await provider.getQuestionsAndAnswers(legacy('HTTPS://Example.com/'));

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
    await expect(provider.getBusinessListings(legacy('   '))).rejects.toBeInstanceOf(
      VendorMalformedError,
    );
    await expect(provider.getReviews(legacy('   '))).rejects.toBeInstanceOf(VendorMalformedError);
    await expect(provider.getQuestionsAndAnswers(legacy('   '))).rejects.toBeInstanceOf(
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
    await expect(provider.getBusinessListings(legacy('example.com'))).rejects.toBeInstanceOf(
      VendorMalformedError,
    );
    await expect(provider.getReviews(legacy('example.com'))).rejects.toBeInstanceOf(
      VendorMalformedError,
    );
    await expect(provider.getQuestionsAndAnswers(legacy('example.com'))).rejects.toBeInstanceOf(
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
    const result = await provider.getBusinessListings(legacy('example.com'));
    expect(result.map((r) => r.source)).toEqual(['yelp.com/biz/x', 'apple_maps', 'unknown']);
  });
});

describe('business search pure helpers', () => {
  it('parseBusinessIdQuery accepts vendor keywords and bare identifiers only', () => {
    expect(parseBusinessIdQuery('place_id:ChIJabc')).toEqual({ placeId: 'ChIJabc' });
    expect(parseBusinessIdQuery('Place_ID:ChIJabc')).toEqual({ placeId: 'ChIJabc' });
    expect(parseBusinessIdQuery(' cid:12345 ')).toEqual({ cid: '12345' });
    expect(parseBusinessIdQuery('cid:not-a-number')).toBeNull();
    expect(parseBusinessIdQuery('ChIJ12345678901')).toEqual({ placeId: 'ChIJ12345678901' });
    expect(parseBusinessIdQuery('ChIJshort')).toBeNull();
    expect(parseBusinessIdQuery('5125550100')).toEqual({ cid: '5125550100' });
    expect(parseBusinessIdQuery('512 555 0100')).toBeNull();
    expect(parseBusinessIdQuery('Example Dental')).toBeNull();
  });

  it('businessKeyword prefers the place ID', () => {
    expect(businessKeyword({ placeId: 'ChIJx', cid: '1', name: 'A' })).toBe('place_id:ChIJx');
    expect(businessKeyword({ placeId: null, cid: '1', name: 'A' })).toBe('cid:1');
  });

  it('candidateFromListing falls back across name, phone, website and coordinates', () => {
    expect(
      candidateFromListing({
        original_title: '  Original Name ',
        phone_numbers: ['+1 555'],
        url: 'https://WWW.Example.com/x',
        cid: 42,
        latitude: Number.NaN,
        longitude: 10,
      }),
    ).toEqual({
      placeId: null,
      cid: '42',
      name: 'Original Name',
      address: null,
      phone: '+1 555',
      domain: 'example.com',
      category: null,
      latitude: null,
      longitude: 10,
    });
    expect(candidateFromListing({ name: 'Named', place_id: '  ' })).toBeNull();
    expect(candidateFromListing({ place_id: 'ChIJx' })).toBeNull();
    expect(candidateFromListing({ name: 'Nameless', title: 'Title' , place_id: 'ChIJx' })?.name).toBe('Nameless');
  });

  it('candidateFromProfile reads the profile title and leaves missing fields null', () => {
    expect(candidateFromProfile({ title: 'Profile', cid: '7' })).toEqual({
      placeId: null,
      cid: '7',
      name: 'Profile',
      address: null,
      phone: null,
      domain: null,
      category: null,
      latitude: null,
      longitude: null,
    });
    expect(candidateFromProfile({ title: null, cid: '7' })).toBeNull();
  });

  it('normalizeBusinessCandidates de-duplicates by place ID or CID and keeps at most ten', () => {
    const many = Array.from({ length: 14 }, (_, i) =>
      candidateFromListing({ name: `Biz ${i}`, cid: String(i % 12) }),
    );
    const result = normalizeBusinessCandidates([null, ...many]);
    expect(result).toHaveLength(10);
    expect(new Set(result.map((c) => c.cid)).size).toBe(10);
  });

  it('normalizeIdentityListings needs the business own row and its website to compare others', () => {
    const cidOnly = { placeId: null, cid: '9', name: 'Fallback Name' };
    expect(normalizeIdentityListings([], cidOnly)).toEqual([]);
    expect(normalizeIdentityListings([{ items: [{ title: 'Other', cid: '8' }] }], cidOnly)).toEqual([]);
    // Without a website on the reference row, only that row is reported.
    expect(
      normalizeIdentityListings(
        [{ items: [{ cid: 9, address: null }, { title: 'Twin', domain: null, address: 'x' }] }],
        cidOnly,
      ),
    ).toEqual([{ source: 'google', name: 'Fallback Name', address: null, phone: null, consistent: true }]);
    expect(
      normalizeIdentityListings(
        [
          {
            items: [
              { place_id: 'ChIJy', url: 'https://example.com', title: 'Mine' },
              { title: 'No site', address: '1' },
              { url: 'https://example.com/about', title: 'Mine', source: 'bing-places' },
            ],
          },
        ],
        { placeId: 'ChIJy', cid: null, name: 'Mine' },
      ).map((row) => row.source),
    ).toEqual(['google', 'bing-places']);
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

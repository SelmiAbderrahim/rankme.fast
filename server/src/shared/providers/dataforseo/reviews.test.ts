/**
 * DataForSEO Business Data reviews contract + normalization tests
 *.
 *
 * Reviews is a two-call flow (task_post + task_get). The success case installs
 * per-URL MSW handlers so the mock returns the task_post envelope on POST and
 * the task_get envelope on GET; the timeout / malformed / quota cases mirror
 * `local-listings.test.ts` and use blanket handlers.
 */
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { delay, http, HttpResponse, type JsonBodyType } from 'msw';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { captureVendorCost, usdToMicros } from '../cost-capture.js';
import { vendorMockServer } from '../../testing/fixtures/mock-vendor.js';
import {
  VendorMalformedError,
  VendorQuotaError,
  VendorTimeoutError,
} from '../errors.js';
import {
  clampReviewText,
  createDataForSeoReviewsProvider,
  normalizeReviewRow,
  normalizeReviewRows,
  REVIEW_TEXT_MAX_CHARS,
  reviewsInputSchema,
  scrubEmailFragments,
  type DataForSeoReviewsProviderConfig,
} from './reviews.js';
import type { ReviewsSource } from '../types.js';

const FIXTURES_ROOT = join(
  dirname(fileURLToPath(import.meta.url)),
  '..',
  '..',
  'testing',
  'fixtures',
  'dataforseo-reviews',
);

function readFixture(source: ReviewsSource, name: string): JsonBodyType {
  return JSON.parse(
    readFileSync(join(FIXTURES_ROOT, source, `${name}.json`), 'utf8'),
  ) as JsonBodyType;
}

function installSuccessHandlers(source: ReviewsSource): void {
  const post = readFixture(source, 'success-post');
  const get = readFixture(source, 'success-get');
  vendorMockServer.use(
    http.get('*', () => HttpResponse.json(get)),
    http.post('*', () => HttpResponse.json(post)),
  );
}

function installBlanket(kase: 'malformed' | 'quota' | 'timeout', source: ReviewsSource): void {
  if (kase === 'timeout') {
    vendorMockServer.use(http.all('*', () => delay('infinite') as unknown as Promise<Response>));
    return;
  }
  if (kase === 'quota') {
    const body = readFixture(source, 'quota');
    vendorMockServer.use(
      http.all('*', () => HttpResponse.json(body as JsonBodyType, { status: 429 })),
    );
    return;
  }
  const body = readFixture(source, 'malformed');
  vendorMockServer.use(http.all('*', () => HttpResponse.json(body as JsonBodyType)));
}

const cfg: DataForSeoReviewsProviderConfig = {
  login: 'sandbox-login',
  password: 'sandbox-password',
  baseUrl: 'https://dataforseo.mock/v3',
  timeoutMs: 60,
  maxRetries: 0,
  backoffBaseMs: 1,
  random: () => 0,
  now: () => new Date('2026-01-01T00:00:00.000Z'),
};

const provider = createDataForSeoReviewsProvider(cfg);

const TARGET_BY_SOURCE: Record<ReviewsSource, string> = {
  google: 'place_id:ChIJexample',
  trustpilot: 'example.com',
  tripadvisor: 'location_id:12345',
};

interface ReviewsContractOptions {
  source: ReviewsSource;
  expectedRows: number;
  fixtureCostUsd: number;
}

function reviewsContractTests(opts: ReviewsContractOptions): void {
  describe(`DataForSeoReviewsProvider.getReviews[${opts.source}] — provider contract`, () => {
    beforeAll(() => vendorMockServer.listen({ onUnhandledRequest: 'error' }));
    afterEach(() => vendorMockServer.resetHandlers());
    afterAll(() => vendorMockServer.close());

    it('success: parses the recorded post + get pair to the interface shape', async () => {
      installSuccessHandlers(opts.source);
      const result = await provider.getReviews({
        source: opts.source,
        target: TARGET_BY_SOURCE[opts.source],
        depth: 10,
      });
      expect(result.source).toBe(opts.source);
      expect(result.rows).toHaveLength(opts.expectedRows);
      for (const row of result.rows) {
        expect(row.text.length).toBeLessThanOrEqual(REVIEW_TEXT_MAX_CHARS);
      }
    });

    it('timeout: rejects with VendorTimeoutError', async () => {
      installBlanket('timeout', opts.source);
      await expect(
        provider.getReviews({
          source: opts.source,
          target: TARGET_BY_SOURCE[opts.source],
          depth: 10,
        }),
      ).rejects.toBeInstanceOf(VendorTimeoutError);
    });

    it('malformed: rejects with VendorMalformedError', async () => {
      installBlanket('malformed', opts.source);
      await expect(
        provider.getReviews({
          source: opts.source,
          target: TARGET_BY_SOURCE[opts.source],
          depth: 10,
        }),
      ).rejects.toBeInstanceOf(VendorMalformedError);
    });

    it('quota: rejects with VendorQuotaError', async () => {
      installBlanket('quota', opts.source);
      await expect(
        provider.getReviews({
          source: opts.source,
          target: TARGET_BY_SOURCE[opts.source],
          depth: 10,
        }),
      ).rejects.toBeInstanceOf(VendorQuotaError);
    });

    it('captures the envelope cost via captureVendorCost', async () => {
      installSuccessHandlers(opts.source);
      const { costMicros } = await captureVendorCost(async () =>
        provider.getReviews({
          source: opts.source,
          target: TARGET_BY_SOURCE[opts.source],
          depth: 10,
        }),
      );
      expect(costMicros).toBe(usdToMicros(opts.fixtureCostUsd));
    });
  });
}

reviewsContractTests({ source: 'google', expectedRows: 2, fixtureCostUsd: 0.007 });
reviewsContractTests({ source: 'trustpilot', expectedRows: 1, fixtureCostUsd: 0.007 });
reviewsContractTests({ source: 'tripadvisor', expectedRows: 1, fixtureCostUsd: 0.009 });

describe('reviews input schema (SEC-INJECT)', () => {
  it('rejects an unsupported source', () => {
    expect(
      reviewsInputSchema.safeParse({
        source: 'yelp',
        target: 'x',
        depth: 10,
      }).success,
    ).toBe(false);
  });
  it('rejects a control-character target', () => {
    expect(
      reviewsInputSchema.safeParse({
        source: 'google',
        target: 'bad target',
        depth: 10,
      }).success,
    ).toBe(false);
  });
  it('rejects depth > 100', () => {
    expect(
      reviewsInputSchema.safeParse({
        source: 'google',
        target: 'ok',
        depth: 101,
      }).success,
    ).toBe(false);
  });
  it('accepts a well-formed input', () => {
    expect(
      reviewsInputSchema.safeParse({
        source: 'google',
        target: 'place_id:ChIJexample',
        depth: 10,
      }).success,
    ).toBe(true);
  });
});

describe('reviews normalization drops private author fields', () => {
  it('drops profile URLs, ids, emails, and photo urls', () => {
    const row = normalizeReviewRow(
      {
        review_id: 'rv-1',
        rating: { value: 5 },
        review_text: 'Contact me at reviewer@example.com for more info.',
        language_code: 'en',
        timestamp: '2026-01-05T10:00:00Z',
        profile_name: 'Jamie R.',
        // These vendor fields MUST be dropped at normalization.
        profile_url: 'https://google.com/maps/contrib/1234567890',
        user_profile: { id: 'user-123', email: 'reviewer@example.com' },
        photo_urls: ['https://example.com/p1.jpg'],
      } as unknown as Parameters<typeof normalizeReviewRow>[0],
      'fallback',
    );
    // Only interface fields survive; no `profile_url`, `user_profile`, `photo_urls`.
    expect(Object.keys(row).sort()).toEqual(
      [
        'authorDisplayName',
        'language',
        'rating',
        'reviewedAt',
        'sourceReviewId',
        'text',
        'title',
      ].sort(),
    );
    // Email inside review text is scrubbed to `[email]`.
    expect(row.text).toContain('[email]');
    expect(row.text).not.toContain('reviewer@example.com');
    expect(row.authorDisplayName).toBe('Jamie R.');
    expect(row.rating).toBe(5);
    expect(row.sourceReviewId).toBe('rv-1');
  });

  it('normalizeReviewRows tolerates missing items', () => {
    expect(normalizeReviewRows(null)).toEqual([]);
    expect(normalizeReviewRows([{ items: null }])).toEqual([]);
  });

  it('clamps text over 1000 chars', () => {
    const long = 'a'.repeat(1500);
    expect(clampReviewText(long, REVIEW_TEXT_MAX_CHARS).length).toBe(REVIEW_TEXT_MAX_CHARS);
  });

  it('normalizes empty, alternate, invalid, and bounded optional fields', () => {
    expect(clampReviewText(null, 10)).toBe('');
    expect(clampReviewText('   ', 10)).toBe('');
    expect(clampReviewText('short', 10)).toBe('short');
    const alternate = normalizeReviewRow(
      {
        id: ' alternate-id ',
        rating: { value: Number.NaN },
        title: 'x'.repeat(250),
        text: 'alternate body',
        author_name: ' Alternate author ',
        language: 'DE',
        review_datetime: 'not-a-date',
      } as unknown as Parameters<typeof normalizeReviewRow>[0],
      'fallback',
    );
    expect(alternate).toMatchObject({
      rating: null,
      text: 'alternate body',
      authorDisplayName: 'Alternate author',
      language: 'de',
      reviewedAt: null,
      sourceReviewId: 'alternate-id',
    });
    expect(alternate.title).toHaveLength(200);
    const empty = normalizeReviewRow(
      { title: ' ', timestamp: '', author_name: 42 } as unknown as Parameters<typeof normalizeReviewRow>[0],
      'fallback',
    );
    expect(empty).toMatchObject({
      rating: null,
      title: null,
      text: '',
      authorDisplayName: null,
      language: null,
      reviewedAt: null,
      sourceReviewId: 'fallback',
    });
  });

  it('scrubEmailFragments handles multiple emails', () => {
    expect(scrubEmailFragments('a@b.co and c@d.io')).toBe('[email] and [email]');
  });

  it('rating clamps out-of-range vendor values', () => {
    expect(
      normalizeReviewRow(
        { rating: { value: 7 } } as unknown as Parameters<typeof normalizeReviewRow>[0],
        'x',
      ).rating,
    ).toBe(5);
    expect(
      normalizeReviewRow(
        { rating: { value: -2 } } as unknown as Parameters<typeof normalizeReviewRow>[0],
        'x',
      ).rating,
    ).toBe(0);
  });

  it('falls back to positional id when vendor omits review_id', () => {
    const rows = normalizeReviewRows([
      {
        items: [
          { review_text: 'first' },
          { review_text: 'second' },
        ],
      },
    ]);
    expect(rows.map((r) => r.sourceReviewId)).toEqual(['row-0', 'row-1']);
  });
});

describe('reviews adapter boundary outcomes', () => {
  beforeAll(() => vendorMockServer.listen({ onUnhandledRequest: 'error' }));
  afterEach(() => vendorMockServer.resetHandlers());
  afterAll(() => vendorMockServer.close());

  const input = { source: 'google' as const, target: 'place_id:test', language: 'EN', depth: 1 };
  const post = (task: Record<string, unknown>) =>
    http.post('*', async ({ request }) => {
      expect(await request.json()).toEqual([
        { keyword: 'place_id:test', depth: 1, language_code: 'en' },
      ]);
      return HttpResponse.json({ status_code: 20000, tasks: [task] });
    });

  it('rejects empty, queued, and id-less task_post outcomes', async () => {
    vendorMockServer.use(http.post('*', () => HttpResponse.json({ status_code: 20000, tasks: [] })));
    await expect(provider.getReviews(input)).rejects.toBeInstanceOf(VendorMalformedError);
    vendorMockServer.use(post({ status_code: 40602 }));
    await expect(provider.getReviews(input)).rejects.toBeInstanceOf(VendorTimeoutError);
    vendorMockServer.use(post({ status_code: 20100 }));
    await expect(provider.getReviews(input)).rejects.toBeInstanceOf(VendorMalformedError);
  });

  it('rejects empty, queued, and unexpected task_get outcomes', async () => {
    const created = readFixture('google', 'success-post');
    for (const [task, ErrorType] of [
      [null, VendorMalformedError],
      [{ status_code: 40602 }, VendorTimeoutError],
      [{ status_code: 20100, id: 'TASK_ID' }, VendorMalformedError],
    ] as const) {
      vendorMockServer.resetHandlers();
      vendorMockServer.use(
        http.post('*', () => HttpResponse.json(created)),
        http.get('*', () => HttpResponse.json({
          status_code: 20000,
          tasks: task === null ? [] : [task],
        })),
      );
      await expect(provider.getReviews(input)).rejects.toBeInstanceOf(ErrorType);
    }
  });

  it('uses the real clock when no deterministic clock is configured', async () => {
    installSuccessHandlers('google');
    const { now: _now, ...withoutNow } = cfg;
    const realClockProvider = createDataForSeoReviewsProvider(withoutNow);
    const result = await realClockProvider.getReviews(input);
    expect(Number.isNaN(Date.parse(result.fetchedAt))).toBe(false);
  });
});

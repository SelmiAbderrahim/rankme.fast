import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@shared/api/client', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@shared/api/client')>()),
  apiClient: vi.fn(),
}));

import { apiClient } from '@shared/api/client';
import {
  createTrackedAppChart,
  fetchAppChartSubscriptions,
  fetchTrackedAppChartHistory,
  recheckTrackedAppChart,
  removeTrackedAppChart,
} from './charts-api';
import { fetchAppSeoComparison } from './compare-api';
import { fetchAppListingHistory, fetchLatestAppListing, startAppListingRun } from './listing-api';
import {
  fetchAppResearchPreview,
  fetchLatestAppResearch,
  submitAppCompetitorResearch,
  submitAppGapResearch,
  submitAppKeywordResearch,
} from './research-api';
import { fetchAppReviewRun, fetchAppReviewRuns, startAppReviewRun } from './reviews-api';
import {
  createTrackedAppKeyword,
  fetchAppKeywords,
  fetchTrackedAppKeywordHistory,
  previewMintAppKeyword,
  recheckTrackedAppKeyword,
  removeTrackedAppKeyword,
} from './tracking-api';

const mockedApiClient = vi.mocked(apiClient);

beforeEach(() => mockedApiClient.mockReset());

describe('App SEO workflow API contracts', () => {
  it('encodes keyword tracking paths, preview/confirm intent, deletes, and history', async () => {
    mockedApiClient
      .mockResolvedValueOnce({ items: [] })
      .mockResolvedValueOnce({ check: {} })
      .mockResolvedValueOnce({ keyword: { id: 'keyword-one' } })
      .mockResolvedValueOnce(undefined)
      .mockResolvedValueOnce({ queued: false })
      .mockResolvedValueOnce({ queued: true })
      .mockResolvedValueOnce({ items: [{ position: null }] });

    await fetchAppKeywords('site/one', 'profile/+');
    await previewMintAppKeyword('site/one', 'profile/+', {
      phrase: 'coffee app',
      store: 'google_play',
    });
    await expect(
      createTrackedAppKeyword('site/one', 'profile/+', {
        phrase: 'coffee app',
        store: 'google_play',
      }),
    ).resolves.toEqual({ id: 'keyword-one' });
    await removeTrackedAppKeyword('site/one', 'keyword/+');
    await recheckTrackedAppKeyword('site/one', 'keyword/+', false);
    await recheckTrackedAppKeyword('site/one', 'keyword/+', true);
    await expect(fetchTrackedAppKeywordHistory('site/one', 'keyword/+')).resolves.toEqual([
      { position: null },
    ]);

    expect(mockedApiClient.mock.calls).toEqual([
      ['/sites/site/one/apps/keywords?profileId=profile%2F%2B'],
      [
        '/sites/site/one/apps/keywords?profileId=profile%2F%2B&preview=true',
        { method: 'POST', body: { phrase: 'coffee app', store: 'google_play' } },
      ],
      [
        '/sites/site/one/apps/keywords?profileId=profile%2F%2B',
        { method: 'POST', body: { phrase: 'coffee app', store: 'google_play' } },
      ],
      ['/sites/site/one/apps/keywords/keyword%2F%2B', { method: 'DELETE' }],
      [
        '/sites/site/one/apps/keywords/keyword%2F%2B/recheck',
        { method: 'POST', body: { confirm: false } },
      ],
      [
        '/sites/site/one/apps/keywords/keyword%2F%2B/recheck',
        { method: 'POST', body: { confirm: true } },
      ],
      ['/sites/site/one/apps/keywords/keyword%2F%2B/history'],
    ]);
  });

  it('covers chart catalog, create/delete, preview/confirm, and immutable history paths', async () => {
    mockedApiClient
      .mockResolvedValueOnce({ items: [] })
      .mockResolvedValueOnce({ subscription: { id: 'chart-one' } })
      .mockResolvedValueOnce(undefined)
      .mockResolvedValueOnce({ queued: false })
      .mockResolvedValueOnce({ queued: true })
      .mockResolvedValueOnce({ items: [{ position: 7 }] });
    const input = {
      profileId: 'profile-one',
      store: 'app_store' as const,
      chartId: 'top/free',
      categoryId: 'games',
    };

    await fetchAppChartSubscriptions('site-one', 'profile/+');
    await expect(createTrackedAppChart('site-one', input)).resolves.toEqual({ id: 'chart-one' });
    await removeTrackedAppChart('site-one', 'chart/+');
    await recheckTrackedAppChart('site-one', 'chart/+', false);
    await recheckTrackedAppChart('site-one', 'chart/+', true);
    await expect(fetchTrackedAppChartHistory('site-one', 'chart/+')).resolves.toEqual([
      { position: 7 },
    ]);

    expect(mockedApiClient.mock.calls).toEqual([
      ['/sites/site-one/apps/charts?profileId=profile%2F%2B'],
      ['/sites/site-one/apps/charts', { method: 'POST', body: input }],
      ['/sites/site-one/apps/charts/chart%2F%2B', { method: 'DELETE' }],
      [
        '/sites/site-one/apps/charts/chart%2F%2B/recheck',
        { method: 'POST', body: { confirm: false } },
      ],
      [
        '/sites/site-one/apps/charts/chart%2F%2B/recheck',
        { method: 'POST', body: { confirm: true } },
      ],
      ['/sites/site-one/apps/charts/chart%2F%2B/history'],
    ]);
  });

  it('covers listing latest/history defaults, explicit bounds, and run intent', async () => {
    mockedApiClient.mockResolvedValue({ report: null });
    await fetchLatestAppListing('site/+', 'profile/+');
    await fetchAppListingHistory('site/+', 'profile/+');
    await fetchAppListingHistory('site/+', 'profile/+', 3);
    await startAppListingRun('site/+', {
      profileId: 'profile/+',
      confirm: true,
      locationCode: 2840,
      languageCode: 'en',
    });
    expect(mockedApiClient.mock.calls).toEqual([
      ['/sites/site%2F%2B/apps/listing/latest?profileId=profile%2F%2B'],
      ['/sites/site%2F%2B/apps/listing/history?profileId=profile%2F%2B&limit=12'],
      ['/sites/site%2F%2B/apps/listing/history?profileId=profile%2F%2B&limit=3'],
      [
        '/sites/site%2F%2B/apps/listing/runs',
        {
          method: 'POST',
          body: {
            profileId: 'profile/+',
            confirm: true,
            locationCode: 2840,
            languageCode: 'en',
          },
        },
      ],
    ]);
  });

  it('covers research preview variants, latest reads, and each closed-schema submission', async () => {
    mockedApiClient
      .mockResolvedValueOnce({ preview: {} })
      .mockResolvedValueOnce({ preview: {} })
      .mockResolvedValueOnce({ result: null })
      .mockResolvedValueOnce({ result: { surface: 'keywords' } })
      .mockResolvedValueOnce({ result: { surface: 'gap' } })
      .mockResolvedValueOnce({ result: { surface: 'competitors' } });
    await fetchAppResearchPreview('site-one', 'keywords', 'profile/+', 'google_play');
    await fetchAppResearchPreview('site-one', 'gap', 'profile/+', 'app_store', ['123', '456/+']);
    await fetchLatestAppResearch('site-one', 'competitors', 'profile/+', 'app_store');

    const keyword = {
      profileId: 'profile-one',
      store: 'google_play' as const,
      locationCode: 2840 as const,
      languageCode: 'en' as const,
      cursor: 0,
      pageSize: 25,
    };
    const gap = {
      profileId: 'profile-one',
      store: 'app_store' as const,
      locationCode: 2840 as const,
      languageCode: 'en' as const,
      appIds: ['123', '456'],
    };
    const competitor = {
      profileId: 'profile-one',
      store: 'google_play' as const,
      locationCode: 2840 as const,
      languageCode: 'en' as const,
    };
    await expect(submitAppKeywordResearch('site-one', keyword)).resolves.toEqual({
      surface: 'keywords',
    });
    await expect(submitAppGapResearch('site-one', gap)).resolves.toEqual({ surface: 'gap' });
    await expect(submitAppCompetitorResearch('site-one', competitor)).resolves.toEqual({
      surface: 'competitors',
    });
    expect(mockedApiClient.mock.calls).toEqual([
      ['/sites/site-one/apps/research/keywords/preview?profileId=profile%2F%2B&store=google_play'],
      [
        '/sites/site-one/apps/research/gap/preview?profileId=profile%2F%2B&store=app_store&appIds=123%2C456%2F%2B',
      ],
      ['/sites/site-one/apps/research/competitors?profileId=profile%2F%2B&store=app_store'],
      ['/sites/site-one/apps/research/keywords', { method: 'POST', body: keyword }],
      ['/sites/site-one/apps/research/gap', { method: 'POST', body: gap }],
      ['/sites/site-one/apps/research/competitors', { method: 'POST', body: competitor }],
    ]);
  });

  it('covers review list/detail/run paths and read-only comparison', async () => {
    mockedApiClient
      .mockResolvedValueOnce({ items: [] })
      .mockResolvedValueOnce({ run: { id: 'run-one' } })
      .mockResolvedValueOnce({ queued: true })
      .mockResolvedValueOnce({ profile: { id: 'profile-one' } });
    await fetchAppReviewRuns('site/+', 'profile/+', 'google_play');
    await expect(fetchAppReviewRun('site/+', 'run/+')).resolves.toEqual({ id: 'run-one' });
    const input = { profileId: 'profile-one', store: 'app_store' as const, confirm: true };
    await startAppReviewRun('site/+', input);
    await fetchAppSeoComparison('site/+', 'profile/+');
    expect(mockedApiClient.mock.calls).toEqual([
      ['/sites/site%2F%2B/apps/reviews/runs?profileId=profile%2F%2B&store=google_play'],
      ['/sites/site%2F%2B/apps/reviews/runs/run%2F%2B'],
      ['/sites/site%2F%2B/apps/reviews/runs', { method: 'POST', body: input }],
      ['/sites/site%2F%2B/apps/compare?profileId=profile%2F%2B'],
    ]);
  });
});

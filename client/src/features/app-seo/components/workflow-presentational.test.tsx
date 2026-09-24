import { render, screen } from '@testing-library/react';
import { I18nextProvider } from 'react-i18next';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { changeLanguage, i18n, initI18n } from '@shared/i18n';
import type { AppChartSubscription } from '../charts-types';
import type { AppSeoCompareParityFinding, AppSeoComparison } from '../compare-types';
import type {
  AppListingFinding,
  AppListingInfo,
  AppListingObservationMeta,
  AppListingStoreSnapshot,
} from '../listing-types';
import type { AppReviewRunDetail, AppReviewStats } from '../reviews-types';
import type { AppKeyword } from '../tracking-types';
import { AppChartHistoryChart } from './charts/AppChartHistoryChart';
import { AppComparisonHeader } from './compare/AppComparisonHeader';
import { ChartComparisonSection } from './compare/ChartComparisonSection';
import { ComparisonDeltaChip } from './compare/ComparisonDeltaChip';
import { ListingParitySection } from './compare/ListingParitySection';
import { RankComparisonSection } from './compare/RankComparisonSection';
import {
  AppListingFindingBuckets,
  AppListingNotEvaluated,
} from './listing/AppListingFindingBuckets';
import { AppListingStoreCard } from './listing/AppListingStoreCard';
import { buildResearchCsv, downloadResearchCsv } from './research/research-csv';
import { AppReviewClusters } from './reviews/AppReviewClusters';
import { AppReviewStatsView } from './reviews/AppReviewStats';
import { AppKeywordHistoryChart } from './tracking/AppKeywordHistoryChart';

const renderLocalized = (node: React.ReactNode) =>
  render(
    <I18nextProvider i18n={i18n}>
      <MemoryRouter>{node}</MemoryRouter>
    </I18nextProvider>,
  );

const checkedAt = '2026-01-02T12:00:00.000Z';

const chartSubscription: AppChartSubscription = {
  id: 'chart-subscription-1',
  profileId: 'profile-1',
  store: 'google_play',
  chartId: 'top_free',
  categoryId: 'business',
  locationCode: 2840,
  languageCode: 'en',
  latestPosition: 2,
  previousPosition: 4,
  delta: 2,
  lastCheckedAt: checkedAt,
  createdAt: checkedAt,
};

const keyword: AppKeyword = {
  id: 'keyword-1',
  profileId: 'profile-1',
  store: 'google_play',
  phrase: 'safe growth',
  locationCode: 2840,
  languageCode: 'en',
  active: true,
  latestPosition: 2,
  previousPosition: 5,
  delta: 3,
  lastCheckedAt: checkedAt,
  lastFailedCheckAt: null,
  checkStatus: 'idle',
  createdAt: checkedAt,
};

const listing = (
  store: 'google_play' | 'app_store',
  overrides: Partial<AppSeoComparison['listings']['google_play']> = {},
) => ({
  store,
  appId: store === 'google_play' ? 'com.example.app' : '123456789',
  title: store === 'google_play' ? 'Example Play' : 'Example Apple',
  url: 'https://example.com/store',
  rating: 4.5,
  reviewCount: 1234,
  capturedAt: checkedAt,
  ...overrides,
});

const comparison = (overrides: Partial<AppSeoComparison> = {}): AppSeoComparison => ({
  profile: {
    id: 'profile-1',
    paired: true,
    playPackageId: 'com.example.app',
    appStoreId: '123456789',
  },
  pairingProvenance: 'user-paired',
  listings: {
    google_play: listing('google_play'),
    app_store: listing('app_store'),
  },
  ratingDelta: 0.5,
  reviewCountDelta: -100,
  ranks: { shared: [], onlyGooglePlay: [], onlyAppStore: [] },
  listingParity: { findings: [], rawFields: [] },
  charts: [],
  ...overrides,
});

const observationMeta: AppListingObservationMeta = {
  sourceKind: 'provider_observation',
  sourceLabel: 'recorded-fixture',
  observedAt: checkedAt,
  freshUntil: null,
  freshness: 'fresh',
  market: {
    country: 'US',
    region: null,
    city: null,
    language: 'en',
    device: 'mobile',
  },
  sampleCount: 1,
  coverageNoteKey: null,
};

const listingFinding = (
  id: string,
  severity: AppListingFinding['severity'],
  status: AppListingFinding['status'] = 'finding',
): AppListingFinding => ({
  id,
  scope: 'google_play',
  status,
  severity,
  copyKey: id,
  params: id === 'title-too-long' ? { limit: 30 } : {},
  provenance: 'store-observation',
  titleKey: `appSeo.listing.findings.${id}.title`,
  whyKey: `appSeo.listing.findings.${id}.why`,
  fixKey: `appSeo.listing.findings.${id}.fix`,
  passedLabelKey: `appSeo.listing.findings.${id}.passed`,
  notEvaluatedKey: `appSeo.listing.findings.${id}.notEvaluated`,
  ...(id === 'title-too-long' ? { messageVars: { limit: 30 } } : {}),
  title: id === 'stale-update' ? 'Refresh the app listing' : `${id} title`,
  why: `${id} why`,
  fix: `${id} fix`,
  passedText: `${id} passed`,
  notEvaluatedText: id === 'stale-update'
    ? 'The last update date was not observed.'
    : `${id} not evaluated`,
});

const parityFinding = (
  id: string,
  severity: AppSeoCompareParityFinding['severity'],
  status: AppSeoCompareParityFinding['status'],
): AppSeoCompareParityFinding => ({
  id,
  status,
  severity,
  copyKey: `appSeo.listing.findings.${id}`,
  params: {},
  provenance: 'user-paired',
  titleKey: `appSeo.listing.findings.${id}.title`,
  whyKey: `appSeo.listing.findings.${id}.why`,
  fixKey: `appSeo.listing.findings.${id}.fix`,
  passedLabelKey: `appSeo.listing.findings.${id}.passed`,
  notEvaluatedKey: `appSeo.listing.findings.${id}.notEvaluated`,
  title: id === 'stores-diverge' ? 'Align the store titles' : `${id} title`,
  why: `${id} why`,
  fix: `${id} fix`,
  passedText: `${id} passed`,
  notEvaluatedText: `${id} not evaluated`,
});

const listingInfo = (overrides: Partial<AppListingInfo> = {}): AppListingInfo => ({
  store: 'google_play',
  appId: 'com.example.app',
  title: 'Example app',
  url: 'https://example.com/listing',
  iconUrl: null,
  description: 'A useful, safely rendered description.',
  rating: 4.25,
  reviewCount: 250,
  isFree: true,
  price: null,
  mainCategory: 'Business',
  categories: ['Business'],
  installs: { raw: '1,000+', lowerBound: 1000 },
  developerName: 'Example',
  developerUrl: null,
  developerWebsite: null,
  version: '1.0.0',
  minimumOsVersion: null,
  size: null,
  releasedAt: null,
  updatedAt: checkedAt,
  updateNotes: null,
  imageUrls: ['https://example.com/one.png'],
  videoUrls: null,
  languages: ['en'],
  advisories: null,
  tags: null,
  similarApps: [],
  moreByDeveloper: [],
  locationCode: 2840,
  languageCode: 'en',
  observationMeta,
  ...overrides,
});

const run = (overrides: Partial<AppReviewRunDetail> = {}): AppReviewRunDetail => ({
  id: 'review-run-1',
  profileId: 'profile-1',
  store: 'google_play',
  status: 'completed',
  clusterState: 'available',
  reviewCount: 4,
  averageRating: 4,
  createdAt: checkedAt,
  completedAt: checkedAt,
  locationCode: 2840,
  languageCode: 'en',
  stats: null,
  clusters: [],
  observationMeta: { sourceKind: 'provider_observation' },
  ...overrides,
});

beforeEach(async () => {
  initI18n({ initialLocale: 'en' });
  await changeLanguage('en');
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('App SEO history visualizations', () => {
  it('renders empty, disconnected, and single-point chart history accurately', () => {
    const view = renderLocalized(
      <AppChartHistoryChart subscription={chartSubscription} points={[]} />,
    );
    expect(screen.getByText('No chart checks have run yet.')).toBeVisible();

    view.rerender(
      <I18nextProvider i18n={i18n}>
        <MemoryRouter>
          <AppChartHistoryChart
            subscription={chartSubscription}
            points={[
              { checkedAt: '2026-01-01T00:00:00.000Z', position: 1 },
              { checkedAt: '2026-01-01T12:00:00.000Z', position: 2 },
              { checkedAt: '2026-01-02T00:00:00.000Z', position: null },
              { checkedAt: '2026-01-03T00:00:00.000Z', position: null },
              { checkedAt: '2026-01-04T00:00:00.000Z', position: 8 },
            ]}
          />
        </MemoryRouter>
      </I18nextProvider>,
    );
    expect(screen.getByRole('img', { name: /App chart position history/ })).toBeVisible();
    expect(view.container.querySelectorAll('path')).toHaveLength(2);
    expect(view.container.querySelectorAll('circle')).toHaveLength(3);
    expect(screen.getAllByText('Not in top 100')).toHaveLength(2);

    view.rerender(
      <I18nextProvider i18n={i18n}>
        <MemoryRouter>
          <AppChartHistoryChart
            subscription={chartSubscription}
            points={[{ checkedAt, position: 2 }]}
          />
        </MemoryRouter>
      </I18nextProvider>,
    );
    expect(view.container.querySelector('circle')).toHaveAttribute('cx', '340');
  });

  it('renders empty, absent, single, and multi-point keyword history', () => {
    const view = renderLocalized(<AppKeywordHistoryChart keyword={keyword} points={[]} />);
    expect(screen.getByText('No position checks have run for this keyword yet.')).toBeVisible();

    view.rerender(
      <I18nextProvider i18n={i18n}>
        <MemoryRouter>
          <AppKeywordHistoryChart
            keyword={keyword}
            points={[{ checkedAt, position: null, rankAbsolute: null, foundAppId: null }]}
          />
        </MemoryRouter>
      </I18nextProvider>,
    );
    expect(view.container.querySelector('path')).not.toBeInTheDocument();
    expect(screen.getByText('Not in checked depth')).toBeVisible();

    view.rerender(
      <I18nextProvider i18n={i18n}>
        <MemoryRouter>
          <AppKeywordHistoryChart
            keyword={keyword}
            points={[
              {
                checkedAt: '2026-01-01T00:00:00.000Z',
                position: 2,
                rankAbsolute: 2,
                foundAppId: 'app',
              },
              {
                checkedAt: '2026-01-02T00:00:00.000Z',
                position: null,
                rankAbsolute: null,
                foundAppId: null,
              },
              {
                checkedAt: '2026-01-03T00:00:00.000Z',
                position: 7,
                rankAbsolute: 7,
                foundAppId: 'app',
              },
            ]}
          />
        </MemoryRouter>
      </I18nextProvider>,
    );
    expect(
      screen.getByRole('img', { name: /Position history chart for safe growth/ }),
    ).toBeVisible();
    expect(view.container.querySelectorAll('path')).toHaveLength(2);
    expect(view.container.querySelectorAll('circle')).toHaveLength(2);

    view.rerender(
      <I18nextProvider i18n={i18n}>
        <MemoryRouter>
          <AppKeywordHistoryChart
            keyword={keyword}
            points={[{ checkedAt, position: 1, rankAbsolute: 1, foundAppId: 'app' }]}
          />
        </MemoryRouter>
      </I18nextProvider>,
    );
    expect(view.container.querySelector('circle')).toHaveAttribute('cx', '340');
  });
});

describe('App SEO paired comparison renderers', () => {
  it('labels every delta direction, including custom formatting', () => {
    renderLocalized(
      <div>
        <ComparisonDeltaChip value={null} />
        <ComparisonDeltaChip value={0} />
        <ComparisonDeltaChip value={1.25} format={(value) => `${value.toFixed(1)} pts`} />
        <ComparisonDeltaChip value={-3} className="custom-chip" />
      </div>,
    );
    expect(screen.getByText('Not observed')).toBeVisible();
    expect(screen.getByText('Even')).toBeVisible();
    expect(screen.getByText('Google Play +1.3 pts')).toBeVisible();
    expect(screen.getByText('App Store +3')).toHaveClass('custom-chip');
    expect(screen.getByText('Google Play +1.3 pts')).toHaveClass('bg-chart-2/10');
    expect(screen.getByText('App Store +3')).toHaveClass('bg-chart-5/10');
  });

  it('renders observed and unavailable listing summaries with safe links', () => {
    const observed = listing('google_play', { rating: null, reviewCount: null });
    const view = renderLocalized(
      <AppComparisonHeader
        comparison={comparison({
          listings: { google_play: observed, app_store: null },
          ratingDelta: null,
          reviewCountDelta: 0,
        })}
      />,
    );
    expect(screen.getAllByText('Not observed').length).toBeGreaterThanOrEqual(4);
    expect(screen.getByRole('link', { name: 'Open store listing' })).toHaveAttribute(
      'href',
      'https://example.com/store',
    );

    view.rerender(
      <I18nextProvider i18n={i18n}>
        <MemoryRouter>
          <AppComparisonHeader
            comparison={comparison({
              listings: {
                google_play: listing('google_play', { url: null }),
                app_store: listing('app_store', { url: 'javascript:alert(1)' }),
              },
            })}
          />
        </MemoryRouter>
      </I18nextProvider>,
    );
    expect(screen.queryByRole('link', { name: 'Open store listing' })).toHaveAttribute('href', '#');
  });

  it('renders empty and observed chart comparisons', () => {
    const view = renderLocalized(
      <ChartComparisonSection comparison={comparison()} chartsHref="/charts" />,
    );
    expect(screen.getByText('Chart positions not observed')).toBeVisible();
    expect(screen.getByRole('link', { name: 'Open chart tracking' })).toHaveAttribute(
      'href',
      '/charts',
    );

    view.rerender(
      <I18nextProvider i18n={i18n}>
        <MemoryRouter>
          <ChartComparisonSection
            chartsHref="/charts"
            comparison={comparison({
              charts: [
                {
                  chartId: 'top_free',
                  categoryId: null,
                  googlePlay: { position: 1, checkedAt },
                  appStore: { position: null, checkedAt: null },
                  delta: null,
                },
                {
                  chartId: 'top_paid',
                  categoryId: 'business',
                  googlePlay: { position: 4, checkedAt },
                  appStore: { position: 6, checkedAt },
                  delta: 2,
                },
              ],
            })}
          />
        </MemoryRouter>
      </I18nextProvider>,
    );
    expect(screen.getByText('All categories')).toBeVisible();
    expect(screen.getByText('business')).toBeVisible();
    expect(screen.getByText('Google Play +2')).toBeVisible();
  });

  it('renders missing listings and every parity value and status', () => {
    renderLocalized(
      <ListingParitySection
        listingHref="/listing"
        comparison={comparison({
          listings: { google_play: listing('google_play'), app_store: null },
          listingParity: {
            findings: [
              parityFinding('stores-diverge', 'fixNow', 'finding'),
              parityFinding('ratings-diverge', 'watch', 'passed'),
              parityFinding('categories-diverge', 'advisory', 'notEvaluated'),
            ],
            rawFields: [
              { field: 'title', googlePlay: null, appStore: 'Name', matches: null },
              {
                field: 'categories',
                googlePlay: ['One', 'Two'],
                appStore: ['One', 'Two'],
                matches: true,
              },
              { field: 'version', googlePlay: 2, appStore: 3, matches: false },
            ],
          },
        })}
      />,
    );
    expect(screen.getByText('One or both listings not observed')).toBeVisible();
    expect(
      screen.getByText('Align the store titles'),
    ).toBeVisible();
    expect(screen.getByText('Different')).toBeVisible();
    expect(screen.getByText('Aligned')).toBeVisible();
    expect(screen.getAllByText('Not compared').length).toBeGreaterThanOrEqual(2);
    expect(screen.getAllByText('One, Two')).toHaveLength(2);
  });

  it('renders all keyword-rank evidence states and market fallbacks', () => {
    const view = renderLocalized(
      <RankComparisonSection comparison={comparison()} keywordsHref="/keywords" />,
    );
    expect(screen.getByText('Keyword ranks not observed')).toBeVisible();

    view.rerender(
      <I18nextProvider i18n={i18n}>
        <MemoryRouter>
          <RankComparisonSection
            keywordsHref="/keywords"
            comparison={comparison({
              ranks: {
                shared: [],
                onlyGooglePlay: [
                  {
                    phrase: 'play only',
                    locationCode: 2840,
                    languageCode: 'en',
                    position: null,
                    checkedAt: null,
                  },
                ],
                onlyAppStore: [],
              },
            })}
          />
        </MemoryRouter>
      </I18nextProvider>,
    );
    expect(screen.getByText('No shared tracked phrases')).toBeVisible();
    expect(screen.getByText('play only')).toBeVisible();
    expect(screen.getByText('No store-only phrases.')).toBeVisible();

    view.rerender(
      <I18nextProvider i18n={i18n}>
        <MemoryRouter>
          <RankComparisonSection
            keywordsHref="/keywords"
            comparison={comparison({
              ranks: {
                shared: [
                  {
                    phrase: 'shared phrase',
                    locationCode: 999999,
                    languageCode: '_',
                    googlePlay: { position: 3, checkedAt },
                    appStore: { position: null, checkedAt: null },
                    delta: null,
                  },
                ],
                onlyGooglePlay: [
                  {
                    phrase: 'play only',
                    locationCode: 2840,
                    languageCode: 'en',
                    position: 5,
                    checkedAt,
                  },
                ],
                onlyAppStore: [
                  {
                    phrase: 'apple only',
                    locationCode: 2840,
                    languageCode: 'en',
                    position: 7,
                    checkedAt,
                  },
                ],
              },
            })}
          />
        </MemoryRouter>
      </I18nextProvider>,
    );
    expect(screen.getByText('shared phrase')).toBeVisible();
    expect(screen.getByText(/Unknown country · Unknown language/)).toBeVisible();
    expect(screen.getByText('apple only')).toBeVisible();
  });
});

describe('App listing evidence renderers', () => {
  it('groups active findings by severity and separates unavailable evidence', () => {
    const view = renderLocalized(<AppListingFindingBuckets findings={[]} />);
    expect(screen.getByText('No changes are needed in this bucket.')).toBeVisible();

    const findings = [
      listingFinding('title-too-long', 'fixNow'),
      listingFinding('rating-low', 'watch'),
      listingFinding('description-missing', 'advisory'),
      listingFinding('screenshots-few', 'watch', 'passed'),
      listingFinding('stale-update', 'advisory', 'notEvaluated'),
    ];
    view.rerender(
      <I18nextProvider i18n={i18n}>
        <MemoryRouter>
          <AppListingFindingBuckets findings={findings} />
        </MemoryRouter>
      </I18nextProvider>,
    );
    expect(screen.getAllByText(/Fix now/).length).toBeGreaterThanOrEqual(2);
    expect(screen.getAllByText(/Watch/).length).toBeGreaterThanOrEqual(2);
    expect(screen.getAllByText(/Advisory/).length).toBeGreaterThanOrEqual(2);
    expect(screen.queryByText('Add more screenshots')).not.toBeInTheDocument();

    const pending = renderLocalized(<AppListingNotEvaluated findings={findings} />);
    expect(screen.getByText('Checks not evaluated')).toBeVisible();
    expect(screen.getByText(/The last update date was not observed/)).toBeVisible();
    pending.rerender(
      <I18nextProvider i18n={i18n}>
        <MemoryRouter>
          <AppListingNotEvaluated findings={[]} />
        </MemoryRouter>
      </I18nextProvider>,
    );
    expect(screen.queryByText('Checks not evaluated')).not.toBeInTheDocument();
  });

  it('renders missing and rich store observations while rejecting unsafe URLs', () => {
    const view = renderLocalized(
      <AppListingStoreCard store="app_store" snapshot={null} findings={[]} notes={[]} />,
    );
    expect(screen.getAllByText('Store not observed').length).toBeGreaterThanOrEqual(1);

    const unsafeSnapshot: AppListingStoreSnapshot = {
      store: 'google_play',
      listing: listingInfo({
        url: 'javascript:alert(1)',
        rating: null,
        mainCategory: null,
        installs: null,
        imageUrls: [
          'javascript:alert(1)',
          'https://example.com/1.png',
          'https://example.com/2.png',
          'https://example.com/3.png',
          'https://example.com/4.png',
          'https://example.com/5.png',
          'https://example.com/6.png',
        ],
      }),
      observationMeta,
    };
    view.rerender(
      <I18nextProvider i18n={i18n}>
        <MemoryRouter>
          <AppListingStoreCard
            store="google_play"
            snapshot={unsafeSnapshot}
            findings={[
              listingFinding('title-too-long', 'fixNow'),
              listingFinding('stale-update', 'advisory', 'notEvaluated'),
            ]}
            notes={[
              { store: 'google_play', field: 'listing', copyKey: 'storeFailed', messageKey: 'appSeo.listing.notObserved.storeFailed', message: 'Store listing was not observed.' },
              { store: 'google_play', field: 'screenshots', copyKey: 'screenshots', messageKey: 'appSeo.listing.notObserved.screenshots', message: 'Screenshots were not observed.' },
            ]}
          />
        </MemoryRouter>
      </I18nextProvider>,
    );
    expect(screen.queryByRole('link', { name: 'Open store listing' })).not.toBeInTheDocument();
    expect(screen.getAllByRole('link', { name: /Screenshot link/ })).toHaveLength(5);
    expect(screen.getByText('2 more screenshot links')).toBeVisible();
    expect(screen.getAllByText('Not observed').length).toBeGreaterThanOrEqual(3);
    expect(screen.getByText('Evidence not observed')).toBeVisible();

    view.rerender(
      <I18nextProvider i18n={i18n}>
        <MemoryRouter>
          <AppListingStoreCard
            store="google_play"
            snapshot={{
              store: 'google_play',
              listing: listingInfo({
                description: null,
                reviewCount: null,
                updatedAt: null,
                imageUrls: [],
              }),
              observationMeta,
            }}
            findings={[]}
            notes={[]}
          />
        </MemoryRouter>
      </I18nextProvider>,
    );
    expect(screen.getByRole('link', { name: 'Open store listing' })).toHaveAttribute(
      'href',
      'https://example.com/listing',
    );
    expect(screen.queryByText(/more screenshot links/)).not.toBeInTheDocument();
  });
});

describe('App review evidence renderers', () => {
  const stats = (overrides: Partial<AppReviewStats> = {}): AppReviewStats => ({
    total: 12,
    averageRating: 4.2,
    histogram: [
      { star: 5, count: 8 },
      { star: 1, count: 1 },
    ],
    ratingMix: { positive: 8, neutral: 2, negative: 2 },
    volumeTrend: [
      { period: '2026-01', count: 4, averageRating: 4.5 },
      { period: '2026-02', count: 8, averageRating: 4 },
    ],
    ...overrides,
  });

  it('renders empty, single-point, and multi-point review statistics', () => {
    const view = renderLocalized(
      <AppReviewStatsView stats={stats({ averageRating: null, histogram: [], volumeTrend: [] })} />,
    );
    expect(screen.getByText('Not available')).toBeVisible();
    expect(screen.getByText('No dated reviews were returned for this run.')).toBeVisible();

    view.rerender(
      <I18nextProvider i18n={i18n}>
        <MemoryRouter>
          <AppReviewStatsView
            stats={stats({ volumeTrend: [{ period: '2026-01', count: 4, averageRating: 4 }] })}
          />
        </MemoryRouter>
      </I18nextProvider>,
    );
    expect(screen.getByRole('img', { name: 'Review volume over time' })).toBeVisible();
    expect(view.container.querySelectorAll('circle')).toHaveLength(1);

    view.rerender(
      <I18nextProvider i18n={i18n}>
        <MemoryRouter>
          <AppReviewStatsView stats={stats()} />
        </MemoryRouter>
      </I18nextProvider>,
    );
    expect(view.container.querySelectorAll('circle')).toHaveLength(2);
    expect(screen.getByText('4.2')).toBeVisible();
  });

  it('renders pending, thin, unavailable, and cited cluster evidence', () => {
    const view = renderLocalized(<AppReviewClusters run={run({ clusterState: 'pending' })} />);
    expect(screen.getByText('The review evidence is still being processed.')).toBeVisible();

    view.rerender(
      <I18nextProvider i18n={i18n}>
        <MemoryRouter>
          <AppReviewClusters run={run({ clusterState: 'thin_evidence' })} />
        </MemoryRouter>
      </I18nextProvider>,
    );
    expect(screen.getByText('Not enough evidence to cluster')).toBeVisible();

    view.rerender(
      <I18nextProvider i18n={i18n}>
        <MemoryRouter>
          <AppReviewClusters run={run({ clusterState: 'unavailable' })} />
        </MemoryRouter>
      </I18nextProvider>,
    );
    expect(screen.getByText('Clusters unavailable')).toBeVisible();

    view.rerender(
      <I18nextProvider i18n={i18n}>
        <MemoryRouter>
          <AppReviewClusters
            run={run({
              clusters: (['positive', 'negative', 'mixed', 'neutral'] as const).map(
                (sentiment, index) => ({
                  label: `${sentiment} theme`,
                  sentiment,
                  citedReviewIds: [`review-${index}`],
                  citations: [
                    {
                      reviewId: `review-${index}`,
                      quote: `Evidence ${index}`,
                      authorName: index === 0 ? 'Named reviewer' : null,
                      rating: 5 - index,
                      at: index === 0 ? checkedAt : null,
                    },
                  ],
                  observationMeta: { sourceKind: 'ai_interpretation' },
                }),
              ),
            })}
          />
        </MemoryRouter>
      </I18nextProvider>,
    );
    expect(screen.getByText('Named reviewer', { exact: false })).toBeVisible();
    expect(screen.getAllByText(/Anonymous reviewer/)).toHaveLength(3);
    expect(screen.getAllByText('AI interpretation')).toHaveLength(4);
  });
});

describe('App research CSV safety', () => {
  it('neutralizes formula cells through the shared CSV serializer', () => {
    const csv = buildResearchCsv(
      [{ keyword: '=HYPERLINK("https://evil.test")', rank: 1 }],
      [
        { key: 'keyword', header: '+keyword' },
        { key: 'rank', header: 'rank' },
      ],
    );
    expect(csv).toContain("'+keyword");
    expect(csv).toContain("'=HYPERLINK");
  });

  it('returns false without object URLs and downloads a generated object URL when supported', async () => {
    const originalCreateObjectUrl = URL.createObjectURL;
    const originalRevokeObjectUrl = URL.revokeObjectURL;
    Object.defineProperty(URL, 'createObjectURL', { configurable: true, value: undefined });
    expect(downloadResearchCsv('blocked.csv', 'a,b')).toBe(false);

    const createObjectUrl = vi.fn(() => 'blob:research');
    const revokeObjectUrl = vi.fn();
    Object.defineProperty(URL, 'createObjectURL', { configurable: true, value: createObjectUrl });
    Object.defineProperty(URL, 'revokeObjectURL', { configurable: true, value: revokeObjectUrl });
    const click = vi
      .spyOn(HTMLAnchorElement.prototype, 'click')
      .mockImplementation(() => undefined);
    expect(downloadResearchCsv('research.csv', 'a,b')).toBe(true);
    expect(createObjectUrl).toHaveBeenCalledOnce();
    expect(click).toHaveBeenCalledOnce();
    expect(revokeObjectUrl).toHaveBeenCalledWith('blob:research');

    Object.defineProperty(URL, 'createObjectURL', {
      configurable: true,
      value: originalCreateObjectUrl,
    });
    Object.defineProperty(URL, 'revokeObjectURL', {
      configurable: true,
      value: originalRevokeObjectUrl,
    });
  });
});

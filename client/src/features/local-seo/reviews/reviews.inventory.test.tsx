/**
 * URL-backed inventory filters, pagination, and the free CSV export
 *.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ReactNode } from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { configureStore } from '@reduxjs/toolkit';
import { Provider } from 'react-redux';
import { I18nextProvider } from 'react-i18next';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import { apiClient } from '@shared/api/client';
import { changeLanguage, i18n, initI18n } from '@shared/i18n';
import type { AuthSessionState } from '@features/auth';
import { ReviewInventoryTable, clampReviewText } from './components/ReviewInventoryTable';
import { ReviewsPanel } from './components/ReviewsPanel';
import {
  hasActiveReviewFilter,
  isReviewSourceName,
  normalizeReviewParams,
  readReviewFilters,
  writeReviewFilters,
} from './filters';
import { REVIEW_CSV_COLUMNS, buildReviewCsv, downloadCsv } from './csv';
import { localSeoReviewsReducer } from './store/slice';
import { REVIEW_ROW_TEXT_MAX_CHARS } from './types';
import { inventoryResponse, reviewRow, reviewSource, reviewStats, reviewThemes } from './__fixtures__/reviews';

let authState: AuthSessionState = {
  authenticated: true,
  isPending: false,
  emailVerified: true,
  user: null,
};

vi.mock('@features/auth', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@features/auth')>()),
  useAuthSession: () => authState,
}));

vi.mock('@shared/api/client', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@shared/api/client')>()),
  apiClient: vi.fn(),
}));

const mockedApiClient = vi.mocked(apiClient);

const LocationProbe = () => {
  const location = useLocation();
  return <span data-testid="location">{`${location.pathname}${location.search}`}</span>;
};

const renderAt = (node: ReactNode, entry: string) => {
  const store = configureStore({ reducer: { localSeoReviews: localSeoReviewsReducer } });
  return render(
    <Provider store={store}>
      <I18nextProvider i18n={i18n}>
        <MemoryRouter initialEntries={[entry]}>
          <Routes>
            <Route
              path="/sites/:siteId"
              element={
                <>
                  {node}
                  <LocationProbe />
                </>
              }
            />
          </Routes>
        </MemoryRouter>
      </I18nextProvider>
    </Provider>,
  );
};

const wireInventory = (response = inventoryResponse()) => {
  mockedApiClient.mockImplementation(async (path: string) => {
    if (path.startsWith('/local-seo/reviews/sources')) {
      return { sources: [reviewSource()] } as never;
    }
    if (path.startsWith('/local-seo/reviews/export.csv')) {
      return buildReviewCsv(response.reviews) as never;
    }
    if (path.startsWith('/local-seo/reviews/runs/')) return undefined as never;
    if (path.startsWith('/local-seo/reviews/runs')) {
      return { runs: [], nextCursor: null } as never;
    }
    if (path.startsWith('/local-seo/reviews/stats/')) return reviewStats() as never;
    if (path.startsWith('/local-seo/reviews/themes/')) return reviewThemes() as never;
    if (path.startsWith('/local-seo/reviews/reviews')) return response as never;
    throw new Error(`unexpected ${path}`);
  });
};

beforeEach(async () => {
  initI18n({ initialLocale: 'en' });
  await changeLanguage('en');
  mockedApiClient.mockReset();
  authState = { authenticated: true, isPending: false, emailVerified: true, user: null };
});

describe('review filter helpers', () => {
  it('reads every supported param', () => {
    const params = new URLSearchParams(
      'src=trustpilot&rating=4&q=%20clean%20&sort=source&page=3',
    );
    expect(readReviewFilters(params)).toEqual({
      src: 'trustpilot',
      rating: 4,
      q: 'clean',
      sort: 'source',
      page: 3,
    });
  });

  it('falls back to no-filter, page one on nonsense values', () => {
    const params = new URLSearchParams('src=yelp&rating=9&q=&page=0');
    expect(readReviewFilters(params)).toEqual({ sort: 'newest', page: 1 });
    expect(readReviewFilters(new URLSearchParams('rating=abc&page=xyz'))).toEqual({
      sort: 'newest',
      page: 1,
    });
  });

  it('clamps an over-long query', () => {
    const params = new URLSearchParams();
    params.set('q', 'x'.repeat(400));
    expect(readReviewFilters(params).q).toHaveLength(120);
  });

  it('normalizes invalid filters and run ids while preserving unrelated params', () => {
    const params = new URLSearchParams(
      'tab=reviews&src=yelp&rating=9&q=%20clean%20&sort=wrong&page=0&run=BAD&utm=sweep',
    );
    expect(normalizeReviewParams(params).toString()).toBe(
      'tab=reviews&q=clean&utm=sweep',
    );
  });

  it('resets the page whenever a non-paging filter changes', () => {
    const params = new URLSearchParams('page=5&tab=reviews');
    expect(writeReviewFilters(params, { src: 'google' }).toString()).toBe('tab=reviews&src=google');
  });

  it('clears params rather than writing empty values', () => {
    const params = new URLSearchParams('src=google&rating=5&q=clean&page=4');
    const next = writeReviewFilters(params, { src: null, rating: null, q: '   ' });
    expect(next.toString()).toBe('');
  });

  it('drops `page` for page one and writes it otherwise', () => {
    expect(writeReviewFilters(new URLSearchParams('page=4'), { page: 1 }).toString()).toBe('');
    expect(writeReviewFilters(new URLSearchParams(), { page: 7 }).toString()).toBe('page=7');
    expect(writeReviewFilters(new URLSearchParams(), { q: 'clean' }).toString()).toBe('q=clean');
    expect(
      writeReviewFilters(new URLSearchParams(), { rating: 3 }).toString(),
    ).toBe('rating=3');
    expect(
      writeReviewFilters(new URLSearchParams('sort=source&page=4'), {
        sort: 'newest',
      }).toString(),
    ).toBe('');
  });

  it('caps a written query at the same bound as the read side', () => {
    expect(writeReviewFilters(new URLSearchParams(), { q: 'y'.repeat(400) }).get('q')).toHaveLength(
      120,
    );
  });

  it('recognizes only shipped source names', () => {
    expect(isReviewSourceName('google')).toBe(true);
    expect(isReviewSourceName('yelp')).toBe(false);
    expect(isReviewSourceName(42)).toBe(false);
  });

  it('knows when a filter is active', () => {
    expect(hasActiveReviewFilter({ page: 1 })).toBe(false);
    expect(hasActiveReviewFilter({ page: 1, rating: 5 })).toBe(true);
  });
});

describe('inventory table', () => {
  it('normalizes invalid URL values in the rendered workspace and preserves unrelated params', async () => {
    wireInventory();
    renderAt(
      <ReviewsPanel siteId="site-1" />,
      '/sites/site-1?tab=reviews&src=yelp&rating=9&q=%20clean%20&sort=wrong&page=0&run=BAD&utm=sweep',
    );

    await waitFor(() =>
      expect(screen.getByTestId('location')).toHaveTextContent(
        '/sites/site-1?tab=reviews&q=clean&utm=sweep',
      ),
    );
  });

  it('rehydrates filters from the URL on first render', async () => {
    wireInventory();
    renderAt(
      <ReviewsPanel siteId="site-1" />,
      '/sites/site-1?tab=reviews&src=trustpilot&rating=4&q=clean&sort=source&page=2',
    );
    await waitFor(() =>
      expect(mockedApiClient).toHaveBeenCalledWith(
        '/local-seo/reviews/reviews?profileId=site-1&page=2&src=trustpilot&rating=4&q=clean&sort=source',
        expect.anything(),
      ),
    );
    expect(await screen.findByTestId('reviews-filter-source')).toHaveTextContent('Trustpilot');
    expect(screen.getByTestId('reviews-filter-rating')).toHaveTextContent('4 stars');
    expect(screen.getByTestId('reviews-filter-query')).toHaveValue('clean');
    expect(screen.getByRole('columnheader', { name: 'Source' })).toHaveAttribute(
      'aria-sort',
      'ascending',
    );
  });

  it('writes a source filter into the URL and resets the page', async () => {
    const user = userEvent.setup();
    wireInventory();
    renderAt(<ReviewsPanel siteId="site-1" />, '/sites/site-1?tab=reviews&page=4');
    await user.click(await screen.findByTestId('reviews-filter-source'));
    await user.click(await screen.findByRole('option', { name: 'Google' }));
    await waitFor(() =>
      expect(screen.getByTestId('location')).toHaveTextContent('tab=reviews&src=google'),
    );
    expect(screen.getByTestId('location')).not.toHaveTextContent('page=4');
  });

  it('clears the source filter when "All" is chosen', async () => {
    const user = userEvent.setup();
    wireInventory();
    renderAt(<ReviewsPanel siteId="site-1" />, '/sites/site-1?tab=reviews&src=google');
    await user.click(await screen.findByTestId('reviews-filter-source'));
    await user.click(await screen.findByRole('option', { name: 'All' }));
    await waitFor(() => expect(screen.getByTestId('location')).not.toHaveTextContent('src='));
  });

  it('writes and clears the rating filter', async () => {
    const user = userEvent.setup();
    wireInventory();
    renderAt(<ReviewsPanel siteId="site-1" />, '/sites/site-1?tab=reviews');
    await user.click(await screen.findByTestId('reviews-filter-rating'));
    await user.click(await screen.findByRole('option', { name: '5 stars' }));
    await waitFor(() => expect(screen.getByTestId('location')).toHaveTextContent('rating=5'));
    await user.click(screen.getByTestId('reviews-filter-rating'));
    await user.click(await screen.findByRole('option', { name: 'All' }));
    await waitFor(() => expect(screen.getByTestId('location')).not.toHaveTextContent('rating='));
  });

  it('writes sorting into the URL, resets paging, and sends it to the server', async () => {
    const user = userEvent.setup();
    wireInventory();
    renderAt(<ReviewsPanel siteId="site-1" />, '/sites/site-1?tab=reviews&page=4');
    await user.click(await screen.findByTestId('reviews-sort'));
    await user.click(await screen.findByRole('option', { name: 'Highest rating' }));
    await waitFor(() =>
      expect(screen.getByTestId('location')).toHaveTextContent(
        'tab=reviews&sort=rating-high',
      ),
    );
    expect(screen.getByTestId('location')).not.toHaveTextContent('page=4');
    await waitFor(() =>
      expect(mockedApiClient).toHaveBeenCalledWith(
        '/local-seo/reviews/reviews?profileId=site-1&page=1&sort=rating-high',
        expect.anything(),
      ),
    );
  });

  it('submits the text search and clears every filter again', async () => {
    const user = userEvent.setup();
    wireInventory();
    renderAt(<ReviewsPanel siteId="site-1" />, '/sites/site-1?tab=reviews&src=google');
    await user.type(await screen.findByTestId('reviews-filter-query'), 'spotless');
    await user.click(screen.getByTestId('reviews-filter-apply'));
    await waitFor(() => expect(screen.getByTestId('location')).toHaveTextContent('q=spotless'));
    await user.click(screen.getByTestId('reviews-filter-clear'));
    await waitFor(() => expect(screen.getByTestId('location')).toHaveTextContent('?tab=reviews'));
  });

  it('pages forward and back through the URL', async () => {
    const user = userEvent.setup();
    wireInventory(inventoryResponse({ total: 120, hasMore: true }));
    renderAt(<ReviewsPanel siteId="site-1" />, '/sites/site-1?tab=reviews');
    await user.click(await screen.findByTestId('reviews-page-next'));
    await waitFor(() => expect(screen.getByTestId('location')).toHaveTextContent('page=2'));
    await user.click(screen.getByTestId('reviews-page-previous'));
    await waitFor(() => expect(screen.getByTestId('location')).not.toHaveTextContent('page='));
  });

  it('separates "nothing stored" from "nothing matches the filter"', async () => {
    wireInventory(inventoryResponse({ reviews: [], total: 0 }));
    const { unmount } = renderAt(
      <ReviewsPanel siteId="site-1" />,
      '/sites/site-1?tab=reviews',
    );
    expect(await screen.findByTestId('reviews-inventory-empty')).toHaveTextContent(
      'No reviews stored yet.',
    );
    unmount();
    renderAt(<ReviewsPanel siteId="site-1" />, '/sites/site-1?tab=reviews&rating=1');
    expect(await screen.findByTestId('reviews-inventory-no-matches')).toHaveTextContent(
      'No reviews match these filters.',
    );
  });

  it('renders a loading skeleton before the first page lands', () => {
    render(
      <Provider store={configureStore({ reducer: { localSeoReviews: localSeoReviewsReducer } })}>
        <I18nextProvider i18n={i18n}>
          <MemoryRouter>
            <ReviewInventoryTable
              profileId="site-1"
              filters={{ page: 1 }}
              data={null}
              status="loading"
              error=""
            />
          </MemoryRouter>
        </I18nextProvider>
      </Provider>,
    );
    expect(screen.getByTestId('reviews-inventory-loading')).toHaveAttribute('aria-busy', 'true');
  });

  it('renders rating, date, source, text and author, newest-first as served', async () => {
    wireInventory(
      inventoryResponse({
        reviews: [
          reviewRow(),
          reviewRow({
            id: 'row-2',
            rating: null,
            reviewedAt: null,
            authorDisplayName: null,
            title: null,
            source: 'tripadvisor',
          }),
        ],
        total: 2,
      }),
    );
    renderAt(<ReviewsPanel siteId="site-1" />, '/sites/site-1?tab=reviews');
    expect(await screen.findByTestId('reviews-row-row-1')).toHaveTextContent('Sam');
    const second = screen.getByTestId('reviews-row-row-2');
    expect(second).toHaveTextContent('No rating');
    expect(second).toHaveTextContent('No name');
    expect(second).toHaveTextContent('Tripadvisor');
  });

  it('clamps a long row text in the cell', () => {
    const long = 'a'.repeat(REVIEW_ROW_TEXT_MAX_CHARS + 50);
    expect(clampReviewText(long)).toHaveLength(REVIEW_ROW_TEXT_MAX_CHARS + 1);
    expect(clampReviewText('short')).toBe('short');
  });
});

describe('CSV export', () => {
  it('serializes the visible rows through the shared neutralizer', () => {
    const csv = buildReviewCsv([
      reviewRow({
        text: '=SUM(A1)',
        title: null,
        authorDisplayName: null,
        rating: null,
        reviewedAt: null,
      }),
    ]);
    expect(REVIEW_CSV_COLUMNS.map((column) => column.header)).toEqual([
      'rating',
      'reviewed_at',
      'source',
      'title',
      'text',
      'author',
    ]);
    expect(csv).toContain("'=SUM(A1)");
    expect(csv).not.toMatch(/,=SUM/);
  });

  it('downloads the file when the browser supports object URLs', async () => {
    const user = userEvent.setup();
    const createObjectURL = vi.fn(() => 'blob:reviews');
    const revokeObjectURL = vi.fn();
    vi.stubGlobal('URL', Object.assign(URL, { createObjectURL, revokeObjectURL }));
    const click = vi
      .spyOn(HTMLAnchorElement.prototype, 'click')
      .mockImplementation(() => undefined);
    wireInventory();
    renderAt(<ReviewsPanel siteId="site-1" />, '/sites/site-1?tab=reviews');
    await user.click(await screen.findByTestId('reviews-export'));
    await waitFor(() => expect(createObjectURL).toHaveBeenCalledOnce());
    expect(mockedApiClient).toHaveBeenCalledWith(
      '/local-seo/reviews/export.csv?profileId=site-1',
      {
        localeMode: 'artifact',
        allowLegacyNullContentLanguage: true,
        headers: { Accept: 'text/csv' },
      },
    );
    expect(click).toHaveBeenCalledOnce();
    expect(revokeObjectURL).toHaveBeenCalledWith('blob:reviews');
    click.mockRestore();
    vi.unstubAllGlobals();
  });

  it('reports an export failure without disturbing the stored inventory', async () => {
    const user = userEvent.setup();
    wireInventory();
    mockedApiClient.mockImplementation(async (path: string) => {
      if (path.startsWith('/local-seo/reviews/export.csv')) throw new Error('offline');
      if (path.startsWith('/local-seo/reviews/sources')) {
        return { sources: [reviewSource()] } as never;
      }
      if (path.startsWith('/local-seo/reviews/runs/')) return undefined as never;
      if (path.startsWith('/local-seo/reviews/runs')) {
        return { runs: [], nextCursor: null } as never;
      }
      if (path.startsWith('/local-seo/reviews/stats/')) return reviewStats() as never;
      if (path.startsWith('/local-seo/reviews/themes/')) return reviewThemes() as never;
      if (path.startsWith('/local-seo/reviews/reviews')) return inventoryResponse() as never;
      throw new Error(`unexpected ${path}`);
    });
    renderAt(<ReviewsPanel siteId="site-1" />, '/sites/site-1?tab=reviews');
    await user.click(await screen.findByTestId('reviews-export'));
    expect(await screen.findByTestId('reviews-export-error')).toHaveTextContent(
      'We could not prepare the CSV. Try again.',
    );
    expect(screen.getByTestId('reviews-row-row-1')).toBeVisible();
  });

  it('reports when the runtime cannot create a download URL', async () => {
    const user = userEvent.setup();
    const original = URL.createObjectURL;
    // @ts-expect-error — deliberate runtime capability probe.
    URL.createObjectURL = undefined;
    try {
      wireInventory();
      renderAt(<ReviewsPanel siteId="site-1" />, '/sites/site-1?tab=reviews');
      await user.click(await screen.findByTestId('reviews-export'));
      expect(await screen.findByTestId('reviews-export-error')).toHaveTextContent(
        'We could not prepare the CSV. Try again.',
      );
    } finally {
      URL.createObjectURL = original;
    }
  });

  it('is a no-op where object URLs are unavailable', () => {
    const original = URL.createObjectURL;
    // @ts-expect-error — deliberately removing the API to exercise the guard.
    URL.createObjectURL = undefined;
    expect(downloadCsv('reviews.csv', 'a,b')).toBe(false);
    URL.createObjectURL = original;
  });
});

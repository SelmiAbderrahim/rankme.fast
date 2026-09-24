/**
 * Remaining Review Intelligence branches: contiguous trend segments, the
 * depth input, whitespace-only source submits, a run with no per-source
 * bookkeeping yet, unlimited/over-cap preview shapes, and the two refusal
 * sources the panel reads that the happy-path suites do not reach.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ReactNode } from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { configureStore } from '@reduxjs/toolkit';
import { Provider } from 'react-redux';
import { I18nextProvider } from 'react-i18next';
import { MemoryRouter } from 'react-router-dom';
import { ApiError, apiClient } from '@shared/api/client';
import { changeLanguage, i18n, initI18n } from '@shared/i18n';
import type { AuthSessionState } from '@features/auth';
import { ReviewRunList } from './components/ReviewRunList';
import { ReviewSourcesPanel } from './components/ReviewSourcesPanel';
import { ReviewThemeCards } from './components/ReviewThemeCards';
import { ReviewTrendChart } from './components/ReviewTrendChart';
import { ReviewsPanel } from './components/ReviewsPanel';
import { addReviewSource } from './store/thunks';
import { initialReviewIntelligenceState, localSeoReviewsReducer } from './store/slice';
import {
  inventoryResponse,
  reviewRun,
  reviewSource,
  reviewStats,
  reviewThemes,
  spendPreview,
} from './__fixtures__/reviews';

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

const renderNode = (node: ReactNode, entry = '/sites/site-1?tab=reviews') =>
  render(
    <Provider store={configureStore({ reducer: { localSeoReviews: localSeoReviewsReducer } })}>
      <I18nextProvider i18n={i18n}>
        <MemoryRouter initialEntries={[entry]}>{node}</MemoryRouter>
      </I18nextProvider>
    </Provider>,
  );

/** Baseline reads so the panel mounts; per-test overrides win by ordering. */
const baseWire = (over: (path: string) => unknown = () => undefined) => {
  mockedApiClient.mockImplementation(async (path: string) => {
    const custom = over(path);
    if (custom !== undefined) return custom as never;
    if (path.startsWith('/local-seo/reviews/sources')) {
      return { sources: [reviewSource()] } as never;
    }
    if (path.startsWith('/local-seo/reviews/runs/')) return reviewRun() as never;
    if (path.startsWith('/local-seo/reviews/runs')) {
      return { runs: [], nextCursor: null } as never;
    }
    if (path.startsWith('/local-seo/reviews/stats/')) return reviewStats() as never;
    if (path.startsWith('/local-seo/reviews/themes/')) return reviewThemes() as never;
    if (path.startsWith('/local-seo/reviews/reviews')) {
      return inventoryResponse({ reviews: [], total: 0 }) as never;
    }
    throw new Error(`unexpected ${path}`);
  });
};

beforeEach(async () => {
  initI18n({ initialLocale: 'en' });
  await changeLanguage('en');
  mockedApiClient.mockReset();
  authState = { authenticated: true, isPending: false, emailVerified: true, user: null };
});

describe('trend chart with contiguous months', () => {
  it('draws a polyline across consecutive months and dots on isolated ones', () => {
    const { container } = renderNode(
      <ReviewTrendChart
        buckets={[
          { ymKey: '2026-01', total: 4, perSource: { google: 4, trustpilot: null, tripadvisor: null } },
          { ymKey: '2026-02', total: 5, perSource: { google: 5, trustpilot: null, tripadvisor: null } },
          { ymKey: '2026-03', total: null, perSource: { google: null, trustpilot: null, tripadvisor: null } },
          { ymKey: '2026-04', total: 2, perSource: { google: 2, trustpilot: null, tripadvisor: null } },
        ]}
      />,
    );
    const totalSeries = container.querySelector('[data-series="total"]');
    expect(totalSeries?.querySelectorAll('polyline')).toHaveLength(1);
    expect(totalSeries?.querySelectorAll('circle')).toHaveLength(3);
    // A source with no rating in any month draws nothing at all.
    expect(
      container.querySelector('[data-series="tripadvisor"]')?.querySelectorAll('circle'),
    ).toHaveLength(0);
  });
});

describe('run list edges', () => {
  it('shows an em dash before per-source bookkeeping exists', () => {
    renderNode(
      <ReviewRunList
        runs={[reviewRun({ status: 'queued', perSourceOutcomes: [], aiTerminalState: 'pending' })]}
        status="succeeded"
        error=""
        selectedRunId={null}
        onSelect={() => undefined}
      />,
    );
    expect(screen.getByTestId('reviews-run-row-run-1')).toHaveTextContent('—');
    expect(screen.getByTestId('reviews-run-row-run-1')).toHaveTextContent('Waiting');
  });

  it('renders a skeleton before the first history page lands', () => {
    renderNode(
      <ReviewRunList
        runs={[]}
        status="loading"
        error=""
        selectedRunId={null}
        onSelect={() => undefined}
      />,
    );
    expect(screen.getByTestId('reviews-runs-loading')).toHaveAttribute('aria-busy', 'true');
  });

  it('marks the selected row and hides the empty copy when an error is shown', () => {
    renderNode(
      <ReviewRunList
        runs={[reviewRun({ status: 'running' })]}
        status="succeeded"
        error=""
        selectedRunId="run-1"
        onSelect={() => undefined}
      />,
    );
    expect(screen.getByTestId('reviews-run-row-run-1')).toHaveAttribute('data-selected', 'true');

    renderNode(
      <ReviewRunList
        runs={[]}
        status="failed"
        error="History is down."
        selectedRunId={null}
        onSelect={() => undefined}
      />,
    );
    expect(screen.getByTestId('reviews-runs-error')).toHaveTextContent('History is down.');
    expect(screen.queryByTestId('reviews-runs-empty')).not.toBeInTheDocument();
  });

  it('omits the output-locale chip for a legacy run without one', () => {
    renderNode(
      <ReviewRunList
        runs={[reviewRun({ outputLocale: null })]}
        status="succeeded"
        error=""
        selectedRunId={null}
        onSelect={() => undefined}
      />,
    );

    expect(screen.queryByTestId('reviews-run-locale-run-1')).toBeNull();
  });
});

describe('source setup edges', () => {
  it('ignores a whitespace-only target instead of calling the API', () => {
    renderNode(<ReviewSourcesPanel profileId="site-1" />);
    const input = screen.getByTestId('reviews-source-input-google');
    fireEvent.change(input, { target: { value: '   ' } });
    fireEvent.submit(input.closest('form') as HTMLFormElement);
    expect(mockedApiClient).not.toHaveBeenCalled();
  });

  it('ignores a submit on a form that was never typed into', () => {
    renderNode(<ReviewSourcesPanel profileId="site-1" />);
    const input = screen.getByTestId('reviews-source-input-tripadvisor');
    fireEvent.submit(input.closest('form') as HTMLFormElement);
    expect(mockedApiClient).not.toHaveBeenCalled();
  });

  it('shows a loading skeleton while the first source list is in flight', () => {
    const store = configureStore({
      reducer: { localSeoReviews: localSeoReviewsReducer },
      preloadedState: {
        localSeoReviews: { ...initialReviewIntelligenceState, sourcesStatus: 'loading' as const },
      },
    });
    render(
      <Provider store={store}>
        <I18nextProvider i18n={i18n}>
          <MemoryRouter>
            <ReviewSourcesPanel profileId="site-1" />
          </MemoryRouter>
        </I18nextProvider>
      </Provider>,
    );
    expect(screen.getByTestId('reviews-sources-loading')).toHaveAttribute('aria-busy', 'true');
  });

  it('sorts an upserted source into the configured list', () => {
    const withTwo = [
      { type: addReviewSource.fulfilled.type, payload: reviewSource({ source: 'trustpilot', id: 't' }) },
      { type: addReviewSource.fulfilled.type, payload: reviewSource({ source: 'google', id: 'g' }) },
    ].reduce(
      (state, action) => localSeoReviewsReducer(state, action as never),
      initialReviewIntelligenceState,
    );
    expect(withTwo.sources.map((row) => row.source)).toEqual(['google', 'trustpilot']);
  });
});

describe('theme citation edges', () => {
  it('omits the output-locale chip for legacy theme output without one', () => {
    renderNode(
      <ReviewThemeCards
        themes={reviewThemes({ outputLocale: null })}
        status="succeeded"
        error=""
        inventoryHref="#inventory"
      />,
    );

    expect(screen.queryByTestId('reviews-themes-output-locale')).toBeNull();
  });

  it('labels an unrated citation without inventing a star value', async () => {
    const user = userEvent.setup();
    renderNode(
      <ReviewThemeCards
        themes={reviewThemes({
          praiseThemes: [
            {
              label: 'Warm welcome',
              summary: 'Guests mention the greeting.',
              citedReviewIds: ['g-9', 'g-10'],
              citations: [
                {
                  reviewId: 'row-g-9',
                  sourceReviewId: 'g-9',
                  source: 'google',
                  rating: null,
                  reviewedAt: null,
                  excerpt: 'Lovely greeting on arrival.',
                },
                {
                  reviewId: 'row-g-10',
                  sourceReviewId: 'g-10',
                  source: 'google',
                  rating: 4,
                  reviewedAt: '2026-06-01T00:00:00.000Z',
                  excerpt: 'Staff remembered our names.',
                },
              ],
            },
          ],
        })}
        status="succeeded"
        error=""
        inventoryHref="#x"
      />,
    );
    const triggers = screen.getAllByRole('button', { name: 'Show the reviews behind this' });
    await user.click(triggers[1]!);
    expect(await screen.findByTestId('reviews-citation-row-g-9')).toHaveTextContent('No rating');
  });
});

describe('sync form edges', () => {
  it('unchecking a source drops it from the basket and clears the estimate', async () => {
    const user = userEvent.setup();
    baseWire((path) => (path.startsWith('/local-seo/reviews/preview') ? spendPreview() : undefined));
    renderNode(<ReviewsPanel siteId="site-1" />);
    const checkbox = await screen.findByTestId('reviews-sync-source-google');
    await user.click(checkbox);
    await user.click(screen.getByTestId('reviews-sync-estimate'));
    expect(await screen.findByTestId('reviews-preview')).toBeVisible();
    await user.click(checkbox);
    await waitFor(() => expect(screen.queryByTestId('reviews-preview')).not.toBeInTheDocument());
    expect(screen.getByTestId('reviews-sync-estimate')).toBeDisabled();
  });

  it('refuses to estimate on an out-of-range depth', async () => {
    const user = userEvent.setup();
    baseWire();
    renderNode(<ReviewsPanel siteId="site-1" />);
    await user.click(await screen.findByTestId('reviews-sync-source-google'));
    const depth = screen.getByTestId('reviews-sync-depth');
    await user.clear(depth);
    await user.type(depth, '900');
    expect(screen.getByTestId('reviews-sync-estimate')).toBeDisabled();
    await user.clear(depth);
    await user.type(depth, '25');
    expect(screen.getByTestId('reviews-sync-estimate')).toBeEnabled();
  });

});

describe('panel refusal sources', () => {
  it('reads the kill switch off a 503 from the SOURCE mutation', async () => {
    const user = userEvent.setup();
    mockedApiClient.mockImplementation(async (path: string, init?: { method?: string }) => {
      if (path === '/local-seo/reviews/sources' && init?.method === 'POST') {
        throw new ApiError('off', 503, { error: { message: 'Review setup is paused.' } });
      }
      if (path.startsWith('/local-seo/reviews/sources')) return { sources: [] } as never;
      if (path.startsWith('/local-seo/reviews/runs')) {
        return { runs: [], nextCursor: null } as never;
      }
      if (path.startsWith('/local-seo/reviews/reviews')) {
        return inventoryResponse({ reviews: [], total: 0 }) as never;
      }
      throw new Error(`unexpected ${path}`);
    });
    renderNode(<ReviewsPanel siteId="site-1" />);
    await user.type(await screen.findByTestId('reviews-source-input-google'), 'ChIJabc');
    await user.click(screen.getByTestId('reviews-source-save-google'));
    expect(await screen.findByTestId('reviews-kill-switch')).toHaveTextContent(
      'Review setup is paused.',
    );
  });

  it('reads the kill switch off a 503 from the SYNC submit', async () => {
    const user = userEvent.setup();
    baseWire((path) => {
      if (path.startsWith('/local-seo/reviews/preview')) return spendPreview();
      if (path.startsWith('/local-seo/reviews/sync')) {
        throw new ApiError('off', 503, { error: { message: 'Syncing is paused right now.' } });
      }
      return undefined;
    });
    renderNode(<ReviewsPanel siteId="site-1" />);
    await user.click(await screen.findByTestId('reviews-sync-source-google'));
    await user.click(screen.getByTestId('reviews-sync-estimate'));
    await user.click(await screen.findByTestId('reviews-sync-confirm'));
    expect(await screen.findByTestId('reviews-kill-switch')).toHaveTextContent(
      'Syncing is paused right now.',
    );
  });

  it('loads the run detail, stats and themes for the newest run by default', async () => {
    baseWire((path) =>
      path === '/local-seo/reviews/runs?profileId=site-1'
        ? { runs: [reviewRun({ id: 'run-newest' })], nextCursor: null }
        : undefined,
    );
    renderNode(<ReviewsPanel siteId="site-1" />);
    await waitFor(() =>
      expect(mockedApiClient).toHaveBeenCalledWith('/local-seo/reviews/themes/run-newest'),
    );
    expect(await screen.findByTestId('reviews-stats')).toBeVisible();
  });

  it('honours an explicit `?run=` selection over the newest run', async () => {
    baseWire((path) =>
      path === '/local-seo/reviews/runs?profileId=site-1'
        ? { runs: [reviewRun({ id: 'run-newest' })], nextCursor: null }
        : undefined,
    );
    renderNode(
      <ReviewsPanel siteId="site-1" />,
      '/sites/site-1?tab=reviews&run=run-older',
    );
    await waitFor(() =>
      expect(mockedApiClient).toHaveBeenCalledWith('/local-seo/reviews/stats/run-older'),
    );
    expect(mockedApiClient).not.toHaveBeenCalledWith('/local-seo/reviews/stats/run-newest');
  });

  it('skips every read while the session is still pending', () => {
    authState = { authenticated: false, isPending: true, emailVerified: false, user: null };
    baseWire();
    renderNode(<ReviewsPanel siteId="site-1" />);
    expect(mockedApiClient).not.toHaveBeenCalled();
  });
});

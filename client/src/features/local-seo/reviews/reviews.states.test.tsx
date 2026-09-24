/**
 * Every Review Intelligence state renders with honest English copy
 *: loading, signed out, kill switch, no sources, sources-but-never-synced,
 * partial-source, all-sources-failed, `no-reliable-themes`, and
 * `ai-failed-reviews-intact`.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ReactNode } from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { configureStore } from '@reduxjs/toolkit';
import { Provider } from 'react-redux';
import { I18nextProvider } from 'react-i18next';
import { MemoryRouter } from 'react-router-dom';
import { ApiError, apiClient } from '@shared/api/client';
import { changeLanguage, i18n, initI18n } from '@shared/i18n';
import type { AuthSessionState } from '@features/auth';
import { SITE_TABS } from '@features/sites';
import { ReviewsPanel } from './components/ReviewsPanel';
import { ReviewKillSwitchBanner } from './components/ReviewStatePanels';
import { ReviewThemeCards } from './components/ReviewThemeCards';
import { localSeoReviewsReducer } from './store/slice';
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

interface Wire {
  sources?: ReturnType<typeof reviewSource>[];
  runs?: ReturnType<typeof reviewRun>[];
  inventory?: ReturnType<typeof inventoryResponse>;
  themes?: ReturnType<typeof reviewThemes>;
  onSync?: () => never;
}

/** Route the mocked `apiClient` by path so one helper serves every read. */
const wire = (config: Wire = {}) => {
  mockedApiClient.mockImplementation(async (path: string) => {
    if (path.startsWith('/local-seo/reviews/sources')) {
      return { sources: config.sources ?? [] } as never;
    }
    if (path.startsWith('/local-seo/reviews/runs/')) return (config.runs ?? [])[0] as never;
    if (path.startsWith('/local-seo/reviews/runs')) {
      return { runs: config.runs ?? [], nextCursor: null } as never;
    }
    if (path.startsWith('/local-seo/reviews/stats/')) return reviewStats() as never;
    if (path.startsWith('/local-seo/reviews/themes/')) {
      return (config.themes ?? reviewThemes()) as never;
    }
    if (path.startsWith('/local-seo/reviews/reviews')) {
      return (config.inventory ?? inventoryResponse({ reviews: [], total: 0 })) as never;
    }
    if (path.startsWith('/local-seo/reviews/preview')) return spendPreview() as never;
    if (path.startsWith('/local-seo/reviews/sync')) {
      if (config.onSync) config.onSync();
      return {
        runId: 'run-9',
        status: 'queued',
        profileId: 'site-1',
        sources: ['google'],
        depth: 100,
        outputLocale: 'en',
      } as never;
    }
    throw new Error(`unexpected path ${path}`);
  });
};

const renderPanel = (node: ReactNode, initialEntry = '/sites/site-1?tab=reviews') => {
  const store = configureStore({ reducer: { localSeoReviews: localSeoReviewsReducer } });
  return {
    store,
    ...render(
      <Provider store={store}>
        <I18nextProvider i18n={i18n}>
          <MemoryRouter initialEntries={[initialEntry]}>{node}</MemoryRouter>
        </I18nextProvider>
      </Provider>,
    ),
  };
};

beforeEach(async () => {
  initI18n({ initialLocale: 'en' });
  await changeLanguage('en');
  mockedApiClient.mockReset();
  authState = { authenticated: true, isPending: false, emailVerified: true, user: null };
});

describe('Reviews tab registration', () => {
  it('is a first-class workspace tab so `?tab=reviews` round-trips', () => {
    expect(SITE_TABS).toContain('reviews');
  });
});

describe('Review Intelligence states', () => {
  it('shows a skeleton while the session resolves', () => {
    authState = { authenticated: false, isPending: true, emailVerified: false, user: null };
    wire();
    renderPanel(<ReviewsPanel siteId="site-1" />);
    expect(screen.getByTestId('reviews-loading')).toHaveAttribute('aria-busy', 'true');
  });

  it('asks a signed-out visitor to sign in', () => {
    authState = { authenticated: false, isPending: false, emailVerified: false, user: null };
    wire();
    renderPanel(<ReviewsPanel siteId="site-1" />);
    expect(screen.getByTestId('reviews-signed-out')).toHaveTextContent(
      'Sign in to read your reviews.',
    );
  });

  it('prompts for a first source when none is configured', async () => {
    wire();
    renderPanel(<ReviewsPanel siteId="site-1" />);
    expect(await screen.findByTestId('reviews-sources-empty')).toHaveTextContent(
      'No sources yet. Add one below.',
    );
    expect(screen.getByTestId('reviews-no-sources')).toHaveTextContent(
      'Add at least one review source to get started.',
    );
    expect(screen.getByTestId('reviews-sync-needs-sources')).toBeVisible();
  });

  it('distinguishes "sources set up, never synced" from "no sources"', async () => {
    wire({ sources: [reviewSource()] });
    renderPanel(<ReviewsPanel siteId="site-1" />);
    expect(await screen.findByTestId('reviews-never-synced')).toHaveTextContent(
      'Run the first sync to pull reviews in.',
    );
    expect(screen.queryByTestId('reviews-no-sources')).not.toBeInTheDocument();
  });

  it('discloses a partial sync per source instead of reading as clean', async () => {
    wire({
      sources: [reviewSource()],
      runs: [
        reviewRun({
          status: 'partial',
          perSourceOutcomes: [
            { source: 'google', outcome: 'ok', retained: 2, errorCode: null },
            { source: 'trustpilot', outcome: 'failed', retained: 0, errorCode: 'timeout' },
            { source: 'tripadvisor', outcome: 'zeroNew', retained: 0, errorCode: null },
          ],
        }),
      ],
    });
    renderPanel(<ReviewsPanel siteId="site-1" />);
    expect(await screen.findByTestId('reviews-run-outcome-run-1-google')).toHaveTextContent(
      'new reviews',
    );
    expect(screen.getByTestId('reviews-run-outcome-run-1-trustpilot')).toHaveTextContent('failed');
    expect(screen.getByTestId('reviews-run-outcome-run-1-tripadvisor')).toHaveTextContent(
      'nothing new',
    );
    expect(screen.getByTestId('reviews-run-row-run-1')).toHaveTextContent('Partly done');
  });

  it('shows a failed run when every source failed and nothing was kept', async () => {
    wire({
      sources: [reviewSource()],
      runs: [
        reviewRun({
          status: 'failed',
          retainedCount: 0,
          aiTerminalState: 'no-reliable-themes',
          perSourceOutcomes: [
            { source: 'google', outcome: 'failed', retained: 0, errorCode: 'quota' },
          ],
        }),
      ],
    });
    renderPanel(<ReviewsPanel siteId="site-1" />);
    expect(await screen.findByTestId('reviews-run-outcome-run-1-google')).toHaveTextContent(
      'failed',
    );
  });

  it('renders every run AI terminal chip', async () => {
    wire({
      sources: [reviewSource()],
      runs: [
        reviewRun({ id: 'run-a', aiTerminalState: 'pending' }),
        reviewRun({ id: 'run-b', aiTerminalState: 'ai-failed-reviews-intact' }),
      ],
    });
    renderPanel(<ReviewsPanel siteId="site-1" />);
    expect(await screen.findByTestId('reviews-run-ai-run-a')).toHaveTextContent('Themes pending');
    expect(screen.getByTestId('reviews-run-ai-run-b')).toHaveTextContent('Themes failed');
  });

  it('labels the frozen run and theme locale on historical output', async () => {
    wire({
      sources: [reviewSource()],
      runs: [reviewRun({ outputLocale: 'de' })],
      themes: reviewThemes({ outputLocale: 'de' }),
    });
    renderPanel(<ReviewsPanel siteId="site-1" />);
    expect(await screen.findByTestId('reviews-run-locale-run-1')).toHaveTextContent(
      'Output language: Deutsch',
    );
    expect(screen.getByTestId('reviews-themes-output-locale')).toHaveTextContent(
      'Output language: Deutsch',
    );
  });

  it('selects a run into the URL when the row is opened', async () => {
    const user = userEvent.setup();
    wire({
      sources: [reviewSource()],
      runs: [reviewRun({ id: 'run-1' }), reviewRun({ id: 'run-2' })],
    });
    renderPanel(<ReviewsPanel siteId="site-1" />);
    await user.click(await screen.findByTestId('reviews-run-open-run-2'));
    await waitFor(() =>
      expect(mockedApiClient).toHaveBeenCalledWith('/local-seo/reviews/stats/run-2'),
    );
  });

  it('renders the honest no-reliable-themes copy without inventing a theme', () => {
    renderPanel(
      <ReviewThemeCards
        themes={reviewThemes({ terminal: 'no-reliable-themes', complaintThemes: [], praiseThemes: [] })}
        status="succeeded"
        error=""
        inventoryHref="#reviews-inventory-anchor"
      />,
    );
    expect(screen.getByTestId('reviews-themes-none')).toHaveTextContent(
      'We only show a theme when at least two reviews back it up.',
    );
    expect(screen.queryByTestId('reviews-themes')).not.toBeInTheDocument();
  });

  it('links back to the readable inventory when the AI pass failed', () => {
    renderPanel(
      <ReviewThemeCards
        themes={reviewThemes({
          terminal: 'ai-failed-reviews-intact',
          complaintThemes: [],
          praiseThemes: [],
        })}
        status="succeeded"
        error=""
        inventoryHref="#reviews-inventory-anchor"
      />,
    );
    expect(screen.getByTestId('reviews-themes-ai-failed')).toHaveTextContent(
      'Your reviews landed safely and are still readable below.',
    );
    expect(screen.getByTestId('reviews-themes-ai-failed-link')).toHaveAttribute(
      'href',
      '#reviews-inventory-anchor',
    );
    expect(screen.queryByTestId('reviews-themes-none')).not.toBeInTheDocument();
  });

  it('keeps the AI disclosure when terminal metadata is unavailable', () => {
    const { rerender, store } = renderPanel(
      <ReviewThemeCards
        themes={reviewThemes({
          terminal: 'no-reliable-themes',
          complaintThemes: [],
          praiseThemes: [],
          observation: null,
        })}
        status="succeeded"
        error=""
        inventoryHref="#reviews"
      />,
    );
    expect(screen.getByTestId('reviews-themes-none')).toHaveTextContent('AI interpretation');
    rerender(
      <Provider store={store}>
        <I18nextProvider i18n={i18n}>
          <MemoryRouter>
            <ReviewThemeCards
              themes={reviewThemes({
                terminal: 'ai-failed-reviews-intact',
                complaintThemes: [],
                praiseThemes: [],
                observation: null,
              })}
              status="succeeded"
              error=""
              inventoryHref="#reviews"
            />
          </MemoryRouter>
        </I18nextProvider>
      </Provider>,
    );
    expect(screen.getByTestId('reviews-themes-ai-failed')).toHaveTextContent(
      'AI interpretation',
    );
  });

  it('says the theme pass has not finished while it is pending', () => {
    renderPanel(
      <ReviewThemeCards
        themes={reviewThemes({ terminal: 'pending' })}
        status="succeeded"
        error=""
        inventoryHref="#x"
      />,
    );
    expect(screen.getByTestId('reviews-themes-pending')).toHaveTextContent(
      'The theme pass has not finished yet.',
    );
  });

  it('shows a skeleton, then an error, then nothing when there is no payload', () => {
    const { rerender, store } = renderPanel(
      <ReviewThemeCards themes={null} status="loading" error="" inventoryHref="#x" />,
    );
    expect(screen.getByTestId('reviews-themes-loading')).toBeVisible();
    const wrap = (node: ReactNode) => (
      <Provider store={store}>
        <I18nextProvider i18n={i18n}>
          <MemoryRouter>{node}</MemoryRouter>
        </I18nextProvider>
      </Provider>
    );
    rerender(wrap(<ReviewThemeCards themes={null} status="failed" error="Boom" inventoryHref="#x" />));
    expect(screen.getByTestId('reviews-themes-error')).toHaveTextContent('Boom');
    rerender(wrap(<ReviewThemeCards themes={null} status="idle" error="" inventoryHref="#x" />));
    expect(screen.queryByTestId('reviews-themes-error')).not.toBeInTheDocument();
  });

  it('renders cited themes with an expandable citation list', async () => {
    const user = userEvent.setup();
    renderPanel(
      <ReviewThemeCards
        themes={reviewThemes()}
        status="succeeded"
        error=""
        inventoryHref="#x"
      />,
    );
    expect(screen.getByTestId('reviews-theme-complaint-0')).toHaveTextContent('Slow check-in');
    const triggers = screen.getAllByRole('button', { name: 'Show the reviews behind this' });
    await user.click(triggers[0]!);
    expect(await screen.findByTestId('reviews-citation-row-g-1')).toHaveTextContent(
      'Waited twenty minutes to check in.',
    );
  });

  it('renders an empty theme section without inventing entries', () => {
    renderPanel(
      <ReviewThemeCards
        themes={reviewThemes({ complaintThemes: [] })}
        status="succeeded"
        error=""
        inventoryHref="#x"
      />,
    );
    expect(screen.getByTestId('reviews-themes-complaint')).toHaveTextContent(
      'Nothing here for this sync.',
    );
  });

  it('renders the kill-switch banner with the server reason', () => {
    renderPanel(<ReviewKillSwitchBanner description="Review syncs are paused right now." />);
    expect(screen.getByTestId('reviews-kill-switch')).toHaveTextContent(
      'Review syncs are paused right now.',
    );
  });

  it('falls back to the localized kill-switch copy when the server sent none', () => {
    renderPanel(<ReviewKillSwitchBanner />);
    expect(screen.getByTestId('reviews-kill-switch')).toHaveTextContent(
      'We have paused new review syncs for now.',
    );
  });

  it('disables the sync form when the server returns the kill-switch 503', async () => {
    const user = userEvent.setup();
    mockedApiClient.mockImplementation(async (path: string) => {
      if (path.startsWith('/local-seo/reviews/sources')) {
        return { sources: [reviewSource()] } as never;
      }
      if (path.startsWith('/local-seo/reviews/runs')) {
        return { runs: [], nextCursor: null } as never;
      }
      if (path.startsWith('/local-seo/reviews/reviews')) {
        return inventoryResponse({ reviews: [], total: 0 }) as never;
      }
      if (path.startsWith('/local-seo/reviews/preview')) {
        throw new ApiError('off', 503, { error: { message: 'Review syncs are paused.' } });
      }
      throw new Error(`unexpected ${path}`);
    });
    renderPanel(<ReviewsPanel siteId="site-1" />);
    await user.click(await screen.findByTestId('reviews-sync-source-google'));
    await user.click(screen.getByTestId('reviews-sync-estimate'));
    expect(await screen.findByTestId('reviews-kill-switch')).toHaveTextContent(
      'Review syncs are paused.',
    );
    expect(screen.getByTestId('reviews-sync-disabled')).toBeVisible();
  });

  it('previews, then cancel spends nothing — no sync request fires', async () => {
    const user = userEvent.setup();
    const onSync = vi.fn(() => {
      throw new Error('sync must not be called after cancel');
    });
    wire({ sources: [reviewSource()], onSync: onSync as never });
    renderPanel(<ReviewsPanel siteId="site-1" />);
    await user.click(await screen.findByTestId('reviews-sync-source-google'));
    await user.click(screen.getByTestId('reviews-sync-estimate'));
    expect(await screen.findByTestId('reviews-preview-sources')).toHaveTextContent(
      'Covers 1 sources',
    );
    await user.click(screen.getByTestId('reviews-sync-cancel'));
    await waitFor(() => expect(screen.queryByTestId('reviews-preview')).not.toBeInTheDocument());
    expect(onSync).not.toHaveBeenCalled();
    expect(mockedApiClient).not.toHaveBeenCalledWith(
      '/local-seo/reviews/sync',
      expect.anything(),
    );
  });

  it('confirms after a preview and submits the selected basket', async () => {
    const user = userEvent.setup();
    wire({ sources: [reviewSource()] });
    renderPanel(<ReviewsPanel siteId="site-1" />);
    await user.click(await screen.findByTestId('reviews-sync-source-google'));
    await user.click(screen.getByTestId('reviews-sync-estimate'));
    await user.click(await screen.findByTestId('reviews-sync-confirm'));
    await waitFor(() =>
      expect(mockedApiClient).toHaveBeenCalledWith('/local-seo/reviews/sync', {
        method: 'POST',
        body: { profileId: 'site-1', sources: ['google'], depth: 100 },
      }),
    );
  });

  it('adds and removes a source through the setup panel', async () => {
    const user = userEvent.setup();
    mockedApiClient.mockImplementation(async (path: string, init?: { method?: string }) => {
      if (path === '/local-seo/reviews/sources' && init?.method === 'POST') {
        return reviewSource({ id: 'src-new', source: 'trustpilot', target: 'example.com' }) as never;
      }
      if (path.startsWith('/local-seo/reviews/sources/') && init?.method === 'DELETE') {
        return { id: 'src-google', deleted: true } as never;
      }
      if (path.startsWith('/local-seo/reviews/sources')) {
        return { sources: [reviewSource()] } as never;
      }
      if (path.startsWith('/local-seo/reviews/runs')) {
        return { runs: [], nextCursor: null } as never;
      }
      if (path.startsWith('/local-seo/reviews/reviews')) {
        return inventoryResponse({ reviews: [], total: 0 }) as never;
      }
      throw new Error(`unexpected ${path}`);
    });
    renderPanel(<ReviewsPanel siteId="site-1" />);
    await user.type(
      await screen.findByTestId('reviews-source-input-trustpilot'),
      'example.com',
    );
    await user.click(screen.getByTestId('reviews-source-save-trustpilot'));
    expect(await screen.findByTestId('reviews-source-configured-trustpilot')).toBeVisible();
    await user.click(screen.getByTestId('reviews-source-remove-google'));
    await waitFor(() =>
      expect(screen.queryByTestId('reviews-source-configured-google')).not.toBeInTheDocument(),
    );
  });

  it('surfaces a failed source mutation instead of silently dropping it', async () => {
    const user = userEvent.setup();
    mockedApiClient.mockImplementation(async (path: string, init?: { method?: string }) => {
      if (path === '/local-seo/reviews/sources' && init?.method === 'POST') {
        throw new ApiError('bad', 400, { error: { message: 'That target is not valid.' } });
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
    renderPanel(<ReviewsPanel siteId="site-1" />);
    await user.type(await screen.findByTestId('reviews-source-input-google'), 'ChIJbad');
    await user.click(screen.getByTestId('reviews-source-save-google'));
    expect(await screen.findByTestId('reviews-sources-mutation-error')).toHaveTextContent(
      'That target is not valid.',
    );
  });

  it('reports a failed source list load', async () => {
    mockedApiClient.mockImplementation(async (path: string) => {
      if (path.startsWith('/local-seo/reviews/sources')) {
        throw new ApiError('nope', 500, { error: { message: 'Sources are unavailable.' } });
      }
      if (path.startsWith('/local-seo/reviews/runs')) {
        throw new ApiError('nope', 500, { error: { message: 'History is unavailable.' } });
      }
      if (path.startsWith('/local-seo/reviews/reviews')) {
        throw new ApiError('nope', 500, { error: { message: 'Reviews are unavailable.' } });
      }
      throw new Error(`unexpected ${path}`);
    });
    renderPanel(<ReviewsPanel siteId="site-1" />);
    expect(await screen.findByTestId('reviews-sources-error')).toHaveTextContent(
      'Sources are unavailable.',
    );
    expect(await screen.findByTestId('reviews-runs-error')).toHaveTextContent(
      'History is unavailable.',
    );
    expect(await screen.findByTestId('reviews-inventory-error')).toHaveTextContent(
      'Reviews are unavailable.',
    );
  });
});

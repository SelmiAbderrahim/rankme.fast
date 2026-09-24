/**
 * SERP features panel.
 *
 * Covers every declared state: loading, error, kill-switch disabled, empty,
 * not-observed, observed-with-zero-features, ownership badges, per-keyword
 * history, the stored top-100 drawer, URL-backed `?keyword=` drill-in, and
 * hostile third-party SERP text rendering inert.
 */
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Provider } from 'react-redux';
import { I18nextProvider } from 'react-i18next';
import { MemoryRouter } from 'react-router-dom';
import { configureStore } from '@reduxjs/toolkit';
import { changeLanguage, i18n, initI18n } from '@shared/i18n';
import { ApiError } from '@shared/api/client';
import * as api from './api';

vi.mock('./api', () => ({
  fetchKeywordsRequest: vi.fn(),
  createKeywordRequest: vi.fn(),
  removeKeywordRequest: vi.fn(),
  updateCadenceRequest: vi.fn(),
  fetchKeywordHistoryRequest: vi.fn(),
  checkNowRequest: vi.fn(),
  fetchKeywordSuggestionsRequest: vi.fn(),
  fetchSerpFeaturesRequest: vi.fn(),
  fetchSerpFeatureDetailRequest: vi.fn(),
}));

import { ranksReducer } from './store/slice';
import { loadSerpFeatureDetail, loadSerpFeatures } from './store/thunks';
import { SerpFeaturesPanel } from './components/SerpFeaturesPanel';
import {
  SERP_FEATURE_TYPES,
  type SerpFeatureDetail,
  type SerpFeatureRow,
  type SerpFeaturesResponse,
} from './types';

const mocked = vi.mocked(api);

const OWNED = 'example.com';

function makeStore() {
  return configureStore({ reducer: { ranks: ranksReducer } });
}

function renderPanel(initialEntry = '/sites/site-1?tab=serp-features') {
  const store = makeStore();
  render(
    <Provider store={store}>
      <I18nextProvider i18n={i18n}>
        <MemoryRouter initialEntries={[initialEntry]}>
          <SerpFeaturesPanel siteId="site-1" />
        </MemoryRouter>
      </I18nextProvider>
    </Provider>,
  );
  return store;
}

const row = (overrides: Partial<SerpFeatureRow> = {}): SerpFeatureRow => ({
  keywordId: 'kw-1',
  phrase: 'featured snippet guide',
  device: 'desktop',
  observedAt: '2026-03-02T00:00:00.000Z',
  features: ['featured_snippet', 'people_also_ask'],
  ownedSnippet: { domain: OWNED, url: `https://${OWNED}/guides/snippet` },
  ownedPaa: [{ question: 'How do I win a featured snippet?', url: `https://${OWNED}/g` }],
  paaCount: 2,
  topResultCount: 20,
  ...overrides,
});

const list = (rows: SerpFeatureRow[], captureEnabled = true): SerpFeaturesResponse => ({
  siteId: 'site-1',
  captureEnabled,
  captureStatus: captureEnabled ? 'active' : 'paused',
  rows,
});

const detail = (overrides: Partial<SerpFeatureDetail> = {}): SerpFeatureDetail => ({
  keywordId: 'kw-1',
  phrase: 'featured snippet guide',
  captureEnabled: true,
  captureStatus: 'active',
  latest: {
    observedAt: '2026-03-02T00:00:00.000Z',
    features: ['featured_snippet', 'people_also_ask'],
    ownedSnippet: { domain: OWNED, url: `https://${OWNED}/guides/snippet` },
    snippetSource: { domain: OWNED, url: `https://${OWNED}/guides/snippet` },
    paa: [
      {
        question: 'How do I win a featured snippet?',
        answerDomain: OWNED,
        answerUrl: `https://${OWNED}/guides/snippet`,
        owned: true,
      },
      {
        question: 'What is a People Also Ask box?',
        answerDomain: 'rival-one.example',
        answerUrl: 'https://rival-one.example/paa',
        owned: false,
      },
    ],
    topResults: [
      { rank: 1, domain: 'rival-one.example', url: 'https://rival-one.example/', owned: false },
      { rank: 2, domain: OWNED, url: `https://${OWNED}/pricing`, owned: true },
    ],
  },
  history: [
    {
      observedAt: '2026-02-24T00:00:00.000Z',
      features: [],
      ownedSnippet: false,
      ownedPaaCount: 0,
    },
    {
      observedAt: '2026-03-02T00:00:00.000Z',
      features: ['featured_snippet', 'people_also_ask'],
      ownedSnippet: true,
      ownedPaaCount: 1,
    },
  ],
  ...overrides,
});

beforeEach(async () => {
  vi.clearAllMocks();
  await initI18n();
  await changeLanguage('en');
});

describe('SerpFeaturesPanel — list states', () => {
  it('renders the skeleton while the first read is in flight', async () => {
    let resolve!: (value: SerpFeaturesResponse) => void;
    mocked.fetchSerpFeaturesRequest.mockReturnValue(
      new Promise<SerpFeaturesResponse>((r) => {
        resolve = r;
      }),
    );
    renderPanel();
    expect(await screen.findByTestId('serp-features-loading')).toBeInTheDocument();
    resolve(list([]));
    await waitFor(() =>
      expect(screen.queryByTestId('serp-features-loading')).not.toBeInTheDocument(),
    );
  });

  it('renders observed chips, ownership badges, and the observed stamp', async () => {
    mocked.fetchSerpFeaturesRequest.mockResolvedValue(list([row()]));
    renderPanel();
    const listRow = await screen.findByTestId('serp-features-row-kw-1');
    expect(within(listRow).getByTestId('serp-feature-chip-featured_snippet')).toHaveTextContent(
      'Featured snippet',
    );
    expect(within(listRow).getByTestId('serp-feature-chip-people_also_ask')).toHaveTextContent(
      'People Also Ask',
    );
    expect(within(listRow).getByTestId('serp-feature-owned-snippet')).toHaveTextContent(
      'You hold the featured snippet',
    );
    expect(within(listRow).getByTestId('serp-feature-owned-paa')).toBeInTheDocument();
    expect(
      within(listRow).getByRole('link', {
        name: `https://${OWNED}/guides/snippet`,
      }),
    ).toHaveAttribute('href', `https://${OWNED}/guides/snippet`);
    expect(within(listRow).getByRole('link', { name: `https://${OWNED}/g` })).toHaveAttribute(
      'rel',
      'nofollow ugc noopener noreferrer',
    );
    expect(listRow).toHaveTextContent('Mar 2, 2026');
  });

  it('renders every member of the shipped SERP feature union as a localized chip', async () => {
    mocked.fetchSerpFeaturesRequest.mockResolvedValue(
      list([row({ features: [...SERP_FEATURE_TYPES] })]),
    );
    renderPanel();
    const listRow = await screen.findByTestId('serp-features-row-kw-1');
    const labels = [
      'AI Overview',
      'Featured snippet',
      'People Also Ask',
      'Local pack',
      'Video',
      'Images',
      'Shopping',
      'Knowledge panel',
      'Other',
    ];
    for (const [index, feature] of SERP_FEATURE_TYPES.entries()) {
      expect(within(listRow).getByTestId(`serp-feature-chip-${feature}`)).toHaveTextContent(
        labels[index]!,
      );
    }
  });

  it('scheme-guards hostile matched URLs on the list surface', async () => {
    mocked.fetchSerpFeaturesRequest.mockResolvedValue(
      list([
        row({
          ownedSnippet: { domain: OWNED, url: 'javascript:alert(1)' },
          ownedPaa: [{ question: '<img onerror=alert(1)>', url: 'data:text/html,bad' }],
        }),
      ]),
    );
    renderPanel();
    const listRow = await screen.findByTestId('serp-features-row-kw-1');
    expect(listRow.querySelector('img')).toBeNull();
    for (const link of within(listRow).getAllByRole('link')) {
      expect(link).toHaveAttribute('href', '#');
      expect(link).toHaveAttribute('rel', 'nofollow ugc noopener noreferrer');
    }
  });

  it('keeps ownership chips without fabricating links when matched URLs are missing', async () => {
    mocked.fetchSerpFeaturesRequest.mockResolvedValue(
      list([
        row({
          ownedSnippet: { domain: OWNED, url: null },
          ownedPaa: [{ question: 'Who owns this answer?', url: null }],
        }),
      ]),
    );
    renderPanel();
    const listRow = await screen.findByTestId('serp-features-row-kw-1');
    expect(within(listRow).getByTestId('serp-feature-owned-snippet')).toBeVisible();
    expect(within(listRow).getByTestId('serp-feature-owned-paa')).toBeVisible();
    expect(within(listRow).queryByRole('link')).toBeNull();
  });

  it('renders "not observed" for a keyword with no stored observation', async () => {
    mocked.fetchSerpFeaturesRequest.mockResolvedValue(
      list([
        row({
          keywordId: 'kw-2',
          phrase: 'never checked',
          observedAt: null,
          features: [],
          ownedSnippet: null,
          ownedPaa: [],
          paaCount: 0,
          topResultCount: 0,
        }),
      ]),
    );
    renderPanel();
    const listRow = await screen.findByTestId('serp-features-row-kw-2');
    expect(within(listRow).getByTestId('serp-feature-not-observed')).toHaveTextContent(
      'Not observed yet',
    );
    // Honesty invariant — never a claim about what Google does not show.
    expect(listRow.textContent ?? '').not.toMatch(/not present|absent/i);
  });

  it('renders "no features observed" when the check found none', async () => {
    mocked.fetchSerpFeaturesRequest.mockResolvedValue(
      list([row({ features: [], ownedSnippet: null, ownedPaa: [], paaCount: 0 })]),
    );
    renderPanel();
    const listRow = await screen.findByTestId('serp-features-row-kw-1');
    expect(within(listRow).getByTestId('serp-feature-none')).toHaveTextContent(
      'No features observed on the last check',
    );
    expect(within(listRow).getByText('None yet')).toBeInTheDocument();
  });

  it('renders the empty state when no keywords are tracked', async () => {
    mocked.fetchSerpFeaturesRequest.mockResolvedValue(list([]));
    renderPanel();
    expect(await screen.findByTestId('serp-features-empty')).toHaveTextContent('Track a keyword');
  });

  it('keeps stored rows visible with a non-blocking banner when new capture is paused', async () => {
    mocked.fetchSerpFeaturesRequest.mockResolvedValue(list([row()], false));
    renderPanel();
    expect(await screen.findByTestId('serp-features-capture-paused')).toHaveTextContent(
      'New SERP feature capture is paused',
    );
    expect(screen.getByTestId('serp-features-capture-paused')).toHaveAttribute(
      'data-capture-status',
      'paused',
    );
    expect(screen.getByTestId('serp-features-row-kw-1')).toBeVisible();
    expect(screen.queryByTestId('serp-features-error')).not.toBeInTheDocument();
  });

  it('renders the kill-switch state for a disabled stored-read endpoint', async () => {
    mocked.fetchSerpFeaturesRequest.mockRejectedValue(
      new ApiError('disabled', 503, { error: { message: 'capture disabled' } }),
    );
    const store = renderPanel();
    expect(await screen.findByTestId('serp-features-disabled')).toHaveTextContent(
      'SERP feature tracking is temporarily unavailable',
    );
    expect(screen.queryByTestId('serp-features-error')).not.toBeInTheDocument();
    expect(store.getState().ranks.serpFeaturesDisabled).toBe(true);
    expect(store.getState().ranks.serpFeaturesError).toBe('');
  });

  it('renders an error alert on any other failure', async () => {
    mocked.fetchSerpFeaturesRequest.mockRejectedValue(
      new ApiError('boom', 500, { error: { message: 'boom' } }),
    );
    renderPanel();
    const alert = await screen.findByTestId('serp-features-error');
    expect(alert).toHaveAttribute('role', 'alert');
    expect(screen.queryByTestId('serp-features-disabled')).not.toBeInTheDocument();
  });
});

describe('SerpFeaturesPanel — per-keyword drill-in', () => {
  it('opens the history view through the URL and shows ownership + PAA', async () => {
    const user = userEvent.setup();
    mocked.fetchSerpFeaturesRequest.mockResolvedValue(list([row()]));
    mocked.fetchSerpFeatureDetailRequest.mockResolvedValue(detail());
    renderPanel();
    await user.click(await screen.findByRole('button', { name: 'View history' }));

    expect(await screen.findByTestId('serp-features-history')).toBeInTheDocument();
    expect(mocked.fetchSerpFeatureDetailRequest).toHaveBeenCalledWith(
      'kw-1',
      expect.objectContaining({ signal: expect.anything() }),
    );
    expect(screen.getByTestId('serp-feature-owned-snippet')).toBeInTheDocument();
    expect(screen.getByTestId('serp-feature-owned-paa')).toBeInTheDocument();
    expect(screen.getByText('Answered by rival-one.example')).toBeInTheDocument();

    const historyTable = screen.getByTestId('serp-features-history-table');
    const historyChart = screen.getByTestId('serp-features-history-chart');
    expect(historyChart).toHaveAttribute('aria-hidden', 'true');
    expect(
      within(historyChart).getByTestId('serp-features-history-marker-featured_snippet-1'),
    ).toHaveClass('bg-chart-2');
    expect(
      within(historyChart).getByTestId('serp-features-history-marker-people_also_ask-1'),
    ).toHaveClass('bg-chart-3');
    expect(within(historyTable).getAllByRole('row')).toHaveLength(3);
    expect(within(historyTable).getByText('Yes (1 answers)')).toBeInTheDocument();
    expect(within(historyTable).getByText('No')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: /Back to all keywords/ }));
    expect(await screen.findByTestId('serp-features-table')).toBeInTheDocument();
  });

  it('opens the stored top-results drawer with the owned-row marker', async () => {
    const user = userEvent.setup();
    mocked.fetchSerpFeaturesRequest.mockResolvedValue(list([row()]));
    mocked.fetchSerpFeatureDetailRequest.mockResolvedValue(detail());
    renderPanel('/sites/site-1?tab=serp-features&keyword=kw-1');
    await user.click(await screen.findByRole('button', { name: /View stored top results/ }));
    const drawer = await screen.findByTestId('serp-features-top-results');
    expect(within(drawer).getByText('Your page')).toBeInTheDocument();
    const link = within(drawer).getByRole('link', { name: /rival-one\.example/ });
    expect(link).toHaveAttribute('rel', 'nofollow ugc noopener noreferrer');
    expect(link).toHaveAttribute('href', 'https://rival-one.example/');
  });

  it('reports a third-party snippet holder without claiming ownership', async () => {
    mocked.fetchSerpFeaturesRequest.mockResolvedValue(list([row()]));
    mocked.fetchSerpFeatureDetailRequest.mockResolvedValue(
      detail({
        latest: {
          observedAt: '2026-03-02T00:00:00.000Z',
          features: ['featured_snippet'],
          ownedSnippet: null,
          snippetSource: {
            domain: 'rival-one.example',
            url: 'https://rival-one.example/snippet',
          },
          paa: [],
          topResults: [],
        },
      }),
    );
    renderPanel('/sites/site-1?tab=serp-features&keyword=kw-1');
    expect(await screen.findByTestId('serp-feature-snippet-source')).toHaveTextContent(
      'Featured snippet held by rival-one.example',
    );
    expect(screen.queryByTestId('serp-feature-owned-snippet')).not.toBeInTheDocument();
  });

  it('renders the honest not-observed detail state', async () => {
    mocked.fetchSerpFeaturesRequest.mockResolvedValue(list([row()]));
    mocked.fetchSerpFeatureDetailRequest.mockResolvedValue(detail({ latest: null, history: [] }));
    renderPanel('/sites/site-1?tab=serp-features&keyword=kw-1');
    expect(await screen.findByTestId('serp-feature-not-observed')).toHaveTextContent(
      'Not observed yet',
    );
  });

  it('surfaces a detail error without losing the back control', async () => {
    mocked.fetchSerpFeaturesRequest.mockResolvedValue(list([row()]));
    mocked.fetchSerpFeatureDetailRequest.mockRejectedValue(
      new ApiError('nope', 500, { error: { message: 'nope' } }),
    );
    renderPanel('/sites/site-1?tab=serp-features&keyword=kw-1');
    expect(await screen.findByTestId('serp-features-detail-error')).toHaveAttribute(
      'role',
      'alert',
    );
    expect(screen.getByRole('button', { name: /Back to all keywords/ })).toBeEnabled();
  });

  it('renders hostile third-party SERP text as inert content', async () => {
    const hostileQuestion = '<img src=x onerror="alert(1)">Who ranks here?';
    mocked.fetchSerpFeaturesRequest.mockResolvedValue(list([row()]));
    mocked.fetchSerpFeatureDetailRequest.mockResolvedValue(
      detail({
        latest: {
          observedAt: '2026-03-02T00:00:00.000Z',
          features: ['people_also_ask'],
          ownedSnippet: null,
          snippetSource: null,
          paa: [
            {
              question: hostileQuestion,
              answerDomain: 'rival-one.example',
              answerUrl: 'javascript:alert(1)',
              owned: false,
            },
          ],
          topResults: [
            {
              rank: 1,
              domain: 'rival-one.example',
              url: 'javascript:alert(1)',
              owned: false,
            },
          ],
        },
      }),
    );
    renderPanel('/sites/site-1?tab=serp-features&keyword=kw-1');
    // The hostile markup is a TEXT NODE — no element was created from it.
    expect(await screen.findByText(hostileQuestion)).toBeInTheDocument();
    expect(document.querySelector('img[onerror]')).toBeNull();
    for (const link of screen.getAllByRole('link')) {
      expect(link.getAttribute('href')).toBe('#');
      expect(link).toHaveAttribute('rel', 'nofollow ugc noopener noreferrer');
    }
  });
});

describe('SerpFeaturesPanel — sparse observation shapes', () => {
  it('renders an owned snippet with no recorded URL and an unattributed PAA', async () => {
    mocked.fetchSerpFeaturesRequest.mockResolvedValue(list([row()]));
    mocked.fetchSerpFeatureDetailRequest.mockResolvedValue(
      detail({
        latest: {
          observedAt: '2026-03-02T00:00:00.000Z',
          features: ['featured_snippet', 'people_also_ask'],
          ownedSnippet: { domain: OWNED, url: null },
          snippetSource: { domain: OWNED, url: null },
          paa: [
            {
              question: 'Who answers this?',
              answerDomain: null,
              answerUrl: null,
              owned: false,
            },
          ],
          topResults: [],
        },
        history: [],
      }),
    );
    renderPanel('/sites/site-1?tab=serp-features&keyword=kw-1');
    const owned = await screen.findByTestId('serp-feature-owned-snippet');
    expect(owned).toHaveTextContent('You hold the featured snippet');
    expect(within(owned).queryByRole('link')).toBeNull();
    expect(screen.getByText('Google did not show a source')).toBeInTheDocument();
    // Empty stored history still reads as "not observed", never as zero-risk.
    expect(screen.getAllByText('Not observed yet').length).toBeGreaterThan(0);
  });

  it('renders the detail skeleton while the drill-in read is in flight', async () => {
    mocked.fetchSerpFeaturesRequest.mockResolvedValue(list([row()]));
    let resolve!: (value: SerpFeatureDetail) => void;
    mocked.fetchSerpFeatureDetailRequest.mockReturnValue(
      new Promise<SerpFeatureDetail>((r) => {
        resolve = r;
      }),
    );
    renderPanel('/sites/site-1?tab=serp-features&keyword=kw-1');
    expect(await screen.findByTestId('serp-features-detail-loading')).toBeInTheDocument();
    // With no detail yet the heading falls back to the localized title.
    expect(screen.getByText('Feature history')).toBeInTheDocument();
    resolve(detail());
    expect(await screen.findByTestId('serp-features-history')).toBeInTheDocument();
  });
});

describe('SerpFeaturesPanel — locale and RTL', () => {
  it('renders Arabic copy for every state', async () => {
    await changeLanguage('ar');
    mocked.fetchSerpFeaturesRequest.mockResolvedValue(
      list([row({ observedAt: null, features: [], ownedSnippet: null, ownedPaa: [] })]),
    );
    renderPanel();
    expect(await screen.findByTestId('serp-feature-not-observed')).toHaveTextContent(
      'لم يُرصد بعد',
    );
    await changeLanguage('en');
  });

  it('renders the localized Arabic capture-paused banner without hiding stored rows', async () => {
    await changeLanguage('ar');
    mocked.fetchSerpFeaturesRequest.mockResolvedValue(list([row()], false));
    renderPanel();
    expect(await screen.findByTestId('serp-features-capture-paused')).toHaveTextContent(
      'تم إيقاف التقاط خصائص نتائج البحث الجديدة مؤقتًا',
    );
    expect(screen.getByTestId('serp-features-row-kw-1')).toBeVisible();
    await changeLanguage('en');
  });
});

// ---------------------------------------------------------------------------
// Reducer guards — a stale/aborted response must never overwrite the surface.
// ---------------------------------------------------------------------------

describe('ranks slice — SERP feature guards', () => {
  const base = () => ranksReducer(undefined, { type: '@@init' });

  const pendingList = (siteId: string) => ({
    type: loadSerpFeatures.pending.type,
    meta: { arg: { siteId }, requestId: 'r1', requestStatus: 'pending' },
  });

  it('ignores a fulfilled list response for a superseded site', () => {
    const afterPending = ranksReducer(base(), pendingList('site-2'));
    const next = ranksReducer(afterPending, {
      type: loadSerpFeatures.fulfilled.type,
      payload: {
        siteId: 'site-1',
        captureEnabled: true,
        captureStatus: 'active',
        rows: [row()],
      },
      meta: { arg: { siteId: 'site-1' }, requestId: 'r0', requestStatus: 'fulfilled' },
    });
    expect(next.serpFeatureRows).toEqual([]);
    expect(next.serpFeaturesLoading).toBe(true);
  });

  it('stores the capture status from a successful stored-read response', () => {
    const afterPending = ranksReducer(base(), pendingList('site-1'));
    const next = ranksReducer(afterPending, {
      type: loadSerpFeatures.fulfilled.type,
      payload: list([row()], false),
      meta: { arg: { siteId: 'site-1' }, requestId: 'r1', requestStatus: 'fulfilled' },
    });
    expect(next.serpFeatureCaptureEnabled).toBe(false);
    expect(next.serpFeatureCaptureStatus).toBe('paused');
    expect(next.serpFeatureRows).toHaveLength(1);
  });

  it('ignores an aborted or superseded list rejection', () => {
    const afterPending = ranksReducer(base(), pendingList('site-2'));
    const aborted = ranksReducer(afterPending, {
      type: loadSerpFeatures.rejected.type,
      payload: undefined,
      meta: {
        arg: { siteId: 'site-2' },
        requestId: 'r1',
        requestStatus: 'rejected',
        aborted: true,
      },
    });
    expect(aborted.serpFeaturesLoading).toBe(true);

    const superseded = ranksReducer(afterPending, {
      type: loadSerpFeatures.rejected.type,
      payload: { error: 'boom', disabled: false },
      meta: {
        arg: { siteId: 'site-1' },
        requestId: 'r0',
        requestStatus: 'rejected',
        aborted: false,
      },
    });
    expect(superseded.serpFeaturesError).toBe('');
  });

  it('falls back to empty strings when a list rejection carries no payload', () => {
    const afterPending = ranksReducer(base(), pendingList('site-1'));
    const next = ranksReducer(afterPending, {
      type: loadSerpFeatures.rejected.type,
      payload: undefined,
      meta: {
        arg: { siteId: 'site-1' },
        requestId: 'r1',
        requestStatus: 'rejected',
        aborted: false,
      },
    });
    expect(next.serpFeaturesDisabled).toBe(false);
    expect(next.serpFeaturesError).toBe('');
    expect(next.serpFeaturesLoaded).toBe(true);
  });

  it('ignores superseded, aborted, and payload-less detail responses', () => {
    const afterPending = ranksReducer(base(), {
      type: loadSerpFeatureDetail.pending.type,
      meta: { arg: { keywordId: 'kw-2' }, requestId: 'd1', requestStatus: 'pending' },
    });

    const supersededFulfilled = ranksReducer(afterPending, {
      type: loadSerpFeatureDetail.fulfilled.type,
      payload: detail(),
      meta: { arg: { keywordId: 'kw-1' }, requestId: 'd0', requestStatus: 'fulfilled' },
    });
    expect(supersededFulfilled.serpFeatureDetail).toBeNull();

    const aborted = ranksReducer(afterPending, {
      type: loadSerpFeatureDetail.rejected.type,
      payload: undefined,
      meta: {
        arg: { keywordId: 'kw-2' },
        requestId: 'd1',
        requestStatus: 'rejected',
        aborted: true,
      },
    });
    expect(aborted.serpFeatureDetailLoading).toBe(true);

    const superseded = ranksReducer(afterPending, {
      type: loadSerpFeatureDetail.rejected.type,
      payload: { error: 'boom', disabled: false },
      meta: {
        arg: { keywordId: 'kw-1' },
        requestId: 'd0',
        requestStatus: 'rejected',
        aborted: false,
      },
    });
    expect(superseded.serpFeatureDetailError).toBe('');

    const noPayload = ranksReducer(afterPending, {
      type: loadSerpFeatureDetail.rejected.type,
      payload: undefined,
      meta: {
        arg: { keywordId: 'kw-2' },
        requestId: 'd1',
        requestStatus: 'rejected',
        aborted: false,
      },
    });
    expect(noPayload.serpFeatureDetailError).toBe('');
  });

  it('clearRanksMessages clears both SERP-feature errors', () => {
    const withErrors = {
      ...base(),
      serpFeaturesError: 'a',
      serpFeatureDetailError: 'b',
    };
    const next = ranksReducer(withErrors, { type: 'ranks/clearRanksMessages' });
    expect(next.serpFeaturesError).toBe('');
    expect(next.serpFeatureDetailError).toBe('');
  });
});

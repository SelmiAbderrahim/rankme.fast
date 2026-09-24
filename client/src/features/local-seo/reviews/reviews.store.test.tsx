/**
 * Slice + thunk behaviour, lazy-slice safety, and the Arabic RTL scope
 *. The reducer is injected lazily, so every selector must
 * survive a first render where `state.localSeoReviews` is still undefined.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { configureStore } from '@reduxjs/toolkit';
import { Provider } from 'react-redux';
import { I18nextProvider } from 'react-i18next';
import { MemoryRouter } from 'react-router-dom';
import type { RootState } from '@app/store';
import { ApiError, apiClient } from '@shared/api/client';
import { changeLanguage, i18n, initI18n } from '@shared/i18n';
import type { AuthSessionState } from '@features/auth';
import { ReviewsPanel } from './components/ReviewsPanel';
import * as selectors from './store/selectors';
import {
  clearReviewPreview,
  clearReviewSubmit,
  initialReviewIntelligenceState,
  localSeoReviewsReducer,
  resetReviewIntelligence,
} from './store/slice';
import {
  addReviewSource,
  loadReviewInventory,
  loadReviewRun,
  loadReviewRuns,
  loadReviewSources,
  loadReviewStats,
  loadReviewThemes,
  previewSync,
  removeReviewSource,
  reviewThunkError,
  submitSync,
} from './store/thunks';
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

const reduce = (actions: Array<{ type: string; payload?: unknown; meta?: unknown }>) =>
  actions.reduce(
    (state, action) => localSeoReviewsReducer(state, action as never),
    initialReviewIntelligenceState,
  );

beforeEach(async () => {
  initI18n({ initialLocale: 'en' });
  await changeLanguage('en');
  mockedApiClient.mockReset();
  authState = { authenticated: true, isPending: false, emailVerified: true, user: null };
});

describe('review thunk error classification', () => {
  it('maps 503 to locked, everything else to unknown', () => {
    expect(reviewThunkError(new ApiError('x', 503, {}), 'k').kind).toBe('locked');
    expect(reviewThunkError(new ApiError('x', 500, {}), 'k').kind).toBe('unknown');
    expect(reviewThunkError(new Error('offline'), 'reviewIntelligence:errors.syncFailed').kind).toBe(
      'unknown',
    );
  });
});

describe('review intelligence slice', () => {
  it('records the profile with a loaded source list', () => {
    const state = reduce([
      { type: loadReviewSources.pending.type },
      {
        type: loadReviewSources.fulfilled.type,
        payload: { sources: [reviewSource()] },
        meta: { arg: 'site-1' },
      },
    ]);
    expect(state.sourcesStatus).toBe('succeeded');
    expect(state.profileId).toBe('site-1');
  });

  it('ignores an aborted list rejection so a stale request cannot flash an error', () => {
    const state = reduce([
      { type: loadReviewSources.pending.type },
      { type: loadReviewSources.rejected.type, payload: 'boom', meta: { aborted: true } },
    ]);
    expect(state.sourcesStatus).toBe('loading');
    expect(state.sourcesError).toBe('');
  });

  it('records list errors that were not aborted', () => {
    const state = reduce([
      { type: loadReviewSources.rejected.type, payload: 'nope', meta: { aborted: false } },
      { type: loadReviewRuns.rejected.type, payload: 'runs down', meta: { aborted: false } },
      { type: loadReviewInventory.rejected.type, payload: 'inv down', meta: { aborted: false } },
    ]);
    expect(state.sourcesError).toBe('nope');
    expect(state.runsError).toBe('runs down');
    expect(state.inventoryError).toBe('inv down');
  });

  it('falls back to an empty message when a rejection carries no payload', () => {
    const state = reduce([
      { type: loadReviewSources.rejected.type, meta: { aborted: false } },
      { type: loadReviewRuns.rejected.type, meta: { aborted: false } },
      { type: loadReviewInventory.rejected.type, meta: { aborted: false } },
    ]);
    expect(state.sourcesError).toBe('');
    expect(state.runsError).toBe('');
    expect(state.inventoryError).toBe('');
    expect(state.sourcesStatus).toBe('failed');
  });

  it('drops aborted runs/inventory rejections too', () => {
    const state = reduce([
      { type: loadReviewRuns.rejected.type, payload: 'x', meta: { aborted: true } },
      { type: loadReviewInventory.rejected.type, payload: 'x', meta: { aborted: true } },
    ]);
    expect(state.runsStatus).toBe('idle');
    expect(state.inventoryStatus).toBe('idle');
  });

  it('upserts a saved source by name instead of duplicating the row', () => {
    const state = reduce([
      {
        type: loadReviewSources.fulfilled.type,
        payload: { sources: [reviewSource({ target: 'old' })] },
        meta: { arg: 'site-1' },
      },
      { type: addReviewSource.pending.type },
      { type: addReviewSource.fulfilled.type, payload: reviewSource({ target: 'new' }) },
    ]);
    expect(state.sources).toHaveLength(1);
    expect(state.sources[0]?.target).toBe('new');
  });

  it('removes a source and reports mutation failures with their kind', () => {
    const removed = reduce([
      {
        type: loadReviewSources.fulfilled.type,
        payload: { sources: [reviewSource()] },
        meta: { arg: 'site-1' },
      },
      { type: removeReviewSource.pending.type },
      { type: removeReviewSource.fulfilled.type, payload: { id: 'src-google' } },
    ]);
    expect(removed.sources).toHaveLength(0);

    const failedAdd = reduce([
      { type: addReviewSource.rejected.type, payload: { error: 'bad', kind: 'locked' } },
    ]);
    expect(failedAdd.sourceMutationErrorKind).toBe('locked');

    const bareAdd = reduce([{ type: addReviewSource.rejected.type }]);
    expect(bareAdd.sourceMutationError).toBe('');
    expect(bareAdd.sourceMutationErrorKind).toBe('unknown');

    const failedRemove = reduce([{ type: removeReviewSource.rejected.type }]);
    expect(failedRemove.sourceMutationErrorKind).toBe('unknown');
    expect(failedRemove.sourceMutationError).toBe('');
  });

  it('clears the estimate on cancel and on a successful submit', () => {
    const cancelled = reduce([
      { type: previewSync.pending.type },
      { type: previewSync.fulfilled.type, payload: spendPreview() },
      { type: clearReviewPreview.type },
    ]);
    expect(cancelled.preview).toBeNull();
    expect(cancelled.previewStatus).toBe('idle');

    const submitted = reduce([
      { type: previewSync.fulfilled.type, payload: spendPreview() },
      { type: submitSync.pending.type },
      {
        type: submitSync.fulfilled.type,
        payload: { runId: 'run-9', status: 'queued' },
      },
    ]);
    expect(submitted.preview).toBeNull();
    expect(submitted.lastSubmit?.runId).toBe('run-9');
  });

  it('keeps the refusal kind for preview and submit failures', () => {
    const state = reduce([
      { type: previewSync.rejected.type, payload: { error: 'bad input', kind: 'unknown' } },
      { type: submitSync.rejected.type, payload: { error: 'paused', kind: 'locked' } },
    ]);
    expect(state.previewErrorKind).toBe('unknown');
    expect(state.submitErrorKind).toBe('locked');

    const bare = reduce([
      { type: previewSync.rejected.type },
      { type: submitSync.rejected.type },
    ]);
    expect(bare.previewErrorKind).toBe('unknown');
    expect(bare.submitErrorKind).toBe('unknown');
  });

  it('clears the submit result and resets the whole slice', () => {
    const cleared = reduce([
      { type: submitSync.fulfilled.type, payload: { runId: 'run-9' } },
      { type: clearReviewSubmit.type },
    ]);
    expect(cleared.lastSubmit).toBeNull();

    const reset = reduce([
      {
        type: loadReviewSources.fulfilled.type,
        payload: { sources: [reviewSource()] },
        meta: { arg: 'site-1' },
      },
      { type: resetReviewIntelligence.type },
    ]);
    expect(reset).toEqual(initialReviewIntelligenceState);
  });

  it('tracks run, stats and theme reads through pending/fulfilled/rejected', () => {
    const ok = reduce([
      { type: loadReviewRuns.pending.type },
      { type: loadReviewRuns.fulfilled.type, payload: { runs: [reviewRun()], nextCursor: null } },
      { type: loadReviewRun.pending.type },
      { type: loadReviewRun.fulfilled.type, payload: reviewRun() },
      { type: loadReviewStats.pending.type },
      { type: loadReviewStats.fulfilled.type, payload: reviewStats() },
      { type: loadReviewThemes.pending.type },
      { type: loadReviewThemes.fulfilled.type, payload: reviewThemes() },
      { type: loadReviewInventory.pending.type },
      { type: loadReviewInventory.fulfilled.type, payload: inventoryResponse() },
    ]);
    expect(ok.runs).toHaveLength(1);
    expect(ok.run?.id).toBe('run-1');
    expect(ok.stats?.totalReviews).toBe(4);
    expect(ok.themes?.terminal).toBe('themes-ok');
    expect(ok.inventory?.total).toBe(1);

    const failed = reduce([
      { type: loadReviewRun.rejected.type, payload: 'run gone' },
      { type: loadReviewStats.rejected.type, payload: 'stats gone' },
      { type: loadReviewThemes.rejected.type, payload: 'themes gone' },
    ]);
    expect(failed.runError).toBe('run gone');
    expect(failed.statsError).toBe('stats gone');
    expect(failed.themesError).toBe('themes gone');

    const bare = reduce([
      { type: loadReviewRun.rejected.type },
      { type: loadReviewStats.rejected.type },
      { type: loadReviewThemes.rejected.type },
    ]);
    expect(bare.runError).toBe('');
    expect(bare.statsError).toBe('');
    expect(bare.themesError).toBe('');
  });
});

describe('lazy slice safety', () => {
  it('every selector falls back to the initial state before injection', () => {
    const empty = {} as RootState;
    for (const [name, selector] of Object.entries(selectors)) {
      expect(() => (selector as (state: RootState) => unknown)(empty), name).not.toThrow();
    }
    expect(selectors.selectReviewSources(empty)).toEqual([]);
    expect(selectors.selectReviewPreview(empty)).toBeNull();
    expect(selectors.selectReviewLastSubmit(empty)).toBeNull();
    expect(selectors.selectReviewSubmitStatus(empty)).toBe('idle');
    expect(selectors.selectReviewRunStatus(empty)).toBe('idle');
    expect(selectors.selectReviewSourceMutationErrorKind(empty)).toBeNull();
  });
});

describe('thunk transport failures', () => {
  it('every read thunk rejects with a localized fallback', async () => {
    mockedApiClient.mockRejectedValue(new ApiError('offline', 0, {}, 'network'));
    const store = configureStore({ reducer: { localSeoReviews: localSeoReviewsReducer } });
    await Promise.all([
      store.dispatch(loadReviewSources('site-1') as never),
      store.dispatch(loadReviewRuns('site-1') as never),
      store.dispatch(loadReviewRun('run-1') as never),
      store.dispatch(loadReviewStats('run-1') as never),
      store.dispatch(loadReviewThemes('run-1') as never),
      store.dispatch(
        loadReviewInventory({ profileId: 'site-1', filters: { page: 1 } }) as never,
      ),
      store.dispatch(addReviewSource({ profileId: 'site-1', source: 'google', target: 'x' }) as never),
      store.dispatch(removeReviewSource('src-google') as never),
      store.dispatch(previewSync({ profileId: 'site-1', sources: ['google'] }) as never),
      store.dispatch(submitSync({ profileId: 'site-1', sources: ['google'], depth: 10 }) as never),
    ]);
    const state = store.getState().localSeoReviews;
    expect(state.sourcesError).not.toBe('');
    expect(state.runsError).not.toBe('');
    expect(state.runError).not.toBe('');
    expect(state.statsError).not.toBe('');
    expect(state.themesError).not.toBe('');
    expect(state.inventoryError).not.toBe('');
    expect(state.sourceMutationError).not.toBe('');
    expect(state.previewError).not.toBe('');
    expect(state.submitError).not.toBe('');
  });

  it('sends every read on the documented path', async () => {
    mockedApiClient.mockResolvedValue({} as never);
    const store = configureStore({ reducer: { localSeoReviews: localSeoReviewsReducer } });
    await store.dispatch(loadReviewRun('run-1') as never);
    await store.dispatch(loadReviewStats('run-1') as never);
    await store.dispatch(loadReviewThemes('run-1') as never);
    await store.dispatch(removeReviewSource('src-1') as never);
    expect(mockedApiClient).toHaveBeenCalledWith('/local-seo/reviews/runs/run-1');
    expect(mockedApiClient).toHaveBeenCalledWith('/local-seo/reviews/stats/run-1');
    expect(mockedApiClient).toHaveBeenCalledWith('/local-seo/reviews/themes/run-1');
    expect(mockedApiClient).toHaveBeenCalledWith('/local-seo/reviews/sources/src-1', {
      method: 'DELETE',
    });
  });

  it('reads sources, runs and inventory without an abort signal when none is given', async () => {
    mockedApiClient
      .mockResolvedValueOnce({ sources: [] } as never)
      .mockResolvedValueOnce({ runs: [], nextCursor: null } as never)
      .mockResolvedValueOnce(
        inventoryResponse({ reviews: [], total: 0, observation: null }) as never,
      );
    const api = await import('./api');
    await api.fetchReviewSources('site-1');
    await api.fetchReviewRuns('site-1');
    await api.fetchReviewInventory('site-1', { page: 1 });
    expect(mockedApiClient).toHaveBeenCalledWith(
      '/local-seo/reviews/sources?profileId=site-1',
    );
    expect(mockedApiClient).toHaveBeenCalledWith('/local-seo/reviews/runs?profileId=site-1');
    expect(mockedApiClient).toHaveBeenCalledWith(
      '/local-seo/reviews/reviews?profileId=site-1&page=1',
    );
  });
});

describe('Arabic RTL scope', () => {
  it('sets dir="rtl" inside the tab for Arabic and back to ltr for English', async () => {
    mockedApiClient.mockImplementation(async (path: string) => {
      if (path.startsWith('/local-seo/reviews/sources')) return { sources: [] } as never;
      if (path.startsWith('/local-seo/reviews/runs')) {
        return { runs: [], nextCursor: null } as never;
      }
      if (path.startsWith('/local-seo/reviews/reviews')) {
        return inventoryResponse({ reviews: [], total: 0 }) as never;
      }
      throw new Error(`unexpected ${path}`);
    });
    await changeLanguage('ar');
    const store = configureStore({ reducer: { localSeoReviews: localSeoReviewsReducer } });
    render(
      <Provider store={store}>
        <I18nextProvider i18n={i18n}>
          <MemoryRouter initialEntries={['/sites/site-1?tab=reviews']}>
            <ReviewsPanel siteId="site-1" />
          </MemoryRouter>
        </I18nextProvider>
      </Provider>,
    );
    const panel = await screen.findByTestId('reviews-panel');
    await waitFor(() => expect(panel).toHaveAttribute('dir', 'rtl'));
    expect(panel).toHaveTextContent('المراجعات');
    await changeLanguage('en');
    await waitFor(() => expect(panel).toHaveAttribute('dir', 'ltr'));
  });
});

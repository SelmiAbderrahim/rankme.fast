import { describe, expect, it } from 'vitest';
import { presentationLocaleChanged } from '@shared/i18n';
import type { ActionItem } from '../types';
import { actionsReducer, initialState } from './slice';
import { loadActionHistory, loadActions } from './thunks';

const item = {
  id: 'action-1',
  siteId: 'site-1',
  problem: 'Old English problem',
} as ActionItem;

const arabicChange = presentationLocaleChanged({
  locale: 'ar',
  generation: 1,
  refreshGeneration: 1,
  reason: 'language-changed',
});

describe('actions presentation-locale coherence', () => {
  it('clears localized list/error state and rejects an old-generation fulfillment', () => {
    const oldArg = {
      siteId: 'site-1',
      requestSeq: 1,
      presentationLocale: 'en' as const,
      presentationGeneration: 0,
    };
    const pending = actionsReducer(
      initialState,
      loadActions.pending('old-request', oldArg),
    );
    const seeded = {
      ...pending,
      items: [item],
      listError: {
        message: 'Old English sentence',
        code: 'ACTIONS_ERRORS_LOAD_FAILED',
        messageKey: 'actions.errors.loadFailed',
        overCap: false,
        unauthorized: false,
        notFound: false,
      },
    };
    const switched = actionsReducer(seeded, arabicChange);
    const late = actionsReducer(
      switched,
      loadActions.fulfilled(
        {
          siteId: 'site-1',
          requestSeq: 1,
          response: { items: [item], sourceStatus: {}, nextCursor: null },
        },
        'old-request',
        oldArg,
      ),
    );

    expect(late.items).toEqual([]);
    expect(late.listError.message).toBe('');
    expect(late.listStatus).toBe('idle');
    expect(late.presentationLocale).toBe('ar');
  });

  it('uses different list cache identities for English and Arabic', () => {
    const english = actionsReducer(
      initialState,
      loadActions.pending('en', {
        siteId: 'site-1',
        requestSeq: 1,
        presentationLocale: 'en',
        presentationGeneration: 0,
      }),
    );
    const arabic = actionsReducer(
      actionsReducer(english, arabicChange),
      loadActions.pending('ar', {
        siteId: 'site-1',
        requestSeq: 2,
        presentationLocale: 'ar',
        presentationGeneration: 1,
      }),
    );

    expect(english.listCacheKey).toBe('actions:site-1:first::en');
    expect(arabic.listCacheKey).toBe('actions:site-1:first::ar');
  });

  it('ignores old-generation list rejections and history results', () => {
    const oldIdentity = {
      presentationLocale: 'en' as const,
      presentationGeneration: 0,
    };
    const switched = actionsReducer(
      {
        ...initialState,
        siteId: 'site-1',
        presentationLocale: 'ar',
        presentationGeneration: 1,
      },
      loadActions.rejected(
        null,
        'old-list',
        { siteId: 'site-1', requestSeq: 1, ...oldIdentity },
        { error: 'Old English' },
      ),
    );
    const historyFulfilled = actionsReducer(
      switched,
      loadActionHistory.fulfilled(
        { response: { entries: [] }, actionId: 'action-1' },
        'old-history',
        { siteId: 'site-1', actionId: 'action-1', ...oldIdentity },
      ),
    );
    const historyRejected = actionsReducer(
      historyFulfilled,
      loadActionHistory.rejected(
        null,
        'old-history',
        { siteId: 'site-1', actionId: 'action-1', ...oldIdentity },
        { error: 'Old English' },
      ),
    );

    expect(historyRejected.listError.message).toBe('');
    expect(historyRejected.history).toEqual({});
    expect(historyRejected.errors.history).toEqual({});
  });

  it('keys an unselected list in the new locale', () => {
    const switched = actionsReducer(initialState, arabicChange);
    expect(switched.listCacheKey).toBe('actions:unselected:first::ar');
  });
});

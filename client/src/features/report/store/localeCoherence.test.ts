import { describe, expect, it } from 'vitest';
import { presentationLocaleChanged } from '@shared/i18n';
import type { PublicAuditRun } from '../types';
import { reportReducer, initialState } from './slice';
import { loadReport, loadRuns, pollRun, startRetest } from './thunks';

const arabicChange = presentationLocaleChanged({
  locale: 'ar',
  generation: 1,
  refreshGeneration: 1,
  reason: 'language-changed',
});

describe('report presentation-locale coherence', () => {
  it('invalidates localized DTOs and errors while preserving source run data', () => {
    const sourceRun = {
      id: 'run-source',
      status: 'succeeded',
      createdAt: '2026-01-01T00:00:00.000Z',
    } as PublicAuditRun;
    const seeded = {
      ...initialState,
      siteId: 'site-1',
      runId: 'run-1',
      report: { runId: 'run-1' } as never,
      loaded: true,
      error: 'Old English sentence',
      retestError: 'Old English retest sentence',
      pdfError: 'Old English download sentence',
      runs: [sourceRun],
      runsLoaded: true,
      runsSiteId: 'site-1',
    };

    const next = reportReducer(seeded, arabicChange);

    expect(next.report).toBeNull();
    expect(next.loaded).toBe(false);
    expect(next.error).toBe('');
    expect(next.retestError).toBe('');
    expect(next.pdfError).toBe('');
    expect(next.runs).toEqual([sourceRun]);
    expect(next.presentationLocale).toBe('ar');
    expect(next.reportCacheKey).toContain('::ar');
  });

  it('ignores a fulfilled or rejected read captured under an older generation', () => {
    const oldArg = {
      siteId: 'site-1',
      presentationLocale: 'en' as const,
      presentationGeneration: 0,
    };
    const pending = reportReducer(
      initialState,
      loadReport.pending('old-request', oldArg),
    );
    const switched = reportReducer(pending, arabicChange);
    const fulfilled = reportReducer(
      switched,
      loadReport.fulfilled(
        { siteId: 'site-1', noRun: true },
        'old-request',
        oldArg,
      ),
    );
    const rejected = reportReducer(
      fulfilled,
      loadReport.rejected(null, 'old-request', oldArg, 'Old English error'),
    );

    expect(rejected.loaded).toBe(false);
    expect(rejected.error).toBe('');
    expect(rejected.presentationLocale).toBe('ar');
  });

  it('separates the same report resource by presentation locale', () => {
    const english = reportReducer(
      initialState,
      loadReport.pending('en', {
        siteId: 'site-1',
        runId: 'run-1',
        presentationLocale: 'en',
        presentationGeneration: 0,
      }),
    );
    const switched = reportReducer(english, arabicChange);
    const arabic = reportReducer(
      switched,
      loadReport.pending('ar', {
        siteId: 'site-1',
        runId: 'run-1',
        presentationLocale: 'ar',
        presentationGeneration: 1,
      }),
    );

    expect(english.reportCacheKey).toBe('report:site-1:run-1::en');
    expect(arabic.reportCacheKey).toBe('report:site-1:run-1::ar');
  });

  it('ignores stale poll and run-list results after a locale switch', () => {
    const oldIdentity = {
      presentationLocale: 'en' as const,
      presentationGeneration: 0,
    };
    const switched = reportReducer(
      {
        ...initialState,
        presentationLocale: 'ar',
        presentationGeneration: 1,
      },
      pollRun.fulfilled(
        { id: 'run-old', status: 'succeeded' } as PublicAuditRun,
        'old-poll',
        { runId: 'run-old', ...oldIdentity },
      ),
    );
    const afterRuns = reportReducer(
      switched,
      loadRuns.fulfilled(
        { runs: [{ id: 'run-old' } as PublicAuditRun], nextCursor: null },
        'old-runs',
        { siteId: 'site-1', ...oldIdentity },
      ),
    );

    expect(afterRuns.runId).toBeNull();
    expect(afterRuns.runs).toEqual([]);
  });

  it('ignores an aborted retest rejection', () => {
    const pending = reportReducer(
      initialState,
      startRetest.pending('retest', { siteId: 'site-1' }),
    );
    const aborted = {
      type: startRetest.rejected.type,
      payload: undefined,
      error: { message: 'Aborted' },
      meta: {
        arg: { siteId: 'site-1' },
        requestId: 'retest',
        requestStatus: 'rejected' as const,
        aborted: true,
        condition: false,
        rejectedWithValue: false,
      },
    };

    expect(reportReducer(pending, aborted as never).retesting).toBe(true);
  });

  it('uses unselected and latest fallbacks when invalidating an empty report state', () => {
    const switched = reportReducer(initialState, arabicChange);
    expect(switched.reportCacheKey).toBe('report:unselected:latest::ar');
  });
});

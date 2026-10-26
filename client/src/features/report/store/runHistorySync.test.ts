import { describe, expect, it } from 'vitest';
import type { PublicAuditRun, ReportState } from '../types';
import { initialState, reportReducer } from './slice';
import { loadReport, loadRuns } from './thunks';

const run = {
  id: 'run-1',
  siteId: 'site-1',
  status: 'succeeded',
  pageCap: 100,
  createdAt: '2026-07-01T00:00:00.000Z',
} as unknown as PublicAuditRun;

const apply = (state: ReportState, ...actions: Array<Parameters<typeof reportReducer>[1]>): ReportState =>
  actions.reduce((next, action) => reportReducer(next, action), state);

const loadedReport = (siteId: string, runId: string, runStatus: PublicAuditRun['status'] = 'succeeded') =>
  loadReport.fulfilled({ siteId, runId, report: null, runStatus }, 'rep', { siteId });

describe('audit history stays in step with the report', () => {
  it('reloads a cached history that does not list the run behind the loaded report', () => {
    const state = apply(
      { ...initialState, siteId: 'site-1' },
      loadRuns.pending('req-1', { siteId: 'site-1' }),
      loadRuns.fulfilled({ runs: [], nextCursor: null }, 'req-1', { siteId: 'site-1' }),
    );
    expect(state.runsLoaded).toBe(true);
    const after = apply(state, loadReport.pending('rep', { siteId: 'site-1' }), loadedReport('site-1', 'run-1'));
    expect(after.runsLoaded).toBe(false);
  });

  it('keeps a history that already lists the run with its status, and one cached for another site', () => {
    const cached = apply(
      { ...initialState, siteId: 'site-1' },
      loadRuns.pending('req-1', { siteId: 'site-1' }),
      loadRuns.fulfilled({ runs: [run], nextCursor: null }, 'req-1', { siteId: 'site-1' }),
    );
    expect(apply(cached, loadReport.pending('rep', { siteId: 'site-1' }), loadedReport('site-1', 'run-1')).runsLoaded).toBe(true);
    const other = apply(cached, loadReport.pending('rep-2', { siteId: 'site-2' }), loadedReport('site-2', 'run-9'));
    expect(other.runsLoaded).toBe(true);
  });

  it('reloads when the listed run has another status than the one on screen', () => {
    const cached = apply(
      { ...initialState, siteId: 'site-1' },
      loadRuns.pending('req-1', { siteId: 'site-1' }),
      loadRuns.fulfilled({ runs: [{ ...run, status: 'running' }], nextCursor: null }, 'req-1', { siteId: 'site-1' }),
    );
    const after = apply(cached, loadReport.pending('rep', { siteId: 'site-1' }), loadedReport('site-1', 'run-1'));
    expect(after.runsLoaded).toBe(false);
  });

  it.each(['fulfilled', 'rejected'] as const)(
    'a %s read from a superseded presentation identity releases the loading flags and stores nothing',
    (outcome) => {
      const arg = { siteId: 'site-1', presentationLocale: 'en' as const, presentationGeneration: 0 };
      const pending = apply({ ...initialState, siteId: 'site-1' }, loadRuns.pending('req-1', arg));
      // A report load under a newer identity moves the slice on meanwhile.
      const moved = apply(
        pending,
        loadReport.pending('rep-1', { siteId: 'site-1', presentationLocale: 'en', presentationGeneration: 1 }),
      );
      const settled = apply(
        moved,
        outcome === 'fulfilled'
          ? loadRuns.fulfilled({ runs: [run], nextCursor: null }, 'req-1', arg)
          : loadRuns.rejected(new Error('x'), 'req-1', arg, 'boom'),
      );
      expect(settled.runsLoading).toBe(false);
      expect(settled.runsRequestId).toBeNull();
      expect(settled.runsLoaded).toBe(false);
      expect(settled.runsError).toBe('');
      expect(settled.runs).toEqual([]);
    },
  );
});

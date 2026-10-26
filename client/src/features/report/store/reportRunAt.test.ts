import { describe, expect, it } from 'vitest';
import type { AuditReport } from '../types';
import { initialState, reportReducer } from './slice';
import { loadReport } from './thunks';

const report = { runId: 'run-1', findings: [], counts: { fixNow: 0, watch: 0, passed: 0 } } as unknown as AuditReport;

const fulfilled = (payload: Parameters<typeof loadReport.fulfilled>[0]) =>
  loadReport.fulfilled(payload, 'req', { siteId: 'site-1' });

const forSite = () => reportReducer({ ...initialState, siteId: 'site-1' }, { type: 'noop' });

describe('report run time', () => {
  it('keeps when the shown report finished, and drops it when there is no report', () => {
    const withReport = reportReducer(
      forSite(),
      fulfilled({ siteId: 'site-1', runId: 'run-1', report, runStatus: 'succeeded', runAt: '2026-07-01T00:00:00.000Z' }),
    );
    expect(withReport.reportRunAt).toBe('2026-07-01T00:00:00.000Z');

    const unknownTime = reportReducer(
      forSite(),
      fulfilled({ siteId: 'site-1', runId: 'run-1', report, runStatus: 'succeeded' }),
    );
    expect(unknownTime.reportRunAt).toBeNull();

    const running = reportReducer(
      withReport,
      fulfilled({ siteId: 'site-1', runId: 'run-2', report: null, runStatus: 'running', runAt: '2026-07-02T00:00:00.000Z' }),
    );
    expect(running.reportRunAt).toBeNull();

    const noRun = reportReducer(withReport, fulfilled({ siteId: 'site-1', noRun: true } as never));
    expect(noRun.reportRunAt).toBeNull();
  });
});

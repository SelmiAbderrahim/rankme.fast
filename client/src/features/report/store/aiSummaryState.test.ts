import { describe, expect, it } from 'vitest';
import { aiSummaryStateReceived, initialState, reportReducer } from './slice';

describe('report AI summary state', () => {
  it('keeps the newest accepted summary on the displayed report and ignores other runs', () => {
    const report = {
      runId: 'run-1',
      aiSummary: null,
      aiSummaryStatus: 'idle',
    } as NonNullable<typeof initialState.report>;
    const state = { ...initialState, report };
    const summary = {
      status: 'succeeded' as const,
      aiSummary: { text: 'Updated', locale: 'en' as const, model: 'test', truncated: false, createdAt: '2026-10-01' },
      requestedLocale: 'en' as const,
      availableLocales: ['en' as const],
    };
    const other = reportReducer(state, aiSummaryStateReceived({ runId: 'run-2', summary }));
    expect(other.report?.aiSummary).toBeNull();
    const updated = reportReducer(other, aiSummaryStateReceived({ runId: 'run-1', summary }));
    expect(updated.report?.aiSummary?.text).toBe('Updated');
    expect(updated.report?.aiSummaryStatus).toBe('succeeded');
  });
});

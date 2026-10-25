/** Job status — step derivation and failure-code mapping. */
import { describe, expect, it } from 'vitest';
import {
  CONTENT_ANALYSIS_FAILURE_REASONS,
  type ContentAnalysisDocument,
} from './content-analysis.model.js';
import {
  contentAnalysisFailureCode,
  contentAnalysisProgress,
  contentAnalysisRetryAction,
  contentAnalysisStep,
  toContentAnalysisJobStatus,
} from './content-analysis.job-status.js';

type Doc = Pick<ContentAnalysisDocument, 'status' | 'stages' | 'error'>;

function doc(overrides: Partial<Doc>): Doc {
  return {
    status: 'queued',
    stages: [],
    error: null,
    ...overrides,
  } as Doc;
}

const stage = (name: string) => ({ name, startedAt: new Date(), completedAt: null, error: null });

describe('contentAnalysisFailureCode', () => {
  it('maps every page reason to one of the page / timeout / provider codes', () => {
    const expected: Record<string, string> = {
      robots_blocked: 'page_blocked',
      access_denied: 'page_blocked',
      too_large: 'page_too_large',
      timeout: 'timeout',
      temporarily_unavailable: 'provider_unavailable',
    };
    for (const reason of CONTENT_ANALYSIS_FAILURE_REASONS) {
      expect(contentAnalysisFailureCode({ category: 'owned_page_unusable', reason })).toBe(
        expected[reason] ?? 'page_unreachable',
      );
    }
  });

  it('falls back on the category when no page reason was recorded', () => {
    expect(contentAnalysisFailureCode({ category: 'provider_unavailable' })).toBe('provider_unavailable');
    expect(contentAnalysisFailureCode({ category: 'owned_page_unusable', reason: null })).toBe('page_unreachable');
    expect(contentAnalysisFailureCode({ category: 'owned_fetch_failed' })).toBe('page_unreachable');
    expect(contentAnalysisFailureCode({ category: 'scoring_failed' })).toBe('internal');
    expect(contentAnalysisFailureCode({ category: 'unexpected' })).toBe('internal');
  });

  it('is null for a user cancel or no error', () => {
    expect(contentAnalysisFailureCode({ category: 'cancelled' })).toBeNull();
    expect(contentAnalysisFailureCode(null)).toBeNull();
    expect(contentAnalysisFailureCode(undefined)).toBeNull();
  });
});

describe('contentAnalysisRetryAction', () => {
  it('retries transient faults and sends page problems back to the URL', () => {
    expect(contentAnalysisRetryAction(null)).toBeNull();
    for (const code of ['provider_unavailable', 'timeout', 'internal'] as const) {
      expect(contentAnalysisRetryAction(code)).toBe('retry');
    }
    for (const code of ['page_unreachable', 'page_blocked', 'page_too_large'] as const) {
      expect(contentAnalysisRetryAction(code)).toBe('edit_url');
    }
  });
});

describe('contentAnalysisStep', () => {
  it('counts the current stage 1-based while running', () => {
    expect(contentAnalysisStep(doc({ status: 'queued' }))).toEqual({ stepIndex: 1, stepKey: 'queued' });
    expect(contentAnalysisStep(doc({ status: 'scoring' }))).toEqual({ stepIndex: 5, stepKey: 'scoring' });
  });

  it('reads 7 of 7 for completed and partial runs', () => {
    for (const status of ['completed', 'partial'] as const) {
      expect(contentAnalysisStep(doc({ status }))).toEqual({ stepIndex: 7, stepKey: 'generating_draft' });
    }
  });

  it('keeps the furthest stage a failed or cancelled run entered', () => {
    expect(
      contentAnalysisStep(
        doc({ status: 'failed', stages: [stage('queued'), stage('collecting_serp'), stage('failed')] as never }),
      ),
    ).toEqual({ stepIndex: 3, stepKey: 'collecting_serp' });
    expect(contentAnalysisStep(doc({ status: 'cancelled', stages: undefined as never }))).toEqual({
      stepIndex: 1,
      stepKey: 'queued',
    });
  });
});

describe('contentAnalysisProgress / toContentAnalysisJobStatus', () => {
  it('describes a failed run', () => {
    const failed = doc({
      status: 'failed',
      stages: [stage('queued'), stage('collecting_owned')] as never,
      error: { category: 'provider_unavailable', messageKey: 'x', retryable: false, terminal: true } as never,
    });
    expect(toContentAnalysisJobStatus({ ...failed, _id: 'abc' })).toEqual({
      analysisId: 'abc',
      status: 'failed',
      terminal: true,
      stepIndex: 2,
      stepCount: 7,
      stepKey: 'collecting_owned',
      failureReasonCode: 'provider_unavailable',
      retryAction: 'retry',
    });
  });

  it('reads a failed run without stored error detail as internal', () => {
    expect(contentAnalysisProgress(doc({ status: 'failed' }))).toMatchObject({
      failureReasonCode: 'internal',
      retryAction: 'retry',
    });
  });

  it('has no failure code for a cancelled run', () => {
    expect(
      contentAnalysisProgress(doc({ status: 'cancelled', error: { category: 'cancelled' } as never })),
    ).toMatchObject({ terminal: true, failureReasonCode: null, retryAction: null });
  });
});

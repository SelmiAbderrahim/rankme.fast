/**
 * Content-analysis job status.
 *
 * The one server-side reading of "where is this run and how did it end",
 * shared by the detail DTO, the list DTO and the slim status endpoint, so
 * the progress screen, the detail view and the list can never disagree.
 *
 * - `stepIndex` / `stepKey` come from the stages the run actually entered
 *   (1-based over the seven pipeline stages); a finished run reads 7 of 7,
 *   a failed or cancelled run keeps the step it stopped on.
 * - `failureReasonCode` narrows the stored error category + page reason to
 *   six user-facing codes, each with its own copy.
 * - `retryAction` tells the client which way out to offer: the same request
 *   again (`retry`) or a different URL (`edit_url`).
 */
import type {
  ContentAnalysisDocument,
  ContentAnalysisErrorCategory,
  ContentAnalysisFailureReason,
  ContentAnalysisStatus,
} from './content-analysis.model.js';
import { CONTENT_ANALYSIS_STAGE_ORDER, isTerminalStatus } from './content-analysis.state.js';

export const CONTENT_ANALYSIS_FAILURE_CODES = [
  'provider_unavailable',
  'page_unreachable',
  'page_blocked',
  'page_too_large',
  'timeout',
  'internal',
] as const;
export type ContentAnalysisFailureCode = (typeof CONTENT_ANALYSIS_FAILURE_CODES)[number];

export type ContentAnalysisStepKey = (typeof CONTENT_ANALYSIS_STAGE_ORDER)[number];
export type ContentAnalysisRetryAction = 'retry' | 'edit_url';

export interface ContentAnalysisProgress {
  terminal: boolean;
  stepIndex: number;
  stepCount: number;
  stepKey: ContentAnalysisStepKey;
  failureReasonCode: ContentAnalysisFailureCode | null;
  retryAction: ContentAnalysisRetryAction | null;
}

export interface ContentAnalysisJobStatus extends ContentAnalysisProgress {
  analysisId: string;
  status: ContentAnalysisStatus;
}

const STEP_COUNT = CONTENT_ANALYSIS_STAGE_ORDER.length;
const STEP_INDEX = new Map<string, number>(
  CONTENT_ANALYSIS_STAGE_ORDER.map((stage, index) => [stage, index]),
);

/** Codes that a fresh run of the same request can fix. */
const RETRYABLE_CODES: ReadonlySet<ContentAnalysisFailureCode> = new Set([
  'provider_unavailable',
  'timeout',
  'internal',
]);

const PAGE_REASON_CODES: Readonly<Record<ContentAnalysisFailureReason, ContentAnalysisFailureCode>> = {
  robots_blocked: 'page_blocked',
  access_denied: 'page_blocked',
  too_large: 'page_too_large',
  timeout: 'timeout',
  temporarily_unavailable: 'provider_unavailable',
  http_error: 'page_unreachable',
  empty_content: 'page_unreachable',
  unsafe_url: 'page_unreachable',
  unreadable: 'page_unreachable',
  redirect_loop: 'page_unreachable',
  redirect_limit: 'page_unreachable',
  unsafe_redirect: 'page_unreachable',
  non_html: 'page_unreachable',
};

/**
 * Narrow a stored failure to one user-facing code. `null` for runs that did
 * not fail (a user cancel is not a failure).
 */
export function contentAnalysisFailureCode(
  error: {
    category: ContentAnalysisErrorCategory;
    reason?: ContentAnalysisFailureReason | null;
  } | null | undefined,
): ContentAnalysisFailureCode | null {
  if (!error || error.category === 'cancelled') return null;
  if (error.reason) return PAGE_REASON_CODES[error.reason];
  switch (error.category) {
    case 'provider_unavailable':
      return 'provider_unavailable';
    case 'owned_page_unusable':
    case 'owned_fetch_failed':
      return 'page_unreachable';
    default:
      return 'internal';
  }
}

export function contentAnalysisRetryAction(
  code: ContentAnalysisFailureCode | null,
): ContentAnalysisRetryAction | null {
  if (code === null) return null;
  return RETRYABLE_CODES.has(code) ? 'retry' : 'edit_url';
}

/** The 1-based step the run is on (or stopped on). */
export function contentAnalysisStep(
  doc: Pick<ContentAnalysisDocument, 'status' | 'stages'>,
): { stepIndex: number; stepKey: ContentAnalysisStepKey } {
  if (doc.status === 'completed' || doc.status === 'partial') {
    return { stepIndex: STEP_COUNT, stepKey: CONTENT_ANALYSIS_STAGE_ORDER[STEP_COUNT - 1]! };
  }
  const current = STEP_INDEX.get(doc.status);
  if (current !== undefined) {
    return { stepIndex: current + 1, stepKey: CONTENT_ANALYSIS_STAGE_ORDER[current]! };
  }
  // Failed or cancelled: the furthest stage the run entered.
  const reached = (doc.stages ?? []).reduce(
    (furthest, stage) => Math.max(furthest, STEP_INDEX.get(stage.name) ?? 0),
    0,
  );
  return { stepIndex: reached + 1, stepKey: CONTENT_ANALYSIS_STAGE_ORDER[reached]! };
}

export function contentAnalysisProgress(
  doc: Pick<ContentAnalysisDocument, 'status' | 'stages' | 'error'>,
): ContentAnalysisProgress {
  const failureReasonCode = doc.status === 'failed'
    ? contentAnalysisFailureCode(doc.error) ?? 'internal'
    : null;
  return {
    terminal: isTerminalStatus(doc.status),
    ...contentAnalysisStep(doc),
    stepCount: STEP_COUNT,
    failureReasonCode,
    retryAction: contentAnalysisRetryAction(failureReasonCode),
  };
}

export function toContentAnalysisJobStatus(
  doc: Pick<ContentAnalysisDocument, 'status' | 'stages' | 'error'> & {
    _id: unknown;
  },
): ContentAnalysisJobStatus {
  return {
    analysisId: String(doc._id),
    status: doc.status,
    ...contentAnalysisProgress(doc),
  };
}

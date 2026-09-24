/**
 * Client mirrors of the Review Intelligence DTOs.
 * The server stays authoritative — these types describe what the wire
 * actually carries so the UI never re-derives a number it was handed.
 */
import type { ObservationMeta } from '@shared/observations/types';
import type { SupportedLocale } from '@shared/i18n';

export const REVIEW_SOURCES = ['google', 'trustpilot', 'tripadvisor'] as const;
export type ReviewSourceName = (typeof REVIEW_SOURCES)[number];

export const REVIEW_SYNC_MAX_DEPTH = 100;
/** Read-boundary excerpt bound; the UI clamps again so a stale row cannot grow. */
export const REVIEW_THEME_EXCERPT_MAX_CHARS = 300;
/** Inventory rows per page — matches `REVIEW_INVENTORY_PAGE_SIZE` on the server. */
export const REVIEW_INVENTORY_PAGE_SIZE = 50;
export const REVIEW_INVENTORY_SORTS = ['newest', 'rating-high', 'source'] as const;
export type ReviewInventorySort = (typeof REVIEW_INVENTORY_SORTS)[number];
/** Text clamp applied in the inventory row cell on top of the stored 1000-char clamp. */
export const REVIEW_ROW_TEXT_MAX_CHARS = 240;

export type ReviewSourceOutcome = 'ok' | 'failed' | 'zeroNew';
export type ReviewRunStatus = 'queued' | 'running' | 'succeeded' | 'partial' | 'failed';
export type ReviewAiTerminalState =
  | 'pending'
  | 'themes-ok'
  | 'no-reliable-themes'
  | 'ai-failed-reviews-intact';

export interface ReviewSource {
  id: string;
  profileId: string;
  source: ReviewSourceName;
  target: string;
  createdAt: string;
  updatedAt: string;
}

export interface ReviewSourceListResponse {
  sources: ReviewSource[];
}

export interface ReviewRunPerSourceOutcome {
  source: ReviewSourceName;
  outcome: ReviewSourceOutcome;
  retained: number;
  errorCode: string | null;
}

export interface ReviewRun {
  id: string;
  profileId: string;
  sources: ReviewSourceName[];
  depth: number;
  outputLocale: SupportedLocale | null;
  status: ReviewRunStatus;
  perSourceOutcomes: ReviewRunPerSourceOutcome[];
  retainedCount: number;
  aiTerminalState: ReviewAiTerminalState;
  aiCostMicros: number | null;
  aiPassStartedAt: string | null;
  aiCompletedAt: string | null;
  aiInputCount: number | null;
  aiThemeCount: number;
  createdAt: string;
  completedAt: string | null;
}

export interface ReviewRunListResponse {
  runs: ReviewRun[];
  nextCursor: string | null;
}

export interface ReviewRow {
  id: string;
  source: ReviewSourceName;
  sourceReviewId: string;
  rating: number | null;
  title: string | null;
  text: string;
  authorDisplayName: string | null;
  language: string | null;
  reviewedAt: string | null;
  fetchedAt: string;
}

export interface ReviewInventoryResponse {
  reviews: ReviewRow[];
  page: number;
  pageSize: number;
  total: number;
  hasMore: boolean;
  observation: ObservationMeta | null;
}

export interface ReviewRatingHistogram {
  1: number;
  2: number;
  3: number;
  4: number;
  5: number;
  unrated: number;
}

export type ReviewPerSourceCounts = Record<ReviewSourceName, number>;
export type ReviewPerSourceAverages = Record<ReviewSourceName, number | null>;

export interface ReviewVelocityBucket {
  ymKey: string;
  total: number;
  perSource: ReviewPerSourceCounts;
}

export interface ReviewTrendBucket {
  ymKey: string;
  /** `null` is a GAP month — never render it as zero stars. */
  total: number | null;
  perSource: ReviewPerSourceAverages;
}

export interface ReviewSourceMix extends ReviewPerSourceCounts {
  total: number;
}

export interface ReviewStats {
  runId: string;
  profileId: string;
  totalReviews: number;
  ratingHistogram: ReviewRatingHistogram;
  monthlyVelocity: ReviewVelocityBucket[];
  averageRatingTrend: ReviewTrendBucket[];
  sourceMix: ReviewSourceMix;
  observation: ObservationMeta | null;
}

export interface ReviewThemeCitation {
  /** Owned stored ReviewRow id; stable even when vendor ids collide by source. */
  reviewId: string;
  sourceReviewId: string;
  source: ReviewSourceName;
  rating: number | null;
  reviewedAt: string | null;
  excerpt: string;
}

export interface ReviewTheme {
  label: string;
  summary: string;
  citedReviewIds: string[];
  citations: ReviewThemeCitation[];
}

export interface ReviewThemesResponse {
  runId: string;
  outputLocale: SupportedLocale | null;
  terminal: ReviewAiTerminalState;
  complaintThemes: ReviewTheme[];
  praiseThemes: ReviewTheme[];
  observation: ObservationMeta | null;
}

/** Opaque server preview returned before the paid sync; the client reads no fields from it. */
export type ReviewSpendPreview = Record<string, unknown>;

export interface ReviewSyncSubmitResult {
  runId: string;
  status: 'queued';
  profileId: string;
  sources: ReviewSourceName[];
  depth: number;
  outputLocale: SupportedLocale;
}

/** 503 → the kill switch or a missing queue, anything else → generic. */
export type ReviewErrorKind = 'locked' | 'unknown';

export interface ReviewThunkError {
  error: string;
  kind: ReviewErrorKind;
}

export interface ReviewInventoryFilters {
  src?: ReviewSourceName;
  rating?: number;
  q?: string;
  sort?: ReviewInventorySort;
  page: number;
}

export type ReviewRequestStatus = 'idle' | 'loading' | 'succeeded' | 'failed';

export interface ReviewIntelligenceState {
  profileId: string | null;
  sources: ReviewSource[];
  sourcesStatus: ReviewRequestStatus;
  sourcesError: string;
  sourceMutationStatus: ReviewRequestStatus;
  sourceMutationError: string;
  sourceMutationErrorKind: ReviewErrorKind | null;
  runs: ReviewRun[];
  runsStatus: ReviewRequestStatus;
  runsError: string;
  run: ReviewRun | null;
  runStatus: ReviewRequestStatus;
  runError: string;
  inventory: ReviewInventoryResponse | null;
  inventoryStatus: ReviewRequestStatus;
  inventoryError: string;
  stats: ReviewStats | null;
  statsStatus: ReviewRequestStatus;
  statsError: string;
  themes: ReviewThemesResponse | null;
  themesStatus: ReviewRequestStatus;
  themesError: string;
  preview: ReviewSpendPreview | null;
  previewStatus: ReviewRequestStatus;
  previewError: string;
  previewErrorKind: ReviewErrorKind | null;
  submitStatus: ReviewRequestStatus;
  submitError: string;
  submitErrorKind: ReviewErrorKind | null;
  lastSubmit: ReviewSyncSubmitResult | null;
}

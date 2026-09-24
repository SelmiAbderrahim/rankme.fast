import type {
  ReviewInventoryResponse,
  ReviewRow,
  ReviewRun,
  ReviewSource,
  ReviewSpendPreview,
  ReviewStats,
  ReviewThemesResponse,
} from '../types';

export const SCRIPT_PAYLOAD = '<script>window.__pwned = 1;</script>Great coffee';
/** Excel/Sheets formula prefixes, plus the leading-whitespace and \t/\r variants. */
export const FORMULA_PAYLOADS = ['=SUM(A1)', '+1+1', '-1-1', '@SUM(A1)', '\tcmd', '\rcmd'];
/** U+202E RIGHT-TO-LEFT OVERRIDE — flips rendering of everything that follows. */
export const RTL_OVERRIDE_PAYLOAD = 'invoice‮gnp.exe';

export const reviewSource = (overrides: Partial<ReviewSource> = {}): ReviewSource => ({
  id: 'src-google',
  profileId: 'site-1',
  source: 'google',
  target: 'ChIJexample',
  createdAt: '2026-07-01T00:00:00.000Z',
  updatedAt: '2026-07-01T00:00:00.000Z',
  ...overrides,
});

export const reviewRow = (overrides: Partial<ReviewRow> = {}): ReviewRow => ({
  id: 'row-1',
  source: 'google',
  sourceReviewId: 'g-1',
  rating: 5,
  title: 'Lovely',
  text: 'Staff were kind and the room was spotless.',
  authorDisplayName: 'Sam',
  language: 'en',
  reviewedAt: '2026-06-15T00:00:00.000Z',
  fetchedAt: '2026-07-01T00:00:00.000Z',
  ...overrides,
});

export const inventoryResponse = (
  overrides: Partial<ReviewInventoryResponse> = {},
): ReviewInventoryResponse => ({
  reviews: [reviewRow()],
  page: 1,
  pageSize: 50,
  total: 1,
  hasMore: false,
  observation: {
    sourceKind: 'provider_observation',
    sourceLabel: null,
    observedAt: '2026-07-01T00:00:00.000Z',
    freshUntil: null,
    freshness: 'fresh',
    market: null,
    sampleCount: 1,
    coverageNoteKey: null,
  },
  ...overrides,
});

export const reviewRun = (overrides: Partial<ReviewRun> = {}): ReviewRun => ({
  id: 'run-1',
  profileId: 'site-1',
  sources: ['google'],
  depth: 100,
  status: 'succeeded',
  perSourceOutcomes: [{ source: 'google', outcome: 'ok', retained: 3, errorCode: null }],
  retainedCount: 3,
  aiTerminalState: 'themes-ok',
  aiCostMicros: 900,
  aiPassStartedAt: '2026-07-20T09:00:30.000Z',
  aiCompletedAt: '2026-07-20T09:00:31.000Z',
  aiInputCount: 3,
  aiThemeCount: 2,
  createdAt: '2026-07-20T09:00:00.000Z',
  completedAt: '2026-07-20T09:01:00.000Z',
  ...overrides,
  outputLocale: overrides.outputLocale === undefined ? 'en' : overrides.outputLocale,
});

export const reviewStats = (overrides: Partial<ReviewStats> = {}): ReviewStats => ({
  runId: 'run-1',
  profileId: 'site-1',
  totalReviews: 4,
  ratingHistogram: { 1: 1, 2: 0, 3: 0, 4: 1, 5: 2, unrated: 0 },
  monthlyVelocity: [
    { ymKey: '2026-04', total: 2, perSource: { google: 2, trustpilot: 0, tripadvisor: 0 } },
    { ymKey: '2026-05', total: 0, perSource: { google: 0, trustpilot: 0, tripadvisor: 0 } },
    { ymKey: '2026-06', total: 2, perSource: { google: 1, trustpilot: 1, tripadvisor: 0 } },
  ],
  averageRatingTrend: [
    { ymKey: '2026-04', total: 4.5, perSource: { google: 4.5, trustpilot: null, tripadvisor: null } },
    // Gap month — `null` must render as a break, never as zero stars.
    { ymKey: '2026-05', total: null, perSource: { google: null, trustpilot: null, tripadvisor: null } },
    { ymKey: '2026-06', total: 3, perSource: { google: 5, trustpilot: 1, tripadvisor: null } },
  ],
  sourceMix: { google: 3, trustpilot: 1, tripadvisor: 0, total: 4 },
  observation: {
    sourceKind: 'provider_observation',
    sourceLabel: null,
    observedAt: '2026-07-01T00:00:00.000Z',
    freshUntil: null,
    freshness: 'fresh',
    market: null,
    sampleCount: 4,
    coverageNoteKey: null,
  },
  ...overrides,
});

export const reviewThemes = (
  overrides: Partial<ReviewThemesResponse> = {},
): ReviewThemesResponse => ({
  runId: 'run-1',
  terminal: 'themes-ok',
  complaintThemes: [
    {
      label: 'Slow check-in',
      summary: 'Guests wait at the desk on arrival.',
      citedReviewIds: ['row-g-1', 'row-g-2'],
      citations: [
        {
          reviewId: 'row-g-1',
          sourceReviewId: 'g-1',
          source: 'google',
          rating: 2,
          reviewedAt: '2026-06-10T00:00:00.000Z',
          excerpt: 'Waited twenty minutes to check in.',
        },
        {
          reviewId: 'row-g-2',
          sourceReviewId: 'g-2',
          source: 'trustpilot',
          rating: 3,
          reviewedAt: null,
          excerpt: 'Front desk was understaffed.',
        },
      ],
    },
  ],
  praiseThemes: [
    {
      label: 'Clean rooms',
      summary: 'Rooms are consistently spotless.',
      citedReviewIds: ['row-g-3', 'row-g-4'],
      citations: [
        {
          reviewId: 'row-g-3',
          sourceReviewId: 'g-3',
          source: 'google',
          rating: 5,
          reviewedAt: '2026-06-15T00:00:00.000Z',
          excerpt: 'Spotless room, great shower.',
        },
        {
          reviewId: 'row-g-4',
          sourceReviewId: 'g-4',
          source: 'tripadvisor',
          rating: 5,
          reviewedAt: '2026-06-16T00:00:00.000Z',
          excerpt: 'Immaculate throughout.',
        },
      ],
    },
  ],
  observation: {
    sourceKind: 'ai_interpretation',
    sourceLabel: 'rankme_ai',
    observedAt: '2026-07-20T09:00:31.000Z',
    freshUntil: null,
    freshness: 'fresh',
    market: null,
    sampleCount: 4,
    coverageNoteKey: 'observations.coverage.aiInterpretation',
  },
  ...overrides,
  outputLocale: overrides.outputLocale === undefined ? 'en' : overrides.outputLocale,
});

/** An opaque server spend preview. */
export const spendPreview = (): ReviewSpendPreview => ({});

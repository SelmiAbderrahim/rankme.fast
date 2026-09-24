import { z } from 'zod';
import { APP_STORE_ID_REGEX, PLAY_PACKAGE_ID_REGEX } from './validation';

export type AppResearchSurface = 'keywords' | 'gap' | 'competitors';
export type AppResearchStatus = 'idle' | 'loading' | 'succeeded' | 'failed';
export type AppResearchStore = 'google_play' | 'app_store';

/** Opaque server preview returned before a paid vendor call; the client reads no fields from it. */
export type AppResearchSpendPreview = Record<string, unknown>;

export interface AppResearchObservationMeta {
  source?: string;
  observedAt?: string;
  [key: string]: unknown;
}

export interface AppKeywordResearchRow {
  store: AppResearchStore;
  appId: string;
  keyword: string;
  rank: number | null;
  absoluteRank: number | null;
  lastUpdatedAt: string | null;
  observationMeta: AppResearchObservationMeta;
}

export interface AppGapResearchRow {
  store: AppResearchStore;
  keyword: string;
  ranksByAppId: Record<string, { rank: number | null; absoluteRank: number | null }>;
  lastUpdatedAt: string | null;
  observationMeta: AppResearchObservationMeta;
}

export interface AppRankingMetrics {
  firstPositionCount: number;
  secondToThirdPositionCount: number;
  fourthToTenthPositionCount: number;
  eleventhToHundredthPositionCount: number;
  rankedKeywordCount: number;
  rankingKeywordSearchVolume: number;
}

export interface AppCompetitorResearchRow {
  competitor: {
    store: AppResearchStore;
    appId: string;
    averagePosition: number | null;
    summedPosition: number | null;
    sharedKeywordCount: number;
    sharedKeywordMetrics: AppRankingMetrics;
    allKeywordMetrics: AppRankingMetrics;
    observationMeta: AppResearchObservationMeta;
  };
  metrics: {
    store: AppResearchStore;
    appId: string;
    metrics: AppRankingMetrics;
    observationMeta: AppResearchObservationMeta;
  } | null;
}

export interface AppKeywordResearchResult {
  surface: 'keywords';
  profileId: string;
  store: AppResearchStore;
  appId: string;
  rows: AppKeywordResearchRow[];
  cursor: number;
  nextCursor: number | null;
  totalRows: number;
  cached: boolean;
  fetchedAt: string;
}

export interface AppGapResearchResult {
  surface: 'gap';
  profileId: string;
  store: AppResearchStore;
  ownAppId: string;
  appIds: string[];
  rows: AppGapResearchRow[];
  cached: boolean;
  fetchedAt: string;
}

export interface AppCompetitorResearchResult {
  surface: 'competitors';
  profileId: string;
  store: AppResearchStore;
  appId: string;
  rows: AppCompetitorResearchRow[];
  partial: boolean;
  noteKey: string | null;
  cached: boolean;
  fetchedAt: string;
}

export type AppResearchResult =
  | AppKeywordResearchResult
  | AppGapResearchResult
  | AppCompetitorResearchResult;

export interface AppSeoResearchState {
  siteId: string | null;
  profileId: string | null;
  store: AppResearchStore;
  results: {
    keywords: AppKeywordResearchResult | null;
    gap: AppGapResearchResult | null;
    competitors: AppCompetitorResearchResult | null;
  };
  researchEnabled: boolean;
  loadStatus: AppResearchStatus;
  mutationStatus: AppResearchStatus;
  preview: { surface: AppResearchSurface; value: AppResearchSpendPreview } | null;
  error: string;
}

const baseSchema = z.object({
  profileId: z.string().trim().min(1).max(64),
  store: z.enum(['google_play', 'app_store']),
  locationCode: z.literal(2840),
  languageCode: z.literal('en'),
});

export const appKeywordResearchInputSchema = baseSchema.extend({
  cursor: z.number().int().min(0).max(99).default(0),
  pageSize: z.number().int().positive().max(100).default(25),
});

export const appGapResearchInputSchema = baseSchema.extend({
  appIds: z.array(z.string().trim().min(1).max(255)).min(2).max(20),
}).superRefine((value, context) => {
  const regex = value.store === 'google_play' ? PLAY_PACKAGE_ID_REGEX : APP_STORE_ID_REGEX;
  value.appIds.forEach((appId, index) => {
    if (!regex.test(appId)) context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['appIds', index],
      message: 'invalidAppId',
    });
  });
});

export const appCompetitorResearchInputSchema = baseSchema;

export type AppKeywordResearchInput = z.infer<typeof appKeywordResearchInputSchema>;
export type AppGapResearchInput = z.infer<typeof appGapResearchInputSchema>;
export type AppCompetitorResearchInput = z.infer<typeof appCompetitorResearchInputSchema>;

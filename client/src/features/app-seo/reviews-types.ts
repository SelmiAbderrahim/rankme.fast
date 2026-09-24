import type { AppStoreKind } from './tracking-types';

export type AppReviewRunStatus = 'queued' | 'pulling' | 'clustering' | 'completed' | 'failed';
export type AppReviewClusterState = 'pending' | 'available' | 'thin_evidence' | 'unavailable';
export type AppSeoReviewsRequestStatus = 'idle' | 'loading' | 'succeeded' | 'failed';

/** Opaque server preview returned before a paid vendor call; the client reads no fields from it. */
export type AppReviewSpendPreview = Record<string, unknown>;

export interface AppReviewRunListItem {
  id: string;
  profileId: string;
  store: AppStoreKind;
  status: AppReviewRunStatus;
  clusterState: AppReviewClusterState;
  reviewCount: number;
  averageRating: number | null;
  createdAt: string;
  completedAt: string | null;
}

export interface AppReviewStats {
  total: number;
  averageRating: number | null;
  histogram: Array<{ star: number; count: number }>;
  ratingMix: { positive: number; neutral: number; negative: number };
  volumeTrend: Array<{ period: string; count: number; averageRating: number }>;
}

export interface AppReviewClusterCitation {
  reviewId: string;
  quote: string;
  authorName: string | null;
  rating: number;
  at: string | null;
}

export interface AppReviewCluster {
  label: string;
  sentiment: 'positive' | 'neutral' | 'negative' | 'mixed';
  citedReviewIds: string[];
  citations: AppReviewClusterCitation[];
  observationMeta: { sourceKind: 'ai_interpretation' };
}

export interface AppReviewRunDetail extends AppReviewRunListItem {
  locationCode: number;
  languageCode: string;
  stats: AppReviewStats | null;
  clusters: AppReviewCluster[];
  observationMeta: { sourceKind: string } | null;
}

export interface AppReviewRunListResponse {
  items: AppReviewRunListItem[];
  reviewsEnabled: boolean;
}

export interface StartAppReviewRunInput {
  profileId: string;
  store: AppStoreKind;
  confirm: boolean;
  locationCode?: number;
  languageCode?: string;
}

export interface StartAppReviewRunResponse {
  preview: AppReviewSpendPreview;
  queued: boolean;
  run: AppReviewRunListItem | null;
}

export interface AppSeoReviewsState {
  siteId: string | null;
  profileId: string | null;
  store: AppStoreKind | null;
  items: AppReviewRunListItem[];
  selectedRun: AppReviewRunDetail | null;
  selectedRunId: string | null;
  reviewsEnabled: boolean;
  listStatus: AppSeoReviewsRequestStatus;
  detailStatus: AppSeoReviewsRequestStatus;
  mutationStatus: AppSeoReviewsRequestStatus;
  preview: StartAppReviewRunResponse | null;
  error: string;
}


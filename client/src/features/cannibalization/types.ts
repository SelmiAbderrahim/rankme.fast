/**
 * Wire types for cannibalization reports. Kept in lockstep with
 * `server/src/modules/cannibalization/cannibalization.service.ts`.
 */
/**
 * The server's advisory preview. This surface only needs to know a preview
 * arrived (the confirm button waits for it); it renders none of its fields.
 */
export type CannibalizationSpendPreview = Record<string, unknown>;

export const CANNIBALIZATION_WINDOWS = [7, 28, 90] as const;
export type CannibalizationWindow = (typeof CANNIBALIZATION_WINDOWS)[number];
export const DEFAULT_CANNIBALIZATION_WINDOW: CannibalizationWindow = 28;

export const CANNIBALIZATION_CONFIDENCE_LEVELS = ['high', 'medium', 'low'] as const;
export type CannibalizationConfidence =
  (typeof CANNIBALIZATION_CONFIDENCE_LEVELS)[number];

export type PrimaryPageReason = 'most_clicks' | 'best_position' | 'stable_order';

export interface CandidatePage {
  url: string;
  clicks: number;
  impressions: number;
  position: number;
  clickShare: number;
  impressionShare: number;
  isPrimary: boolean;
}

export interface CannibalizationCandidate {
  id: string;
  query: string;
  confidence: CannibalizationConfidence;
  sourceKind: 'first_party';
  windowDays: number;
  snapshotDate: string;
  totalClicks: number;
  totalImpressions: number;
  primaryUrl: string;
  primaryReason: PrimaryPageReason;
  pages: CandidatePage[];
}

export interface CannibalizationReportSummary {
  id: string;
  siteId: string;
  windowDays: number;
  snapshotDate: string;
  generatedAt: string;
  queriesAnalyzed: number;
  candidateCount: number;
  pagesInvolved: number;
}

export interface CannibalizationReportDetail extends CannibalizationReportSummary {
  candidates: CannibalizationCandidate[];
}

/**
 * Every honest refusal the surface can render. `failed` is the catch-all so an
 * unexpected status is still disclosed rather than silently swallowed.
 */
export type CannibalizationGateKind =
  | 'awaitingSync'
  | 'disabled'
  | 'notFound'
  | 'rateLimited'
  | 'failed';

export interface CannibalizationGate {
  kind: CannibalizationGateKind;
  message: string;
}

export type RequestStatus = 'idle' | 'loading' | 'succeeded' | 'failed';

export interface CannibalizationState {
  sitesStatus: RequestStatus;
  sitesError: string;
  gscConnected: boolean | null;
  reports: CannibalizationReportSummary[];
  listStatus: RequestStatus;
  listGate: CannibalizationGate | null;
  detail: CannibalizationReportDetail | null;
  detailStatus: RequestStatus;
  detailGate: CannibalizationGate | null;
  preview: CannibalizationSpendPreview | null;
  previewStatus: RequestStatus;
  previewGate: CannibalizationGate | null;
  generateStatus: RequestStatus;
  generateGate: CannibalizationGate | null;
}

export const initialCannibalizationState: CannibalizationState = {
  sitesStatus: 'idle',
  sitesError: '',
  gscConnected: null,
  reports: [],
  listStatus: 'idle',
  listGate: null,
  detail: null,
  detailStatus: 'idle',
  detailGate: null,
  preview: null,
  previewStatus: 'idle',
  previewGate: null,
  generateStatus: 'idle',
  generateGate: null,
};

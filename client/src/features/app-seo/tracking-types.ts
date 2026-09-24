export type AppStoreKind = 'google_play' | 'app_store';
export type AppKeywordCheckStatus = 'idle' | 'queued' | 'succeeded' | 'failed';

export interface AppKeyword {
  id: string;
  profileId: string;
  store: AppStoreKind;
  phrase: string;
  locationCode: number;
  languageCode: string;
  active: boolean;
  latestPosition: number | null;
  previousPosition: number | null;
  delta: number | null;
  lastCheckedAt: string | null;
  lastFailedCheckAt: string | null;
  checkStatus: AppKeywordCheckStatus;
  createdAt: string;
}

/** Opaque server preview returned before a paid vendor call; the client reads no fields from it. */
export type AppKeywordSpendPreview = Record<string, unknown>;

export interface AppKeywordListResponse {
  items: AppKeyword[];
  trackingEnabled: boolean;
}

export interface MintAppKeywordInput {
  phrase: string;
  store: AppStoreKind;
  locationCode?: number;
  languageCode?: string;
}

export interface MintAppKeywordPreview {
  check: AppKeywordSpendPreview;
}

export interface RecheckAppKeywordResponse {
  preview: AppKeywordSpendPreview;
  queued: boolean;
  reservationStamp: string | null;
}

export interface AppKeywordHistoryPoint {
  checkedAt: string;
  position: number | null;
  rankAbsolute: number | null;
  foundAppId: string | null;
}

export type AppSeoTrackingRequestStatus = 'idle' | 'loading' | 'succeeded' | 'failed';

export interface AppSeoTrackingState {
  siteId: string | null;
  profileId: string | null;
  items: AppKeyword[];
  trackingEnabled: boolean;
  listStatus: AppSeoTrackingRequestStatus;
  mutationStatus: AppSeoTrackingRequestStatus;
  error: string;
  mintPreview: MintAppKeywordPreview | null;
  recheckPreview: RecheckAppKeywordResponse | null;
  selectedKeywordId: string | null;
  history: AppKeywordHistoryPoint[];
  historyStatus: AppSeoTrackingRequestStatus;
}

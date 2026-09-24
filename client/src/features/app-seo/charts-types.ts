import type { AppStoreKind } from './tracking-types';

export interface AppChartCatalogEntry {
  id: string;
  nameKey: string;
}

export interface AppChartCatalog {
  store: AppStoreKind;
  charts: AppChartCatalogEntry[];
  categories: AppChartCatalogEntry[];
}

export interface AppChartSubscription {
  id: string;
  profileId: string;
  store: AppStoreKind;
  chartId: string;
  categoryId: string;
  locationCode: number;
  languageCode: string;
  latestPosition: number | null;
  previousPosition: number | null;
  delta: number | null;
  lastCheckedAt: string | null;
  createdAt: string;
}

export interface AppChartHistoryPoint {
  checkedAt: string;
  position: number | null;
}

/** Opaque server preview returned before a paid vendor call; the client reads no fields from it. */
export type AppChartSpendPreview = Record<string, unknown>;

export interface AppChartListResponse {
  items: AppChartSubscription[];
  catalogs: Record<AppStoreKind, AppChartCatalog>;
  limit: number;
  trackingEnabled: boolean;
}

export interface CreateAppChartSubscriptionInput {
  profileId: string;
  store: AppStoreKind;
  chartId: string;
  categoryId: string;
  locationCode?: number;
  languageCode?: string;
}

export interface RecheckAppChartResponse {
  preview: AppChartSpendPreview;
  queued: boolean;
  reservationStamp: string | null;
}

export type AppSeoChartsRequestStatus = 'idle' | 'loading' | 'succeeded' | 'failed';

export interface AppSeoChartsState {
  siteId: string | null;
  profileId: string | null;
  items: AppChartSubscription[];
  catalogs: Record<AppStoreKind, AppChartCatalog>;
  limit: number;
  trackingEnabled: boolean;
  listStatus: AppSeoChartsRequestStatus;
  mutationStatus: AppSeoChartsRequestStatus;
  error: string;
  recheckPreview: RecheckAppChartResponse | null;
  selectedSubscriptionId: string | null;
  history: AppChartHistoryPoint[];
  historyStatus: AppSeoChartsRequestStatus;
}

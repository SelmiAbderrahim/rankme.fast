import type { AppStoreKind } from './tracking-types';

export type AppListingRequestStatus = 'idle' | 'loading' | 'succeeded' | 'failed';
export type AppListingSeverity = 'fixNow' | 'watch' | 'advisory';
export type AppListingFindingStatus = 'finding' | 'passed' | 'notEvaluated';

export interface AppListingObservationMeta {
  sourceKind: 'first_party' | 'provider_observation' | 'estimate' | 'ai_interpretation';
  sourceLabel: string | null;
  observedAt: string;
  freshUntil: string | null;
  freshness: 'fresh' | 'stale' | 'partial' | 'blocked' | 'failed' | 'unknown';
  market: {
    country: string;
    region: string | null;
    city: string | null;
    language: string;
    device: 'desktop' | 'mobile' | 'all';
  } | null;
  sampleCount: number;
  coverageNoteKey: string | null;
}

export interface AppListingPrice {
  amount: number | null;
  currency: string | null;
  displayed: string | null;
}

export interface AppListingReference {
  appId: string;
  title: string;
  url: string | null;
}

export interface AppListingInfo {
  store: AppStoreKind;
  appId: string;
  title: string;
  url: string | null;
  iconUrl: string | null;
  description: string | null;
  rating: number | null;
  reviewCount: number | null;
  isFree: boolean | null;
  price: AppListingPrice | null;
  mainCategory: string | null;
  categories: string[];
  installs: { raw: string; lowerBound: number | null } | null;
  developerName: string | null;
  developerUrl: string | null;
  developerWebsite: string | null;
  version: string | null;
  minimumOsVersion: string | null;
  size: string | null;
  releasedAt: string | null;
  updatedAt: string | null;
  updateNotes: string | null;
  imageUrls: string[];
  videoUrls: string[] | null;
  languages: string[] | null;
  advisories: string[] | null;
  tags: string[] | null;
  similarApps: AppListingReference[];
  moreByDeveloper: AppListingReference[];
  locationCode: number;
  languageCode: string;
  observationMeta: AppListingObservationMeta;
}

export interface AppListingFinding {
  id: string;
  scope: AppStoreKind | 'parity';
  status: AppListingFindingStatus;
  severity: AppListingSeverity;
  copyKey: string;
  params: Record<string, string | number>;
  messageVars?: Record<string, string | number>;
  titleKey: string;
  whyKey: string;
  fixKey: string;
  passedLabelKey: string;
  notEvaluatedKey: string;
  title: string;
  why: string;
  fix: string;
  passedText: string;
  notEvaluatedText: string;
  provenance: 'store-observation' | 'user-paired';
}

export interface AppListingNotObservedNote {
  store: AppStoreKind;
  field: 'listing' | 'shortDescription' | 'subtitle' | 'screenshots' | 'installs';
  copyKey: string;
  messageKey: string;
  message: string;
}

export interface AppListingStoreSnapshot {
  store: AppStoreKind;
  listing: AppListingInfo;
  observationMeta: AppListingObservationMeta;
}

export interface AppListingReport {
  capturedAt: string;
  engineVersion: string;
  findings: AppListingFinding[];
  notObserved: AppListingNotObservedNote[];
  stores: Record<AppStoreKind, AppListingStoreSnapshot | null>;
}

export interface AppListingHistoryItem {
  capturedAt: string;
  engineVersion: string;
  stores: AppStoreKind[];
  partial: boolean;
  findingCounts: Record<AppListingSeverity, number>;
}

export interface AppListingReadResponse {
  report: AppListingReport | null;
  listingEnabled: boolean;
}

export interface AppListingHistoryResponse {
  items: AppListingHistoryItem[];
  listingEnabled: boolean;
}

/** Opaque server preview returned before a paid vendor call; the client reads no fields from it. */
export type AppListingSpendPreview = Record<string, unknown>;

export interface AppListingRunInput {
  profileId: string;
  confirm: boolean;
  locationCode?: number;
  languageCode?: string;
}

export interface AppListingRunResponse {
  preview: AppListingSpendPreview;
  queued: boolean;
  runId: string | null;
  capturedAt: string | null;
}

export interface AppSeoListingState {
  siteId: string | null;
  profileId: string | null;
  report: AppListingReport | null;
  history: AppListingHistoryItem[];
  listingEnabled: boolean;
  latestStatus: AppListingRequestStatus;
  historyStatus: AppListingRequestStatus;
  mutationStatus: AppListingRequestStatus;
  preview: AppListingRunResponse | null;
  error: string;
}

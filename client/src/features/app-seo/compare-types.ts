import type { AppStoreKind } from './tracking-types';

export interface AppSeoCompareProfile {
  id: string;
  paired: boolean;
  playPackageId: string | null;
  appStoreId: string | null;
}

export interface AppSeoCompareListing {
  store: AppStoreKind;
  appId: string;
  title: string;
  url: string | null;
  rating: number | null;
  reviewCount: number | null;
  capturedAt: string;
}

export interface AppSeoComparePosition {
  position: number | null;
  checkedAt: string | null;
}

export interface AppSeoCompareRankRow {
  phrase: string;
  locationCode: number;
  languageCode: string;
  googlePlay: AppSeoComparePosition;
  appStore: AppSeoComparePosition;
  delta: number | null;
}

export interface AppSeoCompareOnlyTrackedRow {
  phrase: string;
  locationCode: number;
  languageCode: string;
  position: number | null;
  checkedAt: string | null;
}

export interface AppSeoCompareParityFinding {
  id: string;
  status: 'finding' | 'passed' | 'notEvaluated';
  severity: 'fixNow' | 'watch' | 'advisory';
  copyKey: string;
  params: Record<string, string | number>;
  provenance: 'user-paired';
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
}

export type AppSeoCompareRawValue = string | number | string[] | null;

export interface AppSeoCompareRawField {
  field: 'title' | 'developerName' | 'mainCategory' | 'version' | 'categories';
  googlePlay: AppSeoCompareRawValue;
  appStore: AppSeoCompareRawValue;
  matches: boolean | null;
}

export interface AppSeoCompareChartRow {
  chartId: string;
  categoryId: string | null;
  googlePlay: AppSeoComparePosition;
  appStore: AppSeoComparePosition;
  delta: number | null;
}

export interface AppSeoComparison {
  profile: AppSeoCompareProfile;
  pairingProvenance: 'user-paired' | null;
  listings: Record<AppStoreKind, AppSeoCompareListing | null>;
  ratingDelta: number | null;
  reviewCountDelta: number | null;
  ranks: {
    shared: AppSeoCompareRankRow[];
    onlyGooglePlay: AppSeoCompareOnlyTrackedRow[];
    onlyAppStore: AppSeoCompareOnlyTrackedRow[];
  };
  listingParity: {
    findings: AppSeoCompareParityFinding[];
    rawFields: AppSeoCompareRawField[];
  };
  charts: AppSeoCompareChartRow[];
}

export type AppSeoCompareRequestStatus = 'idle' | 'loading' | 'succeeded' | 'failed';

export interface AppSeoCompareState {
  siteId: string | null;
  profileId: string | null;
  comparison: AppSeoComparison | null;
  status: AppSeoCompareRequestStatus;
  error: string;
}

import { z } from 'zod';
import type { ObservationMeta } from '@shared/observations/types';

export const TRAFFIC_SNAPSHOT_DOMAIN_MAX_LENGTH = 269;

/** Client mirror of `trafficSnapshotDomainSchema`; the server remains authoritative. */
export const trafficSnapshotDomainSchema = z
  .string()
  .trim()
  .min(1, 'errors.invalidDomain')
  .max(TRAFFIC_SNAPSHOT_DOMAIN_MAX_LENGTH, 'errors.invalidDomain')
  .transform((raw, context) => {
    if (/^[a-z][a-z\d+.-]*:\/\//i.test(raw)) {
      context.addIssue({ code: z.ZodIssueCode.custom, message: 'errors.invalidDomain' });
      return z.NEVER;
    }
    let parsed: URL;
    try {
      parsed = new URL(`https://${raw}`);
    } catch {
      context.addIssue({ code: z.ZodIssueCode.custom, message: 'errors.invalidDomain' });
      return z.NEVER;
    }
    const domain = parsed.hostname;
    const isIpv4 = /^\d{1,3}(\.\d{1,3}){3}$/.test(domain);
    if (
      domain.length > 253 ||
      !domain.includes('.') ||
      domain.startsWith('[') ||
      isIpv4 ||
      parsed.username !== '' ||
      parsed.password !== ''
    ) {
      context.addIssue({ code: z.ZodIssueCode.custom, message: 'errors.invalidDomain' });
      return z.NEVER;
    }
    return domain.toLowerCase().replace(/^www\./, '');
  });

export interface EstimatedInteger {
  value: number;
  observation: ObservationMeta;
}

export interface EstimatedNullableInteger {
  value: number | null;
  observation: ObservationMeta;
}

export interface TrafficHistoryPoint {
  capturedAt: string;
  rank: EstimatedNullableInteger;
  traffic: EstimatedInteger;
  keywordCount: EstimatedInteger;
}

export interface TrafficSnapshotPayload {
  monthlyOrganicVisits: EstimatedInteger;
  topCountries: Array<{ countryCode: string; visits: EstimatedInteger }>;
  domainRank: EstimatedNullableInteger;
  keywordCount: EstimatedNullableInteger;
  history: TrafficHistoryPoint[];
  retained: TrafficRetainedOps;
}

export interface TrafficRetainedOps {
  traffic: boolean;
  rankOverview: boolean;
  history: boolean;
}

export type TrafficSnapshotRunStatus = 'queued' | 'running' | 'succeeded' | 'partial' | 'failed';

export interface TrafficSnapshotSummary {
  id: string;
  siteId: string | null;
  targetDomain: string;
  capturedAt: string;
  payload: TrafficSnapshotPayload;
}

export interface TrafficSnapshotDetail {
  id: string;
  siteId: string | null;
  targetDomain: string;
  inputs: { locationCode: number; languageCode: string; historyMonths: number };
  status: TrafficSnapshotRunStatus;
  retainedOps: TrafficRetainedOps;
  refunded: boolean;
  createdAt: string;
  completedAt: string | null;
  snapshot: { capturedAt: string; payload: TrafficSnapshotPayload } | null;
}

export interface TrafficSnapshotListResponse {
  snapshots: TrafficSnapshotSummary[];
  nextCursor: string | null;
}

export interface TrafficSnapshotCompareResponse {
  snapshots: TrafficSnapshotSummary[];
  axes: { countryCodes: string[] };
  warning: null | {
    code: 'RESULT_SET_CLAMPED';
    messageKey: string;
    messageVars?: Record<string, string | number>;
    message: string;
  };
}

export interface TrafficSnapshotListFilters {
  siteId?: string;
  domain?: string;
  from?: string;
  to?: string;
  cursor?: string;
}

export interface TrafficSnapshotReadInput {
  id: string;
  siteId?: string;
}

export interface TrafficSnapshotPreviewInput {
  domains: string[];
  siteId?: string;
}

export interface TrafficSnapshotRequestInput {
  targetDomain: string;
  siteId?: string;
  locationCode?: 2840;
  languageCode?: 'en';
  historyMonths?: 24;
}

export interface TrafficSnapshotRequestResult {
  runId: string;
  status: 'queued';
  targetDomain: string;
  reservedUnits: 1;
  cached: boolean;
}

export type TrafficCachedStatus = 'cached' | 'fresh_required' | 'mixed';

export interface TrafficSpendPreviewOperation {
  operationKey: string;
  metric: 'traffic_snapshots';
  productUnits: number;
  cachedStatus: Exclude<TrafficCachedStatus, 'mixed'>;
}

export interface TrafficSpendPreview {
  /** Per-domain cache status; absent when the server has nothing to break down. */
  breakdown?: TrafficSpendPreviewOperation[];
}

export type TrafficRequestErrorKind = 'locked' | 'timeout' | 'unknown';

export interface TrafficThunkError {
  error: string;
  kind: TrafficRequestErrorKind;
}

export interface TrafficSnapshotsState {
  /** Site the loaded/loading data belongs to; null for legacy account-wide reads. */
  siteId: string | null;
  list: TrafficSnapshotListResponse | null;
  detail: TrafficSnapshotDetail | null;
  preview: TrafficSpendPreview | null;
  lastRequest: TrafficSnapshotRequestResult | null;
  listStatus: AsyncStatus;
  detailStatus: AsyncStatus;
  previewStatus: AsyncStatus;
  requestStatus: AsyncStatus;
  listError: string;
  detailError: string;
  previewError: string;
  requestError: string;
  previewErrorKind: TrafficRequestErrorKind | null;
  requestErrorKind: TrafficRequestErrorKind | null;
}

export type AsyncStatus = 'idle' | 'loading' | 'succeeded' | 'failed';

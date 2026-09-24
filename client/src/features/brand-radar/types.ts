/**
 * Client mirrors of the shipped Brand Radar DTOs (verified end to
 * end against the spec).
 *
 * The server stays authoritative: the client never computes a deterministic
 * aggregate, never prices a scan, and never decides an entitlement. These
 * types describe exactly what the wire carries so the UI can only render what
 * it was handed.
 */
import { z } from 'zod';
import type { SupportedLocale } from '@shared/i18n';

/** `BRAND_RADAR_SCAN_STATUSES` — the six shipped statuses, no invented stage. */
export const BRAND_RADAR_STATUSES = [
  'queued',
  'running',
  'completed',
  'completed_empty',
  'completed_partial',
  'failed',
] as const;
export type BrandRadarStatus = (typeof BRAND_RADAR_STATUSES)[number];

/** `BRAND_RADAR_SETTLED_STATUSES` — a scan that produced a result. */
export const BRAND_RADAR_SETTLED_STATUSES = [
  'completed',
  'completed_partial',
  'completed_empty',
] as const;

/**
 * Terminal = settled OR failed. A failed scan never changes again either, so
 * polling stops on it exactly like it stops on a settled one.
 */
export const isTerminalBrandRadarStatus = (status: BrandRadarStatus): boolean =>
  status !== 'queued' && status !== 'running';

export const BRAND_RADAR_DIGEST_STATES = [
  'pending',
  'digest_present',
  'digest_absent',
  'no_reliable_digest',
] as const;
export type BrandRadarDigestState = (typeof BRAND_RADAR_DIGEST_STATES)[number];

export type BrandRadarRefundState = 'refunded' | 'none';

/**
 * Halt disclosure — WHICH stage halted a `completed_partial` / `failed` scan
 * and WHY. Mirrors the server's bounded taxonomy; `null` on clean terminals
 * and legacy scans predating the field.
 */
export const BRAND_RADAR_HALT_STAGES = [
  'search',
  'summary',
  'brand_digest',
  'scan',
] as const;
export type BrandRadarHaltStage = (typeof BRAND_RADAR_HALT_STAGES)[number];

export const BRAND_RADAR_HALT_REASONS = [
  'cost_ceiling',
  'provider_error',
  'digest_failed',
  'processing_failure',
] as const;
export type BrandRadarHaltReason = (typeof BRAND_RADAR_HALT_REASONS)[number];

export interface BrandRadarHalt {
  stage: BrandRadarHaltStage;
  reason: BrandRadarHaltReason;
}

export interface BrandRadarScanSummary {
  id: string;
  siteId: string;
  brandQuery: string;
  language: string | null;
  outputLocale: SupportedLocale | null;
  countryCode: string | null;
  locationCode: number | null;
  status: BrandRadarStatus;
  digestState: BrandRadarDigestState;
  queryHash: string;
  priorScanId: string | null;
  retainedRowCount: number;
  refund: { state: BrandRadarRefundState; unit: number };
  createdAt: string;
  updatedAt: string;
  terminalAt: string | null;
}

/** `GET /brand-radar/scans/:id` response shape; mirrored here for parity. */
export interface BrandRadarScanDetail extends BrandRadarScanSummary {
  mentionCount: number;
  sentimentDistribution: {
    positive: number;
    neutral: number;
    negative: number;
    unknown: number;
  };
  topDomains: Array<{ domain: string; count: number }>;
  /** `null` iff no prior settled scan for the query — never a fabricated 0. */
  trend: { delta: number; direction: 'up' | 'down' | 'flat' } | null;
  digestSentences: Array<{ text: string; citedRowIds: string[] }>;
  /** Which stage halted and why; `null` on clean terminals and legacy scans. */
  halt: BrandRadarHalt | null;
}

export interface BrandRadarScanListResponse {
  items: BrandRadarScanSummary[];
  nextCursor: string | null;
}

/** `BRAND_RADAR_POLARITIES` — stored rows carry three, never `unknown`. */
export const BRAND_RADAR_POLARITIES = ['positive', 'neutral', 'negative'] as const;
export type BrandRadarPolarity = (typeof BRAND_RADAR_POLARITIES)[number];

/**
 * One row of `GET /brand-radar/scans/:id/mentions`.
 *
 * `url` is `null` when the stored value did not survive the server's http(s)
 * scheme guard — the client renders such a row with no anchor at all.
 */
export interface BrandRadarMentionRow {
  id: string;
  url: string | null;
  domain: string;
  title: string;
  snippet: string;
  polarity: BrandRadarPolarity;
  confidence: number | null;
  language: string | null;
  observedAt: string | null;
}

export interface BrandRadarMentionListResponse {
  items: BrandRadarMentionRow[];
  nextCursor: string | null;
}

/** `POST /brand-radar/scans` → 202. */
export interface BrandRadarScanCreated {
  scanId: string;
  status: 'queued';
  queryHash: string;
  priorScanId: string | null;
  outputLocale: SupportedLocale;
  reservedUnits: number;
}

/**
 * `POST /brand-radar/preview` → 200 spend preview. Self-hosted scans are never
 * metered, so the client only needs to know the server accepted the input.
 */
export interface BrandRadarPreview {
  feature?: string;
  operation?: string;
  estimatedAt?: string;
}

export const BRAND_RADAR_QUERY_MAX_LENGTH = 200;

/**
 * Client mirror of `createScanBody`. `competitorQueries` is deliberately
 * absent — v1 prices one brand query per scan and the server 400s on the key.
 */
export const brandRadarScanFormSchema = z.object({
  brandQuery: z
    .string()
    .trim()
    .min(1, 'errors.invalidQuery')
    .max(BRAND_RADAR_QUERY_MAX_LENGTH, 'errors.invalidQuery'),
  language: z
    .string()
    .trim()
    .toLowerCase()
    .regex(/^[a-z]{2}$/, 'errors.invalidLanguage')
    .optional(),
  countryCode: z
    .string()
    .trim()
    .toUpperCase()
    .regex(/^[A-Z]{2}$/, 'errors.invalidLocation')
    .optional(),
  locationCode: z.coerce
    // `Number('abc')` is NaN, and the base type check fires before `.int()`,
    // so the NaN arm needs its own key or zod's default English leaks out.
    .number({ invalid_type_error: 'errors.invalidLocation' })
    .int('errors.invalidLocation')
    .positive('errors.invalidLocation')
    .optional(),
}).superRefine((input, context) => {
  if (input.countryCode !== undefined && input.locationCode !== undefined) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['countryCode'],
      message: 'errors.invalidLocation',
    });
  }
});

export type BrandRadarScanInput = z.infer<typeof brandRadarScanFormSchema>;

export type AsyncStatus = 'idle' | 'loading' | 'succeeded' | 'failed';

/**
 * Row inserted the moment `POST /scans` returns 202. It carries only what the
 * server sent back plus the query the user typed — no invented timestamp, no
 * invented mention count. The next list refetch replaces it.
 */
export interface BrandRadarOptimisticScan {
  id: string;
  brandQuery: string;
  language: string | null;
  outputLocale: SupportedLocale;
  countryCode: string | null;
  locationCode: number | null;
  status: 'queued';
  digestState: 'pending';
  queryHash: string;
  priorScanId: string | null;
}

/** Normalized row the table renders, from either source. */
export interface BrandRadarRow {
  id: string;
  brandQuery: string;
  language: string | null;
  outputLocale: SupportedLocale | null;
  countryCode: string | null;
  status: BrandRadarStatus;
  digestState: BrandRadarDigestState;
  /** `null` while the row is optimistic — the server has not counted yet. */
  retainedRowCount: number | null;
  refundState: BrandRadarRefundState;
  /** `null` while the row is optimistic — we do not invent a created-at. */
  createdAt: string | null;
}

/** Per-scan detail slice. Keyed by scan id so revisiting a scan is instant. */
export interface BrandRadarDetailEntry {
  detail: BrandRadarScanDetail | null;
  status: AsyncStatus;
  error: string;
}

/** Per-scan mention page slice, extended by keyset "load more". */
export interface BrandRadarMentionEntry {
  items: BrandRadarMentionRow[];
  nextCursor: string | null;
  status: AsyncStatus;
  error: string;
  loadingMore: boolean;
}

export const initialBrandRadarDetailEntry: BrandRadarDetailEntry = {
  detail: null,
  status: 'idle',
  error: '',
};

export const initialBrandRadarMentionEntry: BrandRadarMentionEntry = {
  items: [],
  nextCursor: null,
  status: 'idle',
  error: '',
  loadingMore: false,
};

/** One point of the scan-over-scan trend series (a re-sort of server rows). */
export interface BrandRadarTrendPoint {
  scanId: string;
  capturedAt: string;
  mentionCount: number;
  /** Server-supplied delta; `null` on every scan but the one being viewed. */
  delta: number | null;
  isCurrent: boolean;
}

export interface BrandRadarState {
  items: BrandRadarScanSummary[];
  nextCursor: string | null;
  listStatus: AsyncStatus;
  listError: string;
  loadingMore: boolean;
  optimistic: BrandRadarOptimisticScan | null;
  preview: BrandRadarPreview | null;
  previewStatus: AsyncStatus;
  previewError: string;
  /** The server's kill switch refused the preview (503). */
  previewUnavailable: boolean;
  createStatus: AsyncStatus;
  createError: string;
  /** The server's kill switch refused the scan (503). */
  createUnavailable: boolean;
  details: Record<string, BrandRadarDetailEntry>;
  mentions: Record<string, BrandRadarMentionEntry>;
}

export interface BrandRadarThunkError {
  error: string;
  unavailable: boolean;
}

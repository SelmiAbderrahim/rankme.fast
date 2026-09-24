/**
 * Client mirror of the geogrid wire contract
 * (`server/src/modules/geogrid/geogrid.service.ts` DTOs).
 *
 * The cell union is copied verbatim from the server on purpose: `failed`
 * carries no position, no pack size, and no capture time, so no renderer can
 * present a failed check as a rank or as "not in the local pack".
 */
export const GEOGRID_SIZES = [3, 5, 7] as const;
export type GeogridSize = (typeof GEOGRID_SIZES)[number];

/** Spacing presets, in metres. The numeric field accepts anything in bounds. */
export const GEOGRID_SPACING_PRESETS = [500, 1_000, 2_000, 5_000] as const;

export const GEOGRID_MIN_SPACING_METERS = 100;
export const GEOGRID_MAX_SPACING_METERS = 10_000;
export const GEOGRID_SPACING_STEP_METERS = 100;
export const GEOGRID_MAX_ABS_CENTER_LAT = 85;
export const GEOGRID_MIN_ZOOM = 3;
export const GEOGRID_MAX_ZOOM = 21;
export const GEOGRID_DEFAULT_ZOOM = 17;

export const GEOGRID_SCAN_STATUSES = [
  'queued',
  'running',
  'completed',
  'completed_partial',
  'failed',
] as const;
export type GeogridScanStatus = (typeof GEOGRID_SCAN_STATUSES)[number];

export function isGeogridSize(value: unknown): value is GeogridSize {
  return typeof value === 'number' && (GEOGRID_SIZES as readonly number[]).includes(value);
}

export interface GeogridDefinition {
  keywordId: string;
  centerLat: number;
  centerLng: number;
  spacingMeters: number;
  gridSize: GeogridSize;
  zoom: number;
}

export type GeogridCell =
  | {
      pointIndex: number;
      lat: number;
      lng: number;
      state: 'observed';
      position: number;
      totalPackSize: number;
      capturedAt: string;
    }
  | {
      pointIndex: number;
      lat: number;
      lng: number;
      state: 'not_in_pack';
      position: null;
      totalPackSize: number;
      capturedAt: string;
    }
  | { pointIndex: number; lat: number; lng: number; state: 'failed' };

export interface GeogridScanSummary {
  id: string;
  keywordId: string;
  keyword: string;
  status: GeogridScanStatus;
  centerLat: number;
  centerLng: number;
  spacingMeters: number;
  gridSize: number;
  zoom: number;
  totalCells: number;
  observedCells: number;
  notInPackCells: number;
  failedCells: number;
  createdAt: string;
  finishedAt: string | null;
  failureReason: string | null;
}

export interface GeogridScanDetail extends GeogridScanSummary {
  cells: GeogridCell[];
}

/** Opaque server preview returned before the paid scan; the client reads no fields from it. */
export type GeogridSpendPreview = Record<string, unknown>;

export interface GeogridPreviewResponse {
  preview: GeogridSpendPreview;
  cellCount: number;
}

export interface GeogridCreateResponse {
  scanId: string;
  status: GeogridScanStatus;
  cellCount: number;
}

/** Honest refusal states — each carries the SERVER's localized message. */
export type GeogridGateKind =
  | 'killSwitch'
  | 'notFound'
  | 'rateLimited'
  | 'invalid'
  | 'failed';

export interface GeogridGate {
  kind: GeogridGateKind;
  message: string;
}

export type GeogridStatus = 'idle' | 'loading' | 'ready' | 'error';

export interface GeogridFormState {
  keywordId: string;
  centerLat: string;
  centerLng: string;
  spacingMeters: number;
  gridSize: GeogridSize;
  zoom: number;
}

export interface GeogridState {
  siteId: string | null;
  form: GeogridFormState;
  scans: GeogridScanSummary[];
  scansStatus: GeogridStatus;
  scansGate: GeogridGate | null;
  detail: GeogridScanDetail | null;
  detailStatus: GeogridStatus;
  detailGate: GeogridGate | null;
  preview: GeogridPreviewResponse | null;
  /** The exact definition the estimate was made for — confirm submits THIS. */
  previewDefinition: GeogridDefinition | null;
  previewStatus: GeogridStatus;
  previewGate: GeogridGate | null;
  submitting: boolean;
  submitGate: GeogridGate | null;
}

export const initialGeogridFormState: GeogridFormState = {
  keywordId: '',
  centerLat: '',
  centerLng: '',
  spacingMeters: 1_000,
  gridSize: 3,
  zoom: GEOGRID_DEFAULT_ZOOM,
};

export const initialGeogridState: GeogridState = {
  siteId: null,
  form: initialGeogridFormState,
  scans: [],
  scansStatus: 'idle',
  scansGate: null,
  detail: null,
  detailStatus: 'idle',
  detailGate: null,
  preview: null,
  previewDefinition: null,
  previewStatus: 'idle',
  previewGate: null,
  submitting: false,
  submitGate: null,
};

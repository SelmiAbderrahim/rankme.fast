/**
 * URL-backed workspace state (`.claude/rules/url-tab-state.md`).
 *
 * `?view=` switches list ⇄ new-scan (the site workspace owns `?tab=` since
 * rankme-site-scoping 01); `?status=` filters the loaded scan page;
 * `?scan=` opens a stored scan detail; `?sentiment=`, `?domain=`, `?from=` and
 * `?to=` filter the loaded mention page. Every param defaults when absent, and
 * an INVALID value is normalized back into the URL with
 * `navigate({ search }, { replace: true })` so a shared link never leaves the
 * address bar disagreeing with the screen.
 */
import { useCallback, useEffect, useMemo } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { BRAND_RADAR_STATUSES, type BrandRadarStatus } from './types';

export const BRAND_RADAR_VIEWS = ['scans', 'new'] as const;
export type BrandRadarView = (typeof BRAND_RADAR_VIEWS)[number];
export const DEFAULT_BRAND_RADAR_VIEW: BrandRadarView = 'scans';

export const BRAND_RADAR_STATUS_FILTERS = [
  'all',
  ...BRAND_RADAR_STATUSES,
] as const;
export type BrandRadarStatusFilter = 'all' | BrandRadarStatus;
export const DEFAULT_BRAND_RADAR_STATUS_FILTER: BrandRadarStatusFilter = 'all';

export const BRAND_RADAR_SENTIMENT_FILTERS = [
  'all',
  'positive',
  'neutral',
  'negative',
] as const;
export type BrandRadarSentimentFilter =
  (typeof BRAND_RADAR_SENTIMENT_FILTERS)[number];
export const DEFAULT_BRAND_RADAR_SENTIMENT_FILTER: BrandRadarSentimentFilter =
  'all';

/** A hostname is at most 253 characters — anything longer is not a domain. */
export const BRAND_RADAR_DOMAIN_MAX_LENGTH = 253;

export const isBrandRadarView = (value: unknown): value is BrandRadarView =>
  typeof value === 'string' && (BRAND_RADAR_VIEWS as readonly string[]).includes(value);

export const isBrandRadarStatusFilter = (
  value: unknown,
): value is BrandRadarStatusFilter =>
  typeof value === 'string' &&
  (BRAND_RADAR_STATUS_FILTERS as readonly string[]).includes(value);

export const isBrandRadarSentimentFilter = (
  value: unknown,
): value is BrandRadarSentimentFilter =>
  typeof value === 'string' &&
  (BRAND_RADAR_SENTIMENT_FILTERS as readonly string[]).includes(value);

/**
 * Mirrors the server's `scanIdParam` — 24 lowercase hex characters. Every id
 * the API hands back is a lowercased ObjectId hex, so an uppercase value is
 * hand-typed and normalized out rather than silently accepted.
 */
export const isBrandRadarScanId = (value: unknown): value is string =>
  typeof value === 'string' && /^[0-9a-f]{24}$/.test(value);

/** `YYYY-MM-DD` that is also a real calendar day (`2026-02-31` is not). */
export const isBrandRadarDate = (value: unknown): value is string => {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00.000Z`);
  return (
    !Number.isNaN(parsed.getTime()) &&
    parsed.toISOString().slice(0, 10) === value
  );
};

const normalizeDomain = (value: string): string | null => {
  const trimmed = value.trim().toLowerCase();
  if (trimmed.length === 0 || trimmed.length > BRAND_RADAR_DOMAIN_MAX_LENGTH) {
    return null;
  }
  return trimmed;
};

export interface BrandRadarUrlState {
  view: BrandRadarView;
  status: BrandRadarStatusFilter;
  scan: string | null;
  sentiment: BrandRadarSentimentFilter;
  domain: string;
  from: string;
  to: string;
  setView: (next: BrandRadarView) => void;
  setStatus: (next: BrandRadarStatusFilter) => void;
  setScan: (next: string | null) => void;
  setSentiment: (next: BrandRadarSentimentFilter) => void;
  setDomain: (next: string) => void;
  setFrom: (next: string) => void;
  setTo: (next: string) => void;
}

export function useBrandRadarUrlState(): BrandRadarUrlState {
  const location = useLocation();
  const navigate = useNavigate();
  const params = useMemo(
    () => new URLSearchParams(location.search),
    [location.search],
  );

  const rawView = params.get('view');
  const rawStatus = params.get('status');
  const rawScan = params.get('scan');
  const rawSentiment = params.get('sentiment');
  const rawDomain = params.get('domain');
  const rawFrom = params.get('from');
  const rawTo = params.get('to');

  const view = isBrandRadarView(rawView) ? rawView : DEFAULT_BRAND_RADAR_VIEW;
  const status = isBrandRadarStatusFilter(rawStatus)
    ? rawStatus
    : DEFAULT_BRAND_RADAR_STATUS_FILTER;
  const scan = isBrandRadarScanId(rawScan) ? rawScan : null;
  const sentiment = isBrandRadarSentimentFilter(rawSentiment)
    ? rawSentiment
    : DEFAULT_BRAND_RADAR_SENTIMENT_FILTER;
  const normalizedDomain = rawDomain === null ? null : normalizeDomain(rawDomain);
  const domain = normalizedDomain ?? '';
  // A range that reads backwards is not a range: BOTH ends clear.
  const rangeValid =
    (rawFrom === null || isBrandRadarDate(rawFrom)) &&
    (rawTo === null || isBrandRadarDate(rawTo)) &&
    !(rawFrom !== null && rawTo !== null && rawFrom > rawTo);
  const from = rangeValid && rawFrom !== null ? rawFrom : '';
  const to = rangeValid && rawTo !== null ? rawTo : '';

  useEffect(() => {
    // Defaults are spelled as an ABSENT param, so normalization deletes.
    const invalidView = rawView !== null && !isBrandRadarView(rawView);
    const invalidStatus =
      rawStatus !== null &&
      (!isBrandRadarStatusFilter(rawStatus) ||
        rawStatus === DEFAULT_BRAND_RADAR_STATUS_FILTER);
    const invalidScan = rawScan !== null && !isBrandRadarScanId(rawScan);
    const invalidSentiment =
      rawSentiment !== null &&
      (!isBrandRadarSentimentFilter(rawSentiment) ||
        rawSentiment === DEFAULT_BRAND_RADAR_SENTIMENT_FILTER);
    const invalidDomain = rawDomain !== null && rawDomain !== normalizedDomain;
    const invalidRange = !rangeValid;
    if (
      !invalidView &&
      !invalidStatus &&
      !invalidScan &&
      !invalidSentiment &&
      !invalidDomain &&
      !invalidRange
    ) {
      return;
    }
    const next = new URLSearchParams(params);
    if (invalidView) next.delete('view');
    if (invalidStatus) next.delete('status');
    if (invalidScan) next.delete('scan');
    if (invalidSentiment) next.delete('sentiment');
    if (invalidDomain) {
      if (normalizedDomain === null) next.delete('domain');
      else next.set('domain', normalizedDomain);
    }
    if (invalidRange) {
      next.delete('from');
      next.delete('to');
    }
    navigate(
      { pathname: location.pathname, search: next.toString() },
      { replace: true },
    );
  }, [
    rawView,
    rawStatus,
    rawScan,
    rawSentiment,
    rawDomain,
    normalizedDomain,
    rangeValid,
    params,
    navigate,
    location.pathname,
  ]);

  const write = useCallback(
    (key: string, value: string, isDefault: boolean) => {
      const next = new URLSearchParams(params);
      if (isDefault) next.delete(key);
      else next.set(key, value);
      navigate(
        { pathname: location.pathname, search: next.toString() },
        { replace: true },
      );
    },
    [params, navigate, location.pathname],
  );

  const setView = useCallback(
    (next: BrandRadarView) =>
      write('view', next, next === DEFAULT_BRAND_RADAR_VIEW),
    [write],
  );
  const setStatus = useCallback(
    (next: BrandRadarStatusFilter) =>
      write('status', next, next === DEFAULT_BRAND_RADAR_STATUS_FILTER),
    [write],
  );
  const setScan = useCallback(
    (next: string | null) => write('scan', next ?? '', next === null),
    [write],
  );
  const setSentiment = useCallback(
    (next: BrandRadarSentimentFilter) =>
      write('sentiment', next, next === DEFAULT_BRAND_RADAR_SENTIMENT_FILTER),
    [write],
  );
  const setDomain = useCallback(
    (next: string) => {
      const normalized = normalizeDomain(next);
      write('domain', normalized ?? '', normalized === null);
    },
    [write],
  );
  const setFrom = useCallback(
    (next: string) => write('from', next, !isBrandRadarDate(next)),
    [write],
  );
  const setTo = useCallback(
    (next: string) => write('to', next, !isBrandRadarDate(next)),
    [write],
  );

  return {
    view,
    status,
    scan,
    sentiment,
    domain,
    from,
    to,
    setView,
    setStatus,
    setScan,
    setSentiment,
    setDomain,
    setFrom,
    setTo,
  };
}

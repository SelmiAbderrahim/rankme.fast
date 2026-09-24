import {
  REVIEW_INVENTORY_SORTS,
  REVIEW_SOURCES,
  type ReviewInventoryFilters,
  type ReviewInventorySort,
  type ReviewSourceName,
} from './types';

/**
 * URL-backed inventory filters (`.claude/rules/url-tab-state.md` — navigation
 * state lives in the query string, not `useState`). Invalid values fall back
 * to "no filter" rather than throwing, so a hand-edited URL degrades to the
 * unfiltered list instead of a blank screen.
 *
 * Params: `?src=` `?rating=` `?q=` `?page=` alongside the workspace `?tab=`.
 */
export const REVIEW_QUERY_MAX_LENGTH = 120;
// Production run ids are 24-char ObjectIds. A bounded lowercase token also
// keeps test/fake stored-read ids and future opaque ids URL-safe; the server
// remains authoritative and rejects an unknown id.
const REVIEW_RUN_ID_RE = /^[a-z0-9][a-z0-9-]{0,99}$/;

export function isReviewSourceName(value: unknown): value is ReviewSourceName {
  return typeof value === 'string' && (REVIEW_SOURCES as readonly string[]).includes(value);
}

export function isReviewInventorySort(value: unknown): value is ReviewInventorySort {
  return (
    typeof value === 'string' &&
    (REVIEW_INVENTORY_SORTS as readonly string[]).includes(value)
  );
}

export function isReviewRunId(value: unknown): value is string {
  return typeof value === 'string' && REVIEW_RUN_ID_RE.test(value);
}

export function readReviewFilters(params: URLSearchParams): ReviewInventoryFilters {
  const src = params.get('src');
  const rating = Number(params.get('rating'));
  const q = (params.get('q') ?? '').trim().slice(0, REVIEW_QUERY_MAX_LENGTH);
  const page = Number(params.get('page'));
  const sort = params.get('sort');
  return {
    ...(isReviewSourceName(src) ? { src } : {}),
    ...(Number.isInteger(rating) && rating >= 1 && rating <= 5 ? { rating } : {}),
    ...(q ? { q } : {}),
    sort: isReviewInventorySort(sort) ? sort : 'newest',
    page: Number.isInteger(page) && page >= 1 && page <= 1000 ? page : 1,
  };
}

/**
 * Write one filter change back into the query string. `null` clears the param.
 * Any filter change other than paging resets `page` — page 7 of a different
 * filter set is a different result set.
 */
export function writeReviewFilters(
  params: URLSearchParams,
  patch: {
    src?: ReviewSourceName | null;
    rating?: number | null;
    q?: string | null;
    sort?: ReviewInventorySort;
    page?: number;
  },
): URLSearchParams {
  const next = new URLSearchParams(params);
  const resetsPage =
    patch.src !== undefined ||
    patch.rating !== undefined ||
    patch.q !== undefined ||
    patch.sort !== undefined;
  if (patch.src !== undefined) {
    if (patch.src === null) next.delete('src');
    else next.set('src', patch.src);
  }
  if (patch.rating !== undefined) {
    if (patch.rating === null) next.delete('rating');
    else next.set('rating', String(patch.rating));
  }
  if (patch.q !== undefined) {
    const trimmed = (patch.q ?? '').trim();
    if (!trimmed) next.delete('q');
    else next.set('q', trimmed.slice(0, REVIEW_QUERY_MAX_LENGTH));
  }
  if (patch.sort !== undefined) {
    if (patch.sort === 'newest') next.delete('sort');
    else next.set('sort', patch.sort);
  }
  if (resetsPage) next.delete('page');
  if (patch.page !== undefined) {
    if (patch.page <= 1) next.delete('page');
    else next.set('page', String(patch.page));
  }
  return next;
}

export function hasActiveReviewFilter(filters: ReviewInventoryFilters): boolean {
  return filters.src !== undefined || filters.rating !== undefined || filters.q !== undefined;
}

export function normalizeReviewParams(params: URLSearchParams): URLSearchParams {
  const filters = readReviewFilters(params);
  const next = new URLSearchParams(params);
  if (filters.src) next.set('src', filters.src);
  else next.delete('src');
  if (filters.rating) next.set('rating', String(filters.rating));
  else next.delete('rating');
  if (filters.q) next.set('q', filters.q);
  else next.delete('q');
  if (!filters.sort || filters.sort === 'newest') next.delete('sort');
  else next.set('sort', filters.sort);
  if (filters.page <= 1) next.delete('page');
  else next.set('page', String(filters.page));
  const run = params.get('run');
  if (!isReviewRunId(run)) next.delete('run');
  return next;
}

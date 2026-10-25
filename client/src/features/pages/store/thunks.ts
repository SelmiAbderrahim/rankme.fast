import {
  createAction,
  createAsyncThunk,
  type ThunkAction,
  type UnknownAction,
} from '@reduxjs/toolkit';
import { CACHE_TTL_MS, isFresh } from '@shared/cache/freshness';
import { fetchPagesDetail, fetchPagesList, requestPagesRefresh } from '../api';
import { pagesRequestError } from '../error';
import { pagesDetailCacheKey, pagesListCacheKey } from '../urlState';
import type {
  PagesCacheEntry,
  PagesDetailResponse,
  PagesListQuery,
  PagesListResponse,
  PagesRange,
  PagesRefreshResponse,
  PagesRequestError,
  PagesState,
} from '../types';

let activeList: AbortController | null = null;
let activeDetail: AbortController | null = null;
let activeRefresh: AbortController | null = null;

const replaceController = (
  active: AbortController | null,
): { controller: AbortController; signalFor: (signal: AbortSignal) => AbortSignal } => {
  active?.abort();
  const controller = new AbortController();
  return {
    controller,
    signalFor: (signal) => AbortSignal.any([signal, controller.signal]),
  };
};

/**
 * Pages answers outlive the panel: leaving for Overview and coming back inside
 * the freshness window is served from the store and a
 * request still in flight when the panel unmounts finishes into the store
 * instead of being thrown away. Only a change of SITE drops the cache and the
 * request lanes, because nothing else would ever read them again.
 */
export const retainPagesSite = createAction<string>('pages/retainSite');

let enteredSiteId: string | null = null;

export const enterPagesSite =
  (siteId: string): ThunkAction<void, unknown, unknown, UnknownAction> =>
  (dispatch) => {
    if (enteredSiteId !== null && enteredSiteId !== siteId) {
      abortPagesRequests();
      dispatch(retainPagesSite(siteId));
    }
    enteredSiteId = siteId;
  };

/**
 * A load is needed unless the same key is already on its way (or arrived and
 * is still good: not invalidated, not failed, and younger than the Pages TTL). Re-asking for a key that is loading, from a re-render or a
 * StrictMode remount, must not start a second request; an invalidated entry
 * (after Refresh) or one that failed always loads again.
 */
export function pagesEntryNeedsLoad(
  entry: PagesCacheEntry<unknown> | undefined,
  now: number = Date.now(),
): boolean {
  if (entry === undefined) return true;
  if (entry.loading) return entry.invalidated;
  return (
    entry.invalidated ||
    entry.error !== null ||
    !entry.loaded ||
    entry.data === null ||
    !isFresh(entry.loadedAt, CACHE_TTL_MS.pages, now)
  );
}

const pagesState = (getState: () => unknown): PagesState =>
  (getState() as { pages?: PagesState }).pages ?? { lists: {}, details: {}, refreshes: {} };

export function abortPagesRequests(): void {
  activeList?.abort();
  activeDetail?.abort();
  activeRefresh?.abort();
  activeList = null;
  activeDetail = null;
  activeRefresh = null;
}

export interface LoadPagesListInput {
  siteId: string;
  query: PagesListQuery;
}

export const loadPagesList = createAsyncThunk<
  { key: string; data: PagesListResponse },
  LoadPagesListInput,
  { rejectValue: PagesRequestError }
>(
  'pages/list',
  async ({ siteId, query }, { rejectWithValue, signal }) => {
    const lane = replaceController(activeList);
    activeList = lane.controller;
    try {
      const data = await fetchPagesList(siteId, query, lane.signalFor(signal));
      return { key: pagesListCacheKey(siteId, query), data };
    } catch (error) {
      return rejectWithValue(pagesRequestError(error));
    } finally {
      if (activeList === lane.controller) activeList = null;
    }
  },
  {
    condition: ({ siteId, query }, { getState }) =>
      pagesEntryNeedsLoad(pagesState(getState).lists[pagesListCacheKey(siteId, query)]),
  },
);

export interface LoadPagesDetailInput {
  siteId: string;
  range: PagesRange;
  pageId: string;
}

export const loadPagesDetail = createAsyncThunk<
  { key: string; data: PagesDetailResponse },
  LoadPagesDetailInput,
  { rejectValue: PagesRequestError }
>(
  'pages/detail',
  async ({ siteId, range, pageId }, { rejectWithValue, signal }) => {
    const lane = replaceController(activeDetail);
    activeDetail = lane.controller;
    try {
      const data = await fetchPagesDetail(siteId, pageId, range, lane.signalFor(signal));
      return { key: pagesDetailCacheKey(siteId, range, pageId), data };
    } catch (error) {
      return rejectWithValue(pagesRequestError(error));
    } finally {
      if (activeDetail === lane.controller) activeDetail = null;
    }
  },
  {
    condition: ({ siteId, range, pageId }, { getState }) =>
      pagesEntryNeedsLoad(pagesState(getState).details[pagesDetailCacheKey(siteId, range, pageId)]),
  },
);

export interface RefreshPagesInput {
  siteId: string;
  query: PagesListQuery;
  pageId: string | null;
}

export const refreshPages = createAsyncThunk<
  PagesRefreshResponse,
  RefreshPagesInput,
  { rejectValue: PagesRequestError }
>(
  'pages/refresh',
  async ({ siteId, query, pageId }, { dispatch, rejectWithValue, signal }) => {
    const lane = replaceController(activeRefresh);
    activeRefresh = lane.controller;
    try {
      const response = await requestPagesRefresh(siteId, lane.signalFor(signal));
      const reloads: Promise<unknown>[] = [dispatch(loadPagesList({ siteId, query }))];
      if (pageId !== null) {
        reloads.push(dispatch(loadPagesDetail({ siteId, range: query.range, pageId })));
      }
      await Promise.all(reloads);
      return response;
    } catch (error) {
      return rejectWithValue(pagesRequestError(error));
    } finally {
      if (activeRefresh === lane.controller) activeRefresh = null;
    }
  },
);

import { createAsyncThunk } from '@reduxjs/toolkit';
import { fetchPagesDetail, fetchPagesList, requestPagesRefresh } from '../api';
import { pagesRequestError } from '../error';
import { pagesDetailCacheKey, pagesListCacheKey } from '../urlState';
import type {
  PagesDetailResponse,
  PagesListQuery,
  PagesListResponse,
  PagesRange,
  PagesRefreshResponse,
  PagesRequestError,
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
>('pages/list', async ({ siteId, query }, { rejectWithValue, signal }) => {
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
});

export interface LoadPagesDetailInput {
  siteId: string;
  range: PagesRange;
  pageId: string;
}

export const loadPagesDetail = createAsyncThunk<
  { key: string; data: PagesDetailResponse },
  LoadPagesDetailInput,
  { rejectValue: PagesRequestError }
>('pages/detail', async ({ siteId, range, pageId }, { rejectWithValue, signal }) => {
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
});

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

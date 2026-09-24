import { createAsyncThunk } from '@reduxjs/toolkit';
import { ApiError } from '@shared/api/client';
import {
  completeConnection,
  disconnectConnection,
  fetchAnalyticsProperties,
  fetchAnalyticsSummary,
  fetchSearchAnalyticsDetail,
  fetchSearchSummary,
  fetchSitemaps,
  getConnection,
  getConnectionConfiguration,
  refreshAnalyticsSummary as requestAnalyticsSummaryRefresh,
  refreshSearchSummary as requestSearchSummaryRefresh,
  revokeGoogleCredential,
  setConnectionProperty,
} from '../api';
import { googleErrorMessage } from '../errorMessage';
import { DEFAULT_GOOGLE_RANGE } from '../lib/range';
import { hasGa4Scope } from '../lib/googleScopes';
import type {
  CompleteGoogleConnectionBody,
  CompleteGoogleConnectionResponse,
  DisconnectGoogleResponse,
  Ga4Property,
  GetGoogleConnectionResponse,
  GoogleAnalyticsSummary,
  GoogleConnectionState,
  GoogleRange,
  GoogleSearchSummary,
  GscSearchAnalyticsDetail,
  GscSearchDimension,
  GscSitemap,
  SetGooglePropertyResponse,
  RevokeGoogleResponse,
} from '../types';

export const loadConnection = createAsyncThunk<
  GetGoogleConnectionResponse,
  string,
  { rejectValue: string }
>('google/loadConnection', async (siteId, { rejectWithValue }) => {
  try {
    return await getConnection(siteId);
  } catch (err) {
    return rejectWithValue(googleErrorMessage(err, 'google:errors.loadFailed'));
  }
});

/** Lightweight status poll while the background site matcher is running. */
export const pollConnection = createAsyncThunk<
  GetGoogleConnectionResponse,
  string,
  { rejectValue: string }
>('google/pollConnection', async (siteId, { rejectWithValue }) => {
  try {
    return { connection: await getConnectionConfiguration(siteId) };
  } catch (err) {
    return rejectWithValue(googleErrorMessage(err, 'google:errors.loadFailed'));
  }
});

export const connectGoogle = createAsyncThunk<
  CompleteGoogleConnectionResponse,
  CompleteGoogleConnectionBody & { siteId: string },
  { rejectValue: string }
>('google/connect', async ({ siteId, ...body }, { rejectWithValue }) => {
  try {
    return await completeConnection(siteId, body);
  } catch (err) {
    return rejectWithValue(googleErrorMessage(err, 'google:errors.unavailable'));
  }
});

export const setGoogleProperty = createAsyncThunk<
  SetGooglePropertyResponse,
  { siteId: string; propertyUrl: string | null },
  { rejectValue: string }
>('google/setProperty', async ({ siteId, ...body }, { rejectWithValue }) => {
  try {
    return await setConnectionProperty(siteId, body);
  } catch (err) {
    return rejectWithValue(googleErrorMessage(err, 'google:errors.unavailable'));
  }
});

export const disconnectGoogle = createAsyncThunk<
  DisconnectGoogleResponse,
  string,
  { rejectValue: string }
>('google/disconnect', async (siteId, { rejectWithValue }) => {
  try {
    return await disconnectConnection(siteId);
  } catch (err) {
    return rejectWithValue(googleErrorMessage(err, 'google:errors.disconnectFailed'));
  }
});

export const revokeGoogle = createAsyncThunk<
  RevokeGoogleResponse,
  string,
  { rejectValue: string }
>('google/revoke', async (siteId, { rejectWithValue }) => {
  try {
    return await revokeGoogleCredential(siteId);
  } catch (err) {
    return rejectWithValue(googleErrorMessage(err, 'google:errors.disconnectFailed'));
  }
});

/** Shared arg for the site-scoped, range-aware summary thunks. */
export interface SummaryThunkArg {
  siteId: string;
  /** Defaults to the 28-day window when the URL carries no `?range=`. */
  range?: GoogleRange;
}

/**
 * Load the search summary for a site + range. A 404 means
 * "no snapshot yet" (fresh connection, no audit run since, or a 7d/90d window
 * before its first capture) — that is the EMPTY state, not an error, so it
 * fulfills with `summary: null`.
 */
export const loadSearchSummary = createAsyncThunk<
  { siteId: string; range: GoogleRange; summary: GoogleSearchSummary | null },
  SummaryThunkArg,
  { rejectValue: string }
>(
  'google/loadSearchSummary',
  async ({ siteId, range = DEFAULT_GOOGLE_RANGE }, { rejectWithValue }) => {
    try {
      const { summary } = await fetchSearchSummary(siteId, range);
      return { siteId, range, summary };
    } catch (err) {
      if (err instanceof ApiError && err.status === 404) {
        return { siteId, range, summary: null };
      }
      return rejectWithValue(googleErrorMessage(err, 'google:searchSummary.error'));
    }
  },
);

/**
 * Manually refresh the search summary. The POST refreshes (and answers with)
 * the default 28-day snapshot, so the thunk ALWAYS follows it with the ranged
 * GET — the card reflects the currently selected window either way. A 404 on
 * either leg is the empty state (fulfills with `summary: null`); any other
 * failure rejects with the localized refresh message. Old data is left
 * untouched by the slice until this resolves.
 */
export const refreshSearchSummary = createAsyncThunk<
  { siteId: string; range: GoogleRange; summary: GoogleSearchSummary | null },
  SummaryThunkArg,
  { rejectValue: string }
>(
  'google/refreshSearchSummary',
  async ({ siteId, range = DEFAULT_GOOGLE_RANGE }, { rejectWithValue }) => {
    try {
      await requestSearchSummaryRefresh(siteId);
    } catch (err) {
      if (err instanceof ApiError && err.status === 404) {
        return { siteId, range, summary: null };
      }
      return rejectWithValue(
        googleErrorMessage(err, 'google:searchSummary.refreshError'),
      );
    }
    try {
      const { summary } = await fetchSearchSummary(siteId, range);
      return { siteId, range, summary };
    } catch (err) {
      if (err instanceof ApiError && err.status === 404) {
        return { siteId, range, summary: null };
      }
      return rejectWithValue(
        googleErrorMessage(err, 'google:searchSummary.refreshError'),
      );
    }
  },
);

/**
 * Load one Search Analytics drill-in dimension (`?view=` panel). Mirrors
 * `loadSearchSummary`: a 404 means "no data yet" — that is the EMPTY state,
 * not an error, so it fulfills with `detail: null`.
 */
export const loadSearchAnalyticsDetail = createAsyncThunk<
  {
    siteId: string;
    dimension: GscSearchDimension;
    range: GoogleRange;
    detail: GscSearchAnalyticsDetail | null;
  },
  { siteId: string; dimension: GscSearchDimension; range?: GoogleRange },
  { rejectValue: string }
>(
  'google/loadSearchAnalyticsDetail',
  async (
    { siteId, dimension, range = DEFAULT_GOOGLE_RANGE },
    { rejectWithValue },
  ) => {
    try {
      const { detail } = await fetchSearchAnalyticsDetail(siteId, dimension, range);
      return { siteId, dimension, range, detail };
    } catch (err) {
      if (err instanceof ApiError && err.status === 404) {
        return { siteId, dimension, range, detail: null };
      }
      return rejectWithValue(googleErrorMessage(err, 'google:searchDetail.error'));
    }
  },
);

/**
 * Load the submitted sitemaps (`?view=sitemaps`). A 200 with an empty array
 * is a legitimate empty state; a 404 (not connected / no snapshot) is mapped
 * to the same empty shape so the panel never hard-errors on "nothing yet".
 */
export const loadSitemaps = createAsyncThunk<
  { siteId: string; asOf: string | null; sitemaps: GscSitemap[] },
  string,
  { rejectValue: string }
>('google/loadSitemaps', async (siteId, { rejectWithValue }) => {
  try {
    const { asOf, sitemaps } = await fetchSitemaps(siteId);
    return { siteId, asOf, sitemaps };
  } catch (err) {
    if (err instanceof ApiError && err.status === 404) {
      return { siteId, asOf: null, sitemaps: [] };
    }
    return rejectWithValue(googleErrorMessage(err, 'google:searchDetail.error'));
  }
});

/** Fulfilled payload shared by the GA4 summary load + refresh thunks. */
export interface AnalyticsSummaryResult {
  siteId: string;
  range: GoogleRange;
  summary: GoogleAnalyticsSummary | null;
  /** 404 while the GA4 scope or property is missing on the connection. */
  notEnabled: boolean;
}

/**
 * A 404 from the analytics endpoints is "not enabled" when the connection in
 * state is missing the GA4 scope or a selected property — the connection data
 * is a more robust signal than parsing the localized error message.
 */
const analyticsNotEnabled = (state: unknown): boolean => {
  const connection = (state as { google?: GoogleConnectionState }).google
    ?.connection;
  return !hasGa4Scope(connection) || !connection?.ga4PropertyId;
};

/**
 * Load the GA4 summary for a site + range. A 404 fulfills as either
 * "not enabled" (scope/property missing) or the plain empty state.
 */
export const loadAnalyticsSummary = createAsyncThunk<
  AnalyticsSummaryResult,
  SummaryThunkArg,
  { rejectValue: string }
>(
  'google/loadAnalyticsSummary',
  async ({ siteId, range = DEFAULT_GOOGLE_RANGE }, { getState, rejectWithValue }) => {
    try {
      const { summary } = await fetchAnalyticsSummary(siteId, range);
      return { siteId, range, summary, notEnabled: false };
    } catch (err) {
      if (err instanceof ApiError && err.status === 404) {
        return {
          siteId,
          range,
          summary: null,
          notEnabled: analyticsNotEnabled(getState()),
        };
      }
      return rejectWithValue(googleErrorMessage(err, 'google:analytics.error'));
    }
  },
);

/**
 * Manually refresh the GA4 summary. Mirrors `refreshSearchSummary` (POST then
 * the ranged GET) with the 404 mapping on both legs.
 */
export const refreshAnalyticsSummary = createAsyncThunk<
  AnalyticsSummaryResult,
  SummaryThunkArg,
  { rejectValue: string }
>(
  'google/refreshAnalyticsSummary',
  async ({ siteId, range = DEFAULT_GOOGLE_RANGE }, { getState, rejectWithValue }) => {
    const mapKnown = (err: unknown): AnalyticsSummaryResult | null => {
      if (err instanceof ApiError && err.status === 404) {
        return {
          siteId,
          range,
          summary: null,
          notEnabled: analyticsNotEnabled(getState()),
        };
      }
      return null;
    };
    try {
      await requestAnalyticsSummaryRefresh(siteId);
    } catch (err) {
      const known = mapKnown(err);
      if (known) return known;
      return rejectWithValue(
        googleErrorMessage(err, 'google:analytics.refreshError'),
      );
    }
    try {
      const { summary } = await fetchAnalyticsSummary(siteId, range);
      return { siteId, range, summary, notEnabled: false };
    } catch (err) {
      const known = mapKnown(err);
      if (known) return known;
      return rejectWithValue(
        googleErrorMessage(err, 'google:analytics.refreshError'),
      );
    }
  },
);

/** Load the GA4 properties the connected account can read (picker source). */
export const loadGa4Properties = createAsyncThunk<
  { properties: Ga4Property[] },
  string,
  { rejectValue: string }
>('google/loadGa4Properties', async (siteId, { rejectWithValue }) => {
  try {
    return await fetchAnalyticsProperties(siteId);
  } catch (err) {
    return rejectWithValue(googleErrorMessage(err, 'google:analytics.propertiesError'));
  }
});

/** Persist the chosen GA4 property on the connection (PATCH). */
export const setGa4Property = createAsyncThunk<
  SetGooglePropertyResponse,
  { siteId: string; ga4PropertyId: string | null },
  { rejectValue: string }
>('google/setGa4Property', async ({ siteId, ...body }, { rejectWithValue }) => {
  try {
    return await setConnectionProperty(siteId, body);
  } catch (err) {
    return rejectWithValue(
      googleErrorMessage(err, 'google:analytics.setPropertyError'),
    );
  }
});

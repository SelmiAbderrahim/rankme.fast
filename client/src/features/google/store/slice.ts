import { createSlice } from '@reduxjs/toolkit';
import { DEFAULT_GOOGLE_RANGE } from '../lib/range';
import type {
  GoogleAnalyticsState,
  GoogleConnection,
  GoogleConnectionState,
  GscDetailSectionState,
  GscSearchDimension,
  GscSitemapsState,
} from '../types';
import {
  connectGoogle,
  disconnectGoogle,
  loadAnalyticsSummary,
  loadConnection,
  pollConnection,
  loadGa4Properties,
  loadSearchAnalyticsDetail,
  loadSearchSummary,
  loadSitemaps,
  refreshAnalyticsSummary,
  refreshSearchSummary,
  revokeGoogle,
  setGa4Property,
  setGoogleProperty,
} from './thunks';

const initialDetailSection = (): GscDetailSectionState => ({
  rows: [],
  asOf: null,
  loading: false,
  loaded: false,
  empty: false,
  error: null,
});

const initialDetail = (): Record<GscSearchDimension, GscDetailSectionState> => ({
  query: initialDetailSection(),
  page: initialDetailSection(),
  country: initialDetailSection(),
  device: initialDetailSection(),
});

const initialSitemaps = (): GscSitemapsState => ({
  items: [],
  asOf: null,
  loading: false,
  loaded: false,
  error: null,
});

const initialAnalytics = (): GoogleAnalyticsState => ({
  summary: null,
  siteId: null,
  range: null,
  loading: false,
  loaded: false,
  refreshing: false,
  empty: false,
  notEnabled: false,
  error: null,
  properties: [],
  propertiesLoading: false,
  propertiesLoaded: false,
  propertiesError: null,
  settingProperty: false,
  setPropertyError: null,
});

/**
 * Reset the analytics summary load state (keep the Site picker resources)
 * so the card refetches — used after a scope grant or a property change.
 */
const invalidateAnalyticsSummary = (analytics: GoogleAnalyticsState): void => {
  analytics.loaded = false;
  analytics.empty = false;
  analytics.notEnabled = false;
  analytics.error = null;
};

const hasPendingMatch = (connection: GoogleConnection | null): boolean =>
  [connection?.gscStatus, connection?.ga4Status].some(
    (status) => status === 'queued' || status === 'matching',
  );

const initialState: GoogleConnectionState = {
  connection: null,
  connectionSiteId: null,
  properties: [],
  loading: false,
  loaded: false,
  error: null,
  connecting: false,
  connectError: null,
  settingProperty: false,
  setPropertyError: null,
  disconnecting: false,
  disconnectError: null,
  revoking: false,
  revokeError: null,
  message: null,
  summary: null,
  summarySiteId: null,
  summaryRange: null,
  summaryLoading: false,
  summaryLoaded: false,
  summaryRefreshing: false,
  summaryEmpty: false,
  summaryError: null,
  detailSiteId: null,
  detailRange: null,
  detail: initialDetail(),
  sitemapsSiteId: null,
  sitemaps: initialSitemaps(),
  analytics: initialAnalytics(),
};

const googleSlice = createSlice({
  name: 'google',
  initialState,
  reducers: {
    clearGoogleMessages: (state) => {
      state.error = null;
      state.connectError = null;
      state.disconnectError = null;
      state.revokeError = null;
      state.message = null;
    },
    setConnectError: (state, action: { payload: string }) => {
      state.connecting = false;
      state.connectError = action.payload;
    },
    clearSetPropertyError: (state) => {
      state.setPropertyError = null;
    },
  },
  extraReducers: (builder) => {
    builder
      .addCase(loadConnection.pending, (state, action) => {
        if (state.connectionSiteId !== action.meta.arg) {
          state.connection = null;
          state.properties = [];
          state.loaded = false;
          state.analytics.properties = [];
          state.analytics.propertiesLoaded = false;
          state.analytics.propertiesError = null;
        }
        state.connectionSiteId = action.meta.arg;
        state.loading = true;
        state.error = null;
      })
      .addCase(loadConnection.fulfilled, (state, action) => {
        if (state.connectionSiteId !== action.meta.arg) return;
        state.loading = false;
        state.loaded = true;
        state.connection = action.payload.connection;
        state.properties = action.payload.properties ?? [];
      })
      .addCase(loadConnection.rejected, (state, action) => {
        if (state.connectionSiteId !== action.meta.arg) return;
        state.loading = false;
        state.loaded = true;
        state.error = action.payload ?? null;
      })
      .addCase(pollConnection.fulfilled, (state, action) => {
        if (state.connectionSiteId !== action.meta.arg) return;
        const wasPending = hasPendingMatch(state.connection);
        state.connection = action.payload.connection;
        // The lightweight poll deliberately skips live resource lists. Once
        // matching reaches a terminal state, trigger one ordinary load so the
        // Site picker immediately contains every accessible reusable resource.
        if (wasPending && !hasPendingMatch(action.payload.connection)) {
          state.loaded = false;
        }
      })
      .addCase(connectGoogle.pending, (state, action) => {
        state.connectionSiteId = action.meta.arg.siteId;
        state.connecting = true;
        state.connectError = null;
        state.message = null;
      })
      .addCase(connectGoogle.fulfilled, (state, action) => {
        if (state.connectionSiteId !== action.meta.arg.siteId) return;
        state.connecting = false;
        state.connection = action.payload.connection;
        // A (re)link may have just granted the GA4 scope — refetch both the
        // analytics summary and the accessible GA4 resource list.
        invalidateAnalyticsSummary(state.analytics);
        state.analytics.properties = [];
        state.analytics.propertiesLoaded = false;
        state.analytics.propertiesError = null;
      })
      .addCase(connectGoogle.rejected, (state, action) => {
        state.connecting = false;
        state.connectError = action.payload ?? null;
      })
      .addCase(setGoogleProperty.pending, (state, action) => {
        state.connectionSiteId = action.meta.arg.siteId;
        state.settingProperty = true;
        state.setPropertyError = null;
        state.message = null;
      })
      .addCase(setGoogleProperty.fulfilled, (state, action) => {
        if (state.connectionSiteId !== action.meta.arg.siteId) return;
        state.settingProperty = false;
        state.connection = action.payload.connection;
      })
      .addCase(setGoogleProperty.rejected, (state, action) => {
        state.settingProperty = false;
        state.setPropertyError = action.payload ?? null;
      })
      .addCase(disconnectGoogle.pending, (state, action) => {
        state.connectionSiteId = action.meta.arg;
        state.disconnecting = true;
        state.disconnectError = null;
        state.message = null;
      })
      .addCase(disconnectGoogle.fulfilled, (state, action) => {
        if (state.connectionSiteId !== action.meta.arg) return;
        state.disconnecting = false;
        state.connection = action.payload.connection;
        state.message = action.payload.message;
      })
      .addCase(disconnectGoogle.rejected, (state, action) => {
        if (state.connectionSiteId !== action.meta.arg) return;
        state.disconnecting = false;
        state.disconnectError = action.payload ?? null;
      })
      .addCase(revokeGoogle.pending, (state, action) => {
        state.connectionSiteId = action.meta.arg;
        state.revoking = true;
        state.revokeError = null;
      })
      .addCase(revokeGoogle.fulfilled, (state, action) => {
        if (state.connectionSiteId !== action.meta.arg) return;
        state.revoking = false;
        state.connection = null;
        state.properties = [];
        state.analytics = initialAnalytics();
      })
      .addCase(revokeGoogle.rejected, (state, action) => {
        if (state.connectionSiteId !== action.meta.arg) return;
        state.revoking = false;
        state.revokeError = action.payload ?? null;
      })
      .addCase(loadSearchSummary.pending, (state) => {
        state.summaryLoading = true;
        state.summaryError = null;
      })
      .addCase(loadSearchSummary.fulfilled, (state, action) => {
        state.summaryLoading = false;
        state.summaryLoaded = true;
        state.summarySiteId = action.payload.siteId;
        state.summaryRange = action.payload.range;
        state.summary = action.payload.summary;
        state.summaryEmpty = action.payload.summary === null;
      })
      .addCase(loadSearchSummary.rejected, (state, action) => {
        state.summaryLoading = false;
        state.summaryLoaded = true;
        state.summaryError = action.payload ?? null;
      })
      .addCase(refreshSearchSummary.pending, (state) => {
        // Keep the current `summary` visible under the spinner — only mark the
        // refresh in-flight and clear the previous error.
        state.summaryRefreshing = true;
        state.summaryError = null;
      })
      .addCase(refreshSearchSummary.fulfilled, (state, action) => {
        state.summaryRefreshing = false;
        state.summaryLoaded = true;
        state.summarySiteId = action.payload.siteId;
        state.summaryRange = action.payload.range;
        state.summary = action.payload.summary;
        state.summaryEmpty = action.payload.summary === null;
      })
      .addCase(refreshSearchSummary.rejected, (state, action) => {
        // Leave `summary` intact so a failed refresh never wipes good data.
        state.summaryRefreshing = false;
        state.summaryError = action.payload ?? null;
      })
      .addCase(loadSearchAnalyticsDetail.pending, (state, action) => {
        const { siteId, dimension } = action.meta.arg;
        const range = action.meta.arg.range ?? DEFAULT_GOOGLE_RANGE;
        // Re-key: a new site OR range invalidates every dimension at once.
        if (state.detailSiteId !== siteId || state.detailRange !== range) {
          state.detail = initialDetail();
          state.detailSiteId = siteId;
          state.detailRange = range;
        }
        const section = state.detail[dimension];
        section.loading = true;
        section.error = null;
      })
      .addCase(loadSearchAnalyticsDetail.fulfilled, (state, action) => {
        const { siteId, dimension, range, detail } = action.payload;
        // Drop stale responses that land after a re-key to another key.
        if (state.detailSiteId !== siteId || state.detailRange !== range) return;
        const section = state.detail[dimension];
        section.loading = false;
        section.loaded = true;
        section.rows = detail?.rows ?? [];
        section.asOf = detail?.asOf ?? null;
        section.empty = detail === null;
      })
      .addCase(loadSearchAnalyticsDetail.rejected, (state, action) => {
        const { siteId, dimension } = action.meta.arg;
        const range = action.meta.arg.range ?? DEFAULT_GOOGLE_RANGE;
        if (state.detailSiteId !== siteId || state.detailRange !== range) return;
        const section = state.detail[dimension];
        section.loading = false;
        section.loaded = true;
        section.error = action.payload ?? null;
      })
      .addCase(loadSitemaps.pending, (state, action) => {
        if (state.sitemapsSiteId !== action.meta.arg) {
          state.sitemaps = initialSitemaps();
          state.sitemapsSiteId = action.meta.arg;
        }
        state.sitemaps.loading = true;
        state.sitemaps.error = null;
      })
      .addCase(loadSitemaps.fulfilled, (state, action) => {
        if (state.sitemapsSiteId !== action.payload.siteId) return;
        state.sitemaps.loading = false;
        state.sitemaps.loaded = true;
        state.sitemaps.items = action.payload.sitemaps;
        state.sitemaps.asOf = action.payload.asOf;
      })
      .addCase(loadSitemaps.rejected, (state, action) => {
        if (state.sitemapsSiteId !== action.meta.arg) return;
        state.sitemaps.loading = false;
        state.sitemaps.loaded = true;
        state.sitemaps.error = action.payload ?? null;
      })
      .addCase(loadAnalyticsSummary.pending, (state, action) => {
        const analytics = state.analytics;
        const { siteId } = action.meta.arg;
        const range = action.meta.arg.range ?? DEFAULT_GOOGLE_RANGE;
        // Re-key: a new site invalidates the loaded summary immediately.
        if (analytics.siteId !== siteId) {
          analytics.summary = null;
          analytics.loaded = false;
          analytics.empty = false;
          analytics.notEnabled = false;
        }
        analytics.siteId = siteId;
        analytics.range = range;
        analytics.loading = true;
        analytics.error = null;
      })
      .addCase(loadAnalyticsSummary.fulfilled, (state, action) => {
        const analytics = state.analytics;
        const { siteId, range, summary, notEnabled } = action.payload;
        // Drop stale responses that land after a re-key to another key.
        if (analytics.siteId !== siteId || analytics.range !== range) return;
        analytics.loading = false;
        analytics.loaded = true;
        analytics.summary = summary;
        analytics.notEnabled = notEnabled;
        analytics.empty = summary === null && !notEnabled;
      })
      .addCase(loadAnalyticsSummary.rejected, (state, action) => {
        const analytics = state.analytics;
        const { siteId } = action.meta.arg;
        const range = action.meta.arg.range ?? DEFAULT_GOOGLE_RANGE;
        if (analytics.siteId !== siteId || analytics.range !== range) return;
        analytics.loading = false;
        analytics.loaded = true;
        analytics.error = action.payload ?? null;
      })
      .addCase(refreshAnalyticsSummary.pending, (state) => {
        // Keep the current summary visible under the spinner (search parity).
        state.analytics.refreshing = true;
        state.analytics.error = null;
      })
      .addCase(refreshAnalyticsSummary.fulfilled, (state, action) => {
        const analytics = state.analytics;
        const { siteId, range, summary, notEnabled } = action.payload;
        analytics.refreshing = false;
        analytics.loaded = true;
        analytics.siteId = siteId;
        analytics.range = range;
        analytics.summary = summary;
        analytics.notEnabled = notEnabled;
        analytics.empty = summary === null && !notEnabled;
      })
      .addCase(refreshAnalyticsSummary.rejected, (state, action) => {
        // Leave the summary intact so a failed refresh never wipes good data.
        state.analytics.refreshing = false;
        state.analytics.error = action.payload ?? null;
      })
      .addCase(loadGa4Properties.pending, (state, action) => {
        if (state.connectionSiteId !== action.meta.arg) return;
        state.analytics.propertiesLoading = true;
        state.analytics.propertiesError = null;
      })
      .addCase(loadGa4Properties.fulfilled, (state, action) => {
        if (state.connectionSiteId !== action.meta.arg) return;
        state.analytics.propertiesLoading = false;
        state.analytics.propertiesLoaded = true;
        state.analytics.properties = action.payload.properties;
      })
      .addCase(loadGa4Properties.rejected, (state, action) => {
        if (state.connectionSiteId !== action.meta.arg) return;
        state.analytics.propertiesLoading = false;
        state.analytics.propertiesLoaded = true;
        state.analytics.propertiesError = action.payload ?? null;
      })
      .addCase(setGa4Property.pending, (state, action) => {
        state.connectionSiteId = action.meta.arg.siteId;
        state.analytics.settingProperty = true;
        state.analytics.setPropertyError = null;
      })
      .addCase(setGa4Property.fulfilled, (state, action) => {
        if (state.connectionSiteId !== action.meta.arg.siteId) return;
        state.analytics.settingProperty = false;
        state.connection = action.payload.connection;
        // The property just changed — refetch the summary for it.
        invalidateAnalyticsSummary(state.analytics);
      })
      .addCase(setGa4Property.rejected, (state, action) => {
        state.analytics.settingProperty = false;
        state.analytics.setPropertyError = action.payload ?? null;
      });
  },
});

export const { clearGoogleMessages, setConnectError, clearSetPropertyError } =
  googleSlice.actions;
export const googleReducer = googleSlice.reducer;

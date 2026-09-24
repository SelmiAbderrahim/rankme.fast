import type { RootState } from '@app/store';

export const selectGoogleConnection = (state: RootState) => state.google.connection;
export const selectGoogleConnectionSiteId = (state: RootState) =>
  state.google.connectionSiteId;
export const selectGoogleLoading = (state: RootState) => state.google.loading;
export const selectGoogleLoaded = (state: RootState) => state.google.loaded;
export const selectGoogleError = (state: RootState) => state.google.error;
export const selectGoogleConnecting = (state: RootState) => state.google.connecting;
export const selectGoogleConnectError = (state: RootState) => state.google.connectError;
export const selectGoogleDisconnecting = (state: RootState) => state.google.disconnecting;
export const selectGoogleDisconnectError = (state: RootState) => state.google.disconnectError;
export const selectGoogleRevoking = (state: RootState) => state.google.revoking;
export const selectGoogleRevokeError = (state: RootState) => state.google.revokeError;
export const selectGoogleMessage = (state: RootState) => state.google.message;
export const selectGoogleProperties = (state: RootState) => state.google.properties;
export const selectGoogleSettingProperty = (state: RootState) => state.google.settingProperty;
export const selectGoogleSetPropertyError = (state: RootState) =>
  state.google.setPropertyError;
export const selectGoogleSearchSummary = (state: RootState) => state.google.summary;
export const selectGoogleSummarySiteId = (state: RootState) =>
  state.google.summarySiteId;
export const selectGoogleSummaryLoading = (state: RootState) =>
  state.google.summaryLoading;
export const selectGoogleSummaryLoaded = (state: RootState) =>
  state.google.summaryLoaded;
export const selectGoogleSummaryRefreshing = (state: RootState) =>
  state.google.summaryRefreshing;
export const selectGoogleSummaryEmpty = (state: RootState) =>
  state.google.summaryEmpty;
export const selectGoogleSummaryError = (state: RootState) =>
  state.google.summaryError;
export const selectGoogleSummaryRange = (state: RootState) =>
  state.google.summaryRange;
export const selectGoogleSearchDetail = (state: RootState) => state.google.detail;
export const selectGoogleDetailSiteId = (state: RootState) =>
  state.google.detailSiteId;
export const selectGoogleDetailRange = (state: RootState) =>
  state.google.detailRange;
export const selectGoogleSitemaps = (state: RootState) => state.google.sitemaps;
export const selectGoogleSitemapsSiteId = (state: RootState) =>
  state.google.sitemapsSiteId;
/** The whole GA4 analytics section — the card and the property picker consume it. */
export const selectGoogleAnalytics = (state: RootState) => state.google.analytics;

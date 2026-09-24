import type { RootState } from '@app/store';
import { initialAlertsState, type AlertsState } from '../types';

/**
 * The slice is lazily injected by the route loader, so every selector reads
 * through this fallback — a component rendered before injection (or in a test
 * with a bare store) sees the initial state instead of crashing.
 */
const selectSlice = (state: RootState): AlertsState =>
  (state as RootState & { alerts?: AlertsState }).alerts ?? initialAlertsState;

export const selectAlertSites = (state: RootState) => selectSlice(state).sites;
export const selectAlertSitesStatus = (state: RootState) => selectSlice(state).sitesStatus;
export const selectAlertSitesError = (state: RootState) => selectSlice(state).sitesError;
export const selectAlertRules = (state: RootState) => selectSlice(state).rules;
export const selectAlertCapUsed = (state: RootState) => selectSlice(state).capUsed;
export const selectAlertListStatus = (state: RootState) => selectSlice(state).listStatus;
export const selectAlertListGate = (state: RootState) => selectSlice(state).listGate;
export const selectAlertSaveStatus = (state: RootState) => selectSlice(state).saveStatus;
export const selectAlertSaveGate = (state: RootState) => selectSlice(state).saveGate;
export const selectRevealedSecret = (state: RootState) => selectSlice(state).revealedSecret;
export const selectAlertDeliveries = (state: RootState) => selectSlice(state).deliveries;
export const selectAlertLogStatus = (state: RootState) => selectSlice(state).logStatus;
export const selectAlertLogGate = (state: RootState) => selectSlice(state).logGate;

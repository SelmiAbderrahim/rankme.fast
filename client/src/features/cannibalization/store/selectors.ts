import type { RootState } from '@app/store';
import { initialCannibalizationState, type CannibalizationState } from '../types';

/**
 * The slice is lazily injected by the route loader, so every selector reads
 * through this fallback — a component rendered before injection (or in a test
 * with a bare store) sees the initial state instead of crashing.
 */
const selectSlice = (state: RootState): CannibalizationState =>
  (state as RootState & { cannibalization?: CannibalizationState }).cannibalization ??
  initialCannibalizationState;

export const selectCannibalizationSitesStatus = (state: RootState) =>
  selectSlice(state).sitesStatus;
export const selectCannibalizationSitesError = (state: RootState) =>
  selectSlice(state).sitesError;
export const selectCannibalizationGscConnected = (state: RootState) =>
  selectSlice(state).gscConnected;
export const selectCannibalizationReports = (state: RootState) =>
  selectSlice(state).reports;
export const selectCannibalizationListStatus = (state: RootState) =>
  selectSlice(state).listStatus;
export const selectCannibalizationListGate = (state: RootState) =>
  selectSlice(state).listGate;
export const selectCannibalizationDetail = (state: RootState) => selectSlice(state).detail;
export const selectCannibalizationDetailStatus = (state: RootState) =>
  selectSlice(state).detailStatus;
export const selectCannibalizationDetailGate = (state: RootState) =>
  selectSlice(state).detailGate;
export const selectCannibalizationPreview = (state: RootState) =>
  selectSlice(state).preview;
export const selectCannibalizationPreviewStatus = (state: RootState) =>
  selectSlice(state).previewStatus;
export const selectCannibalizationPreviewGate = (state: RootState) =>
  selectSlice(state).previewGate;
export const selectCannibalizationGenerateStatus = (state: RootState) =>
  selectSlice(state).generateStatus;
export const selectCannibalizationGenerateGate = (state: RootState) =>
  selectSlice(state).generateGate;

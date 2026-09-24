import type { RootState } from '@app/store';
import { initialGeogridState, type GeogridState } from '../types';

/**
 * The slice is lazily injected by the workspace panel, so every selector reads
 * through this fallback — a component rendered before injection (or in a test
 * with a bare store) sees the initial state instead of crashing (the shipped
 * `lazy-slice-eager-reader` hazard).
 */
const selectSlice = (state: RootState): GeogridState =>
  (state as RootState & { geogrid?: GeogridState }).geogrid ?? initialGeogridState;

export const selectGeogridSiteId = (state: RootState) => selectSlice(state).siteId;
export const selectGeogridForm = (state: RootState) => selectSlice(state).form;
export const selectGeogridScans = (state: RootState) => selectSlice(state).scans;
export const selectGeogridScansStatus = (state: RootState) => selectSlice(state).scansStatus;
export const selectGeogridScansGate = (state: RootState) => selectSlice(state).scansGate;
export const selectGeogridDetail = (state: RootState) => selectSlice(state).detail;
export const selectGeogridDetailStatus = (state: RootState) => selectSlice(state).detailStatus;
export const selectGeogridDetailGate = (state: RootState) => selectSlice(state).detailGate;
export const selectGeogridPreview = (state: RootState) => selectSlice(state).preview;
export const selectGeogridPreviewDefinition = (state: RootState) =>
  selectSlice(state).previewDefinition;
export const selectGeogridPreviewStatus = (state: RootState) => selectSlice(state).previewStatus;
export const selectGeogridPreviewGate = (state: RootState) => selectSlice(state).previewGate;
export const selectGeogridSubmitting = (state: RootState) => selectSlice(state).submitting;
export const selectGeogridSubmitGate = (state: RootState) => selectSlice(state).submitGate;

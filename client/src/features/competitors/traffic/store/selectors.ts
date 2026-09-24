import type { RootState } from '@app/store';
import { initialTrafficSnapshotsState } from './slice';

const selectSlice = (state: RootState) =>
  state.trafficSnapshots ?? initialTrafficSnapshotsState;

export const selectTrafficSnapshotList = (state: RootState) => selectSlice(state).list;
export const selectTrafficSiteId = (state: RootState) => selectSlice(state).siteId;
export const selectTrafficSnapshotDetail = (state: RootState) => selectSlice(state).detail;
export const selectTrafficSnapshotPreview = (state: RootState) => selectSlice(state).preview;
export const selectTrafficLastRequest = (state: RootState) => selectSlice(state).lastRequest;
export const selectTrafficListStatus = (state: RootState) => selectSlice(state).listStatus;
export const selectTrafficDetailStatus = (state: RootState) => selectSlice(state).detailStatus;
export const selectTrafficPreviewStatus = (state: RootState) => selectSlice(state).previewStatus;
export const selectTrafficRequestStatus = (state: RootState) => selectSlice(state).requestStatus;
export const selectTrafficListError = (state: RootState) => selectSlice(state).listError;
export const selectTrafficDetailError = (state: RootState) => selectSlice(state).detailError;
export const selectTrafficPreviewError = (state: RootState) => selectSlice(state).previewError;
export const selectTrafficRequestError = (state: RootState) => selectSlice(state).requestError;
export const selectTrafficPreviewErrorKind = (state: RootState) =>
  selectSlice(state).previewErrorKind;
export const selectTrafficRequestErrorKind = (state: RootState) =>
  selectSlice(state).requestErrorKind;
export const selectTrafficLocked = (state: RootState) =>
  selectSlice(state).previewErrorKind === 'locked' ||
  selectSlice(state).requestErrorKind === 'locked';

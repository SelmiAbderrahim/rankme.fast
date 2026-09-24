import type { RootState } from '@app/store';
import { initialState } from './slice';
import type { TeamOverview, TeamState } from '../types';

const selectSlice = (state: RootState): TeamState => state.team ?? initialState;

export const selectTeamOverview = (state: RootState) => selectSlice(state).overview;
export const selectTeamLoading = (state: RootState) => selectSlice(state).loading;
export const selectTeamLoaded = (state: RootState) => selectSlice(state).loaded;
export const selectTeamLoadError = (state: RootState) => selectSlice(state).loadError;
export const selectTeamInviting = (state: RootState) => selectSlice(state).inviting;
export const selectTeamInviteError = (state: RootState) => selectSlice(state).inviteError;
export const selectTeamRemovingId = (state: RootState) => selectSlice(state).removingId;
export const selectTeamRemoveError = (state: RootState) => selectSlice(state).removeError;
export const selectTeamAccepting = (state: RootState) => selectSlice(state).accepting;
export const selectTeamAcceptError = (state: RootState) => selectSlice(state).acceptError;
export const selectTeamMessage = (state: RootState) => selectSlice(state).message;

export const selectTeamQuery = (state: RootState): string => selectSlice(state).query;
export const selectTeamPage = (state: RootState): number => selectSlice(state).page;
export const selectTeamMeta = (state: RootState): TeamOverview['meta'] | null =>
  selectSlice(state).overview?.meta ?? null;
export const selectTeamResendingId = (state: RootState): string | null =>
  selectSlice(state).resendingId;
export const selectTeamResendError = (state: RootState): string =>
  selectSlice(state).resendError;
export const selectTeamUpdatingId = (state: RootState): string | null =>
  selectSlice(state).updatingId;
export const selectTeamUpdateError = (state: RootState): string =>
  selectSlice(state).updateError;

// Transitional aliases keep feature consumers source-compatible.
export const selectTeamRoleChangingId = selectTeamUpdatingId;
export const selectTeamRoleError = selectTeamUpdateError;

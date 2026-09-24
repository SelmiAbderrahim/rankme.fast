import { createAsyncThunk, createSlice } from '@reduxjs/toolkit';
import type { RootState } from '@app/store';
import {
  acceptPendingInvitationRequest,
  fetchPendingInvitationsRequest,
  rejectPendingInvitationRequest,
} from '../api';
import { teamErrorMessage } from '../errorMessage';
import type {
  AcceptInviteResponse,
  PendingInvitationsResponse,
  RejectInviteResponse,
  TeamInboxState,
} from '../types';

export const loadPendingInvitations = createAsyncThunk<
  PendingInvitationsResponse,
  void,
  { rejectValue: string }
>('teamInbox/load', async (_, { rejectWithValue }) => {
  try {
    return await fetchPendingInvitationsRequest();
  } catch (error) {
    return rejectWithValue(teamErrorMessage(error, 'team:inbox.loadFailed'));
  }
});

export const acceptPendingInvitation = createAsyncThunk<
  AcceptInviteResponse & { id: string },
  string,
  { rejectValue: string }
>('teamInbox/accept', async (id, { rejectWithValue }) => {
  try {
    return { ...(await acceptPendingInvitationRequest(id)), id };
  } catch (error) {
    return rejectWithValue(teamErrorMessage(error, 'team:errors.inviteNotFound'));
  }
});

export const rejectPendingInvitation = createAsyncThunk<
  RejectInviteResponse & { id: string },
  string,
  { rejectValue: string }
>('teamInbox/reject', async (id, { rejectWithValue }) => {
  try {
    return { ...(await rejectPendingInvitationRequest(id)), id };
  } catch (error) {
    return rejectWithValue(teamErrorMessage(error, 'team:errors.rejectFailed'));
  }
});

export const teamInboxInitialState: TeamInboxState = {
  invitations: [],
  status: 'idle',
  actionId: null,
  error: '',
  message: '',
};

const teamInboxSlice = createSlice({
  name: 'teamInbox',
  initialState: teamInboxInitialState,
  reducers: {
    clearInvitationInboxMessage(state) {
      state.error = '';
      state.message = '';
    },
  },
  extraReducers: (builder) => {
    builder
      .addCase(loadPendingInvitations.pending, (state) => {
        if (state.status === 'idle') state.status = 'loading';
        state.error = '';
      })
      .addCase(loadPendingInvitations.fulfilled, (state, action) => {
        state.status = 'loaded';
        state.invitations = action.payload.invitations;
      })
      .addCase(loadPendingInvitations.rejected, (state, action) => {
        state.status = 'failed';
        state.error = action.payload ?? '';
      })
      .addCase(acceptPendingInvitation.pending, (state, action) => {
        state.actionId = action.meta.arg;
        state.error = '';
      })
      .addCase(acceptPendingInvitation.fulfilled, (state, action) => {
        state.actionId = null;
        state.message = action.payload.message;
        state.invitations = state.invitations.filter((item) => item.id !== action.payload.id);
      })
      .addCase(acceptPendingInvitation.rejected, (state, action) => {
        state.actionId = null;
        state.error = action.payload ?? '';
      })
      .addCase(rejectPendingInvitation.pending, (state, action) => {
        state.actionId = action.meta.arg;
        state.error = '';
      })
      .addCase(rejectPendingInvitation.fulfilled, (state, action) => {
        state.actionId = null;
        state.message = action.payload.message;
        state.invitations = state.invitations.filter((item) => item.id !== action.payload.id);
      })
      .addCase(rejectPendingInvitation.rejected, (state, action) => {
        state.actionId = null;
        state.error = action.payload ?? '';
      });
  },
});

const selectInbox = (state: RootState): TeamInboxState =>
  state.teamInbox ?? teamInboxInitialState;

export const selectPendingInvitations = (state: RootState) => selectInbox(state).invitations;
export const selectPendingInvitationCount = (state: RootState) =>
  selectInbox(state).invitations.length;
export const selectInvitationInboxStatus = (state: RootState) => selectInbox(state).status;
export const selectInvitationInboxActionId = (state: RootState) => selectInbox(state).actionId;
export const selectInvitationInboxError = (state: RootState) => selectInbox(state).error;
export const selectInvitationInboxMessage = (state: RootState) => selectInbox(state).message;

export const { clearInvitationInboxMessage } = teamInboxSlice.actions;
export const teamInboxReducer = teamInboxSlice.reducer;

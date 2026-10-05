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

/** How long a passive refresh (mount, tab focus) treats the loaded list as fresh. */
export const INBOX_MAX_AGE_MS = 5 * 60_000;

export interface LoadPendingInvitationsOptions {
  /**
   * Skip the request when the list settled less than this many ms ago. Omit
   * for an explicit refresh (opening the drawer, the invitations page).
   */
  maxAgeMs?: number;
}

export const loadPendingInvitations = createAsyncThunk<
  PendingInvitationsResponse,
  LoadPendingInvitationsOptions | void,
  { rejectValue: string }
>(
  'teamInbox/load',
  async (_, { rejectWithValue }) => {
    try {
      return await fetchPendingInvitationsRequest();
    } catch (error) {
      return rejectWithValue(teamErrorMessage(error, 'team:inbox.loadFailed'));
    }
  },
  {
    // One GET /api/team/invitations at a time, and passive callers never
    // refetch a list that is still fresh.
    condition: (options, { getState }) => {
      const inbox = selectInbox(getState() as RootState);
      if (inbox.fetching) return false;
      const maxAgeMs = options?.maxAgeMs;
      if (maxAgeMs !== undefined && inbox.lastFetchedAt !== null) {
        return Date.now() - inbox.lastFetchedAt >= maxAgeMs;
      }
      return true;
    },
  },
);

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
  fetching: false,
  lastFetchedAt: null,
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
        state.fetching = true;
        state.error = '';
      })
      .addCase(loadPendingInvitations.fulfilled, (state, action) => {
        state.status = 'loaded';
        state.fetching = false;
        state.lastFetchedAt = Date.now();
        state.invitations = action.payload.invitations;
      })
      .addCase(loadPendingInvitations.rejected, (state, action) => {
        state.status = 'failed';
        state.fetching = false;
        state.lastFetchedAt = Date.now();
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

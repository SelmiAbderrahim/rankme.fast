import { createSlice, type PayloadAction } from '@reduxjs/toolkit';
import type { TeamState } from '../types';
import {
  acceptTeamInvite,
  inviteTeammate,
  loadTeam,
  removeTeamMember,
  resendTeamInvite,
  updateTeamMember,
} from './thunks';

export const initialState: TeamState = {
  overview: null,
  query: '',
  page: 1,
  resendingId: null,
  resendError: '',
  updatingId: null,
  updateError: '',
  loading: false,
  loaded: false,
  loadError: '',
  inviting: false,
  inviteError: '',
  removingId: null,
  removeError: '',
  accepting: false,
  acceptError: '',
  message: '',
};

const teamSlice = createSlice({
  name: 'team',
  initialState,
  reducers: {
    clearTeamMessages: (state) => {
      state.loadError = '';
      state.inviteError = '';
      state.removeError = '';
      state.acceptError = '';
      state.resendError = '';
      state.updateError = '';
      state.message = '';
    },
    setTeamQuery: (state, action: PayloadAction<string>) => {
      state.query = action.payload;
      state.page = 1;
    },
    setTeamPage: (state, action: PayloadAction<number>) => {
      state.page = Math.max(1, action.payload);
    },
  },
  extraReducers: (builder) => {
    builder
      .addCase(loadTeam.pending, (state) => {
        state.loading = true;
        state.loadError = '';
      })
      .addCase(loadTeam.fulfilled, (state, action) => {
        state.loading = false;
        state.loaded = true;
        state.overview = action.payload;
      })
      .addCase(loadTeam.rejected, (state, action) => {
        state.loading = false;
        state.loadError = action.payload ?? '';
      })
      .addCase(resendTeamInvite.pending, (state, action) => {
        state.resendingId = action.meta.arg;
        state.resendError = '';
        state.message = '';
      })
      .addCase(resendTeamInvite.fulfilled, (state, action) => {
        state.resendingId = null;
        state.message = action.payload.message;
        const rows = state.overview?.members;
        const index = rows?.findIndex((row) => row.id === action.payload.id) ?? -1;
        if (rows && index >= 0) rows[index] = action.payload.member;
      })
      .addCase(resendTeamInvite.rejected, (state, action) => {
        state.resendingId = null;
        state.resendError = action.payload ?? '';
      })
      .addCase(updateTeamMember.pending, (state, action) => {
        state.updatingId = action.meta.arg.id;
        state.updateError = '';
        state.message = '';
      })
      .addCase(updateTeamMember.fulfilled, (state, action) => {
        state.updatingId = null;
        state.message = action.payload.message;
        const rows = state.overview?.members;
        const index = rows?.findIndex((row) => row.id === action.payload.id) ?? -1;
        if (rows && index >= 0) rows[index] = action.payload.member;
      })
      .addCase(updateTeamMember.rejected, (state, action) => {
        state.updatingId = null;
        state.updateError = action.payload ?? '';
      })
      .addCase(inviteTeammate.pending, (state) => {
        state.inviting = true;
        state.inviteError = '';
        state.message = '';
      })
      .addCase(inviteTeammate.fulfilled, (state, action) => {
        state.inviting = false;
        state.message = action.payload.message;
        if (state.overview) {
          state.overview.members = [...state.overview.members, action.payload.member];
        }
      })
      .addCase(inviteTeammate.rejected, (state, action) => {
        state.inviting = false;
        state.inviteError = action.payload ?? '';
      })
      .addCase(removeTeamMember.pending, (state, action) => {
        state.removingId = action.meta.arg;
        state.removeError = '';
        state.message = '';
      })
      .addCase(removeTeamMember.fulfilled, (state, action) => {
        state.removingId = null;
        state.message = action.payload.message;
        if (state.overview) {
          state.overview.members = state.overview.members.filter(
            (member) => member.id !== action.payload.id,
          );
        }
      })
      .addCase(removeTeamMember.rejected, (state, action) => {
        state.removingId = null;
        state.removeError = action.payload ?? '';
      })
      .addCase(acceptTeamInvite.pending, (state) => {
        state.accepting = true;
        state.acceptError = '';
      })
      .addCase(acceptTeamInvite.fulfilled, (state, action) => {
        state.accepting = false;
        state.message = action.payload.message;
      })
      .addCase(acceptTeamInvite.rejected, (state, action) => {
        state.accepting = false;
        state.acceptError = action.payload ?? '';
      });
  },
});

export const { clearTeamMessages, setTeamPage, setTeamQuery } = teamSlice.actions;
export const teamReducer = teamSlice.reducer;

import { createAsyncThunk } from '@reduxjs/toolkit';
import {
  acceptInviteRequest,
  fetchTeamRequest,
  inviteMemberRequest,
  removeMemberRequest,
  resendInviteRequest,
  updateTeamMemberRequest,
} from '../api';
import { teamErrorMessage } from '../errorMessage';
import type {
  AcceptInviteResponse,
  InviteResponse,
  InviteTeamMemberInput,
  ResendInviteResponse,
  TeamListQuery,
  TeamOverview,
  UpdateMemberResponse,
  UpdateTeamMemberInput,
} from '../types';

export const loadTeam = createAsyncThunk<TeamOverview, TeamListQuery | void, { rejectValue: string }>(
  'team/load',
  async (query, { rejectWithValue }) => {
    try {
      return await fetchTeamRequest(query ?? {});
    } catch (err) {
      return rejectWithValue(teamErrorMessage(err, 'team:errors.loadFailed'));
    }
  },
);

export const inviteTeammate = createAsyncThunk<
  InviteResponse,
  InviteTeamMemberInput,
  { rejectValue: string }
>('team/invite', async (input, { rejectWithValue }) => {
  try {
    return await inviteMemberRequest(input);
  } catch (err) {
    return rejectWithValue(teamErrorMessage(err, 'team:errors.inviteFailed'));
  }
});

export const removeTeamMember = createAsyncThunk<
  { id: string; message: string },
  string,
  { rejectValue: string }
>('team/remove', async (id, { rejectWithValue }) => {
  try {
    const { message } = await removeMemberRequest(id);
    return { id, message };
  } catch (err) {
    return rejectWithValue(teamErrorMessage(err, 'team:errors.removeFailed'));
  }
});

/** Token acceptance remains an explicit user action; this never runs on mount. */
export const acceptTeamInvite = createAsyncThunk<
  AcceptInviteResponse,
  string,
  { rejectValue: string }
>('team/accept', async (token, { rejectWithValue }) => {
  try {
    return await acceptInviteRequest(token);
  } catch (error) {
    return rejectWithValue(teamErrorMessage(error, 'team:errors.inviteNotFound'));
  }
});

export const resendTeamInvite = createAsyncThunk<
  ResendInviteResponse & { id: string },
  string,
  { rejectValue: string }
>('team/resend', async (id, { rejectWithValue }) => {
  try {
    return { ...(await resendInviteRequest(id)), id };
  } catch (err) {
    return rejectWithValue(teamErrorMessage(err, 'team:errors.resendFailed'));
  }
});

export const updateTeamMember = createAsyncThunk<
  UpdateMemberResponse & { id: string },
  UpdateTeamMemberInput,
  { rejectValue: string }
>('team/updateMember', async (input, { rejectWithValue }) => {
  try {
    return { ...(await updateTeamMemberRequest(input)), id: input.id };
  } catch (err) {
    return rejectWithValue(teamErrorMessage(err, 'team:errors.accessUpdateFailed'));
  }
});

/** Source-compatible name for callers that previously changed only the role. */
export const changeTeamMemberRole = updateTeamMember;

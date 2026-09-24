import { createAsyncThunk } from '@reduxjs/toolkit';
import { ApiError } from '@shared/api/client';
import { apiErrorMessage } from '@shared/api/errorMessage';
import { createAppProfile, fetchAppProfiles, removeAppProfile } from '../api';
import type { AppProfile, RegisterAppProfileInput, RegistrationStatus } from '../types';

interface MutationFailure {
  status: Extract<RegistrationStatus, 'failed' | 'unavailable'>;
  message: string;
}

function mutationFailure(error: unknown): MutationFailure {
  const status: MutationFailure['status'] =
    error instanceof ApiError && error.status === 503 ? 'unavailable' : 'failed';
  return { status, message: apiErrorMessage(error, 'appSeo:errors.requestFailed') };
}

export const loadAppProfiles = createAsyncThunk<
  AppProfile[],
  { siteId: string },
  { rejectValue: MutationFailure }
>('appSeo/loadProfiles', async ({ siteId }, { rejectWithValue }) => {
  try {
    return await fetchAppProfiles(siteId);
  } catch (error) {
    return rejectWithValue(mutationFailure(error));
  }
});

export const registerAppProfile = createAsyncThunk<
  AppProfile,
  { siteId: string; input: RegisterAppProfileInput },
  { rejectValue: MutationFailure }
>('appSeo/registerProfile', async ({ siteId, input }, { rejectWithValue }) => {
  try {
    return await createAppProfile(siteId, input);
  } catch (error) {
    return rejectWithValue(mutationFailure(error));
  }
});

export const unregisterAppProfile = createAsyncThunk<
  string,
  { siteId: string; profileId: string },
  { rejectValue: MutationFailure }
>('appSeo/unregisterProfile', async ({ siteId, profileId }, { rejectWithValue }) => {
  try {
    await removeAppProfile(siteId, profileId);
    return profileId;
  } catch (error) {
    return rejectWithValue(mutationFailure(error));
  }
});

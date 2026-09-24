import { createAsyncThunk } from '@reduxjs/toolkit';
import { apiErrorMessage } from '@shared/api/errorMessage';
import { fetchAppSeoComparison } from '../compare-api';
import type { AppSeoComparison } from '../compare-types';

export const loadAppSeoComparison = createAsyncThunk<
  AppSeoComparison,
  { siteId: string; profileId: string },
  { rejectValue: string }
>('appSeoCompare/load', async (input, { rejectWithValue }) => {
  try {
    return await fetchAppSeoComparison(input.siteId, input.profileId);
  } catch (error) {
    return rejectWithValue(apiErrorMessage(error, 'appSeoCompare:errors.requestFailed'));
  }
});

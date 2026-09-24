import { createAsyncThunk } from '@reduxjs/toolkit';
import { getBrandingRequest, putBrandingRequest } from '../api';
import { settingsErrorMessage } from '../errorMessage';
import type { Branding } from '../types';

/** GET /api/users/branding — open to every verified user. */
export const loadBranding = createAsyncThunk<Branding, void, { rejectValue: string }>(
  'settings/loadBranding',
  async (_arg, { rejectWithValue }) => {
    try {
      const res = await getBrandingRequest();
      return res.branding;
    } catch (err) {
      return rejectWithValue(settingsErrorMessage(err, 'settings:branding.errors.loadFailed'));
    }
  },
);

/** PUT /api/users/branding — owner-only write of the workspace letterhead. */
export const saveBranding = createAsyncThunk<Branding, Branding, { rejectValue: string }>(
  'settings/saveBranding',
  async (branding, { rejectWithValue }) => {
    try {
      const res = await putBrandingRequest(branding);
      return res.branding;
    } catch (err) {
      return rejectWithValue(settingsErrorMessage(err, 'settings:branding.errors.saveFailed'));
    }
  },
);

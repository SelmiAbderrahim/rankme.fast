import { createAsyncThunk } from '@reduxjs/toolkit';
import { apiErrorMessage } from '@shared/api/errorMessage';
import {
  createTrackedAppKeyword,
  fetchAppKeywords,
  fetchTrackedAppKeywordHistory,
  previewMintAppKeyword,
  recheckTrackedAppKeyword,
  removeTrackedAppKeyword,
} from '../tracking-api';
import type {
  AppKeyword,
  AppKeywordHistoryPoint,
  AppKeywordListResponse,
  MintAppKeywordInput,
  MintAppKeywordPreview,
  RecheckAppKeywordResponse,
} from '../tracking-types';

const failure = (error: unknown) => apiErrorMessage(error, 'appSeoTracking:errors.requestFailed');

export const loadTrackedAppKeywords = createAsyncThunk<
  AppKeywordListResponse,
  { siteId: string; profileId: string },
  { rejectValue: string }
>('appSeoTracking/load', async (input, { rejectWithValue }) => {
  try { return await fetchAppKeywords(input.siteId, input.profileId); }
  catch (error) { return rejectWithValue(failure(error)); }
});

export const previewTrackedAppKeywordMint = createAsyncThunk<
  MintAppKeywordPreview,
  { siteId: string; profileId: string; input: MintAppKeywordInput },
  { rejectValue: string }
>('appSeoTracking/previewMint', async (args, { rejectWithValue }) => {
  try { return await previewMintAppKeyword(args.siteId, args.profileId, args.input); }
  catch (error) { return rejectWithValue(failure(error)); }
});

export const mintTrackedAppKeyword = createAsyncThunk<
  AppKeyword,
  { siteId: string; profileId: string; input: MintAppKeywordInput },
  { rejectValue: string }
>('appSeoTracking/mint', async (args, { rejectWithValue }) => {
  try { return await createTrackedAppKeyword(args.siteId, args.profileId, args.input); }
  catch (error) { return rejectWithValue(failure(error)); }
});

export const deleteTrackedAppKeyword = createAsyncThunk<
  string,
  { siteId: string; keywordId: string },
  { rejectValue: string }
>('appSeoTracking/delete', async (args, { rejectWithValue }) => {
  try {
    await removeTrackedAppKeyword(args.siteId, args.keywordId);
    return args.keywordId;
  } catch (error) { return rejectWithValue(failure(error)); }
});

export const previewTrackedAppKeywordRecheck = createAsyncThunk<
  RecheckAppKeywordResponse,
  { siteId: string; keywordId: string },
  { rejectValue: string }
>('appSeoTracking/previewRecheck', async (args, { rejectWithValue }) => {
  try { return await recheckTrackedAppKeyword(args.siteId, args.keywordId, false); }
  catch (error) { return rejectWithValue(failure(error)); }
});

export const confirmTrackedAppKeywordRecheck = createAsyncThunk<
  RecheckAppKeywordResponse,
  { siteId: string; keywordId: string },
  { rejectValue: string }
>('appSeoTracking/confirmRecheck', async (args, { rejectWithValue }) => {
  try { return await recheckTrackedAppKeyword(args.siteId, args.keywordId, true); }
  catch (error) { return rejectWithValue(failure(error)); }
});

export const loadTrackedAppKeywordHistory = createAsyncThunk<
  AppKeywordHistoryPoint[],
  { siteId: string; keywordId: string },
  { rejectValue: string }
>('appSeoTracking/history', async (args, { rejectWithValue }) => {
  try { return await fetchTrackedAppKeywordHistory(args.siteId, args.keywordId); }
  catch (error) { return rejectWithValue(failure(error)); }
});

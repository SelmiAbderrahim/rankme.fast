import { createAsyncThunk } from '@reduxjs/toolkit';
import {
  createGeogridScan,
  fetchGeogridScan,
  fetchGeogridScans,
  previewGeogridScan,
} from '../api';
import { toGeogridGate } from '../gate';
import type {
  GeogridCreateResponse,
  GeogridDefinition,
  GeogridGate,
  GeogridPreviewResponse,
  GeogridScanDetail,
  GeogridScanSummary,
} from '../types';

export const loadGeogridScans = createAsyncThunk<
  { scans: GeogridScanSummary[] },
  { siteId: string; keywordId?: string },
  { rejectValue: GeogridGate }
>('geogrid/loadScans', async ({ siteId, keywordId }, { rejectWithValue }) => {
  try {
    return await fetchGeogridScans(siteId, keywordId ? { keywordId } : {});
  } catch (error) {
    return rejectWithValue(toGeogridGate(error, 'geogrid.errors.loadFailed'));
  }
});

export const loadGeogridScan = createAsyncThunk<
  GeogridScanDetail,
  { siteId: string; scanId: string },
  { rejectValue: GeogridGate }
>('geogrid/loadScan', async ({ siteId, scanId }, { rejectWithValue }) => {
  try {
    return await fetchGeogridScan(siteId, scanId);
  } catch (error) {
    return rejectWithValue(toGeogridGate(error, 'geogrid.errors.loadFailed'));
  }
});

export const previewGeogrid = createAsyncThunk<
  GeogridPreviewResponse,
  { siteId: string; definition: GeogridDefinition },
  { rejectValue: GeogridGate }
>('geogrid/preview', async ({ siteId, definition }, { rejectWithValue }) => {
  try {
    return await previewGeogridScan(siteId, definition);
  } catch (error) {
    return rejectWithValue(toGeogridGate(error, 'geogrid.errors.previewFailed'));
  }
});

export const submitGeogridScan = createAsyncThunk<
  GeogridCreateResponse,
  { siteId: string; definition: GeogridDefinition },
  { rejectValue: GeogridGate }
>('geogrid/submit', async ({ siteId, definition }, { rejectWithValue }) => {
  try {
    return await createGeogridScan(siteId, definition);
  } catch (error) {
    return rejectWithValue(toGeogridGate(error, 'geogrid.errors.submitFailed'));
  }
});

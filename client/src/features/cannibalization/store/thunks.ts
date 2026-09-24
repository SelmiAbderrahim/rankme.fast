import { createAsyncThunk } from '@reduxjs/toolkit';
import i18n from 'i18next';
import {
  fetchCannibalizationReport,
  fetchCannibalizationReports,
  fetchCannibalizationPrerequisites,
  generateCannibalizationReport,
  previewCannibalizationReport,
} from '../api';
import { toCannibalizationGate } from '../gate';
import type {
  CannibalizationGate,
  CannibalizationReportDetail,
  CannibalizationReportSummary,
  CannibalizationSpendPreview,
  CannibalizationWindow,
} from '../types';

const fallback = () => i18n.t('cannibalization:states.failed.body');

export const loadCannibalizationPrerequisites = createAsyncThunk<
  { gscConnected: boolean },
  string,
  { rejectValue: string }
>('cannibalization/loadPrerequisites', async (siteId, { rejectWithValue }) => {
  try {
    return await fetchCannibalizationPrerequisites(siteId);
  } catch {
    return rejectWithValue(fallback());
  }
});

export interface LoadReportsArgs {
  siteId: string;
  windowDays?: CannibalizationWindow;
}

export const loadCannibalizationReports = createAsyncThunk<
  CannibalizationReportSummary[],
  LoadReportsArgs,
  { rejectValue: CannibalizationGate }
>('cannibalization/loadReports', async (args, { rejectWithValue }) => {
  try {
    const page = await fetchCannibalizationReports(args.siteId, {
      ...(args.windowDays !== undefined ? { windowDays: args.windowDays } : {}),
    });
    return page.items;
  } catch (error) {
    return rejectWithValue(toCannibalizationGate(error, fallback()));
  }
});

export const loadCannibalizationReport = createAsyncThunk<
  CannibalizationReportDetail,
  string,
  { rejectValue: CannibalizationGate }
>('cannibalization/loadReport', async (reportId, { rejectWithValue }) => {
  try {
    return await fetchCannibalizationReport(reportId);
  } catch (error) {
    return rejectWithValue(toCannibalizationGate(error, fallback()));
  }
});

export interface ReportActionArgs {
  siteId: string;
  windowDays: CannibalizationWindow;
}

export const previewCannibalizationReportThunk = createAsyncThunk<
  CannibalizationSpendPreview,
  ReportActionArgs,
  { rejectValue: CannibalizationGate }
>('cannibalization/preview', async (args, { rejectWithValue }) => {
  try {
    return await previewCannibalizationReport(args.siteId, args.windowDays);
  } catch (error) {
    return rejectWithValue(toCannibalizationGate(error, fallback()));
  }
});

export const generateCannibalizationReportThunk = createAsyncThunk<
  CannibalizationReportDetail,
  ReportActionArgs,
  { rejectValue: CannibalizationGate }
>('cannibalization/generate', async (args, { rejectWithValue }) => {
  try {
    return await generateCannibalizationReport(args.siteId, args.windowDays);
  } catch (error) {
    return rejectWithValue(toCannibalizationGate(error, fallback()));
  }
});

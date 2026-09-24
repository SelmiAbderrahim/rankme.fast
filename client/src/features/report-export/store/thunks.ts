import { createAsyncThunk } from '@reduxjs/toolkit';
import i18n from 'i18next';
import {
  createReportSnapshot,
  deleteReportSnapshot,
  fetchReportSnapshotBlob,
  getReportExportCapabilities,
  listAllReportShares,
  listReportSnapshots,
  revokeReportShare,
} from '../api';
import { filenameFromContentDisposition, saveBlobAs } from '../download';
import { reportExportErrorMessage } from '../errorMapping';
import type {
  CreateReportSnapshotInput,
  ReportExportCapabilities,
  ReportShareCenterPage,
  ReportShareSummary,
  ReportSnapshotPage,
  ReportSnapshotSummary,
} from '../types';

const fallback = (key: string): string => i18n.t(`report:exportUi.errors.${key}`);

export const loadReportExportCapabilities = createAsyncThunk<
  ReportExportCapabilities,
  void,
  { rejectValue: string }
>('reportExport/loadCapabilities', async (_, { rejectWithValue, signal }) => {
  try {
    return await getReportExportCapabilities();
  } catch (error) {
    if (signal.aborted) throw error;
    return rejectWithValue(reportExportErrorMessage(error, fallback('capabilities')));
  }
});

export const createAndDownloadReport = createAsyncThunk<
  ReportSnapshotSummary,
  { operationKey: string; input: CreateReportSnapshotInput },
  { rejectValue: string }
>('reportExport/createAndDownload', async ({ input }, { rejectWithValue }) => {
  try {
    const snapshot = await createReportSnapshot(input);
    const result = await fetchReportSnapshotBlob(snapshot.id);
    saveBlobAs(
      result.blob,
      filenameFromContentDisposition(
        result.contentDisposition,
        `rankmefast-${snapshot.kind.replaceAll('.', '-')}.${snapshot.format}`,
      ),
    );
    return snapshot;
  } catch (error) {
    return rejectWithValue(reportExportErrorMessage(error, fallback('create')));
  }
});

export const redownloadReportSnapshot = createAsyncThunk<
  string,
  { operationKey: string; snapshot: ReportSnapshotSummary },
  { rejectValue: string }
>('reportExport/redownload', async ({ snapshot }, { rejectWithValue }) => {
  try {
    const result = await fetchReportSnapshotBlob(snapshot.id);
    saveBlobAs(
      result.blob,
      filenameFromContentDisposition(
        result.contentDisposition,
        `rankmefast-${snapshot.kind.replaceAll('.', '-')}.${snapshot.format}`,
      ),
    );
    return snapshot.id;
  } catch (error) {
    return rejectWithValue(reportExportErrorMessage(error, fallback('download')));
  }
});

export const loadReportSnapshots = createAsyncThunk<
  ReportSnapshotPage & { append: boolean },
  { cursor?: string; append?: boolean } | undefined,
  { rejectValue: string }
>('reportExport/loadSnapshots', async (input, { rejectWithValue }) => {
  try {
    const page = await listReportSnapshots({ ...(input?.cursor ? { cursor: input.cursor } : {}) });
    return { ...page, append: input?.append === true };
  } catch (error) {
    return rejectWithValue(reportExportErrorMessage(error, fallback('list')));
  }
});

export const removeReportSnapshot = createAsyncThunk<
  string,
  { operationKey: string; snapshotId: string },
  { rejectValue: string }
>('reportExport/removeSnapshot', async ({ snapshotId }, { rejectWithValue }) => {
  try {
    await deleteReportSnapshot(snapshotId);
    return snapshotId;
  } catch (error) {
    return rejectWithValue(reportExportErrorMessage(error, fallback('delete')));
  }
});

export const loadReportShareCenter = createAsyncThunk<
  ReportShareCenterPage & { append: boolean },
  { cursor?: string; append?: boolean } | undefined,
  { rejectValue: string }
>('reportExport/loadShares', async (input, { rejectWithValue }) => {
  try {
    const page = await listAllReportShares({ ...(input?.cursor ? { cursor: input.cursor } : {}) });
    return { ...page, append: input?.append === true };
  } catch (error) {
    return rejectWithValue(reportExportErrorMessage(error, fallback('list')));
  }
});

export const revokeReportShareFromCenter = createAsyncThunk<
  ReportShareSummary,
  { operationKey: string; snapshotId: string; shareId: string },
  { rejectValue: string }
>('reportExport/revokeShare', async ({ snapshotId, shareId }, { rejectWithValue }) => {
  try {
    return await revokeReportShare(snapshotId, shareId);
  } catch (error) {
    return rejectWithValue(reportExportErrorMessage(error, fallback('revoke')));
  }
});

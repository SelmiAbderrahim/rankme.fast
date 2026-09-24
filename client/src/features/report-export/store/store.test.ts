import { configureStore } from '@reduxjs/toolkit';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError } from '@shared/api/client';
import type {
  ReportExportCapability,
  ReportShareCenterItem,
  ReportSnapshotSummary,
} from '../types';

const api = vi.hoisted(() => ({
  createReportSnapshot: vi.fn(),
  deleteReportSnapshot: vi.fn(),
  fetchReportSnapshotBlob: vi.fn(),
  getReportExportCapabilities: vi.fn(),
  listAllReportShares: vi.fn(),
  listReportSnapshots: vi.fn(),
  revokeReportShare: vi.fn(),
}));
const downloads = vi.hoisted(() => ({
  filenameFromContentDisposition: vi.fn(),
  saveBlobAs: vi.fn(),
}));

vi.mock('../api', () => api);
vi.mock('../download', () => downloads);

import { clearReportExportOperation, initialReportExportState, reportExportReducer } from './slice';
import {
  selectReportExportActiveOperation,
  selectReportExportCapabilities,
  selectReportExportCapabilitiesError,
  selectReportExportCapabilitiesLoaded,
  selectReportExportCapabilitiesLoading,
  selectReportExportEnabled,
  selectReportExportOperationError,
  selectReportShares,
  selectReportSharesCursor,
  selectReportSharesError,
  selectReportSharesLoaded,
  selectReportSharesLoading,
  selectReportSnapshots,
  selectReportSnapshotsCursor,
  selectReportSnapshotsError,
  selectReportSnapshotsLoaded,
  selectReportSnapshotsLoading,
} from './selectors';
import {
  createAndDownloadReport,
  loadReportExportCapabilities,
  loadReportShareCenter,
  loadReportSnapshots,
  redownloadReportSnapshot,
  removeReportSnapshot,
  revokeReportShareFromCenter,
} from './thunks';

const capability: ReportExportCapability = {
  kind: 'audit.run',
  kindVersion: 1,
  classification: 'report',
  targetScope: 'site_resource',
  formats: ['pdf', 'json'],
  share: { eligible: true, formats: ['view', 'pdf'] },
  brandingModes: ['rankmefast', 'white_label'],
  bounds: {
    selectedItems: 200,
    pdfItems: 200,
    csvRows: null,
    narrowingFields: ['sections'],
  },
  title: 'Audit report',
  titleKey: 'reportExports.catalog.auditRun.title',
  description: 'Stored audit evidence',
  descriptionKey: 'reportExports.catalog.auditRun.description',
  bound: 'Up to 200 findings',
  boundKey: 'reportExports.catalog.auditRun.bound',
};

function snapshot(id = 'snapshot-1'): ReportSnapshotSummary {
  return {
    id,
    kind: 'audit.run',
    format: 'pdf',
    locale: 'en',
    title: `Snapshot ${id}`,
    schemaVersion: 1,
    kindVersion: 1,
    completeness: {
      state: 'complete',
      selectedItems: 2,
      representedItems: 2,
      bound: 'All selected findings',
    },
    sourceDates: [
      {
        label: 'Observed',
        kind: 'provider_observation',
        observedAt: '2026-08-08T00:00:00.000Z',
      },
    ],
    createdAt: '2026-08-08T00:00:00.000Z',
    expiresAt: '2026-11-06T00:00:00.000Z',
  };
}

function share(id = 'share-1', snapshotId = 'snapshot-1'): ReportShareCenterItem {
  return {
    id,
    snapshotId,
    formats: ['view', 'pdf'],
    expiresAt: '2026-09-08T00:00:00.000Z',
    revokedAt: null,
    accessCount: 0,
    lastAccessedAt: null,
    createdAt: '2026-08-08T00:00:00.000Z',
    snapshot: {
      id: snapshotId,
      kind: 'audit.run',
      locale: 'en',
      title: 'Snapshot',
      expiresAt: '2026-11-06T00:00:00.000Z',
    },
  };
}

const makeStore = () => configureStore({ reducer: { reportExport: reportExportReducer } });

beforeEach(() => {
  for (const mock of [...Object.values(api), ...Object.values(downloads)]) mock.mockReset();
  api.getReportExportCapabilities.mockResolvedValue({ enabled: true, kinds: [capability] });
  api.listReportSnapshots.mockResolvedValue({ items: [snapshot()], nextCursor: 'next' });
  api.listAllReportShares.mockResolvedValue({ items: [share()], nextCursor: 'shares-next' });
  api.createReportSnapshot.mockResolvedValue(snapshot());
  api.fetchReportSnapshotBlob.mockResolvedValue({
    blob: new Blob(['pdf']),
    contentDisposition: 'attachment; filename="stored.pdf"',
  });
  api.deleteReportSnapshot.mockResolvedValue(undefined);
  api.revokeReportShare.mockResolvedValue({ ...share(), revokedAt: '2026-08-09T00:00:00.000Z' });
  downloads.filenameFromContentDisposition.mockReturnValue('stored.pdf');
});

describe('report-export store success lifecycle', () => {
  it('loads capabilities, replaces/appends pages, downloads, revokes, and denial-cleans snapshots', async () => {
    const store = makeStore();
    await store.dispatch(loadReportExportCapabilities());
    expect(store.getState().reportExport).toMatchObject({
      enabled: true,
      capabilities: [capability],
      capabilitiesLoaded: true,
      capabilitiesLoading: false,
    });

    await store.dispatch(loadReportSnapshots(undefined));
    expect(api.listReportSnapshots).toHaveBeenCalledWith({});
    api.listReportSnapshots.mockResolvedValueOnce({
      items: [snapshot('snapshot-2')],
      nextCursor: null,
    });
    await store.dispatch(loadReportSnapshots({ cursor: 'next', append: true }));
    expect(api.listReportSnapshots).toHaveBeenLastCalledWith({ cursor: 'next' });
    expect(store.getState().reportExport.snapshots.map((item) => item.id)).toEqual([
      'snapshot-1',
      'snapshot-2',
    ]);

    await store.dispatch(loadReportShareCenter(undefined));
    api.listAllReportShares.mockResolvedValueOnce({
      items: [share('share-2', 'snapshot-2')],
      nextCursor: null,
    });
    await store.dispatch(loadReportShareCenter({ cursor: 'shares-next', append: true }));
    expect(api.listAllReportShares).toHaveBeenLastCalledWith({ cursor: 'shares-next' });
    expect(store.getState().reportExport.shares).toHaveLength(2);

    api.createReportSnapshot.mockResolvedValueOnce({
      ...snapshot('snapshot-2'),
      title: 'Updated snapshot',
    });
    await store.dispatch(
      createAndDownloadReport({
        operationKey: 'create:one',
        input: {
          kind: 'audit.run',
          format: 'pdf',
          target: { scope: 'site_resource', siteId: 'site', resourceId: 'audit' },
          selection: {},
        },
      }),
    );
    expect(downloads.filenameFromContentDisposition).toHaveBeenCalledWith(
      'attachment; filename="stored.pdf"',
      'rankmefast-audit-run.pdf',
    );
    expect(downloads.saveBlobAs).toHaveBeenCalledWith(expect.any(Blob), 'stored.pdf');
    expect(
      store.getState().reportExport.snapshots.find((item) => item.id === 'snapshot-2')?.title,
    ).toBe('Updated snapshot');

    await store.dispatch(
      redownloadReportSnapshot({
        operationKey: 'download:one',
        snapshot: snapshot('snapshot-1'),
      }),
    );
    await store.dispatch(
      revokeReportShareFromCenter({
        operationKey: 'revoke:one',
        snapshotId: 'snapshot-1',
        shareId: 'share-1',
      }),
    );
    expect(store.getState().reportExport.shares[0]?.revokedAt).toBe('2026-08-09T00:00:00.000Z');
    await store.dispatch(
      removeReportSnapshot({
        operationKey: 'remove:one',
        snapshotId: 'snapshot-1',
      }),
    );
    expect(store.getState().reportExport.snapshots.some((item) => item.id === 'snapshot-1')).toBe(
      false,
    );
    expect(store.getState().reportExport.shares[0]).toMatchObject({ snapshot: null });
    expect(store.getState().reportExport.activeOperation).toBeNull();
  });

  it('exposes operation progress and clears stale operation state', async () => {
    let resolve!: (value: ReportSnapshotSummary) => void;
    api.createReportSnapshot.mockReturnValueOnce(
      new Promise<ReportSnapshotSummary>((done) => {
        resolve = done;
      }),
    );
    const store = makeStore();
    const pending = store.dispatch(
      createAndDownloadReport({
        operationKey: 'create:pending',
        input: {
          kind: 'audit.run',
          format: 'pdf',
          target: { scope: 'site', siteId: 'site' },
          selection: {},
        },
      }),
    );
    expect(store.getState().reportExport.activeOperation).toBe('create:pending');
    resolve(snapshot());
    await pending;
    store.dispatch(clearReportExportOperation());
    expect(store.getState().reportExport).toMatchObject({
      activeOperation: null,
      operationError: '',
    });
  });
});

describe('report-export store failure and selector matrix', () => {
  it('retains localized API errors across each load and operation rejection', async () => {
    const localized = new ApiError('raw', 422, {
      error: { message: 'Localized refusal' },
    });
    const store = makeStore();
    api.getReportExportCapabilities.mockRejectedValueOnce(localized);
    api.listReportSnapshots.mockRejectedValueOnce(localized);
    api.listAllReportShares.mockRejectedValueOnce(localized);
    api.createReportSnapshot.mockRejectedValueOnce(localized);
    api.fetchReportSnapshotBlob.mockRejectedValueOnce(localized);
    api.deleteReportSnapshot.mockRejectedValueOnce(localized);
    api.revokeReportShare.mockRejectedValueOnce(localized);

    await store.dispatch(loadReportExportCapabilities());
    await store.dispatch(loadReportSnapshots(undefined));
    await store.dispatch(loadReportShareCenter(undefined));
    await store.dispatch(
      createAndDownloadReport({
        operationKey: 'create:failure',
        input: {
          kind: 'audit.run',
          format: 'pdf',
          target: { scope: 'site', siteId: 'site' },
          selection: {},
        },
      }),
    );
    await store.dispatch(
      redownloadReportSnapshot({
        operationKey: 'download:failure',
        snapshot: snapshot(),
      }),
    );
    await store.dispatch(
      removeReportSnapshot({ operationKey: 'delete:failure', snapshotId: 'snapshot-1' }),
    );
    await store.dispatch(
      revokeReportShareFromCenter({
        operationKey: 'revoke:failure',
        snapshotId: 'snapshot-1',
        shareId: 'share-1',
      }),
    );
    expect(store.getState().reportExport).toMatchObject({
      capabilitiesLoaded: true,
      capabilitiesError: 'Localized refusal',
      snapshotsLoaded: true,
      snapshotsError: 'Localized refusal',
      sharesLoaded: true,
      sharesError: 'Localized refusal',
      activeOperation: null,
      operationError: 'Localized refusal',
    });
  });

  it('does not turn an explicit capability abort into a user-facing refusal', async () => {
    let reject!: (reason: Error) => void;
    api.getReportExportCapabilities.mockReturnValueOnce(
      new Promise((_resolve, fail) => {
        reject = fail;
      }),
    );
    const store = makeStore();
    const pending = store.dispatch(loadReportExportCapabilities());
    pending.abort();
    reject(new Error('aborted'));
    const action = await pending;
    expect(action.meta.requestStatus).toBe('rejected');
    expect(action.payload).toBeUndefined();
    expect(store.getState().reportExport.capabilitiesError).toBe('');
  });

  it('keeps empty fallbacks for unvalued rejections and ignores an unknown revoked share', () => {
    let current = reportExportReducer(
      initialReportExportState,
      loadReportSnapshots.rejected(new Error('aborted'), 'snapshots-request', undefined),
    );
    expect(current.snapshotsError).toBe('');
    current = reportExportReducer(
      current,
      loadReportShareCenter.rejected(new Error('aborted'), 'shares-request', undefined),
    );
    expect(current.sharesError).toBe('');
    current = reportExportReducer(
      current,
      removeReportSnapshot.rejected(new Error('aborted'), 'delete-request', {
        operationKey: 'delete:missing',
        snapshotId: 'missing',
      }),
    );
    expect(current.operationError).toBe('');
    current = reportExportReducer(
      current,
      revokeReportShareFromCenter.fulfilled(share('missing'), 'revoke-request', {
        operationKey: 'revoke:missing',
        snapshotId: 'snapshot-1',
        shareId: 'missing',
      }),
    );
    expect(current.shares).toEqual([]);
  });

  it('selects every state field and uses a stable empty fallback when the reducer is absent', () => {
    const store = makeStore();
    const state = store.getState() as never;
    expect(selectReportExportCapabilities(state)).toEqual([]);
    expect(selectReportExportEnabled(state)).toBe(false);
    expect(selectReportExportCapabilitiesLoading(state)).toBe(false);
    expect(selectReportExportCapabilitiesLoaded(state)).toBe(false);
    expect(selectReportExportCapabilitiesError(state)).toBe('');
    expect(selectReportSnapshots(state)).toEqual([]);
    expect(selectReportSnapshotsCursor(state)).toBeNull();
    expect(selectReportSnapshotsLoading(state)).toBe(false);
    expect(selectReportSnapshotsLoaded(state)).toBe(false);
    expect(selectReportSnapshotsError(state)).toBe('');
    expect(selectReportShares(state)).toEqual([]);
    expect(selectReportSharesCursor(state)).toBeNull();
    expect(selectReportSharesLoading(state)).toBe(false);
    expect(selectReportSharesLoaded(state)).toBe(false);
    expect(selectReportSharesError(state)).toBe('');
    expect(selectReportExportActiveOperation(state)).toBeNull();
    expect(selectReportExportOperationError(state)).toBe('');
    expect(selectReportSnapshots({} as never)).toBe(initialReportExportState.snapshots);
  });
});

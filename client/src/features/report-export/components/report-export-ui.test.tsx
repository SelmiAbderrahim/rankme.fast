import { beforeEach, describe, expect, it, vi } from 'vitest';
import { configureStore } from '@reduxjs/toolkit';
import { Provider } from 'react-redux';
import { I18nextProvider } from 'react-i18next';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, useLocation } from 'react-router-dom';
import { ApiError } from '@shared/api/client';
import { i18n, initI18n } from '@shared/i18n';
import type {
  ReportExportCapability,
  ReportExportState,
  ReportShareCenterItem,
  ReportShareSummary,
  ReportSnapshotSummary,
} from '../types';

vi.mock('../api', () => ({
  createReportShare: vi.fn(),
  createReportSnapshot: vi.fn(),
  deleteReportSnapshot: vi.fn(),
  fetchReportSnapshotBlob: vi.fn(),
  getReportExportCapabilities: vi.fn(),
  listAllReportShares: vi.fn(),
  listReportShares: vi.fn(),
  listReportSnapshots: vi.fn(),
  revokeReportShare: vi.fn(),
}));

vi.mock('../download', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../download')>();
  return { ...actual, saveBlobAs: vi.fn() };
});

import {
  createReportShare,
  createReportSnapshot,
  deleteReportSnapshot,
  fetchReportSnapshotBlob,
  getReportExportCapabilities,
  listAllReportShares,
  listReportShares,
  listReportSnapshots,
  revokeReportShare,
} from '../api';
import { saveBlobAs } from '../download';
import { initialReportExportState, reportExportReducer } from '../store/slice';
import { ExportCenterPage } from './ExportCenterPage';
import { ReportExportControl } from './ReportExportControl';
import { ReportShareDialog } from './ReportShareDialog';

const mockedCreateShare = vi.mocked(createReportShare);
const mockedCreateSnapshot = vi.mocked(createReportSnapshot);
const mockedDeleteSnapshot = vi.mocked(deleteReportSnapshot);
const mockedFetchBlob = vi.mocked(fetchReportSnapshotBlob);
const mockedCapabilities = vi.mocked(getReportExportCapabilities);
const mockedListAllShares = vi.mocked(listAllReportShares);
const mockedListShares = vi.mocked(listReportShares);
const mockedListSnapshots = vi.mocked(listReportSnapshots);
const mockedRevokeShare = vi.mocked(revokeReportShare);
const mockedSaveBlob = vi.mocked(saveBlobAs);

const capability: ReportExportCapability = {
  kind: 'audit.run',
  kindVersion: 1,
  classification: 'report',
  targetScope: 'site_resource',
  formats: ['pdf', 'csv'],
  share: { eligible: true, formats: ['view', 'pdf', 'csv'] },
  brandingModes: ['rankmefast', 'white_label'],
  bounds: {
    selectedItems: 100,
    pdfItems: 100,
    csvRows: 1_000,
    narrowingFields: ['pageIds'],
  },
  title: 'Audit report',
  titleKey: 'reportExports.catalog.auditRun.title',
  description: 'An immutable audit.',
  descriptionKey: 'reportExports.catalog.auditRun.description',
  bound: '100 pages',
  boundKey: 'reportExports.catalog.auditRun.bound',
};

function snapshot(overrides: Partial<ReportSnapshotSummary> = {}): ReportSnapshotSummary {
  return {
    id: 'snapshot-one',
    kind: 'audit.run',
    format: 'pdf',
    locale: 'en',
    title: 'August audit',
    schemaVersion: 1,
    kindVersion: 1,
    completeness: {
      state: 'complete',
      selectedItems: 10,
      representedItems: 10,
      bound: 'selection',
    },
    sourceDates: [],
    createdAt: '2026-08-01T00:00:00.000Z',
    expiresAt: '2999-09-01T00:00:00.000Z',
    ...overrides,
  };
}

function share(overrides: Partial<ReportShareSummary> = {}): ReportShareSummary {
  return {
    id: 'share-one',
    snapshotId: 'snapshot-one',
    formats: ['view', 'pdf'],
    expiresAt: '2999-09-01T00:00:00.000Z',
    revokedAt: null,
    accessCount: 3,
    lastAccessedAt: null,
    createdAt: '2026-08-02T00:00:00.000Z',
    ...overrides,
  };
}

function centerShare(overrides: Partial<ReportShareCenterItem> = {}): ReportShareCenterItem {
  return {
    ...share(),
    snapshot: {
      id: 'snapshot-one',
      kind: 'audit.run',
      locale: 'en',
      title: 'August audit',
      expiresAt: '2999-09-01T00:00:00.000Z',
    },
    ...overrides,
  };
}

function state(overrides: Partial<ReportExportState> = {}): ReportExportState {
  return {
    ...initialReportExportState,
    enabled: true,
    capabilities: [capability],
    capabilitiesLoaded: true,
    snapshotsLoaded: true,
    sharesLoaded: true,
    ...overrides,
  };
}

function LocationProbe() {
  const location = useLocation();
  return <output data-testid="location-search">{location.search}</output>;
}

function renderWithStore(child: React.ReactNode, reportExport = state(), entry = '/exports') {
  const store = configureStore({
    reducer: { reportExport: reportExportReducer },
    preloadedState: { reportExport },
  });
  return {
    store,
    ...render(
      <Provider store={store}>
        <I18nextProvider i18n={i18n}>
          <MemoryRouter initialEntries={[entry]}>
            {child}
            <LocationProbe />
          </MemoryRouter>
        </I18nextProvider>
      </Provider>,
    ),
  };
}

beforeEach(async () => {
  initI18n({ initialLocale: 'en' });
  await i18n.changeLanguage('en');
  vi.clearAllMocks();
  mockedCapabilities.mockResolvedValue({ enabled: true, kinds: [capability] });
  mockedCreateSnapshot.mockResolvedValue(snapshot());
  mockedCreateShare.mockResolvedValue({ ...share(), url: 'https://rankme.test/share/secret' });
  mockedListSnapshots.mockResolvedValue({ items: [], nextCursor: null });
  mockedListAllShares.mockResolvedValue({ items: [], nextCursor: null });
  mockedListShares.mockResolvedValue([]);
  mockedDeleteSnapshot.mockResolvedValue(undefined);
  mockedRevokeShare.mockImplementation(async (_snapshotId, _shareId) => ({
    ...share(),
    revokedAt: '2026-08-03T00:00:00.000Z',
  }));
  mockedFetchBlob.mockResolvedValue({
    blob: new Blob(['pdf'], { type: 'application/pdf' }),
    contentDisposition: 'attachment; filename="audit.pdf"',
  });
});

describe('ReportExportControl', () => {
  it('downloads an allowed format and opens sharing from the keyboard-accessible menu', async () => {
    const user = userEvent.setup();
    renderWithStore(
      <ReportExportControl
        kind="audit.run"
        target={{ scope: 'site_resource', siteId: 'site-one', resourceId: 'audit-one' }}
        selection={{ pageIds: ['page-one'] }}
        locale="fr"
      />,
    );

    const trigger = screen.getByRole('button', { name: 'Export or share' });
    await user.click(trigger);
    expect(await screen.findByText('Audit report')).toBeVisible();
    await user.click(screen.getByRole('menuitem', { name: 'PDF' }));

    await waitFor(() =>
      expect(mockedCreateSnapshot).toHaveBeenCalledWith({
        kind: 'audit.run',
        format: 'pdf',
        target: { scope: 'site_resource', siteId: 'site-one', resourceId: 'audit-one' },
        selection: { pageIds: ['page-one'] },
        locale: 'fr',
      }),
    );
    expect(mockedFetchBlob).toHaveBeenCalledWith('snapshot-one');
    expect(mockedSaveBlob).toHaveBeenCalledWith(expect.any(Blob), 'audit.pdf');

    await user.click(trigger);
    await user.click(screen.getByRole('menuitem', { name: 'Create share link' }));
    expect(
      await screen.findByRole('dialog', { name: 'Share an immutable report' }),
    ).toHaveAttribute('dir', 'ltr');
  });

  it('reports a failed export through an alert and retries the same format', async () => {
    mockedCreateSnapshot
      .mockRejectedValueOnce(new Error('provider text must stay private'))
      .mockResolvedValueOnce(snapshot());
    const user = userEvent.setup();
    renderWithStore(
      <ReportExportControl
        kind="audit.run"
        target={{ scope: 'account_resource', resourceId: 'landscape-one' }}
      />,
    );
    await user.click(screen.getByRole('button', { name: 'Export or share' }));
    await user.click(screen.getByRole('menuitem', { name: 'CSV' }));
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'The report could not be exported. Narrow the scope and try again.',
    );
    await user.click(within(screen.getByRole('alert')).getByRole('button', { name: 'Try again' }));
    await waitFor(() => expect(mockedCreateSnapshot).toHaveBeenCalledTimes(2));
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('fails closed when exports or the requested kind are unavailable and retries capability errors', async () => {
    const { rerender } = renderWithStore(
      <ReportExportControl kind="missing.kind" target={{ scope: 'site', siteId: 'site-one' }} />,
      state({ enabled: false }),
    );
    expect(screen.getByRole('button', { name: 'Export unavailable' })).toBeDisabled();

    const errorStore = configureStore({
      reducer: { reportExport: reportExportReducer },
      preloadedState: {
        reportExport: state({
          capabilitiesLoaded: false,
          capabilitiesError: 'Export options could not be loaded.',
        }),
      },
    });
    mockedCapabilities.mockRejectedValue(new Error('offline'));
    rerender(
      <Provider store={errorStore}>
        <I18nextProvider i18n={i18n}>
          <MemoryRouter>
            <ReportExportControl kind="audit.run" target={{ scope: 'site', siteId: 'site-one' }} />
          </MemoryRouter>
        </I18nextProvider>
      </Provider>,
    );
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Export options could not be loaded.',
    );
    mockedCapabilities.mockResolvedValue({ enabled: true, kinds: [capability] });
    await userEvent.click(
      within(screen.getByRole('alert')).getByRole('button', { name: 'Try again' }),
    );
    await waitFor(() => expect(mockedCapabilities).toHaveBeenCalledTimes(2));
  });

  it('renders a loading fallback, busy announcement, disabled input, and non-shareable capability', async () => {
    const loadingView = renderWithStore(
      <ReportExportControl
        kind="audit.run"
        target={{ scope: 'site_resource', siteId: 'site-one', resourceId: 'audit-one' }}
        disabled
      />,
      state({
        capabilities: [],
        capabilitiesLoaded: false,
        capabilitiesLoading: true,
        activeOperation: 'audit.run:site_resource:audit-one',
      }),
    );
    expect(screen.getByRole('button', { name: 'Export or share' })).toBeDisabled();
    expect(screen.getAllByText('Preparing file…')).toHaveLength(2);
    loadingView.unmount();

    const privateCapability = {
      ...capability,
      share: { eligible: false, formats: [] as [] },
    };
    const user = userEvent.setup();
    renderWithStore(
      <ReportExportControl kind="audit.run" target={{ scope: 'site', siteId: 'site-one' }} />,
      state({ capabilities: [privateCapability] }),
    );
    await user.click(screen.getByRole('button', { name: 'Export or share' }));
    expect(await screen.findByText('Audit report')).toBeVisible();
    expect(screen.queryByRole('menuitem', { name: 'Create share link' })).toBeNull();
  });
});

describe('ReportShareDialog', () => {
  it('validates bounds, creates one immutable link, copies it, refreshes history, and revokes it', async () => {
    const onOpenChange = vi.fn();
    const user = userEvent.setup();
    const clipboard = vi.spyOn(navigator.clipboard, 'writeText').mockResolvedValue(undefined);
    renderWithStore(
      <ReportShareDialog
        open
        onOpenChange={onOpenChange}
        capability={capability}
        target={{ scope: 'site_resource', siteId: 'site-one', resourceId: 'audit-one' }}
        selection={{ pageIds: ['page-one'] }}
      />,
    );

    await user.click(screen.getByRole('combobox', { name: 'Report language' }));
    await user.click(await screen.findByRole('option', { name: 'Français' }));

    const expiry = screen.getByLabelText('Expires after');
    await user.clear(expiry);
    await user.type(expiry, '91');
    expect(screen.getByRole('button', { name: 'Create link' })).toBeDisabled();
    await user.clear(expiry);
    await user.type(expiry, '7');

    for (const label of ['Web view', 'PDF', 'CSV']) {
      await user.click(screen.getByRole('checkbox', { name: label }));
    }
    expect(screen.getByRole('button', { name: 'Create link' })).toBeDisabled();
    await user.click(screen.getByRole('checkbox', { name: 'Web view' }));
    await user.click(screen.getByRole('button', { name: 'Create link' }));

    await waitFor(() =>
      expect(mockedCreateSnapshot).toHaveBeenCalledWith({
        kind: 'audit.run',
        format: 'pdf',
        target: { scope: 'site_resource', siteId: 'site-one', resourceId: 'audit-one' },
        selection: { pageIds: ['page-one'] },
        locale: 'fr',
      }),
    );
    expect(mockedCreateShare).toHaveBeenCalledWith('snapshot-one', {
      expiresInDays: 7,
      formats: ['view'],
    });
    const linkInput = await screen.findByDisplayValue('https://rankme.test/share/secret');
    expect(linkInput).toBeVisible();
    const selectText = vi.spyOn(HTMLInputElement.prototype, 'select');
    fireEvent.focus(linkInput);
    expect(selectText).toHaveBeenCalledOnce();

    await user.click(screen.getByRole('button', { name: 'Copy link' }));
    expect(clipboard).toHaveBeenCalledWith('https://rankme.test/share/secret');
    expect(screen.getByRole('button', { name: 'Copied' })).toBeVisible();

    mockedListShares.mockResolvedValue([
      share({ id: 'expired', expiresAt: '2000-01-01T00:00:00.000Z' }),
    ]);
    await user.click(screen.getByRole('button', { name: 'Refresh' }));
    expect(await screen.findByText('Expired')).toBeVisible();

    mockedListShares.mockResolvedValue([
      share(),
      share({ id: 'share-other', revokedAt: '2026-08-02T12:00:00.000Z' }),
    ]);
    await user.click(screen.getByRole('button', { name: 'Refresh' }));
    const revokeTrigger = await screen.findByRole('button', { name: 'Revoke' });
    await user.click(revokeTrigger);
    const alertDialog = await screen.findByRole('alertdialog', { name: 'Revoke this link?' });
    await user.click(within(alertDialog).getByRole('button', { name: 'Revoke' }));
    await waitFor(() =>
      expect(mockedRevokeShare).toHaveBeenCalledWith('snapshot-one', 'share-one'),
    );
    await waitFor(() => expect(screen.getAllByText('Revoked')).toHaveLength(2));

    await user.click(screen.getByRole('button', { name: 'Done' }));
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it('maps create, copy, list, and revoke failures without exposing thrown details', async () => {
    mockedCreateSnapshot
      .mockRejectedValueOnce(new Error('provider secret'))
      .mockResolvedValue(snapshot());
    const user = userEvent.setup();
    vi.spyOn(navigator.clipboard, 'writeText').mockRejectedValue(new Error('browser secret'));
    renderWithStore(
      <ReportShareDialog
        open
        onOpenChange={vi.fn()}
        capability={capability}
        target={{ scope: 'site', siteId: 'site-one' }}
        selection={{}}
      />,
    );

    await user.click(screen.getByRole('button', { name: 'Create link' }));
    expect(await screen.findByText('The share link could not be created.')).toBeVisible();
    expect(screen.queryByText(/provider secret/)).toBeNull();
    await user.click(screen.getByRole('button', { name: 'Create link' }));
    await user.click(await screen.findByRole('button', { name: 'Copy link' }));
    expect(await screen.findByText('The link could not be copied.')).toBeVisible();

    mockedListShares.mockRejectedValueOnce(new Error('list secret'));
    await user.click(screen.getByRole('button', { name: 'Refresh' }));
    expect(await screen.findByText('Saved exports could not be loaded.')).toBeVisible();

    mockedRevokeShare.mockRejectedValueOnce(
      new ApiError('http', 409, { error: { message: 'This link is already revoked.' } }),
    );
    const revokeTrigger = screen.getByRole('button', { name: 'Revoke' });
    await user.click(revokeTrigger);
    const alertDialog = await screen.findByRole('alertdialog');
    await user.click(within(alertDialog).getByRole('button', { name: 'Revoke' }));
    expect(await screen.findByText('This link is already revoked.')).toBeVisible();
  });

  it('resets transient state when closed and falls back to English for an unsupported runtime locale', async () => {
    await i18n.changeLanguage('xx');
    const { rerender } = renderWithStore(
      <ReportShareDialog
        open
        onOpenChange={vi.fn()}
        capability={capability}
        target={{ scope: 'site', siteId: 'site-one' }}
        selection={{}}
      />,
    );
    expect(screen.getByText('Share an immutable report')).toBeVisible();
    rerender(
      <Provider store={configureStore({ reducer: { reportExport: reportExportReducer } })}>
        <I18nextProvider i18n={i18n}>
          <MemoryRouter>
            <ReportShareDialog
              open={false}
              onOpenChange={vi.fn()}
              capability={capability}
              target={{ scope: 'site', siteId: 'site-one' }}
              selection={{}}
            />
          </MemoryRouter>
        </I18nextProvider>
      </Provider>,
    );
    expect(screen.queryByRole('dialog')).toBeNull();
  });
});

describe('ExportCenterPage', () => {
  it('keeps the active tab in the URL and supports paged downloads, deletion, and share revocation', async () => {
    const active = centerShare();
    const revoked = centerShare({
      id: 'share-revoked',
      revokedAt: '2026-08-03T00:00:00.000Z',
      snapshot: null,
    });
    const expired = centerShare({
      id: 'share-expired',
      expiresAt: '2000-01-01T00:00:00.000Z',
      snapshot: { ...active.snapshot!, id: 'snapshot-expired', title: 'Old audit' },
    });
    mockedListAllShares.mockResolvedValue({ items: [], nextCursor: null });
    mockedListSnapshots.mockResolvedValue({ items: [], nextCursor: null });
    const user = userEvent.setup();
    renderWithStore(
      <ExportCenterPage />,
      state({
        snapshots: [snapshot()],
        snapshotsCursor: 'snapshot-cursor',
        shares: [active, revoked, expired],
        sharesCursor: 'share-cursor',
      }),
      '/exports?tab=shares&kept=yes',
    );

    expect(await screen.findByRole('tab', { name: 'Shares' })).toHaveAttribute(
      'data-state',
      'active',
    );
    expect(screen.getByText('Active')).toBeVisible();
    expect(screen.getByText('Revoked')).toBeVisible();
    expect(screen.getByText('Expired')).toBeVisible();
    expect(screen.getByText('Deleted or expired report')).toBeVisible();

    const revokeTrigger = screen.getByRole('button', { name: 'Revoke' });
    await user.click(revokeTrigger);
    const revokeDialog = await screen.findByRole('alertdialog', { name: 'Revoke this link?' });
    await user.click(within(revokeDialog).getByRole('button', { name: 'Revoke' }));
    await waitFor(() =>
      expect(mockedRevokeShare).toHaveBeenCalledWith('snapshot-one', 'share-one'),
    );

    mockedListAllShares.mockResolvedValue({ items: [], nextCursor: null });
    await user.click(screen.getByRole('button', { name: 'Load more' }));
    expect(mockedListAllShares).toHaveBeenCalledWith({ cursor: 'share-cursor' });

    await user.click(screen.getByRole('tab', { name: 'Downloads' }));
    expect(screen.getByTestId('location-search')).toHaveTextContent('?tab=downloads&kept=yes');
    const downloadButtons = screen.getAllByRole('button', { name: 'Download' });
    await user.click(downloadButtons[0]!);
    await waitFor(() => expect(mockedFetchBlob).toHaveBeenCalledWith('snapshot-one'));

    const deleteButtons = screen.getAllByRole('button', { name: 'Delete' });
    await user.click(deleteButtons[0]!);
    const deleteDialog = await screen.findByRole('alertdialog', {
      name: 'Delete this saved export?',
    });
    await user.click(within(deleteDialog).getByRole('button', { name: 'Delete' }));
    await waitFor(() => expect(mockedDeleteSnapshot).toHaveBeenCalledWith('snapshot-one'));

    mockedListSnapshots.mockResolvedValue({ items: [], nextCursor: null });
    const more = screen.queryByRole('button', { name: 'Load more' });
    if (more) await user.click(more);
  });

  it('renders invalid-tab and capability retry states accessibly', async () => {
    mockedCapabilities.mockRejectedValue(new Error('offline'));
    const user = userEvent.setup();
    renderWithStore(
      <ExportCenterPage />,
      state({
        enabled: true,
        capabilitiesError: 'Export options could not be loaded.',
        snapshotsLoaded: true,
        snapshotsLoading: false,
        sharesLoaded: true,
        sharesLoading: false,
      }),
      '/exports?tab=unknown',
    );
    expect(screen.getByRole('tab', { name: 'Downloads' })).toHaveAttribute('data-state', 'active');
    expect(screen.getByLabelText('Export center sections')).toBeVisible();
    const errorAlert = await screen.findByRole('alert');
    expect(errorAlert).toHaveTextContent('Export options could not be loaded.');
    await user.click(within(errorAlert).getByRole('button', { name: 'Try again' }));
    await waitFor(() => expect(mockedCapabilities).toHaveBeenCalledTimes(2));
    await user.click(screen.getByRole('tab', { name: 'Shares' }));
    mockedCapabilities.mockResolvedValue({ enabled: false, kinds: [] });
    const shareCapabilityAlert = screen.getByRole('alert');
    await user.click(
      within(shareCapabilityAlert).getByRole('button', { name: 'Try again' }),
    );
    await waitFor(() => expect(mockedCapabilities).toHaveBeenCalled());

    mockedListSnapshots.mockResolvedValue({ items: [], nextCursor: null });
    mockedListAllShares.mockResolvedValue({ items: [], nextCursor: null });
  });

  it('renders both loading regions and retries collection-specific errors', async () => {
    mockedListSnapshots.mockReturnValue(new Promise(() => undefined));
    const downloadsLoading = renderWithStore(
      <ExportCenterPage />,
      state({ snapshotsLoaded: false, snapshotsLoading: true }),
    );
    expect(document.querySelector('[aria-busy="true"]')).toBeInTheDocument();
    downloadsLoading.unmount();

    mockedListAllShares.mockReturnValue(new Promise(() => undefined));
    const sharesLoading = renderWithStore(
      <ExportCenterPage />,
      state({ sharesLoaded: false, sharesLoading: true }),
      '/exports?tab=shares',
    );
    expect(document.querySelector('[aria-busy="true"]')).toBeInTheDocument();
    sharesLoading.unmount();

    mockedListSnapshots.mockResolvedValue({ items: [], nextCursor: null });
    mockedListAllShares.mockResolvedValue({ items: [], nextCursor: null });
    const user = userEvent.setup();
    renderWithStore(
      <ExportCenterPage />,
      state({
        snapshotsError: 'Snapshot list failed.',
        sharesError: 'Share list failed.',
        operationError: 'The last operation failed.',
      }),
    );
    expect(screen.getByText('The last operation failed.')).toBeVisible();
    const snapshotAlert = screen
      .getAllByRole('alert')
      .find((element) => element.textContent?.includes('Snapshot list failed.'));
    expect(snapshotAlert).toBeDefined();
    await user.click(within(snapshotAlert!).getByRole('button', { name: 'Try again' }));
    expect(mockedListSnapshots).toHaveBeenCalledWith({});

    await user.click(screen.getByRole('tab', { name: 'Shares' }));
    const shareAlert = screen
      .getAllByRole('alert')
      .find((element) => element.textContent?.includes('Share list failed.'));
    expect(shareAlert).toBeDefined();
    await user.click(within(shareAlert!).getByRole('button', { name: 'Try again' }));
    expect(mockedListAllShares).toHaveBeenCalledWith({});
  });

  it('shows both empty collections and the feature pause without treating it as an error', async () => {
    mockedCapabilities.mockResolvedValue({ enabled: false, kinds: [] });
    const user = userEvent.setup();
    renderWithStore(<ExportCenterPage />, state({ enabled: false }));
    expect(await screen.findByText('New exports are paused')).toBeVisible();
    expect(screen.getByText('No saved exports yet')).toBeVisible();
    await user.click(screen.getByRole('tab', { name: 'Shares' }));
    expect(screen.getByText('No share links yet')).toBeVisible();
    expect(screen.getAllByRole('alert')).toHaveLength(1);
    expect(screen.getByRole('alert')).toHaveTextContent('New exports are paused');
  });
});

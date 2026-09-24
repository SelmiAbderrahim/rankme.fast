import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { I18nextProvider } from 'react-i18next';
import { MemoryRouter } from 'react-router-dom';
import { ApiError } from '@shared/api/client';
import { changeLanguage, i18n, initI18n } from '@shared/i18n';
import * as api from '../api';
import type {
  ClientPortalLink,
  ClientReportsOverview,
  ScheduledReport,
  ScheduledReportDelivery,
} from '../types';
import { ClientReportsPanel } from './ClientReportsPanel';

vi.mock('../api', () => ({
  createClientPortalLink: vi.fn(),
  createScheduledReport: vi.fn(),
  deleteScheduledReport: vi.fn(),
  getClientReportsOverview: vi.fn(),
  getScheduledReportDeliveries: vi.fn(),
  revokeClientPortalLink: vi.fn(),
  updateScheduledReport: vi.fn(),
}));

vi.mock('@features/report-export', () => ({
  ReportExportControl: ({ disabled }: { disabled?: boolean }) => (
    <button type="button" disabled={disabled}>Export or share</button>
  ),
}));

const mocked = vi.mocked(api);

const schedule = (overrides: Partial<ScheduledReport> = {}): ScheduledReport => ({
  id: '11111111-1111-4111-8111-111111111111',
  siteId: '65f000000000000000000001',
  name: 'Monday report',
  frequency: 'weekly',
  weekdayUtc: 1,
  monthdayUtc: null,
  hourUtc: 9,
  minuteUtc: 17,
  locale: 'en',
  recipients: ['client@example.com'],
  sections: { audit: true, ranks: true, gsc: true },
  enabled: true,
  nextRunAt: '2026-08-10T09:17:00.000Z',
  lastRunAt: null,
  createdAt: '2026-08-01T10:00:00.000Z',
  updatedAt: '2026-08-01T10:00:00.000Z',
  ...overrides,
});

const portal = (overrides: Partial<ClientPortalLink> = {}): ClientPortalLink => ({
  id: '65f000000000000000000002',
  clientLabel: 'Acme client',
  siteLabel: 'Acme site',
  locale: 'en',
  sections: { audit: true, ranks: true, gsc: true },
  expiresAt: '2026-11-01T10:00:00.000Z',
  revokedAt: null,
  createdAt: '2026-08-01T10:00:00.000Z',
  ...overrides,
});

const overview = (overrides: Partial<ClientReportsOverview> = {}): ClientReportsOverview => ({
  enabled: true,
  schedules: [],
  portals: [],
  ...overrides,
});

const delivery = (
  status: ScheduledReportDelivery['status'],
  overrides: Partial<ScheduledReportDelivery> = {},
): ScheduledReportDelivery => ({
  id: `${status}-11111111-1111-4111-8111-111111111111`,
  scheduleId: '11111111-1111-4111-8111-111111111111',
  recipient: `${status}@example.com`,
  status,
  suppressionReason: status === 'suppressed' ? 'unsubscribed' : null,
  errorCode: status === 'failed' ? 'transport_reported_failure' : null,
  snapshotDate: '2026-08-01T00:00:00.000Z',
  createdAt: '2026-08-01T10:00:00.000Z',
  finishedAt: '2026-08-01T10:01:00.000Z',
  ...overrides,
});

const renderPanel = () => render(
  <I18nextProvider i18n={i18n}>
    <MemoryRouter>
      <ClientReportsPanel siteId="65f000000000000000000001" />
    </MemoryRouter>
  </I18nextProvider>,
);

beforeEach(async () => {
  initI18n({ initialLocale: 'en' });
  await changeLanguage('en');
  vi.clearAllMocks();
  mocked.getClientReportsOverview.mockResolvedValue(overview());
  mocked.getScheduledReportDeliveries.mockResolvedValue({ deliveries: [], nextCursor: null });
  mocked.createScheduledReport.mockResolvedValue(schedule());
  mocked.updateScheduledReport.mockResolvedValue(schedule());
  mocked.deleteScheduledReport.mockResolvedValue();
  mocked.revokeClientPortalLink.mockResolvedValue(portal({ revokedAt: '2026-08-02T00:00:00.000Z' }));
  mocked.createClientPortalLink.mockResolvedValue({
    ...portal(),
    url: 'https://rankme.test/portal/secret-once',
  });
  Object.defineProperty(navigator, 'clipboard', {
    configurable: true,
    value: { writeText: vi.fn().mockResolvedValue(undefined) },
  });
  vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('ClientReportsPanel', () => {
  it('renders loading, localized API failure, retry, and plain-error fallback', async () => {
    mocked.getClientReportsOverview.mockReturnValueOnce(new Promise(() => {}));
    const first = renderPanel();
    expect(screen.getByTestId('client-reports-loading')).toBeInTheDocument();
    first.unmount();

    mocked.getClientReportsOverview
      .mockRejectedValueOnce(new ApiError('failed', 500, { error: { message: 'Localized server error' } }))
      .mockResolvedValueOnce(overview());
    const failed = renderPanel();
    expect(await screen.findByText('Localized server error')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Try again' }));
    expect(await screen.findByTestId('client-reports-panel')).toBeInTheDocument();
    failed.unmount();

    mocked.getClientReportsOverview.mockRejectedValueOnce(
      new ApiError('failed', 500, { error: { message: 42 } }),
    );
    renderPanel();
    expect((await screen.findAllByText("We couldn't load client reports.")).length)
      .toBeGreaterThanOrEqual(1);
  });

  it('renders honest empty, flag-disabled, status, revoked, and invalid-date states', async () => {
    mocked.getClientReportsOverview.mockResolvedValue(overview({
      enabled: false,
      schedules: [
        schedule({ enabled: false, nextRunAt: null }),
        schedule({
          id: '22222222-2222-4222-8222-222222222222',
          name: '<img src=x onerror=alert(1)>',
          frequency: 'monthly',
          weekdayUtc: null,
          monthdayUtc: 12,
          nextRunAt: 'not-a-date',
        }),
      ],
      portals: [
        portal({ clientLabel: '<script>billingToken</script>' }),
        portal({ id: '65f000000000000000000003', revokedAt: '2026-08-03T00:00:00Z' }),
      ],
    }));
    mocked.getScheduledReportDeliveries.mockResolvedValue({
      deliveries: [
        delivery('sent'),
        delivery('failed', { snapshotDate: null }),
        delivery('suppressed', { finishedAt: 'bad-date' }),
      ],
      nextCursor: null,
    });
    renderPanel();
    expect(await screen.findByTestId('client-reports-disabled')).toBeInTheDocument();
    expect(screen.getByText('<img src=x onerror=alert(1)>')).toBeInTheDocument();
    expect(document.querySelector('img[src="x"]')).toBeNull();
    expect(screen.getByText('<script>billingToken</script>')).toBeInTheDocument();
    expect(screen.getAllByText('Disabled').length).toBeGreaterThan(0);
    expect(screen.getByText('Sent')).toBeInTheDocument();
    expect(screen.getByText('Failed')).toBeInTheDocument();
    expect(screen.getByText('Suppressed')).toBeInTheDocument();
    expect(screen.getByText('Revoked')).toBeInTheDocument();
    expect(screen.getAllByText('—').length).toBeGreaterThanOrEqual(2);
    expect(screen.getByRole('button', { name: 'Create schedule' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Create portal link' })).toBeDisabled();
  });

  it('disables unified export until at least one report section is selected', async () => {
    renderPanel();
    await screen.findByTestId('client-reports-panel');
    for (const label of ['SEO audit', 'Rank summary', 'Search Console summary']) {
      await userEvent.click(screen.getAllByLabelText(label)[0]!);
    }
    expect(screen.getByRole('button', { name: 'Export or share' })).toBeDisabled();

    await userEvent.click(screen.getAllByLabelText('SEO audit')[0]!);
    expect(screen.getByRole('button', { name: 'Export or share' })).toBeEnabled();
  });

  it('creates a weekly schedule, validates input, and reports server failures', async () => {
    renderPanel();
    await screen.findByTestId('client-reports-panel');
    await userEvent.click(screen.getByRole('button', { name: 'Create schedule' }));
    const dialog = await screen.findByRole('dialog');
    fireEvent.change(within(dialog).getByLabelText('Schedule name'), {
      target: { value: 'Client weekly' },
    });
    fireEvent.change(within(dialog).getByLabelText('Recipient emails'), {
      target: {
        value: Array.from(
          { length: 11 },
          (_, index) => `person${index}@example.com`,
        ).join(', '),
      },
    });
    await userEvent.click(within(dialog).getByRole('button', { name: 'Save schedule' }));
    expect(await within(dialog).findByText("We couldn't save that schedule.")).toBeInTheDocument();
    expect(mocked.createScheduledReport).not.toHaveBeenCalled();

    fireEvent.change(within(dialog).getByLabelText('Recipient emails'), {
      target: { value: 'B@example.com, a@example.com, B@example.com' },
    });
    await userEvent.click(within(dialog).getByRole('button', { name: 'Save schedule' }));
    await waitFor(() => expect(mocked.createScheduledReport).toHaveBeenCalledWith(
      '65f000000000000000000001',
      expect.objectContaining({
        name: 'Client weekly',
        frequency: 'weekly',
        weekdayUtc: 1,
        monthdayUtc: null,
        recipients: ['a@example.com', 'b@example.com'],
      }),
    ));
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());

    mocked.createScheduledReport.mockRejectedValueOnce(new Error('offline'));
    await userEvent.click(screen.getByRole('button', { name: 'Create schedule' }));
    const failedDialog = await screen.findByRole('dialog');
    fireEvent.change(within(failedDialog).getByLabelText('Schedule name'), {
      target: { value: 'Failure' },
    });
    fireEvent.change(within(failedDialog).getByLabelText('Recipient emails'), {
      target: { value: 'client@example.com' },
    });
    await userEvent.click(within(failedDialog).getByRole('button', { name: 'Save schedule' }));
    expect(await within(failedDialog).findByText("We couldn't save that schedule.")).toBeInTheDocument();
  });

  it('updates every cadence, locale, section, and enabled schedule control', async () => {
    const user = userEvent.setup();
    renderPanel();
    await screen.findByTestId('client-reports-panel');

    await user.click(screen.getByRole('button', { name: 'Create schedule' }));
    let dialog = await screen.findByRole('dialog');
    fireEvent.change(within(dialog).getByLabelText('Schedule name'), {
      target: { value: 'Monthly default' },
    });
    fireEvent.change(within(dialog).getByLabelText('Recipient emails'), {
      target: { value: 'one@example.com' },
    });
    await user.click(within(dialog).getByRole('combobox', { name: 'Frequency' }));
    await user.click(await screen.findByRole('option', { name: 'Monthly' }));
    await user.click(within(dialog).getByRole('button', { name: 'Save schedule' }));
    await waitFor(() => expect(mocked.createScheduledReport).toHaveBeenLastCalledWith(
      '65f000000000000000000001',
      expect.objectContaining({
        frequency: 'monthly',
        weekdayUtc: null,
        monthdayUtc: 1,
      }),
    ));
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());

    await user.click(screen.getByRole('button', { name: 'Create schedule' }));
    dialog = await screen.findByRole('dialog');
    fireEvent.change(within(dialog).getByLabelText('Schedule name'), {
      target: { value: 'Monthly custom' },
    });
    fireEvent.change(within(dialog).getByLabelText('Recipient emails'), {
      target: { value: 'two@example.com' },
    });
    await user.click(within(dialog).getByRole('combobox', { name: 'Weekday (UTC)' }));
    await user.click(await screen.findByRole('option', { name: 'Wednesday' }));
    await user.click(within(dialog).getByRole('combobox', { name: 'Frequency' }));
    await user.click(await screen.findByRole('option', { name: 'Monthly' }));
    fireEvent.change(within(dialog).getByLabelText('Day of month (UTC)'), {
      target: { value: '18' },
    });
    fireEvent.change(within(dialog).getByLabelText('Hour (UTC)'), {
      target: { value: '16' },
    });
    await user.click(within(dialog).getByRole('combobox', { name: 'Report language' }));
    await user.click(await screen.findByRole('option', { name: 'العربية' }));
    await user.click(within(dialog).getByLabelText('Rank summary'));
    await user.click(within(dialog).getByRole('switch', { name: 'Schedule enabled' }));
    await user.click(within(dialog).getByRole('button', { name: 'Save schedule' }));

    await waitFor(() => expect(mocked.createScheduledReport).toHaveBeenLastCalledWith(
      '65f000000000000000000001',
      expect.objectContaining({
        frequency: 'monthly',
        weekdayUtc: null,
        monthdayUtc: 18,
        hourUtc: 16,
        locale: 'ar',
        sections: { audit: true, ranks: false, gsc: true },
        enabled: false,
      }),
    ));
  });

  it('edits a monthly schedule and handles schedule deletion success and failure', async () => {
    mocked.getClientReportsOverview.mockResolvedValue(overview({
      schedules: [schedule({
        frequency: 'monthly',
        weekdayUtc: null,
        monthdayUtc: 12,
        enabled: false,
      })],
    }));
    renderPanel();
    await screen.findByText('Monday report');
    await userEvent.click(screen.getByRole('button', { name: 'Edit' }));
    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByLabelText('Day of month (UTC)')).toHaveValue(12);
    await userEvent.click(within(dialog).getByRole('combobox', { name: 'Frequency' }));
    await userEvent.click(await screen.findByRole('option', { name: 'Weekly' }));
    expect(within(dialog).getByRole('combobox', { name: 'Weekday (UTC)' })).toHaveTextContent(
      'Monday',
    );
    await userEvent.click(within(dialog).getByRole('button', { name: 'Save schedule' }));
    await waitFor(() => expect(mocked.updateScheduledReport).toHaveBeenCalledWith(
      '65f000000000000000000001',
      '11111111-1111-4111-8111-111111111111',
      expect.objectContaining({ frequency: 'weekly', weekdayUtc: 1, monthdayUtc: null }),
    ));

    await userEvent.click(screen.getByRole('button', { name: 'Delete' }));
    const alert = await screen.findByRole('alertdialog');
    expect(alert).toHaveTextContent('Deleting Monday report');
    await userEvent.click(within(alert).getByRole('button', { name: 'Delete' }));
    await waitFor(() => expect(mocked.deleteScheduledReport).toHaveBeenCalled());

    mocked.deleteScheduledReport.mockRejectedValueOnce(new Error('offline'));
    await userEvent.click(screen.getByRole('button', { name: 'Delete' }));
    await userEvent.click(within(await screen.findByRole('alertdialog')).getByRole('button', { name: 'Delete' }));
    expect(await screen.findByText("We couldn't delete that schedule.")).toBeInTheDocument();
  });

  it('creates a show-once portal URL, copies it, and handles validation/copy/create failures', async () => {
    renderPanel();
    await screen.findByTestId('client-reports-panel');
    await userEvent.click(screen.getByRole('button', { name: 'Create portal link' }));
    let dialog = await screen.findByRole('dialog');
    await userEvent.type(within(dialog).getByLabelText('Internal client label'), 'Acme');
    for (const label of ['SEO audit', 'Rank summary', 'Search Console summary']) {
      await userEvent.click(within(dialog).getByLabelText(label));
    }
    await userEvent.click(within(dialog).getByRole('button', { name: 'Create link' }));
    expect(await within(dialog).findByText('Select at least one report section.')).toBeInTheDocument();
    await userEvent.click(within(dialog).getByLabelText('SEO audit'));
    await userEvent.click(within(dialog).getByRole('button', { name: 'Create link' }));
    expect(await within(dialog).findByDisplayValue('https://rankme.test/portal/secret-once')).toBeInTheDocument();
    expect(mocked.createClientPortalLink).toHaveBeenCalledWith(
      '65f000000000000000000001',
      expect.objectContaining({
        clientLabel: 'Acme',
        expiresInDays: 90,
        sections: { audit: true, ranks: false, gsc: false },
      }),
    );
    await userEvent.click(within(dialog).getByRole('button', { name: 'Copy link' }));
    expect(navigator.clipboard.writeText).toHaveBeenCalledWith('https://rankme.test/portal/secret-once');
    expect(within(dialog).getByRole('button', { name: 'Copied' })).toBeInTheDocument();

    await userEvent.click(within(dialog).getByRole('button', { name: 'Close' }));
    await userEvent.click(screen.getByRole('button', { name: 'Create portal link' }));
    dialog = await screen.findByRole('dialog');
    mocked.createClientPortalLink.mockRejectedValueOnce(
      new ApiError('busy', 503, { error: { message: 'Portal service unavailable' } }),
    );
    await userEvent.type(within(dialog).getByLabelText('Internal client label'), 'Fail');
    await userEvent.clear(within(dialog).getByLabelText('Expires in days'));
    await userEvent.type(within(dialog).getByLabelText('Expires in days'), '30');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Create link' }));
    expect(await within(dialog).findByText('Portal service unavailable')).toBeInTheDocument();
    expect(mocked.createClientPortalLink).toHaveBeenLastCalledWith(
      '65f000000000000000000001',
      expect.objectContaining({ expiresInDays: 30 }),
    );

    mocked.createClientPortalLink.mockResolvedValueOnce({ ...portal(), url: 'https://rankme.test/portal/new' });
    await userEvent.click(within(dialog).getByRole('button', { name: 'Create link' }));
    await within(dialog).findByDisplayValue('https://rankme.test/portal/new');
    vi.mocked(navigator.clipboard.writeText).mockRejectedValueOnce(new Error('blocked'));
    await userEvent.click(within(dialog).getByRole('button', { name: 'Copy link' }));
    expect(await within(dialog).findByText("Your browser couldn't copy the link. Select it and copy it manually.")).toBeInTheDocument();
  });

  it('revokes live portals and reports revocation failure', async () => {
    mocked.getClientReportsOverview.mockResolvedValue(overview({
      portals: [portal()],
    }));
    renderPanel();
    await screen.findByText('Acme client');
    await userEvent.click(screen.getByRole('button', { name: 'Revoke' }));
    let alert = await screen.findByRole('alertdialog');
    await userEvent.click(within(alert).getByRole('button', { name: 'Revoke link' }));
    await waitFor(() => expect(mocked.revokeClientPortalLink).toHaveBeenCalled());

    mocked.revokeClientPortalLink.mockRejectedValueOnce(new Error('offline'));
    await userEvent.click(screen.getByRole('button', { name: 'Revoke' }));
    alert = await screen.findByRole('alertdialog');
    await userEvent.click(within(alert).getByRole('button', { name: 'Revoke link' }));
    expect(await screen.findByText("We couldn't revoke that portal link.")).toBeInTheDocument();
  });

  it('paginates the delivery log and surfaces pagination failure', async () => {
    mocked.getScheduledReportDeliveries
      .mockResolvedValueOnce({ deliveries: [delivery('sent')], nextCursor: 'cursor-1' })
      .mockResolvedValueOnce({ deliveries: [delivery('failed')], nextCursor: 'cursor-2' })
      .mockRejectedValueOnce(new Error('offline'));
    renderPanel();
    await screen.findByText('sent@example.com');
    await userEvent.click(screen.getByRole('button', { name: 'Load more' }));
    expect(await screen.findByText('failed@example.com')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Load more' }));
    expect(await screen.findByText("We couldn't load client reports.")).toBeInTheDocument();
  });
});

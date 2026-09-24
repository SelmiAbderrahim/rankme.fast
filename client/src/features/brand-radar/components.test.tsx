import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { I18nextProvider } from 'react-i18next';
import { MemoryRouter } from 'react-router-dom';
import { changeLanguage, i18n, initI18n } from '@shared/i18n';
import { previewFixture, scanFixture } from './__fixtures__/scans';
import { ScanListTable } from './components/ScanListTable';
import { SpendPreviewCard } from './components/SpendPreviewCard';
import { BRAND_RADAR_STATUSES, type BrandRadarRow } from './types';

const renderUi = (node: React.ReactNode) =>
  render(
    <I18nextProvider i18n={i18n}>
      <MemoryRouter>{node}</MemoryRouter>
    </I18nextProvider>,
  );

const row = (overrides: Partial<BrandRadarRow> = {}): BrandRadarRow => ({
  id: 'row-1',
  brandQuery: 'RankMeFast',
  language: null,
  countryCode: null,
  status: 'completed',
  digestState: 'digest_present',
  retainedRowCount: 42,
  refundState: 'none',
  createdAt: '2026-07-20T10:00:00.000Z',
  ...overrides,
  outputLocale: overrides.outputLocale === undefined ? 'en' : overrides.outputLocale,
});

const listProps = (overrides: Partial<React.ComponentProps<typeof ScanListTable>> = {}) => ({
  rows: [row()],
  status: 'succeeded' as const,
  error: '',
  nextCursor: null,
  loadingMore: false,
  statusFilter: 'all' as const,
  onStatusFilter: vi.fn(),
  onLoadMore: vi.fn(),
  onRetry: vi.fn(),
  onStartScan: vi.fn(),
  onOpenScan: vi.fn(),
  ...overrides,
});

beforeEach(async () => {
  initI18n({ initialLocale: 'en' });
  await changeLanguage('en');
});

describe('SpendPreviewCard', () => {
  it('renders nothing before a preview exists', () => {
    const { container } = renderUi(<SpendPreviewCard preview={null} loading={false} />);
    expect(container).toBeEmptyDOMElement();
  });

  it('renders a busy skeleton while pricing', () => {
    renderUi(<SpendPreviewCard preview={null} loading />);
    expect(screen.getByTestId('brand-radar-preview-loading')).toHaveAttribute(
      'aria-busy',
      'true',
    );
  });

  it('describes self-host capacity without finite allowance claims', () => {
    renderUi(<SpendPreviewCard preview={previewFixture()} loading={false} />);
    expect(screen.getByTestId('brand-radar-preview')).toHaveTextContent(
      'Plan usage limits are not metered in self-hosted mode.',
    );
  });
});

describe('ScanListTable', () => {
  it('labels the frozen output locale separately from the collection language', () => {
    renderUi(
      <ScanListTable
        {...listProps({ rows: [row({ language: 'fr', outputLocale: 'de' })] })}
      />,
    );
    const rendered = screen.getByTestId('brand-radar-row');
    expect(rendered).toHaveTextContent('All countries · French');
    expect(screen.getByTestId('brand-radar-row-output-locale')).toHaveTextContent(
      'Output language: Deutsch',
    );
  });

  it('omits the output-locale annotation for legacy rows without one', () => {
    renderUi(
      <ScanListTable {...listProps({ rows: [row({ outputLocale: null })] })} />,
    );

    expect(screen.queryByTestId('brand-radar-row-output-locale')).toBeNull();
  });

  it('labels all-market rows and malformed provider market codes safely', () => {
    renderUi(
      <ScanListTable
        {...listProps({
          rows: [
            row({ id: 'all-markets', countryCode: null, language: null }),
            row({
              id: 'unknown-market',
              countryCode: 'invalid_country',
              language: 'invalid_language',
            }),
          ],
        })}
      />,
    );
    expect(screen.getAllByText('All countries · All languages').length).toBeGreaterThan(0);
    expect(screen.getAllByText('Unknown country · Unknown language').length).toBeGreaterThan(0);
  });

  it('renders every shipped status chip', () => {
    renderUi(
      <ScanListTable
        {...listProps({
          rows: BRAND_RADAR_STATUSES.map((status, index) =>
            row({ id: `row-${index}`, status }),
          ),
        })}
      />,
    );
    const labels = [
      'Queued',
      'Running',
      'Completed',
      'No mentions found',
      'Partly completed',
      'Failed',
    ];
    const rows = screen.getAllByTestId('brand-radar-row');
    expect(rows).toHaveLength(labels.length);
    labels.forEach((label, index) => {
      expect(within(rows[index]!).getByText(label)).toBeInTheDocument();
    });
  });

  it('shows a refund chip only when the credit came back', () => {
    renderUi(
      <ScanListTable
        {...listProps({
          rows: [
            row({ id: 'a', refundState: 'refunded' }),
            row({ id: 'b', refundState: 'none' }),
          ],
        })}
      />,
    );
    expect(screen.getAllByTestId('brand-radar-refund-chip')).toHaveLength(1);
    expect(screen.queryByText(/not refunded/i)).not.toBeInTheDocument();
  });

  it('renders the optimistic row without a fabricated count or timestamp', () => {
    renderUi(
      <ScanListTable
        {...listProps({ rows: [row({ retainedRowCount: null, createdAt: null })] })}
      />,
    );
    expect(screen.getByText('Just submitted')).toBeInTheDocument();
    expect(screen.getByText('—')).toBeInTheDocument();
  });

  it('renders a loading skeleton before the first page lands', () => {
    renderUi(<ScanListTable {...listProps({ rows: [], status: 'loading' })} />);
    expect(screen.getByTestId('brand-radar-list-loading')).toBeInTheDocument();
  });

  it('renders the empty state with a start-scan call to action', async () => {
    const props = listProps({ rows: [], status: 'succeeded' });
    renderUi(<ScanListTable {...props} />);
    await userEvent.click(screen.getByRole('button', { name: 'Start a scan' }));
    expect(props.onStartScan).toHaveBeenCalled();
  });

  it('renders the error alert with a retry action', async () => {
    const props = listProps({ rows: [], status: 'failed', error: 'Server said no' });
    renderUi(<ScanListTable {...props} />);
    expect(screen.getByRole('alert')).toHaveTextContent('Server said no');
    expect(screen.queryByTestId('brand-radar-list-empty')).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Try again' }));
    expect(props.onRetry).toHaveBeenCalled();
  });

  it('filters the loaded page and discloses that the filter is page-scoped', async () => {
    const props = listProps({
      rows: [row({ id: 'a', status: 'completed' }), row({ id: 'b', status: 'failed' })],
      statusFilter: 'failed',
    });
    renderUi(<ScanListTable {...props} />);
    expect(screen.getAllByTestId('brand-radar-row')).toHaveLength(1);
    expect(
      screen.getByText('Filtering applies only to the scans loaded on this page.'),
    ).toBeInTheDocument();

    await userEvent.selectOptions(screen.getByTestId('brand-radar-status-filter'), 'queued');
    expect(props.onStatusFilter).toHaveBeenCalledWith('queued');
  });

  it('states honestly when the filter matches nothing on the page', () => {
    renderUi(
      <ScanListTable
        {...listProps({ rows: [row({ status: 'completed' })], statusFilter: 'failed' })}
      />,
    );
    expect(screen.getByTestId('brand-radar-filter-empty')).toHaveTextContent(
      'No scan on this page has that status.',
    );
  });

  it('offers keyset "load more" only while the server sent a cursor', async () => {
    const props = listProps({ nextCursor: 'cur1' });
    const { rerender } = renderUi(<ScanListTable {...props} />);
    await userEvent.click(screen.getByRole('button', { name: 'Load more' }));
    expect(props.onLoadMore).toHaveBeenCalled();

    rerender(
      <I18nextProvider i18n={i18n}>
        <MemoryRouter>
          <ScanListTable {...listProps({ nextCursor: null })} />
        </MemoryRouter>
      </I18nextProvider>,
    );
    expect(screen.queryByRole('button', { name: 'Load more' })).not.toBeInTheDocument();
  });

  it('disables the load-more button while the next page is in flight', () => {
    renderUi(<ScanListTable {...listProps({ nextCursor: 'cur1', loadingMore: true })} />);
    expect(screen.getByRole('button', { name: /Loading scans/ })).toBeDisabled();
  });
});

describe('brand radar fixtures', () => {
  it('preserves an explicit null output locale for legacy scan coverage', () => {
    expect(scanFixture({ outputLocale: null }).outputLocale).toBeNull();
  });
});

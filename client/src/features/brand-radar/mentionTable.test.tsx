import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { I18nextProvider } from 'react-i18next';
import { changeLanguage, i18n, initI18n } from '@shared/i18n';
import { mentionFixture } from './__fixtures__/scans';
import {
  MentionTable,
  filterBrandRadarMentions,
  type BrandRadarMentionFilters,
} from './components/MentionTable';
import { TrendSparkline } from './components/TrendSparkline';
import type { BrandRadarTrendPoint } from './types';

const renderUi = (node: React.ReactNode) =>
  render(<I18nextProvider i18n={i18n}>{node}</I18nextProvider>);

const filters = (
  overrides: Partial<BrandRadarMentionFilters> = {},
): BrandRadarMentionFilters => ({
  sentiment: 'all',
  domain: '',
  from: '',
  to: '',
  ...overrides,
});

const tableProps = (
  overrides: Partial<React.ComponentProps<typeof MentionTable>> = {},
) => ({
  rows: [mentionFixture()],
  status: 'succeeded' as const,
  error: '',
  filters: filters(),
  nextCursor: null,
  loadingMore: false,
  onSentiment: vi.fn(),
  onDomain: vi.fn(),
  onFrom: vi.fn(),
  onTo: vi.fn(),
  onLoadMore: vi.fn(),
  onExport: vi.fn(),
  ...overrides,
});

beforeEach(async () => {
  initI18n({ initialLocale: 'en' });
  await changeLanguage('en');
});

describe('filterBrandRadarMentions', () => {
  const rows = [
    mentionFixture({ id: 'early', observedAt: '2026-07-01T00:00:00.000Z' }),
    mentionFixture({ id: 'inside', observedAt: '2026-07-15T00:00:00.000Z' }),
    mentionFixture({ id: 'late', observedAt: '2026-07-30T00:00:00.000Z' }),
    mentionFixture({ id: 'undated', observedAt: null }),
  ];

  it('drops rows before an open-ended `from`', () => {
    expect(
      filterBrandRadarMentions(rows, filters({ from: '2026-07-10' })).map((row) => row.id),
    ).toEqual(['inside', 'late']);
  });

  it('drops rows after an open-ended `to`', () => {
    expect(
      filterBrandRadarMentions(rows, filters({ to: '2026-07-20' })).map((row) => row.id),
    ).toEqual(['early', 'inside']);
  });

  it('drops undated rows only once a window is set', () => {
    expect(filterBrandRadarMentions(rows, filters()).map((row) => row.id)).toContain(
      'undated',
    );
    expect(
      filterBrandRadarMentions(rows, filters({ from: '2026-07-10', to: '2026-07-20' })).map(
        (row) => row.id,
      ),
    ).toEqual(['inside']);
  });
});

describe('MentionTable states', () => {
  it('shows a loading affordance on the first page and no table', () => {
    renderUi(<MentionTable {...tableProps({ rows: [], status: 'loading' })} />);
    expect(screen.getByTestId('brand-radar-mentions-loading')).toHaveAttribute(
      'aria-busy',
      'true',
    );
    expect(screen.queryByTestId('brand-radar-mention-row')).toBeNull();
  });

  it('renders the mention error with an alert role', () => {
    renderUi(
      <MentionTable {...tableProps({ error: 'That page cursor is not valid.' })} />,
    );
    expect(screen.getByRole('alert')).toHaveTextContent('That page cursor is not valid.');
  });

  it('disables the export when the filtered page is empty', () => {
    renderUi(<MentionTable {...tableProps({ rows: [] })} />);
    expect(screen.getByTestId('brand-radar-export')).toBeDisabled();
  });

  it('renders "no date" for a row the provider never dated', () => {
    renderUi(
      <MentionTable {...tableProps({ rows: [mentionFixture({ observedAt: null })] })} />,
    );
    expect(screen.getByTestId('brand-radar-mention-row')).toHaveTextContent('No date');
  });

  it('uses the safe outbound-link contract and leaves rejected URLs unlinked', () => {
    const linked = mentionFixture({ id: 'linked', url: 'https://news.example/story' });
    const rejected = mentionFixture({ id: 'rejected', url: null });
    renderUi(<MentionTable {...tableProps({ rows: [linked, rejected] })} />);

    expect(screen.getByTestId('brand-radar-mention-link')).toHaveAttribute(
      'rel',
      'nofollow ugc noopener noreferrer',
    );
    expect(screen.getByTestId('brand-radar-mention-link')).toHaveAttribute(
      'href',
      'https://news.example/story',
    );
    expect(screen.getByTestId('brand-radar-mention-plain-domain')).not.toHaveRole('link');
  });
});

describe('TrendSparkline direction', () => {
  const points: BrandRadarTrendPoint[] = [
    {
      scanId: 'a',
      capturedAt: '2026-07-13T10:05:00.000Z',
      mentionCount: 36,
      delta: null,
      isCurrent: false,
    },
    {
      scanId: 'b',
      capturedAt: '2026-07-20T10:05:00.000Z',
      mentionCount: 42,
      delta: 6,
      isCurrent: true,
    },
  ];

  it('mirrors the x axis in an RTL locale without reordering the table', async () => {
    await changeLanguage('ar');
    renderUi(<TrendSparkline points={points} />);
    expect(screen.getByTestId('brand-radar-trend-chart').querySelector('svg')).toHaveAttribute(
      'data-rtl',
      'true',
    );
    // The chart mirrors; the accessible table keeps chronological order.
    const rows = screen.getAllByTestId('brand-radar-trend-row');
    expect(rows[0]).toHaveTextContent('36');
    expect(rows[1]).toHaveTextContent('42');
    await changeLanguage('en');
  });
});

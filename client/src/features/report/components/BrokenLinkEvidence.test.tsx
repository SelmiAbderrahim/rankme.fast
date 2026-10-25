import { beforeAll, describe, expect, it, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { I18nextProvider } from 'react-i18next';
import { changeLanguage, i18n, initI18n } from '@shared/i18n';
import type { BrokenLinkEvidenceRow } from '../types';
import { BROKEN_LINK_ROWS_COLLAPSED, BrokenLinkEvidence } from './BrokenLinkEvidence';

const saved = vi.hoisted(() => ({ calls: [] as Array<{ blob: Blob; name: string }> }));
vi.mock('@features/report-export', () => ({
  saveBlobAs: (blob: Blob, name: string) => {
    saved.calls.push({ blob, name });
  },
}));

beforeAll(async () => {
  await initI18n({ initialLocale: 'en' });
  await changeLanguage('en');
});

const row = (index: number, overrides: Partial<BrokenLinkEvidenceRow> = {}): BrokenLinkEvidenceRow => ({
  source: `https://example.com/p/${index}`,
  target: `https://example.com/gone/${index}`,
  outcome: 'confirmed',
  status: 404,
  failure: 'http_error',
  ...overrides,
});

const renderList = (
  rows: BrokenLinkEvidenceRow[],
  total?: number,
  loadAllRows?: () => Promise<readonly BrokenLinkEvidenceRow[] | null>,
) =>
  render(
    <I18nextProvider i18n={i18n}>
      <BrokenLinkEvidence ruleId="broken-internal-links" rows={rows} total={total} loadAllRows={loadAllRows} />
    </I18nextProvider>,
  );

const readBlob = (blob: Blob) =>
  new Promise<string>((resolve) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.readAsText(blob);
  });

describe('BrokenLinkEvidence', () => {
  it('shows source and target with the HTTP status for each broken link', () => {
    renderList([row(1)]);
    const item = screen.getByTestId('report-broken-link-row');
    expect(within(item).getByText('Still broken')).toBeInTheDocument();
    expect(screen.getByTestId('report-broken-link-result')).toHaveTextContent('HTTP 404');
    expect(within(item).getByText('https://example.com/p/1').closest('a')).toHaveAttribute('href', 'https://example.com/p/1');
    expect(within(item).getByText('https://example.com/gone/1').closest('a')).toHaveAttribute('href', 'https://example.com/gone/1');
    expect(screen.queryByTestId('report-broken-link-show-all')).toBeNull();
  });

  it.each([
    ['redirect_loop', 'Redirect loop'],
    ['redirect_limit', 'More than five redirects'],
    ['unsafe_redirect', 'Redirects to an address we do not follow'],
    ['robots_blocked', 'Blocked by robots.txt'],
    ['timeout', 'No answer in time'],
    ['non_html', 'Not a web page'],
    ['unreachable', 'Could not connect'],
    ['http_error', 'HTTP error'],
  ] as const)('explains a non-HTTP failure: %s', (failure, text) => {
    renderList([row(1, { status: null, failure })]);
    expect(screen.getByTestId('report-broken-link-result')).toHaveTextContent(text);
  });

  it('says "No answer" when there was neither a status nor a recorded failure, and labels crawler-only rows', () => {
    renderList([row(1, { status: null, outcome: 'reported', failure: undefined })]);
    expect(screen.getByTestId('report-broken-link-result')).toHaveTextContent('No answer');
    expect(screen.getByText('Reported by the crawl')).toBeInTheDocument();
  });

  it('lists 20 rows, then every row after "Show all", and collapses again', async () => {
    const rows = Array.from({ length: 52 }, (_, i) => row(i));
    renderList(rows);
    expect(screen.getAllByTestId('report-broken-link-row')).toHaveLength(BROKEN_LINK_ROWS_COLLAPSED);
    const toggle = screen.getByTestId('report-broken-link-show-all');
    expect(toggle).toHaveTextContent('Show all 52');
    expect(toggle).toHaveAttribute('aria-expanded', 'false');
    await userEvent.click(toggle);
    expect(screen.getAllByTestId('report-broken-link-row')).toHaveLength(52);
    expect(toggle).toHaveAttribute('aria-expanded', 'true');
    expect(toggle).toHaveTextContent('Show fewer');
    await userEvent.click(toggle);
    expect(screen.getAllByTestId('report-broken-link-row')).toHaveLength(BROKEN_LINK_ROWS_COLLAPSED);
  });

  it('keeps links that work when re-checked apart, with where they redirect', async () => {
    renderList([
      row(1),
      row(2, {
        outcome: 'cleared',
        status: 200,
        failure: undefined,
        finalUrl: 'https://example.com/en/pricing',
        target: 'https://example.com/pricing',
      }),
    ]);
    expect(screen.getAllByTestId('report-broken-link-row')).toHaveLength(1);
    const toggle = screen.getByTestId('report-broken-link-dismissed-toggle');
    expect(toggle).toHaveTextContent('Works when re-checked (1)');
    expect(screen.queryByTestId('report-broken-link-dismissed')).toBeNull();
    await userEvent.click(toggle);
    const dismissed = screen.getByTestId('report-broken-link-dismissed');
    expect(dismissed).toHaveTextContent('open normally when requested again');
    expect(within(dismissed).getByText('https://example.com/en/pricing')).toBeInTheDocument();
    await userEvent.click(toggle);
    expect(screen.queryByTestId('report-broken-link-dismissed')).toBeNull();
  });

  it('shows only the dismissed section when every link turned out to work', () => {
    renderList([row(1, { outcome: 'cleared', status: 200, failure: undefined })]);
    expect(screen.queryByTestId('report-broken-link-list')).toBeNull();
    expect(screen.getByTestId('report-broken-link-dismissed-toggle')).toBeInTheDocument();
  });

  it('says so when the report cut the list', () => {
    renderList([row(1)], 25_000);
    expect(screen.getByTestId('report-broken-link-cut')).toHaveTextContent('Rows shown: first 1 of 25000.');
    renderList([row(1)], 1);
    expect(screen.getAllByTestId('report-broken-link-cut')).toHaveLength(1);
  });

  it('downloads every row, dismissed ones included', async () => {
    saved.calls.length = 0;
    const rows = [row(1), row(2, { outcome: 'cleared', status: 200, failure: undefined })];
    renderList(rows);
    await userEvent.click(screen.getByTestId('report-issue-download-urls'));
    expect(saved.calls).toHaveLength(1);
    expect(saved.calls[0]!.name).toBe('broken-internal-links-links.csv');
    const text = await new Promise<string>((resolve) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result));
      reader.readAsText(saved.calls[0]!.blob);
    });
    expect(text).toContain('https://example.com/gone/1');
    expect(text).toContain('cleared');
  });

  it('downloads every row of a cut list by loading the rest first', async () => {
    saved.calls.length = 0;
    const loadAllRows = vi.fn().mockResolvedValue([row(1), row(2), row(3)]);
    renderList([row(1)], 3, loadAllRows);
    await userEvent.click(screen.getByTestId('report-issue-download-urls'));
    expect(loadAllRows).toHaveBeenCalledTimes(1);
    expect(saved.calls).toHaveLength(1);
    const text = await readBlob(saved.calls[0]!.blob);
    expect(text).toContain('https://example.com/gone/3');
  });

  it('saves nothing when the rest of a cut list could not be loaded', async () => {
    saved.calls.length = 0;
    renderList([row(1)], 3, vi.fn().mockResolvedValue(null));
    await userEvent.click(screen.getByTestId('report-issue-download-urls'));
    expect(saved.calls).toHaveLength(0);
  });

  it('downloads what it holds when a cut list has no way to load more', async () => {
    saved.calls.length = 0;
    renderList([row(1)], 3);
    await userEvent.click(screen.getByTestId('report-issue-download-urls'));
    expect(saved.calls).toHaveLength(1);
  });
});

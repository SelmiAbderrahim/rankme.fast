import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { changeLanguage, initI18n } from '@shared/i18n';
import { MetricValue } from './MetricValue';
import { RelativeTime } from './RelativeTime';
import { SignedNumber } from './SignedNumber';
import { SiteOptionLabel } from './SiteOptionLabel';
import { FindingStatusChip } from './FindingStatusChip';
import { OpenIssuesChip } from './OpenIssuesChip';
import { CrawlStopReasonNote } from './CrawlStopReasonNote';
import { CrawlCoverageNote } from '@/features/report/components/CrawlCoverageNote';

beforeEach(async () => {
  initI18n({ initialLocale: 'en' });
  await changeLanguage('en');
});

describe('shared metric labels', () => {
  it('makes missing data accessible and preserves a measured zero', () => {
    const { rerender } = render(<MetricValue kind="position" value={0} data-testid="metric" className="font-bold" />);
    expect(screen.getByTestId('metric')).toHaveAttribute('data-empty', 'true');
    expect(screen.getByText('No data')).toHaveClass('sr-only');
    expect(screen.getByText('—')).toHaveAttribute('aria-hidden', 'true');
    rerender(<MetricValue kind="count" value={0} data-testid="metric" />);
    expect(screen.getByTestId('metric')).toHaveTextContent('0');
    expect(screen.getByTestId('metric')).not.toHaveAttribute('data-empty');
  });

  it('keeps the sign and number in one directional run', async () => {
    const { rerender } = render(<SignedNumber value={-4} data-testid="signed" className="font-bold" />);
    expect(screen.getByTestId('signed')).toHaveTextContent('−4');
    expect(screen.getByTestId('signed')).toHaveAttribute('dir', 'ltr');
    await changeLanguage('ar');
    rerender(<SignedNumber value={4} options={{ signDisplay: 'never' }} data-testid="signed" />);
    expect(screen.getByTestId('signed').textContent).toBe(new Intl.NumberFormat('ar', { signDisplay: 'never' }).format(4));
  });

  it('exposes the exact date on keyboard focus and accepts stored date forms', async () => {
    const now = Date.parse('2026-10-06T18:00:00Z');
    const { rerender } = render(<RelativeTime value="2026-10-05T12:00:00Z" now={now} timeZone="UTC" data-testid="time" />);
    expect(screen.getByTestId('time')).toHaveTextContent('yesterday');
    expect(screen.getByTestId('time')).toHaveAttribute('datetime', '2026-10-05T12:00:00Z');
    fireEvent.focus(screen.getByTestId('time'));
    expect(await screen.findByRole('tooltip')).toHaveTextContent('Oct 5, 2026, 12:00 PM');
    rerender(<RelativeTime value={new Date(now)} now={now} timeZone="UTC" granularity="day" data-testid="time" />);
    expect(screen.getByTestId('time')).toHaveTextContent('today');
    expect(screen.getByTestId('time')).toHaveAttribute('datetime', new Date(now).toISOString());
    expect(screen.getByTestId('time')).toHaveAttribute('data-absolute', 'Oct 6, 2026');
    vi.spyOn(Date, 'now').mockReturnValue(now);
    rerender(<RelativeTime value={now} data-testid="time" />);
    expect(screen.getByTestId('time')).toHaveTextContent('now');
    vi.restoreAllMocks();
  });

  it('reuses the OSS site label and isolates names separately from domains', () => {
    const { rerender } = render(<span data-testid="site"><SiteOptionLabel site={{ domain: 'shop.test', displayName: ' متجر ', paused: true }} pausedLabel="paused" /></span>);
    expect(screen.getByTestId('site').textContent).toBe('متجر · shop.test (paused)');
    expect(screen.getByTestId('site').querySelectorAll('bdi')).toHaveLength(2);
    rerender(<span data-testid="site"><SiteOptionLabel site={{ domain: 'shop.test', displayName: ' ' }} pausedLabel="paused" /></span>);
    expect(screen.getByTestId('site').textContent).toBe('shop.test');
    expect(screen.getByTestId('site').querySelectorAll('bdi')).toHaveLength(1);
  });

  it.each([
    ['fix-now', 'critical', 'Fix now · Critical'],
    ['watch', 'warning', 'Watch · Warning'],
    ['watch', 'info', 'Watch · Info'],
    ['passed', 'critical', 'Passed'],
    ['not-evaluated', 'warning', 'Not evaluated'],
  ] as const)('labels finding status %s/%s without contradictory severity', (bucket, severity, label) => {
    render(<FindingStatusChip bucket={bucket} severity={severity} data-testid="finding" />);
    expect(screen.getByTestId('finding')).toHaveTextContent(label);
  });

  it('keeps stale zero-issue audits distinct from current healthy audits', () => {
    const { rerender } = render(<OpenIssuesChip metric={{ state: 'value', count: 2 }} testId="issues" />);
    expect(screen.getByTestId('issues')).toHaveTextContent('2 open');
    rerender(<OpenIssuesChip metric={{ state: 'stale', count: 0 }} testId="issues" />);
    expect(screen.getByTestId('issues')).toHaveTextContent('None open at last audit');
    rerender(<OpenIssuesChip metric={{ state: 'value', count: 0 }} testId="issues" />);
    expect(screen.getByTestId('issues')).toHaveTextContent('None open');
  });
});

describe('crawl coverage labels', () => {
  it('offers another audit when older runs have no stop reason', () => {
    const { rerender } = render(<MemoryRouter><CrawlStopReasonNote stopReason={null} pageCap={100} siteId="site/id" testId="reason" /></MemoryRouter>);
    expect(screen.getByTestId('reason')).toHaveTextContent('The reason was not recorded');
    expect(screen.getByRole('link', { name: 'Run again' })).toHaveAttribute('href', '/sites/site%2Fid?tab=report&retest=1');
    rerender(<MemoryRouter><CrawlStopReasonNote stopReason={null} pageCap={100} testId="reason" /></MemoryRouter>);
    expect(screen.queryByRole('link')).toBeNull();
  });

  it('distinguishes recorded, derived and unknown sitemap evidence', () => {
    const { rerender } = render(<CrawlStopReasonNote stopReason="page_limit" stopReasonSource="derived" pageCap={1000} testId="reason" />);
    expect(screen.getByTestId('reason')).toHaveTextContent('limit that applied at the time (1,000)');
    rerender(<CrawlStopReasonNote stopReason="crawler_error" pageCap={1000} testId="reason" />);
    expect(screen.getByTestId('reason')).toHaveTextContent('hit an error');
    expect(screen.getByTestId('reason')).toHaveAttribute('data-source', 'recorded');
    rerender(<CrawlStopReasonNote stopReason="no_more_links" stopReasonSource="recorded" pageCap={1000} testId="reason" />);
    expect(screen.getByTestId('reason')).toHaveTextContent('found no more links');
    const crawl = { finishedAt: null, pageCap: 100, pagesStored: 2, vendorPagesCrawled: 2, stopReason: 'page_limit' as const, sitemapFound: false };
    rerender(<CrawlCoverageNote crawl={crawl} />);
    expect(screen.getByTestId('report-crawl-coverage')).toHaveTextContent('2 URLs');
    expect(screen.getByTestId('report-crawl-no-sitemap')).toBeInTheDocument();
    rerender(<CrawlCoverageNote crawl={{ ...crawl, pagesStored: null, sitemapFound: null }} />);
    expect(screen.queryByTestId('report-crawl-no-sitemap')).toBeNull();
    expect(screen.getByTestId('report-crawl-coverage')).not.toHaveTextContent('2 URLs');
  });
});

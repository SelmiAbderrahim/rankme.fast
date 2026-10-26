import { beforeEach, describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { I18nextProvider } from 'react-i18next';
import { i18n, initI18n } from '@shared/i18n';
import type { AuditCrawlSummary } from '../types';
import { MemoryRouter } from 'react-router-dom';
import { CrawlCoverageNote } from './CrawlCoverageNote';

beforeEach(() => {
  initI18n({ initialLocale: 'en' });
});

const show = (crawl: Partial<AuditCrawlSummary>) =>
  render(
    <I18nextProvider i18n={i18n}>
      <CrawlCoverageNote
        crawl={{
          finishedAt: null,
          pageCap: 5000,
          pagesStored: null,
          vendorPagesCrawled: null,
          stopReason: null,
          sitemapFound: null,
          ...crawl,
        }}
      />
    </I18nextProvider>,
  );

describe('crawl coverage on the report', () => {
  it('explains a one-page crawl with its recorded stop reason', () => {
    show({ pagesStored: 1, vendorPagesCrawled: 1, stopReason: 'no_more_links' });
    expect(screen.getByTestId('report-crawl-coverage')).toHaveTextContent('Your last audit fetched 1 URL.');
    expect(screen.getByTestId('report-crawl-stop-reason')).toHaveAttribute('data-reason', 'no_more_links');
    expect(screen.getByTestId('report-crawl-stop-reason')).toHaveTextContent(/found no more links/);
  });

  it('says so when the run recorded no reason, instead of guessing one', () => {
    show({ pagesStored: 12 });
    expect(screen.getByTestId('report-crawl-stop-reason')).toHaveAttribute('data-reason', 'unrecorded');
    expect(screen.getByTestId('report-crawl-stop-reason')).toHaveTextContent('The reason was not recorded for this older run.');
    expect(screen.queryByTestId('crawl-stop-reason-run-again')).toBeNull();
  });

  it('names the page limit an older run stopped at, derived from its counts', () => {
    show({ pagesStored: 100, pageCap: 100, stopReason: 'page_limit', stopReasonSource: 'derived' });
    const reason = screen.getByTestId('report-crawl-stop-reason');
    expect(reason).toHaveAttribute('data-source', 'derived');
    expect(reason).toHaveTextContent('It stopped at the page limit that applied at the time (100).');
  });

  it('offers to run the audit again when an older run recorded nothing usable', () => {
    render(
      <I18nextProvider i18n={i18n}>
        <MemoryRouter>
          <CrawlCoverageNote
            siteId="site 1"
            crawl={{
              finishedAt: null,
              pageCap: 100,
              pagesStored: 40,
              vendorPagesCrawled: null,
              stopReason: null,
              stopReasonSource: null,
              sitemapFound: null,
            }}
          />
        </MemoryRouter>
      </I18nextProvider>,
    );
    expect(screen.getByTestId('crawl-stop-reason-run-again')).toHaveAttribute(
      'href',
      '/sites/site%201?tab=report&retest=1',
    );
  });

  it('reports a missing sitemap only when it was confirmed missing', () => {
    const { unmount } = show({ sitemapFound: false });
    expect(screen.getByTestId('report-crawl-no-sitemap')).toBeInTheDocument();
    unmount();
    show({ sitemapFound: null });
    expect(screen.queryByTestId('report-crawl-no-sitemap')).toBeNull();
  });
});

import { useTranslation } from 'react-i18next';
import { CrawlStopReasonNote } from '@shared/components/CrawlStopReasonNote';
import type { AuditCrawlSummary } from '../types';

export function CrawlCoverageNote({ crawl, siteId }: { crawl: AuditCrawlSummary; siteId?: string }) {
  const { t } = useTranslation('pages');
  return <section className="text-muted-foreground flex flex-col gap-1 text-sm" aria-label={t('crawl.heading')} data-testid="report-crawl-coverage">
    <p>{crawl.pagesStored === null ? null : <>{t('crawl.pages', { count: crawl.pagesStored })} </>}<CrawlStopReasonNote stopReason={crawl.stopReason} stopReasonSource={crawl.stopReasonSource} pageCap={crawl.pageCap} siteId={siteId} testId="report-crawl-stop-reason" /></p>
    {crawl.sitemapFound === false ? <p data-testid="report-crawl-no-sitemap">{t('crawl.noSitemap')}</p> : null}
  </section>;
}

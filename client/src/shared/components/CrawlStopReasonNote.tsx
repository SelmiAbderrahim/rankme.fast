import { useTranslation } from 'react-i18next';
import { Link } from 'react-router-dom';

export type CrawlStopReason = 'page_limit' | 'no_more_links' | 'stopped' | 'crawler_error' | 'finished_below_limit';
export type CrawlStopReasonSource = 'recorded' | 'derived';
export interface CrawlStopReasonNoteProps {
  stopReason: CrawlStopReason | null;
  stopReasonSource?: CrawlStopReasonSource | null | undefined;
  pageCap: number;
  siteId?: string | undefined;
  testId: string;
}

/** Describe only recorded evidence or a page ceiling proven by stored counts. */
export function CrawlStopReasonNote({ stopReason, stopReasonSource, pageCap, siteId, testId }: CrawlStopReasonNoteProps) {
  const { t, i18n } = useTranslation('pages');
  if (stopReason === null) return <><span data-testid={testId} data-reason="unrecorded">{t('crawl.reason.unrecorded')}</span>{siteId ? <>{' '}<Link to={`/sites/${encodeURIComponent(siteId)}?tab=report&retest=1`} className="text-foreground focus-visible:ring-ring rounded-sm underline underline-offset-4 focus-visible:ring-2 focus-visible:outline-none" data-testid="crawl-stop-reason-run-again">{t('crawl.runAgain')}</Link></> : null}</>;
  const derived = stopReason === 'page_limit' && stopReasonSource === 'derived';
  return <span data-testid={testId} data-reason={stopReason} data-source={stopReasonSource ?? 'recorded'}>{derived ? t('crawl.reason.page_limit_derived', { cap: new Intl.NumberFormat(i18n.language).format(pageCap) }) : t(`crawl.reason.${stopReason}`)}</span>;
}

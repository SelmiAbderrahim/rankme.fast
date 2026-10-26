import type { TFunction } from 'i18next';
import type { CrawlEvidence, PageRow } from './types';
import { pagesPathLabel } from './formatters';

/** Path of an absolute address on the audited site, e.g. `https://x.com/en` → `/en`. */
function pathOf(url: string): string {
  try {
    const parsed = new URL(url);
    return `${parsed.pathname}${parsed.search}`;
  } catch {
    return url;
  }
}

/**
 * The one wording of a page's crawl state. The list cell and the inspector
 * badge both call this, so the same page can never read "Not in the last
 * crawl" in one place and "Crawl state unknown" in the other.
 */
export function crawlStateLabel(
  t: TFunction<'pages'>,
  row: Pick<PageRow, 'crawlState' | 'crawlEvidence' | 'crawledAs' | 'redirectsTo'>,
): string {
  // A proven redirect to a listed page: this row is that page's other
  // address and is not counted separately.
  if (row.redirectsTo) {
    return t('crawlState.label.redirected', { path: pagesPathLabel(row.redirectsTo) });
  }
  if (row.crawledAs && (row.crawlState === 'not_in_crawl' || row.crawlState === 'redirected')) {
    return t('crawlState.crawledAs', { path: pagesPathLabel(row.crawledAs) });
  }
  if (row.crawlState === 'redirected') {
    return t('crawlState.label.redirected', {
      path: row.crawlEvidence?.finalUrl ? pathOf(row.crawlEvidence.finalUrl) : '',
    });
  }
  return t(`crawlState.label.${row.crawlState}`);
}

/** Plain-language detail lines for the inspector; empty when nothing beyond the label is known. */
export function crawlEvidenceLines(
  t: TFunction<'pages'>,
  row: Pick<PageRow, 'crawlState' | 'crawlEvidence'>,
): string[] {
  if (row.crawlState === 'no_crawl') return [t('crawlState.evidence.noCrawl')];
  const evidence: CrawlEvidence | null = row.crawlEvidence;
  if (!evidence) {
    return row.crawlState === 'not_in_crawl' ? [t('crawlState.evidence.none')] : [];
  }
  const lines: string[] = [];
  const { failure } = evidence;
  if (failure) {
    const status = failure.statusCode ?? evidence.statusCode;
    lines.push(
      t(`crawlState.failure.${failure.kind}`, {
        status: status ?? '',
        type: failure.contentType ?? evidence.contentType ?? '',
      }),
    );
    // These statuses are how many sites answer automated visits.
    if (failure.kind === 'http_error' && (status === 401 || status === 403 || status === 429)) {
      lines.push(t('crawlState.evidence.botProtection'));
    }
  } else if (evidence.statusCode !== null && row.crawlState !== 'indexable') {
    lines.push(t('crawlState.evidence.status', { status: evidence.statusCode }));
  }
  if (evidence.finalUrl && evidence.redirectChain.length > 0) {
    lines.push(t('crawlState.evidence.finalUrl', { url: evidence.finalUrl }));
    lines.push(
      t('crawlState.evidence.redirectPath', {
        path: evidence.redirectChain.map((hop) => `${hop.status} ${pathOf(hop.url)}`).join(' → '),
      }),
    );
  }
  lines.push(
    evidence.source === 'probe'
      ? t('crawlState.evidence.fromProbe')
      : t('crawlState.evidence.fromCrawl'),
  );
  return lines;
}

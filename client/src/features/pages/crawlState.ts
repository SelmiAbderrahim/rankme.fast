import type { TFunction } from 'i18next';
import type { CrawlEvidence, PageRow } from './types';
import { pagesPathLabel } from './formatters';

function urlPath(url: string): string {
  try {
    const parsed = new URL(url);
    return `${parsed.pathname}${parsed.search}`;
  } catch { return url; }
}

/** One label shared by the page list and detail sheet, including older responses. */
export function crawlStateLabel(t: TFunction<'pages'>, row: PageRow): string {
  if (!row.crawlState) {
    return row.isIndexable === null ? t('indexability.unknown')
      : t(row.isIndexable ? 'indexability.indexable' : 'indexability.nonIndexable');
  }
  if (row.redirectsTo) return t('crawlState.label.redirected', { path: pagesPathLabel(row.redirectsTo) });
  if (row.crawledAs && (row.crawlState === 'not_in_crawl' || row.crawlState === 'redirected')) {
    return t('crawlState.crawledAs', { path: pagesPathLabel(row.crawledAs) });
  }
  if (row.crawlState === 'redirected') {
    return t('crawlState.label.redirected', { path: row.crawlEvidence?.finalUrl ? urlPath(row.crawlEvidence.finalUrl) : '' });
  }
  return t(`crawlState.label.${row.crawlState}`);
}

export function crawlEvidenceLines(t: TFunction<'pages'>, row: PageRow): string[] {
  if (row.crawlState === 'no_crawl') return [t('crawlState.evidence.noCrawl')];
  const evidence: CrawlEvidence | null = row.crawlEvidence ?? null;
  if (!evidence) return row.crawlState === 'not_in_crawl' ? [t('crawlState.evidence.none')] : [];
  const lines: string[] = [];
  if (evidence.failure) {
    const status = evidence.failure.statusCode ?? evidence.statusCode;
    lines.push(t(`crawlState.failure.${evidence.failure.kind}`, {
      status: status ?? '', type: evidence.failure.contentType ?? evidence.contentType ?? '',
    }));
    if (evidence.failure.kind === 'http_error' && (status === 401 || status === 403 || status === 429)) {
      lines.push(t('crawlState.evidence.botProtection'));
    }
  } else if (evidence.statusCode !== null && row.crawlState !== 'indexable') {
    lines.push(t('crawlState.evidence.status', { status: evidence.statusCode }));
  }
  if (evidence.finalUrl && evidence.redirectChain.length > 0) {
    lines.push(t('crawlState.evidence.finalUrl', { url: evidence.finalUrl }));
    lines.push(t('crawlState.evidence.redirectPath', {
      path: evidence.redirectChain.map((hop) => `${hop.status} ${urlPath(hop.url)}`).join(' → '),
    }));
  }
  lines.push(t(evidence.source === 'probe' ? 'crawlState.evidence.fromProbe' : 'crawlState.evidence.fromCrawl'));
  return lines;
}

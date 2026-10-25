import { useTranslation } from 'react-i18next';
import { ArrowRight, Repeat } from 'lucide-react';
import { Bdi } from '@shared/components/Bdi';
import { SAFE_EXTERNAL_REL, safeExternalHref } from '@shared/security';
import { formatBytes, formatDuration } from '@shared/lib/units';
import { namedProblems, type DeepCrawlEvidence, type PageEvidenceRow, type ResourceEvidenceRow } from '../deepCrawlEvidence';

const linkClass = 'inline-flex min-h-6 items-center break-all font-mono text-xs text-primary underline';

function ExternalUrl({ url }: { url: string }) {
  // eslint-disable-next-line react/jsx-no-target-blank -- SAFE_EXTERNAL_REL includes noopener and noreferrer.
  return <a href={safeExternalHref(url)} target="_blank" rel={SAFE_EXTERNAL_REL} className={linkClass}><Bdi>{url}</Bdi></a>;
}

function pageFacts(row: PageEvidenceRow, t: (key: string, values?: Record<string, unknown>) => string, locale: string): string[] {
  const facts = namedProblems(row).map((problem) => t(`detail.evidence.problems.${problem}`));
  if (row.statusCode !== undefined) facts.push(t('detail.evidence.status', { status: row.statusCode }));
  if (row.clickDepth !== undefined) facts.push(t('detail.evidence.clickDepth', { depth: row.clickDepth }));
  if (row.inboundInternalLinks !== undefined) facts.push(t('detail.evidence.inboundLinks', { links: row.inboundInternalLinks }));
  if (row.pageSizeBytes !== undefined) facts.push(t('detail.evidence.pageSize', { size: formatBytes(row.pageSizeBytes, locale) }));
  if (row.transferSizeBytes !== undefined) facts.push(t('detail.evidence.transferSize', { size: formatBytes(row.transferSizeBytes, locale) }));
  if (row.serverResponseMs !== undefined) facts.push(t('detail.evidence.serverResponse', { time: formatDuration(row.serverResponseMs, locale) }));
  if (row.fetchMs !== undefined) facts.push(t('detail.evidence.fetchTime', { time: formatDuration(row.fetchMs, locale) }));
  if (row.imageCount !== undefined) facts.push(t('detail.evidence.images', { images: row.imageCount }));
  if (row.renderBlockingScripts !== undefined) facts.push(t('detail.evidence.blockingScripts', { scripts: row.renderBlockingScripts }));
  if (row.renderBlockingStylesheets !== undefined) facts.push(t('detail.evidence.blockingStylesheets', { styles: row.renderBlockingStylesheets }));
  if (row.contentEncoding === null) facts.push(t('detail.evidence.noCompression'));
  else if (row.contentEncoding !== undefined) facts.push(t('detail.evidence.compression', { encoding: row.contentEncoding }));
  if (row.openGraph === false) facts.push(t('detail.evidence.openGraphMissing'));
  if (row.twitterCard === false) facts.push(t('detail.evidence.twitterCardMissing'));
  return facts;
}

export function EvidenceFacts({ page, resource }: { page?: PageEvidenceRow; resource?: ResourceEvidenceRow }) {
  const { t, i18n } = useTranslation('report');
  if (!page && !resource) return null;
  const facts = page ? pageFacts(page, t, i18n.language) : [
    t(`detail.evidence.resourceType.${resource!.type}`),
    resource!.statusCode === null ? t('detail.brokenLinks.noAnswer') : t('detail.evidence.status', { status: resource!.statusCode }),
    ...(resource!.sizeBytes !== undefined ? [formatBytes(resource!.sizeBytes, i18n.language)] : []),
  ];
  return <span className="flex w-full flex-col gap-1 ps-3 sm:ps-4" data-testid="report-evidence-facts">
    {facts.length > 0 ? <span className="text-muted-foreground flex flex-wrap gap-x-3 gap-y-0.5 text-xs tabular-nums">{facts.map((fact) => <span key={fact}>{fact}</span>)}</span> : null}
    {page?.canonical ? <span className="text-muted-foreground flex flex-wrap items-center gap-x-1 text-xs">{t('detail.evidence.canonicalLabel')} <ExternalUrl url={page.canonical} /></span> : null}
    {resource && resource.usedOn.length > 0 ? <span className="text-muted-foreground flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs">
      <span>{t('detail.evidence.usedOn')}</span>
      {resource.usedOn.map((url) => <ExternalUrl key={url} url={url} />)}
      {resource.usedOnCount !== undefined && resource.usedOnCount > resource.usedOn.length ? <span className="tabular-nums">{t('detail.evidence.usedOnTotal', { total: resource.usedOnCount })}</span> : null}
    </span> : null}
  </span>;
}

export function DeepCrawlEvidenceBlocks({ evidence, shownRows }: { evidence: DeepCrawlEvidence; shownRows: number }) {
  const { t } = useTranslation('report');
  return <>
    {evidence.chains.length > 0 ? <section className="mb-4" data-testid="report-evidence-chains">
      <h4 className="text-sm font-semibold">{t('detail.evidence.chainsTitle')}</h4>
      <ul className="mt-1 space-y-2">{evidence.chains.map((chain) => <li key={chain.from} className="flex flex-wrap items-center gap-x-2 gap-y-1" data-testid="report-evidence-chain">
        {chain.isLoop ? <span className="bg-destructive/10 text-destructive inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium"><Repeat aria-hidden="true" className="size-3" />{t('detail.evidence.loop')}</span> : null}
        <ExternalUrl url={chain.from} />
        {chain.hops.map((hop, index) => <span key={`${hop.url}-${index}`} className="inline-flex flex-wrap items-center gap-x-2"><ArrowRight aria-hidden="true" className="text-muted-foreground size-3 rtl:rotate-180" /><ExternalUrl url={hop.url} /><span className="text-muted-foreground text-xs tabular-nums">{hop.status > 0 ? t('detail.evidence.status', { status: hop.status }) : t('detail.evidence.statusUnknown')}</span></span>)}
      </li>)}</ul>
    </section> : null}
    {evidence.groups.length > 0 ? <section className="mb-4" data-testid="report-evidence-groups"><h4 className="text-sm font-semibold">{t('detail.evidence.groupsTitle')}</h4><ul className="mt-1 space-y-2">{evidence.groups.map((group) => <li key={group.urls.join(' ')} className="bg-card rounded-md border p-2" data-testid="report-evidence-group">
      {group.title !== undefined || group.similarity !== undefined ? <p className="text-muted-foreground mb-1 flex flex-wrap gap-x-3 text-xs">
        {group.title !== undefined ? <span>{group.title === null ? t('detail.evidence.noTitle') : <>{t('detail.evidence.sharedTitle')} <Bdi dominant>{group.title}</Bdi></>}</span> : null}
        {group.similarity !== undefined ? <span className="tabular-nums">{t('detail.evidence.similarity', { score: group.similarity })}</span> : null}
      </p> : null}
      <ul className="space-y-1">{group.urls.map((url) => <li key={url}><ExternalUrl url={url} /></li>)}</ul>
    </li>)}</ul></section> : null}
    {evidence.insecureResources.length > 0 ? <section className="mb-4" data-testid="report-evidence-insecure"><h4 className="text-sm font-semibold">{t('detail.evidence.insecureTitle')}</h4><ul className="mt-1 space-y-1">{evidence.insecureResources.map((url) => <li key={url}><ExternalUrl url={url} /></li>)}</ul></section> : null}
    {evidence.reachedThroughChain.length > 0 ? <section className="mb-4"><h4 className="text-sm font-semibold">{t('detail.evidence.reachedThroughChain')}</h4><ul className="mt-1 space-y-1">{evidence.reachedThroughChain.map((url) => <li key={url}><ExternalUrl url={url} /></li>)}</ul></section> : null}
    {evidence.truncated !== null ? <p className="text-muted-foreground mb-4 text-xs" data-testid="report-evidence-cut">{t('detail.evidence.cut', { shown: shownRows, total: evidence.truncated })}</p> : null}
  </>;
}

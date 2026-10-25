import { Bdi } from '@shared/components/Bdi';
import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { safeExternalHref } from '@shared/security';
import { Check, Copy, Braces, Download, FileText } from 'lucide-react';
import { Button } from '@shared/ui/button';
import { CodeFixPromptButton } from '@shared/components/CodeFixPromptButton';
import { writeToClipboard } from '@shared/lib/clipboard';
import { saveBlobAs } from '@features/report-export';
import { contentAnalysisHref } from '@shared/navigation/contentIntelligenceHref';
import {
  isGscSearchRuleId,
  isGscSitemapRuleId,
  isAiVisibilityRuleId,
  isLocalSeoRuleId,
  isPageSpeedRuleId,
  type AiVisibilitySection,
  type DiffKind,
  type FindingUrls,
  type GscSearchSection,
  type GscSitemapsSection,
  type LocalSeoSection,
  type LocalizedFinding,
  type PageSpeedSection,
} from '../types';
import { GscBlock } from './GscBlock';
import { AiVisibilityBlock } from './AiVisibilityBlock';
import { LocalSeoBlock } from './LocalSeoBlock';
import { PageSpeedBlock } from './PageSpeedBlock';
import { AddressVariantsBlock, addressVariantsOf } from './AddressVariantsBlock';
import { readDeepCrawlEvidence } from '../deepCrawlEvidence';
import { fetchFindingUrlsRequest } from '../api';
import { affectedUrlTotal, hasFindingListPreview, readFindingMeasurements } from '../findingLists';
import { buildFindingUrlsCsv } from '../urlsCsv';
import { BrokenLinkEvidence } from './BrokenLinkEvidence';
import { DeepCrawlEvidenceBlocks, EvidenceFacts } from './DeepCrawlEvidence';

export interface IssueDetailProps {
  finding: LocalizedFinding;
  diffByUrl: Map<string, DiffKind>;
  pageSpeed?: PageSpeedSection | null;
  gscSearch?: GscSearchSection | null;
  gscSitemaps?: GscSitemapsSection | null;
  aiVisibility?: AiVisibilitySection | null;
  localSeo?: LocalSeoSection | null;
  siteId?: string;
  /** The run on screen; with `siteId` it loads the full lists of a previewed finding. */
  runId?: string | undefined;
  isLatestRun?: boolean;
}

export const IssueDetail = ({
  finding,
  diffByUrl,
  pageSpeed,
  gscSearch,
  gscSitemaps,
  aiVisibility,
  localSeo,
  siteId,
  runId,
  isLatestRun = false,
}: IssueDetailProps) => {
  const { t } = useTranslation(['report', 'contentIntelligence']);
  const [copied, setCopied] = useState(false);

  const handleCopy = async () => {
    const ok = await writeToClipboard(finding.copy.fix);
    if (ok) {
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    }
  };

  // The report carries a preview of each list; the full lists of this finding
  // load when the reader asks for them. Both triggers ("Show the full list",
  // the CSV download) are disabled while the request runs, so at most one is in flight.
  const [fullLists, setFullLists] = useState<FindingUrls | null>(null);
  const [listsLoading, setListsLoading] = useState(false);
  const [listsFailed, setListsFailed] = useState(false);
  const canLoadLists = Boolean(siteId && runId) && hasFindingListPreview(finding);
  const loadFullLists = async (): Promise<FindingUrls | null> => {
    if (fullLists) return fullLists;
    setListsLoading(true);
    setListsFailed(false);
    try {
      const lists = await fetchFindingUrlsRequest(runId!, finding.ruleId);
      setFullLists(lists);
      return lists;
    } catch {
      setListsFailed(true);
      return null;
    } finally {
      setListsLoading(false);
    }
  };
  const affectedUrls = fullLists?.affectedUrls ?? finding.affectedUrls;
  const totalAffected = fullLists ? fullLists.affectedUrls.length : affectedUrlTotal(finding);
  // The length a thin-content check measured per URL.
  const measurementByUrl = useMemo(
    () =>
      new Map(
        (fullLists?.measurements ?? readFindingMeasurements(finding.meta)).map((entry) => [entry.url, entry]),
      ),
    [finding.meta, fullLists],
  );
  const showPassedLabel = finding.bucket === 'passed';
  const showPageSpeedBlock = pageSpeed != null && isPageSpeedRuleId(finding.ruleId);
  const showGscSearchBlock = isGscSearchRuleId(finding.ruleId);
  const showGscSitemapsBlock = isGscSitemapRuleId(finding.ruleId);
  const showAiVisibilityBlock = isAiVisibilityRuleId(finding.ruleId);
  const showLocalSeoBlock = isLocalSeoRuleId(finding.ruleId);
  // Probed site addresses replace the plain URL list: the table already
  // names each address and says what is wrong with it.
  const addressVariants = addressVariantsOf(finding.meta);
  // Per-URL facts, redirect steps and matching pages: the first screen carries
  // the previewed URLs' rows, the full lists bring the rest.
  const deepEvidence = useMemo(
    () => readDeepCrawlEvidence(fullLists?.evidence ? { ...finding.meta, ...fullLists.evidence } : finding.meta),
    [finding.meta, fullLists],
  );
  const urlDiff = useMemo(() => {
    if (!fullLists) return diffByUrl;
    const merged = new Map(diffByUrl);
    for (const entry of fullLists.diff) merged.set(entry.url, entry.kind);
    return merged;
  }, [diffByUrl, fullLists]);
  const brokenLinkTargets =
    finding.ruleId === 'broken-internal-links'
      ? (fullLists?.brokenLinkTargets ?? finding.brokenLinkTargets ?? [])
      : [];
  // Source and target pairs with the re-check result replace the flat lists
  // whenever the audit recorded them.
  const brokenLinkEvidence =
    finding.ruleId === 'broken-internal-links'
      ? (fullLists?.brokenLinkEvidence ?? finding.brokenLinkEvidence ?? [])
      : [];
  const hasBrokenLinkEvidence = brokenLinkEvidence.length > 0;
  // A structured-data finding hands the reader
  // straight to the generator with this page preselected. The detector stays a
  // detector; the CTA is the only thing this rule id adds here.
  const schemaCtaUrl =
    finding.ruleId === 'structured-data-missing' && siteId
      ? (finding.affectedUrls[0] ?? null)
      : null;

  return (
    <div
      className="border-t bg-muted/40 px-4 py-4"
      data-testid="report-issue-detail"
    >
      <div className="mb-4">
        <h4 className="text-sm font-semibold">{t('detail.whyTitle')}</h4>
        {/* GSC-state-specific explanation — server-localized. */}
        {!showPassedLabel && finding.copy.reason ? (
          <p className="mt-1 text-sm font-medium" data-testid="report-issue-reason">
            {finding.copy.reason}
          </p>
        ) : null}
        <p className="text-muted-foreground mt-1 text-sm">
          {/* The passing statement is the row title, so the detail explains
              why the check matters. */}
          {finding.copy.why}
        </p>
      </div>

      {showPageSpeedBlock ? (
        <div className="mb-4">
          <PageSpeedBlock section={pageSpeed!} />
        </div>
      ) : null}

      {showGscSearchBlock || showGscSitemapsBlock ? (
        <div className="mb-4">
          <GscBlock
            {...(showGscSearchBlock ? { search: gscSearch ?? null } : {})}
            {...(showGscSitemapsBlock ? { sitemaps: gscSitemaps ?? null } : {})}
            siteId={siteId ?? ''}
          />
        </div>
      ) : null}

      {showAiVisibilityBlock ? (
        <div className="mb-4">
          <AiVisibilityBlock section={aiVisibility ?? null} siteId={siteId ?? ''} />
        </div>
      ) : null}

      {showLocalSeoBlock ? (
        <div className="mb-4">
          <LocalSeoBlock section={localSeo ?? null} siteId={siteId ?? ''} />
        </div>
      ) : null}

      {schemaCtaUrl ? (
        <div className="mb-4">
          <Button asChild variant="outline" size="sm">
            <Link
              to={`/sites/${siteId}?tab=schema&page=${encodeURIComponent(schemaCtaUrl)}`}
              data-testid="report-schema-cta"
            >
              <Braces aria-hidden="true" data-icon="inline-start" />
              {t('detail.generateSchema')}
            </Link>
          </Button>
        </div>
      ) : null}

      {siteId && finding.affectedUrls[0] && !addressVariants ? (
        <div className="mb-4">
          <Button asChild variant="outline" size="sm">
            <Link
              to={contentAnalysisHref({
                siteId,
                ownedUrl: finding.affectedUrls[0],
                source: 'report',
              })}
              data-testid="report-content-analysis-cta"
            >
              <FileText aria-hidden="true" data-icon="inline-start" />
              {t('contentIntelligence:form.title')}
            </Link>
          </Button>
        </div>
      ) : null}

      {!hasBrokenLinkEvidence && brokenLinkTargets.length > 0 ? (
        <div className="mb-4">
          <h4 className="text-sm font-semibold">
            {t('detail.brokenLinkTargetsTitle')}
          </h4>
          <ul className="mt-1 space-y-1" data-testid="report-broken-link-targets">
            {brokenLinkTargets.map((url) => (
              <li key={url}>
                <a
                  href={safeExternalHref(url)}
                  target="_blank"
                  rel="nofollow ugc noopener noreferrer"
                  className="inline-flex min-h-6 items-center font-mono text-xs text-primary underline break-all"
                >
                  <Bdi>{url}</Bdi>
                </a>
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      {addressVariants ? <AddressVariantsBlock variants={addressVariants} /> : null}

      {!showPassedLabel ? (
        <DeepCrawlEvidenceBlocks
          evidence={deepEvidence}
          shownRows={deepEvidence.pages.size + deepEvidence.resources.size}
          showCut={!canLoadLists || fullLists !== null}
        />
      ) : null}

      {hasBrokenLinkEvidence ? (
        <BrokenLinkEvidence
          ruleId={finding.ruleId}
          rows={brokenLinkEvidence}
          total={fullLists ? undefined : finding.brokenLinkEvidenceTotal}
          loadAllRows={canLoadLists ? async () => (await loadFullLists())?.brokenLinkEvidence ?? null : undefined}
        />
      ) : null}

      {canLoadLists && !fullLists ? (
        <div className="mb-4 flex flex-wrap items-center gap-2" data-testid="report-issue-preview">
          <p className="text-muted-foreground text-sm">
            {t('detail.previewNote', { shown: finding.affectedUrls.length, total: totalAffected })}
          </p>
          <Button
            type="button"
            variant="outline"
            size="sm"
            loading={listsLoading}
            loadingLabel={t('detail.loadingFullList')}
            onClick={() => void loadFullLists()}
            data-testid="report-issue-load-all"
          >
            {t('detail.loadFullList')}
          </Button>
          {listsFailed ? (
            <p role="alert" className="text-destructive w-full text-sm" data-testid="report-issue-load-all-error">
              {t('detail.fullListFailed')}
            </p>
          ) : null}
        </div>
      ) : null}

      {!hasBrokenLinkEvidence && affectedUrls.length > 0 && !addressVariants ? (
        <div className="mb-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h4 className="text-sm font-semibold">
              {brokenLinkTargets.length > 0
                ? t('detail.brokenLinkSourcesTitle')
                : t('detail.affectedUrlsTitle')}
            </h4>
            <Button
              type="button"
              variant="outline"
              size="sm"
              loading={listsLoading}
              loadingLabel={t('detail.loadingFullList')}
              onClick={() => {
                // The file always holds every URL, not the on-screen preview.
                const lists = canLoadLists ? loadFullLists() : Promise.resolve(fullLists);
                void lists.then((loaded) => {
                  if (canLoadLists && !loaded) return;
                  saveBlobAs(
                    new Blob(
                      [
                        buildFindingUrlsCsv({
                          ruleId: finding.ruleId,
                          affectedUrls: loaded?.affectedUrls ?? finding.affectedUrls,
                          brokenLinkTargets: loaded?.brokenLinkTargets ?? finding.brokenLinkTargets,
                        }),
                      ],
                      { type: 'text/csv;charset=utf-8' },
                    ),
                    `${finding.ruleId}-urls.csv`,
                  );
                });
              }}
              data-testid="report-issue-download-urls"
            >
              <Download aria-hidden="true" />
              {t('detail.downloadUrls')}
            </Button>
          </div>
          <ul className="mt-1 space-y-1">
            {affectedUrls.map((url) => {
              const kind = urlDiff.get(url);
              const measurement = measurementByUrl.get(url);
              return (
                <li key={url} className="flex flex-wrap items-center gap-x-2 gap-y-1">
                  <a href={safeExternalHref(url)} target="_blank" rel="nofollow ugc noopener noreferrer" className="inline-flex min-h-6 items-center font-mono text-xs text-primary underline break-all"><Bdi>{url}</Bdi></a>
                  {measurement ? (
                    <span className="text-muted-foreground shrink-0 text-xs tabular-nums" data-testid="report-issue-measurement">
                      {t(`detail.measured.${measurement.unit}`, { count: measurement.value })}
                    </span>
                  ) : null}
                  {kind === 'fixed' ? (
                    <span className="text-xs font-medium text-success">
                      {t('badges.fixed')}
                    </span>
                  ) : null}
                  {kind === 'regressed' ? (
                    <span className="text-xs font-medium text-destructive">
                      {t('badges.regressed')}
                    </span>
                  ) : null}
                  <EvidenceFacts page={deepEvidence.pages.get(url)} resource={deepEvidence.resources.get(url)} />
                </li>
              );
            })}
          </ul>
        </div>
      ) : null}

      {!showPassedLabel ? (
        <div>
          <div className="mb-1 flex items-center justify-between gap-2">
            <h4 className="text-sm font-semibold">{t('detail.fixTitle')}</h4>
            <div className="flex flex-wrap items-center gap-2">
              {isLatestRun && Boolean(siteId) && finding.codeFixPromptAvailable ? (
                <CodeFixPromptButton
                  input={{
                    reference: finding.ruleId,
                    severity: finding.severity,
                    problem: finding.copy.title,
                    whyItMatters: finding.copy.reason
                      ? `${finding.copy.reason}\n${finding.copy.why}`
                      : finding.copy.why,
                    recommendedFix: finding.copy.fix,
                    affectedUrls,
                    affectedUrlCount: totalAffected,
                  }}
                />
              ) : null}
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={handleCopy}
                aria-label={t('detail.copyFix')}
                data-testid="report-issue-copy"
              >
                {copied ? (
                  <>
                    <Check aria-hidden="true" />
                    {t('detail.copied')}
                  </>
                ) : (
                  <>
                    <Copy aria-hidden="true" />
                    {t('detail.copyFix')}
                  </>
                )}
              </Button>
            </div>
          </div>
          <p className="text-muted-foreground text-sm whitespace-pre-wrap">
            {finding.copy.fix}
          </p>
        </div>
      ) : null}
    </div>
  );
};

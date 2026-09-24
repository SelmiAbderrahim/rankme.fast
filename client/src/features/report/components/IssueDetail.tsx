import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { safeExternalHref } from '@shared/security';
import { Check, Copy, Braces, FileText } from 'lucide-react';
import { Button } from '@shared/ui/button';
import { CodeFixPromptButton } from '@shared/components/CodeFixPromptButton';
import { writeToClipboard } from '@shared/lib/clipboard';
import { contentAnalysisHref } from '@shared/navigation/contentIntelligenceHref';
import {
  isGscSearchRuleId,
  isGscSitemapRuleId,
  isAiVisibilityRuleId,
  isLocalSeoRuleId,
  isPageSpeedRuleId,
  type AiVisibilitySection,
  type DiffKind,
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

export interface IssueDetailProps {
  finding: LocalizedFinding;
  diffByUrl: Map<string, DiffKind>;
  pageSpeed?: PageSpeedSection | null;
  gscSearch?: GscSearchSection | null;
  gscSitemaps?: GscSitemapsSection | null;
  aiVisibility?: AiVisibilitySection | null;
  localSeo?: LocalSeoSection | null;
  siteId?: string;
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

  const showPassedLabel = finding.bucket === 'passed';
  const showPageSpeedBlock = pageSpeed != null && isPageSpeedRuleId(finding.ruleId);
  const showGscSearchBlock = isGscSearchRuleId(finding.ruleId);
  const showGscSitemapsBlock = isGscSitemapRuleId(finding.ruleId);
  const showAiVisibilityBlock = isAiVisibilityRuleId(finding.ruleId);
  const showLocalSeoBlock = isLocalSeoRuleId(finding.ruleId);
  const brokenLinkTargets =
    finding.ruleId === 'broken-internal-links'
      ? (finding.brokenLinkTargets ?? [])
      : [];
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
          {showPassedLabel ? finding.copy.passedLabel : finding.copy.why}
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

      {siteId && finding.affectedUrls[0] ? (
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

      {brokenLinkTargets.length > 0 ? (
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
                  className="font-mono text-xs text-primary underline break-all"
                >
                  {url}
                </a>
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      {finding.affectedUrls.length > 0 ? (
        <div className="mb-4">
          <h4 className="text-sm font-semibold">
            {brokenLinkTargets.length > 0
              ? t('detail.brokenLinkSourcesTitle')
              : t('detail.affectedUrlsTitle')}
          </h4>
          <ul className="mt-1 space-y-1">
            {finding.affectedUrls.map((url) => {
              const kind = diffByUrl.get(url);
              return (
                <li key={url} className="flex items-center gap-2">
                  <a
                    href={safeExternalHref(url)}
                    target="_blank"
                    rel="nofollow ugc noopener noreferrer"
                    className="font-mono text-xs text-primary underline break-all"
                  >
                    {url}
                  </a>
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
                    affectedUrls: finding.affectedUrls,
                    affectedUrlCount: finding.affectedUrls.length,
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

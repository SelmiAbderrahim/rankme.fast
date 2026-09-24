import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Check, Copy, Download } from 'lucide-react';
import { Alert, AlertDescription, AlertTitle } from '@shared/ui/alert';
import { Badge } from '@shared/ui/badge';
import { Button } from '@shared/ui/button';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@shared/ui/card';
import { writeToClipboard } from '@shared/lib/clipboard';
import { downloadSchemaGeneration } from '../api';
import type { GenerationDetail } from '../types';

interface GenerationResultProps {
  detail: GenerationDetail;
}

const FACT_LABEL_KEYS: Readonly<Record<string, string>> = {
  'page.url': 'pageUrl',
  'page.canonical': 'canonicalUrl',
  'page.title': 'pageTitle',
  'page.metaDescription': 'metaDescription',
  'page.h1': 'headingOne',
  'page.h2': 'headingTwo',
  'page.faqAnswers': 'faqAnswer',
  'page.language': 'pageLanguage',
  'page.articlePublishedTime': 'articlePublishedTime',
  'page.articleModifiedTime': 'articleModifiedTime',
  'site.origin': 'siteOrigin',
  'site.domain': 'siteDomain',
  'site.label': 'siteName',
};

const factFamily = (factId: string): string => factId.replace(/\[\d+\]$/, '');

/**
 * The generated markup and everything that makes it honest:
 * the serialized payload as a TEXT node (never markup — SEC-OUT), one
 * evidence chip per emitted property, one localized reason per omission, and
 * the deterministic conformance verdict. The verdict speaks only about
 * schema.org requirements; it never promises a search result.
 */
/**
 * Copy / download controls plus the payload block. Split out so the copy and
 * download handlers only ever exist for a generation that actually retained a
 * payload — a failed generation has nothing to copy, and the guard for that
 * lives in the type system rather than in an unreachable runtime branch.
 */
const PayloadBlock = ({
  payload,
  generationId,
  mediaType,
  schemaType,
}: {
  payload: string;
  generationId: string;
  mediaType: string;
  schemaType: string;
}) => {
  const { t } = useTranslation('schemaGenerator');
  const [copied, setCopied] = useState(false);
  const [copying, setCopying] = useState(false);
  const [downloading, setDownloading] = useState(false);
  const [downloadFailed, setDownloadFailed] = useState(false);

  useEffect(() => {
    if (!copied) return undefined;
    const timer = window.setTimeout(() => setCopied(false), 2000);
    return () => window.clearTimeout(timer);
  }, [copied]);

  const handleCopy = async () => {
    setCopying(true);
    try {
      const ok = await writeToClipboard(payload);
      if (ok) setCopied(true);
    } finally {
      setCopying(false);
    }
  };

  const handleDownload = async () => {
    setDownloading(true);
    setDownloadFailed(false);
    try {
      const text = await downloadSchemaGeneration(generationId);
      const url = URL.createObjectURL(new Blob([text], { type: mediaType }));
      const anchor = document.createElement('a');
      anchor.href = url;
      anchor.download = `${schemaType}-${generationId}.jsonld`;
      document.body.append(anchor);
      anchor.click();
      anchor.remove();
      URL.revokeObjectURL(url);
    } catch {
      setDownloadFailed(true);
    } finally {
      setDownloading(false);
    }
  };

  return (
    <>
      <div className="flex flex-wrap items-center gap-2">
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={() => void handleCopy()}
          loading={copying}
          loadingLabel={t('result.copy')}
          data-testid="schema-copy"
        >
          {copied ? (
            <>
              <Check aria-hidden="true" />
              {t('result.copied')}
            </>
          ) : (
            <>
              <Copy aria-hidden="true" />
              {t('result.copy')}
            </>
          )}
        </Button>
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={() => void handleDownload()}
          loading={downloading}
          loadingLabel={t('result.download')}
          data-testid="schema-download"
        >
          <Download aria-hidden="true" />
          {t('result.download')}
        </Button>
      </div>
      {/* TEXT node only — never a raw-HTML escape hatch. The payload carries
          crawled page text that may contain markup (SEC-OUT). */}
      {/* `role="region"` + `tabIndex` are load-bearing, not decoration: a bare
          <pre> maps to `generic`, where `aria-label` is dropped, and a
          scrollable block that cannot take focus fails WCAG 2.1.1. */}
      <pre
        className="bg-muted max-h-96 overflow-auto rounded-xl p-3 font-mono text-xs break-all whitespace-pre-wrap"
        data-testid="schema-payload"
        role="region"
        tabIndex={0}
        aria-label={t('result.payload')}
        dir="ltr"
      >
        {payload}
      </pre>
      {downloadFailed ? (
        <Alert role="alert" data-testid="schema-download-failed">
          <AlertTitle>{t('result.downloadFailedTitle')}</AlertTitle>
          <AlertDescription>{t('result.downloadFailed')}</AlertDescription>
        </Alert>
      ) : null}
    </>
  );
};

export const GenerationResult = ({ detail }: GenerationResultProps) => {
  const { t } = useTranslation('schemaGenerator');

  return (
    <div className="flex flex-col gap-4" data-testid="schema-result">
      <Card>
        <CardHeader>
          <CardTitle>
            {t('result.title', { type: detail.schemaType })}
          </CardTitle>
          <CardDescription data-testid="schema-result-page" dir="ltr">
            {detail.pageUrl}
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-3">
          {detail.status === 'failed' ? (
            <Alert role="status" data-testid="schema-result-failed">
              <AlertTitle>{t('result.failedTitle')}</AlertTitle>
              <AlertDescription className="flex flex-col items-start gap-1">
                <span>
                  {detail.failureReason === 'ai_provider_failed'
                    ? t('result.failedProvider')
                    : t('result.failedRejected')}
                </span>
                {detail.refunded ? (
                  <span data-testid="schema-result-refunded">{t('result.refunded')}</span>
                ) : null}
              </AlertDescription>
            </Alert>
          ) : null}

          {detail.payload !== null ? (
            <PayloadBlock
              payload={detail.payload}
              generationId={detail.id}
              mediaType={detail.mediaType}
              schemaType={detail.schemaType}
            />
          ) : null}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>{t('result.evidence')}</CardTitle>
          <CardDescription>{t('result.evidenceDescription')}</CardDescription>
        </CardHeader>
        <CardContent>
          {detail.evidence.length === 0 ? (
            <p className="text-muted-foreground text-sm" data-testid="schema-evidence-empty">
              {t('result.evidenceEmpty')}
            </p>
          ) : (
            <ul className="flex flex-col gap-2" data-testid="schema-evidence">
              {detail.evidence.map((row) => (
                <li
                  key={`${row.property}-${row.factId}`}
                  className="flex flex-wrap items-center gap-2 text-sm"
                  data-testid={`schema-evidence-${row.property}`}
                >
                  <Badge variant="outline" className="font-mono">
                    {row.property}
                  </Badge>
                  <span className="text-muted-foreground">
                    {t('result.evidenceFrom', {
                      fact: FACT_LABEL_KEYS[factFamily(row.factId)]
                        ? t(`fact.${FACT_LABEL_KEYS[factFamily(row.factId)]}`)
                        : row.factId,
                    })}
                  </span>
                  <span className="break-all">{row.value}</span>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>{t('result.omissions')}</CardTitle>
          <CardDescription>{t('result.omissionsDescription')}</CardDescription>
        </CardHeader>
        <CardContent>
          {detail.omissions.length === 0 ? (
            <p
              className="text-muted-foreground text-sm"
              data-testid="schema-omissions-empty"
            >
              {t('result.omissionsEmpty')}
            </p>
          ) : (
            <ul className="flex flex-col gap-2" data-testid="schema-omissions">
              {detail.omissions.map((row) => (
                <li
                  key={row.property}
                  className="flex flex-wrap items-center gap-2 text-sm"
                  data-testid={`schema-omission-${row.property}`}
                >
                  <Badge variant="outline" className="font-mono">
                    {row.property}
                  </Badge>
                  <span className="text-muted-foreground">
                    {t(`reason.${row.reasonCode}`)}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>

      {detail.conformance ? (
        <Card>
          <CardHeader>
            <CardTitle>{t('conformance.title')}</CardTitle>
            <CardDescription data-testid="schema-conformance-status">
              {detail.conformance.status === 'conforms'
                ? t('conformance.conforms', { type: detail.schemaType })
                : t('conformance.gaps', { type: detail.schemaType })}
            </CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-3">
            {detail.conformance.requiredGaps.length > 0 ? (
              <div>
                <h4 className="text-sm font-semibold">{t('conformance.requiredTitle')}</h4>
                <ul className="mt-1 flex flex-col gap-1" data-testid="schema-required-gaps">
                  {detail.conformance.requiredGaps.map((gap) => (
                    <li
                      key={gap.property}
                      className="text-sm"
                      data-testid={`schema-required-gap-${gap.property}`}
                    >
                      {t('conformance.requiredGap', { property: gap.property })}{' '}
                      <span className="text-muted-foreground">
                        {t(`reason.${gap.reasonCode}`)}
                      </span>
                    </li>
                  ))}
                </ul>
              </div>
            ) : null}
            {detail.conformance.recommendedSuggestions.length > 0 ? (
              <div>
                <h4 className="text-sm font-semibold">
                  {t('conformance.recommendedTitle')}
                </h4>
                <ul
                  className="mt-1 flex flex-col gap-1"
                  data-testid="schema-recommended-suggestions"
                >
                  {detail.conformance.recommendedSuggestions.map((gap) => (
                    <li key={gap.property} className="text-sm">
                      {t('conformance.recommendedSuggestion', { property: gap.property })}
                    </li>
                  ))}
                </ul>
              </div>
            ) : null}
            <p className="text-muted-foreground text-xs" data-testid="schema-registry-version">
              {t('conformance.version', { version: detail.conformance.registryVersion })}
            </p>
          </CardContent>
        </Card>
      ) : null}
    </div>
  );
};

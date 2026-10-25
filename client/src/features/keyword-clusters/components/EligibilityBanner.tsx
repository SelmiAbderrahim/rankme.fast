import { RefreshCw } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router-dom';
import { Alert, AlertDescription, AlertTitle } from '@shared/ui/alert';
import { Button } from '@shared/ui/button';
import type { KeywordClusterBlockReason, KeywordClusterPreview } from '../types';

interface EligibilityBannerProps {
  preview: KeywordClusterPreview;
  ranksHref?: string;
}

const REASONS: readonly KeywordClusterBlockReason[] = ['missing', 'stale', 'empty'];

/** Explain a blocked stored-data run using the same readiness result as the start action. */
export function EligibilityBanner({ preview, ranksHref }: EligibilityBannerProps) {
  const { t, i18n } = useTranslation('keywordClusters');
  if (preview.ready) return null;
  // Older responses lack full reason counts. Only infer them when every
  // blocked row is disclosed; otherwise a partial sample would mislead.
  const counts = preview.reasonCounts ?? (preview.blocked.length === preview.blockedTotal
    ? Object.fromEntries(REASONS.map((reason) => [reason,
      preview.blocked.filter((row) => row.reason === reason).length])) as Record<KeywordClusterBlockReason, number>
    : null);
  const total = preview.readyCount + preview.blockedTotal;
  const number = (value: number) => new Intl.NumberFormat(i18n.language).format(value);
  return <Alert role="status" data-testid="keyword-clusters-eligibility-banner">
    <RefreshCw aria-hidden="true" />
    <AlertTitle>{t('eligibility.title')}</AlertTitle>
    <AlertDescription className="space-y-3">
      <p data-testid="keyword-clusters-eligibility-counts">
        {t('eligibility.needCheck', { count: preview.blockedTotal, total: number(total) })}{' '}
        {t('eligibility.ready', { count: preview.readyCount })}{' '}
        {t('eligibility.minimum', { count: preview.minKeywords })}
      </p>
      {counts ? <ul className="list-disc space-y-1 ps-5" data-testid="keyword-clusters-eligibility-reasons">
        {REASONS.filter((reason) => counts[reason] > 0).map((reason) => <li key={reason} data-reason={reason}>
          {t(`blocked.reason.${reason}`)}: <bdi dir="ltr">{number(counts[reason])}</bdi>
        </li>)}
      </ul> : null}
      {counts && counts.empty > 0 ? <p data-testid="keyword-clusters-eligibility-snapshot-note">
        {t('eligibility.snapshotNote')}
      </p> : null}
      {ranksHref ? <Button asChild size="sm" variant="outline" data-testid="keyword-clusters-run-rank-check">
        <Link to={ranksHref}>{t('states.ranksCta')}</Link>
      </Button> : null}
    </AlertDescription>
  </Alert>;
}

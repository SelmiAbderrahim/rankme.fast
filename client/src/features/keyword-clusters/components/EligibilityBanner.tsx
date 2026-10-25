import { RefreshCw } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router-dom';
import { Alert, AlertDescription, AlertTitle } from '@shared/ui/alert';
import { Button } from '@shared/ui/button';
import { KEYWORD_CLUSTER_ELIGIBILITY_REASONS, type KeywordClusterEligibility } from '../types';

interface EligibilityBannerProps {
  eligibility: KeywordClusterEligibility;
  minKeywords: number;
  ranksHref?: string;
}

/**
 * The blocked-preview banner, rendered only from the server's `canRun` /
 * `blockingReasonCode` and its counts, so it always agrees with the list below
 * it. It carries the screen's single "Run a rank check" action. Never rendered
 * when the run can proceed.
 */
export function EligibilityBanner({ eligibility, minKeywords, ranksHref }: EligibilityBannerProps) {
  const { t, i18n } = useTranslation('keywordClusters');
  const number = (value: number) => new Intl.NumberFormat(i18n.language).format(value);
  const reasons = KEYWORD_CLUSTER_ELIGIBILITY_REASONS.filter((reason) => eligibility.reasonCounts[reason] > 0);
  return <Alert role="status" data-testid="keyword-clusters-eligibility-banner">
    <RefreshCw aria-hidden="true" />
    <AlertTitle>{t('eligibility.title')}</AlertTitle>
    <AlertDescription className="space-y-3">
      <p data-testid="keyword-clusters-eligibility-counts">
        {t('eligibility.needCheck', { count: eligibility.ineligibleCount, total: number(eligibility.total) })}{' '}
        {t('eligibility.ready', { count: eligibility.eligibleCount })}{' '}
        {t('eligibility.minimum', { count: minKeywords })}
      </p>
      {reasons.length > 0 ? <ul className="list-disc space-y-1 ps-5" data-testid="keyword-clusters-eligibility-reasons">
        {reasons.map((reason) => <li key={reason} data-reason={reason}>
          {t(`blocked.reason.${reason}`)}: <bdi dir="ltr">{number(eligibility.reasonCounts[reason])}</bdi>
        </li>)}
      </ul> : null}
      {eligibility.reasonCounts.no_serp_snapshot > 0 ? <p data-testid="keyword-clusters-eligibility-snapshot-note">
        {t('eligibility.snapshotNote')}
      </p> : null}
      {ranksHref ? <Button asChild size="sm" variant="outline" data-testid="keyword-clusters-run-rank-check">
        <Link to={ranksHref}>{t('states.ranksCta')}</Link>
      </Button> : null}
    </AlertDescription>
  </Alert>;
}

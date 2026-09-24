import { AlertCircle, Inbox, Link2Off, RefreshCw } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router-dom';
import { Alert, AlertDescription, AlertTitle } from '@shared/ui/alert';
import { Button } from '@shared/ui/button';
import type { KeywordClusterUiState } from '../types';

export type KeywordClusterNoticeKind =
  | KeywordClusterUiState
  | 'emptyRuns'
  | 'emptyClusters';

interface StateNoticeProps {
  kind: KeywordClusterNoticeKind;
  ranksHref?: string;
}

export const StateNotice = ({ kind, ranksHref }: StateNoticeProps) => {
  const { t } = useTranslation('keywordClusters');
  const isEmpty = kind === 'emptyRuns' || kind === 'emptyClusters';
  const Icon =
    kind === 'notEnoughKeywords'
      ? RefreshCw
      : isEmpty
        ? Inbox
        : kind === 'notFound'
          ? Link2Off
          : AlertCircle;
  const urgent = ['disabled', 'rateLimited', 'notFound', 'failed'].includes(kind);

  return (
    <Alert
      variant={urgent ? 'destructive' : 'default'}
      role={urgent ? 'alert' : 'status'}
      data-testid={`keyword-clusters-state-${kind}`}
    >
      <Icon aria-hidden="true" />
      <AlertTitle>{t(`states.${kind}.title`)}</AlertTitle>
      <AlertDescription className="space-y-3">
        <p>{t(`states.${kind}.body`)}</p>
        {kind === 'notEnoughKeywords' && ranksHref ? (
          <Button asChild size="sm" variant="outline">
            <Link to={ranksHref}>{t('states.ranksCta')}</Link>
          </Button>
        ) : null}
      </AlertDescription>
    </Alert>
  );
};

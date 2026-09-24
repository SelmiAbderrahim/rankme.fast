import { AlertCircle, Inbox, Link2Off, RefreshCw } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router-dom';
import { Alert, AlertDescription, AlertTitle } from '@shared/ui/alert';
import { Button } from '@shared/ui/button';
import type { InternalLinkUiState } from '../types';

export type InternalLinkNoticeKind =
  | InternalLinkUiState
  | 'emptyRuns'
  | 'emptySuggestions'
  | 'missing'
  | 'stale';

interface StateNoticeProps {
  kind: InternalLinkNoticeKind;
  inventoryHref?: string;
}

export const StateNotice = ({ kind, inventoryHref }: StateNoticeProps) => {
  const { t } = useTranslation('internalLinks');
  const isEmpty = kind === 'emptyRuns' || kind === 'emptySuggestions';
  const Icon =
    kind === 'missing' || kind === 'stale'
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
      data-testid={`internal-links-state-${kind}`}
    >
      <Icon aria-hidden="true" />
      <AlertTitle>{t(`states.${kind}.title`)}</AlertTitle>
      <AlertDescription className="space-y-3">
        <p>{t(`states.${kind}.body`)}</p>
        {(kind === 'missing' || kind === 'stale') && inventoryHref ? (
          <Button asChild size="sm" variant="outline">
            <Link to={inventoryHref}>{t('states.inventoryCta')}</Link>
          </Button>
        ) : null}
      </AlertDescription>
    </Alert>
  );
};


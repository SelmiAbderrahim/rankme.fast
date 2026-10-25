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
  | 'noSuggestions'
  | 'missing'
  | 'stale';

interface StateNoticeProps {
  kind: InternalLinkNoticeKind;
  inventoryHref?: string;
  /** The one next step an empty state offers. */
  onAction?: () => void;
}

export const StateNotice = ({ kind, inventoryHref, onAction }: StateNoticeProps) => {
  const { t } = useTranslation('internalLinks');
  const isEmpty = kind === 'emptyRuns' || kind === 'emptySuggestions' || kind === 'noSuggestions';
  const inventoryKind = kind === 'missing' || kind === 'stale';
  const Icon =
    inventoryKind
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
        {inventoryKind ? <p>{t('states.inventoryDifference')}</p> : null}
        {inventoryKind && inventoryHref ? (
          <Button asChild size="sm" variant="outline">
            {/* No inventory yet → "Run"; an out-of-date one → "Re-run". */}
            <Link to={inventoryHref}>
              {t(kind === 'missing' ? 'states.inventoryRunCta' : 'states.inventoryCta')}
            </Link>
          </Button>
        ) : null}
        {onAction ? (
          <Button
            type="button"
            size="sm"
            variant="outline"
            onClick={onAction}
            data-testid={`internal-links-state-${kind}-action`}
          >
            {t(`states.${kind}.action`)}
          </Button>
        ) : null}
      </AlertDescription>
    </Alert>
  );
};


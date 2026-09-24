import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { Alert, AlertDescription, AlertTitle } from '@shared/ui/alert';
import { Button } from '@shared/ui/button';
import type { CannibalizationGateKind } from '../types';

/** States that point the user at a surface which resolves them. */
const LOCAL_STATE_LINKS = {
  disconnected: '?tab=google',
} as const;

interface StateNoticeProps {
  kind: CannibalizationGateKind | 'empty' | 'disconnected';
  /** Server-authored refusal sentence; preferred over the generic copy. */
  message?: string;
}

/**
 * One notice per honest state. The client never decides a refusal: it names
 * the one the server already made, and only falls back to its own copy for
 * the two states the server never speaks to (empty list, no GSC connection).
 */
export const StateNotice = ({ kind, message }: StateNoticeProps) => {
  const { t } = useTranslation('cannibalization');
  const link = LOCAL_STATE_LINKS[kind as keyof typeof LOCAL_STATE_LINKS];
  return (
    <Alert role="status" data-testid={`cannibalization-state-${kind}`}>
      <AlertTitle>{t(`states.${kind}.title`)}</AlertTitle>
      <AlertDescription className="flex flex-col items-start gap-2">
        <span>{message || t(`states.${kind}.body`)}</span>
        {link ? (
          <Button asChild variant="outline" size="sm">
            <Link to={link}>{t(`states.${kind}.link`)}</Link>
          </Button>
        ) : null}
      </AlertDescription>
    </Alert>
  );
};

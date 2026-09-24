import { useTranslation } from 'react-i18next';
import { Alert, AlertDescription, AlertTitle } from '@shared/ui/alert';
import type { AlertGateKind } from '../types';

interface StateNoticeProps {
  kind: AlertGateKind | 'empty' | 'noSites';
  /** Server-authored refusal sentence; preferred over the generic copy. */
  message?: string;
}

/**
 * One notice per honest state. The client never decides a refusal: it names
 * the one the server already made, and only falls back to its own copy for the
 * two states the server never speaks to (empty rule list, no sites yet).
 */
export const StateNotice = ({ kind, message }: StateNoticeProps) => {
  const { t } = useTranslation('alerts');
  return (
    <Alert role="status" data-testid={`alerts-state-${kind}`}>
      <AlertTitle>{t(`states.${kind}.title`)}</AlertTitle>
      <AlertDescription>{message || t(`states.${kind}.body`)}</AlertDescription>
    </Alert>
  );
};

import { useTranslation } from 'react-i18next';
import { Alert, AlertDescription, AlertTitle } from '@shared/ui/alert';
import type { CannibalizationGateKind } from '../types';

interface StateNoticeProps {
  kind: CannibalizationGateKind | 'empty';
  /** Server-authored refusal sentence; preferred over the generic copy. */
  message?: string;
}

/**
 * One notice per honest state. The client never decides a refusal: it names
 * the one the server already made, and only falls back to its own copy for
 * the state the server never speaks to (empty list).
 */
export const StateNotice = ({ kind, message }: StateNoticeProps) => {
  const { t } = useTranslation('cannibalization');
  return (
    <Alert role="status" data-testid={`cannibalization-state-${kind}`}>
      <AlertTitle>{t(`states.${kind}.title`)}</AlertTitle>
      <AlertDescription className="flex flex-col items-start gap-2">
        <span>{message || t(`states.${kind}.body`)}</span>
      </AlertDescription>
    </Alert>
  );
};

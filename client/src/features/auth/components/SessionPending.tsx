import { Loader2 } from 'lucide-react';
import { useTranslation } from 'react-i18next';

/** Full-area session-resolution placeholder — never render a blank gate. */
export const SessionPending = () => {
  const { t } = useTranslation('auth');
  return (
    <div
      className="text-muted-foreground flex min-h-[70vh] items-center justify-center gap-2 text-sm"
      role="status"
      aria-live="polite"
    >
      <Loader2 className="size-4 animate-spin" aria-hidden="true" />
      {t('sessionPending')}
    </div>
  );
};

import { useTranslation } from 'react-i18next';
import { Alert, AlertDescription, AlertTitle } from '@shared/ui/alert';
import { Button } from '@shared/ui/button';

interface SecretRevealPanelProps {
  secret: string;
  onDismiss: () => void;
}

/**
 * Show-once display of a freshly minted webhook signing secret.
 *
 * The value is rendered as a plain text node inside a `<code>` element — never
 * an input the browser could offer to save, and never re-fetchable. Dismissing
 * drops it from the store, after which only the four-character tail survives.
 */
export const SecretRevealPanel = ({ secret, onDismiss }: SecretRevealPanelProps) => {
  const { t } = useTranslation('alerts');
  return (
    <Alert role="status" data-testid="alerts-secret-reveal">
      <AlertTitle>{t('secret.title')}</AlertTitle>
      <AlertDescription className="flex flex-col items-start gap-2">
        <span>{t('secret.body')}</span>
        <code
          className="w-full break-all rounded-md border border-border bg-muted px-2 py-1 font-mono text-xs"
          data-testid="alerts-secret-value"
        >
          {secret}
        </code>
        <Button variant="outline" size="sm" onClick={onDismiss}>
          {t('secret.dismiss')}
        </Button>
      </AlertDescription>
    </Alert>
  );
};

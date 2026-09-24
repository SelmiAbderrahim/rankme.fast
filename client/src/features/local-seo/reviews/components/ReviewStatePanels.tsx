import { useTranslation } from 'react-i18next';
import { Alert, AlertDescription, AlertTitle } from '@shared/ui/alert';

/**
 * `REVIEW_INTELLIGENCE_ENABLED=false`. New syncs refuse; everything already
 * stored stays readable, which is exactly what this banner says.
 */
export const ReviewKillSwitchBanner = ({ description }: { description?: string }) => {
  const { t } = useTranslation('reviewIntelligence');
  return (
    <Alert role="status" data-testid="reviews-kill-switch">
      <AlertTitle>{t('states.disabled.title')}</AlertTitle>
      <AlertDescription>{description || t('states.disabled.description')}</AlertDescription>
    </Alert>
  );
};

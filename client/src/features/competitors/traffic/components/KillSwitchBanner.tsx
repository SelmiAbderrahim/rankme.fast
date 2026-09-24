import { useTranslation } from 'react-i18next';
import { Alert, AlertDescription, AlertTitle } from '@shared/ui/alert';

interface KillSwitchBannerProps {
  description?: string;
}

export const KillSwitchBanner = ({ description }: KillSwitchBannerProps) => {
  const { t } = useTranslation('competitorsTraffic');

  return (
    <Alert role="status" data-testid="traffic-kill-switch">
      <AlertTitle>{t('states.locked.title')}</AlertTitle>
      <AlertDescription>{description || t('states.locked.description')}</AlertDescription>
    </Alert>
  );
};

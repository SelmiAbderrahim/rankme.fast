import { useTranslation } from 'react-i18next';
import {
  isAnalyticsConfigured,
  useAnalyticsChoice,
  writeAnalyticsChoice,
} from '@shared/analytics';
import { Card, CardContent, CardHeader, CardTitle } from '@shared/ui/card';
import { Label } from '@shared/ui/label';
import { Switch } from '@shared/ui/switch';

/**
 * Data & privacy — usage analytics. Lets the signed-in user grant or withdraw
 * consent for Google Analytics at any time. Renders nothing when the build has
 * no GA measurement ID (nothing to consent to).
 */
export const AnalyticsPreference = () => {
  const { t } = useTranslation('account');
  const choice = useAnalyticsChoice();

  if (!isAnalyticsConfigured()) return null;

  return (
    <Card className="w-full">
      <CardHeader>
        <CardTitle className="text-xl">{t('privacy.analytics.title')}</CardTitle>
        <p className="text-muted-foreground text-sm">{t('privacy.analytics.description')}</p>
      </CardHeader>
      <CardContent>
        <div className="flex items-center justify-between gap-4 rounded-md border border-border px-4 py-3">
          <Label htmlFor="analytics-consent" className="text-sm font-medium">
            {t('privacy.analytics.label')}
          </Label>
          <Switch
            id="analytics-consent"
            checked={choice === 'granted'}
            onCheckedChange={(next) => writeAnalyticsChoice(next ? 'granted' : 'denied')}
          />
        </div>
      </CardContent>
    </Card>
  );
};

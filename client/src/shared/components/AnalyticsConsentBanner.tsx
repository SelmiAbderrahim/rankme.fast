import { BarChart3 } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import {
  isAnalyticsConfigured,
  useAnalyticsChoice,
  writeAnalyticsChoice,
} from '@shared/analytics';
import { Button } from '@shared/ui/button';

const focusMain = (): void => {
  const main = document.querySelector<HTMLElement>('main');
  if (!main) return;
  if (!main.hasAttribute('tabindex')) main.setAttribute('tabindex', '-1');
  main.focus();
};

/**
 * Analytics consent prompt. Mounted once by the app providers. Renders nothing
 * when the build has no GA measurement ID, nothing on the server or during
 * hydration, and nothing once the visitor has chosen. Accept and Decline carry
 * equal weight; declining is as easy as accepting and loads nothing.
 */
export const AnalyticsConsentBanner = () => {
  const { t } = useTranslation('common');
  const choice = useAnalyticsChoice();

  if (!isAnalyticsConfigured() || choice !== 'unset') return null;

  const choose = (next: 'granted' | 'denied') => {
    writeAnalyticsChoice(next);
    focusMain();
  };

  return (
    <section
      aria-label={t('analyticsConsent.label')}
      className="fixed inset-x-0 bottom-0 z-50 border-t border-border bg-card text-card-foreground shadow-sm"
      data-testid="analytics-consent-banner"
    >
      <div className="container mx-auto flex min-w-0 flex-wrap items-center gap-x-6 gap-y-3 px-4 py-3 text-sm">
        <BarChart3 aria-hidden="true" className="size-4 shrink-0" />
        <div className="flex min-w-0 flex-1 basis-64 flex-col gap-1">
          <p className="font-semibold">{t('analyticsConsent.title')}</p>
          <p className="text-muted-foreground text-start">{t('analyticsConsent.message')}</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button type="button" variant="outline" onClick={() => choose('denied')}>
            {t('analyticsConsent.decline')}
          </Button>
          <Button type="button" variant="outline" onClick={() => choose('granted')}>
            {t('analyticsConsent.accept')}
          </Button>
        </div>
      </div>
    </section>
  );
};

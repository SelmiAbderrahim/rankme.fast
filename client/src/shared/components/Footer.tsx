import { appBuildIdentifier, appDisplayVersion } from '@shared/config/version';
import { releaseStage } from '@shared/config/release';
import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { useAuthSession } from '@features/auth';
import { BRAND_NAME } from '@shared/brand';
import { isAnalyticsConfigured, writeAnalyticsChoice } from '@shared/analytics';
import { Button } from '@shared/ui/button';
import { Separator } from '@shared/ui/separator';

const AUTHED_LINKS = [
  { to: '/dashboard', labelKey: 'nav.dashboard' },
];

const ANON_LINKS = [
  { to: '/login', labelKey: 'nav.login' },
  { to: '/register', labelKey: 'nav.register' },
];

export const Footer = () => {
  const { authenticated } = useAuthSession();
  const { t } = useTranslation('common');
  const year = new Date().getFullYear();
  const links = authenticated ? AUTHED_LINKS : ANON_LINKS;

  return (
    <footer className="@container mt-auto border-t">
      {/* The footer sits beside the app sidebar, so its room depends on the
          column width, not the viewport: container queries pick the layout.
          Items wrap onto a second row before any of them has to break
          mid-phrase. */}
      <div className="text-muted-foreground container mx-auto flex flex-col items-center gap-x-6 gap-y-4 px-4 py-6 text-sm @2xl:flex-row @2xl:flex-wrap @2xl:justify-between">
        <nav>
          <ul className="flex flex-wrap items-center justify-center gap-x-4 gap-y-2">
            {links.map((link) => (
              <li key={link.to}>
                <Link to={link.to} className="hover:text-foreground transition-colors">
                  {t(link.labelKey)}
                </Link>
              </li>
            ))}
            {isAnalyticsConfigured() ? (
              <li>
                {/* Clearing the stored choice re-opens the consent prompt. */}
                <Button
                  variant="ghost"
                  size="xs"
                  type="button"
                  className="text-muted-foreground hover:text-foreground"
                  onClick={() => writeAnalyticsChoice(null)}
                >
                  {t('footer.analyticsPreferences')}
                </Button>
              </li>
            ) : null}
          </ul>
        </nav>
        <p className="text-muted-foreground whitespace-nowrap" dir="ltr" title={appBuildIdentifier} data-testid="footer-version">{t('footer.version', { version: appDisplayVersion, stage: releaseStage() })}</p>
        <Separator className="@2xl:hidden" />
        <p className="text-center">{t('footer.copyright', { year, brand: BRAND_NAME })}</p>
      </div>
    </footer>
  );
};

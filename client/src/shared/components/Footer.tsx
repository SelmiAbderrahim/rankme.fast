import { appVersion } from '@shared/config/version';
import { releaseStage } from '@shared/config/release';
import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { useAuthSession } from '@features/auth';
import { BRAND_NAME } from '@shared/brand';
import { Separator } from '@shared/ui/separator';

const AUTHED_LINKS = [
  { to: '/dashboard', labelKey: 'nav.dashboard' },
  { to: '/logout', labelKey: 'nav.logout' },
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
    <footer className="mt-auto border-t">
      <div className="text-muted-foreground container mx-auto flex flex-col items-center gap-4 px-4 py-6 text-sm sm:flex-row sm:justify-between">
        <nav>
          <ul className="flex flex-wrap items-center gap-4">
            {links.map((link) => (
              <li key={link.to}>
                <Link to={link.to} className="hover:text-foreground transition-colors">
                  {t(link.labelKey)}
                </Link>
              </li>
            ))}
          </ul>
        </nav>
        <p className="text-muted-foreground" dir="ltr">{t('footer.version', { version: appVersion, stage: releaseStage() })}</p>
        <Separator className="sm:hidden" />
        <p>{t('footer.copyright', { year, brand: BRAND_NAME })}</p>
      </div>
    </footer>
  );
};

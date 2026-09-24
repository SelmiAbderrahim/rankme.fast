import { useEffect } from 'react';
import { Outlet, useLocation, useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { Footer } from './Footer';
import { Header, type HeaderNavLink } from './Header';
import { ReleaseStageBanner } from './ReleaseStageBanner';
import { githubUrl } from '@shared/config/github';
import { authEntryHref, localeHref, useMarketingRoute } from '@shared/i18n/localePath';
import { appHref } from '@shared/navigation/appHref';

/**
 * Public (signed-out) shell for the server-rendered docs and the public 404.
 * Sibling to MinimalLayout (auth screens) and AppLayout (product shell); the
 * self-hosted edition ships no marketing site, so this is the only SSR chrome.
 */
export const PublicLayout = () => {
  const { locale, basePath } = useMarketingRoute();
  const navigate = useNavigate();
  const location = useLocation();
  const { t } = useTranslation('common');

  useEffect(() => {
    const frame = window.requestAnimationFrame(() => {
      if (!location.hash) {
        window.scrollTo({ left: 0, top: 0 });
        return;
      }

      let id: string;
      try {
        id = decodeURIComponent(location.hash.slice(1));
      } catch {
        // A malformed percent escape is still a valid browser location. It
        // should never be able to interrupt hydration or blank the page.
        return;
      }
      document.getElementById(id)?.scrollIntoView({ block: 'start' });
    });

    return () => window.cancelAnimationFrame(frame);
  }, [location.hash, location.key, location.pathname]);

  const navLinks: HeaderNavLink[] = [{ to: localeHref('/docs', locale), labelKey: 'nav.docs' }];

  return (
    <div className="mk-theme flex min-h-dvh flex-col bg-background text-foreground">
      <a
        className="sr-only fixed start-4 top-4 z-50 rounded-md bg-primary px-4 py-3 text-primary-foreground focus:fixed focus:not-sr-only"
        href="#public-main"
      >
        {t('nav.skipToContent')}
      </a>
      <ReleaseStageBanner />
      <Header
        variant="marketing"
        homeHref={localeHref('/', locale)}
        links={navLinks}
        loginHref={appHref(authEntryHref('/login', locale))}
        ctaHref={appHref(authEntryHref('/register', locale))}
        ctaLabelKey="nav.getStarted"
        githubHref={githubUrl()}
        onLocaleChange={(nextLocale) => navigate(localeHref(basePath, nextLocale))}
      />

      <main className="flex-1" id="public-main">
        <Outlet />
      </main>

      <Footer />
    </div>
  );
};

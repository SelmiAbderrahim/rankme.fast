import { useState, type ComponentProps } from 'react';
import { Link } from 'react-router-dom';
import { Menu, Star } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { useAuthSession } from '@features/auth';
import { BrandLogo, BRAND_NAME } from '@shared/brand';
import { cn } from '@shared/lib/utils';
import { Button } from '@shared/ui/button';
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetTrigger } from '@shared/ui/sheet';
import { LanguageSwitcher } from '@shared/i18n/LanguageSwitcher';
import type { SupportedLocale } from '@shared/i18n';
import { appHref } from '@shared/navigation/appHref';
import { ReleaseStageBadge } from './ReleaseStageBadge';
import { ThemeToggle } from './ThemeToggle';

export interface HeaderNavLink {
  to: string;
  labelKey: string;
}

export interface HeaderProps {
  variant?: 'app' | 'marketing';
  homeHref?: string;
  links?: HeaderNavLink[];
  loginHref?: string;
  ctaHref?: string;
  ctaLabelKey?: string;
  ctaVariant?: ComponentProps<typeof Button>['variant'];
  /** Public repository URL; when absent the GitHub chip renders nothing. */
  githubHref?: string | null;
  onLocaleChange?: (locale: SupportedLocale) => void;
}

const AUTHED_LINKS: HeaderNavLink[] = [
  { to: '/dashboard', labelKey: 'nav.dashboard' },
  { to: '/sites', labelKey: 'nav.sites' },
  { to: '/keyword-research', labelKey: 'nav.keywordResearch' },
  { to: '/settings/notifications', labelKey: 'nav.notifications' },
  { to: '/logout', labelKey: 'nav.logout' },
];

const ANON_LINKS: HeaderNavLink[] = [
  { to: '/login', labelKey: 'nav.login' },
  { to: '/register', labelKey: 'nav.register' },
];

export const Header = ({
  variant = 'app',
  homeHref = '/',
  links,
  loginHref = '/login',
  ctaHref = '/register',
  ctaLabelKey = 'nav.register',
  ctaVariant = 'default',
  githubHref = null,
  onLocaleChange,
}: HeaderProps) => {
  const { authenticated } = useAuthSession();
  const { t, i18n } = useTranslation('common');
  const [open, setOpen] = useState(false);
  const navigationLinks = links ?? (authenticated ? AUTHED_LINKS : ANON_LINKS);
  const isMarketing = variant === 'marketing';
  const showAuthActions = isMarketing;
  const loginLabelKey = isMarketing ? 'nav.logIn' : 'nav.login';
  const logoutLabelKey = isMarketing ? 'nav.logOut' : 'nav.logout';
  const dashboardHref = isMarketing ? appHref('/dashboard') : '/dashboard';
  const logoutHref = isMarketing ? appHref('/logout') : '/logout';

  return (
    <header className="sticky top-0 z-40 border-b bg-background">
      <div className="container mx-auto flex h-14 min-w-0 items-center justify-between gap-2 px-4 sm:gap-4">
        <div className="flex min-w-0 items-center gap-2">
          <Link
            to={homeHref}
            className="flex min-w-0 items-center"
            aria-label={`${BRAND_NAME} ${t('nav.home')}`}
          >
            <BrandLogo />
          </Link>
          <ReleaseStageBadge />
        </div>

        <nav
          className={cn(
            'hidden min-w-0 items-center gap-1 xl:flex',
            isMarketing && 'flex-1 justify-center',
          )}
          aria-label={t('nav.primary')}
        >
          {navigationLinks.map((link) => (
            <Button key={link.to} asChild variant="ghost" size="sm">
              <Link to={link.to}>{t(link.labelKey)}</Link>
            </Button>
          ))}
        </nav>

        <div className="flex shrink-0 items-center gap-2">
          {githubHref ? (
            <Button asChild className="hidden sm:inline-flex" size="sm" variant="ghost">
              <a href={githubHref} rel="noreferrer" target="_blank">
                <Star data-icon="inline-start" />
                GitHub
              </a>
            </Button>
          ) : null}
          {showAuthActions ? (
            authenticated ? (
              <>
                <Button asChild variant="ghost" size="sm" className="hidden sm:inline-flex">
                  <Link to={dashboardHref}>{t('nav.dashboard')}</Link>
                </Button>
                <Button asChild size="sm" className="hidden rounded-full sm:inline-flex">
                  <Link to={logoutHref}>{t(logoutLabelKey)}</Link>
                </Button>
              </>
            ) : (
              <>
                <Button asChild variant="ghost" size="sm" className="hidden sm:inline-flex">
                  <Link to={loginHref}>{t(loginLabelKey)}</Link>
                </Button>
                <Button
                  asChild
                  className="hidden rounded-full sm:inline-flex"
                  size="sm"
                  variant={ctaVariant}
                >
                  <Link to={ctaHref}>{t(ctaLabelKey)}</Link>
                </Button>
              </>
            )
          ) : null}
          <LanguageSwitcher className="hidden lg:block" onLocaleChange={onLocaleChange} />
          <ThemeToggle className={isMarketing ? 'size-11' : undefined} />

          <Sheet open={open} onOpenChange={setOpen}>
            <SheetTrigger asChild>
              <Button
                variant="ghost"
                size="icon"
                className={cn('xl:hidden', isMarketing && 'size-11')}
                aria-label={t('nav.menu')}
              >
                <Menu />
              </Button>
            </SheetTrigger>
            <SheetContent
              side={i18n.dir() === 'rtl' ? 'left' : 'right'}
              className="w-[85vw] max-w-80"
            >
              <SheetHeader>
                <SheetTitle className="flex items-center gap-2 text-start">
                  <BrandLogo />
                  <ReleaseStageBadge />
                </SheetTitle>
              </SheetHeader>
              <nav className="flex flex-col gap-1 px-2">
                {navigationLinks.map((link) => (
                  <Button
                    key={link.to}
                    asChild
                    variant="ghost"
                    className="justify-start"
                    onClick={() => setOpen(false)}
                  >
                    <Link to={link.to}>{t(link.labelKey)}</Link>
                  </Button>
                ))}
                {showAuthActions ? (
                  authenticated ? (
                    <>
                      <Button
                        asChild
                        variant="ghost"
                        className="justify-start"
                        onClick={() => setOpen(false)}
                      >
                        <Link to={dashboardHref}>{t('nav.dashboard')}</Link>
                      </Button>
                      <Button
                        asChild
                        variant="ghost"
                        className="justify-start"
                        onClick={() => setOpen(false)}
                      >
                        <Link to={logoutHref}>{t(logoutLabelKey)}</Link>
                      </Button>
                    </>
                  ) : (
                    <>
                      <Button
                        asChild
                        variant="ghost"
                        className="justify-start"
                        onClick={() => setOpen(false)}
                      >
                        <Link to={loginHref}>{t(loginLabelKey)}</Link>
                      </Button>
                      <Button
                        asChild
                        variant={ctaVariant}
                        className="justify-start rounded-full"
                        onClick={() => setOpen(false)}
                      >
                        <Link to={ctaHref}>{t(ctaLabelKey)}</Link>
                      </Button>
                    </>
                  )
                ) : null}
                {githubHref ? (
                  <Button asChild className="justify-start" variant="ghost">
                    <a href={githubHref} rel="noreferrer" target="_blank">
                      <Star data-icon="inline-start" />
                      GitHub
                    </a>
                  </Button>
                ) : null}
                <LanguageSwitcher className="mt-2 px-2" onLocaleChange={onLocaleChange} />
              </nav>
            </SheetContent>
          </Sheet>
        </div>
      </div>
    </header>
  );
};

import { useEffect, useMemo, useState, type FormEvent } from 'react';
import { Bug, PanelLeft, Search } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Link, useNavigate } from 'react-router-dom';
import { useAuthSession } from '@features/auth';
import { InvitationInbox } from '@features/team';
import { WorkspaceSwitcher, loadWorkspaces } from '@features/workspace';
import { docsUrl } from '@shared/docs/docsUrl';
import { LanguageSwitcher } from '@shared/i18n/LanguageSwitcher';
import { Avatar, AvatarFallback, AvatarImage } from '@shared/ui/avatar';
import { Button } from '@shared/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@shared/ui/dropdown-menu';
import { Input } from '@shared/ui/input';
import { Separator } from '@shared/ui/separator';
import { useSidebar } from '@shared/ui/sidebar';
import { useAppDispatch } from '@shared/hooks/redux';
import { buildBugReportHref } from '@shared/feedback/bugReport';
import { useRoutePattern } from '@shared/feedback/useRoutePattern';
import { ThemeToggle } from './ThemeToggle';

interface JumpTarget {
  to: string;
  label: string;
}

const initialsOf = (name?: string | null, email?: string | null): string => {
  const source = (name ?? '').trim() || (email ?? '').trim();
  if (!source) return '?';
  const parts = source.split(/\s+/).filter(Boolean);
  if (parts.length >= 2) {
    return `${parts[0]!.charAt(0)}${parts[1]!.charAt(0)}`.toUpperCase();
  }
  return source.slice(0, 2).toUpperCase();
};

/**
 * App shell topbar (SPEC-03) — collapse toggle, quick-jump search, theme +
 * locale controls, notifications, and the account menu. All labels localized.
 * The search is a dependency-free quick-nav (datalist + submit → navigate),
 * not a fake global-search box.
 */
export const AppTopbar = () => {
  const { t, i18n } = useTranslation('common');
  const navigate = useNavigate();
  const routePattern = useRoutePattern();
  const dispatch = useAppDispatch();
  const { toggleSidebar } = useSidebar();
  const { user } = useAuthSession();
  const [query, setQuery] = useState('');

  const targets = useMemo<JumpTarget[]>(
    () => [
      { to: '/dashboard', label: t('nav.dashboard') },
      { to: '/sites', label: t('nav.sites') },
      { to: '/keyword-research', label: t('nav.keywordResearch') },
      { to: '/profile', label: t('shell.profile') },
      { to: '/settings/team', label: t('nav.team') },
      { to: '/settings/notifications', label: t('nav.notifications') },
      { to: '/settings/security', label: t('nav.security') },
      { to: docsUrl('index', i18n.language), label: t('nav.docs') },
    ],
    [i18n.language, t],
  );

  // The switcher hides itself when there is nothing to switch to, so this is
  // one cheap request per shell mount for every user.
  useEffect(() => {
    void dispatch(loadWorkspaces());
  }, [dispatch]);

  const onSubmit = (event: FormEvent) => {
    event.preventDefault();
    const needle = query.trim().toLowerCase();
    if (!needle) return;
    const match =
      targets.find((item) => item.label.toLowerCase() === needle) ??
      targets.find((item) => item.label.toLowerCase().includes(needle));
    if (match) {
      navigate(match.to);
      setQuery('');
    }
  };

  return (
    <header className="flex h-14 min-w-0 items-center gap-2 border-b px-3">
      <Button
        variant="ghost"
        size="icon"
        onClick={toggleSidebar}
        aria-label={t('shell.collapse')}
      >
        <PanelLeft className="rtl:scale-x-[-1]" />
      </Button>
      <Separator orientation="vertical" className="mx-1 h-6" />

      <form onSubmit={onSubmit} className="relative hidden max-w-sm flex-1 sm:block">
        <Search
          aria-hidden="true"
          className="pointer-events-none absolute start-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground"
        />
        <Input
          type="search"
          list="app-topbar-jump"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder={t('shell.search')}
          aria-label={t('shell.search')}
          className="ps-8"
        />
        <datalist id="app-topbar-jump">
          {targets.map((item) => (
            <option key={item.to} value={item.label} />
          ))}
        </datalist>
      </form>

      <div className="ms-auto flex shrink-0 items-center gap-1">
        <WorkspaceSwitcher />
        <LanguageSwitcher className="hidden lg:block" />
        <ThemeToggle />
        <InvitationInbox />

        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              variant="ghost"
              size="icon"
              className="rounded-full"
              aria-label={t('shell.account')}
            >
              <Avatar className="size-8">
                {user?.image ? <AvatarImage src={user.image} alt="" /> : null}
                <AvatarFallback>{initialsOf(user?.name, user?.email)}</AvatarFallback>
              </Avatar>
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-52">
            <DropdownMenuLabel className="truncate">
              {user?.name || user?.email || t('shell.account')}
            </DropdownMenuLabel>
            <DropdownMenuSeparator />
            <DropdownMenuItem asChild>
              <Link to="/profile">{t('shell.profile')}</Link>
            </DropdownMenuItem>
            <DropdownMenuItem asChild>
              <Link to="/settings/notifications">{t('shell.notifications')}</Link>
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem asChild>
              <a href={buildBugReportHref({ routePattern })} target="_blank" rel="noopener noreferrer">
                <Bug aria-hidden="true" />{t('feedback.reportBug')}
              </a>
            </DropdownMenuItem>
            <DropdownMenuItem asChild>
              <Link to="/logout">{t('shell.signOut')}</Link>
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </header>
  );
};

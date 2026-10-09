import { useEffect } from 'react';
import { Bug, PanelLeft } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router-dom';
import { useAuthSession } from '@features/auth';
import { InvitationInbox } from '@features/team';
import { WorkspaceSwitcher, loadWorkspaces } from '@features/workspace';
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
import { Separator } from '@shared/ui/separator';
import { useSidebar } from '@shared/ui/sidebar';
import { useAppDispatch } from '@shared/hooks/redux';
import { buildBugReportHref } from '@shared/feedback/bugReport';
import { useRoutePattern } from '@shared/feedback/useRoutePattern';
import { AppSearch } from './AppSearch';
import { ThemeToggle } from './ThemeToggle';

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
 * App shell topbar (SPEC-03) — collapse toggle, app search, theme + locale
 * controls, notifications, and the account menu. All labels localized. The
 * search (`AppSearch`) is built from the same nav config as the sidebar.
 */
export const AppTopbar = () => {
  const { t } = useTranslation('common');
  const routePattern = useRoutePattern();
  const dispatch = useAppDispatch();
  const { toggleSidebar } = useSidebar();
  const { user } = useAuthSession();

  // The switcher hides itself when there is nothing to switch to, so this is
  // one cheap request per shell mount for every user.
  useEffect(() => {
    void dispatch(loadWorkspaces());
  }, [dispatch]);

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

      <AppSearch />

      <div className="ms-auto flex shrink-0 items-center gap-1">
        <WorkspaceSwitcher />
        <LanguageSwitcher className="hidden md:block" />
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

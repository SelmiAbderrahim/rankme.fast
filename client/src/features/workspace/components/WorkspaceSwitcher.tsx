import { Building2, Check, ChevronsUpDown } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { useAppDispatch, useAppSelector } from '@shared/hooks/redux';
import { Badge } from '@shared/ui/badge';
import { Button } from '@shared/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@shared/ui/dropdown-menu';
import { setActiveWorkspace } from '../store/slice';
import {
  selectActiveWorkspace,
  selectHasMultipleWorkspaces,
  selectWorkspaces,
} from '../store/selectors';

/**
 * The one workspace switcher (`rankme-enterprise-orgs` 02), composed into the
 * shared `AppTopbar`. Hidden entirely when the user belongs to a single
 * workspace, so ordinary single-account users see no new chrome.
 *
 * Switching persists the selection and then performs a FULL page reload. The
 * tradeoff is deliberate: every feature slice holds data scoped to the old
 * workspace, and a reload re-fetches all of it under the new context. The
 * alternative — a per-slice invalidation matrix — would need a correct entry
 * for every current and future feature, and one missed entry silently shows
 * one workspace's data inside another.
 */
export const WorkspaceSwitcher = () => {
  const { t } = useTranslation('team');
  const dispatch = useAppDispatch();
  const workspaces = useAppSelector(selectWorkspaces);
  const active = useAppSelector(selectActiveWorkspace);
  const hasMultiple = useAppSelector(selectHasMultipleWorkspaces);

  if (!hasMultiple) return null;

  const onSelect = (accountId: string, isOwn: boolean) => {
    const next = isOwn ? null : accountId;
    dispatch(setActiveWorkspace(next));
    globalThis.location?.reload();
  };

  return (
    // Non-modal: Radix's modal mode marks the entire page `aria-hidden` while
    // the menu is open, which axe reports as `aria-hidden-focus` against every
    // still-focusable control behind it. A workspace picker is navigational
    // rather than modal, so nothing is lost by leaving the page addressable.
    <DropdownMenu modal={false}>
      <DropdownMenuTrigger asChild>
        <Button
          variant="outline"
          size="sm"
          className="max-w-[14rem] gap-2"
          aria-label={t('workspace.switcherLabel')}
        >
          <Building2 aria-hidden="true" className="size-4 shrink-0" />
          <span className="truncate">{active?.label ?? t('workspace.own')}</span>
          <ChevronsUpDown aria-hidden="true" className="size-4 shrink-0 opacity-60" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-64">
        <DropdownMenuLabel>{t('workspace.switcherLabel')}</DropdownMenuLabel>
        <DropdownMenuSeparator />
        {workspaces.map((workspace) => {
          const isActive = workspace.accountId === active?.accountId;
          return (
            <DropdownMenuItem
              key={workspace.accountId}
              onSelect={() => onSelect(workspace.accountId, workspace.isOwn)}
              aria-current={isActive ? 'true' : undefined}
              className="gap-2"
            >
              <Check
                aria-hidden="true"
                className={`size-4 shrink-0 ${isActive ? 'opacity-100' : 'opacity-0'}`}
              />
              <span className="min-w-0 flex-1 truncate">{workspace.label}</span>
              <Badge variant="secondary" className="shrink-0 rounded-full">
                {t(`workspace.role.${workspace.role}`)}
              </Badge>
            </DropdownMenuItem>
          );
        })}
      </DropdownMenuContent>
    </DropdownMenu>
  );
};

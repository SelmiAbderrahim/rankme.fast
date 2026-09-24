import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { MoreHorizontal } from 'lucide-react';
import { StatusChip } from '@shared/ui/status-chip';
import { Button } from '@shared/ui/button';
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@shared/ui/alert-dialog';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@shared/ui/dropdown-menu';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@shared/ui/table';
import type { TeamMember } from '../types';

export interface TeamMembersTableProps {
  members: TeamMember[];
  removingId: string | null;
  onRemove?: (member: TeamMember) => void | Promise<unknown>;
  onEdit?: (member: TeamMember) => void;
  onResend?: (member: TeamMember) => void | Promise<unknown>;
  updatingId?: string | null;
  resendingId?: string | null;
  ownMemberId?: string | null;
}

const formatDate = (iso: string, locale: string): string =>
  new Intl.DateTimeFormat(locale, { dateStyle: 'medium' }).format(new Date(iso));

const isExpired = (member: TeamMember): boolean =>
  member.status === 'pending' && new Date(member.expiresAt).getTime() <= Date.now();

export const TeamMembersTable = ({
  members,
  removingId,
  onRemove,
  onEdit,
  onResend,
  updatingId = null,
  resendingId = null,
  ownMemberId = null,
}: TeamMembersTableProps) => {
  const { t, i18n } = useTranslation('team');
  const [pendingRemove, setPendingRemove] = useState<TeamMember | null>(null);
  const isRevoke = pendingRemove?.status === 'pending';
  const confirmScope = isRevoke ? 'members.confirmRevoke' : 'members.confirmRemove';

  const confirmRemove = async (member: TeamMember) => {
    await onRemove?.(member);
    setPendingRemove(null);
  };

  return (
    <div className="overflow-x-auto rounded-xl border">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>{t('members.columns.email')}</TableHead>
            <TableHead>{t('members.columns.role')}</TableHead>
            <TableHead>{t('members.columns.status')}</TableHead>
            <TableHead>{t('members.columns.access')}</TableHead>
            <TableHead className="text-end">{t('members.columns.invitedAt')}</TableHead>
            <TableHead className="text-end">{t('members.columns.expiresAt')}</TableHead>
            <TableHead className="w-10">
              <span className="sr-only">{t('members.actions.menuLabel')}</span>
            </TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {members.map((member) => {
            const isPending = member.status === 'pending';
            const isOwner = member.role === 'owner';
            const canRemove = Boolean(
              onRemove && (ownMemberId === null || member.id === ownMemberId),
            );
            const hasActions = Boolean(
              !isOwner && (onEdit || (onResend && isPending) || canRemove),
            );
            const siteAccess = member.siteAccess ?? { mode: 'all' as const, siteIds: [] };
            return (
              <TableRow key={member.id}>
                <TableCell className="font-medium">{member.email}</TableCell>
                <TableCell className="text-muted-foreground">
                  {t(`members.roles.${member.role}`)}
                </TableCell>
                <TableCell>
                  {isPending && isExpired(member) ? (
                    <StatusChip tone="destructive">{t('members.status.expired')}</StatusChip>
                  ) : isPending ? (
                    <StatusChip tone="warning">{t('members.status.pending')}</StatusChip>
                  ) : (
                    <StatusChip tone="success">{t('members.status.accepted')}</StatusChip>
                  )}
                </TableCell>
                <TableCell className="text-muted-foreground">
                  {isOwner || siteAccess.mode === 'all'
                    ? t('access.all')
                    : t('access.siteCount', { count: siteAccess.siteIds.length })}
                </TableCell>
                <TableCell className="text-end text-muted-foreground">
                  {formatDate(member.invitedAt, i18n.language)}
                </TableCell>
                <TableCell className="text-end text-muted-foreground">
                  {isPending ? formatDate(member.expiresAt, i18n.language) : '—'}
                </TableCell>
                <TableCell>
                  {!hasActions ? null : (
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <Button
                          variant="ghost"
                          size="icon"
                          aria-label={t('members.actions.menuLabel')}
                          disabled={removingId === member.id || updatingId === member.id}
                          data-testid={`member-actions-${member.id}`}
                        >
                          <MoreHorizontal aria-hidden="true" />
                        </Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end">
                        <DropdownMenuGroup>
                          {onEdit ? (
                            <DropdownMenuItem onSelect={() => onEdit(member)}>
                              {t('members.actions.editAccess')}
                            </DropdownMenuItem>
                          ) : null}
                          {onResend && isPending ? (
                            <DropdownMenuItem
                              disabled={resendingId === member.id}
                              onSelect={() => void onResend(member)}
                            >
                              {t('members.actions.resend')}
                            </DropdownMenuItem>
                          ) : null}
                          {canRemove ? (
                            <DropdownMenuItem
                              variant="destructive"
                              onSelect={() => setPendingRemove(member)}
                            >
                              {member.id === ownMemberId
                                ? t('members.actions.leave')
                                : isPending
                                  ? t('members.actions.revoke')
                                  : t('members.actions.remove')}
                            </DropdownMenuItem>
                          ) : null}
                        </DropdownMenuGroup>
                      </DropdownMenuContent>
                    </DropdownMenu>
                  )}
                </TableCell>
              </TableRow>
            );
          })}
        </TableBody>
      </Table>

      {pendingRemove ? (
        <AlertDialog open onOpenChange={() => setPendingRemove(null)}>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>{t(`${confirmScope}.title`)}</AlertDialogTitle>
              <AlertDialogDescription>
                {t(`${confirmScope}.body`, { email: pendingRemove.email })}
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>{t('members.confirmRemove.cancel')}</AlertDialogCancel>
              <Button
                variant="destructive"
                loading={removingId === pendingRemove.id}
                loadingLabel={t(`${confirmScope}.confirm`)}
                onClick={() => void confirmRemove(pendingRemove)}
                data-testid="member-remove-confirm"
              >
                {t(`${confirmScope}.confirm`)}
              </Button>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      ) : null}
    </div>
  );
};

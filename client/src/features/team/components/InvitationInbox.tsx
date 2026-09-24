import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Bell } from 'lucide-react';
import { loadWorkspaces } from '@features/workspace';
import { useAppDispatch, useAppSelector } from '@shared/hooks/redux';
import { Alert, AlertDescription } from '@shared/ui/alert';
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@shared/ui/alert-dialog';
import { Badge } from '@shared/ui/badge';
import { Button } from '@shared/ui/button';
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from '@shared/ui/card';
import { Empty, EmptyDescription, EmptyHeader, EmptyTitle } from '@shared/ui/empty';
import { ScrollArea } from '@shared/ui/scroll-area';
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from '@shared/ui/sheet';
import { Skeleton } from '@shared/ui/skeleton';
import {
  acceptPendingInvitation,
  loadPendingInvitations,
  rejectPendingInvitation,
  selectInvitationInboxActionId,
  selectInvitationInboxError,
  selectInvitationInboxStatus,
  selectPendingInvitationCount,
  selectPendingInvitations,
} from '../store/inboxSlice';
import type { PendingInvitation } from '../types';

const POLL_INTERVAL_MS = 60_000;

export const InvitationInbox = () => {
  const { t, i18n } = useTranslation('team');
  const dispatch = useAppDispatch();
  const invitations = useAppSelector(selectPendingInvitations);
  const count = useAppSelector(selectPendingInvitationCount);
  const status = useAppSelector(selectInvitationInboxStatus);
  const actionId = useAppSelector(selectInvitationInboxActionId);
  const error = useAppSelector(selectInvitationInboxError);
  const [open, setOpen] = useState(false);
  const [pendingReject, setPendingReject] = useState<PendingInvitation | null>(null);

  useEffect(() => {
    void dispatch(loadPendingInvitations());
    const refresh = () => { void dispatch(loadPendingInvitations()); };
    globalThis.addEventListener?.('focus', refresh);
    const interval = globalThis.setInterval(refresh, POLL_INTERVAL_MS);
    return () => {
      globalThis.removeEventListener?.('focus', refresh);
      globalThis.clearInterval(interval);
    };
  }, [dispatch]);

  const accept = async (invitation: PendingInvitation) => {
    const result = await dispatch(acceptPendingInvitation(invitation.id));
    if (acceptPendingInvitation.fulfilled.match(result)) {
      await dispatch(loadWorkspaces());
      if (invitations.length === 1) setOpen(false);
    }
  };

  const reject = async (invitation: PendingInvitation) => {
    await dispatch(rejectPendingInvitation(invitation.id));
    // Keep mutation errors in the sheet's live region instead of obscuring
    // them behind the confirmation layer.
    setPendingReject(null);
  };

  return (
    <>
      <Sheet open={open} onOpenChange={(next) => {
        setOpen(next);
        if (next) void dispatch(loadPendingInvitations());
      }}>
        <SheetTrigger asChild>
          <Button
            variant="ghost"
            size="icon"
            className="relative"
            aria-label={count > 0
              ? t('inbox.buttonLabelWithCount', { count })
              : t('inbox.buttonLabel')}
          >
            <Bell />
            {count > 0 ? (
              <Badge aria-hidden="true" className="absolute -end-2 -top-2 min-w-5 px-1">
                {count > 99 ? '99+' : count}
              </Badge>
            ) : null}
          </Button>
        </SheetTrigger>
        <SheetContent side={i18n.dir() === 'rtl' ? 'left' : 'right'} className="sm:max-w-md">
          <SheetHeader>
            <SheetTitle>{t('inbox.title')}</SheetTitle>
            <SheetDescription>{t('inbox.description')}</SheetDescription>
          </SheetHeader>
          <ScrollArea className="min-h-0 flex-1 px-4 pb-4">
            {error ? (
              <Alert variant="destructive" role="alert" className="mb-4">
                <AlertDescription>{error}</AlertDescription>
              </Alert>
            ) : null}
            {status === 'loading' ? (
              <div className="flex flex-col gap-3" aria-busy="true">
                <Skeleton className="h-36 w-full" />
                <Skeleton className="h-36 w-full" />
              </div>
            ) : invitations.length === 0 ? (
              <Empty>
                <EmptyHeader>
                  <EmptyTitle>{t('inbox.emptyTitle')}</EmptyTitle>
                  <EmptyDescription>{t('inbox.empty')}</EmptyDescription>
                </EmptyHeader>
              </Empty>
            ) : (
              <div className="flex flex-col gap-3">
                {invitations.map((invitation) => {
                  const siteLabels = invitation.siteAccess.sites?.map((site) => site.label) ?? [];
                  const access = invitation.siteAccess.mode === 'all'
                    ? t('access.all')
                    : siteLabels.length > 0
                      ? siteLabels.join(', ')
                      : t('access.siteCount', { count: invitation.siteAccess.siteIds.length });
                  const busy = actionId === invitation.id;
                  return (
                    <Card key={invitation.id}>
                      <CardHeader>
                        <CardTitle className="text-base">{invitation.teamName}</CardTitle>
                        <CardDescription>
                          {t('inbox.invitedBy', { inviter: invitation.inviterName })}
                        </CardDescription>
                      </CardHeader>
                      <CardContent>
                        <p className="text-sm">
                          {t('inbox.summary', {
                            role: t(`members.roles.${invitation.role}`),
                            access,
                            date: new Intl.DateTimeFormat(i18n.language, { dateStyle: 'medium' })
                              .format(new Date(invitation.expiresAt)),
                          })}
                        </p>
                      </CardContent>
                      <CardFooter className="gap-2">
                        <Button
                          size="sm"
                          loading={busy}
                          loadingLabel={t('inbox.accepting')}
                          disabled={invitation.requiresPasswordChange || Boolean(actionId)}
                          onClick={() => void accept(invitation)}
                        >
                          {t('inbox.accept')}
                        </Button>
                        <Button
                          size="sm"
                          variant="outline"
                          disabled={Boolean(actionId)}
                          onClick={() => setPendingReject(invitation)}
                        >
                          {t('inbox.reject')}
                        </Button>
                      </CardFooter>
                    </Card>
                  );
                })}
              </div>
            )}
          </ScrollArea>
        </SheetContent>
      </Sheet>

      <AlertDialog open={pendingReject !== null} onOpenChange={() => setPendingReject(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t('inbox.rejectTitle')}</AlertDialogTitle>
            <AlertDialogDescription>
              {t('inbox.rejectBody', { team: pendingReject?.teamName ?? '' })}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t('inbox.cancel')}</AlertDialogCancel>
            <Button
              variant="destructive"
              loading={pendingReject?.id === actionId}
              loadingLabel={t('inbox.rejecting')}
              onClick={() => void reject(pendingReject!)}
            >
              {t('inbox.reject')}
            </Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
};

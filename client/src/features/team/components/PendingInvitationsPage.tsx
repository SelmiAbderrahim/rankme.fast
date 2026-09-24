import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import { authClient, useAuthSession } from '@features/auth';
import { loadWorkspaces, setActiveWorkspace } from '@features/workspace';
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
import { Button } from '@shared/ui/button';
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from '@shared/ui/card';
import { Empty, EmptyDescription, EmptyHeader, EmptyTitle } from '@shared/ui/empty';
import { Skeleton } from '@shared/ui/skeleton';
import {
  acceptPendingInvitation,
  loadPendingInvitations,
  rejectPendingInvitation,
  selectInvitationInboxActionId,
  selectInvitationInboxError,
  selectInvitationInboxStatus,
  selectPendingInvitations,
} from '../store/inboxSlice';
import type { PendingInvitation } from '../types';

export const PendingInvitationsPage = () => {
  const { t, i18n } = useTranslation('team');
  const dispatch = useAppDispatch();
  const navigate = useNavigate();
  const session = useAuthSession();
  const invitations = useAppSelector(selectPendingInvitations);
  const status = useAppSelector(selectInvitationInboxStatus);
  const actionId = useAppSelector(selectInvitationInboxActionId);
  const error = useAppSelector(selectInvitationInboxError);
  const [pendingReject, setPendingReject] = useState<PendingInvitation | null>(null);

  useEffect(() => {
    void dispatch(loadPendingInvitations());
  }, [dispatch]);

  const accept = async (invitation: PendingInvitation) => {
    const result = await dispatch(acceptPendingInvitation(invitation.id));
    if (!acceptPendingInvitation.fulfilled.match(result)) return;
    await session.refetch?.();
    await dispatch(loadWorkspaces());
    dispatch(setActiveWorkspace(invitation.teamId));
    navigate('/dashboard', { replace: true });
  };

  const reject = async (invitation: PendingInvitation) => {
    const lastInvitation = invitations.length === 1;
    const result = await dispatch(rejectPendingInvitation(invitation.id));
    if (!rejectPendingInvitation.fulfilled.match(result)) {
      setPendingReject(null);
      return;
    }
    setPendingReject(null);
    if (lastInvitation && session.provisionalAccount) {
      // The server may have removed the still-unclaimed identity and session.
      await authClient.signOut().catch(() => undefined);
      navigate('/login', { replace: true });
    }
  };

  return (
    <main className="mx-auto flex w-full max-w-2xl flex-col gap-6 px-4 py-10">
      <header className="flex flex-col gap-2">
        <h1 className="text-2xl font-semibold">{t('inbox.title')}</h1>
        <p className="text-muted-foreground">{t('inbox.description')}</p>
      </header>
      {error ? <Alert variant="destructive" role="alert"><AlertDescription>{error}</AlertDescription></Alert> : null}
      {status === 'loading' || status === 'idle' ? (
        <div className="flex flex-col gap-3" aria-busy="true">
          <Skeleton className="h-40 w-full" />
          <Skeleton className="h-40 w-full" />
        </div>
      ) : invitations.length === 0 ? (
        <Empty>
          <EmptyHeader>
            <EmptyTitle>{t('inbox.emptyTitle')}</EmptyTitle>
            <EmptyDescription>{t('inbox.empty')}</EmptyDescription>
          </EmptyHeader>
        </Empty>
      ) : (
        <div className="flex flex-col gap-4">
          {invitations.map((invitation) => {
            const labels = invitation.siteAccess.sites?.map((site) => site.label) ?? [];
            const access = invitation.siteAccess.mode === 'all'
              ? t('access.all')
              : labels.length > 0
                ? labels.join(', ')
                : t('access.siteCount', { count: invitation.siteAccess.siteIds.length });
            const busy = invitation.id === actionId;
            return (
              <Card key={invitation.id}>
                <CardHeader>
                  <CardTitle>{invitation.teamName}</CardTitle>
                  <CardDescription>{t('inbox.invitedBy', { inviter: invitation.inviterName })}</CardDescription>
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
                    variant="outline"
                    loading={busy}
                    loadingLabel={t('inbox.accepting')}
                    disabled={invitation.requiresPasswordChange || Boolean(actionId)}
                    onClick={() => void accept(invitation)}
                  >
                    {t('inbox.accept')}
                  </Button>
                  <Button variant="destructive" disabled={Boolean(actionId)} onClick={() => setPendingReject(invitation)}>
                    {t('inbox.reject')}
                  </Button>
                </CardFooter>
              </Card>
            );
          })}
        </div>
      )}

      <AlertDialog open={pendingReject !== null} onOpenChange={() => setPendingReject(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t('inbox.rejectTitle')}</AlertDialogTitle>
            <AlertDialogDescription>{t('inbox.rejectBody', { team: pendingReject?.teamName ?? '' })}</AlertDialogDescription>
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
    </main>
  );
};

import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { useAuthSession } from '@features/auth';
import { loginHrefForReturnTo, requiredPasswordChangeHref } from '@features/auth/intent';
import { writeStoredWorkspaceId } from '@features/workspace';
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
import { Skeleton } from '@shared/ui/skeleton';
import {
  acceptInviteRequest,
  fetchInvitationPreviewRequest,
  rejectInviteRequest,
} from '../api';
import { teamErrorMessage } from '../errorMessage';
import type { InvitationPreviewResponse } from '../types';

interface InviteDecisionPageProps {
  action: 'accept' | 'reject';
}

const safeTokenPath = (action: 'accept' | 'reject', token: string): string =>
  `/team/${action}/${encodeURIComponent(token)}`;

export const InviteDecisionPage = ({ action }: InviteDecisionPageProps) => {
  const { t, i18n } = useTranslation('team');
  const { token = '' } = useParams<{ token: string }>();
  const { authenticated, mustChangePassword, refetch } = useAuthSession();
  const [preview, setPreview] = useState<InvitationPreviewResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [acting, setActing] = useState(false);
  const [confirmReject, setConfirmReject] = useState(false);
  const [error, setError] = useState('');
  const [complete, setComplete] = useState(false);
  const returnTo = safeTokenPath(action, token);

  // GET is deliberately preview-only. Mail scanners and component mounts can
  // visit this route without accepting, rejecting, or deleting anything.
  useEffect(() => {
    let active = true;
    if (!token) {
      setError(t('errors.inviteNotFound'));
      setLoading(false);
      return;
    }
    void fetchInvitationPreviewRequest(token)
      .then((response) => {
        if (!active) return;
        if (response.action !== action) {
          setError(t('errors.inviteNotFound'));
          return;
        }
        setPreview(response);
      })
      .catch((reason) => {
        if (active) setError(teamErrorMessage(reason, 'team:errors.inviteNotFound'));
      })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [action, t, token]);

  const decide = async (decision: InvitationPreviewResponse) => {
    setActing(true);
    setError('');
    try {
      if (action === 'accept') {
        await acceptInviteRequest(token);
        writeStoredWorkspaceId(decision.invitation.teamId);
        await refetch?.();
      } else {
        await rejectInviteRequest(token);
      }
      setComplete(true);
      setConfirmReject(false);
    } catch (reason) {
      setError(teamErrorMessage(
        reason,
        action === 'accept' ? 'team:errors.inviteNotFound' : 'team:errors.rejectFailed',
      ));
      // The error belongs to the decision card. Closing the confirmation makes
      // it visible to assistive technology and lets the recipient retry.
      if (action === 'reject') setConfirmReject(false);
    } finally {
      setActing(false);
    }
  };

  if (loading) {
    return (
      <main className="mx-auto flex w-full max-w-lg flex-col gap-3 px-4 py-10" aria-busy="true">
        <p className="text-muted-foreground text-sm">{t('decision.loading')}</p>
        <Skeleton className="h-44 w-full" />
      </main>
    );
  }

  // A preview/load failure cannot render invitation details. Mutation errors
  // happen after a valid preview and must keep the decision controls visible
  // so the recipient can retry without reloading the email link.
  if (!preview) {
    return (
      <main className="mx-auto w-full max-w-lg px-4 py-10">
        <Alert variant="destructive" role="alert">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      </main>
    );
  }

  const { invitation } = preview;
  const selectedSiteLabels = invitation.siteAccess.sites?.map((site) => site.label) ?? [];
  const accessText = invitation.siteAccess.mode === 'all'
    ? t('access.all')
    : selectedSiteLabels.length > 0
      ? selectedSiteLabels.join(', ')
      : t('access.siteCount', { count: invitation.siteAccess.siteIds.length });

  if (complete) {
    return (
      <main className="mx-auto w-full max-w-lg px-4 py-10">
        <Card>
          <CardHeader>
            <CardTitle><h1>{t(`decision.${action}.completeTitle`)}</h1></CardTitle>
          </CardHeader>
          <CardContent>
            <Alert role="status"><AlertDescription>{t(`decision.${action}.complete`)}</AlertDescription></Alert>
          </CardContent>
          <CardFooter>
            <Button asChild>
              <Link
                to={action === 'accept' ? '/dashboard' : '/'}
                reloadDocument={action === 'accept'}
              >
                {t(`decision.${action}.cta`)}
              </Link>
            </Button>
          </CardFooter>
        </Card>
      </main>
    );
  }

  return (
    <main className="mx-auto w-full max-w-lg px-4 py-10">
      <Card>
        <CardHeader>
          <CardTitle><h1>{t(`decision.${action}.title`)}</h1></CardTitle>
          <CardDescription>
            {t('decision.invitedBy', { inviter: invitation.inviterName, team: invitation.teamName })}
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-2 text-sm">
            <dt className="text-muted-foreground">{t('decision.role')}</dt>
            <dd>{t(`members.roles.${invitation.role}`)}</dd>
            <dt className="text-muted-foreground">{t('decision.sites')}</dt>
            <dd>{accessText}</dd>
            <dt className="text-muted-foreground">{t('decision.expires')}</dt>
            <dd>{new Intl.DateTimeFormat(i18n.language, { dateStyle: 'long' }).format(new Date(invitation.expiresAt))}</dd>
          </dl>
          {error ? <Alert variant="destructive" role="alert"><AlertDescription>{error}</AlertDescription></Alert> : null}
          {action === 'accept' && !authenticated ? (
            <Alert><AlertDescription>{t('decision.accept.signInRequired')}</AlertDescription></Alert>
          ) : null}
          {action === 'accept' && authenticated && mustChangePassword ? (
            <Alert><AlertDescription>{t('decision.accept.passwordRequired')}</AlertDescription></Alert>
          ) : null}
        </CardContent>
        <CardFooter className="flex-wrap gap-2">
          {action === 'accept' && !authenticated ? (
            <Button asChild><Link to={loginHrefForReturnTo(returnTo)}>{t('decision.accept.signIn')}</Link></Button>
          ) : action === 'accept' && mustChangePassword ? (
            <Button asChild><Link to={requiredPasswordChangeHref(returnTo)}>{t('decision.accept.changePassword')}</Link></Button>
          ) : action === 'accept' ? (
            <Button loading={acting} loadingLabel={t('decision.accept.acting')} onClick={() => void decide(preview)}>
              {t('decision.accept.confirm')}
            </Button>
          ) : (
            <Button variant="destructive" onClick={() => setConfirmReject(true)}>
              {t('decision.reject.confirm')}
            </Button>
          )}
        </CardFooter>
      </Card>

      <AlertDialog open={confirmReject} onOpenChange={setConfirmReject}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t('decision.reject.dialogTitle')}</AlertDialogTitle>
            <AlertDialogDescription>{t('decision.reject.dialogBody')}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t('decision.reject.cancel')}</AlertDialogCancel>
            <Button variant="destructive" loading={acting} loadingLabel={t('decision.reject.acting')} onClick={() => void decide(preview)}>
              {t('decision.reject.confirm')}
            </Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </main>
  );
};

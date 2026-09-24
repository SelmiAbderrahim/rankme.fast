import { useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Search } from 'lucide-react';
import { useAuthSession } from '@features/auth';
import {
  selectActiveWorkspace,
  selectActiveWorkspaceRole,
  selectIsForeignWorkspace,
} from '@features/workspace';
import { PageHeader } from '@shared/components/PageHeader';
import { useAppDispatch, useAppSelector } from '@shared/hooks/redux';
import { APP_PAGE_ICONS } from '@shared/navigation/appPageIcons';
import { Alert, AlertDescription } from '@shared/ui/alert';
import { Button } from '@shared/ui/button';
import { Empty, EmptyDescription, EmptyHeader, EmptyTitle } from '@shared/ui/empty';
import { Input } from '@shared/ui/input';
import { Skeleton } from '@shared/ui/skeleton';
import { fetchGrantableSitesRequest } from '../api';
import {
  loadTeam,
  removeTeamMember,
  resendTeamInvite,
  updateTeamMember,
} from '../store/thunks';
import { setTeamPage, setTeamQuery } from '../store/slice';
import {
  selectTeamLoadError,
  selectTeamLoaded,
  selectTeamLoading,
  selectTeamMessage,
  selectTeamMeta,
  selectTeamOverview,
  selectTeamPage,
  selectTeamQuery,
  selectTeamRemoveError,
  selectTeamRemovingId,
  selectTeamResendError,
  selectTeamResendingId,
  selectTeamUpdateError,
  selectTeamUpdatingId,
} from '../store/selectors';
import type { TeamMember, TeamSiteOption, UpdateTeamMemberInput } from '../types';
import { EditMemberAccessDialog } from './EditMemberAccessDialog';
import { InviteMemberForm } from './InviteMemberForm';
import { TeamMembersTable } from './TeamMembersTable';

export const TeamPage = () => {
  const { t } = useTranslation('team');
  const dispatch = useAppDispatch();
  const overview = useAppSelector(selectTeamOverview);
  const loading = useAppSelector(selectTeamLoading);
  const loaded = useAppSelector(selectTeamLoaded);
  const loadError = useAppSelector(selectTeamLoadError);
  const removingId = useAppSelector(selectTeamRemovingId);
  const removeError = useAppSelector(selectTeamRemoveError);
  const message = useAppSelector(selectTeamMessage);
  const meta = useAppSelector(selectTeamMeta);
  const query = useAppSelector(selectTeamQuery);
  const page = useAppSelector(selectTeamPage);
  const resendingId = useAppSelector(selectTeamResendingId);
  const resendError = useAppSelector(selectTeamResendError);
  const updatingId = useAppSelector(selectTeamUpdatingId);
  const updateError = useAppSelector(selectTeamUpdateError);
  const workspaceRole = useAppSelector(selectActiveWorkspaceRole);
  const activeWorkspace = useAppSelector(selectActiveWorkspace);
  const isForeignWorkspace = useAppSelector(selectIsForeignWorkspace);
  const { user } = useAuthSession();
  const [draftQuery, setDraftQuery] = useState(query);
  const [sites, setSites] = useState<TeamSiteOption[]>([]);
  const [sitesLoading, setSitesLoading] = useState(false);
  const [sitesError, setSitesError] = useState('');
  const [editingMember, setEditingMember] = useState<TeamMember | null>(null);

  const canManageRoles = workspaceRole === 'owner';
  const canManageTeam = workspaceRole === 'owner' || workspaceRole === 'admin';
  const canGrantAllSites = workspaceRole === 'owner' || activeWorkspace?.siteAccess?.mode === 'all';

  useEffect(() => {
    if (draftQuery === query) return;
    const handle = setTimeout(() => dispatch(setTeamQuery(draftQuery)), 300);
    return () => clearTimeout(handle);
  }, [dispatch, draftQuery, query]);

  const requestKey = `${query}|${page}`;
  const lastRequestKey = useRef<string | null>(null);
  useEffect(() => {
    if (lastRequestKey.current === requestKey) return;
    const isFirstRun = lastRequestKey.current === null;
    lastRequestKey.current = requestKey;
    if (isFirstRun && (loaded || loading || loadError)) return;
    void dispatch(loadTeam({ query: query || undefined, page }));
  }, [dispatch, loadError, loaded, loading, page, query, requestKey]);

  useEffect(() => {
    if (!canManageTeam) return;
    let active = true;
    setSitesLoading(true);
    setSitesError('');
    void fetchGrantableSitesRequest()
      .then((result) => { if (active) setSites(result); })
      .catch(() => { if (active) setSitesError(t('access.loadFailed')); })
      .finally(() => { if (active) setSitesLoading(false); });
    return () => { active = false; };
  }, [canManageTeam, t]);

  const members = useMemo(() => overview?.members ?? [], [overview]);
  const ownMemberId = useMemo(() => {
    if (!isForeignWorkspace || canManageTeam) return null;
    return members.find((row) => row.userId === user?.id)?.id ?? null;
  }, [canManageTeam, isForeignWorkspace, members, user?.id]);

  const saveMember = async (input: UpdateTeamMemberInput) => {
    const result = await dispatch(updateTeamMember(input));
    if (updateTeamMember.fulfilled.match(result)) setEditingMember(null);
  };

  if (loading && !loaded) {
    return (
      <div className="px-4 py-8" aria-busy="true" aria-live="polite">
        <p className="text-muted-foreground mb-4 text-sm">{t('members.loading')}</p>
        <div className="flex flex-col gap-3">
          <Skeleton className="h-8 w-full" data-testid="team-skeleton" />
          <Skeleton className="h-8 w-full" />
          <Skeleton className="h-8 w-2/3" />
        </div>
      </div>
    );
  }

  if (loadError) {
    return (
      <div className="px-4 py-8">
        <Alert variant="destructive" role="alert"><AlertDescription>{loadError}</AlertDescription></Alert>
        <Button variant="outline" className="mt-4" onClick={() => void dispatch(loadTeam())}>
          {t('common:retry')}
        </Button>
      </div>
    );
  }

  const totalPages = meta ? Math.max(1, Math.ceil(meta.total / meta.pageSize)) : 1;

  return (
    <div className="flex flex-col gap-8 px-4 py-8">
      <PageHeader
        icon={APP_PAGE_ICONS.team}
        title={t('title')}
        description={t('description')}
      />
      {message ? <Alert role="status"><AlertDescription>{message}</AlertDescription></Alert> : null}
      {removeError || resendError || updateError ? (
        <Alert variant="destructive" role="alert">
          <AlertDescription>{removeError || resendError || updateError}</AlertDescription>
        </Alert>
      ) : null}
      <section className="flex flex-col gap-4" aria-labelledby="members-heading">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2 id="members-heading" className="text-lg font-semibold">{t('members.heading')}</h2>
          <div className="relative w-full max-w-xs">
            <Search
              aria-hidden="true"
              className="pointer-events-none absolute start-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground"
            />
            <Input
              type="search"
              value={draftQuery}
              onChange={(event) => setDraftQuery(event.target.value)}
              placeholder={t('members.searchPlaceholder')}
              aria-label={t('members.searchPlaceholder')}
              className="ps-8"
            />
          </div>
        </div>
        {members.length === 0 || meta === null ? (
          <Empty>
            <EmptyHeader>
              <EmptyTitle>{t('members.empty')}</EmptyTitle>
              <EmptyDescription>{t('description')}</EmptyDescription>
            </EmptyHeader>
          </Empty>
        ) : (
          <>
            <TeamMembersTable
              members={members}
              removingId={removingId}
              onRemove={canManageTeam || ownMemberId ? (member) => dispatch(removeTeamMember(member.id)) : undefined}
              onEdit={canManageRoles ? setEditingMember : undefined}
              onResend={canManageTeam ? (member) => dispatch(resendTeamInvite(member.id)) : undefined}
              updatingId={updatingId}
              resendingId={resendingId}
              ownMemberId={ownMemberId}
            />
            <div className="flex items-center justify-between gap-3">
              <p className="text-muted-foreground text-sm" aria-live="polite">
                {t('members.pageOf', { page: meta.page, totalPages, total: meta.total })}
              </p>
              <div className="flex gap-2">
                <Button variant="outline" size="sm" disabled={meta.page <= 1} onClick={() => dispatch(setTeamPage(meta.page - 1))}>
                  {t('members.previous')}
                </Button>
                <Button variant="outline" size="sm" disabled={meta.page >= totalPages} onClick={() => dispatch(setTeamPage(meta.page + 1))}>
                  {t('members.next')}
                </Button>
              </div>
            </div>
          </>
        )}
      </section>
      {canManageTeam ? (
        <InviteMemberForm
          sites={sites}
          sitesLoading={sitesLoading}
          sitesError={sitesError}
          canInviteAdmin={canManageRoles}
          canGrantAllSites={canGrantAllSites}
        />
      ) : null}
      <EditMemberAccessDialog
        member={editingMember}
        sites={sites}
        saving={editingMember?.id === updatingId}
        onClose={() => setEditingMember(null)}
        onSave={saveMember}
      />
    </div>
  );
};

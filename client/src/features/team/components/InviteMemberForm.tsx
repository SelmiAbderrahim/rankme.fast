import { useEffect, useState, type FormEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { Alert, AlertDescription } from '@shared/ui/alert';
import { Button } from '@shared/ui/button';
import { Field, FieldError, FieldGroup, FieldLabel } from '@shared/ui/field';
import { Input } from '@shared/ui/input';
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@shared/ui/select';
import { useAppDispatch, useAppSelector } from '@shared/hooks/redux';
import { inviteTeammate } from '../store/thunks';
import {
  selectTeamInviteError,
  selectTeamInviting,
} from '../store/selectors';
import type {
  AssignableTeamRole,
  TeamSiteAccessInput,
  TeamSiteOption,
} from '../types';
import { TeamSiteAccessFields } from './TeamSiteAccessFields';

interface InviteMemberFormProps {
  sites?: readonly TeamSiteOption[];
  sitesLoading?: boolean;
  sitesError?: string;
  canInviteAdmin?: boolean;
  canGrantAllSites?: boolean;
}

export const InviteMemberForm = ({
  sites = [],
  sitesLoading = false,
  sitesError = '',
  canInviteAdmin = true,
  canGrantAllSites = true,
}: InviteMemberFormProps) => {
  const { t } = useTranslation('team');
  const dispatch = useAppDispatch();
  const inviting = useAppSelector(selectTeamInviting);
  const error = useAppSelector(selectTeamInviteError);
  const [email, setEmail] = useState('');
  const [role, setRole] = useState<AssignableTeamRole>('member');
  const [siteAccess, setSiteAccess] = useState<TeamSiteAccessInput>(
    canGrantAllSites ? { mode: 'all' } : { mode: 'selected', siteIds: [] },
  );
  const [submitted, setSubmitted] = useState(false);
  const [emailTouched, setEmailTouched] = useState(false);
  const trimmed = email.trim();
  const invalidFormat = trimmed.length > 0 && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmed);
  const selectedInvalid = siteAccess.mode === 'selected' && siteAccess.siteIds.length === 0;
  const disabled = inviting || sitesLoading;

  useEffect(() => {
    if (!canInviteAdmin && role === 'admin') setRole('member');
  }, [canInviteAdmin, role]);

  useEffect(() => {
    if (!canGrantAllSites && siteAccess.mode === 'all') {
      setSiteAccess({ mode: 'selected', siteIds: sites.slice(0, 1).map((site) => site.id) });
    }
  }, [canGrantAllSites, siteAccess.mode, sites]);

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setSubmitted(true);
    if (!trimmed || invalidFormat || selectedInvalid) return;
    const result = await dispatch(inviteTeammate({ email: trimmed, role, siteAccess }));
    if (inviteTeammate.fulfilled.match(result)) {
      setEmail('');
      setRole('member');
      setSiteAccess(canGrantAllSites
        ? { mode: 'all' }
        : { mode: 'selected', siteIds: sites.slice(0, 1).map((site) => site.id) });
      setSubmitted(false);
      setEmailTouched(false);
    }
  };

  return (
    <section aria-labelledby="invite-heading" className="flex flex-col gap-4">
      <div>
        <h2 id="invite-heading" className="text-lg font-semibold">{t('invite.heading')}</h2>
        <p className="text-muted-foreground text-sm">{t('invite.description')}</p>
      </div>
      <form onSubmit={(event) => void submit(event)} className="flex flex-col gap-6" noValidate>
        <FieldGroup>
          <Field data-invalid={(submitted || emailTouched) && (!trimmed || invalidFormat) || undefined}>
            <FieldLabel htmlFor="team-invite-email">{t('invite.emailLabel')}</FieldLabel>
            <Input
              id="team-invite-email"
              type="email"
              required
              value={email}
              disabled={disabled}
              onChange={(event) => setEmail(event.target.value)}
              onBlur={() => setEmailTouched(true)}
              placeholder={t('invite.emailPlaceholder')}
              autoComplete="email"
              aria-invalid={(submitted || emailTouched) && (!trimmed || invalidFormat) || undefined}
              aria-describedby={(submitted || emailTouched) && (!trimmed || invalidFormat)
                ? 'team-invite-email-error'
                : undefined}
            />
            {(submitted || emailTouched) && (!trimmed || invalidFormat) ? (
              <FieldError id="team-invite-email-error">{t('invite.emailInvalid')}</FieldError>
            ) : null}
          </Field>
          <Field>
            <FieldLabel htmlFor="team-invite-role">{t('invite.roleLabel')}</FieldLabel>
            <Select
              value={role}
              disabled={disabled || !canInviteAdmin}
              onValueChange={(next) => setRole(next as AssignableTeamRole)}
            >
              <SelectTrigger id="team-invite-role" className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectGroup>
                  {canInviteAdmin ? (
                    <SelectItem value="admin">{t('members.roles.admin')}</SelectItem>
                  ) : null}
                  <SelectItem value="member">{t('members.roles.member')}</SelectItem>
                </SelectGroup>
              </SelectContent>
            </Select>
            {!canInviteAdmin ? (
              <p className="text-muted-foreground text-sm">{t('invite.adminRoleLimit')}</p>
            ) : null}
          </Field>
        </FieldGroup>

        <TeamSiteAccessFields
          idPrefix="team-invite"
          value={siteAccess}
          sites={sites}
          allowAll={canGrantAllSites}
          disabled={disabled}
          showValidation={submitted}
          onChange={setSiteAccess}
        />

        {sitesError ? (
          <Alert variant="destructive" role="alert">
            <AlertDescription>{sitesError}</AlertDescription>
          </Alert>
        ) : null}
        {error ? (
          <Alert variant="destructive" role="alert"><AlertDescription>{error}</AlertDescription></Alert>
        ) : null}
        <div className="flex items-center gap-2">
          <Button
            type="submit"
            loading={inviting}
            loadingLabel={t('invite.submitting')}
            disabled={disabled || trimmed.length === 0 || Boolean(sitesError)}
          >
            {t('invite.submit')}
          </Button>
        </div>
      </form>
    </section>
  );
};

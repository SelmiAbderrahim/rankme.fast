import { useEffect, useState, type FormEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '@shared/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@shared/ui/dialog';
import { Field, FieldGroup, FieldLabel } from '@shared/ui/field';
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@shared/ui/select';
import type {
  AssignableTeamRole,
  TeamMember,
  TeamSiteAccessInput,
  TeamSiteOption,
  UpdateTeamMemberInput,
} from '../types';
import { TeamSiteAccessFields } from './TeamSiteAccessFields';

interface EditMemberAccessDialogProps {
  member: TeamMember | null;
  sites: readonly TeamSiteOption[];
  saving: boolean;
  onClose: () => void;
  onSave: (input: UpdateTeamMemberInput) => void | Promise<unknown>;
}

const editableAccess = (member: TeamMember): TeamSiteAccessInput =>
  member.siteAccess.mode === 'all'
    ? { mode: 'all' }
    : { mode: 'selected', siteIds: [...member.siteAccess.siteIds] };

export const EditMemberAccessDialog = ({
  member,
  sites,
  saving,
  onClose,
  onSave,
}: EditMemberAccessDialogProps) => {
  const { t } = useTranslation('team');
  const [role, setRole] = useState<AssignableTeamRole>('member');
  const [siteAccess, setSiteAccess] = useState<TeamSiteAccessInput>({ mode: 'all' });
  const [submitted, setSubmitted] = useState(false);

  useEffect(() => {
    if (!member || member.role === 'owner') return;
    setRole(member.role);
    setSiteAccess(editableAccess(member));
    setSubmitted(false);
  }, [member]);

  if (!member || member.role === 'owner') return null;
  const invalid = siteAccess.mode === 'selected' && siteAccess.siteIds.length === 0;

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setSubmitted(true);
    if (invalid) return;
    await onSave({ id: member.id, role, siteAccess });
  };

  return (
    <Dialog open onOpenChange={() => { if (!saving) onClose(); }}>
      <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{t('members.edit.title')}</DialogTitle>
          <DialogDescription>{t('members.edit.description', { email: member.email })}</DialogDescription>
        </DialogHeader>
        <form onSubmit={(event) => void submit(event)} className="flex flex-col gap-6">
          <FieldGroup>
            <Field>
              <FieldLabel htmlFor="team-edit-role">{t('invite.roleLabel')}</FieldLabel>
              <Select
                value={role}
                disabled={saving}
                onValueChange={(next) => setRole(next as AssignableTeamRole)}
              >
                <SelectTrigger id="team-edit-role" className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectGroup>
                    <SelectItem value="admin">{t('members.roles.admin')}</SelectItem>
                    <SelectItem value="member">{t('members.roles.member')}</SelectItem>
                  </SelectGroup>
                </SelectContent>
              </Select>
            </Field>
          </FieldGroup>
          <TeamSiteAccessFields
            idPrefix={`team-edit-${member.id}`}
            value={siteAccess}
            sites={sites}
            allowAll
            disabled={saving}
            showValidation={submitted}
            onChange={setSiteAccess}
          />
          <DialogFooter>
            <Button type="button" variant="outline" disabled={saving} onClick={onClose}>
              {t('members.edit.cancel')}
            </Button>
            <Button
              type="submit"
              loading={saving}
              loadingLabel={t('members.edit.saving')}
            >
              {t('members.edit.save')}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
};

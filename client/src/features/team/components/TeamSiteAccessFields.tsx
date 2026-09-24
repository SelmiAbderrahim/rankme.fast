import { useTranslation } from 'react-i18next';
import { Checkbox } from '@shared/ui/checkbox';
import {
  Field,
  FieldContent,
  FieldDescription,
  FieldError,
  FieldGroup,
  FieldLabel,
  FieldLegend,
  FieldSet,
} from '@shared/ui/field';
import { RadioGroup, RadioGroupItem } from '@shared/ui/radio-group';
import type { TeamSiteAccessInput, TeamSiteOption } from '../types';

interface TeamSiteAccessFieldsProps {
  idPrefix: string;
  value: TeamSiteAccessInput;
  sites: readonly TeamSiteOption[];
  allowAll: boolean;
  disabled?: boolean;
  showValidation?: boolean;
  onChange: (value: TeamSiteAccessInput) => void;
}

export const TeamSiteAccessFields = ({
  idPrefix,
  value,
  sites,
  allowAll,
  disabled = false,
  showValidation = false,
  onChange,
}: TeamSiteAccessFieldsProps) => {
  const { t } = useTranslation('team');
  const selectedIds = value.mode === 'selected' ? value.siteIds : [];
  const selectionInvalid = value.mode === 'selected' && selectedIds.length === 0;

  const setMode = (mode: string) => {
    if (mode === 'all') {
      onChange({ mode: 'all' });
      return;
    }
    // These are the only values rendered by the controlled radio group.
    onChange({
      mode: 'selected',
      siteIds: sites.slice(0, 1).map((site) => site.id),
    });
  };

  const setSite = (siteId: string, checked: boolean) => {
    const next = checked
      ? [...new Set([...selectedIds, siteId])]
      : selectedIds.filter((id) => id !== siteId);
    onChange({ mode: 'selected', siteIds: next });
  };

  return (
    <FieldSet disabled={disabled}>
      <FieldLegend>{t('access.heading')}</FieldLegend>
      <FieldDescription>{t('access.description')}</FieldDescription>
      <RadioGroup
        value={value.mode}
        onValueChange={setMode}
        aria-label={t('access.heading')}
        className="gap-3"
      >
        <Field orientation="horizontal" data-disabled={!allowAll || disabled || undefined}>
          <RadioGroupItem
            id={`${idPrefix}-access-all`}
            value="all"
            disabled={!allowAll || disabled}
          />
          <FieldContent>
            <FieldLabel htmlFor={`${idPrefix}-access-all`}>{t('access.all')}</FieldLabel>
            <FieldDescription>{t('access.allDescription')}</FieldDescription>
          </FieldContent>
        </Field>
        <Field orientation="horizontal" data-disabled={sites.length === 0 || disabled || undefined}>
          <RadioGroupItem
            id={`${idPrefix}-access-selected`}
            value="selected"
            disabled={sites.length === 0 || disabled}
          />
          <FieldContent>
            <FieldLabel htmlFor={`${idPrefix}-access-selected`}>
              {t('access.selected')}
            </FieldLabel>
            <FieldDescription>{t('access.selectedDescription')}</FieldDescription>
          </FieldContent>
        </Field>
      </RadioGroup>

      {sites.length === 0 ? (
        <p className="text-muted-foreground text-sm">{t('access.empty')}</p>
      ) : value.mode === 'selected' ? (
        <FieldGroup className="gap-3 ps-7">
          {sites.map((site) => {
            const id = `${idPrefix}-site-${site.id}`;
            return (
              <Field key={site.id} orientation="horizontal" data-disabled={disabled || undefined}>
                <FieldContent>
                  <FieldLabel htmlFor={id}>{site.label}</FieldLabel>
                  <FieldDescription>{site.url}</FieldDescription>
                </FieldContent>
                <Checkbox
                  id={id}
                  checked={selectedIds.includes(site.id)}
                  disabled={disabled}
                  aria-invalid={showValidation && selectionInvalid ? true : undefined}
                  onCheckedChange={(checked) => setSite(site.id, checked === true)}
                />
              </Field>
            );
          })}
          {showValidation && selectionInvalid ? (
            <FieldError>{t('access.required')}</FieldError>
          ) : null}
        </FieldGroup>
      ) : null}
    </FieldSet>
  );
};

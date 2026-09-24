import { useTranslation } from 'react-i18next';
import type { Site } from '@features/sites';
import { Checkbox } from '@shared/ui/checkbox';
import {
  Field,
  FieldContent,
  FieldDescription,
  FieldGroup,
  FieldLabel,
  FieldLegend,
  FieldSet,
} from '@shared/ui/field';
import { Switch } from '@shared/ui/switch';
import {
  MCP_TOOL_NAMES,
  type McpPermissionSettings,
  type McpToolName,
} from '../types';

interface McpScopeFieldsProps {
  idPrefix: string;
  value: McpPermissionSettings;
  sites: readonly Site[];
  control: 'switch' | 'checkbox';
  disabled?: boolean;
  onChange: (value: McpPermissionSettings) => void;
}

interface SiteOption {
  id: string;
  label: string;
  description: string;
  missing: boolean;
}

/** Shared account/key permission fields; the control style differs by context. */
export function McpScopeFields({
  idPrefix,
  value,
  sites,
  control,
  disabled = false,
  onChange,
}: McpScopeFieldsProps) {
  const { t } = useTranslation('settings');
  const knownSiteIds = new Set(sites.map((site) => site.id));
  const siteOptions: SiteOption[] = [
    ...sites.map((site) => ({
      id: site.id,
      label: site.displayName || site.domain,
      description: site.url,
      missing: false,
    })),
    ...value.allowedSiteIds
      .filter((id) => !knownSiteIds.has(id))
      .map((id) => ({
        id,
        label: t('mcp.sites.unavailable'),
        description: id,
        missing: true,
      })),
  ];
  const allSites = value.allowedSiteIds.length === 0;

  const setTool = (name: McpToolName, checked: boolean) => {
    onChange({
      ...value,
      tools: { ...value.tools, [name]: checked },
    });
  };

  const setAllSites = (checked: boolean) => {
    onChange({
      ...value,
      allowedSiteIds: checked
        ? []
        : siteOptions.slice(0, 1).map((site) => site.id),
    });
  };

  const setSite = (id: string, checked: boolean) => {
    onChange({
      ...value,
      allowedSiteIds: checked
        ? [...new Set([...value.allowedSiteIds, id])]
        : value.allowedSiteIds.filter((siteId) => siteId !== id),
    });
  };

  return (
    <div className="flex flex-col gap-8">
      <FieldSet disabled={disabled}>
        <FieldLegend>{t('mcp.tools.title')}</FieldLegend>
        <FieldDescription>{t('mcp.tools.description')}</FieldDescription>
        <FieldGroup className="gap-4">
          {MCP_TOOL_NAMES.map((name) => {
            const id = `${idPrefix}-tool-${name}`;
            return (
              <Field
                key={name}
                orientation="horizontal"
                data-disabled={disabled || undefined}
              >
                <FieldContent>
                  <FieldLabel htmlFor={id}>{t(`mcp.tools.${name}.name`)}</FieldLabel>
                  <FieldDescription>
                    {t(`mcp.tools.${name}.description`)}
                  </FieldDescription>
                </FieldContent>
                {control === 'switch' ? (
                  <Switch
                    id={id}
                    checked={value.tools[name]}
                    disabled={disabled}
                    onCheckedChange={(checked) => setTool(name, checked)}
                  />
                ) : (
                  <Checkbox
                    id={id}
                    checked={value.tools[name]}
                    disabled={disabled}
                    onCheckedChange={(checked) => setTool(name, checked === true)}
                  />
                )}
              </Field>
            );
          })}
        </FieldGroup>
      </FieldSet>

      <FieldSet disabled={disabled}>
        <FieldLegend>{t('mcp.spend.title')}</FieldLegend>
        <Field orientation="horizontal" data-disabled={disabled || undefined}>
          <FieldContent>
            <FieldLabel htmlFor={`${idPrefix}-allow-spend`}>
              {t('mcp.spend.label')}
            </FieldLabel>
            <FieldDescription>{t('mcp.spend.description')}</FieldDescription>
          </FieldContent>
          <Switch
            id={`${idPrefix}-allow-spend`}
            checked={value.allowSpend}
            disabled={disabled}
            onCheckedChange={(checked) => onChange({ ...value, allowSpend: checked })}
          />
        </Field>
      </FieldSet>

      <FieldSet disabled={disabled}>
        <FieldLegend>{t('mcp.sites.title')}</FieldLegend>
        <FieldDescription>{t('mcp.sites.description')}</FieldDescription>
        <FieldGroup className="gap-4">
          <Field
            orientation="horizontal"
            data-disabled={disabled || siteOptions.length === 0 || undefined}
          >
            <FieldContent>
              <FieldLabel htmlFor={`${idPrefix}-all-sites`}>
                {t('mcp.sites.all')}
              </FieldLabel>
              <FieldDescription>{t('mcp.sites.allDescription')}</FieldDescription>
            </FieldContent>
            <Checkbox
              id={`${idPrefix}-all-sites`}
              checked={allSites}
              disabled={disabled || siteOptions.length === 0}
              onCheckedChange={(checked) => setAllSites(checked === true)}
            />
          </Field>

          {siteOptions.length === 0 ? (
            <p className="text-sm text-muted-foreground">{t('mcp.sites.empty')}</p>
          ) : (
            siteOptions.map((site) => {
              const checked = value.allowedSiteIds.includes(site.id);
              const lastSelected = checked && value.allowedSiteIds.length === 1;
              const siteDisabled = disabled || allSites || lastSelected;
              return (
                <Field
                  key={site.id}
                  orientation="horizontal"
                  data-disabled={siteDisabled || undefined}
                >
                  <FieldContent>
                    <FieldLabel htmlFor={`${idPrefix}-site-${site.id}`}>
                      {site.label}
                    </FieldLabel>
                    <FieldDescription>
                      {site.description}
                      {site.missing ? ` · ${t('mcp.sites.removeHint')}` : ''}
                    </FieldDescription>
                  </FieldContent>
                  <Checkbox
                    id={`${idPrefix}-site-${site.id}`}
                    checked={checked}
                    disabled={siteDisabled}
                    onCheckedChange={(next) => setSite(site.id, next === true)}
                  />
                </Field>
              );
            })
          )}
        </FieldGroup>
      </FieldSet>
    </div>
  );
}

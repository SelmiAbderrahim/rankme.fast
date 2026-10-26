/**
 * One site picker for forms that work on one of the account's sites. Lists every site, labelled by the shared naming policy
 * ("Name · domain", paused sites marked), and handles loading, failure and
 * the no-site case itself so each form only receives the chosen site. The
 * form owns the list (`useAllSites`), so it can preselect or look up a site.
 *
 * data-testid contract (prefix = `testId`):
 *   - <prefix>               the select trigger
 *   - <prefix>-loading       loading state
 *   - <prefix>-error         load failure (+ retry)
 *   - <prefix>-empty         no site yet (+ link to add one)
 *   - <prefix>-truncated     more sites exist than the picker could list
 */
import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { Button } from '@shared/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@shared/ui/select';
import { Skeleton } from '@shared/ui/skeleton';
import type { AllSitesState } from '../useAllSites';
import type { Site } from '../types';
import { SiteOptionLabel } from '@shared/components/SiteOptionLabel';

export interface SiteSelectProps {
  id: string;
  value: string | null;
  onChange: (site: Site) => void;
  placeholder: string;
  testId: string;
  /** From `useAllSites()`: the form reads the same list (to preselect, or to find the chosen site). */
  sites: AllSitesState & { retry: () => void };
  invalid?: boolean;
  describedBy?: string;
}

export const SiteSelect = ({
  id,
  value,
  onChange,
  placeholder,
  testId,
  sites: state,
  invalid,
  describedBy,
}: SiteSelectProps) => {
  const { t, i18n } = useTranslation('sites');

  if (state.status === 'loading') {
    return (
      <div aria-busy="true" aria-live="polite" data-testid={`${testId}-loading`}>
        <span className="sr-only">{t('picker.loading')}</span>
        <Skeleton className="h-9 w-full" />
      </div>
    );
  }
  if (state.status === 'error') {
    return (
      <div className="flex flex-wrap items-center gap-2" data-testid={`${testId}-error`}>
        <p role="alert" className="text-destructive text-sm">
          {t('picker.loadFailed')}
        </p>
        <Button type="button" variant="outline" size="sm" onClick={state.retry}>
          {t('retry')}
        </Button>
      </div>
    );
  }
  if (state.sites.length === 0) {
    return (
      <p className="text-muted-foreground text-sm" data-testid={`${testId}-empty`}>
        {t('picker.empty')}{' '}
        <Link to="/sites" className="text-foreground font-medium underline underline-offset-4">
          {t('picker.addSite')}
        </Link>
      </p>
    );
  }
  const known = value !== null && state.sites.some((site) => site.id === value);
  return (
    <>
      <Select
        dir={i18n.dir()}
        value={known ? value : ''}
        onValueChange={(next) => onChange(state.sites.find((site) => site.id === next)!)}
      >
        <SelectTrigger
          id={id}
          data-testid={testId}
          className="w-full"
          aria-invalid={invalid || undefined}
          aria-describedby={describedBy}
        >
          <SelectValue placeholder={placeholder} />
        </SelectTrigger>
        <SelectContent>
          {state.sites.map((site) => (
            <SelectItem key={site.id} value={site.id}>
              <SiteOptionLabel site={site} pausedLabel={t('paused.optionSuffix')} />
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      {state.truncated ? (
        <p className="text-muted-foreground text-xs" data-testid={`${testId}-truncated`}>
          {t('picker.truncated', { shown: state.sites.length })}
        </p>
      ) : null}
    </>
  );
};

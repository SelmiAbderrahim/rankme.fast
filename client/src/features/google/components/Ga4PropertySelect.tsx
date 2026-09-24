/**
 * Ga4PropertySelect — the ONE GA4 property picker, shared by the analytics
 * summary card (inline, when the scope is granted but no property is chosen)
 * and the Site Google connection card. Loads the Site-nested analytics
 * properties endpoint and writes that Site's `{ ga4PropertyId }` binding only
 * after an explicit user selection. Exact URL matches are handled by the
 * background Site auto-match job.
 *
 * data-testid contract:
 *   - ga4-property-skeleton   properties loading
 *   - ga4-property-error      load failure (+ ga4-property-retry)
 *   - ga4-property-none       account has zero GA4 properties
 *   - ga4-property-select     the Select trigger
 */
import { useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '@shared/ui/button';
import { Label } from '@shared/ui/label';
import { Skeleton } from '@shared/ui/skeleton';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@shared/ui/select';
import { useAppDispatch, useAppSelector } from '@shared/hooks/redux';
import { loadGa4Properties, setGa4Property } from '../store/thunks';
import {
  selectGoogleAnalytics,
  selectGoogleConnection,
  selectGoogleConnectionSiteId,
} from '../store/selectors';

export interface Ga4PropertySelectProps {
  siteId: string;
  /** id for the label/select pairing — unique per surface. */
  id?: string;
}

export const Ga4PropertySelect = ({ siteId, id = 'ga4-property' }: Ga4PropertySelectProps) => {
  const { t } = useTranslation('google');
  const dispatch = useAppDispatch();
  const connection = useAppSelector(selectGoogleConnection);
  const connectionSiteId = useAppSelector(selectGoogleConnectionSiteId);
  const analytics = useAppSelector(selectGoogleAnalytics);
  const {
    properties,
    propertiesLoading,
    propertiesLoaded,
    propertiesError,
    settingProperty,
    setPropertyError,
  } = analytics;

  const ga4PropertyId = connectionSiteId === siteId ? (connection?.ga4PropertyId ?? null) : null;

  useEffect(() => {
    if (propertiesLoaded || propertiesLoading) return;
    void dispatch(loadGa4Properties(siteId));
  }, [dispatch, propertiesLoaded, propertiesLoading, siteId]);

  if (propertiesLoading || !propertiesLoaded) {
    return <Skeleton className="h-9 w-full sm:w-96" data-testid="ga4-property-skeleton" />;
  }

  if (propertiesError) {
    return (
      <div data-testid="ga4-property-error">
        <p role="alert" className="text-destructive text-sm">
          {propertiesError}
        </p>
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="mt-2"
          onClick={() => void dispatch(loadGa4Properties(siteId))}
          data-testid="ga4-property-retry"
        >
          {t('searchSummary.retry')}
        </Button>
      </div>
    );
  }

  if (properties.length === 0) {
    return (
      <p className="text-muted-foreground text-sm" data-testid="ga4-property-none">
        {t('analytics.propertyNone')}
      </p>
    );
  }

  return (
    <div className="space-y-2 text-sm">
      <Label htmlFor={id} className="text-muted-foreground">
        {t('analytics.propertyLabel')}
      </Label>
      <Select
        value={ga4PropertyId ?? ''}
        disabled={settingProperty}
        onValueChange={(value) => {
          if (value !== ga4PropertyId) {
            void dispatch(setGa4Property({ siteId, ga4PropertyId: value }));
          }
        }}
      >
        <SelectTrigger
          id={id}
          className="w-full sm:w-96"
          aria-busy={settingProperty}
          data-testid="ga4-property-select"
        >
          <SelectValue placeholder={t('analytics.propertyPlaceholder')} />
        </SelectTrigger>
        <SelectContent>
          {properties.map((property) => (
            <SelectItem key={property.propertyId} value={property.propertyId}>
              {property.displayName}
              {property.inUseBy?.length
                ? ` — ${property.inUseBy.map((site) => site.displayName || site.domain).join(', ')}`
                : ''}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      {setPropertyError ? (
        <p role="alert" className="text-destructive text-sm">
          {setPropertyError}
        </p>
      ) : null}
    </div>
  );
};

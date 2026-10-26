/**
 * Where the grid is centred.
 *
 * Three ways to set the centre, cheapest first:
 *   - My business: the location stored with the site's Local SEO business
 *     (free; chosen once in Local SEO setup).
 *   - Search for a place: one lookup by name or address through the Local SEO
 *     business search. Picking a result only fills the centre; nothing is
 *     saved.
 *   - Enter coordinates: the raw latitude/longitude fields, plus the centre
 *     of the last scan. Kept as the advanced option.
 *
 * data-testid contract:
 *   - geogrid-center               fieldset root
 *   - geogrid-center-mode-<mode>   mode radio (business | place | coordinates)
 *   - geogrid-center-current       the centre the scan will use
 *   - geogrid-center-required      "choose a centre" error outside coordinate mode
 *   - geogrid-center-business      the stored business and its location
 *   - geogrid-center-business-none no business yet (+ link to Local SEO setup)
 *   - geogrid-place-query / geogrid-place-search / geogrid-place-results
 *   - geogrid-place-result-<i> / geogrid-place-no-results / geogrid-place-error
 *   - geogrid-use-last-center / geogrid-lat / geogrid-lng (coordinate mode)
 */
import { useEffect, useId, useRef, useState, type KeyboardEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router-dom';
import { LocateFixed, Search } from 'lucide-react';
import { Bdi } from '@shared/components/Bdi';
import { useWorkspaceSiteCapabilities } from '@shared/site/capabilities';
import { Alert, AlertDescription } from '@shared/ui/alert';
import { Button } from '@shared/ui/button';
import { Input } from '@shared/ui/input';
import { Label } from '@shared/ui/label';
import { FieldFeedback, fieldDescribedBy } from '@shared/components/FieldFeedback';
import { RadioGroup, RadioGroupItem } from '@shared/ui/radio-group';
import { Skeleton } from '@shared/ui/skeleton';
import { fetchLocalBusinessSetup, searchLocalPlacesRequest } from '../../api';
import { BUSINESS_QUERY_MAX, BUSINESS_QUERY_MIN } from '../../components/LocalBusinessSetupCard';
import { localSeoErrorMessage } from '../../errorMessage';
import type { LocalPlace, SelectedLocalBusiness } from '../../types';
import type { GeogridFieldError } from '../validation';
import { GEOGRID_MAX_ABS_CENTER_LAT } from '../types';
import { isolateText } from '@shared/lib/bidi';

export interface GeogridCenter {
  lat: number;
  lng: number;
}

export const GEOGRID_CENTER_MODES = ['business', 'place', 'coordinates'] as const;
export type GeogridCenterMode = (typeof GEOGRID_CENTER_MODES)[number];

type BusinessState =
  | { status: 'loading' }
  | { status: 'error' }
  | { status: 'ready'; business: SelectedLocalBusiness | null };

function businessCenter(state: BusinessState): GeogridCenter | null {
  if (state.status !== 'ready' || !state.business) return null;
  const { latitude, longitude } = state.business;
  return latitude !== null && longitude !== null ? { lat: latitude, lng: longitude } : null;
}

/** Five decimals is about a metre: enough to recognise the point. */
function formatCenter(center: GeogridCenter): string {
  return `${center.lat.toFixed(5)}, ${center.lng.toFixed(5)}`;
}

function parseCenter(lat: string, lng: string): GeogridCenter | null {
  if (lat.trim() === '' || lng.trim() === '') return null;
  const center = { lat: Number(lat), lng: Number(lng) };
  return Number.isFinite(center.lat) && Number.isFinite(center.lng) ? center : null;
}

interface Props {
  siteId: string;
  centerLat: string;
  centerLng: string;
  /** Centre of the most recent scan, or null when there is none. */
  lastCenter: GeogridCenter | null;
  errors: GeogridFieldError[];
  disabled: boolean;
  onCenterChange: (center: GeogridCenter) => void;
  onCoordinateChange: (field: 'centerLat' | 'centerLng', value: string) => void;
}

export const GeogridCenterPicker = ({
  siteId,
  centerLat,
  centerLng,
  lastCenter,
  errors,
  disabled,
  onCenterChange,
  onCoordinateChange,
}: Props) => {
  const { t } = useTranslation('geogrid');
  const { canRun, blockedReason } = useWorkspaceSiteCapabilities();
  const ids = useId();
  const queryRef = useRef<HTMLInputElement>(null);
  const [business, setBusiness] = useState<BusinessState>({ status: 'loading' });
  const [chosenMode, setChosenMode] = useState<GeogridCenterMode | null>(null);
  const [query, setQuery] = useState('');
  const [queryInvalid, setQueryInvalid] = useState(false);
  const [searching, setSearching] = useState(false);
  const [searchError, setSearchError] = useState('');
  const [results, setResults] = useState<{ query: string; places: LocalPlace[] } | null>(null);
  const [placeChoice, setPlaceChoice] = useState('');

  useEffect(() => {
    let cancelled = false;
    setBusiness({ status: 'loading' });
    fetchLocalBusinessSetup(siteId).then(
      (setup) => {
        if (!cancelled) setBusiness({ status: 'ready', business: setup.selected });
      },
      () => {
        if (!cancelled) setBusiness({ status: 'error' });
      },
    );
    return () => {
      cancelled = true;
    };
  }, [siteId]);

  const stored = businessCenter(business);
  const current = parseCenter(centerLat, centerLng);
  // Until the owner picks a way, start from the stored business when it has a
  // location, from typed or last-scan coordinates when they exist, and from
  // the place search otherwise.
  const mode: GeogridCenterMode =
    chosenMode ?? (stored ? 'business' : current || lastCenter ? 'coordinates' : 'place');

  // The stored business fills an empty centre once, when it loads (also when
  // the owner picked "My business" while it was loading); it never overwrites
  // coordinates the owner already has.
  const prefilled = useRef(false);
  useEffect(() => {
    if (prefilled.current || (chosenMode !== null && chosenMode !== 'business') || !stored || current !== null) return;
    prefilled.current = true;
    onCenterChange(stored);
  }, [chosenMode, stored, current, onCenterChange]);

  const has = (field: GeogridFieldError) => errors.includes(field);
  const centerMissing = mode !== 'coordinates' && (has('centerLat') || has('centerLng'));

  const chooseMode = (next: GeogridCenterMode) => {
    setChosenMode(next);
    if (next === 'business' && stored) onCenterChange(stored);
  };

  const runSearch = async () => {
    const trimmed = query.trim();
    if (trimmed.length < BUSINESS_QUERY_MIN || trimmed.length > BUSINESS_QUERY_MAX) {
      setQueryInvalid(true);
      queryRef.current?.focus();
      return;
    }
    setQueryInvalid(false);
    setSearching(true);
    setSearchError('');
    try {
      setResults(await searchLocalPlacesRequest(siteId, trimmed));
      setPlaceChoice('');
    } catch (err) {
      setSearchError(localSeoErrorMessage(err, 'geogrid:center.place.searchFailed'));
    } finally {
      setSearching(false);
    }
  };

  // Enter in the place field searches; it must never submit the grid form.
  const onQueryKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key !== 'Enter') return;
    event.preventDefault();
    if (canRun && !disabled) void runSearch();
  };

  const blockedId = `${ids}-blocked`;

  return (
    <fieldset className="flex flex-col gap-3" data-testid="geogrid-center" disabled={disabled}>
      <legend className="text-sm font-medium">{t('center.legend')}</legend>
      <RadioGroup
        name="centerMode"
        aria-label={t('center.legend')}
        className="flex flex-wrap gap-2"
        value={mode}
        onValueChange={(value) => chooseMode(value as GeogridCenterMode)}
        aria-describedby={centerMissing ? `${ids}-required` : undefined}
      >
        {GEOGRID_CENTER_MODES.map((option) => (
          <Label
            key={option}
            htmlFor={`${ids}-mode-${option}`}
            className="border-input hover:bg-accent has-[[data-state=checked]]:border-primary flex cursor-pointer items-center gap-2 rounded-md border px-3 py-2 text-sm font-normal"
          >
            <RadioGroupItem id={`${ids}-mode-${option}`} value={option} data-testid={`geogrid-center-mode-${option}`} />
            {t(`center.mode.${option}`)}
          </Label>
        ))}
      </RadioGroup>

      {mode === 'business' ? (
        business.status === 'loading' ? (
          <div aria-busy="true" aria-live="polite" className="flex flex-col gap-2">
            <span className="sr-only">{t('center.business.loading')}</span>
            <Skeleton className="h-4 w-1/2" />
          </div>
        ) : business.status === 'error' ? (
          <p className="text-muted-foreground text-sm" role="status">
            {t('center.business.loadFailed')}
          </p>
        ) : business.business === null ? (
          <p className="text-muted-foreground text-sm" data-testid="geogrid-center-business-none">
            {t('center.business.none')}{' '}
            <Link
              to={{ search: '?tab=local-seo&view=setup' }}
              className="text-foreground font-medium underline underline-offset-4"
            >
              {t('center.business.setUp')}
            </Link>
          </p>
        ) : (
          <div className="flex flex-col gap-0.5 text-sm" data-testid="geogrid-center-business">
            <span className="font-semibold">
              <Bdi>{business.business.name}</Bdi>
            </span>
            <span className="text-muted-foreground">
              {business.business.address ? <Bdi>{business.business.address}</Bdi> : t('center.noAddress')}
            </span>
            {stored ? null : (
              <span className="text-muted-foreground">{t('center.business.noLocation')}</span>
            )}
          </div>
        )
      ) : null}

      {mode === 'place' ? (
        <div className="flex flex-col gap-2">
          <Label htmlFor={`${ids}-query`}>{t('center.place.label')}</Label>
          <div className="flex flex-col gap-2 sm:flex-row">
            <Input
              ref={queryRef}
              id={`${ids}-query`}
              data-testid="geogrid-place-query"
              value={query}
              maxLength={BUSINESS_QUERY_MAX}
              placeholder={t('center.place.placeholder')}
              aria-invalid={queryInvalid || undefined}
              aria-describedby={[
                fieldDescribedBy(`${ids}-query`, { hint: true, error: queryInvalid }),
                !canRun ? blockedId : null,
              ]
                .filter(Boolean)
                .join(' ')}
              onKeyDown={onQueryKeyDown}
              onChange={(event) => {
                setQuery(event.target.value);
                if (queryInvalid) setQueryInvalid(false);
              }}
            />
            <Button
              type="button"
              variant="outline"
              disabled={!canRun}
              loading={searching}
              loadingLabel={t('center.place.searching')}
              aria-describedby={!canRun ? blockedId : undefined}
              // Buttons size to their label, also on phones.
              className="self-start sm:self-auto"
              data-testid="geogrid-place-search"
              onClick={() => void runSearch()}
            >
              <Search className="me-1 h-4 w-4" aria-hidden="true" />
              {t('center.place.search')}
            </Button>
          </div>
          <FieldFeedback
            id={`${ids}-query`}
            hint={t('center.place.hint')}
            error={
              queryInvalid
                ? t('center.place.invalid', { min: BUSINESS_QUERY_MIN, max: BUSINESS_QUERY_MAX })
                : null
            }
          />
          {!canRun && blockedReason ? (
            <p id={blockedId} className="text-muted-foreground text-sm">
              {blockedReason}
            </p>
          ) : null}
          {searchError ? (
            <Alert variant="destructive" role="alert" data-testid="geogrid-place-error">
              <AlertDescription>{searchError}</AlertDescription>
            </Alert>
          ) : null}
          {results && results.places.length > 0 ? (
            <fieldset className="flex flex-col gap-2">
              <legend className="mb-1 text-sm font-medium">
                {t('center.place.resultsLegend', { count: results.places.length, query: isolateText(results.query) })}
              </legend>
              <RadioGroup
                name="centerPlace"
                aria-label={t('center.legend')}
                value={placeChoice}
                data-testid="geogrid-place-results"
                onValueChange={(value) => {
                  // Stay on the place search once a place is the centre.
                  setChosenMode('place');
                  setPlaceChoice(value);
                  const place = results.places[Number(value)]!;
                  onCenterChange({ lat: place.latitude, lng: place.longitude });
                }}
              >
                {results.places.map((place, index) => (
                  <Label
                    key={`${place.placeId ?? place.cid ?? ''}-${index}`}
                    htmlFor={`${ids}-place-${index}`}
                    data-testid={`geogrid-place-result-${index}`}
                    className="border-input hover:bg-accent has-[[data-state=checked]]:border-primary flex cursor-pointer items-start gap-3 rounded-md border px-3 py-2 text-sm font-normal"
                  >
                    <RadioGroupItem id={`${ids}-place-${index}`} value={String(index)} className="mt-0.5" />
                    <span className="flex min-w-0 flex-col gap-0.5">
                      <span className="font-semibold">
                        <Bdi>{place.name}</Bdi>
                      </span>
                      <span className="text-muted-foreground">
                        {place.address ? <Bdi>{place.address}</Bdi> : t('center.noAddress')}
                      </span>
                      <span className="text-muted-foreground tabular-nums" dir="ltr">
                        {formatCenter({ lat: place.latitude, lng: place.longitude })}
                      </span>
                    </span>
                  </Label>
                ))}
              </RadioGroup>
            </fieldset>
          ) : results ? (
            <p className="text-muted-foreground text-sm" role="status" data-testid="geogrid-place-no-results">
              {t('center.place.noResults', { query: isolateText(results.query) })}
            </p>
          ) : null}
        </div>
      ) : null}

      {mode === 'coordinates' ? (
        <>
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="text-muted-foreground text-sm">{t('form.coordinateHelp')}</p>
            {lastCenter ? (
              <Button
                type="button"
                variant="outline"
                size="sm"
                data-testid="geogrid-use-last-center"
                onClick={() => onCenterChange(lastCenter)}
              >
                <LocateFixed aria-hidden="true" data-icon="inline-start" />
                {t('form.useLastCenter')}
              </Button>
            ) : null}
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="geogrid-lat">{t('form.latitude')}</Label>
              <Input
                id="geogrid-lat"
                data-testid="geogrid-lat"
                inputMode="decimal"
                type="number"
                step="0.0000001"
                min={-GEOGRID_MAX_ABS_CENTER_LAT}
                max={GEOGRID_MAX_ABS_CENTER_LAT}
                value={centerLat}
                aria-invalid={has('centerLat') || undefined}
                aria-describedby={fieldDescribedBy('geogrid-lat', { error: has('centerLat') })}
                onChange={(event) => onCoordinateChange('centerLat', event.target.value)}
              />
              <FieldFeedback
                id="geogrid-lat"
                error={has('centerLat') ? t('form.errors.latitude', { max: GEOGRID_MAX_ABS_CENTER_LAT }) : null}
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="geogrid-lng">{t('form.longitude')}</Label>
              <Input
                id="geogrid-lng"
                data-testid="geogrid-lng"
                inputMode="decimal"
                type="number"
                step="0.0000001"
                min={-180}
                max={180}
                value={centerLng}
                aria-invalid={has('centerLng') || undefined}
                aria-describedby={fieldDescribedBy('geogrid-lng', { error: has('centerLng') })}
                onChange={(event) => onCoordinateChange('centerLng', event.target.value)}
              />
              <FieldFeedback
                id="geogrid-lng"
                error={has('centerLng') ? t('form.errors.longitude') : null}
              />
            </div>
          </div>
        </>
      ) : current ? (
        <p className="text-sm" data-testid="geogrid-center-current">
          {t('center.current')}{' '}
          <span className="tabular-nums" dir="ltr">
            {formatCenter(current)}
          </span>
        </p>
      ) : null}

      {centerMissing ? (
        <p id={`${ids}-required`} role="alert" className="text-destructive text-sm" data-testid="geogrid-center-required">
          {t('center.required')}
        </p>
      ) : null}

    </fieldset>
  );
};

/**
 * Choose the business a site's Local SEO describes.
 *
 * Search (one provider lookup) → pick one result → save. Nothing
 * is chosen for the owner: results that share a name are told apart by their
 * address, and "Use this business" stays disabled until one is picked.
 *
 * data-testid contract:
 *   - local-seo-setup              root card
 *   - local-seo-setup-query        search input
 *   - local-seo-setup-search       search submit
 *   - local-seo-setup-results      result radio group
 *   - local-seo-setup-result-<i>   one result
 *   - local-seo-setup-no-results   nothing matched
 *   - local-seo-setup-save         "Use this business"
 *   - local-seo-setup-cancel       back to the saved business (when one exists)
 */
import { useEffect, useId, useRef, useState, type FormEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import { Search } from 'lucide-react';
import { Bdi } from '@shared/components/Bdi';
import { Alert, AlertDescription } from '@shared/ui/alert';
import { Button } from '@shared/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@shared/ui/card';
import { Input } from '@shared/ui/input';
import { Label } from '@shared/ui/label';
import { FieldFeedback, fieldDescribedBy } from '@shared/components/FieldFeedback';
import { FormActions } from '@shared/components/FormActions';
import { RadioGroup, RadioGroupItem } from '@shared/ui/radio-group';
import { useAppDispatch, useAppSelector } from '@shared/hooks/redux';
import {
  selectLocalBusinessSearchError,
  selectLocalBusinessSearched,
  selectLocalBusinessSearching,
  selectLocalBusinessSelectError,
  selectLocalBusinessSelecting,
} from '../store/selectors';
import { searchLocalBusiness, selectLocalBusiness } from '../store/thunks';
import type { LocalBusinessCandidate, LocalBusinessSetup } from '../types';
import { isolateText } from '@shared/lib/bidi';

export const BUSINESS_QUERY_MIN = 2;
export const BUSINESS_QUERY_MAX = 200;

export interface LocalBusinessSetupCardProps {
  siteId: string;
  setup: LocalBusinessSetup;
  /** False on a paused site; `blockedReason` explains why. */
  canRun: boolean;
  blockedReason: string | null;
  /** Shown when a business is already saved: return to it without changes. */
  onCancel?: () => void;
  /** Called after a business is saved. */
  onSaved: () => void;
  /** Move focus to the search field (deep links and "Change business"). */
  autoFocus?: boolean;
}

function coordinates(candidate: LocalBusinessCandidate): string | null {
  if (candidate.latitude === null || candidate.longitude === null) return null;
  return `${candidate.latitude.toFixed(5)}, ${candidate.longitude.toFixed(5)}`;
}

export const LocalBusinessSetupCard = ({
  siteId,
  setup,
  canRun,
  blockedReason,
  onCancel,
  onSaved,
  autoFocus = false,
}: LocalBusinessSetupCardProps) => {
  const { t } = useTranslation('localSeo');
  const dispatch = useAppDispatch();
  const searching = useAppSelector(selectLocalBusinessSearching);
  const searchError = useAppSelector(selectLocalBusinessSearchError);
  const searched = useAppSelector(selectLocalBusinessSearched);
  const selecting = useAppSelector(selectLocalBusinessSelecting);
  const selectError = useAppSelector(selectLocalBusinessSelectError);
  const ids = useId();
  const inputRef = useRef<HTMLInputElement>(null);
  const [query, setQuery] = useState(setup.query ?? '');
  const [invalid, setInvalid] = useState(false);
  const [choice, setChoice] = useState('');

  useEffect(() => {
    if (autoFocus) inputRef.current?.focus();
  }, [autoFocus]);

  const candidates = setup.candidates;
  // The searched phrase as the server stored it, else what the owner typed.
  const shownQuery = isolateText(setup.query ?? query.trim());
  const hasSaved = setup.selected !== null;
  const queryId = `${ids}-query`;
  const describedBy = [
    fieldDescribedBy(queryId, { hint: true, error: invalid }),
    !canRun ? `${ids}-blocked` : null,
  ]
    .filter(Boolean)
    .join(' ');

  const submitSearch = async (event: FormEvent) => {
    event.preventDefault();
    const trimmed = query.trim();
    if (trimmed.length < BUSINESS_QUERY_MIN || trimmed.length > BUSINESS_QUERY_MAX) {
      setInvalid(true);
      inputRef.current?.focus();
      return;
    }
    setInvalid(false);
    const result = await dispatch(searchLocalBusiness({ siteId, query: trimmed }));
    if (searchLocalBusiness.fulfilled.match(result)) setChoice('');
  };

  const save = async () => {
    const result = await dispatch(selectLocalBusiness({ siteId, candidateId: choice }));
    if (selectLocalBusiness.fulfilled.match(result)) {
      // A successful save always returns the saved business.
      toast.success(t('setup.saved', { name: isolateText(result.payload.selected!.name) }));
      onSaved();
    }
  };

  return (
    <Card data-testid="local-seo-setup">
      <CardHeader>
        <CardTitle className="text-base">{t('setup.title')}</CardTitle>
        <CardDescription>{hasSaved ? t('setup.changeDescription') : t('setup.description')}</CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        <form className="flex flex-col gap-2" onSubmit={(event) => void submitSearch(event)} noValidate>
          <Label htmlFor={`${ids}-query`}>{t('setup.queryLabel')}</Label>
          <div className="flex flex-col gap-2 sm:flex-row">
            <Input
              ref={inputRef}
              id={queryId}
              data-testid="local-seo-setup-query"
              value={query}
              maxLength={BUSINESS_QUERY_MAX}
              placeholder={t('setup.queryPlaceholder')}
              aria-invalid={invalid || undefined}
              aria-describedby={describedBy}
              onChange={(event) => {
                setQuery(event.target.value);
                if (invalid) setInvalid(false);
              }}
            />
            <Button
              type="submit"
              variant="outline"
              disabled={!canRun}
              loading={searching}
              loadingLabel={t('setup.searching')}
              aria-describedby={!canRun ? `${ids}-blocked` : undefined}
              // Buttons size to their label, also on phones.
              className="self-start sm:self-auto"
              data-testid="local-seo-setup-search"
            >
              <Search className="me-1 h-4 w-4" aria-hidden="true" />
              {t('setup.search')}
            </Button>
          </div>
          <FieldFeedback
            id={queryId}
            hint={t('setup.queryHint')}
            error={
              invalid
                ? t('setup.queryInvalid', { min: BUSINESS_QUERY_MIN, max: BUSINESS_QUERY_MAX })
                : null
            }
          />
          {!canRun && blockedReason ? (
            <p id={`${ids}-blocked`} className="text-muted-foreground text-sm">
              {blockedReason}
            </p>
          ) : null}
        </form>

        {searchError ? (
          <Alert variant="destructive" role="alert" data-testid="local-seo-setup-search-error">
            <AlertDescription>{searchError}</AlertDescription>
          </Alert>
        ) : null}

        {candidates.length > 0 ? (
          <fieldset className="flex flex-col gap-3">
            <legend className="mb-2 text-sm font-medium">
              {t('setup.resultsLegend', { count: candidates.length, query: shownQuery })}
            </legend>
            <RadioGroup value={choice} onValueChange={setChoice} data-testid="local-seo-setup-results">
              {candidates.map((candidate, index) => {
                const coords = coordinates(candidate);
                return (
                  <Label
                    key={candidate.candidateId}
                    htmlFor={`${ids}-candidate-${index}`}
                    data-testid={`local-seo-setup-result-${index}`}
                    className="border-input hover:bg-accent has-[[data-state=checked]]:border-primary flex cursor-pointer items-start gap-3 rounded-md border px-3 py-3 text-sm font-normal"
                  >
                    <RadioGroupItem
                      id={`${ids}-candidate-${index}`}
                      value={candidate.candidateId}
                      className="mt-0.5"
                    />
                    <span className="flex min-w-0 flex-col gap-0.5">
                      <span className="font-semibold">
                        <Bdi>{candidate.name}</Bdi>
                      </span>
                      <span className="text-muted-foreground">
                        {candidate.address ? <Bdi>{candidate.address}</Bdi> : t('setup.noAddress')}
                      </span>
                      <span className="text-muted-foreground">
                        {[t('setup.source'), candidate.category].filter(Boolean).join(' · ')}
                      </span>
                      {coords ? (
                        <span className="text-muted-foreground tabular-nums" dir="ltr">
                          {coords}
                        </span>
                      ) : null}
                    </span>
                  </Label>
                );
              })}
            </RadioGroup>
          </fieldset>
        ) : searched && !searching && !searchError ? (
          <p className="text-muted-foreground text-sm" role="status" data-testid="local-seo-setup-no-results">
            {t('setup.noResults', { query: shownQuery })}
          </p>
        ) : null}

        {selectError ? (
          <Alert variant="destructive" role="alert" data-testid="local-seo-setup-select-error">
            <AlertDescription>{selectError}</AlertDescription>
          </Alert>
        ) : null}

        <FormActions>
          {candidates.length > 0 ? (
            <Button
              type="button"
              disabled={choice === ''}
              loading={selecting}
              loadingLabel={t('setup.saving')}
              onClick={() => void save()}
              data-testid="local-seo-setup-save"
            >
              {t('setup.save')}
            </Button>
          ) : null}
          {onCancel ? (
            <Button type="button" variant="ghost" onClick={onCancel} data-testid="local-seo-setup-cancel">
              {t('common:cancel')}
            </Button>
          ) : null}
        </FormActions>
      </CardContent>

    </Card>
  );
};

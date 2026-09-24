import { useEffect, useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router-dom';
import { safeExternalHref } from '@shared/security';
import { Alert, AlertDescription } from '@shared/ui/alert';
import { Button } from '@shared/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@shared/ui/card';
import { Checkbox } from '@shared/ui/checkbox';
import { Label } from '@shared/ui/label';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@shared/ui/table';
import { TableHeaderHelp } from '@shared/ui/table-header-help';
import { Textarea } from '@shared/ui/textarea';
import { cn } from '@shared/lib/utils';
import {
  CountryCombobox,
  countryCodeForLocation,
  languageName,
  useMarketCatalog,
} from '@shared/markets';
import { fetchKeywordSuggestionsRequest, previewAltEngineKeywordRequest } from '../api';
import { ranksErrorMessage } from '../errorMessage';
import {
  isAltRankEngine,
  RANK_ENGINES,
  type AltEngineSpendPreview,
  type KeywordSuggestionsResponse,
} from '../types';
import {
  buildAddKeywordSchema,
  buildLongTailResearchUrl,
  DEVICE_OPTIONS,
  languagesForLocation,
  LOCATION_OPTIONS,
  normalizeKeywordPhrase,
  parseKeywordLines,
  longTailResearchSeed,
  type AddKeywordFormValues,
} from '../validation';

export interface AddKeywordFormProps {
  siteId: string;
  onSubmit: (values: AddKeywordFormValues[]) => Promise<string[]>;
  submitting: boolean;
  addError: string;
}

/**
 * Track-a-keyword form: phrase + location + language + device. Validation
 * mirrors the server.
 */
export const AddKeywordForm = ({
  siteId,
  onSubmit,
  submitting,
  addError,
}: AddKeywordFormProps) => {
  const { t, i18n } = useTranslation('ranks');
  const [suggestions, setSuggestions] = useState<KeywordSuggestionsResponse | null>(null);
  const [suggestionCount, setSuggestionCount] = useState(20);
  const [suggestionsLoading, setSuggestionsLoading] = useState(false);
  const [suggestionsError, setSuggestionsError] = useState('');
  const [selectedSuggestions, setSelectedSuggestions] = useState<Set<string>>(() => new Set());
  const [preview, setPreview] = useState<AltEngineSpendPreview | null>(null);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [previewError, setPreviewError] = useState('');
  const catalog = useMarketCatalog('seo');

  const {
    register,
    handleSubmit,
    getValues,
    setFocus,
    setValue,
    watch,
    formState: { errors },
  } = useForm<AddKeywordFormValues>({
    resolver: zodResolver(buildAddKeywordSchema(t)),
    defaultValues: {
      phrase: '',
      locationCode: LOCATION_OPTIONS[0]!.code,
      languageCode: LOCATION_OPTIONS[0]!.languages[0]!,
      device: 'desktop',
      engine: 'google',
    },
  });

  const locationCode = watch('locationCode');
  const languageCode = watch('languageCode');
  const engine = watch('engine');
  const phrase = watch('phrase');
  const needsTarget = engine === 'youtube' || engine === 'amazon';
  const researchSeed = longTailResearchSeed(phrase, engine);
  const researchUrl = researchSeed
    ? buildLongTailResearchUrl(siteId, researchSeed, locationCode, languageCode)
    : null;

  const selectedMarket = catalog.markets.find((market) => market.locationCode === locationCode);
  const availableLanguages: readonly string[] = selectedMarket?.languageCodes
    ?? languagesForLocation(locationCode);

  useEffect(() => {
    if (catalog.loading || catalog.error || selectedMarket) return;
    const fallback = catalog.markets.find((market) => market.countryCode === 'US')
      ?? catalog.markets[0];
    if (fallback?.locationCode) {
      setValue('locationCode', fallback.locationCode, {
        shouldDirty: false,
        shouldValidate: true,
      });
    }
  }, [catalog.error, catalog.loading, catalog.markets, selectedMarket, setValue]);

  // Switching country can strand a language the new country does not serve
  // (English is valid for the US but not for Saudi Arabia). Fall back to that
  // country's primary language rather than letting the request 503.
  useEffect(() => {
    if (availableLanguages.includes(languageCode)) return;
    const first = availableLanguages[0];
    if (first) setValue('languageCode', first, { shouldDirty: false, shouldValidate: true });
  }, [availableLanguages, languageCode, setValue]);

  // A target only belongs to YouTube/Amazon. React Hook Form retains values
  // for conditionally hidden fields, so clear the token when the user returns
  // to a domain-matched engine; otherwise the mirrored schema correctly
  // refuses the invisible stale value and the Google/Bing submit appears to
  // do nothing.
  useEffect(() => {
    if (!needsTarget) {
      setValue('engineTarget', undefined, {
        shouldDirty: false,
        shouldValidate: true,
      });
    }
  }, [needsTarget, setValue]);

  // The paid-submit disclosure. Read-only: it never reserves, and a
  // failed preview NEVER blocks the form (the create call re-checks anyway).
  useEffect(() => {
    if (!isAltRankEngine(engine)) {
      setPreview(null);
      setPreviewError('');
      setPreviewLoading(false);
      return;
    }
    let cancelled = false;
    setPreviewLoading(true);
    setPreviewError('');
    previewAltEngineKeywordRequest(siteId, engine)
      .then((result) => {
        if (cancelled) return;
        setPreview(result);
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        setPreview(null);
        setPreviewError(ranksErrorMessage(err, 'ranks:errors.altEnginePreviewFailed'));
      })
      .finally(() => {
        if (!cancelled) setPreviewLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [engine, siteId]);
  const visibleSuggestions = suggestions?.candidates.slice(0, suggestionCount) ?? [];
  const selectableSuggestions = visibleSuggestions.filter((candidate) => !candidate.tracked);
  const selectedVisibleSuggestions = selectableSuggestions.filter((candidate) =>
    selectedSuggestions.has(normalizeKeywordPhrase(candidate.keyword)),
  );
  const allVisibleSelected =
    selectableSuggestions.length > 0 &&
    selectedVisibleSuggestions.length === selectableSuggestions.length;
  const someVisibleSelected = selectedVisibleSuggestions.length > 0 && !allVisibleSelected;
  const suggestionSources = suggestions?.sources ?? [];
  const isBlended = suggestionSources.length > 1;
  // GSC and the vendor's ranked list both carry a position and a traffic
  // figure, so both get those columns. Both vendor-backed sources can carry
  // DataForSEO difficulty; Search Console cannot.
  const showsRankingColumns =
    suggestionSources.includes('ranked') || suggestionSources.includes('gsc');
  const showsDifficulty =
    suggestionSources.includes('ranked') || suggestionSources.includes('site_ideas');
  // Search Console reports measured clicks and an averaged position; the
  // vendor reports an estimate and a current rank. Label them apart. Blended
  // lists use neutral labels instead.
  const isGscSource = !isBlended && suggestionSources[0] === 'gsc';

  useEffect(() => {
    setSuggestions(null);
    setSuggestionsError('');
    setSelectedSuggestions(new Set());
  }, [locationCode, languageCode]);

  useEffect(() => {
    const visibleKeys = new Set(
      (suggestions?.candidates.slice(0, suggestionCount) ?? [])
        .filter((candidate) => !candidate.tracked)
        .map((candidate) => normalizeKeywordPhrase(candidate.keyword)),
    );
    setSelectedSuggestions((current) => {
      const next = new Set([...current].filter((key) => visibleKeys.has(key)));
      return next.size === current.size ? current : next;
    });
  }, [suggestions, suggestionCount]);

  const submit = handleSubmit(async (values) => {
    const phrases = parseKeywordLines(values.phrase);
    const added = await onSubmit(phrases.map((phrase) => ({ ...values, phrase })));
    if (added.length === 0) return;
    const addedKeys = new Set(added.map(normalizeKeywordPhrase));
    const remaining = phrases.filter((phrase) => !addedKeys.has(normalizeKeywordPhrase(phrase)));
    setValue('phrase', remaining.join('\n'), {
      shouldDirty: remaining.length > 0,
      shouldValidate: remaining.length > 0,
    });
    setSelectedSuggestions((current) => new Set([...current].filter((key) => !addedKeys.has(key))));
    setSuggestions((current) =>
      current
        ? {
            ...current,
            candidates: current.candidates.map((candidate) => ({
              ...candidate,
              tracked:
                addedKeys.has(normalizeKeywordPhrase(candidate.keyword)) || candidate.tracked,
            })),
          }
        : null,
    );
  });

  const discover = async () => {
    setSuggestionsLoading(true);
    setSuggestionsError('');
    try {
      const result = await fetchKeywordSuggestionsRequest(siteId, {
        locationCode,
        languageCode,
      });
      setSuggestions(result);
      setSelectedSuggestions(new Set());
    } catch (err) {
      setSuggestions(null);
      setSelectedSuggestions(new Set());
      setSuggestionsError(ranksErrorMessage(err, 'ranks:suggestionsLoadFailed'));
    } finally {
      setSuggestionsLoading(false);
    }
  };

  const appendSuggestions = (keywords: string[]) => {
    const current = parseKeywordLines(getValues('phrase'));
    const seen = new Set(current.map(normalizeKeywordPhrase));
    const additions = keywords.filter((keyword) => {
      const key = normalizeKeywordPhrase(keyword);
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
    setValue('phrase', [...current, ...additions].join('\n'), {
      shouldDirty: true,
      shouldValidate: true,
    });
    setFocus('phrase');
  };

  const chooseSuggestion = (keyword: string) => {
    appendSuggestions([keyword]);
    const key = normalizeKeywordPhrase(keyword);
    setSelectedSuggestions((current) => {
      const next = new Set(current);
      next.delete(key);
      return next;
    });
  };

  const toggleSuggestion = (keyword: string, checked: boolean) => {
    const key = normalizeKeywordPhrase(keyword);
    setSelectedSuggestions((current) => {
      const next = new Set(current);
      if (checked) next.add(key);
      else next.delete(key);
      return next;
    });
  };

  const toggleAllVisible = (checked: boolean) => {
    setSelectedSuggestions(
      checked
        ? new Set(
            selectableSuggestions.map((candidate) => normalizeKeywordPhrase(candidate.keyword)),
          )
        : new Set(),
    );
  };

  const useSelectedSuggestions = () => {
    appendSuggestions(selectedVisibleSuggestions.map((candidate) => candidate.keyword));
    setSelectedSuggestions(new Set());
  };

  return (
    <Card className="w-full" data-testid="keyword-add">
      <CardHeader>
        <CardTitle>{t('addTitle')}</CardTitle>
        <CardDescription>{t('addDescription')}</CardDescription>
      </CardHeader>
      <CardContent>
        <form className="flex flex-col gap-4" onSubmit={submit} noValidate>
          {addError ? (
            <Alert variant="destructive" role="alert" data-testid="keyword-add-error">
              <AlertDescription>{addError}</AlertDescription>
            </Alert>
          ) : null}
          <div
            className="border-border flex flex-col gap-4 rounded-lg border p-4"
            data-testid="keyword-suggestions"
          >
            <div>
              <h3 className="font-medium">{t('suggestionsTitle')}</h3>
              <p className="text-muted-foreground text-sm">{t('suggestionsDescription')}</p>
            </div>
            <div className="flex flex-wrap items-end gap-3">
              <div className="flex flex-col gap-2">
                <Label htmlFor="keyword-suggestion-count">{t('suggestionsCountLabel')}</Label>
                <select
                  id="keyword-suggestion-count"
                  className="border-input bg-background rounded-md border px-3 py-2 text-sm"
                  value={suggestionCount}
                  onChange={(event) => setSuggestionCount(Number(event.target.value))}
                >
                  {[10, 20, 50, 100].map((count) => (
                    <option key={count} value={count}>
                      {count}
                    </option>
                  ))}
                </select>
              </div>
              <Button
                type="button"
                variant="outline"
                loading={suggestionsLoading}
                loadingLabel={t('suggestionsLoading')}
                onClick={() => void discover()}
              >
                {t('suggestionsFind')}
              </Button>
            </div>
            {suggestionsError ? (
              <Alert variant="destructive" role="alert" data-testid="keyword-suggestions-error">
                <AlertDescription>{suggestionsError}</AlertDescription>
              </Alert>
            ) : null}
            {suggestions?.fallbackStatus === 'provider_unavailable' ? (
              <Alert role="status" data-testid="keyword-suggestions-unavailable">
                <AlertDescription>{t('suggestionsPartialUnavailable')}</AlertDescription>
              </Alert>
            ) : null}
            {suggestions ? (
              <div className="flex flex-col gap-2" aria-live="polite">
                <p className="text-muted-foreground text-sm">
                  {t(
                    isBlended
                      ? 'suggestionsBlendedSource'
                      : isGscSource
                        ? 'suggestionsGscSource'
                        : showsRankingColumns
                          ? 'suggestionsRankedSource'
                          : 'suggestionsIdeaSource',
                  )}
                </p>
                {visibleSuggestions.length === 0 ? (
                  <p
                    className="text-muted-foreground text-sm"
                    data-testid="keyword-suggestions-empty"
                  >
                    {t('suggestionsEmpty')}
                  </p>
                ) : (
                  <div className="flex flex-col gap-2">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <p className="text-muted-foreground text-sm" role="status">
                        {t('suggestionsSelectedCount', {
                          count: selectedVisibleSuggestions.length,
                        })}
                      </p>
                      <Button
                        type="button"
                        size="sm"
                        variant="outline"
                        disabled={selectedVisibleSuggestions.length === 0}
                        onClick={useSelectedSuggestions}
                      >
                        {t('suggestionsUseSelected', { count: selectedVisibleSuggestions.length })}
                      </Button>
                    </div>
                    <Table data-testid="keyword-suggestions-table">
                      <TableHeader>
                        <TableRow>
                          <TableHead className="w-10">
                            <Checkbox
                              aria-label={t('suggestionsSelectAll')}
                              checked={
                                allVisibleSelected
                                  ? true
                                  : someVisibleSelected
                                    ? 'indeterminate'
                                    : false
                              }
                              disabled={selectableSuggestions.length === 0}
                              onCheckedChange={(checked) => toggleAllVisible(checked === true)}
                            />
                          </TableHead>
                          <TableHead>{t('suggestionsKeyword')}</TableHead>
                          <TableHead>
                            <TableHeaderHelp
                              label={t('suggestionsVolume')}
                              description={t('common:tableHelp.searchVolume')}
                            />
                          </TableHead>
                          {showsRankingColumns ? (
                            <TableHead>
                              <TableHeaderHelp
                                label={t(
                                  isBlended
                                    ? 'suggestionsPositionBlended'
                                    : isGscSource
                                      ? 'suggestionsAvgPosition'
                                      : 'suggestionsPosition',
                                )}
                                description={t(
                                  isGscSource
                                    ? 'common:tableHelp.averagePosition'
                                    : 'common:tableHelp.position',
                                )}
                              />
                            </TableHead>
                          ) : null}
                          {showsDifficulty ? (
                            <TableHead>
                              <TableHeaderHelp
                                label={t('suggestionsDifficulty')}
                                description={t('common:tableHelp.keywordDifficulty')}
                              />
                            </TableHead>
                          ) : null}
                          {showsRankingColumns ? (
                            <TableHead>
                              <TableHeaderHelp
                                label={t(
                                  isBlended
                                    ? 'suggestionsTrafficBlended'
                                    : isGscSource
                                      ? 'suggestionsClicks'
                                      : 'suggestionsTraffic',
                                )}
                                description={t(
                                  isGscSource
                                    ? 'common:tableHelp.clicks'
                                    : 'common:tableHelp.estimatedTraffic',
                                )}
                              />
                            </TableHead>
                          ) : null}
                          {isBlended ? <TableHead>{t('suggestionsSource')}</TableHead> : null}
                          <TableHead>
                            <span className="sr-only">{t('suggestionsAction')}</span>
                          </TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {visibleSuggestions.map((candidate) => {
                          const key = normalizeKeywordPhrase(candidate.keyword);
                          return (
                            <TableRow key={candidate.keyword}>
                              <TableCell>
                                <Checkbox
                                  aria-label={t('suggestionsSelectRow', {
                                    keyword: candidate.keyword,
                                  })}
                                  checked={selectedSuggestions.has(key)}
                                  disabled={candidate.tracked}
                                  onCheckedChange={(checked) =>
                                    toggleSuggestion(candidate.keyword, checked === true)
                                  }
                                />
                              </TableCell>
                              <TableCell className="max-w-64 whitespace-normal font-medium">
                                {candidate.rankingUrl ? (
                                  <a
                                    className="underline-offset-4 hover:underline focus-visible:underline"
                                    href={safeExternalHref(candidate.rankingUrl)}
                                    target="_blank"
                                    rel="nofollow ugc noopener noreferrer"
                                  >
                                    {candidate.keyword}
                                  </a>
                                ) : (
                                  candidate.keyword
                                )}
                              </TableCell>
                              <TableCell>
                                {candidate.searchVolume?.toLocaleString(i18n.language) ?? '—'}
                              </TableCell>
                              {showsRankingColumns ? (
                                <TableCell>
                                  {candidate.currentPosition?.toLocaleString(i18n.language, {
                                    maximumFractionDigits: 1,
                                  }) ?? '—'}
                                </TableCell>
                              ) : null}
                              {showsDifficulty ? (
                                <TableCell>{candidate.difficulty ?? '—'}</TableCell>
                              ) : null}
                              {showsRankingColumns ? (
                                <TableCell>
                                  {candidate.estimatedTraffic?.toLocaleString(i18n.language) ?? '—'}
                                </TableCell>
                              ) : null}
                              {isBlended ? (
                                <TableCell>
                                  <span className="text-muted-foreground text-xs">
                                    {t(
                                      candidate.source === 'gsc'
                                        ? 'suggestionsSourceGsc'
                                        : candidate.source === 'ranked'
                                          ? 'suggestionsSourceRanked'
                                          : 'suggestionsSourceIdea',
                                    )}
                                  </span>
                                </TableCell>
                              ) : null}
                              <TableCell>
                                <Button
                                  type="button"
                                  size="sm"
                                  variant="outline"
                                  disabled={candidate.tracked}
                                  onClick={() => chooseSuggestion(candidate.keyword)}
                                >
                                  {t(
                                    candidate.tracked ? 'suggestionsTracked' : 'suggestionsSelect',
                                  )}
                                </Button>
                              </TableCell>
                            </TableRow>
                          );
                        })}
                      </TableBody>
                    </Table>
                  </div>
                )}
              </div>
            ) : null}
          </div>
          <fieldset className="flex flex-col gap-2" data-testid="keyword-engine-picker">
            <legend className="text-sm font-medium">{t('engine.pickerLabel')}</legend>
            <p id="keyword-engine-hint" className="text-muted-foreground text-sm">
              {t('engine.pickerHint')}
            </p>
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-4">
              {RANK_ENGINES.map((option) => (
                <label
                  key={option}
                  htmlFor={`keyword-engine-${option}`}
                  className={cn(
                    'border-border flex cursor-pointer items-start gap-2 rounded-lg border p-3 text-sm',
                    engine === option && 'border-primary',
                  )}
                >
                  <input
                    id={`keyword-engine-${option}`}
                    type="radio"
                    value={option}
                    className="mt-1 cursor-pointer"
                    aria-describedby="keyword-engine-hint"
                    {...register('engine')}
                  />
                  <span className="flex flex-col gap-1">
                    <span className="font-medium">{t(`engine.name.${option}`)}</span>
                    <span className="text-muted-foreground">{t(`engine.match.${option}`)}</span>
                  </span>
                </label>
              ))}
            </div>
          </fieldset>
          {needsTarget ? (
            <div className="flex flex-col gap-2" data-testid="keyword-engine-target">
              <Label htmlFor="keyword-engine-target-input">
                {t(engine === 'youtube' ? 'engine.targetLabelYoutube' : 'engine.targetLabelAmazon')}
              </Label>
              <input
                id="keyword-engine-target-input"
                type="text"
                autoComplete="off"
                className="border-input bg-background rounded-md border px-3 py-2 text-sm"
                placeholder={t(
                  engine === 'youtube'
                    ? 'engine.targetPlaceholderYoutube'
                    : 'engine.targetPlaceholderAmazon',
                )}
                aria-invalid={!!errors.engineTarget}
                aria-describedby={
                  errors.engineTarget
                    ? 'keyword-engine-target-hint keyword-engine-target-error'
                    : 'keyword-engine-target-hint'
                }
                {...register('engineTarget')}
              />
              <p id="keyword-engine-target-hint" className="text-muted-foreground text-sm">
                {t(engine === 'youtube' ? 'engine.targetHintYoutube' : 'engine.targetHintAmazon')}
              </p>
              {errors.engineTarget ? (
                <p
                  id="keyword-engine-target-error"
                  role="alert"
                  className="text-destructive text-sm"
                >
                  {errors.engineTarget.message}
                </p>
              ) : null}
            </div>
          ) : null}
          {isAltRankEngine(engine) ? (
            <div
              className="border-border flex flex-col gap-2 rounded-lg border p-4"
              data-testid="alt-engine-preview"
              aria-live="polite"
            >
              <h3 className="font-medium">{t('engine.previewTitle')}</h3>
              {previewLoading ? (
                <p className="text-muted-foreground text-sm">{t('engine.previewLoading')}</p>
              ) : previewError ? (
                <Alert variant="destructive" role="alert" data-testid="alt-engine-preview-error">
                  <AlertDescription>{previewError}</AlertDescription>
                </Alert>
              ) : preview ? (
                <>
                  <p className="text-muted-foreground text-sm">{t('engine.previewUnit')}</p>
                  <p className="text-sm" data-testid="alt-engine-preview-usage">
                    {t('common:capacity.selfHost')}
                  </p>
                </>
              ) : null}
            </div>
          ) : null}
          <div className="flex flex-col gap-2">
            <Label htmlFor="keyword-phrase">{t('addPhraseLabel')}</Label>
            <Textarea
              id="keyword-phrase"
              placeholder={t('addPhrasePlaceholder')}
              autoComplete="off"
              aria-invalid={!!errors.phrase}
              aria-describedby={
                errors.phrase ? 'keyword-phrase-hint keyword-phrase-error' : 'keyword-phrase-hint'
              }
              {...register('phrase')}
            />
            <p id="keyword-phrase-hint" className="text-muted-foreground text-sm">
              {t('addPhraseHint')}
            </p>
            {errors.phrase ? (
              <p id="keyword-phrase-error" role="alert" className="text-destructive text-sm">
                {errors.phrase.message}
              </p>
            ) : null}
            {engine === 'google' ? (
              <div
                className="bg-muted/30 flex flex-wrap items-center justify-between gap-3 rounded-md border p-3"
                data-testid="keyword-long-tail-research"
              >
                <div>
                  <p className="text-sm font-medium">{t('longTailResearch.title')}</p>
                  <p className="text-muted-foreground text-sm">
                    {t('longTailResearch.description')}
                  </p>
                </div>
                {researchUrl ? (
                  <Button type="button" variant="outline" asChild>
                    <Link to={researchUrl} data-testid="keyword-long-tail-research-link">
                      {t('longTailResearch.cta')}
                    </Link>
                  </Button>
                ) : (
                  <Button
                    type="button"
                    variant="outline"
                    disabled
                    data-testid="keyword-long-tail-research-disabled"
                  >
                    {t('longTailResearch.cta')}
                  </Button>
                )}
              </div>
            ) : null}
          </div>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
            <div className="flex flex-col gap-2">
              <Label htmlFor="keyword-location">{t('addLocationLabel')}</Label>
              <CountryCombobox
                id="keyword-location"
                value={selectedMarket?.countryCode ?? countryCodeForLocation(locationCode)}
                markets={catalog.markets}
                loading={catalog.loading}
                disabled={catalog.error}
                invalid={catalog.error || Boolean(errors.locationCode)}
                describedBy={catalog.error ? 'keyword-location-error' : undefined}
                onValueChange={(_countryCode, market) => {
                  if (market?.locationCode) {
                    setValue('locationCode', market.locationCode, {
                      shouldDirty: true,
                      shouldValidate: true,
                    });
                  }
                }}
              />
              {catalog.error ? (
                <p id="keyword-location-error" role="alert" className="text-destructive text-sm">
                  {t('common:market.loadError')}
                </p>
              ) : null}
            </div>
            <div className="flex flex-col gap-2">
              <Label htmlFor="keyword-language">{t('addLanguageLabel')}</Label>
              <select
                id="keyword-language"
                className="border-input bg-background rounded-md border px-3 py-2 text-sm"
                {...register('languageCode')}
              >
                {availableLanguages.map((lang) => (
                  <option key={lang} value={lang}>
                    {languageName(lang, i18n.language) ?? lang}
                  </option>
                ))}
              </select>
            </div>
            <div className="flex flex-col gap-2">
              <Label htmlFor="keyword-device">{t('addDeviceLabel')}</Label>
              <select
                id="keyword-device"
                className="border-input bg-background rounded-md border px-3 py-2 text-sm"
                {...register('device')}
              >
                {DEVICE_OPTIONS.map((d) => (
                  <option key={d} value={d}>
                    {t(d === 'desktop' ? 'deviceDesktop' : 'deviceMobile')}
                  </option>
                ))}
              </select>
            </div>
          </div>
          <Button
            type="submit"
            loading={submitting}
            loadingLabel={t('addSubmitting')}
            disabled={catalog.error}
          >
            {t('addSubmit')}
          </Button>
        </form>
      </CardContent>
    </Card>
  );
};

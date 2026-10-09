/**
 * Keyword gap view.
 *
 * Flow: form (own domain + one-to-three competitors, client zod mirror of
 * the server bounds incl. dedupe/own-domain-conflict refinements) →
 * server spend preview (`POST /preview`, free and reservation-free) →
 * explicit confirm (`POST /gap`, one keyword_lookups unit per deduped
 * competitor) → per-pair tables with URL-backed filters. Cancelling the
 * preview discards it without any request or unit.
 *
 * "Your domain" starts from one of the account's sites (the `?siteId=` one,
 * otherwise the first) and a site picker switches between them; the field
 * stays editable so any other domain can still be typed.
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { Alert, AlertDescription } from '@shared/ui/alert';
import { Button } from '@shared/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@shared/ui/card';
import { Input } from '@shared/ui/input';
import { Label } from '@shared/ui/label';
import { NativeSelect } from '@shared/ui/native-select';
import { Skeleton } from '@shared/ui/skeleton';
import { useAppDispatch, useAppSelector } from '@shared/hooks/redux';
import { siteLabel } from '@shared/lib/siteLabel';
import { loadSites, selectSites, selectSitesLoaded, selectSitesLoading } from '@features/sites';
import { fetchKeywordPreview, runGap } from '../store/thunks';
import { clearPreview } from '../store/slice';
import { selectGap, selectPreview } from '../store/selectors';
import {
  DEFAULT_LANGUAGE_CODE,
  DEFAULT_LOCATION_CODE,
  GAP_COMPETITORS_MAX,
  gapFormSchema,
} from '../validation';
import { useKeywordWorkspaceQuery } from '../tabState';
import { GapResultsTable } from './GapResultsTable';
import { KeywordSpendPreviewCard } from './KeywordSpendPreviewCard';
import { MarketSelects } from './MarketSelects';
import { PhraseChipsInput } from './PhraseChipsInput';
import type { GapRequestBody } from '../api';

export const GapView = () => {
  const { t } = useTranslation();
  const dispatch = useAppDispatch();
  const preview = useAppSelector(selectPreview);
  const gap = useAppSelector(selectGap);
  const sites = useAppSelector(selectSites);
  const sitesLoaded = useAppSelector(selectSitesLoaded);
  const sitesLoading = useAppSelector(selectSitesLoading);
  const [query, setQuery] = useKeywordWorkspaceQuery();
  const [searchParams] = useSearchParams();

  const [ownDomain, setOwnDomain] = useState('');
  const [competitors, setCompetitors] = useState<string[]>([]);
  const [locationCode, setLocationCode] = useState(DEFAULT_LOCATION_CODE);
  const [languageCode, setLanguageCode] = useState(DEFAULT_LANGUAGE_CODE);
  const [formError, setFormError] = useState('');
  const [pendingBody, setPendingBody] = useState<GapRequestBody | null>(null);
  const ownDomainTouched = useRef(false);
  const selectedSiteId = searchParams.get('siteId');

  useEffect(() => {
    if (sitesLoaded || sitesLoading) return;
    void dispatch(loadSites({ direction: 'initial' }));
  }, [dispatch, sitesLoaded, sitesLoading]);

  // Prefill once the sites arrive, but never overwrite what the user typed or picked.
  useEffect(() => {
    if (ownDomainTouched.current || sites.length === 0) return;
    const preferred = sites.find((site) => site.id === selectedSiteId) ?? sites[0]!;
    setOwnDomain(preferred.domain);
  }, [sites, selectedSiteId]);

  const changeOwnDomain = (value: string) => {
    ownDomainTouched.current = true;
    setOwnDomain(value);
  };
  // The picker mirrors the field: it shows a site while the text equals that
  // site's domain, and "another domain" for anything else.
  const pickedSiteId = sites.find((site) => site.domain === ownDomain.trim())?.id ?? '';
  const workspaceHref = useMemo(() => {
    const siteId = searchParams.get('siteId');
    if (!siteId) return null;
    const hasLocalInput = ownDomain.trim().length > 0 || competitors.length > 0;
    const preservedDomain = ownDomain.trim() || gap.data?.ownDomain || '';
    const preservedCompetitors = competitors.length > 0
      ? competitors
      : (gap.data?.pairs.map((pair) => pair.competitorDomain) ?? []);
    const storedMarket = gap.data?.pairs[0]?.meta.market;
    const params = new URLSearchParams({ tab: 'competitors', view: 'keywords' });
    if (preservedDomain) params.set('ownedDomain', preservedDomain);
    if (preservedCompetitors.length > 0) params.set('competitors', preservedCompetitors.join(','));
    params.set('locationCode', String(hasLocalInput ? locationCode : (storedMarket?.locationCode ?? locationCode)));
    params.set('languageCode', hasLocalInput ? languageCode : (storedMarket?.languageCode ?? languageCode));
    return `/sites/${encodeURIComponent(siteId)}?${params.toString()}`;
  }, [competitors, gap.data, languageCode, locationCode, ownDomain, searchParams]);

  const requestPreview = (e: React.FormEvent) => {
    e.preventDefault();
    const parsed = gapFormSchema.safeParse({
      ownDomain,
      competitors,
      locationCode,
      languageCode,
    });
    if (!parsed.success) {
      const message = parsed.error.issues[0]?.message ?? '';
      setFormError(t(message));
      return;
    }
    setFormError('');
    setPendingBody(parsed.data);
    void dispatch(fetchKeywordPreview({ operation: 'gap', ...parsed.data }));
  };

  const confirmRun = () => {
    if (!pendingBody) return;
    void dispatch(runGap(pendingBody));
  };

  const cancelPreview = () => {
    setPendingBody(null);
    dispatch(clearPreview());
  };

  const previewOpen =
    preview.forOperation === 'gap' && (preview.loading || preview.data !== null);

  return (
    <div className="flex flex-col gap-5" data-testid="kw-gap-view">
      <Card>
        <CardHeader>
          <CardTitle>{t('keywordResearch:gap.title')}</CardTitle>
          <p className="text-muted-foreground text-sm">
            {t('keywordResearch:gap.description')}
          </p>
        </CardHeader>
        <CardContent>
          <form
            onSubmit={requestPreview}
            className="flex flex-col gap-4"
            data-testid="kw-gap-form"
          >
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="kw-gap-own-domain">
                {t('keywordResearch:gap.ownDomainLabel')}
              </Label>
              {sites.length > 0 ? (
                <NativeSelect
                  aria-label={t('keywordResearch:gap.siteLabel')}
                  value={pickedSiteId}
                  wrapperClassName="sm:w-72"
                  onChange={(e) =>
                    changeOwnDomain(sites.find((site) => site.id === e.target.value)?.domain ?? '')
                  }
                  data-testid="kw-gap-site"
                >
                  {sites.map((site) => (
                    <option key={site.id} value={site.id}>
                      {siteLabel(site)}
                    </option>
                  ))}
                  <option value="">{t('keywordResearch:gap.otherDomain')}</option>
                </NativeSelect>
              ) : null}
              <Input
                id="kw-gap-own-domain"
                dir="ltr"
                value={ownDomain}
                maxLength={253}
                placeholder="example.com"
                onChange={(e) => changeOwnDomain(e.target.value)}
                data-testid="kw-gap-own-domain"
              />
            </div>
            <PhraseChipsInput
              id="kw-gap-competitors"
              label={t('keywordResearch:gap.competitorsLabel')}
              placeholder="competitor.com"
              chips={competitors}
              onChange={setCompetitors}
              max={GAP_COMPETITORS_MAX}
              maxLength={253}
              testIdPrefix="kw-gap-competitor"
            />
            <MarketSelects
              locationCode={locationCode}
              languageCode={languageCode}
              onLocationChange={setLocationCode}
              onLanguageChange={setLanguageCode}
              testIdPrefix="kw-gap"
            />
            {formError ? (
              <p
                role="alert"
                className="text-destructive text-sm"
                data-testid="kw-gap-form-error"
              >
                {formError}
              </p>
            ) : null}
            <div>
              <Button
                type="submit"
                loading={preview.loading && preview.forOperation === 'gap'}
                loadingLabel={t('keywordResearch:preview.loading')}
                data-testid="kw-gap-preview-cta"
              >
                {t('keywordResearch:preview.cta')}
              </Button>
            </div>
          </form>
        </CardContent>
      </Card>

      {preview.error && preview.forOperation === 'gap' ? (
        <Alert variant="destructive" role="alert" data-testid="kw-gap-preview-error">
          <AlertDescription>{preview.error}</AlertDescription>
        </Alert>
      ) : null}

      {previewOpen ? (
        <div className="flex flex-col gap-3">
          <KeywordSpendPreviewCard preview={preview.data} loading={preview.loading} />
          {preview.data ? (
            <div className="flex gap-2">
              <Button
                onClick={confirmRun}
                loading={gap.loading}
                loadingLabel={t('keywordResearch:gap.submitting')}
                data-testid="kw-gap-confirm"
              >
                {t('keywordResearch:preview.confirm')}
              </Button>
              <Button
                variant="outline"
                onClick={cancelPreview}
                disabled={gap.loading}
                data-testid="kw-gap-cancel"
              >
                {t('keywordResearch:preview.cancel')}
              </Button>
            </div>
          ) : null}
        </div>
      ) : null}

      {gap.error ? (
        <Alert variant="destructive" role="alert" data-testid="kw-gap-error">
          <AlertDescription>{gap.error}</AlertDescription>
        </Alert>
      ) : null}

      {gap.loading && !gap.data ? (
        <div aria-busy="true" aria-live="polite" data-testid="kw-gap-loading">
          <Skeleton className="h-40 w-full" />
        </div>
      ) : null}

      {gap.data ? (
        <div className="flex flex-col gap-3">
          {workspaceHref ? (
            <Button asChild variant="outline">
              <Link to={workspaceHref} data-testid="kw-gap-site-workspace-link">
                {t('keywordResearch:gap.siteWorkspaceLink')}
              </Link>
            </Button>
          ) : null}
          <GapResultsTable data={gap.data} query={query} onQueryChange={setQuery} />
        </div>
      ) : !gap.loading && !gap.error && !previewOpen ? (
        <p className="text-muted-foreground text-sm" data-testid="kw-gap-idle">
          {t('keywordResearch:gap.idle')}
        </p>
      ) : null}
    </div>
  );
};

import { useCallback, useEffect, useId, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@shared/ui/card';
import { Button } from '@shared/ui/button';
import { Input } from '@shared/ui/input';
import { Label } from '@shared/ui/label';
import { Field, FieldError, FieldGroup, FieldLabel } from '@shared/ui/field';
import { Checkbox } from '@shared/ui/checkbox';
import { Alert, AlertDescription, AlertTitle } from '@shared/ui/alert';
import { Empty, EmptyContent, EmptyDescription, EmptyMedia, EmptyTitle } from '@shared/ui/empty';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from '@shared/ui/alert-dialog';
import { ExternalLink } from 'lucide-react';
import { safeExternalHref } from '@shared/security';
import {
  fetchLandscapeDetail,
  reviewLandscapePageMatch,
  type LandscapeDetail,
} from '@features/competitors';
import { useAppDispatch, useAppSelector } from '@shared/hooks/redux';
import { clearCompetitorSubmitError } from '../../store/slice';
import { startCompetitorRunThunk } from '../../store/thunks';
import {
  selectCompetitorProfiles,
  selectCompetitorSubmitError,
  selectCompetitorSubmitting,
} from '../../store/selectors';
import { errorMessage } from '../../errorMessage';
import {
  COMPETITOR_CONTENT_PAGES_PER_RUN,
  COMPETITOR_PORTFOLIO_MAX_COMPETITORS,
} from '../../types';

interface RunSetupFormProps {
  siteId: string;
  /** True when an in-flight run blocks starting another. */
  disabled?: boolean | undefined;
  onStarted?: ((runId: string) => void) | undefined;
}

function isValidHttpUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === 'https:' || url.protocol === 'http:';
  } catch {
    return false;
  }
}

function makeClientKey(): string {
  const rand = Math.random().toString(36).slice(2, 10);
  return `cc-${Date.now().toString(36)}-${rand}`;
}

/**
 * Start a paid competitor comparison run. Competitor selection is bounded to the
 * confirmed active portfolio (≤ MAX). The transparent disclosure states the run
 * reserves exactly one `competitor_content_runs` unit and scrapes up to
 * `COMPETITOR_CONTENT_PAGES_PER_RUN` pages. The server re-validates every bound.
 */
export function RunSetupForm(props: RunSetupFormProps) {
  const [params] = useSearchParams();
  const reportId = params.get('landscapeReport');
  const suggestionId = params.get('match');
  const opportunityId = params.get('opportunity');
  if (reportId && suggestionId) {
    return (
      <ReviewedRunSetupForm
        {...props}
        reportId={reportId}
        suggestionId={suggestionId}
        opportunityId={opportunityId}
      />
    );
  }
  return <LegacyRunSetupForm {...props} />;
}

function ReviewedRunSetupForm({
  siteId,
  disabled,
  onStarted,
  reportId,
  suggestionId,
  opportunityId,
}: RunSetupFormProps & {
  reportId: string;
  suggestionId: string;
  opportunityId: string | null;
}) {
  const { t, i18n } = useTranslation('contentIntelligence');
  const dispatch = useAppDispatch();
  const submitting = useAppSelector(selectCompetitorSubmitting);
  const submitError = useAppSelector(selectCompetitorSubmitError);
  const [detail, setDetail] = useState<LandscapeDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');
  const [ownedUrl, setOwnedUrl] = useState('');
  const [competitorUrl, setCompetitorUrl] = useState('');
  const [keyword, setKeyword] = useState('');
  const [reviewVersion, setReviewVersion] = useState(0);
  const [reviewing, setReviewing] = useState(false);
  const [actionError, setActionError] = useState('');

  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    void fetchLandscapeDetail(siteId, reportId, { signal: controller.signal })
      .then((value) => {
        const suggestion = value.manifest?.pageSuggestions.find((item) => item.id === suggestionId);
        if (!suggestion) throw new Error(t('competitorContent.run.reviewed.notFound'));
        setDetail(value);
        setOwnedUrl(suggestion.review.ownedUrl ?? suggestion.ownedUrl);
        setCompetitorUrl(suggestion.review.competitorUrl ?? suggestion.competitorUrl);
        setKeyword(suggestion.keywordKeys[0] ?? '');
        setReviewVersion(suggestion.review.version);
        setLoadError('');
      })
      .catch((cause: unknown) => {
        if (!controller.signal.aborted) {
          setLoadError(cause instanceof Error ? cause.message : t('competitorContent.run.reviewed.loadFailed'));
        }
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, [reportId, siteId, suggestionId, t]);

  const suggestion = detail?.manifest?.pageSuggestions.find((item) => item.id === suggestionId);
  const valid = isValidHttpUrl(ownedUrl) && isValidHttpUrl(competitorUrl);
  const confirm = async () => {
    if (!suggestion || submitting || reviewing || disabled || !valid) return;
    setReviewing(true);
    setActionError('');
    try {
      const reviewed = await reviewLandscapePageMatch(
        siteId,
        reportId,
        suggestionId,
        { decision: 'approved', ownedUrl, competitorUrl, version: reviewVersion },
        `content-review-${suggestionId}-${Date.now().toString(36)}`,
      );
      setReviewVersion(reviewed.review.version);
      const result = await dispatch(startCompetitorRunThunk({
        siteId,
        competitorIds: [],
        reviewedPageMatches: [{
          landscapeReportId: reportId,
          ...(opportunityId ? { landscapeOpportunityId: opportunityId } : {}),
          suggestionId,
        }],
        keyword: keyword.trim() || undefined,
        pageLimit: 1,
        locale: i18n.language.split('-')[0]!,
        clientKey: makeClientKey(),
      }));
      if (startCompetitorRunThunk.fulfilled.match(result)) onStarted?.(result.payload.runId);
    } catch (cause) {
      setActionError(errorMessage(cause));
    } finally {
      setReviewing(false);
    }
  };

  const suggestedHref = suggestion ? safeExternalHref(suggestion.competitorUrl) : '#';

  return <Card data-testid="competitor-reviewed-run-setup">
    <CardHeader>
      <CardTitle>{t('competitorContent.run.reviewed.title')}</CardTitle>
      <CardDescription>{t('competitorContent.run.reviewed.description')}</CardDescription>
    </CardHeader>
    <CardContent className="flex flex-col gap-4">
      {loading ? <p aria-busy="true">{t('competitorContent.run.reviewed.loading')}</p> : null}
      {loadError ? <Alert variant="destructive"><AlertDescription>{loadError}</AlertDescription></Alert> : null}
      {suggestion ? <>
        <div className="flex flex-col gap-1 rounded-md border p-3">
          <span className="text-sm font-medium">{t('competitorContent.run.reviewed.evidence')}</span>
          <span className="text-muted-foreground text-sm">{suggestion.keywordKeys.join(', ')}</span>
          {suggestedHref === '#' ? (
            <span className="text-muted-foreground text-sm">{suggestion.competitorUrl}</span>
          ) : (
            <a
              href={suggestedHref}
              target="_blank"
              rel="nofollow ugc noopener noreferrer"
              className="inline-flex items-center gap-1 text-sm underline underline-offset-2"
            >
              {t('competitorContent.run.reviewed.openSuggested')}
              <ExternalLink aria-hidden="true" data-icon="inline-end" />
            </a>
          )}
        </div>
        <FieldGroup className="grid gap-3 md:grid-cols-2">
          <Field data-invalid={ownedUrl.length > 0 && !isValidHttpUrl(ownedUrl)}>
            <FieldLabel htmlFor="reviewed-owned-url">{t('competitorContent.run.ownedUrl')}</FieldLabel>
            <Input
              id="reviewed-owned-url"
              type="url"
              value={ownedUrl}
              aria-invalid={ownedUrl.length > 0 && !isValidHttpUrl(ownedUrl)}
              onChange={(event) => {
                setOwnedUrl(event.target.value);
                setActionError('');
              }}
            />
          </Field>
          <Field data-invalid={competitorUrl.length > 0 && !isValidHttpUrl(competitorUrl)}>
            <FieldLabel htmlFor="reviewed-competitor-url">
              {t('competitorContent.run.reviewed.competitorUrl')}
            </FieldLabel>
            <Input
              id="reviewed-competitor-url"
              type="url"
              value={competitorUrl}
              aria-invalid={competitorUrl.length > 0 && !isValidHttpUrl(competitorUrl)}
              onChange={(event) => {
                setCompetitorUrl(event.target.value);
                setActionError('');
              }}
            />
          </Field>
        </FieldGroup>
        <Field>
          <FieldLabel htmlFor="reviewed-keyword">{t('competitorContent.run.keyword')}</FieldLabel>
          <Input id="reviewed-keyword" value={keyword} onChange={(event) => setKeyword(event.target.value)} />
        </Field>
        <Alert><AlertTitle>{t('competitorContent.run.disclosureTitle')}</AlertTitle><AlertDescription>{t('competitorContent.run.reviewed.disclosure')}</AlertDescription></Alert>
        {submitError || actionError ? <Alert variant="destructive"><AlertDescription>{actionError || submitError}</AlertDescription></Alert> : null}
        {!valid ? <FieldError>{t('competitorContent.run.errors.invalidUrl')}</FieldError> : null}
        <AlertDialog>
          <AlertDialogTrigger asChild><Button disabled={!valid || disabled || submitting || reviewing} loading={submitting || reviewing}>{t('competitorContent.run.reviewed.reviewAction')}</Button></AlertDialogTrigger>
          <AlertDialogContent>
            <AlertDialogHeader><AlertDialogTitle>{t('competitorContent.run.reviewed.confirmTitle')}</AlertDialogTitle><AlertDialogDescription>{t('competitorContent.run.reviewed.confirmDescription')}</AlertDialogDescription></AlertDialogHeader>
            <AlertDialogFooter><AlertDialogCancel>{t('competitorContent.run.reviewed.cancel')}</AlertDialogCancel><AlertDialogAction disabled={reviewing || submitting} onClick={() => void confirm()}>{t('competitorContent.run.reviewed.confirm')}</AlertDialogAction></AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </> : null}
    </CardContent>
  </Card>;
}

function LegacyRunSetupForm({ siteId, disabled, onStarted }: RunSetupFormProps) {
  const { t, i18n } = useTranslation('contentIntelligence');
  const dispatch = useAppDispatch();
  const profiles = useAppSelector(selectCompetitorProfiles);
  const submitting = useAppSelector(selectCompetitorSubmitting);
  const submitError = useAppSelector(selectCompetitorSubmitError);

  const active = useMemo(() => profiles.filter((p) => p.status === 'active'), [profiles]);

  const [selected, setSelected] = useState<Record<string, boolean>>({});
  const [competitorUrls, setCompetitorUrls] = useState<Record<string, string>>({});
  const [ownedUrl, setOwnedUrl] = useState('');
  const [keyword, setKeyword] = useState('');
  const [pageLimit, setPageLimit] = useState(String(COMPETITOR_CONTENT_PAGES_PER_RUN));
  const [inlineErrorKey, setInlineErrorKey] = useState<string | null>(null);

  const ownedId = useId();
  const keywordId = useId();
  const pageLimitId = useId();

  const selectedIds = useMemo(
    () => active.filter((p) => selected[p.id]).map((p) => p.id),
    [active, selected],
  );
  const pageLimitNum = Number.parseInt(pageLimit, 10);
  const validPageLimit =
    Number.isInteger(pageLimitNum) &&
    pageLimitNum >= 1 &&
    pageLimitNum <= COMPETITOR_CONTENT_PAGES_PER_RUN;

  const onField = useCallback(() => {
    setInlineErrorKey(null);
    if (submitError) dispatch(clearCompetitorSubmitError());
  }, [dispatch, submitError]);

  const toggle = useCallback(
    (id: string, checked: boolean) => {
      setSelected((prev) => ({ ...prev, [id]: checked }));
      onField();
    },
    [onField],
  );

  const validate = useCallback((): string | null => {
    if (selectedIds.length === 0) return 'competitorContent.run.errors.noSelection';
    if (selectedIds.length > COMPETITOR_PORTFOLIO_MAX_COMPETITORS) {
      return 'competitorContent.run.errors.tooMany';
    }
    if (!isValidHttpUrl(ownedUrl.trim())) return 'competitorContent.run.errors.invalidUrl';
    if (selectedIds.some((id) => !isValidHttpUrl((competitorUrls[id] ?? '').trim()))) {
      return 'competitorContent.run.errors.invalidCompetitorUrl';
    }
    if (!validPageLimit) return 'competitorContent.run.errors.pageLimitRange';
    return null;
  }, [competitorUrls, ownedUrl, selectedIds, validPageLimit]);

  const onSubmit = useCallback(
    async (e: React.FormEvent<HTMLFormElement>) => {
      e.preventDefault();
      if (submitting || disabled) return;
      const error = validate();
      if (error) {
        setInlineErrorKey(error);
        return;
      }
      const trimmedKeyword = keyword.trim();
      const result = await dispatch(
        startCompetitorRunThunk({
          siteId,
          competitorIds: selectedIds,
          competitorUrls: selectedIds.map((competitorId) => ({
            competitorId,
            url: competitorUrls[competitorId]!.trim(),
          })),
          ownedUrl: ownedUrl.trim(),
          ...(trimmedKeyword ? { keyword: trimmedKeyword } : {}),
          pageLimit: pageLimitNum,
          locale: i18n.language.split('-')[0]!,
          clientKey: makeClientKey(),
        }),
      );
      if (startCompetitorRunThunk.fulfilled.match(result)) {
        onStarted?.(result.payload.runId);
      }
    },
    [
      disabled,
      dispatch,
      i18n.language,
      keyword,
      competitorUrls,
      onStarted,
      ownedUrl,
      pageLimitNum,
      selectedIds,
      siteId,
      submitting,
      validate,
    ],
  );

  if (active.length === 0) {
    return (
      <Card data-testid="competitor-run-setup">
        <CardHeader>
          <CardTitle>{t('competitorContent.run.title')}</CardTitle>
          <CardDescription>{t('competitorContent.run.description')}</CardDescription>
        </CardHeader>
        <CardContent>
          <Empty data-testid="competitor-run-no-competitors">
            <EmptyMedia />
            <EmptyContent>
              <EmptyTitle>{t('competitorContent.run.noCompetitors.title')}</EmptyTitle>
              <EmptyDescription>
                {t('competitorContent.run.noCompetitors.description')}
              </EmptyDescription>
            </EmptyContent>
          </Empty>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card data-testid="competitor-run-setup">
      <CardHeader>
        <CardTitle>{t('competitorContent.run.title')}</CardTitle>
        <CardDescription>{t('competitorContent.run.description')}</CardDescription>
      </CardHeader>
      <CardContent>
        <form onSubmit={onSubmit} className="flex flex-col gap-4" noValidate>
          <fieldset className="flex flex-col gap-2">
            <legend className="text-sm font-medium">
              {t('competitorContent.run.selectCompetitors', {
                max: COMPETITOR_PORTFOLIO_MAX_COMPETITORS,
              })}
            </legend>
            <div className="flex flex-col gap-2" data-testid="competitor-run-selection">
              {active.map((p) => (
                <div key={p.id} className="flex flex-col gap-2">
                  <label className="flex items-center gap-2 text-sm" htmlFor={`cc-select-${p.id}`}>
                    <Checkbox
                      id={`cc-select-${p.id}`}
                      checked={Boolean(selected[p.id])}
                      onCheckedChange={(v) => toggle(p.id, v === true)}
                      data-testid={`competitor-select-${p.id}`}
                    />
                    <span>{p.registrableDomain}</span>
                  </label>
                  {selected[p.id] ? (
                  <Input
                    type="url"
                    inputMode="url"
                    value={competitorUrls[p.id] ?? ''}
                    placeholder={`https://${p.registrableDomain}/ranking-page`}
                    aria-label={t('competitorContent.run.competitorUrl', { domain: p.registrableDomain })}
                    onChange={(event) => {
                      setCompetitorUrls((current) => ({ ...current, [p.id]: event.target.value }));
                      onField();
                    }}
                    data-testid={`competitor-url-${p.id}`}
                  />
                  ) : null}
                </div>
              ))}
            </div>
          </fieldset>

          <div className="flex flex-col gap-2">
            <Label htmlFor={ownedId}>{t('competitorContent.run.ownedUrl')}</Label>
            <Input
              id={ownedId}
              type="url"
              inputMode="url"
              value={ownedUrl}
              placeholder="https://example.com/blog/post"
              onChange={(e) => {
                setOwnedUrl(e.target.value);
                onField();
              }}
              data-testid="competitor-run-owned-url"
            />
            <p className="text-muted-foreground text-xs">
              {t('competitorContent.run.ownedUrlHint')}
            </p>
          </div>

          <div className="flex flex-col gap-2">
            <Label htmlFor={keywordId}>{t('competitorContent.run.keyword')}</Label>
            <Input
              id={keywordId}
              value={keyword}
              onChange={(e) => {
                setKeyword(e.target.value);
                onField();
              }}
              data-testid="competitor-run-keyword"
            />
            <p className="text-muted-foreground text-xs">
              {t('competitorContent.run.keywordHint')}
            </p>
          </div>

          <div className="flex flex-col gap-2">
            <Label htmlFor={pageLimitId}>{t('competitorContent.run.pageLimit')}</Label>
            <Input
              id={pageLimitId}
              type="number"
              min={1}
              max={COMPETITOR_CONTENT_PAGES_PER_RUN}
              inputMode="numeric"
              value={pageLimit}
              onChange={(e) => {
                setPageLimit(e.target.value);
                onField();
              }}
              data-testid="competitor-run-page-limit"
            />
            <p className="text-muted-foreground text-xs">
              {t('competitorContent.run.pageLimitHint', { max: COMPETITOR_CONTENT_PAGES_PER_RUN })}
            </p>
          </div>

          <div
            className="border-border rounded-md border p-3"
            data-testid="competitor-run-disclosure"
            aria-live="polite"
          >
            <p className="text-sm font-medium">{t('competitorContent.run.disclosureTitle')}</p>
            <p className="text-muted-foreground mt-1 text-sm">
              {validPageLimit
                ? t('competitorContent.run.disclosure', {
                    count: selectedIds.length,
                    pages: pageLimitNum,
                  })
                : t('competitorContent.run.disclosureInvalid')}
            </p>
          </div>

          {inlineErrorKey ? (
            <p
              className="text-destructive text-sm"
              role="alert"
              data-testid="competitor-run-inline-error"
            >
              {t(inlineErrorKey)}
            </p>
          ) : null}

          {submitError ? (
            <Alert variant="destructive" data-testid="competitor-run-server-error">
              <AlertTitle>{t('competitorContent.errors.startFailed')}</AlertTitle>
              <AlertDescription>{submitError}</AlertDescription>
            </Alert>
          ) : null}

          {disabled ? (
            <p className="text-muted-foreground text-xs" data-testid="competitor-run-in-flight">
              {t('competitorContent.run.inFlight')}
            </p>
          ) : null}

          <div>
            <Button
              type="submit"
              loading={submitting}
              loadingLabel={t('competitorContent.run.submitting')}
              disabled={disabled || selectedIds.length === 0 || !validPageLimit}
              data-testid="competitor-run-submit"
            >
              {t('competitorContent.run.submit')}
            </Button>
          </div>
        </form>
      </CardContent>
    </Card>
  );
}

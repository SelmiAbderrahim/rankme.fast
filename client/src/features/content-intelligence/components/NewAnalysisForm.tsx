import { useCallback, useEffect, useId, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Alert, AlertDescription, AlertTitle } from '@shared/ui/alert';
import { Button } from '@shared/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@shared/ui/card';
import { Checkbox } from '@shared/ui/checkbox';
import {
  Field,
  FieldContent,
  FieldDescription,
  FieldError,
  FieldGroup,
  FieldLabel,
} from '@shared/ui/field';
import { Input } from '@shared/ui/input';
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@shared/ui/select';
import { useAppDispatch, useAppSelector } from '@shared/hooks/redux';
import { SUPPORTED_LOCALES } from '@shared/i18n';
import { safeExternalHref } from '@shared/security';
import type { StartAnalysisPayload } from '../api';
import { clearFormDraft, clearSubmitError, updateFormDraft } from '../store/slice';
import { loadAnalyses, runPreflight, submitAnalysis } from '../store/thunks';
import {
  selectAnalysisSiteId,
  selectFormDraft,
  selectSubmitError,
  selectSubmitting,
} from '../store/selectors';

interface NewAnalysisFormProps {
  siteId: string;
  siteOrigin?: string | undefined;
  knownPages?: readonly string[] | undefined;
  suggestedKeywords?: readonly string[] | undefined;
  onSubmitted?: (analysisId: string) => void;
  prefill?: {
    ownedUrl?: string;
    keyword?: string;
    locale?: string;
    reviewedCompetitorUrls?: string[];
    reviewedPageMatches?: Array<{
      landscapeReportId: string;
      landscapeOpportunityId?: string | null;
      suggestionId: string;
    }>;
  } | undefined;
}

function makeClientKey(): string {
  const rand = Math.random().toString(36).slice(2, 10);
  return `cli-${Date.now().toString(36)}-${rand}`;
}

function toReasonKey(reason: string | null | undefined): string | null {
  switch (reason) {
    case 'url_invalid':
      return 'form.invalidUrl';
    case 'off_origin':
      return 'form.offOrigin';
    case 'url_unsafe':
      return 'form.urlUnsafe';
    case 'not_owned':
      return 'form.urlNotOwned';
    default:
      return null;
  }
}

function localUrlError(value: string, siteOrigin: string | undefined): string | null {
  if (!value.trim()) return 'form.urlRequired';
  try {
    const parsed = new URL(value);
    if (!['http:', 'https:'].includes(parsed.protocol)) return 'form.invalidUrl';
    if (siteOrigin && parsed.origin !== new URL(siteOrigin).origin) return 'form.offOrigin';
    return null;
  } catch {
    return 'form.invalidUrl';
  }
}

function localKeywordError(value: string): string | null {
  const trimmed = value.trim();
  if (!trimmed) return 'form.keywordRequired';
  if (trimmed.length > 200) return 'form.keywordTooLong';
  return null;
}

const INCLUDED_KEYS = [
  'form.included.owned',
  'form.included.competitors',
  'form.included.scorecard',
  'form.included.brief',
  'form.included.draft',
] as const;

export function NewAnalysisForm({
  siteId,
  siteOrigin,
  knownPages = [],
  suggestedKeywords = [],
  onSubmitted,
  prefill,
}: NewAnalysisFormProps) {
  const { t, i18n } = useTranslation(['contentIntelligence', 'language']);
  const dispatch = useAppDispatch();
  const draft = useAppSelector(selectFormDraft);
  const draftSiteId = useAppSelector(selectAnalysisSiteId);
  const submitting = useAppSelector(selectSubmitting);
  const submitError = useAppSelector(selectSubmitError);
  const detectedLocale = i18n.language.split('-')[0]!;
  const currentLocale = SUPPORTED_LOCALES.includes(draft.locale as never)
    ? draft.locale
    : detectedLocale;

  const [inlineReasonKey, setInlineReasonKey] = useState<string | null>(null);
  const [touched, setTouched] = useState({ url: false, keyword: false, consent: false });
  const [clientKey] = useState<string>(() => makeClientKey());
  useEffect(() => {
    if (!prefill || draftSiteId !== siteId) return;
    const patch: Partial<typeof draft> = {};
    if (prefill.ownedUrl !== undefined) patch.ownedUrl = prefill.ownedUrl;
    if (prefill.keyword !== undefined) patch.keyword = prefill.keyword;
    if (prefill.locale !== undefined) patch.locale = prefill.locale;
    if (Object.keys(patch).length > 0) dispatch(updateFormDraft(patch));
  }, [dispatch, draftSiteId, prefill, siteId]);

  useEffect(() => {
    if (!draft.locale) dispatch(updateFormDraft({ locale: detectedLocale }));
  }, [dispatch, draft.locale, detectedLocale]);

  const urlId = useId();
  const pageListId = useId();
  const keywordId = useId();
  const keywordListId = useId();
  const localeId = useId();
  const consentId = useId();

  const urlErrorKey = useMemo(
    () => localUrlError(draft.ownedUrl, siteOrigin),
    [draft.ownedUrl, siteOrigin],
  );
  const keywordErrorKey = useMemo(() => localKeywordError(draft.keyword), [draft.keyword]);

  const onChangeField = useCallback(
    (patch: Partial<typeof draft>) => {
      dispatch(updateFormDraft(patch));
      if (submitError) dispatch(clearSubmitError());
      setInlineReasonKey(null);
    },
    [dispatch, submitError],
  );

  const onSubmit = useCallback(
    async (event: React.FormEvent<HTMLFormElement>) => {
      event.preventDefault();
      if (submitting) return;
      setTouched({ url: true, keyword: true, consent: true });
      if (urlErrorKey || keywordErrorKey) return;
      if (!draft.consent) {
        return;
      }
      const preflight = await dispatch(
        runPreflight({
          siteId,
          ownedUrl: draft.ownedUrl,
          keyword: draft.keyword.trim(),
          locale: currentLocale,
        }),
      ).unwrap().catch(() => null);
      if (preflight && !preflight.ok) {
        setInlineReasonKey(toReasonKey(preflight.reason));
        return;
      }
      const payload: StartAnalysisPayload = {
        siteId,
        ownedUrl: draft.ownedUrl,
        keyword: draft.keyword.trim(),
        locale: currentLocale,
        clientKey,
        ...(prefill?.reviewedPageMatches?.length
          ? { reviewedPageMatches: prefill.reviewedPageMatches }
          : {}),
      };
      const result = await dispatch(submitAnalysis(payload));
      if (submitAnalysis.fulfilled.match(result)) {
        dispatch(clearFormDraft());
        void dispatch(loadAnalyses({ siteId }));
        onSubmitted?.(result.payload.analysisId);
      }
    },
    [
      clientKey,
      currentLocale,
      dispatch,
      draft.consent,
      draft.keyword,
      draft.ownedUrl,
      keywordErrorKey,
      onSubmitted,
      prefill,
      siteId,
      submitting,
      urlErrorKey,
    ],
  );

  return (
    <Card data-testid="content-new-analysis-form">
      <CardHeader>
        <CardTitle>{t('contentIntelligence:form.title')}</CardTitle>
        <CardDescription>{t('contentIntelligence:list.description')}</CardDescription>
      </CardHeader>
      <CardContent>
        <form onSubmit={onSubmit} noValidate>
          <FieldGroup>
            <Field data-invalid={touched.url && Boolean(urlErrorKey)}>
              <FieldLabel htmlFor={urlId}>{t('contentIntelligence:form.ownedUrl')}</FieldLabel>
              <Input
                id={urlId}
                list={pageListId}
                type="url"
                required
                autoComplete="off"
                inputMode="url"
                value={draft.ownedUrl}
                placeholder={t('contentIntelligence:form.ownedUrlPlaceholder')}
                aria-invalid={touched.url && Boolean(urlErrorKey)}
                onBlur={() => setTouched((value) => ({ ...value, url: true }))}
                onChange={(event) => onChangeField({ ownedUrl: event.target.value })}
                data-testid="content-form-url"
              />
              <datalist id={pageListId}>
                {knownPages.map((page) => <option key={page} value={page} />)}
              </datalist>
              <FieldDescription>
                {t('contentIntelligence:form.ownedUrlHint')}{' '}
                {t('contentIntelligence:form.manualPage')}
              </FieldDescription>
              {touched.url && urlErrorKey ? (
                <FieldError>{t(`contentIntelligence:${urlErrorKey}`)}</FieldError>
              ) : null}
            </Field>

            <Field data-invalid={touched.keyword && Boolean(keywordErrorKey)}>
              <FieldLabel htmlFor={keywordId}>{t('contentIntelligence:form.keyword')}</FieldLabel>
              <Input
                id={keywordId}
                list={keywordListId}
                required
                maxLength={200}
                value={draft.keyword}
                aria-invalid={touched.keyword && Boolean(keywordErrorKey)}
                onBlur={() => setTouched((value) => ({ ...value, keyword: true }))}
                onChange={(event) => onChangeField({ keyword: event.target.value })}
                data-testid="content-form-keyword"
              />
              <datalist id={keywordListId}>
                {suggestedKeywords.map((keyword) => <option key={keyword} value={keyword} />)}
              </datalist>
              <FieldDescription>{t('contentIntelligence:form.keywordHint')}</FieldDescription>
              {touched.keyword && keywordErrorKey ? (
                <FieldError>{t(`contentIntelligence:${keywordErrorKey}`)}</FieldError>
              ) : null}
            </Field>

            <Field>
              <FieldLabel htmlFor={localeId}>{t('contentIntelligence:form.locale')}</FieldLabel>
              <Select value={currentLocale} onValueChange={(locale) => onChangeField({ locale })}>
                <SelectTrigger id={localeId} className="w-full" data-testid="content-form-locale">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectGroup>
                    {SUPPORTED_LOCALES.map((locale) => (
                      <SelectItem key={locale} value={locale}>
                        {t(`language:names.${locale}`)}
                      </SelectItem>
                    ))}
                  </SelectGroup>
                </SelectContent>
              </Select>
              <FieldDescription data-testid="content-form-locale-hint">
                {t('contentIntelligence:form.detectedLocale', {
                  locale: t(`language:names.${detectedLocale}`),
                })}{' '}
                {t('contentIntelligence:form.localeOverrideHint')}
              </FieldDescription>
            </Field>

            {prefill?.reviewedCompetitorUrls?.length ? (
              <Alert data-testid="content-form-reviewed-sources">
                <AlertTitle>{t('contentIntelligence:form.reviewedSources.title')}</AlertTitle>
                <AlertDescription>
                  <p>{t('contentIntelligence:form.reviewedSources.description')}</p>
                  <ul className="mt-2 flex list-disc flex-col gap-1 ps-5">
                    {prefill.reviewedCompetitorUrls.map((url) => {
                      const href = safeExternalHref(url);
                      return (
                        <li key={url}>
                          {href === '#' ? (
                            <span>{url}</span>
                          ) : (
                            <a
                              href={href}
                              target="_blank"
                              rel="nofollow ugc noopener noreferrer"
                              className="underline underline-offset-2"
                            >
                              {url}
                            </a>
                          )}
                        </li>
                      );
                    })}
                  </ul>
                </AlertDescription>
              </Alert>
            ) : null}

            <Alert data-testid="content-form-preview">
              <AlertTitle>{t('contentIntelligence:form.included.title')}</AlertTitle>
              <AlertDescription>
                <ul className="flex list-disc flex-col gap-1 ps-5">
                  {INCLUDED_KEYS.map((key) => (
                    <li key={key}>{t(`contentIntelligence:${key}`)}</li>
                  ))}
                  <li>{t('contentIntelligence:form.included.providerCall')}</li>
                </ul>
              </AlertDescription>
            </Alert>

            <Field orientation="horizontal" data-invalid={touched.consent && !draft.consent}>
              <Checkbox
                id={consentId}
                checked={draft.consent}
                aria-invalid={touched.consent && !draft.consent}
                onBlur={() => setTouched((value) => ({ ...value, consent: true }))}
                onCheckedChange={(value) => onChangeField({ consent: value === true })}
                data-testid="content-form-consent"
              />
              <FieldContent>
                <FieldLabel htmlFor={consentId} className="font-normal">
                  {t('contentIntelligence:form.consent')}
                </FieldLabel>
                {touched.consent && !draft.consent ? (
                  <FieldError>{t('contentIntelligence:form.consentRequired')}</FieldError>
                ) : null}
              </FieldContent>
            </Field>

            {inlineReasonKey ? (
              <FieldError data-testid="content-form-inline-error">
                {t(`contentIntelligence:${inlineReasonKey}`)}
              </FieldError>
            ) : null}

            {submitError ? (
              <Alert variant="destructive" data-testid="content-form-server-error">
                <AlertTitle>{t('contentIntelligence:errors.startFailed')}</AlertTitle>
                <AlertDescription>
                  <p>{submitError}</p>
                </AlertDescription>
              </Alert>
            ) : null}

            <Field>
              <Button
                type="submit"
                loading={submitting}
                loadingLabel={t('contentIntelligence:form.submitting')}
                disabled={!draft.consent}
                data-testid="content-form-submit"
              >
                {t('contentIntelligence:form.submit')}
              </Button>
            </Field>
          </FieldGroup>
        </form>
      </CardContent>
    </Card>
  );
}

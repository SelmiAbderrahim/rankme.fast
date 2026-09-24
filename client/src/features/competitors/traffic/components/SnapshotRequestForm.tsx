import { useEffect, useRef, useState, type FormEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { Alert, AlertDescription, AlertTitle } from '@shared/ui/alert';
import { Badge } from '@shared/ui/badge';
import { Button } from '@shared/ui/button';
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from '@shared/ui/card';
import { Field, FieldDescription, FieldError, FieldGroup, FieldLabel } from '@shared/ui/field';
import { Input } from '@shared/ui/input';
import { Skeleton } from '@shared/ui/skeleton';
import { useAppDispatch, useAppSelector } from '@shared/hooks/redux';
import { clearPreview } from '../store/slice';
import {
  selectTrafficPreviewError,
  selectTrafficPreviewErrorKind,
  selectTrafficPreviewStatus,
  selectTrafficRequestError,
  selectTrafficRequestErrorKind,
  selectTrafficRequestStatus,
  selectTrafficSnapshotPreview,
} from '../store/selectors';
import { previewSnapshot, requestSnapshot } from '../store/thunks';
import { trafficSnapshotDomainSchema, type TrafficSpendPreview } from '../types';

interface SpendPreviewCardProps {
  preview: TrafficSpendPreview | null;
  loading: boolean;
}

export const SpendPreviewCard = ({ preview, loading }: SpendPreviewCardProps) => {
  const { t } = useTranslation('competitorsTraffic');

  if (loading && !preview) {
    return (
      <Card aria-busy="true" aria-live="polite" data-testid="traffic-preview-loading">
        <CardHeader>
          <CardTitle>{t('preview.title')}</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-2">
          <Skeleton className="h-4 w-2/3" />
          <Skeleton className="h-4 w-1/2" />
        </CardContent>
      </Card>
    );
  }
  if (!preview) return null;

  return (
    <Card data-testid="traffic-preview">
      <CardHeader>
        <CardTitle>{t('preview.title')}</CardTitle>
        <CardDescription>{t('preview.operatorNotice')}</CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-4 text-sm">
        <div className="flex flex-wrap gap-2">
          {(preview.breakdown ?? []).map((operation) => {
            const domain = operation.operationKey.replace(/^traffic:/, '');
            return (
              <Badge
                key={operation.operationKey}
                variant={operation.cachedStatus === 'cached' ? 'secondary' : 'outline'}
              >
                {domain}: {t(`preview.${operation.cachedStatus}`)}
              </Badge>
            );
          })}
        </div>
      </CardContent>
    </Card>
  );
};

interface SnapshotRequestFormProps {
  siteId?: string;
  /** Default domain (the workspace site); never overwrites user input. */
  initialDomain?: string;
  disabled?: boolean;
  disabledReason?: string;
}

export const SnapshotRequestForm = ({
  siteId,
  initialDomain,
  disabled = false,
  disabledReason = '',
}: SnapshotRequestFormProps) => {
  const { t } = useTranslation('competitorsTraffic');
  const dispatch = useAppDispatch();
  const preview = useAppSelector(selectTrafficSnapshotPreview);
  const previewStatus = useAppSelector(selectTrafficPreviewStatus);
  const previewError = useAppSelector(selectTrafficPreviewError);
  const previewErrorKind = useAppSelector(selectTrafficPreviewErrorKind);
  const requestStatus = useAppSelector(selectTrafficRequestStatus);
  const requestError = useAppSelector(selectTrafficRequestError);
  const requestErrorKind = useAppSelector(selectTrafficRequestErrorKind);
  const [domain, setDomain] = useState(initialDomain ?? '');
  const [validatedDomain, setValidatedDomain] = useState('');
  const [validationError, setValidationError] = useState('');
  const [retryingKind, setRetryingKind] = useState<'preview' | 'request' | null>(null);
  // The workspace's sites slice can resolve after mount; adopt the late
  // default only while the user has not typed anything.
  const domainTouched = useRef(false);
  useEffect(() => {
    if (!domainTouched.current) setDomain(initialDomain ?? '');
  }, [initialDomain]);

  const locked = disabled || previewErrorKind === 'locked' || requestErrorKind === 'locked';
  const lockedReason =
    disabledReason ||
    (previewErrorKind === 'locked' ? previewError : '') ||
    (requestErrorKind === 'locked' ? requestError : '') ||
    t('states.locked.description');
  const previewFailed = previewStatus === 'failed';

  const validateDomain = (): string | null => {
    const parsed = trafficSnapshotDomainSchema.safeParse(domain);
    if (!parsed.success) {
      setValidationError(t('errors.invalidDomain'));
      return null;
    }
    setValidationError('');
    setValidatedDomain(parsed.data);
    return parsed.data;
  };

  const handlePreview = (event: FormEvent) => {
    event.preventDefault();
    const normalized = validateDomain();
    if (normalized) {
      void dispatch(previewSnapshot({
        domains: [normalized],
        ...(siteId ? { siteId } : {}),
      }));
    }
  };

  const requestInput = {
    targetDomain: validatedDomain,
    ...(siteId ? { siteId } : {}),
    locationCode: 2840 as const,
    languageCode: 'en' as const,
    historyMonths: 24 as const,
  };

  const handleConfirm = () => {
    void dispatch(requestSnapshot(requestInput));
  };

  const retryTimedOutRequest = () => {
    if (requestErrorKind === 'timeout' && preview) {
      setRetryingKind('request');
      void dispatch(requestSnapshot(requestInput)).finally(() => setRetryingKind(null));
      return;
    }
    setRetryingKind('preview');
    void dispatch(previewSnapshot({
      domains: [validatedDomain],
      ...(siteId ? { siteId } : {}),
    })).finally(() => setRetryingKind(null));
  };

  return (
    <section
      id="traffic-snapshot-request"
      className="flex flex-col gap-4"
      aria-disabled={locked || undefined}
    >
      <Card>
        <CardHeader>
          <CardTitle>{t('request.title')}</CardTitle>
          <CardDescription>{t('request.description')}</CardDescription>
        </CardHeader>
        <form onSubmit={handlePreview}>
          <CardContent>
            <FieldGroup>
              <div>
                <p className="text-sm font-medium">{t('request.marketLabel')}</p>
                <p className="text-sm text-muted-foreground">{t('request.marketValue')}</p>
              </div>
              <Field
                data-invalid={Boolean(validationError)}
                data-disabled={locked}
                className={locked ? 'cursor-not-allowed' : undefined}
              >
                <FieldLabel htmlFor="traffic-domain">{t('request.domainLabel')}</FieldLabel>
                <Input
                  id="traffic-domain"
                  name="domain"
                  value={domain}
                  placeholder={t('request.domainPlaceholder')}
                  autoComplete="url"
                  disabled={locked}
                  aria-invalid={Boolean(validationError)}
                  aria-describedby={
                    locked
                      ? 'traffic-domain-disabled'
                      : validationError
                        ? 'traffic-domain-error'
                        : 'traffic-domain-help'
                  }
                  onChange={(event) => {
                    domainTouched.current = true;
                    setDomain(event.target.value);
                    setValidationError('');
                    setValidatedDomain('');
                    dispatch(clearPreview());
                  }}
                />
                <FieldDescription id="traffic-domain-help">
                  {t('request.domainHelp')}
                </FieldDescription>
                <FieldError id="traffic-domain-error">{validationError}</FieldError>
                {locked ? (
                  <FieldDescription id="traffic-domain-disabled">{lockedReason}</FieldDescription>
                ) : null}
              </Field>
            </FieldGroup>
          </CardContent>
          <CardFooter>
            <Button
              type="submit"
              variant="outline"
              loading={previewStatus === 'loading'}
              loadingLabel={t('request.previewing')}
              disabled={locked || domain.trim().length === 0}
            >
              {t('request.preview')}
            </Button>
          </CardFooter>
        </form>
      </Card>

      {previewError && !locked ? (
        <Alert variant="destructive" role="alert">
          <AlertTitle>
            {previewErrorKind === 'timeout'
                ? t('states.timeout.title')
                : t('errors.previewTitle')}
          </AlertTitle>
          <AlertDescription className="flex flex-col items-start gap-2">
            <span>{previewError}</span>
            {previewErrorKind === 'timeout' ? (
              <Button
                type="button"
                variant="outline"
                size="sm"
                loading={previewStatus === 'loading'}
                loadingLabel={t('states.timeout.retrying')}
                onClick={retryTimedOutRequest}
              >
                {t('states.timeout.retry')}
              </Button>
            ) : null}
          </AlertDescription>
        </Alert>
      ) : null}

      <SpendPreviewCard preview={preview} loading={previewStatus === 'loading'} />

      {preview || previewStatus === 'failed' ? (
        <div className="flex flex-col items-start gap-2">
          <div className="flex flex-wrap items-center gap-2">
            <Button
              type="button"
              variant="default"
              loading={requestStatus === 'loading'}
              loadingLabel={t('request.confirming')}
              disabled={!preview || previewFailed || locked}
              onClick={handleConfirm}
            >
              {t('request.confirm')}
            </Button>
            {preview ? (
              <Button
                type="button"
                variant="outline"
                disabled={requestStatus === 'loading'}
                onClick={() => dispatch(clearPreview())}
              >
                {t('request.cancel')}
              </Button>
            ) : null}
          </div>
        </div>
      ) : null}

      {requestError && !locked ? (
        <Alert variant="destructive" role="alert">
          <AlertDescription className="flex flex-col items-start gap-2">
            <span>{requestError}</span>
            {requestErrorKind === 'timeout' ? (
              <Button
                type="button"
                variant="outline"
                size="sm"
                loading={requestStatus === 'loading'}
                loadingLabel={t('states.timeout.retrying')}
                onClick={retryTimedOutRequest}
              >
                {t('states.timeout.retry')}
              </Button>
            ) : null}
          </AlertDescription>
        </Alert>
      ) : null}

      {retryingKind ? (
        <Button
          type="button"
          variant="outline"
          loading
          loadingLabel={t('states.timeout.retrying')}
          disabled
        >
          {t('states.timeout.retry')}
        </Button>
      ) : null}
    </section>
  );
};

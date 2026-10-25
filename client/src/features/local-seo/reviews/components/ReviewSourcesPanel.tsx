import { Fragment, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ExternalLink, Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import { Alert, AlertDescription } from '@shared/ui/alert';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@shared/ui/alert-dialog';
import { Button } from '@shared/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@shared/ui/card';
import { Field, FieldLabel } from '@shared/ui/field';
import { Input } from '@shared/ui/input';
import { FieldFeedback, fieldDescribedBy } from '@shared/components/FieldFeedback';
import { Separator } from '@shared/ui/separator';
import { Skeleton } from '@shared/ui/skeleton';
import { StatusChip, type StatusTone } from '@shared/ui/status-chip';
import { useAppDispatch, useAppSelector } from '@shared/hooks/redux';
import { addReviewSource, removeReviewSource } from '../store/thunks';
import {
  selectReviewRuns,
  selectReviewSourceMutationError,
  selectReviewSourceMutationStatus,
  selectReviewSources,
  selectReviewSourcesError,
  selectReviewSourcesStatus,
} from '../store/selectors';
import { sourceReadiness, type SourceReadiness } from '../readiness';
import { normalizeReviewTarget } from '../targets';
import { REVIEW_SOURCES, type ReviewSource, type ReviewSourceName } from '../types';

/** Saved-but-unproven is a pending state (warning); only a sync earns green. */
const READINESS_TONE: Record<SourceReadiness, StatusTone> = {
  invalid: 'destructive',
  failed: 'destructive',
  verified: 'success',
  saved: 'warning',
};

/**
 * Google's own Place ID documentation page (a fixed link, not a call we make).
 * Most owners have never seen their Place ID, so the Google row links straight
 * to the official lookup tool.
 */
export const GOOGLE_PLACE_ID_FINDER_URL =
  'https://developers.google.com/maps/documentation/places/web-service/place-id';

interface ReviewSourcesPanelProps {
  profileId: string;
  /** Kill switch — the rows stay readable, the writes do not. */
  disabled?: boolean;
}

/**
 * Source setup — one row per supported directory. A row is either configured
 * (target shown with an honest readiness chip, removable after confirming) or
 * empty (input + save). The format rules mirror the server's, so a value that
 * cannot identify a business is refused inline before it reaches the rate
 * bucket; whether the vendor can resolve it is only known after a sync.
 */
export const ReviewSourcesPanel = ({ profileId, disabled = false }: ReviewSourcesPanelProps) => {
  const { t } = useTranslation('reviewIntelligence');
  const dispatch = useAppDispatch();
  const sources = useAppSelector(selectReviewSources);
  const status = useAppSelector(selectReviewSourcesStatus);
  const listError = useAppSelector(selectReviewSourcesError);
  const mutationStatus = useAppSelector(selectReviewSourceMutationStatus);
  const mutationError = useAppSelector(selectReviewSourceMutationError);
  const [drafts, setDrafts] = useState<Partial<Record<ReviewSourceName, string>>>({});
  const [pending, setPending] = useState<ReviewSourceName | null>(null);
  const runs = useAppSelector(selectReviewRuns);
  // Inline format errors, shown after a save attempt and cleared on edit.
  const [draftErrors, setDraftErrors] = useState<Partial<Record<ReviewSourceName, boolean>>>({});
  const [confirmRemove, setConfirmRemove] = useState<ReviewSource | null>(null);

  const submitSource = async (source: ReviewSourceName, draft: string) => {
    const target = normalizeReviewTarget(source, draft);
    if (target === null) {
      setDraftErrors((current) => ({ ...current, [source]: true }));
      return;
    }
    setPending(source);
    const result = await dispatch(addReviewSource({ profileId, source, target }));
    if (addReviewSource.fulfilled.match(result)) {
      setDrafts((current) => ({ ...current, [source]: '' }));
    }
  };

  const removeSource = async (row: ReviewSource) => {
    setConfirmRemove(null);
    setPending(row.source);
    const result = await dispatch(removeReviewSource(row.id));
    if (removeReviewSource.fulfilled.match(result)) {
      toast.success(t('sources.removed', { source: t(`sourceNames.${row.source}`) }));
    }
  };

  const configured = new Map(sources.map((row) => [row.source, row]));

  if (status === 'loading' && sources.length === 0) {
    return (
      <Card aria-busy="true" data-testid="reviews-sources-loading">
        <CardHeader>
          <CardTitle>{t('sources.title')}</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-2">
          <Skeleton className="h-9 w-full" />
          <Skeleton className="h-9 w-full" />
          <Skeleton className="h-9 w-full" />
        </CardContent>
      </Card>
    );
  }

  return (
    <Card data-testid="reviews-sources">
      <CardHeader>
        <CardTitle>{t('sources.title')}</CardTitle>
        <CardDescription>{t('sources.description')}</CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        {listError ? (
          <Alert role="alert" data-testid="reviews-sources-error">
            <AlertDescription>{listError}</AlertDescription>
          </Alert>
        ) : null}
        {mutationError ? (
          <Alert role="alert" data-testid="reviews-sources-mutation-error">
            <AlertDescription>{mutationError}</AlertDescription>
          </Alert>
        ) : null}
        {sources.length === 0 ? (
          <p className="text-muted-foreground text-sm" data-testid="reviews-sources-empty">
            {t('sources.empty')}
          </p>
        ) : null}
        {REVIEW_SOURCES.map((source, index) => {
          const row = configured.get(source);
          const readiness = row ? sourceReadiness(row, runs) : null;
          const inputId = `review-source-${source}`;
          return (
            <Fragment key={source}>
              {index > 0 ? <Separator /> : null}
              <div
                className="flex flex-col gap-2"
                data-testid={`reviews-source-row-${source}`}
              >
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-medium">{t(`sourceNames.${source}`)}</span>
                  {readiness ? (
                    <StatusChip
                      tone={READINESS_TONE[readiness]}
                      data-testid={`reviews-source-configured-${source}`}
                      data-status={readiness}
                    >
                      {t(`sources.status.${readiness}`)}
                    </StatusChip>
                  ) : null}
                </div>
                {row ? (
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <span className="text-muted-foreground text-sm break-all">{row.target}</span>
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      disabled={disabled}
                      loading={pending === source && mutationStatus === 'loading'}
                      data-testid={`reviews-source-remove-${source}`}
                      onClick={() => setConfirmRemove(row)}
                    >
                      <Trash2 aria-hidden="true" data-icon="inline-start" />
                      {t('sources.remove')}
                    </Button>
                  </div>
                ) : (
                  // The Google help sits under the input + button row, so "Save
                  // source" stays inline with the field like the other sources.
                  <form
                    className="flex flex-col gap-1"
                    noValidate
                    onSubmit={(event) => {
                      event.preventDefault();
                      const draft = (drafts[source] ?? '').trim();
                      if (draft) void submitSource(source, draft);
                    }}
                  >
                    <div className="flex flex-wrap items-end gap-2">
                      <Field className="min-w-0 flex-1 gap-1">
                        <FieldLabel htmlFor={inputId}>{t(`sources.hint.${source}`)}</FieldLabel>
                        <Input
                          id={inputId}
                          name={inputId}
                          maxLength={200}
                          disabled={disabled}
                          value={drafts[source] ?? ''}
                          placeholder={t(`sources.placeholder.${source}`)}
                          onChange={(event) => {
                            setDrafts((current) => ({ ...current, [source]: event.target.value }));
                            setDraftErrors((current) => ({ ...current, [source]: false }));
                          }}
                          aria-invalid={draftErrors[source] === true}
                          aria-describedby={fieldDescribedBy(inputId, {
                            hint: source === 'google',
                            error: draftErrors[source] === true,
                          })}
                          data-testid={`reviews-source-input-${source}`}
                        />
                      </Field>
                      <Button
                        type="submit"
                        variant="outline"
                        disabled={disabled || !(drafts[source] ?? '').trim()}
                        loading={pending === source && mutationStatus === 'loading'}
                        data-testid={`reviews-source-save-${source}`}
                      >
                        {t('sources.save')}
                      </Button>
                    </div>
                    <FieldFeedback
                      id={inputId}
                      hintTestId="reviews-source-help-google"
                      errorTestId={`reviews-source-error-${source}`}
                      hint={
                        source === 'google' ? (
                          <>
                            {t('sources.help.google')}{' '}
                            <a
                              href={GOOGLE_PLACE_ID_FINDER_URL}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="text-foreground inline-flex items-center gap-1 font-medium underline underline-offset-4 max-md:min-h-11"
                              data-testid="reviews-place-id-finder"
                            >
                              {t('sources.help.googleLink')}
                              <ExternalLink aria-hidden="true" className="size-3" />
                              <span className="sr-only">{` ${t('common:shell.opensInNewTab')}`}</span>
                            </a>
                          </>
                        ) : null
                      }
                      error={draftErrors[source] === true ? t(`sources.invalid.${source}`) : null}
                    />
                  </form>
                )}
              </div>
            </Fragment>
          );
        })}
      </CardContent>
      {confirmRemove ? (
        <AlertDialog open onOpenChange={() => setConfirmRemove(null)}>
          <AlertDialogContent data-testid="reviews-source-remove-dialog">
            <AlertDialogHeader>
              <AlertDialogTitle>{t('sources.removeConfirm.title')}</AlertDialogTitle>
              <AlertDialogDescription>
                {t('sources.removeConfirm.description', {
                  source: t(`sourceNames.${confirmRemove.source}`),
                })}
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>{t('sources.removeConfirm.cancel')}</AlertDialogCancel>
              <AlertDialogAction
                data-testid="reviews-source-remove-confirm"
                onClick={() => void removeSource(confirmRemove)}
              >
                {t('sources.removeConfirm.confirm')}
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      ) : null}
    </Card>
  );
};

import { Fragment, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Trash2 } from 'lucide-react';
import { Alert, AlertDescription } from '@shared/ui/alert';
import { Button } from '@shared/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@shared/ui/card';
import { Field, FieldLabel } from '@shared/ui/field';
import { Input } from '@shared/ui/input';
import { Separator } from '@shared/ui/separator';
import { Skeleton } from '@shared/ui/skeleton';
import { StatusChip } from '@shared/ui/status-chip';
import { useAppDispatch, useAppSelector } from '@shared/hooks/redux';
import { addReviewSource, removeReviewSource } from '../store/thunks';
import {
  selectReviewSourceMutationError,
  selectReviewSourceMutationStatus,
  selectReviewSources,
  selectReviewSourcesError,
  selectReviewSourcesStatus,
} from '../store/selectors';
import { REVIEW_SOURCES, type ReviewSourceName } from '../types';

interface ReviewSourcesPanelProps {
  profileId: string;
  /** Kill switch — the rows stay readable, the writes do not. */
  disabled?: boolean;
}

/**
 * Source setup — one row per supported directory. A row is either configured
 * (target shown, removable) or empty (bounded input + save). The bound itself
 * is the server's: this input only trims and caps length so an obviously
 * impossible value never reaches the rate bucket.
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
                  {row ? (
                    <StatusChip tone="success" data-testid={`reviews-source-configured-${source}`}>
                      {t('sources.configured')}
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
                      onClick={() => {
                        setPending(source);
                        void dispatch(removeReviewSource(row.id));
                      }}
                    >
                      <Trash2 aria-hidden="true" data-icon="inline-start" />
                      {t('sources.remove')}
                    </Button>
                  </div>
                ) : (
                  <form
                    className="flex flex-wrap items-end gap-2"
                    onSubmit={(event) => {
                      event.preventDefault();
                      const target = (drafts[source] ?? '').trim();
                      if (!target) return;
                      setPending(source);
                      void dispatch(addReviewSource({ profileId, source, target }));
                      setDrafts((current) => ({ ...current, [source]: '' }));
                    }}
                  >
                    <Field className="min-w-0 flex-1 gap-1">
                      <FieldLabel htmlFor={inputId}>{t(`sources.hint.${source}`)}</FieldLabel>
                      <Input
                        id={inputId}
                        name={inputId}
                        maxLength={200}
                        disabled={disabled}
                        value={drafts[source] ?? ''}
                        placeholder={t(`sources.placeholder.${source}`)}
                        onChange={(event) =>
                          setDrafts((current) => ({ ...current, [source]: event.target.value }))
                        }
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
                  </form>
                )}
              </div>
            </Fragment>
          );
        })}
      </CardContent>
    </Card>
  );
};

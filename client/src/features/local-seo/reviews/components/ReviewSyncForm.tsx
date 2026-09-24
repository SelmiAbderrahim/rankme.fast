import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Alert, AlertDescription } from '@shared/ui/alert';
import { Button } from '@shared/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@shared/ui/card';
import { Checkbox } from '@shared/ui/checkbox';
import {
  Field,
  FieldDescription,
  FieldGroup,
  FieldLabel,
  FieldLegend,
  FieldSet,
} from '@shared/ui/field';
import { Input } from '@shared/ui/input';
import { StatusChip } from '@shared/ui/status-chip';
import { useAppDispatch, useAppSelector } from '@shared/hooks/redux';
import { clearReviewPreview } from '../store/slice';
import { previewSync, submitSync } from '../store/thunks';
import {
  selectReviewPreview,
  selectReviewPreviewError,
  selectReviewPreviewStatus,
  selectReviewSources,
  selectReviewSubmitError,
  selectReviewSubmitStatus,
} from '../store/selectors';
import { REVIEW_SYNC_MAX_DEPTH, type ReviewSourceName } from '../types';

interface ReviewSyncFormProps {
  profileId: string;
  disabled?: boolean;
  disabledReason?: string;
}

/**
 * Paid submit, two explicit steps: `Estimate` calls
 * `POST /reviews/preview` (read-only — no vendor call) and `Confirm` calls
 * `POST /reviews/sync`. Cancel drops the estimate and fires nothing.
 */
export const ReviewSyncForm = ({
  profileId,
  disabled = false,
  disabledReason,
}: ReviewSyncFormProps) => {
  const { t } = useTranslation('reviewIntelligence');
  const dispatch = useAppDispatch();
  const configured = useAppSelector(selectReviewSources);
  const preview = useAppSelector(selectReviewPreview);
  const previewStatus = useAppSelector(selectReviewPreviewStatus);
  const previewError = useAppSelector(selectReviewPreviewError);
  const submitStatus = useAppSelector(selectReviewSubmitStatus);
  const submitError = useAppSelector(selectReviewSubmitError);
  const [selected, setSelected] = useState<ReviewSourceName[]>([]);
  const [depth, setDepth] = useState(String(REVIEW_SYNC_MAX_DEPTH));

  const parsedDepth = Number(depth);
  const depthValid =
    Number.isInteger(parsedDepth) && parsedDepth >= 1 && parsedDepth <= REVIEW_SYNC_MAX_DEPTH;
  const canEstimate = selected.length > 0 && depthValid && !disabled;

  const toggle = (source: ReviewSourceName, checked: boolean) => {
    setSelected((current) =>
      checked ? [...current, source] : current.filter((value) => value !== source),
    );
    // A changed basket invalidates the estimate that described the old one.
    dispatch(clearReviewPreview());
  };

  if (configured.length === 0) {
    return (
      <Card data-testid="reviews-sync-needs-sources">
        <CardHeader>
          <CardTitle>{t('sync.title')}</CardTitle>
          <CardDescription>{t('states.noSources.description')}</CardDescription>
        </CardHeader>
      </Card>
    );
  }

  return (
    <Card data-testid="reviews-sync-form">
      <CardHeader>
        <CardTitle>{t('sync.title')}</CardTitle>
        <CardDescription>{t('sync.description')}</CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        {disabled && disabledReason ? (
          <Alert role="status" data-testid="reviews-sync-disabled">
            <AlertDescription>{disabledReason}</AlertDescription>
          </Alert>
        ) : null}
        <FieldSet className="gap-2">
          <FieldLegend variant="label">{t('sync.sourcesLabel')}</FieldLegend>
          <FieldGroup className="gap-2">
            {configured.map((row) => {
              const id = `review-sync-source-${row.source}`;
              return (
                <Field key={row.id} orientation="horizontal" className="w-fit gap-2">
                  <Checkbox
                    id={id}
                    disabled={disabled}
                    checked={selected.includes(row.source)}
                    onCheckedChange={(checked) => toggle(row.source, checked === true)}
                    data-testid={`reviews-sync-source-${row.source}`}
                  />
                  <FieldLabel htmlFor={id}>{t(`sourceNames.${row.source}`)}</FieldLabel>
                </Field>
              );
            })}
          </FieldGroup>
        </FieldSet>
        <Field className="gap-1">
          <FieldLabel htmlFor="review-sync-depth">{t('sync.depthLabel')}</FieldLabel>
          <Input
            id="review-sync-depth"
            type="number"
            min={1}
            max={REVIEW_SYNC_MAX_DEPTH}
            inputMode="numeric"
            aria-describedby="review-sync-depth-hint"
            disabled={disabled}
            value={depth}
            onChange={(event) => {
              setDepth(event.target.value);
              dispatch(clearReviewPreview());
            }}
            data-testid="reviews-sync-depth"
          />
          <FieldDescription id="review-sync-depth-hint">
            {t('sync.depthHint', { max: REVIEW_SYNC_MAX_DEPTH })}
          </FieldDescription>
        </Field>
        {selected.length === 0 ? (
          <p className="text-muted-foreground text-sm" data-testid="reviews-sync-select-hint">
            {t('sync.selectAtLeastOne')}
          </p>
        ) : null}
        {previewError ? (
          <Alert role="alert" data-testid="reviews-preview-error">
            <AlertDescription>{previewError}</AlertDescription>
          </Alert>
        ) : null}
        {submitError ? (
          <Alert role="alert" data-testid="reviews-submit-error">
            <AlertDescription>{submitError}</AlertDescription>
          </Alert>
        ) : null}

        {preview ? (
          <div className="flex flex-col gap-3 rounded-md border p-4" data-testid="reviews-preview">
            <div>
              <p className="font-medium">{t('preview.title')}</p>
              <p className="text-muted-foreground text-sm">{t('preview.description')}</p>
            </div>
            <div className="flex flex-wrap gap-2">
              <StatusChip tone="muted" data-testid="reviews-preview-sources">
                {t('preview.perSource', { sources: selected.length })}
              </StatusChip>
              <StatusChip tone="muted" data-testid="reviews-preview-depth">
                {t('preview.depth', { depth: parsedDepth })}
              </StatusChip>
            </div>
          </div>
        ) : null}
      </CardContent>
      <CardContent className="flex flex-wrap gap-2 pt-0">
        {preview ? (
          <>
            <Button
              type="button"
              disabled={disabled}
              loading={submitStatus === 'loading'}
              data-testid="reviews-sync-confirm"
              onClick={() => {
                void dispatch(submitSync({ profileId, sources: selected, depth: parsedDepth }));
              }}
            >
              {t('sync.confirm')}
            </Button>
            <Button
              type="button"
              variant="outline"
              data-testid="reviews-sync-cancel"
              onClick={() => dispatch(clearReviewPreview())}
            >
              {t('sync.cancel')}
            </Button>
          </>
        ) : (
          <Button
            type="button"
            variant="outline"
            disabled={!canEstimate}
            loading={previewStatus === 'loading'}
            data-testid="reviews-sync-estimate"
            onClick={() => {
              void dispatch(previewSync({ profileId, sources: selected }));
            }}
          >
            {t('sync.estimate')}
          </Button>
        )}
      </CardContent>
    </Card>
  );
};

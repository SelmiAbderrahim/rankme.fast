import { useCallback, useId, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '@shared/ui/button';
import { Checkbox } from '@shared/ui/checkbox';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@shared/ui/dialog';
import { Field, FieldContent, FieldError, FieldLabel } from '@shared/ui/field';
import { Bdi } from '@shared/components/Bdi';
import { getAnalysisRetryPreview, retryAnalysis } from '../api';
import { errorMessage } from '../errorMessage';
import type { ContentAnalysisRetryPreview } from '../types';

interface RetryAnalysisDialogProps {
  analysisId: string;
  /** The new run started; the workspace switches to it. */
  onRetried: (newAnalysisId: string) => void;
}

/**
 * Try again after a retryable failure. The dialog first shows the request that
 * would run again, with the AI-consent box already ticked from the run being
 * retried — the new run still starts only on an explicit confirm.
 */
export function RetryAnalysisDialog({ analysisId, onRetried }: RetryAnalysisDialogProps) {
  const { t } = useTranslation('contentIntelligence');
  const consentId = useId();
  const [open, setOpen] = useState(false);
  const [preview, setPreview] = useState<ContentAnalysisRetryPreview | null>(null);
  const [previewFailed, setPreviewFailed] = useState(false);
  const [consent, setConsent] = useState(true);
  const [starting, setStarting] = useState(false);
  const [startError, setStartError] = useState('');
  const controller = useRef<AbortController | null>(null);

  const loadPreview = useCallback(() => {
    controller.current?.abort();
    const next = new AbortController();
    controller.current = next;
    setPreview(null);
    setPreviewFailed(false);
    void getAnalysisRetryPreview(analysisId, { signal: next.signal })
      .then((result) => {
        if (!next.signal.aborted) setPreview(result);
      })
      .catch(() => {
        if (!next.signal.aborted) setPreviewFailed(true);
      });
  }, [analysisId]);

  const onOpenChange = (value: boolean) => {
    setOpen(value);
    if (value) {
      setConsent(true);
      setStartError('');
      loadPreview();
    } else {
      controller.current?.abort();
    }
  };

  const onConfirm = async () => {
    setStarting(true);
    setStartError('');
    try {
      const started = await retryAnalysis(analysisId, consent);
      setOpen(false);
      onRetried(started.analysisId);
    } catch (err) {
      setStartError(errorMessage(err));
    } finally {
      setStarting(false);
    }
  };

  return (
    <>
      <Button
        type="button"
        variant="outline"
        size="sm"
        onClick={() => onOpenChange(true)}
        data-testid="content-detail-retry"
      >
        {t('detail.actions.retry')}
      </Button>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent data-testid="content-retry-dialog">
          <DialogHeader>
            <DialogTitle>{t('detail.retryDialog.title')}</DialogTitle>
            <DialogDescription>{t('detail.retryDialog.description')}</DialogDescription>
          </DialogHeader>
          <div className="flex flex-col gap-3 text-sm" aria-busy={!preview && !previewFailed}>
            {previewFailed ? (
              <div role="alert" className="flex flex-col items-start gap-2">
                <p>{t('detail.retryDialog.loadFailed')}</p>
                <Button type="button" size="sm" variant="outline" onClick={loadPreview}>
                  {t('errors.retry')}
                </Button>
              </div>
            ) : !preview ? (
              <p role="status">{t('detail.retryDialog.loading')}</p>
            ) : (
              <dl className="flex flex-col gap-1" data-testid="content-retry-request">
                <div>
                  <dt className="text-muted-foreground text-xs">{t('form.ownedUrl')}</dt>
                  <dd className="break-all">{preview.ownedUrl}</dd>
                </div>
                <div>
                  <dt className="text-muted-foreground text-xs">{t('form.keyword')}</dt>
                  <dd>
                    <Bdi>{preview.keyword}</Bdi>
                  </dd>
                </div>
              </dl>
            )}
            <Field orientation="horizontal" data-invalid={!consent}>
              <Checkbox
                id={consentId}
                checked={consent}
                aria-invalid={!consent}
                onCheckedChange={(value) => setConsent(value === true)}
                data-testid="content-retry-consent"
              />
              <FieldContent>
                <FieldLabel htmlFor={consentId} className="font-normal">
                  {t('form.consent')}
                </FieldLabel>
                {!consent ? <FieldError>{t('form.consentRequired')}</FieldError> : null}
              </FieldContent>
            </Field>
            {startError ? (
              <p role="alert" className="text-destructive" data-testid="content-retry-error">
                {startError}
              </p>
            ) : null}
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              {t('detail.retryDialog.back')}
            </Button>
            <Button
              type="button"
              onClick={() => void onConfirm()}
              disabled={!preview || !consent}
              loading={starting}
              loadingLabel={t('detail.progress.regenerating')}
              data-testid="content-retry-confirm"
            >
              {t('detail.retryDialog.confirm')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

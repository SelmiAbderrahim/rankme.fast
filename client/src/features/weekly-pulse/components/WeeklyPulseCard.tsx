/**
 * Weekly Pulse card — placed inside the AI Visibility site workspace.
 *
 * States rendered:
 *   • loading skeleton (initial state fetch)
 *   • error banner (state fetch failed)
 *   • unavailable (no supported engine yet)
 *   • empty (no subscription yet — opt-in explainer + preview button)
 *   • active (enabled — next run + last status + disable + preview)
 *
 * Preview is non-reserving; enable/disable requires an explicit
 * acknowledgement dialog before flipping the toggle. RTL-safe (uses ms-/me-
 * logical properties on the label side, no absolute-positioned decorations
 * that break Arabic reading order).
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ReportExportControl } from '@features/report-export';
import { Button } from '@shared/ui/button';
import { useAppDispatch, useAppSelector } from '@shared/hooks/redux';
import {
  fetchWeeklyPulseState,
  previewWeeklyPulseSpend,
  setSubscription,
} from '../store/thunks';
import {
  selectPulsePreview,
  selectPulsePreviewLoading,
  selectPulseSaveError,
  selectPulseSaving,
  selectPulseState,
  selectPulseStateError,
  selectPulseStateLoading,
} from '../store/selectors';

interface WeeklyPulseCardProps {
  siteId: string;
}

export function WeeklyPulseCard({ siteId }: WeeklyPulseCardProps) {
  const { t, i18n } = useTranslation('weeklyPulse');
  const dispatch = useAppDispatch();
  const view = useAppSelector(selectPulseState);
  const loading = useAppSelector(selectPulseStateLoading);
  const stateError = useAppSelector(selectPulseStateError);
  const preview = useAppSelector(selectPulsePreview);
  const previewLoading = useAppSelector(selectPulsePreviewLoading);
  const saving = useAppSelector(selectPulseSaving);
  const saveError = useAppSelector(selectPulseSaveError);

  const [dialogOpen, setDialogOpen] = useState<'enable' | 'disable' | null>(null);
  const [ack, setAck] = useState(false);

  useEffect(() => {
    void dispatch(fetchWeeklyPulseState({ siteId }));
  }, [dispatch, siteId]);

  const subscriptionEnabled = view?.subscription?.enabled ?? false;

  const handlePreview = useCallback(async () => {
    await dispatch(previewWeeklyPulseSpend({ siteId }));
  }, [dispatch, siteId]);

  const handleEnable = useCallback(async () => {
    const now = new Date().toISOString();
    await dispatch(
      setSubscription({
        siteId,
        enabled: true,
        acknowledgedPreviewAt: now,
      }),
    );
    setDialogOpen(null);
    setAck(false);
  }, [dispatch, siteId]);

  const handleDisable = useCallback(async () => {
    await dispatch(setSubscription({ siteId, enabled: false }));
    setDialogOpen(null);
    setAck(false);
  }, [dispatch, siteId]);

  const nextRunFormatted = useMemo(() => {
    if (!view?.setting?.nextRunAt) return null;
    // `new Date(...)` never throws — an unparseable value stringifies to
    // "Invalid Date", which the server-side ISO validation already prevents.
    return new Intl.DateTimeFormat(i18n.language, {
      dateStyle: 'medium',
      timeStyle: 'short',
    }).format(new Date(view.setting.nextRunAt));
  }, [i18n.language, view?.setting?.nextRunAt]);

  const lastStatusKey = view?.setting?.lastStatus ?? null;

  if (loading && !view) {
    return (
      <section
        className="rounded-xl border p-4"
        aria-labelledby={`weekly-pulse-title-${siteId}`}
      >
        <h2 id={`weekly-pulse-title-${siteId}`} className="text-lg font-semibold">
          {t('card.title')}
        </h2>
        <p className="text-muted-foreground mt-2" aria-busy="true">
          {t('gsc.loading')}
        </p>
      </section>
    );
  }

  return (
    <section
      className="rounded-xl border p-4"
      aria-labelledby={`weekly-pulse-title-${siteId}`}
      data-testid="weekly-pulse-card"
    >
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h2 id={`weekly-pulse-title-${siteId}`} className="text-lg font-semibold">
            {t('card.title')}
          </h2>
          <p className="text-muted-foreground mt-1 text-sm">{t('card.description')}</p>
          <p className="text-muted-foreground mt-2 text-xs">{t('card.unitDisclosure')}</p>
        </div>
        {view?.lastRun ? (
          <ReportExportControl
            kind="weekly_pulse.run"
            target={{ scope: 'site_resource', siteId, resourceId: view.lastRun.runId }}
            selection={{}}
          />
        ) : null}
      </div>

      {stateError ? (
        <p role="alert" className="text-destructive mt-3 text-sm">
          {t('errors.unexpected')}
        </p>
      ) : null}

      <dl className="mt-3 grid grid-cols-1 gap-2 text-sm md:grid-cols-3">
        <div>
          <dt className="text-muted-foreground">{t('card.nextRun', { when: '' })}</dt>
          <dd data-testid="weekly-pulse-next-run">{nextRunFormatted ?? '—'}</dd>
        </div>
        <div>
          <dt className="text-muted-foreground">{t('card.lastRun', { when: '' })}</dt>
          <dd data-testid="weekly-pulse-last-run">
            {view?.setting?.lastRunAt
              ? new Intl.DateTimeFormat(i18n.language, {
                  dateStyle: 'medium',
                  timeStyle: 'short',
                }).format(new Date(view.setting.lastRunAt))
              : '—'}
          </dd>
        </div>
        <div>
          <dt className="text-muted-foreground">{t('card.lastStatus', { status: '' })}</dt>
          <dd data-testid="weekly-pulse-last-status">
            {lastStatusKey
              ? t(`status.${lastStatusKey}` as const)
              : t('status.empty')}
          </dd>
        </div>
      </dl>

      {preview ? (
        <div
          className="mt-4 rounded-md bg-muted p-3 text-sm"
          data-testid="weekly-pulse-preview"
        >
          <p className="font-medium">{t('preview.title')}</p>
          <p>{t('preview.productUnits')}</p>
        </div>
      ) : null}

      <div className="mt-4 flex flex-wrap gap-2">
        <Button
          variant="outline"
          onClick={handlePreview}
          loading={previewLoading}
          data-testid="weekly-pulse-preview-cta"
        >
          {t('card.previewCta')}
        </Button>

        {subscriptionEnabled ? (
          <Button
            variant="secondary"
            onClick={() => setDialogOpen('disable')}
            data-testid="weekly-pulse-disable-cta"
          >
            {t('card.disableCta')}
          </Button>
        ) : (
          <Button
            variant="default"
            onClick={() => setDialogOpen('enable')}
            data-testid="weekly-pulse-enable-cta"
            disabled={!preview}
          >
            {t('card.enableCta')}
          </Button>
        )}
      </div>

      {saveError ? (
        <p role="alert" className="text-destructive mt-3 text-sm">
          {t('errors.unexpected')}
        </p>
      ) : null}

      {dialogOpen === 'enable' ? (
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby={`enable-dialog-title-${siteId}`}
          className="border-border mt-4 rounded-md border p-3"
        >
          <h3 id={`enable-dialog-title-${siteId}`} className="font-semibold">
            {t('confirm.enableTitle')}
          </h3>
          <p className="text-muted-foreground mt-1 text-sm">{t('confirm.enableBody')}</p>
          <label className="mt-2 flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={ack}
              onChange={(e) => setAck(e.currentTarget.checked)}
              data-testid="weekly-pulse-ack-checkbox"
            />
            {t('confirm.enableAck')}
          </label>
          <div className="mt-3 flex gap-2">
            <Button
              variant="default"
              onClick={handleEnable}
              loading={saving}
              disabled={!ack}
              data-testid="weekly-pulse-confirm-enable"
            >
              {t('confirm.confirmEnable')}
            </Button>
            <Button
              variant="ghost"
              onClick={() => {
                setDialogOpen(null);
                setAck(false);
              }}
            >
              {t('confirm.cancel')}
            </Button>
          </div>
        </div>
      ) : null}

      {dialogOpen === 'disable' ? (
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby={`disable-dialog-title-${siteId}`}
          className="border-border mt-4 rounded-md border p-3"
        >
          <h3 id={`disable-dialog-title-${siteId}`} className="font-semibold">
            {t('confirm.disableTitle')}
          </h3>
          <p className="text-muted-foreground mt-1 text-sm">{t('confirm.disableBody')}</p>
          <div className="mt-3 flex gap-2">
            <Button
              variant="secondary"
              onClick={handleDisable}
              loading={saving}
              data-testid="weekly-pulse-confirm-disable"
            >
              {t('confirm.confirmDisable')}
            </Button>
            <Button
              variant="ghost"
              onClick={() => {
                setDialogOpen(null);
              }}
            >
              {t('confirm.cancel')}
            </Button>
          </div>
        </div>
      ) : null}
    </section>
  );
}

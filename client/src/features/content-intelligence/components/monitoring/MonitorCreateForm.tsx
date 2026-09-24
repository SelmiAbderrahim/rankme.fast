import { useCallback, useEffect, useId, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useSearchParams } from 'react-router-dom';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@shared/ui/card';
import { Button } from '@shared/ui/button';
import { Input } from '@shared/ui/input';
import { Label } from '@shared/ui/label';
import { RadioGroup, RadioGroupItem } from '@shared/ui/radio-group';
import { Alert, AlertDescription, AlertTitle } from '@shared/ui/alert';
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
import { Empty, EmptyContent, EmptyDescription, EmptyMedia, EmptyTitle } from '@shared/ui/empty';
import { useAppDispatch, useAppSelector } from '@shared/hooks/redux';
import { clearMonitorSubmitError } from '../../store/slice';
import { createMonitorThunk, loadCompetitorProfiles } from '../../store/thunks';
import {
  selectCompetitorProfiles,
  selectMonitorActiveLimit,
  selectMonitorSubmitError,
  selectMonitorSubmitting,
  selectMonitorUsedSlots,
} from '../../store/selectors';
import {
  CONTENT_MONITOR_ACTIVE_LIMIT,
  CONTENT_MONITOR_WEEKLY_CADENCE,
  type ContentMonitorTargetKind,
} from '../../types';

interface MonitorCreateFormProps {
  siteId: string;
  /** Switch the sub-view URL param — used to jump to the competitors view. */
  onManageCompetitors: () => void;
  onCreated?: ((monitorId: string) => void) | undefined;
}

function isValidHttpUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === 'https:' || url.protocol === 'http:';
  } catch {
    return false;
  }
}

/** Compact flat slot meter (bordered bar, never overfilled). */
function AllowanceMeter({
  labelKey,
  used,
  cap,
  testId,
}: {
  labelKey: string;
  used: number;
  cap: number;
  testId: string;
}) {
  const { t } = useTranslation('contentIntelligence');
  const percent = Math.min(100, Math.round((used / cap) * 100));
  const full = used >= cap;
  return (
    <div className="flex flex-col gap-1" data-testid={testId}>
      <div className="flex items-baseline justify-between gap-2">
        <span className="text-sm font-medium">{t(labelKey)}</span>
        <span className="text-muted-foreground text-sm tabular-nums">
          {t('monitoring.form.allowanceValue', { used, cap })}
        </span>
      </div>
      <div
        role="progressbar"
        aria-label={t(labelKey)}
        aria-valuenow={used}
        aria-valuemin={0}
        aria-valuemax={cap}
        className="border-border bg-muted h-2 w-full overflow-hidden rounded border"
      >
        <div
          className={full ? 'bg-warning h-full' : 'bg-primary h-full'}
          style={{ width: `${percent}%` }}
        />
      </div>
    </div>
  );
}

/**
 * Create a weekly public-page monitor for an owned page OR a confirmed-competitor
 * page. The cadence is FIXED weekly (shown read-only). A live meter shows the
 * active-monitor slot limit; the server re-validates every bound (SSRF,
 * eligibility, active count).
 */
export function MonitorCreateForm({ siteId, onManageCompetitors, onCreated }: MonitorCreateFormProps) {
  const { t, i18n } = useTranslation('contentIntelligence');
  const dispatch = useAppDispatch();
  const usedSlots = useAppSelector(selectMonitorUsedSlots);
  const rawLimit = useAppSelector(selectMonitorActiveLimit);
  const submitting = useAppSelector(selectMonitorSubmitting);
  const submitError = useAppSelector(selectMonitorSubmitError);
  const profiles = useAppSelector(selectCompetitorProfiles);
  const [params] = useSearchParams();
  const prefillTargetUrl = params.get('prefillTargetUrl');
  const prefillTargetKind = params.get('prefillTargetKind');
  const prefillCompetitorId = params.get('prefillCompetitorId');

  const activeLimit = rawLimit > 0 ? rawLimit : CONTENT_MONITOR_ACTIVE_LIMIT;
  const activeCompetitors = useMemo(
    () => profiles.filter((p) => p.status === 'active'),
    [profiles],
  );

  const [targetKind, setTargetKind] = useState<ContentMonitorTargetKind>('owned');
  const [ownedUrl, setOwnedUrl] = useState('');
  const [competitorId, setCompetitorId] = useState<string | null>(null);
  const [competitorUrl, setCompetitorUrl] = useState('');
  const [inlineErrorKey, setInlineErrorKey] = useState<string | null>(null);
  const [confirmOpen, setConfirmOpen] = useState(false);

  const ownedFieldId = useId();
  const competitorFieldId = useId();

  useEffect(() => {
    const promise = dispatch(loadCompetitorProfiles({ siteId, status: 'active' }));
    return () => promise.abort();
  }, [dispatch, siteId]);

  useEffect(() => {
    if (
      prefillTargetKind !== 'competitor' ||
      !prefillTargetUrl ||
      !prefillCompetitorId ||
      !activeCompetitors.some((profile) => profile.id === prefillCompetitorId)
    ) return;
    setTargetKind('competitor');
    setCompetitorId(prefillCompetitorId);
    setCompetitorUrl(prefillTargetUrl);
  }, [activeCompetitors, prefillCompetitorId, prefillTargetKind, prefillTargetUrl]);

  const onField = useCallback(() => {
    setInlineErrorKey(null);
    if (submitError) dispatch(clearMonitorSubmitError());
  }, [dispatch, submitError]);

  const onSelectCompetitor = useCallback(
    (id: string) => {
      setCompetitorId(id);
      // The RadioGroup only ever emits an id from `activeCompetitors`.
      setCompetitorUrl(activeCompetitors.find((p) => p.id === id)!.origin);
      onField();
    },
    [activeCompetitors, onField],
  );

  const slotsFull = usedSlots >= activeLimit;

  const effectiveUrl = targetKind === 'owned' ? ownedUrl : competitorUrl;

  const validate = useCallback((): string | null => {
    if (targetKind === 'competitor' && competitorId === null) {
      return 'monitoring.form.errors.noCompetitor';
    }
    if (!isValidHttpUrl(effectiveUrl.trim())) return 'monitoring.form.errors.invalidUrl';
    return null;
  }, [competitorId, effectiveUrl, targetKind]);

  const onSubmit = useCallback(
    (e: React.FormEvent<HTMLFormElement>) => {
      e.preventDefault();
      if (submitting || slotsFull) return;
      const error = validate();
      if (error) {
        setInlineErrorKey(error);
        return;
      }
      setConfirmOpen(true);
    },
    [slotsFull, submitting, validate],
  );

  const confirmCreate = useCallback(
    async () => {
      const result = await dispatch(
        createMonitorThunk({
          siteId,
          targetUrl: effectiveUrl.trim(),
          targetKind,
          locale: i18n.language.split('-')[0]!,
        }),
      );
      if (createMonitorThunk.fulfilled.match(result)) {
        setConfirmOpen(false);
        setOwnedUrl('');
        setCompetitorId(null);
        setCompetitorUrl('');
        onCreated?.(result.payload.monitor.monitorId);
      }
    },
    [dispatch, effectiveUrl, i18n.language, onCreated, siteId, targetKind],
  );

  return (
    <Card data-testid="monitor-create">
      <CardHeader>
        <CardTitle>{t('monitoring.form.title')}</CardTitle>
        <CardDescription>{t('monitoring.form.description')}</CardDescription>
      </CardHeader>
      <CardContent>
        <div className="mb-4">
          <AllowanceMeter
            labelKey="monitoring.form.slots"
            used={usedSlots}
            cap={activeLimit}
            testId="monitor-slot-meter"
          />
        </div>

        <form onSubmit={onSubmit} className="flex flex-col gap-4" noValidate>
          <fieldset className="flex flex-col gap-2">
            <legend className="text-sm font-medium">{t('monitoring.form.targetKind')}</legend>
            <RadioGroup
              value={targetKind}
              onValueChange={(v) => {
                setTargetKind(v as ContentMonitorTargetKind);
                onField();
              }}
              className="flex flex-col gap-2 sm:flex-row"
            >
              {(['owned', 'competitor'] as const).map((kind) => (
                <label
                  key={kind}
                  htmlFor={`monitor-kind-${kind}`}
                  className={`flex flex-1 cursor-pointer items-start gap-2 rounded-md border p-3 ${
                    targetKind === kind ? 'border-primary' : 'border-border'
                  }`}
                >
                  <RadioGroupItem
                    id={`monitor-kind-${kind}`}
                    value={kind}
                    data-testid={`monitor-kind-${kind}`}
                    className="mt-1"
                  />
                  <span className="flex flex-col gap-0.5">
                    <span className="text-sm font-medium">
                      {t(`monitoring.form.targetKinds.${kind}.label`)}
                    </span>
                    <span className="text-muted-foreground text-xs">
                      {t(`monitoring.form.targetKinds.${kind}.hint`)}
                    </span>
                  </span>
                </label>
              ))}
            </RadioGroup>
          </fieldset>

          {targetKind === 'owned' ? (
            <div className="flex flex-col gap-2">
              <Label htmlFor={ownedFieldId}>{t('monitoring.form.ownedUrl')}</Label>
              <Input
                id={ownedFieldId}
                type="url"
                inputMode="url"
                value={ownedUrl}
                placeholder="https://example.com/pricing"
                onChange={(e) => {
                  setOwnedUrl(e.target.value);
                  onField();
                }}
                data-testid="monitor-owned-url"
              />
              <p className="text-muted-foreground text-xs">{t('monitoring.form.ownedUrlHint')}</p>
            </div>
          ) : activeCompetitors.length === 0 ? (
            <Empty data-testid="monitor-no-competitors">
              <EmptyMedia />
              <EmptyContent>
                <EmptyTitle>{t('monitoring.form.noCompetitors.title')}</EmptyTitle>
                <EmptyDescription>
                  {t('monitoring.form.noCompetitors.description')}
                </EmptyDescription>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="mt-2"
                  onClick={onManageCompetitors}
                  data-testid="monitor-manage-competitors"
                >
                  {t('monitoring.form.noCompetitors.action')}
                </Button>
              </EmptyContent>
            </Empty>
          ) : (
            <div className="flex flex-col gap-3">
              <fieldset className="flex flex-col gap-2">
                <legend className="text-sm font-medium">
                  {t('monitoring.form.selectCompetitor')}
                </legend>
                <RadioGroup
                  value={competitorId ?? ''}
                  onValueChange={onSelectCompetitor}
                  className="flex flex-col gap-2"
                  data-testid="monitor-competitor-select"
                >
                  {activeCompetitors.map((p) => (
                    <label
                      key={p.id}
                      htmlFor={`monitor-competitor-${p.id}`}
                      className="flex items-center gap-2 text-sm"
                    >
                      <RadioGroupItem
                        id={`monitor-competitor-${p.id}`}
                        value={p.id}
                        data-testid={`monitor-competitor-${p.id}`}
                      />
                      <span>{p.registrableDomain}</span>
                    </label>
                  ))}
                </RadioGroup>
              </fieldset>
              <div className="flex flex-col gap-2">
                <Label htmlFor={competitorFieldId}>{t('monitoring.form.competitorUrl')}</Label>
                <Input
                  id={competitorFieldId}
                  type="url"
                  inputMode="url"
                  value={competitorUrl}
                  placeholder="https://competitor.com/pricing"
                  onChange={(e) => {
                    setCompetitorUrl(e.target.value);
                    onField();
                  }}
                  data-testid="monitor-competitor-url"
                />
                <p className="text-muted-foreground text-xs">
                  {t('monitoring.form.competitorUrlHint')}
                </p>
              </div>
            </div>
          )}

          <div
            className="border-border rounded-md border p-3"
            data-testid="monitor-cadence"
          >
            <p className="text-sm font-medium">{t('monitoring.form.cadenceTitle')}</p>
            <p className="text-muted-foreground mt-1 text-sm">
              {t('monitoring.form.cadenceValue', { cadence: t(`monitoring.cadence.${CONTENT_MONITOR_WEEKLY_CADENCE}`) })}
            </p>
          </div>

          {inlineErrorKey ? (
            <p className="text-destructive text-sm" role="alert" data-testid="monitor-inline-error">
              {t(inlineErrorKey)}
            </p>
          ) : null}

          {submitError ? (
            <Alert variant="destructive" data-testid="monitor-server-error">
              <AlertTitle>{t('monitoring.errors.createFailed')}</AlertTitle>
              <AlertDescription>{submitError}</AlertDescription>
            </Alert>
          ) : null}

          {slotsFull ? (
            <p className="text-muted-foreground text-xs" data-testid="monitor-slots-full">
              {t('monitoring.form.slotsFull', { limit: activeLimit })}
            </p>
          ) : null}

          <div>
            <Button
              type="submit"
              loading={submitting}
              loadingLabel={t('monitoring.form.submitting')}
              disabled={slotsFull}
              data-testid="monitor-submit"
            >
              {t('monitoring.form.submit')}
            </Button>
          </div>
        </form>
        <AlertDialog open={confirmOpen} onOpenChange={setConfirmOpen}>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>{t('monitoring.form.confirmTitle')}</AlertDialogTitle>
              <AlertDialogDescription>
                {t('monitoring.form.confirmDescription', {
                  cadence: t(`monitoring.cadence.${CONTENT_MONITOR_WEEKLY_CADENCE}`),
                  url: effectiveUrl,
                })}
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>{t('monitoring.form.confirmCancel')}</AlertDialogCancel>
              <AlertDialogAction disabled={submitting || slotsFull} onClick={() => void confirmCreate()}>
                {t('monitoring.form.confirmAction')}
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </CardContent>
    </Card>
  );
}

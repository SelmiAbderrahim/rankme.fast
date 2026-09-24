import { useCallback, useEffect, useMemo, useState, type FormEvent } from 'react';
import { useTranslation } from 'react-i18next';
import {
  CalendarClock,
  Copy,
  FileDown,
  Link2,
  Lock,
  Pencil,
  RefreshCw,
  Send,
  Trash2,
} from 'lucide-react';
import { ApiError } from '@shared/api/client';
import { ReportExportControl } from '@features/report-export';
import { SUPPORTED_LOCALES, type SupportedLocale } from '@shared/i18n';
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
  AlertDialogTrigger,
} from '@shared/ui/alert-dialog';
import { Button } from '@shared/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@shared/ui/card';
import { Checkbox } from '@shared/ui/checkbox';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@shared/ui/dialog';
import { Input } from '@shared/ui/input';
import { Label } from '@shared/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@shared/ui/select';
import { Skeleton } from '@shared/ui/skeleton';
import { StatusChip, type StatusTone } from '@shared/ui/status-chip';
import { Switch } from '@shared/ui/switch';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@shared/ui/table';
import { TableHeaderHelp } from '@shared/ui/table-header-help';
import {
  createClientPortalLink,
  createScheduledReport,
  deleteScheduledReport,
  getClientReportsOverview,
  getScheduledReportDeliveries,
  revokeClientPortalLink,
  updateScheduledReport,
} from '../api';
import type {
  ClientReportSections,
  ClientReportsOverview,
  CreatedClientPortalLink,
  ScheduledReport,
  ScheduledReportDelivery,
  ScheduledReportInput,
} from '../types';

interface ClientReportsPanelProps {
  siteId: string;
}

const DEFAULT_SECTIONS: ClientReportSections = { audit: true, ranks: true, gsc: true };

const DEFAULT_SCHEDULE: ScheduledReportInput = {
  name: '',
  frequency: 'weekly',
  weekdayUtc: 1,
  monthdayUtc: null,
  hourUtc: 9,
  locale: 'en',
  recipients: [],
  sections: DEFAULT_SECTIONS,
  enabled: true,
};

function hasSection(sections: ClientReportSections): boolean {
  return sections.audit || sections.ranks || sections.gsc;
}

function formatDate(value: string | null, locale: string): string {
  if (!value) return '—';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '—';
  return new Intl.DateTimeFormat(locale, {
    dateStyle: 'medium',
    timeStyle: 'short',
    timeZone: 'UTC',
  }).format(date);
}

function weekdayName(day: number, locale: string): string {
  return new Intl.DateTimeFormat(locale, { weekday: 'long', timeZone: 'UTC' }).format(
    new Date(Date.UTC(2024, 0, 7 + day)),
  );
}

function statusTone(status: ScheduledReportDelivery['status']): StatusTone {
  if (status === 'sent') return 'success';
  if (status === 'failed') return 'destructive';
  return 'muted';
}

function messageFromError(error: unknown, fallback: string): string {
  if (!(error instanceof ApiError) || typeof error.data !== 'object' || error.data === null) {
    return fallback;
  }
  const data = error.data as { error?: { message?: unknown } };
  return typeof data.error?.message === 'string' ? data.error.message : fallback;
}

function SectionPicker({
  sections,
  onChange,
  disabled = false,
  idPrefix,
}: {
  sections: ClientReportSections;
  onChange: (sections: ClientReportSections) => void;
  disabled?: boolean;
  idPrefix: string;
}) {
  const { t } = useTranslation('clientReports');
  const rows: Array<[keyof ClientReportSections, string]> = [
    ['audit', t('composer.audit')],
    ['ranks', t('composer.ranks')],
    ['gsc', t('composer.gsc')],
  ];
  return (
    <fieldset className="grid gap-3 sm:grid-cols-3">
      <legend className="sr-only">{t('composer.title')}</legend>
      {rows.map(([key, label]) => {
        const id = `${idPrefix}-${key}`;
        return (
          <div key={key} className="flex min-h-11 items-center gap-2 rounded-md border px-3">
            <Checkbox
              id={id}
              checked={sections[key]}
              disabled={disabled}
              onCheckedChange={(checked) => onChange({ ...sections, [key]: checked === true })}
            />
            <Label htmlFor={id} className="cursor-pointer font-normal">
              {label}
            </Label>
          </div>
        );
      })}
    </fieldset>
  );
}

function LocaleSelect({
  id,
  value,
  onChange,
  disabled = false,
}: {
  id: string;
  value: SupportedLocale;
  onChange: (locale: SupportedLocale) => void;
  disabled?: boolean;
}) {
  const { t } = useTranslation(['clientReports', 'language']);
  return (
    <div className="space-y-2">
      <Label htmlFor={id}>{t('clientReports:composer.locale')}</Label>
      <Select
        value={value}
        onValueChange={(next) => onChange(next as SupportedLocale)}
        disabled={disabled}
      >
        <SelectTrigger id={id} className="min-h-11 w-full">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {SUPPORTED_LOCALES.map((locale) => (
            <SelectItem key={locale} value={locale}>
              {t(`language:names.${locale}`)}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}

function ScheduleDialog({
  open,
  schedule,
  onOpenChange,
  onSaved,
  siteId,
}: {
  open: boolean;
  schedule: ScheduledReport | null;
  onOpenChange: (open: boolean) => void;
  onSaved: () => Promise<void>;
  siteId: string;
}) {
  const { t, i18n } = useTranslation('clientReports');
  const [form, setForm] = useState<ScheduledReportInput>(DEFAULT_SCHEDULE);
  const [recipientText, setRecipientText] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!open) return;
    if (schedule) {
      setForm({
        name: schedule.name,
        frequency: schedule.frequency,
        weekdayUtc: schedule.weekdayUtc,
        monthdayUtc: schedule.monthdayUtc,
        hourUtc: schedule.hourUtc,
        locale: schedule.locale,
        recipients: schedule.recipients,
        sections: schedule.sections,
        enabled: schedule.enabled,
      });
      setRecipientText(schedule.recipients.join(', '));
    } else {
      setForm(DEFAULT_SCHEDULE);
      setRecipientText('');
    }
    setError('');
  }, [open, schedule]);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    const recipients = [
      ...new Set(
        recipientText
          .split(',')
          .map((value) => value.trim().toLowerCase())
          .filter(Boolean),
      ),
    ].sort();
    if (recipients.length === 0 || recipients.length > 10 || !hasSection(form.sections)) {
      setError(t('schedules.saveFailed'));
      return;
    }
    const body: ScheduledReportInput = {
      ...form,
      recipients,
      weekdayUtc: form.frequency === 'weekly' ? (form.weekdayUtc ?? 1) : null,
      monthdayUtc: form.frequency === 'monthly' ? (form.monthdayUtc ?? 1) : null,
    };
    setSaving(true);
    setError('');
    try {
      if (schedule) await updateScheduledReport(siteId, schedule.id, body);
      else await createScheduledReport(siteId, body);
      onOpenChange(false);
      await onSaved();
    } catch (caught) {
      setError(messageFromError(caught, t('schedules.saveFailed')));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>
            {t(schedule ? 'schedules.dialogEdit' : 'schedules.dialogCreate')}
          </DialogTitle>
          <DialogDescription>{t('schedules.description')}</DialogDescription>
        </DialogHeader>
        <form className="space-y-5" onSubmit={(event) => void submit(event)}>
          <div className="space-y-2">
            <Label htmlFor="report-schedule-name">{t('schedules.name')}</Label>
            <Input
              id="report-schedule-name"
              required
              maxLength={80}
              value={form.name}
              onChange={(event) => setForm({ ...form, name: event.target.value })}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="report-schedule-recipients">{t('schedules.recipients')}</Label>
            <Input
              id="report-schedule-recipients"
              required
              value={recipientText}
              onChange={(event) => setRecipientText(event.target.value)}
              aria-describedby="report-schedule-recipients-help"
            />
            <p id="report-schedule-recipients-help" className="text-muted-foreground text-sm">
              {t('schedules.recipientsHelp')}
            </p>
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="report-schedule-frequency">{t('schedules.frequency')}</Label>
              <Select
                value={form.frequency}
                onValueChange={(frequency: 'weekly' | 'monthly') => setForm({ ...form, frequency })}
              >
                <SelectTrigger id="report-schedule-frequency" className="min-h-11 w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="weekly">{t('schedules.weekly')}</SelectItem>
                  <SelectItem value="monthly">{t('schedules.monthly')}</SelectItem>
                </SelectContent>
              </Select>
            </div>
            {form.frequency === 'weekly' ? (
              <div className="space-y-2">
                <Label htmlFor="report-schedule-weekday">{t('schedules.weekday')}</Label>
                <Select
                  value={String(form.weekdayUtc ?? 1)}
                  onValueChange={(value) => setForm({ ...form, weekdayUtc: Number(value) })}
                >
                  <SelectTrigger id="report-schedule-weekday" className="min-h-11 w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {Array.from({ length: 7 }, (_, day) => (
                      <SelectItem key={day} value={String(day)}>
                        {weekdayName(day, i18n.language)}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            ) : (
              <div className="space-y-2">
                <Label htmlFor="report-schedule-monthday">{t('schedules.monthday')}</Label>
                <Input
                  id="report-schedule-monthday"
                  type="number"
                  min={1}
                  max={28}
                  required
                  value={form.monthdayUtc ?? 1}
                  onChange={(event) =>
                    setForm({ ...form, monthdayUtc: Number(event.target.value) })
                  }
                />
              </div>
            )}
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="report-schedule-hour">{t('schedules.hour')}</Label>
              <Input
                id="report-schedule-hour"
                type="number"
                min={0}
                max={23}
                required
                value={form.hourUtc}
                onChange={(event) => setForm({ ...form, hourUtc: Number(event.target.value) })}
              />
            </div>
            <LocaleSelect
              id="report-schedule-locale"
              value={form.locale}
              onChange={(locale) => setForm({ ...form, locale })}
            />
          </div>
          <SectionPicker
            idPrefix="report-schedule-section"
            sections={form.sections}
            onChange={(sections) => setForm({ ...form, sections })}
          />
          <div className="flex min-h-11 items-center justify-between gap-4 rounded-md border px-3">
            <Label htmlFor="report-schedule-enabled">{t('schedules.enabled')}</Label>
            <Switch
              id="report-schedule-enabled"
              checked={form.enabled}
              onCheckedChange={(enabled) => setForm({ ...form, enabled })}
            />
          </div>
          {error ? (
            <p className="text-destructive text-sm" role="alert">
              {error}
            </p>
          ) : null}
          <DialogFooter>
            <Button type="submit" loading={saving} loadingLabel={t('schedules.saving')}>
              {t('schedules.save')}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function PortalDialog({
  open,
  onOpenChange,
  onCreated,
  siteId,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onCreated: () => Promise<void>;
  siteId: string;
}) {
  const { t } = useTranslation('clientReports');
  const [clientLabel, setClientLabel] = useState('');
  const [locale, setLocale] = useState<SupportedLocale>('en');
  const [sections, setSections] = useState<ClientReportSections>(DEFAULT_SECTIONS);
  const [expiresInDays, setExpiresInDays] = useState(90);
  const [created, setCreated] = useState<CreatedClientPortalLink | null>(null);
  const [copied, setCopied] = useState(false);
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!open) return;
    setClientLabel('');
    setLocale('en');
    setSections(DEFAULT_SECTIONS);
    setExpiresInDays(90);
    setCreated(null);
    setCopied(false);
    setError('');
  }, [open]);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (!hasSection(sections)) {
      setError(t('composer.selectOne'));
      return;
    }
    setCreating(true);
    setError('');
    try {
      const result = await createClientPortalLink(siteId, {
        clientLabel,
        locale,
        sections,
        expiresInDays,
      });
      setCreated(result);
      await onCreated();
    } catch (caught) {
      setError(messageFromError(caught, t('portals.createFailed')));
    } finally {
      setCreating(false);
    }
  };

  const copy = async (url: string) => {
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
    } catch {
      setError(t('portals.copyFailed'));
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>{t('portals.dialogTitle')}</DialogTitle>
          <DialogDescription>{t('portals.description')}</DialogDescription>
        </DialogHeader>
        {created ? (
          <div className="space-y-4" aria-live="polite">
            <Alert>
              <Link2 aria-hidden="true" />
              <AlertTitle>{t('portals.showOnce')}</AlertTitle>
              <AlertDescription>
                <Input
                  className="mt-3 font-mono text-xs"
                  readOnly
                  value={created.url}
                  aria-label={t('portals.showOnce')}
                  onFocus={(event) => event.currentTarget.select()}
                />
              </AlertDescription>
            </Alert>
            <Button type="button" onClick={() => void copy(created.url)}>
              <Copy aria-hidden="true" />
              {t(copied ? 'portals.copied' : 'portals.copy')}
            </Button>
            {error ? (
              <p className="text-destructive text-sm" role="alert">
                {error}
              </p>
            ) : null}
          </div>
        ) : (
          <form className="space-y-5" onSubmit={(event) => void submit(event)}>
            <div className="space-y-2">
              <Label htmlFor="portal-client-label">{t('portals.clientLabel')}</Label>
              <Input
                id="portal-client-label"
                required
                maxLength={80}
                value={clientLabel}
                onChange={(event) => setClientLabel(event.target.value)}
                aria-describedby="portal-client-label-help"
              />
              <p id="portal-client-label-help" className="text-muted-foreground text-sm">
                {t('portals.clientLabelHelp')}
              </p>
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              <LocaleSelect id="portal-locale" value={locale} onChange={setLocale} />
              <div className="space-y-2">
                <Label htmlFor="portal-expiry">{t('portals.expires')}</Label>
                <Input
                  id="portal-expiry"
                  type="number"
                  min={1}
                  max={365}
                  required
                  value={expiresInDays}
                  onChange={(event) => setExpiresInDays(Number(event.target.value))}
                />
              </div>
            </div>
            <SectionPicker idPrefix="portal-section" sections={sections} onChange={setSections} />
            {error ? (
              <p className="text-destructive text-sm" role="alert">
                {error}
              </p>
            ) : null}
            <DialogFooter>
              <Button type="submit" loading={creating} loadingLabel={t('portals.creating')}>
                {t('portals.save')}
              </Button>
            </DialogFooter>
          </form>
        )}
      </DialogContent>
    </Dialog>
  );
}

export function ClientReportsPanel({ siteId }: ClientReportsPanelProps) {
  const { t, i18n } = useTranslation(['clientReports', 'common']);
  const [overview, setOverview] = useState<ClientReportsOverview | null>(null);
  const [deliveries, setDeliveries] = useState<ScheduledReportDelivery[]>([]);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState('');
  const [composerSections, setComposerSections] = useState(DEFAULT_SECTIONS);
  const [composerLocale, setComposerLocale] = useState<SupportedLocale>('en');
  const [scheduleOpen, setScheduleOpen] = useState(false);
  const [editingSchedule, setEditingSchedule] = useState<ScheduledReport | null>(null);
  const [portalOpen, setPortalOpen] = useState(false);
  const [mutationError, setMutationError] = useState('');
  const [loadingMore, setLoadingMore] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setLoadError('');
    try {
      const [overviewResult, deliveryResult] = await Promise.all([
        getClientReportsOverview(siteId),
        getScheduledReportDeliveries(siteId),
      ]);
      setOverview(overviewResult);
      setDeliveries(deliveryResult.deliveries);
      setNextCursor(deliveryResult.nextCursor);
    } catch (error) {
      setLoadError(messageFromError(error, t('clientReports:dashboard.loadFailed')));
    } finally {
      setLoading(false);
    }
  }, [siteId, t]);

  const reloadOverview = useCallback(async () => {
    const result = await getClientReportsOverview(siteId);
    setOverview(result);
  }, [siteId]);

  useEffect(() => {
    void load();
  }, [load]);

  const reportDisabled = !overview?.enabled;

  const removeSchedule = async (scheduleId: string) => {
    setMutationError('');
    try {
      await deleteScheduledReport(siteId, scheduleId);
      await reloadOverview();
    } catch (error) {
      setMutationError(messageFromError(error, t('clientReports:schedules.deleteFailed')));
    }
  };

  const revokePortal = async (portalId: string) => {
    setMutationError('');
    try {
      await revokeClientPortalLink(siteId, portalId);
      await reloadOverview();
    } catch (error) {
      setMutationError(messageFromError(error, t('clientReports:portals.revokeFailed')));
    }
  };

  const loadMore = async (cursor: string) => {
    setLoadingMore(true);
    try {
      const result = await getScheduledReportDeliveries(siteId, cursor);
      setDeliveries((current) => [...current, ...result.deliveries]);
      setNextCursor(result.nextCursor);
    } catch (error) {
      setMutationError(messageFromError(error, t('clientReports:dashboard.loadFailed')));
    } finally {
      setLoadingMore(false);
    }
  };

  const deliveryRows = useMemo(
    () =>
      deliveries.map((delivery) => ({
        ...delivery,
        label: t(`clientReports:deliveries.${delivery.status}`),
      })),
    [deliveries, t],
  );

  if (loading && !overview) {
    return (
      <div className="space-y-4" aria-busy="true" data-testid="client-reports-loading">
        <p className="text-muted-foreground text-sm">{t('clientReports:dashboard.loading')}</p>
        <Skeleton className="h-40 w-full" />
        <Skeleton className="h-40 w-full" />
      </div>
    );
  }

  if (loadError && !overview) {
    return (
      <Alert variant="destructive" data-testid="client-reports-error">
        <AlertTitle>{t('clientReports:dashboard.loadFailed')}</AlertTitle>
        <AlertDescription className="mt-3">
          <p>{loadError}</p>
          <Button variant="outline" className="mt-3" onClick={() => void load()}>
            <RefreshCw aria-hidden="true" />
            {t('clientReports:dashboard.retry')}
          </Button>
        </AlertDescription>
      </Alert>
    );
  }

  if (!overview) return null;

  return (
    <section
      className="space-y-6"
      aria-labelledby="client-reports-title"
      data-testid="client-reports-panel"
    >
      <div>
        <h2 id="client-reports-title" className="text-2xl font-semibold">
          {t('clientReports:dashboard.title')}
        </h2>
        <p className="text-muted-foreground mt-1 text-sm">
          {t('clientReports:dashboard.description')}
        </p>
      </div>

      {reportDisabled ? (
        <Alert data-testid="client-reports-disabled">
          <Lock aria-hidden="true" />
          <AlertTitle>{t('clientReports:dashboard.disabledTitle')}</AlertTitle>
          <AlertDescription>{t('clientReports:dashboard.disabledDescription')}</AlertDescription>
        </Alert>
      ) : null}

      {mutationError ? (
        <p className="text-destructive text-sm" role="alert">
          {mutationError}
        </p>
      ) : null}

      <Card>
        <CardHeader>
          <div className="flex items-start gap-3">
            <FileDown className="mt-0.5 size-5 text-muted-foreground" aria-hidden="true" />
            <div>
              <CardTitle>{t('clientReports:composer.title')}</CardTitle>
              <CardDescription>{t('clientReports:composer.description')}</CardDescription>
            </div>
          </div>
        </CardHeader>
        <CardContent className="space-y-5">
          <SectionPicker
            idPrefix="report-composer-section"
            sections={composerSections}
            onChange={setComposerSections}
            disabled={reportDisabled}
          />
          <div className="grid items-end gap-4 sm:grid-cols-[minmax(12rem,1fr)_auto]">
            <LocaleSelect
              id="report-composer-locale"
              value={composerLocale}
              onChange={setComposerLocale}
              disabled={reportDisabled}
            />
            <ReportExportControl
              kind="client.composite"
              target={{ scope: 'site', siteId }}
              selection={{ sections: composerSections }}
              locale={composerLocale}
              disabled={reportDisabled || !hasSection(composerSections)}
              className="min-h-11"
            />
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div className="flex items-start gap-3">
              <CalendarClock className="mt-0.5 size-5 text-muted-foreground" aria-hidden="true" />
              <div>
                <CardTitle>{t('clientReports:schedules.title')}</CardTitle>
                <CardDescription>{t('clientReports:schedules.description')}</CardDescription>
              </div>
            </div>
            <Button
              disabled={reportDisabled}
              onClick={() => {
                setEditingSchedule(null);
                setScheduleOpen(true);
              }}
            >
              {t('clientReports:schedules.create')}
            </Button>
          </div>
        </CardHeader>
        <CardContent>
          {overview.schedules.length === 0 ? (
            <p className="text-muted-foreground py-6 text-center text-sm">
              {t('clientReports:schedules.empty')}
            </p>
          ) : (
            <ul className="divide-y" aria-label={t('clientReports:schedules.title')}>
              {overview.schedules.map((schedule) => (
                <li
                  key={schedule.id}
                  className="flex flex-wrap items-center justify-between gap-4 py-4"
                >
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <p className="font-medium break-words">{schedule.name}</p>
                      {!schedule.enabled ? (
                        <StatusChip>{t('clientReports:schedules.disabled')}</StatusChip>
                      ) : null}
                    </div>
                    <p className="text-muted-foreground mt-1 text-sm">
                      {schedule.frequency === 'weekly'
                        ? t('clientReports:schedules.weekly')
                        : t('clientReports:schedules.monthly')}
                      {' · '}
                      {schedule.recipients.join(', ')}
                    </p>
                    {schedule.nextRunAt ? (
                      <p className="text-muted-foreground text-xs">
                        {t('clientReports:schedules.next', {
                          date: formatDate(schedule.nextRunAt, i18n.language),
                        })}
                      </p>
                    ) : null}
                  </div>
                  <div className="flex gap-2">
                    <Button
                      variant="outline"
                      size="sm"
                      disabled={reportDisabled}
                      onClick={() => {
                        setEditingSchedule(schedule);
                        setScheduleOpen(true);
                      }}
                    >
                      <Pencil aria-hidden="true" />
                      {t('clientReports:schedules.edit')}
                    </Button>
                    <AlertDialog>
                      <AlertDialogTrigger asChild>
                        <Button variant="outline" size="sm">
                          <Trash2 aria-hidden="true" />
                          {t('clientReports:schedules.delete')}
                        </Button>
                      </AlertDialogTrigger>
                      <AlertDialogContent>
                        <AlertDialogHeader>
                          <AlertDialogTitle>
                            {t('clientReports:schedules.deleteTitle')}
                          </AlertDialogTitle>
                          <AlertDialogDescription>
                            {t('clientReports:schedules.deleteDescription', {
                              name: schedule.name,
                            })}
                          </AlertDialogDescription>
                        </AlertDialogHeader>
                        <AlertDialogFooter>
                          <AlertDialogCancel>{t('clientReports:portals.cancel')}</AlertDialogCancel>
                          <AlertDialogAction onClick={() => void removeSchedule(schedule.id)}>
                            {t('clientReports:schedules.delete')}
                          </AlertDialogAction>
                        </AlertDialogFooter>
                      </AlertDialogContent>
                    </AlertDialog>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <div className="flex items-start gap-3">
            <Send className="mt-0.5 size-5 text-muted-foreground" aria-hidden="true" />
            <CardTitle>{t('clientReports:deliveries.title')}</CardTitle>
          </div>
        </CardHeader>
        <CardContent>
          {deliveryRows.length === 0 ? (
            <p className="text-muted-foreground py-6 text-center text-sm">
              {t('clientReports:deliveries.empty')}
            </p>
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>{t('clientReports:deliveries.recipient')}</TableHead>
                    <TableHead>{t('clientReports:deliveries.status')}</TableHead>
                    <TableHead>
                      <TableHeaderHelp
                        label={t('clientReports:deliveries.snapshot')}
                        description={t('common:tableHelp.reportSnapshot')}
                      />
                    </TableHead>
                    <TableHead>{t('clientReports:deliveries.finished')}</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {deliveryRows.map((delivery) => (
                    <TableRow key={delivery.id}>
                      <TableCell className="break-all">{delivery.recipient}</TableCell>
                      <TableCell>
                        <StatusChip tone={statusTone(delivery.status)} dot>
                          {delivery.label}
                        </StatusChip>
                      </TableCell>
                      <TableCell>{formatDate(delivery.snapshotDate, i18n.language)}</TableCell>
                      <TableCell>{formatDate(delivery.finishedAt, i18n.language)}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
          {nextCursor ? (
            <Button
              className="mt-4"
              variant="outline"
              loading={loadingMore}
              onClick={() => void loadMore(nextCursor)}
            >
              {t('clientReports:deliveries.loadMore')}
            </Button>
          ) : null}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div className="flex items-start gap-3">
              <Link2 className="mt-0.5 size-5 text-muted-foreground" aria-hidden="true" />
              <div>
                <CardTitle>{t('clientReports:portals.title')}</CardTitle>
                <CardDescription>{t('clientReports:portals.description')}</CardDescription>
              </div>
            </div>
            <Button disabled={reportDisabled} onClick={() => setPortalOpen(true)}>
              {t('clientReports:portals.create')}
            </Button>
          </div>
        </CardHeader>
        <CardContent>
          {overview.portals.length === 0 ? (
            <p className="text-muted-foreground py-6 text-center text-sm">
              {t('clientReports:portals.empty')}
            </p>
          ) : (
            <ul className="divide-y" aria-label={t('clientReports:portals.title')}>
              {overview.portals.map((portal) => (
                <li
                  key={portal.id}
                  className="flex flex-wrap items-center justify-between gap-4 py-4"
                >
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <p className="font-medium break-words">{portal.clientLabel}</p>
                      {portal.revokedAt ? (
                        <StatusChip tone="muted">{t('clientReports:portals.revoked')}</StatusChip>
                      ) : null}
                    </div>
                    <p className="text-muted-foreground text-sm">{portal.siteLabel}</p>
                    <p className="text-muted-foreground text-xs">
                      {t('clientReports:portals.expiresAt', {
                        date: formatDate(portal.expiresAt, i18n.language),
                      })}
                    </p>
                  </div>
                  {!portal.revokedAt ? (
                    <AlertDialog>
                      <AlertDialogTrigger asChild>
                        <Button variant="outline" size="sm">
                          {t('clientReports:portals.revoke')}
                        </Button>
                      </AlertDialogTrigger>
                      <AlertDialogContent>
                        <AlertDialogHeader>
                          <AlertDialogTitle>
                            {t('clientReports:portals.revokeTitle')}
                          </AlertDialogTitle>
                          <AlertDialogDescription>
                            {t('clientReports:portals.revokeDescription')}
                          </AlertDialogDescription>
                        </AlertDialogHeader>
                        <AlertDialogFooter>
                          <AlertDialogCancel>{t('clientReports:portals.cancel')}</AlertDialogCancel>
                          <AlertDialogAction onClick={() => void revokePortal(portal.id)}>
                            {t('clientReports:portals.confirmRevoke')}
                          </AlertDialogAction>
                        </AlertDialogFooter>
                      </AlertDialogContent>
                    </AlertDialog>
                  ) : null}
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>

      <ScheduleDialog
        open={scheduleOpen}
        schedule={editingSchedule}
        onOpenChange={setScheduleOpen}
        onSaved={reloadOverview}
        siteId={siteId}
      />
      <PortalDialog
        open={portalOpen}
        onOpenChange={setPortalOpen}
        onCreated={reloadOverview}
        siteId={siteId}
      />
    </section>
  );
}

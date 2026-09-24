import { useEffect, useMemo, useState } from 'react';
import { Check, Copy, Link2, Share2 } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { SUPPORTED_LOCALES, isSupportedLocale, type SupportedLocale } from '@shared/i18n';
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
import { Badge } from '@shared/ui/badge';
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
import {
  Field,
  FieldDescription,
  FieldError,
  FieldGroup,
  FieldLabel,
  FieldLegend,
  FieldSet,
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
import {
  createReportShare,
  createReportSnapshot,
  listReportShares,
  revokeReportShare,
} from '../api';
import { reportExportErrorMessage } from '../errorMapping';
import type {
  CreatedReportShare,
  PublicReportFormat,
  ReportExportCapability,
  ReportShareSummary,
  ReportTarget,
  ReportViewFilters,
} from '../types';

interface ReportShareDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  capability: ReportExportCapability;
  target: ReportTarget;
  selection: ReportViewFilters;
}

type ShareState = 'active' | 'revoked' | 'expired';

function shareState(share: ReportShareSummary): ShareState {
  if (share.revokedAt) return 'revoked';
  return Date.parse(share.expiresAt) <= Date.now() ? 'expired' : 'active';
}

export function ReportShareDialog({
  open,
  onOpenChange,
  capability,
  target,
  selection,
}: ReportShareDialogProps) {
  const { t, i18n } = useTranslation(['report', 'language']);
  const currentLocale: SupportedLocale = isSupportedLocale(i18n.language) ? i18n.language : 'en';
  const publicFormats = capability.share.formats;
  const [locale, setLocale] = useState<SupportedLocale>(currentLocale);
  const [expiresInDays, setExpiresInDays] = useState(30);
  const [formats, setFormats] = useState<PublicReportFormat[]>(publicFormats);
  const [snapshotId, setSnapshotId] = useState<string | null>(null);
  const [shares, setShares] = useState<ReportShareSummary[]>([]);
  const [created, setCreated] = useState<CreatedReportShare | null>(null);
  const [creating, setCreating] = useState(false);
  const [loadingShares, setLoadingShares] = useState(false);
  const [revokingId, setRevokingId] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!open) {
      setCreated(null);
      setCopied(false);
      setError('');
      return;
    }
    setLocale(currentLocale);
    setExpiresInDays(30);
    setFormats(publicFormats);
    setSnapshotId(null);
    setShares([]);
  }, [currentLocale, open, publicFormats]);

  const selectedFormats = useMemo(
    () => publicFormats.filter((format) => formats.includes(format)),
    [formats, publicFormats],
  );
  const expiryValid = Number.isInteger(expiresInDays) && expiresInDays >= 1 && expiresInDays <= 90;

  const create = async () => {
    setCreating(true);
    setError('');
    try {
      const snapshot = await createReportSnapshot({
        kind: capability.kind,
        format: capability.formats[0]!,
        target,
        selection,
        locale,
      });
      const share = await createReportShare(snapshot.id, {
        expiresInDays,
        formats: selectedFormats,
      });
      setSnapshotId(snapshot.id);
      setCreated(share);
      setShares([share]);
    } catch (caught) {
      setError(reportExportErrorMessage(caught, t('report:exportUi.errors.share')));
    } finally {
      setCreating(false);
    }
  };

  const loadShares = async () => {
    setLoadingShares(true);
    setError('');
    try {
      setShares(await listReportShares(snapshotId!));
    } catch (caught) {
      setError(reportExportErrorMessage(caught, t('report:exportUi.errors.list')));
    } finally {
      setLoadingShares(false);
    }
  };

  const copy = async (url: string) => {
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
    } catch {
      setError(t('report:exportUi.errors.copy'));
    }
  };

  const revoke = async (share: ReportShareSummary) => {
    setRevokingId(share.id);
    setError('');
    try {
      const updated = await revokeReportShare(share.snapshotId, share.id);
      setShares((current) => current.map((item) => (item.id === updated.id ? updated : item)));
    } catch (caught) {
      setError(reportExportErrorMessage(caught, t('report:exportUi.errors.revoke')));
    } finally {
      setRevokingId(null);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-xl" dir={i18n.dir()}>
        <DialogHeader>
          <DialogTitle>{t('report:exportUi.share.title')}</DialogTitle>
          <DialogDescription>{t('report:exportUi.share.description')}</DialogDescription>
        </DialogHeader>

        {created ? (
          <div className="flex flex-col gap-4" aria-live="polite">
            <Alert>
              <Link2 aria-hidden="true" />
              <AlertTitle>{t('report:exportUi.share.showOnce')}</AlertTitle>
              <AlertDescription className="flex flex-col gap-3">
                <Input
                  readOnly
                  value={created.url}
                  aria-label={t('report:exportUi.share.linkLabel')}
                  className="font-mono text-xs"
                  onFocus={(event) => event.currentTarget.select()}
                />
                <Button type="button" variant="outline" onClick={() => void copy(created.url)}>
                  {copied ? <Check data-icon="inline-start" /> : <Copy data-icon="inline-start" />}
                  {t(copied ? 'report:exportUi.share.copied' : 'report:exportUi.share.copy')}
                </Button>
              </AlertDescription>
            </Alert>
            <p className="text-sm text-muted-foreground">
              {t('report:exportUi.share.savedWithoutToken')}
            </p>
          </div>
        ) : (
          <FieldGroup>
            <Field>
              <FieldLabel htmlFor="report-share-locale">
                {t('report:exportUi.share.locale')}
              </FieldLabel>
              <Select value={locale} onValueChange={(value) => setLocale(value as SupportedLocale)}>
                <SelectTrigger id="report-share-locale" className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectGroup>
                    {SUPPORTED_LOCALES.map((value) => (
                      <SelectItem key={value} value={value}>
                        {t(`language:names.${value}`)}
                      </SelectItem>
                    ))}
                  </SelectGroup>
                </SelectContent>
              </Select>
            </Field>
            <Field>
              <FieldLabel htmlFor="report-share-expiry">
                {t('report:exportUi.share.expiry')}
              </FieldLabel>
              <Input
                id="report-share-expiry"
                type="number"
                min={1}
                max={90}
                value={expiresInDays}
                onChange={(event) => setExpiresInDays(Number(event.target.value))}
              />
              <FieldDescription>{t('report:exportUi.share.expiryHelp')}</FieldDescription>
            </Field>
            <FieldSet>
              <FieldLegend>{t('report:exportUi.share.permissions')}</FieldLegend>
              <div className="flex flex-col gap-3">
                {publicFormats.map((format) => {
                  const id = `report-share-format-${format}`;
                  return (
                    <Field key={format} orientation="horizontal">
                      <Checkbox
                        id={id}
                        checked={selectedFormats.includes(format)}
                        onCheckedChange={(checked) =>
                          setFormats((current) =>
                            checked === true
                              ? [...new Set([...current, format])]
                              : current.filter((item) => item !== format),
                          )
                        }
                      />
                      <FieldLabel htmlFor={id}>{t(`report:exportUi.formats.${format}`)}</FieldLabel>
                    </Field>
                  );
                })}
              </div>
            </FieldSet>
          </FieldGroup>
        )}

        {error ? <FieldError>{error}</FieldError> : null}

        {shares.length > 0 ? (
          <section className="flex flex-col gap-3" aria-labelledby="report-share-existing">
            <div className="flex items-center justify-between gap-3">
              <h3 id="report-share-existing" className="font-medium">
                {t('report:exportUi.share.existing')}
              </h3>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                loading={loadingShares}
                onClick={() => void loadShares()}
              >
                {t('report:exportUi.share.refresh')}
              </Button>
            </div>
            {shares.map((share) => {
              const state = shareState(share);
              return (
                <div
                  key={share.id}
                  className="flex flex-col gap-2 rounded-lg border p-3 sm:flex-row sm:items-center sm:justify-between"
                >
                  <div className="flex min-w-0 flex-col gap-1">
                    <Badge variant={state === 'active' ? 'secondary' : 'outline'} className="w-fit">
                      {t(`report:exportUi.states.${state}`)}
                    </Badge>
                    <span className="text-sm text-muted-foreground">
                      {new Intl.DateTimeFormat(locale, { dateStyle: 'medium' }).format(
                        new Date(share.expiresAt),
                      )}
                    </span>
                  </div>
                  {state === 'active' ? (
                    <AlertDialog>
                      <AlertDialogTrigger asChild>
                        <Button type="button" variant="outline" size="sm">
                          {t('report:exportUi.actions.revoke')}
                        </Button>
                      </AlertDialogTrigger>
                      <AlertDialogContent dir={i18n.dir()}>
                        <AlertDialogHeader>
                          <AlertDialogTitle>
                            {t('report:exportUi.confirm.revokeTitle')}
                          </AlertDialogTitle>
                          <AlertDialogDescription>
                            {t('report:exportUi.confirm.revokeBody')}
                          </AlertDialogDescription>
                        </AlertDialogHeader>
                        <AlertDialogFooter>
                          <AlertDialogCancel>
                            {t('report:exportUi.actions.cancel')}
                          </AlertDialogCancel>
                          <AlertDialogAction
                            variant="destructive"
                            disabled={revokingId === share.id}
                            onClick={() => void revoke(share)}
                          >
                            {t('report:exportUi.actions.revoke')}
                          </AlertDialogAction>
                        </AlertDialogFooter>
                      </AlertDialogContent>
                    </AlertDialog>
                  ) : null}
                </div>
              );
            })}
          </section>
        ) : null}

        <DialogFooter>
          {created ? (
            <Button type="button" onClick={() => onOpenChange(false)}>
              {t('report:exportUi.actions.done')}
            </Button>
          ) : (
            <Button
              type="button"
              loading={creating}
              loadingLabel={t('report:exportUi.share.creating')}
              disabled={!expiryValid || selectedFormats.length === 0}
              onClick={() => void create()}
            >
              <Share2 data-icon="inline-start" />
              {t('report:exportUi.share.create')}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

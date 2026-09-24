import { useEffect, useMemo, useRef, useState, type FormEvent } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { ReportExportControl } from '@features/report-export';
import { useAppDispatch, useAppSelector } from '@shared/hooks/redux';
import { SAFE_EXTERNAL_REL, safeExternalHref } from '@shared/security';
import { Alert, AlertDescription, AlertTitle } from '@shared/ui/alert';
import { Button } from '@shared/ui/button';
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from '@shared/ui/card';
import { Empty, EmptyDescription, EmptyHeader, EmptyTitle } from '@shared/ui/empty';
import { Field, FieldDescription, FieldError, FieldGroup, FieldLabel } from '@shared/ui/field';
import { Input } from '@shared/ui/input';
import { Skeleton } from '@shared/ui/skeleton';
import { StatusChip, type StatusTone } from '@shared/ui/status-chip';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@shared/ui/table';
import { TableHeaderHelp } from '@shared/ui/table-header-help';
import { Textarea } from '@shared/ui/textarea';
import { cancelGapPreview } from '../store/slice';
import { selectGap } from '../store/selectors';
import { loadGapRun, previewGap, submitGap } from '../store/thunks';
import type {
  LinkGapLeg,
  LinkGapLegStatus,
  LinkGapOverlap,
  LinkGapRow,
  LinkGapWireLegStatus,
} from '../types';
import {
  LINK_GAP_MAX_COMPETITORS,
  LINK_GAP_MIN_COMPETITORS,
  linkGapFormSchema,
  splitGapCompetitors,
  type LinkGapFormValues,
} from '../validation';
import { SpendPreviewPanel } from './SpendPreviewPanel';

interface GapWorkspaceProps {
  siteId: string;
  ownDomain: string;
}

function gapValidationMessage(issue: string, t: (key: string) => string): string {
  if (issue === 'ownAmongCompetitors') return t('gap.form.errors.ownAmongCompetitors');
  if (issue === 'atLeastOne') return t('gap.form.errors.atLeastOne');
  if (issue === 'tooMany') return t('gap.form.errors.tooMany');
  return t('gap.form.errors.invalid');
}

export function resolveGapLegStatus(
  status: LinkGapWireLegStatus,
  refunded: boolean,
): LinkGapLegStatus {
  if (status === 'failed') return 'provider_failed_refunded';
  if (status === 'zeroRetained') {
    return refunded ? 'zero_retained_refunded' : 'zero_retained_consumed';
  }
  return status;
}

export function compareGapRows(left: LinkGapRow, right: LinkGapRow): number {
  return (right.rank ?? -1) - (left.rank ?? -1) || left.domain.localeCompare(right.domain);
}

export function orderGapRows(rows: readonly LinkGapRow[]): LinkGapRow[] {
  return [...rows].sort(compareGapRows);
}

export function formatGapFirstSeen(value: string | null | undefined, locale: string): string {
  if (!value) return '—';
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? value
    : new Intl.DateTimeFormat(locale, { dateStyle: 'medium' }).format(date);
}

export function GapWorkspace({ siteId, ownDomain: selectedDomain }: GapWorkspaceProps) {
  const { t, i18n } = useTranslation('backlinks');
  const dispatch = useAppDispatch();
  const location = useLocation();
  const navigate = useNavigate();
  const gap = useAppSelector(selectGap);
  const runId = new URLSearchParams(location.search).get('runId');
  const [ownDomain, setOwnDomain] = useState(selectedDomain);
  const [competitorsText, setCompetitorsText] = useState('');
  const [validationError, setValidationError] = useState('');
  const [confirmedInput, setConfirmedInput] = useState<LinkGapFormValues | null>(null);
  const ownDomainEdited = useRef(false);

  useEffect(() => {
    if (!ownDomainEdited.current) setOwnDomain(selectedDomain);
  }, [selectedDomain]);

  useEffect(() => {
    if (!runId || gap.run?.runId === runId) return;
    const promise = dispatch(loadGapRun({ runId }));
    return () => promise.abort();
  }, [dispatch, gap.run?.runId, runId]);

  const clearStalePreview = () => {
    if (gap.preview) dispatch(cancelGapPreview());
    setConfirmedInput(null);
  };

  const requestPreview = (event: FormEvent) => {
    event.preventDefault();
    const parsed = linkGapFormSchema.safeParse({
      ownDomain,
      competitors: splitGapCompetitors(competitorsText),
    });
    if (!parsed.success) {
      setValidationError(gapValidationMessage(parsed.error.issues[0]!.message, t));
      setConfirmedInput(null);
      return;
    }
    setValidationError('');
    setConfirmedInput(parsed.data);
    void dispatch(previewGap(parsed.data));
  };

  const confirm = async () => {
    if (!confirmedInput) return;
    const action = await dispatch(submitGap({ siteId, ...confirmedInput }));
    if (!submitGap.fulfilled.match(action)) return;
    const params = new URLSearchParams(location.search);
    params.set('runId', action.payload.runId);
    navigate({ pathname: location.pathname, search: params.toString() }, { replace: true });
  };

  if (runId) {
    return <GapRunView runId={runId} siteId={siteId} />;
  }
  if (gap.errorKind === 'disabled') {
    return <GapKillSwitchCard />;
  }

  return (
    <Card data-testid="link-gap-workspace" dir={i18n.dir()}>
      <CardHeader>
        <CardTitle>{t('gap.workspace.title')}</CardTitle>
        <CardDescription>{t('gap.workspace.description')}</CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-5">
        <form className="flex flex-col gap-4" onSubmit={requestPreview}>
          <FieldGroup>
            <Field>
              <FieldLabel htmlFor="gap-own-domain">{t('gap.form.ownDomainLabel')}</FieldLabel>
              <Input
                id="gap-own-domain"
                value={ownDomain}
                onChange={(event) => {
                  ownDomainEdited.current = true;
                  setOwnDomain(event.target.value);
                  clearStalePreview();
                }}
                autoComplete="url"
                data-testid="link-gap-own-domain"
              />
            </Field>
            <Field data-invalid={Boolean(validationError)}>
              <FieldLabel htmlFor="gap-competitors">{t('gap.form.competitorsLabel')}</FieldLabel>
              <Textarea
                id="gap-competitors"
                value={competitorsText}
                onChange={(event) => {
                  setCompetitorsText(event.target.value);
                  clearStalePreview();
                }}
                aria-invalid={Boolean(validationError)}
                aria-describedby="gap-competitors-help"
                rows={4}
                data-testid="link-gap-competitors"
              />
              <FieldDescription id="gap-competitors-help">
                {t('gap.form.competitorsHelp', {
                  min: LINK_GAP_MIN_COMPETITORS,
                  max: LINK_GAP_MAX_COMPETITORS,
                })}
              </FieldDescription>
              <FieldError>{validationError}</FieldError>
            </Field>
          </FieldGroup>

          <SpendPreviewPanel preview={gap.preview} loading={gap.previewLoading} />
          {gap.error ? (
            <Alert variant="destructive" role="alert" data-testid="link-gap-error">
              <AlertTitle>{t('gap.errors.title')}</AlertTitle>
              <AlertDescription>{gap.error}</AlertDescription>
            </Alert>
          ) : null}

          {gap.preview ? (
            <div className="flex flex-wrap gap-2">
              <Button
                type="button"
                onClick={() => void confirm()}
                loading={gap.submitting}
                data-testid="link-gap-confirm"
              >
                {t('gap.preview.confirm', { n: 1 })}
              </Button>
              <Button
                type="button"
                variant="outline"
                onClick={() => {
                  dispatch(cancelGapPreview());
                  setConfirmedInput(null);
                }}
                data-testid="link-gap-cancel"
              >
                {t('gap.preview.cancel')}
              </Button>
            </div>
          ) : (
            <Button
              type="submit"
              variant="outline"
              loading={gap.previewLoading}
              data-testid="link-gap-preview"
            >
              {t('gap.preview.button')}
            </Button>
          )}
        </form>
      </CardContent>
      <CardFooter />
    </Card>
  );
}

export function GapKillSwitchCard() {
  const { t, i18n } = useTranslation('backlinks');
  return (
    <Card data-testid="link-gap-disabled" dir={i18n.dir()}>
      <CardHeader>
        <CardTitle>{t('killswitch.title')}</CardTitle>
        <CardDescription>{t('killswitch.disabled')}</CardDescription>
      </CardHeader>
      <CardContent>
        <StatusChip tone="muted">{t('gap.result.readOnly')}</StatusChip>
      </CardContent>
      <CardFooter />
    </Card>
  );
}

function GapRunView({ runId, siteId }: { runId: string; siteId: string }) {
  const { t, i18n } = useTranslation('backlinks');
  const gap = useAppSelector(selectGap);

  if (gap.runLoading || gap.run?.status === 'queued' || gap.run?.status === 'running') {
    return (
      <Card aria-busy="true" data-testid="link-gap-run-loading" dir={i18n.dir()}>
        <CardHeader>
          <CardTitle>{t('gap.result.title')}</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-2">
          <Skeleton className="h-8 w-full" />
          <Skeleton className="h-8 w-full" />
        </CardContent>
        <CardFooter />
      </Card>
    );
  }
  if (gap.error) {
    return (
      <Alert variant="destructive" role="alert" data-testid="link-gap-run-error" dir={i18n.dir()}>
        <AlertTitle>{t('gap.errors.title')}</AlertTitle>
        <AlertDescription>{gap.error}</AlertDescription>
      </Alert>
    );
  }
  if (!gap.run || gap.run.runId !== runId) {
    return (
      <Card data-testid="link-gap-run-loading" aria-busy="true" dir={i18n.dir()}>
        <CardHeader>
          <CardTitle>{t('gap.result.title')}</CardTitle>
        </CardHeader>
        <CardContent>
          <Skeleton className="h-8 w-full" />
        </CardContent>
        <CardFooter />
      </Card>
    );
  }

  const partial = gap.run.status === 'failed';
  return (
    <div className="flex flex-col gap-4" data-testid="link-gap-results" dir={i18n.dir()}>
      <Card>
        <CardHeader>
          <CardTitle>{t('gap.result.title')}</CardTitle>
          <CardDescription>{gap.run.ownDomain}</CardDescription>
        </CardHeader>
        <CardContent className="flex flex-wrap gap-2">
          <ReportExportControl
            kind="backlinks.gap_run"
            target={{ scope: 'site_resource', siteId, resourceId: runId }}
            selection={{}}
          />
          <StatusChip tone="muted">{t('gap.result.readOnly')}</StatusChip>
          <StatusChip tone={partial ? 'warning' : 'success'}>
            {t(`gap.result.status.${partial ? 'partial' : 'complete'}`)}
          </StatusChip>
        </CardContent>
        <CardFooter />
      </Card>
      {gap.run.legs.map((leg) => (
        <GapCompetitorCard key={leg.competitor} leg={leg} />
      ))}
    </div>
  );
}

const STATUS_TONES: Record<LinkGapLegStatus, StatusTone> = {
  ok: 'success',
  provider_failed_refunded: 'warning',
  zero_retained_consumed: 'muted',
  zero_retained_refunded: 'info',
};

export function GapLegStatusPill({ leg }: { leg: Pick<LinkGapLeg, 'status' | 'refunded'> }) {
  const { t } = useTranslation('backlinks');
  const status = resolveGapLegStatus(leg.status, leg.refunded);
  return (
    <StatusChip tone={STATUS_TONES[status]} data-testid={`gap-leg-status-${status}`}>
      {t(`gap.legStatus.${status}`)}
    </StatusChip>
  );
}

export function GapCompetitorCard({ leg }: { leg: LinkGapLeg }) {
  const { t, i18n } = useTranslation('backlinks');
  const rows = useMemo(() => orderGapRows(leg.result?.rows ?? []), [leg.result?.rows]);
  return (
    <Card data-testid={`gap-competitor-${leg.competitor}`}>
      <CardHeader>
        <CardTitle>{leg.competitor}</CardTitle>
        <CardDescription>{t('gap.result.competitorDescription')}</CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-5">
        <GapLegStatusPill leg={leg} />
        <GapOverlapStats overlap={leg.result?.overlap ?? null} locale={i18n.language} />
        {rows.length === 0 ? (
          <Empty>
            <EmptyHeader>
              <EmptyTitle>{t('gap.table.emptyTitle')}</EmptyTitle>
              <EmptyDescription>{t('gap.table.empty')}</EmptyDescription>
            </EmptyHeader>
          </Empty>
        ) : (
          <Table data-testid="gap-linking-domain-table">
            <caption className="sr-only">{t('gap.result.competitorDescription')}</caption>
            <TableHeader>
              <TableRow>
                <TableHead>{t('gap.table.domain')}</TableHead>
                <TableHead>
                  <TableHeaderHelp
                    label={t('gap.table.rank')}
                    description={t('common:tableHelp.domainRank')}
                  />
                </TableHead>
                <TableHead>{t('gap.table.firstSeen')}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((row) => (
                <TableRow key={row.domain}>
                  <TableCell>
                    {row.url ? (
                      // eslint-disable-next-line react/jsx-no-target-blank -- SAFE_EXTERNAL_REL includes noopener and noreferrer.
                      <a
                        href={safeExternalHref(row.url)}
                        target="_blank"
                        rel={SAFE_EXTERNAL_REL}
                        className="rounded-sm focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50"
                      >
                        {row.domain}
                      </a>
                    ) : (
                      row.domain
                    )}
                  </TableCell>
                  <TableCell>{row.rank ?? '—'}</TableCell>
                  <TableCell>{formatGapFirstSeen(row.firstSeen, i18n.language)}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </CardContent>
      <CardFooter>
        {leg.result ? (
          <span className="text-muted-foreground text-xs">
            {t('intelligence.provenance.providerObservation')}
          </span>
        ) : null}
      </CardFooter>
    </Card>
  );
}

export function GapOverlapStats({
  overlap,
  locale,
}: {
  overlap: LinkGapOverlap | null;
  locale: string;
}) {
  const { t } = useTranslation('backlinks');
  const integer = new Intl.NumberFormat(locale);
  const percentage = new Intl.NumberFormat(locale, {
    minimumFractionDigits: 1,
    maximumFractionDigits: 1,
  });
  return (
    <dl className="grid gap-3 sm:grid-cols-3" data-testid="gap-overlap-stats">
      <div>
        <dt className="text-muted-foreground text-xs">{t('gap.overlap.totalUnique')}</dt>
        <dd className="font-semibold">{overlap ? integer.format(overlap.totalUnique) : '—'}</dd>
      </div>
      <div>
        <dt className="text-muted-foreground text-xs">{t('gap.overlap.exclusiveToCompetitor')}</dt>
        <dd className="font-semibold">
          {overlap ? integer.format(overlap.exclusiveToCompetitor) : '—'}
        </dd>
      </div>
      <div>
        <dt className="text-muted-foreground text-xs">{t('gap.overlap.exclusivePctLabel')}</dt>
        <dd className="font-semibold">
          {overlap
            ? t('gap.overlap.exclusivePct', { pct: percentage.format(overlap.exclusivePct) })
            : '—'}
        </dd>
      </div>
    </dl>
  );
}

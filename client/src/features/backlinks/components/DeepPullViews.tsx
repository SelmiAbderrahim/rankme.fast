import { useEffect, useMemo, useState, type FormEvent } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { ReportExportControl } from '@features/report-export';
import { useAppDispatch, useAppSelector } from '@shared/hooks/redux';
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
import { StatusChip } from '@shared/ui/status-chip';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@shared/ui/table';
import { TableHeaderHelp } from '@shared/ui/table-header-help';
import { Textarea } from '@shared/ui/textarea';
import { cancelDeepPullPreview } from '../store/slice';
import { selectDeepPull } from '../store/selectors';
import { loadLatestDeepPull, previewDeepPull, submitDeepPull } from '../store/thunks';
import type {
  AnchorRow,
  BacklinkDeepRows,
  BacklinkPullType,
  BulkRankRow,
  HistoryPoint,
  ReferringDomainRow,
} from '../types';
import { backlinkDomainSchema, bulkRankDomainsSchema } from '../validation';
import { HistoryChart } from './HistoryChart';
import { SpendPreviewPanel } from './SpendPreviewPanel';

interface DeepViewProps {
  siteId: string;
  domain: string;
  loadStored?: boolean;
}

function useNumberParam(name: string): [string, (value: string) => void] {
  const location = useLocation();
  const navigate = useNavigate();
  const value = new URLSearchParams(location.search).get(name) ?? '';
  const setValue = (next: string) => {
    const params = new URLSearchParams(location.search);
    if (next) params.set(name, next);
    else params.delete(name);
    navigate({ pathname: location.pathname, search: params.toString() }, { replace: true });
  };
  return [value, setValue];
}

function useTextParam(name: string): [string, (value: string) => void] {
  return useNumberParam(name);
}

function DeepState({
  siteId,
  type,
  children,
}: {
  siteId: string;
  type: BacklinkPullType;
  children: (rows: BacklinkDeepRows) => React.ReactNode;
}) {
  const { t, i18n } = useTranslation('backlinks');
  const state = useAppSelector(selectDeepPull(type));
  const rows = state.run?.result?.rows ?? [];
  const isPartial = state.run?.status === 'failed' && rows.length > 0;
  const isProviderFailed = state.run?.status === 'failed' && rows.length === 0;

  if (state.runLoading || state.run?.status === 'queued' || state.run?.status === 'running') {
    return (
      <div className="flex flex-col gap-2" aria-busy="true" data-testid={`${type}-loading`}>
        <Skeleton className="h-8 w-full" />
        <Skeleton className="h-8 w-full" />
      </div>
    );
  }
  if (state.errorKind === 'disabled') {
    return (
      <StateAlert
        testId={`${type}-disabled`}
        title={t('intelligence.states.disabledTitle')}
        body={t('intelligence.states.disabledBody')}
      />
    );
  }
  if (isProviderFailed || state.errorKind === 'providerFailed') {
    return (
      <StateAlert
        testId={`${type}-provider-failed`}
        title={t('intelligence.states.providerTitle')}
        body={t('intelligence.states.providerBody')}
        destructive
      />
    );
  }
  if (state.error) {
    return (
      <StateAlert
        testId={`${type}-error`}
        title={t('intelligence.states.errorTitle')}
        body={state.error}
        destructive
      />
    );
  }
  if (!state.run) {
    return (
      <p className="text-muted-foreground text-sm" data-testid={`${type}-default`}>
        {t('intelligence.states.default')}
      </p>
    );
  }
  if (state.run.status === 'succeeded' && rows.length === 0) {
    return (
      <Empty data-testid={`${type}-empty`}>
        <EmptyHeader>
          <EmptyTitle>{t('intelligence.states.emptyTitle')}</EmptyTitle>
          <EmptyDescription>{t('intelligence.states.emptyBody')}</EmptyDescription>
        </EmptyHeader>
      </Empty>
    );
  }

  return (
    <div className="flex flex-col gap-3">
      {isPartial ? (
        <StateAlert
          testId={`${type}-partial`}
          title={t('intelligence.states.partialTitle')}
          body={t('intelligence.states.partialBody')}
        />
      ) : null}
      <div className="flex flex-wrap items-center gap-2">
        <ReportExportControl
          kind="backlinks.deep_run"
          target={{ scope: 'site_resource', siteId, resourceId: state.run.runId }}
          selection={{ operation: type }}
        />
        <StatusChip tone="info" data-testid={`${type}-provenance`}>
          {t('intelligence.provenance.providerObservation')}
        </StatusChip>
        <span className="text-muted-foreground text-xs">
          {new Intl.DateTimeFormat(i18n.language, { dateStyle: 'medium', timeStyle: 'short' }).format(
            new Date(state.run.result!.observation.capturedAt),
          )}
        </span>
      </div>
      {children(rows)}
    </div>
  );
}

function StateAlert({
  testId,
  title,
  body,
  destructive = false,
}: {
  testId: string;
  title: string;
  body: string;
  destructive?: boolean;
}) {
  return (
    <Alert variant={destructive ? 'destructive' : 'default'} role="status" data-testid={testId}>
      <AlertTitle>{title}</AlertTitle>
      <AlertDescription>{body}</AlertDescription>
    </Alert>
  );
}

function DeepPullForm({
  type,
  siteId,
  domain,
  limit,
  domains,
}: {
  type: BacklinkPullType;
  siteId: string;
  domain: string;
  limit?: number;
  domains?: string[];
}) {
  const { t } = useTranslation('backlinks');
  const dispatch = useAppDispatch();
  const state = useAppSelector(selectDeepPull(type));
  const requestPreview = (event: FormEvent) => {
    event.preventDefault();
    void dispatch(
      previewDeepPull({
        type,
        ...(domains ? { domains } : { domain }),
        ...(limit ? { limit } : {}),
      }),
    );
  };
  const confirm = () => {
    void dispatch(
      submitDeepPull({
        type,
        siteId,
        ...(domains ? { domains } : {}),
        ...(limit ? { limit } : {}),
      }),
    );
  };

  return (
    <form className="flex flex-col gap-4" onSubmit={requestPreview}>
      <SpendPreviewPanel preview={state.preview} loading={state.previewLoading} />
      {state.preview ? (
        <div className="flex flex-wrap gap-2">
          <Button
            type="button"
            onClick={confirm}
            loading={state.submitting}
            data-testid={`link-intel-confirm-${type}`}
          >
            {t('intelligence.preview.confirm', { count: 1 })}
          </Button>
          <Button
            type="button"
            variant="outline"
            onClick={() => dispatch(cancelDeepPullPreview(type))}
            data-testid={`link-intel-cancel-${type}`}
          >
            {t('intelligence.preview.cancel')}
          </Button>
        </div>
      ) : (
        <Button
          type="submit"
          variant="outline"
          loading={state.previewLoading}
          disabled={!domains && !domain}
          data-testid={`link-intel-preview-${type}`}
        >
          {t('intelligence.preview.button')}
        </Button>
      )}
    </form>
  );
}

function useStoredRun(siteId: string, type: BacklinkPullType, enabled: boolean) {
  const dispatch = useAppDispatch();
  useEffect(() => {
    if (!enabled) return;
    const promise = dispatch(loadLatestDeepPull({ siteId, type }));
    return () => promise.abort();
  }, [dispatch, enabled, siteId, type]);
}

export function ReferringDomainsView({ siteId, domain, loadStored = true }: DeepViewProps) {
  const { t } = useTranslation('backlinks');
  const [minRank, setMinRank] = useNumberParam('minRank');
  const [minLinks, setMinLinks] = useNumberParam('minBacklinks');
  useStoredRun(siteId, 'refDomains', loadStored);
  const rank = Number(minRank) || 0;
  const links = Number(minLinks) || 0;

  return (
    <DeepCard
      testId="link-intel-view-domains"
      title={t('intelligence.domains.title')}
      description={t('intelligence.domains.description')}
    >
      <FieldGroup className="grid gap-4 md:grid-cols-2">
        <Field>
          <FieldLabel htmlFor="min-domain-rank">{t('intelligence.filters.minRank')}</FieldLabel>
          <Input
            id="min-domain-rank"
            type="number"
            min="0"
            max="100"
            value={minRank}
            onChange={(event) => setMinRank(event.target.value)}
          />
        </Field>
        <Field>
          <FieldLabel htmlFor="min-backlinks">{t('intelligence.filters.minBacklinks')}</FieldLabel>
          <Input
            id="min-backlinks"
            type="number"
            min="0"
            value={minLinks}
            onChange={(event) => setMinLinks(event.target.value)}
          />
        </Field>
      </FieldGroup>
      <FieldDescription>{t('intelligence.domains.sort')}</FieldDescription>
      <DeepPullForm type="refDomains" siteId={siteId} domain={domain} limit={500} />
      <DeepState siteId={siteId} type="refDomains">
        {(rows) => (
          <ReferringDomainsTable
            rows={(rows as ReferringDomainRow[]).filter(
              (row) => (row.domainRank ?? 0) >= rank && row.backlinks >= links,
            )}
          />
        )}
      </DeepState>
    </DeepCard>
  );
}

function ReferringDomainsTable({ rows }: { rows: ReferringDomainRow[] }) {
  const { t, i18n } = useTranslation('backlinks');
  const ordered = useMemo(
    () =>
      [...rows].sort(
        (a, b) =>
          (b.domainRank ?? -1) - (a.domainRank ?? -1) ||
          b.backlinks - a.backlinks ||
          a.domain.localeCompare(b.domain),
      ),
    [rows],
  );
  return (
    <DataTable
      caption={t('intelligence.domains.title')}
      headers={[
        t('intelligence.columns.domain'),
        t('intelligence.columns.backlinks'),
        {
          label: t('intelligence.columns.domainRank'),
          description: t('common:tableHelp.domainRank'),
        },
        t('intelligence.columns.firstSeen'),
        t('intelligence.columns.lastSeen'),
      ]}
      rows={ordered.map((row) => [
        row.domain,
        row.backlinks,
        row.domainRank ?? '—',
        row.firstSeen
          ? new Intl.DateTimeFormat(i18n.language, { dateStyle: 'medium' }).format(
              new Date(row.firstSeen),
            )
          : '—',
        row.lastSeen
          ? new Intl.DateTimeFormat(i18n.language, { dateStyle: 'medium' }).format(
              new Date(row.lastSeen),
            )
          : '—',
      ])}
      testId="referring-domains-table"
    />
  );
}

export function AnchorsView({ siteId, domain, loadStored = true }: DeepViewProps) {
  const { t } = useTranslation('backlinks');
  const [query, setQuery] = useTextParam('anchor');
  useStoredRun(siteId, 'anchors', loadStored);
  return (
    <DeepCard
      testId="link-intel-view-anchors"
      title={t('intelligence.anchors.title')}
      description={t('intelligence.anchors.description')}
    >
      <Field>
        <FieldLabel htmlFor="anchor-filter">{t('intelligence.filters.anchor')}</FieldLabel>
        <Input
          id="anchor-filter"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
        />
      </Field>
      <DeepPullForm type="anchors" siteId={siteId} domain={domain} limit={500} />
      <DeepState siteId={siteId} type="anchors">
        {(rows) => {
          const filtered = (rows as AnchorRow[]).filter((row) =>
            row.anchor.toLocaleLowerCase().includes(query.toLocaleLowerCase()),
          );
          return (
            <DataTable
              caption={t('intelligence.anchors.title')}
              headers={[
                t('intelligence.columns.anchor'),
                t('intelligence.columns.backlinks'),
                {
                  label: t('intelligence.columns.referringDomains'),
                  description: t('common:tableHelp.referringDomains'),
                },
              ]}
              rows={filtered.map((row) => [row.anchor, row.backlinks, row.referringDomains])}
              testId="anchors-table"
            />
          );
        }}
      </DeepState>
    </DeepCard>
  );
}

export function HistoryView({ siteId, domain, loadStored = true }: DeepViewProps) {
  const { t } = useTranslation('backlinks');
  useStoredRun(siteId, 'history', loadStored);
  return (
    <DeepCard
      testId="link-intel-view-history"
      title={t('intelligence.history.title')}
      description={t('intelligence.history.description')}
    >
      <DeepPullForm type="history" siteId={siteId} domain={domain} limit={24} />
      <DeepState siteId={siteId} type="history">
        {(rows) => <HistoryChart points={rows as HistoryPoint[]} />}
      </DeepState>
    </DeepCard>
  );
}

export function BulkRankView({
  siteId,
  domain: _domain,
  loadStored = true,
}: DeepViewProps) {
  const { t } = useTranslation('backlinks');
  const [raw, setRaw] = useState('');
  const [domains, setDomains] = useState<string[]>([]);
  const [validationError, setValidationError] = useState('');
  useStoredRun(siteId, 'bulkRanks', loadStored);
  const validate = () => {
    const parsed = bulkRankDomainsSchema.safeParse(raw);
    if (!parsed.success) {
      setValidationError(
        parsed.error.issues.some((issue) => issue.message === 'duplicate')
          ? t('intelligence.bulk.duplicate')
          : t('intelligence.bulk.invalid'),
      );
      setDomains([]);
      return;
    }
    setValidationError('');
    setDomains(parsed.data);
  };

  return (
    <DeepCard
      testId="link-intel-view-bulk-ranks"
      title={t('intelligence.bulk.title')}
      description={t('intelligence.bulk.description')}
    >
      <Field data-invalid={Boolean(validationError)}>
        <FieldLabel htmlFor="bulk-rank-domains">{t('intelligence.bulk.label')}</FieldLabel>
        <Textarea
          id="bulk-rank-domains"
          aria-invalid={Boolean(validationError)}
          aria-describedby="bulk-rank-help bulk-rank-error"
          value={raw}
          onChange={(event) => setRaw(event.target.value)}
          onBlur={validate}
          rows={5}
        />
        <FieldDescription id="bulk-rank-help">{t('intelligence.bulk.help')}</FieldDescription>
        <FieldError id="bulk-rank-error">{validationError}</FieldError>
      </Field>
      {domains.length > 0 ? (
        <DeepPullForm type="bulkRanks" siteId={siteId} domain="" domains={domains} />
      ) : null}
      <DeepState siteId={siteId} type="bulkRanks">
        {(rows) => (
          <DataTable
            caption={t('intelligence.bulk.title')}
            headers={[
              t('intelligence.columns.domain'),
              {
                label: t('intelligence.columns.rank'),
                description: t('common:tableHelp.domainRank'),
              },
            ]}
            rows={(rows as BulkRankRow[]).map((row) => [row.domain, row.rank ?? '—'])}
            testId="bulk-rank-table"
          />
        )}
      </DeepState>
    </DeepCard>
  );
}

function DeepCard({
  testId,
  title,
  description,
  children,
}: {
  testId: string;
  title: string;
  description: string;
  children: React.ReactNode;
}) {
  const { i18n } = useTranslation('backlinks');
  return (
    <Card data-testid={testId} dir={i18n.dir()}>
      <CardHeader>
        <CardTitle>{title}</CardTitle>
        <CardDescription>{description}</CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-5">{children}</CardContent>
      <CardFooter />
    </Card>
  );
}

function DataTable({
  caption,
  headers,
  rows,
  testId,
}: {
  caption: string;
  headers: Array<string | { label: string; description: string }>;
  rows: Array<Array<React.ReactNode>>;
  testId: string;
}) {
  return (
    <Table data-testid={testId}>
      <caption className="sr-only">{caption}</caption>
      <TableHeader>
        <TableRow>
          {headers.map((header) => {
            const label = typeof header === 'string' ? header : header.label;
            return (
              <TableHead key={label}>
                {typeof header === 'string' ? (
                  label
                ) : (
                  <TableHeaderHelp label={label} description={header.description} />
                )}
              </TableHead>
            );
          })}
        </TableRow>
      </TableHeader>
      <TableBody>
        {rows.map((row, index) => (
          <TableRow key={index}>
            {row.map((cell, cellIndex) => (
              <TableCell key={cellIndex}>{cell}</TableCell>
            ))}
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}

export function parseWorkspaceDomain(value: string): string {
  return backlinkDomainSchema.safeParse(value).data ?? '';
}

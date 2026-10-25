import { Wrench } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from '@shared/ui/accordion';
import { Card, CardContent } from '@shared/ui/card';
import { Button } from '@shared/ui/button';
import { StatusChip } from '@shared/ui/status-chip';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@shared/ui/table';
import { TableHeaderHelp } from '@shared/ui/table-header-help';
import type { ChatMessagePart } from '../types';
import { Bdi } from '@shared/components/Bdi';
import { formatAbsoluteDate } from '@shared/lib/datetime';
import { PositionDelta, type RankMovementValue } from '@shared/components/PositionDelta';

type ToolCallPart = Extract<ChatMessagePart, { type: 'tool_call' }>;
type ToolResultPart = Extract<ChatMessagePart, { type: 'tool_result' }>;

interface AssistantToolCardProps {
  call: ToolCallPart;
  result?: ToolResultPart;
  /** Re-ask the question that led to a failed step; only offered on the newest reply. */
  onRetry?: () => void;
  retryDisabled?: boolean;
}

type Translate = (key: string, options?: Record<string, unknown>) => string;

const LEGACY_TOOLS = new Set([
  'list_sites',
  'get_latest_audit_report',
  'list_keywords',
  'get_rank_history',
  'list_content_analyses',
  'get_content_analysis',
  'start_audit',
  'get_audit_status',
  'list_actions',
  'set_action_state',
]);

const TOOL_LABEL_KEYS: Record<string, string> = {
  list_sites: 'tool.names.listSites',
  get_latest_audit_report: 'tool.names.latestAudit',
  list_keywords: 'tool.names.listKeywords',
  get_rank_history: 'tool.names.rankHistory',
  list_content_analyses: 'tool.names.listAnalyses',
  get_content_analysis: 'tool.names.contentAnalysis',
  start_audit: 'tool.names.startAudit',
  get_audit_status: 'tool.names.auditStatus',
  list_actions: 'tool.names.listActions',
  set_action_state: 'tool.names.setActionState',
  get_gsc_search_summary: 'tool.names.getGscSearchSummary',
  list_gsc_top_queries: 'tool.names.listGscTopQueries',
  list_gsc_top_pages: 'tool.names.listGscTopPages',
  get_ga4_summary: 'tool.names.getGa4Summary',
  list_pages: 'tool.names.listPages',
  get_page_detail: 'tool.names.getPageDetail',
  get_backlinks_summary: 'tool.names.getBacklinksSummary',
  list_backlinks: 'tool.names.listBacklinks',
  list_competitors: 'tool.names.listCompetitors',
  list_keyword_research_history: 'tool.names.listKeywordResearchHistory',
  get_keyword_research_result: 'tool.names.getKeywordResearchResult',
  get_ai_visibility_summary: 'tool.names.getAiVisibilitySummary',
  get_local_seo_summary: 'tool.names.getLocalSeoSummary',
  get_reviews_summary: 'tool.names.getReviewsSummary',
  list_client_reports: 'tool.names.listClientReports',
};

/** Stored-data read tools: one safe renderer (status, scope, rows as text nodes). */
const STORED_READ_TOOLS = new Set(
  Object.keys(TOOL_LABEL_KEYS).filter((name) => !LEGACY_TOOLS.has(name)),
);

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const finiteNumber = (value: unknown): number | null =>
  typeof value === 'number' && Number.isFinite(value) ? value : null;

function displayValue(value: unknown, t: Translate): string {
  if (value === null || value === undefined) return t('results.notAvailable');
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  try {
    return JSON.stringify(value);
  } catch {
    return t('results.notAvailable');
  }
}

function EmptyToolResult() {
  const { t } = useTranslation('assistant');
  return <p className="text-sm text-muted-foreground">{t('results.empty')}</p>;
}

function FallbackResult({ content }: { content: Record<string, unknown> }) {
  const { t } = useTranslation('assistant');
  const entries = Object.entries(content);
  if (entries.length === 0) return <EmptyToolResult />;
  return (
    <dl className="grid gap-2 text-sm">
      {entries.map(([key, value]) => (
        <div
          key={key}
          className="grid gap-1 rounded-md border bg-background p-3 sm:grid-cols-[10rem_minmax(0,1fr)]"
        >
          <dt className="break-words font-medium text-foreground">{key}</dt>
          <dd className="break-words whitespace-pre-wrap text-muted-foreground">
            {displayValue(value, t)}
          </dd>
        </div>
      ))}
    </dl>
  );
}

interface RankRow {
  key: string;
  phrase: string;
  checkedAt: string | null;
  position: number | null;
  /** Movement against the keyword's previous point. */
  movement: RankMovementValue;
}

/** Same rule as the server's `classifyRankMovement`; lower is better. */
function movementBetween(before: number | null | undefined, after: number | null): RankMovementValue {
  if (before === undefined) return { kind: 'new', amount: null };
  if (before === null && after === null) return { kind: 'unranked', amount: null };
  if (before === null) return { kind: 'entered', amount: null };
  if (after === null) return { kind: 'dropped', amount: null };
  if (before === after) return { kind: 'unchanged', amount: 0 };
  return before > after
    ? { kind: 'improved', amount: before - after }
    : { kind: 'declined', amount: after - before };
}

function rankRows(content: Record<string, unknown>): RankRow[] | null {
  if (!Array.isArray(content.keywords)) return null;
  const rows: RankRow[] = [];
  content.keywords.forEach((value, keywordIndex) => {
    if (!isRecord(value) || typeof value.phrase !== 'string') return;
    const phrase = value.phrase;
    if (!Array.isArray(value.series) || value.series.length === 0) {
      rows.push({
        key: `${keywordIndex}-empty`,
        phrase,
        checkedAt: null,
        position: null,
        movement: { kind: 'new', amount: null },
      });
      return;
    }
    let previous: number | null | undefined;
    value.series.forEach((point, pointIndex) => {
      if (!isRecord(point)) return;
      const position = finiteNumber(point.position);
      rows.push({
        key: `${keywordIndex}-${pointIndex}`,
        phrase,
        checkedAt: typeof point.checkedAt === 'string' ? point.checkedAt : null,
        position,
        movement: movementBetween(previous, position),
      });
      previous = position;
    });
  });
  return rows;
}

/** A date-only day (`2026-09-30`) stays on that day in every time zone. */
function formatDate(value: string | null, locale: string, fallback: string): string {
  if (!value) return fallback;
  if (Number.isNaN(Date.parse(value))) return value;
  return formatAbsoluteDate(value, locale);
}

function RankHistoryResult({ content }: { content: Record<string, unknown> }) {
  const { t, i18n } = useTranslation('assistant');
  const rows = rankRows(content);
  if (rows === null) return <FallbackResult content={content} />;
  if (rows.length === 0) return <EmptyToolResult />;
  return (
    <Table>
      <TableHeader className="bg-muted/50">
        <TableRow>
          <TableHead>{t('results.keyword')}</TableHead>
          <TableHead>{t('results.date')}</TableHead>
          <TableHead className="text-end">
            <TableHeaderHelp
              label={t('results.position')}
              description={t('common:tableHelp.position')}
            />
          </TableHead>
          <TableHead className="text-end">
            <TableHeaderHelp
              label={t('results.change')}
              description={t('common:tableHelp.positionDelta')}
            />
          </TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {rows.map((row) => (
          <TableRow key={row.key}>
            <TableCell className="whitespace-normal"><Bdi>{row.phrase}</Bdi></TableCell>
            <TableCell>
              {formatDate(row.checkedAt, i18n.language, t('results.notAvailable'))}
            </TableCell>
            <TableCell className="text-end">{row.position ?? t('results.notRanked')}</TableCell>
            <TableCell className="text-end">
              <PositionDelta movement={row.movement} />
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}

function AuditSummaryResult({ content }: { content: Record<string, unknown> }) {
  const { t } = useTranslation('assistant');
  const report = isRecord(content.report) ? content.report : null;
  const counts = report && isRecord(report.counts) ? report.counts : null;
  if (!report || !counts) return <FallbackResult content={content} />;

  const fixNow = finiteNumber(counts.fixNow) ?? 0;
  const watch = finiteNumber(counts.watch) ?? 0;
  const passed = finiteNumber(counts.passed) ?? 0;
  const total = fixNow + watch + passed;
  const score = total === 0 ? 0 : Math.round((passed / total) * 100);
  const findings = Array.isArray(report.findings)
    ? report.findings
        .filter(isRecord)
        .map((finding) => {
          const copy = isRecord(finding.copy) ? finding.copy : null;
          return copy && typeof copy.title === 'string' ? copy.title : null;
        })
        .filter((title): title is string => title !== null)
        .slice(0, 3)
    : [];

  return (
    <Card className="gap-4 py-4 shadow-none">
      <CardContent className="grid gap-4">
        <dl className="grid grid-cols-2 gap-3">
          <div className="rounded-lg bg-muted p-3">
            <dt className="text-xs text-muted-foreground">{t('results.score')}</dt>
            <dd className="mt-1 text-2xl font-semibold">{score}/100</dd>
          </div>
          <div className="rounded-lg bg-destructive/10 p-3 text-destructive">
            <dt className="text-xs">{t('results.fixNow')}</dt>
            <dd className="mt-1 text-2xl font-semibold">{fixNow}</dd>
          </div>
        </dl>
        <div>
          <h4 className="text-sm font-semibold text-foreground">{t('results.topFindings')}</h4>
          {findings.length > 0 ? (
            <ul className="mt-2 list-disc space-y-1 ps-5 text-sm text-muted-foreground">
              {findings.map((finding, index) => (
                <li key={`${finding}-${index}`}>{finding}</li>
              ))}
            </ul>
          ) : (
            <p className="mt-2 text-sm text-muted-foreground">{t('results.noFindings')}</p>
          )}
        </div>
      </CardContent>
    </Card>
  );
}

function KeywordsResult({ content }: { content: Record<string, unknown> }) {
  const { t } = useTranslation('assistant');
  if (!Array.isArray(content.keywords)) return <FallbackResult content={content} />;
  const rows = content.keywords.filter(
    (value): value is Record<string, unknown> =>
      isRecord(value) && typeof value.phrase === 'string',
  );
  if (rows.length === 0) return <EmptyToolResult />;
  return (
    <Table>
      <TableHeader className="bg-muted/50">
        <TableRow>
          <TableHead>{t('results.keyword')}</TableHead>
          <TableHead>{t('results.id')}</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {rows.map((row, index) => (
          <TableRow key={typeof row.id === 'string' ? row.id : index}>
            <TableCell className="whitespace-normal">{String(row.phrase)}</TableCell>
            <TableCell>{displayValue(row.id, t)}</TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}

function SitesResult({ content }: { content: Record<string, unknown> }) {
  const { t } = useTranslation('assistant');
  if (!Array.isArray(content.sites)) return <FallbackResult content={content} />;
  const rows = content.sites.filter(
    (value): value is Record<string, unknown> =>
      isRecord(value) && typeof value.domain === 'string',
  );
  if (rows.length === 0) return <EmptyToolResult />;
  return (
    <Table>
      <TableHeader className="bg-muted/50">
        <TableRow>
          <TableHead>{t('results.domain')}</TableHead>
          <TableHead>{t('results.url')}</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {rows.map((row, index) => (
          <TableRow key={typeof row.id === 'string' ? row.id : index}>
            <TableCell>{String(row.domain)}</TableCell>
            <TableCell className="max-w-72 truncate">{displayValue(row.url, t)}</TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}

const STORED_STATUS_TONES = {
  ok: 'success',
  empty: 'muted',
  unavailable: 'warning',
} as const;
type StoredStatus = keyof typeof STORED_STATUS_TONES;

const isStoredStatus = (value: unknown): value is StoredStatus =>
  typeof value === 'string' && value in STORED_STATUS_TONES;

/** Envelope fields rendered by the header, never again in the key/value list. */
const STORED_ENVELOPE_KEYS = new Set([
  'status',
  'reason',
  'message',
  'locale',
  'truncated',
  'source',
  'range',
  'startDate',
  'endDate',
  'asOf',
  'timezone',
]);
const MAX_TABLE_COLUMNS = 6;

function StoredRowsTable({ name, rows }: { name: string; rows: Record<string, unknown>[] }) {
  const { t } = useTranslation('assistant');
  // Union of keys across rows, so a column present only on later rows still shows.
  const columns = Object.keys(Object.assign({}, ...rows)).slice(0, MAX_TABLE_COLUMNS);
  return (
    <Table>
      <caption className="sr-only">{name}</caption>
      <TableHeader className="bg-muted/50">
        <TableRow>
          {columns.map((column) => (
            <TableHead key={column}>{column}</TableHead>
          ))}
        </TableRow>
      </TableHeader>
      <TableBody>
        {rows.map((row, index) => (
          <TableRow key={index}>
            {columns.map((column) => (
              <TableCell key={column} className="max-w-72 whitespace-normal break-words">
                {displayValue(row[column], t)}
              </TableCell>
            ))}
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}

function StoredReadResult({ content }: { content: Record<string, unknown> }) {
  const { t, i18n } = useTranslation('assistant');
  if (!isStoredStatus(content.status)) return <FallbackResult content={content} />;
  const message = typeof content.message === 'string' ? content.message : null;
  const day = (value: string) => formatDate(value, i18n.language, value);
  const period =
    typeof content.startDate === 'string' && typeof content.endDate === 'string'
      ? `${day(content.startDate)} \u2013 ${day(content.endDate)}`
      : null;
  const scopeCandidates: Array<[string, unknown]> = [
    ['results.scopeSource', content.source],
    ['results.scopeRange', content.range],
    ['results.scopePeriod', period],
    ['results.scopeAsOf', typeof content.asOf === 'string' ? day(content.asOf) : content.asOf],
    ['results.scopeTimezone', content.timezone],
  ];
  const scope = scopeCandidates.filter(
    (entry): entry is [string, string] => typeof entry[1] === 'string' && entry[1].length > 0,
  );
  const tables = Object.entries(content).filter(
    (entry): entry is [string, Record<string, unknown>[]] =>
      Array.isArray(entry[1]) && entry[1].length > 0 && entry[1].every(isRecord),
  );
  const tableKeys = new Set(tables.map(([key]) => key));
  const rest = Object.fromEntries(
    Object.entries(content).filter(
      ([key, value]) =>
        !STORED_ENVELOPE_KEYS.has(key) &&
        !tableKeys.has(key) &&
        !(Array.isArray(value) && value.length === 0),
    ),
  );
  return (
    <div className="grid gap-3">
      <div className="flex flex-wrap items-center gap-2">
        <StatusChip tone={STORED_STATUS_TONES[content.status]}>
          {t(`tool.storedStatus.${content.status}`)}
        </StatusChip>
        {message ? <p className="text-sm text-muted-foreground">{message}</p> : null}
      </div>
      {scope.length > 0 ? (
        <dl className="grid gap-1 text-sm sm:grid-cols-[auto_minmax(0,1fr)] sm:gap-x-3">
          {scope.map(([label, value]) => (
            <div key={label} className="contents">
              <dt className="font-medium text-foreground">{t(label)}</dt>
              <dd className="break-words text-muted-foreground">{value}</dd>
            </div>
          ))}
        </dl>
      ) : null}
      {Object.keys(rest).length > 0 ? <FallbackResult content={rest} /> : null}
      {tables.map(([key, rows]) => (
        <StoredRowsTable key={key} name={key} rows={rows} />
      ))}
      {content.truncated === true ? (
        <p className="text-xs text-muted-foreground">{t('results.truncated')}</p>
      ) : null}
    </div>
  );
}

function TypedToolResult({ result }: { result: ToolResultPart }) {
  if (STORED_READ_TOOLS.has(result.toolName)) {
    return <StoredReadResult content={result.structuredContent} />;
  }
  switch (result.toolName) {
    case 'get_rank_history':
      return <RankHistoryResult content={result.structuredContent} />;
    case 'get_latest_audit_report':
      return <AuditSummaryResult content={result.structuredContent} />;
    case 'list_keywords':
      return <KeywordsResult content={result.structuredContent} />;
    case 'list_sites':
      return <SitesResult content={result.structuredContent} />;
    default:
      return <FallbackResult content={result.structuredContent} />;
  }
}

/** The error codes the server reports, mapped to a plain-language explanation. */
const TOOL_ERROR_KEYS: Readonly<Record<string, string>> = {
  'mcp.errors.forbiddenOutput': 'forbiddenOutput',
  'mcp.errors.invalidInput': 'invalidInput',
  'sites.errors.notFound': 'notFound',
  'common.internalError': 'internal',
};

/** A failed step in words — never the raw code or the structured error object. */
function ToolFailure({
  code,
  onRetry,
  retryDisabled,
}: {
  code: string | undefined;
  onRetry?: () => void;
  retryDisabled: boolean;
}) {
  const { t } = useTranslation('assistant');
  const key = code && Object.hasOwn(TOOL_ERROR_KEYS, code) ? TOOL_ERROR_KEYS[code] : 'generic';
  return (
    <div className="space-y-2" data-testid="assistant-tool-failure" data-error-code={code ?? 'unknown'}>
      <p className="text-sm text-destructive" role="alert">
        {t(`tool.errors.${key}`)}
      </p>
      {onRetry ? (
        <Button type="button" variant="outline" size="sm" disabled={retryDisabled} onClick={onRetry}>
          {t('tool.retry')}
        </Button>
      ) : null}
    </div>
  );
}

/** Collapsible execution card with runtime-checked structured renderers. */
export function AssistantToolCard({ call, result, onRetry, retryDisabled = false }: AssistantToolCardProps) {
  const { t } = useTranslation('assistant');
  const labelKey = TOOL_LABEL_KEYS[call.toolName];
  const label = labelKey ? t(labelKey) : call.toolName;
  const status = result ? (result.ok ? 'success' : 'failed') : 'running';
  const tone = status === 'success' ? 'success' : status === 'failed' ? 'destructive' : 'info';

  return (
    <Accordion type="single" collapsible className="rounded-lg border bg-muted/40 text-card-foreground">
      <AccordionItem value={call.toolCallId} className="border-0 px-3">
        <AccordionTrigger className="py-2 text-sm">
          <span className="flex min-w-0 items-center gap-2">
            <Wrench aria-hidden="true" className="size-4 shrink-0" />
            <span className="truncate">{label}</span>
            <StatusChip tone={tone}>{t(`tool.status.${status}`)}</StatusChip>
          </span>
        </AccordionTrigger>
        <AccordionContent className="max-w-none space-y-3">
          <div>
            <h4 className="text-xs font-semibold uppercase tracking-wide text-foreground">
              {t('tool.arguments')}
            </h4>
            <pre className="mt-2 max-h-64 overflow-auto whitespace-pre-wrap break-words rounded-md border bg-background p-3 text-xs text-foreground">
              {displayValue(call.args, t)}
            </pre>
          </div>
          {result ? (
            <div>
              <div className="flex flex-wrap items-center gap-2">
                <h4 className="text-xs font-semibold uppercase tracking-wide text-foreground">
                  {t('tool.result')}
                </h4>
              </div>
              <div className="mt-2">
                {result.ok ? (
                  <TypedToolResult result={result} />
                ) : (
                  <ToolFailure code={result.errorCode} onRetry={onRetry} retryDisabled={retryDisabled} />
                )}
              </div>
            </div>
          ) : (
            <p className="text-sm text-muted-foreground">{t('tool.waiting')}</p>
          )}
        </AccordionContent>
      </AccordionItem>
    </Accordion>
  );
}

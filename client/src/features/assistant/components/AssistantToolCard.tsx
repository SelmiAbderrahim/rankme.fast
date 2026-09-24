import { Wrench } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from '@shared/ui/accordion';
import { Card, CardContent } from '@shared/ui/card';
import { StatusChip } from '@shared/ui/status-chip';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@shared/ui/table';
import { TableHeaderHelp } from '@shared/ui/table-header-help';
import type { ChatMessagePart } from '../types';

type ToolCallPart = Extract<ChatMessagePart, { type: 'tool_call' }>;
type ToolResultPart = Extract<ChatMessagePart, { type: 'tool_result' }>;

interface AssistantToolCardProps {
  call: ToolCallPart;
  result?: ToolResultPart;
}

type Translate = (key: string, options?: Record<string, unknown>) => string;

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
};

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
      });
      return;
    }
    value.series.forEach((point, pointIndex) => {
      if (!isRecord(point)) return;
      rows.push({
        key: `${keywordIndex}-${pointIndex}`,
        phrase,
        checkedAt: typeof point.checkedAt === 'string' ? point.checkedAt : null,
        position: finiteNumber(point.position),
      });
    });
  });
  return rows;
}

function formatDate(value: string | null, locale: string, fallback: string): string {
  if (!value) return fallback;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat(locale, { dateStyle: 'medium' }).format(date);
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
        </TableRow>
      </TableHeader>
      <TableBody>
        {rows.map((row) => (
          <TableRow key={row.key}>
            <TableCell className="whitespace-normal">{row.phrase}</TableCell>
            <TableCell>
              {formatDate(row.checkedAt, i18n.language, t('results.notAvailable'))}
            </TableCell>
            <TableCell className="text-end">{row.position ?? t('results.notRanked')}</TableCell>
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

function TypedToolResult({ result }: { result: ToolResultPart }) {
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

/** Collapsible execution card with runtime-checked structured renderers. */
export function AssistantToolCard({ call, result }: AssistantToolCardProps) {
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
                {result.errorCode ? (
                  <span className="text-xs text-destructive">{result.errorCode}</span>
                ) : null}
              </div>
              <div className="mt-2">
                <TypedToolResult result={result} />
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

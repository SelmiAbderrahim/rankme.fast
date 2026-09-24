import { useEffect, type ReactNode } from 'react';
import { Download } from 'lucide-react';
import { Helmet } from 'react-helmet-async';
import { useLoaderData, useParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { ThemeToggle } from '@shared/components/ThemeToggle';
import { isRtl } from '@shared/i18n';
import { SAFE_EXTERNAL_REL, safeExternalHref } from '@shared/security';
import { Badge } from '@shared/ui/badge';
import { Button } from '@shared/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@shared/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@shared/ui/table';
import type { PublicReport, PublicReportBlock, ReportScalar, ReportTableData } from '../types';

function formatDate(value: string, locale: string): string {
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? value
    : new Intl.DateTimeFormat(locale, {
        dateStyle: 'medium',
        timeZone: 'UTC',
      }).format(date);
}

function scalar(value: ReportScalar, unavailable: string, locale: string): ReactNode {
  if (value.type === 'unavailable') return value.reason ?? unavailable;
  if (value.type === 'null') return '—';
  if (value.type === 'boolean') return value.value ? '✓' : '—';
  if (value.type === 'number' && typeof value.value === 'number') {
    return new Intl.NumberFormat(locale).format(value.value);
  }
  if (value.type === 'date' && typeof value.value === 'string') {
    return formatDate(value.value, locale);
  }
  if (value.type === 'url' && typeof value.value === 'string') {
    return (
      <a
        className="break-all text-primary underline underline-offset-4"
        href={safeExternalHref(value.value)}
        rel={SAFE_EXTERNAL_REL}
      >
        {value.value}
      </a>
    );
  }
  return String(value.value ?? '—');
}

function ReportTable({ data }: { data: ReportTableData }) {
  const { t, i18n } = useTranslation('report');
  if (data.rows.length === 0) {
    return <p className="text-sm text-muted-foreground">{t('publicShare.empty')}</p>;
  }
  return (
    <div className="overflow-x-auto rounded-lg border border-border">
      <Table>
        <TableHeader>
          <TableRow>
            {data.columns.map((column) => (
              <TableHead key={column.key}>{column.label}</TableHead>
            ))}
          </TableRow>
        </TableHeader>
        <TableBody>
          {data.rows.map((row, rowIndex) => (
            <TableRow key={row.id ?? `row-${rowIndex + 1}`}>
              {row.cells.map((cell) => (
                <TableCell key={cell.columnKey} className="max-w-xl whitespace-normal align-top">
                  {scalar(cell.value, t('publicShare.unavailable'), i18n.language)}
                </TableCell>
              ))}
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}

function ReportBlock({ block }: { block: PublicReportBlock }) {
  const { t, i18n } = useTranslation('report');
  if (block.type === 'heading') {
    return block.level <= 2 ? (
      <h2 className="text-2xl font-semibold tracking-tight">{block.text}</h2>
    ) : (
      <h3 className="text-lg font-semibold">{block.text}</h3>
    );
  }
  if (block.type === 'prose') {
    return <p className="whitespace-pre-wrap leading-7 text-muted-foreground">{block.text}</p>;
  }
  if (block.type === 'kpi_group' || block.type === 'key_value') {
    return (
      <dl className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {block.items.map((item) => (
          <Card key={item.id ?? item.label} className="gap-0 px-6">
            <dt className="text-sm text-muted-foreground">{item.label}</dt>
            <dd className="mt-1 text-xl font-semibold">
              {scalar(item.value, t('publicShare.unavailable'), i18n.language)}
              {item.unit ? ` ${item.unit}` : ''}
            </dd>
          </Card>
        ))}
      </dl>
    );
  }
  if (block.type === 'findings') {
    return (
      <div className="flex flex-col gap-3">
        {block.items.map((item) => (
          <Card key={item.id ?? item.ruleKey}>
            <CardHeader className="flex flex-col gap-2">
              <div className="flex flex-wrap gap-2">
                <Badge variant="outline">{item.severity}</Badge>
                <Badge variant="secondary">{item.bucket}</Badge>
              </div>
              <CardTitle className="text-base">{item.title}</CardTitle>
            </CardHeader>
            <CardContent className="flex flex-col gap-3 text-sm">
              <p>{item.why}</p>
              {item.fix ? <p className="text-muted-foreground">{item.fix}</p> : null}
              {item.pass ? <p className="text-muted-foreground">{item.pass}</p> : null}
              {item.affectedUrls.map((url) => (
                <a
                  key={url}
                  className="block break-all text-primary underline underline-offset-4"
                  href={safeExternalHref(url)}
                  rel={SAFE_EXTERNAL_REL}
                >
                  {url}
                </a>
              ))}
              {item.evidence.map((entry, index) => (
                <p key={`${item.ruleKey}-evidence-${index + 1}`}>{entry}</p>
              ))}
            </CardContent>
          </Card>
        ))}
      </div>
    );
  }
  if (block.type === 'table') return <ReportTable data={block} />;
  if (block.type === 'time_series') return <ReportTable data={block.tableFallback} />;
  if (block.type === 'source_note') {
    return (
      <aside className="border-s-4 border-input ps-4 text-sm text-muted-foreground">
        <p>{block.methodology}</p>
        {block.coverageWarning ? <p className="mt-2">{block.coverageWarning}</p> : null}
      </aside>
    );
  }
  if (block.type === 'state') return <p className="text-muted-foreground">{block.reason}</p>;
  return null;
}

export function PublicReportPage() {
  const report = useLoaderData() as PublicReport;
  const { token = '' } = useParams<{ token: string }>();
  const { t, i18n } = useTranslation('report');
  const rtl = isRtl(report.locale);
  const safeAccent = /^#[0-9a-f]{6}$/u.test(report.branding.accentColor)
    ? report.branding.accentColor
    : undefined;

  useEffect(() => {
    void i18n.changeLanguage(report.locale);
  }, [i18n, report.locale]);

  return (
    <div className="min-h-screen bg-background text-foreground" dir={rtl ? 'rtl' : 'ltr'}>
      <Helmet htmlAttributes={{ lang: report.locale, dir: rtl ? 'rtl' : 'ltr' }}>
        <title>{`${report.title} — ${t('publicShare.report')}`}</title>
        <meta name="robots" content="noindex, nofollow, noarchive" />
        <meta name="referrer" content="no-referrer" />
      </Helmet>
      <header
        className="border-b border-t-4 bg-card"
        style={safeAccent ? { borderTopColor: safeAccent } : undefined}
      >
        <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-4 px-4 py-5 sm:px-6">
          <div className="flex min-w-0 items-center gap-4">
            {report.branding.logo ? (
              <img
                src={`data:image/png;base64,${report.branding.logo.bytesBase64}`}
                alt=""
                width={report.branding.logo.width}
                height={report.branding.logo.height}
                className="max-h-12 max-w-40 object-contain"
              />
            ) : null}
            <div className="min-w-0">
              <p className="text-sm text-muted-foreground">{report.branding.companyName}</p>
              <h1 className="break-words text-2xl font-semibold tracking-tight">{report.title}</h1>
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {report.formats.includes('pdf') ? (
              <Button asChild variant="outline">
                <a href={`/api/report-shares/${encodeURIComponent(token)}/files/pdf`}>
                  <Download data-icon="inline-start" aria-hidden="true" />
                  {t('publicShare.downloadPdf')}
                </a>
              </Button>
            ) : null}
            {report.formats.includes('csv') ? (
              <Button asChild variant="outline">
                <a href={`/api/report-shares/${encodeURIComponent(token)}/files/csv`}>
                  <Download data-icon="inline-start" aria-hidden="true" />
                  {t('publicShare.downloadCsv')}
                </a>
              </Button>
            ) : null}
            <ThemeToggle />
          </div>
        </div>
      </header>
      <main className="mx-auto flex max-w-6xl flex-col gap-8 px-4 py-8 sm:px-6">
        <section className="grid gap-4 md:grid-cols-2" aria-label={t('publicShare.selection')}>
          {[...report.subject, ...report.selection].map((item, index) => (
            <div key={`${item.label}-${index + 1}`} className="border-b border-border pb-3">
              <p className="text-sm text-muted-foreground">{item.label}</p>
              <p className="font-medium break-words">{item.value}</p>
            </div>
          ))}
        </section>
        <section className="flex flex-col gap-3" aria-labelledby="public-report-sources">
          <h2 id="public-report-sources" className="text-xl font-semibold">
            {t('publicShare.sourceDates')}
          </h2>
          <ul className="flex flex-col gap-2">
            {report.sourceDates.map((source, index) => (
              <li key={`${source.label}-${index + 1}`} className="text-sm text-muted-foreground">
                <span className="font-medium text-foreground">{source.label}</span>
                {' — '}
                {t('publicShare.provenance', { kind: source.kind })}
                {' · '}
                {source.observedAt
                  ? t('publicShare.observed', {
                      date: formatDate(source.observedAt, report.locale),
                    })
                  : `${formatDate(source.from ?? '', report.locale)} – ${formatDate(source.to ?? '', report.locale)}`}
              </li>
            ))}
          </ul>
        </section>
        <section className="flex flex-col gap-6">
          {report.blocks.map((block, index) => (
            <ReportBlock key={block.id ?? `${block.type}-${index + 1}`} block={block} />
          ))}
        </section>
        <p className="border-t border-border pt-5 text-sm text-muted-foreground">
          {t('publicShare.expires', { date: formatDate(report.expiresAt, report.locale) })}
        </p>
      </main>
    </div>
  );
}

export function PublicReportNotFound() {
  const { t } = useTranslation('report');
  return (
    <main className="mx-auto flex min-h-screen max-w-xl items-center px-6" role="alert">
      <Card className="w-full">
        <CardHeader>
          <CardTitle>
            <h1>{t('publicShare.notFoundTitle')}</h1>
          </CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-muted-foreground">{t('publicShare.notFoundBody')}</p>
        </CardContent>
      </Card>
    </main>
  );
}

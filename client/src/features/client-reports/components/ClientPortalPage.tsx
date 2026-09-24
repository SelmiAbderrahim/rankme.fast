import { useEffect } from 'react';
import { Helmet } from 'react-helmet-async';
import {
  useLoaderData,
  useLocation,
  useNavigate,
  useParams,
} from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { AlertTriangle, CheckCircle2, Eye, Search } from 'lucide-react';
import { ThemeToggle } from '@shared/components/ThemeToggle';
import {
  DEFAULT_LOCALE,
  SUPPORTED_LOCALES,
  isRtl,
  isSupportedLocale,
  type SupportedLocale,
} from '@shared/i18n';
import { Card, CardContent, CardHeader, CardTitle } from '@shared/ui/card';
import { Label } from '@shared/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@shared/ui/select';
import { StatusChip } from '@shared/ui/status-chip';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@shared/ui/table';
import type { ClientPortalReport } from '../types';

function portalLocale(pathname: string): SupportedLocale {
  const first = pathname.split('/').filter(Boolean)[0];
  return first && first !== DEFAULT_LOCALE && isSupportedLocale(first)
    ? first
    : DEFAULT_LOCALE;
}

function formatSnapshot(value: string, locale: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat(locale, {
    dateStyle: 'medium',
    timeZone: 'UTC',
  }).format(date);
}

function safeAccent(value: string): string | undefined {
  return /^#[0-9a-f]{6}$/i.test(value) ? value : undefined;
}

function SnapshotLabel({ value }: { value: string }) {
  const { t, i18n } = useTranslation('clientReports');
  return (
    <p className="text-muted-foreground text-sm" data-snapshot-date={value}>
      {t('portal.snapshot', { date: formatSnapshot(value, i18n.language) })}
    </p>
  );
}

function LocaleControl({ locale, token }: { locale: SupportedLocale; token: string }) {
  const { t } = useTranslation(['clientReports', 'language']);
  const navigate = useNavigate();
  return (
    <div className="flex items-center gap-2">
      <Label htmlFor="portal-language" className="sr-only">
        {t('clientReports:portal.language')}
      </Label>
      <Select
        value={locale}
        onValueChange={(next: SupportedLocale) => {
          const prefix = next === DEFAULT_LOCALE ? '' : `/${next}`;
          navigate(`${prefix}/portal/${encodeURIComponent(token)}`);
        }}
      >
        <SelectTrigger id="portal-language" className="min-h-11 min-w-36">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {SUPPORTED_LOCALES.map((item) => (
            <SelectItem key={item} value={item}>
              {t(`language:names.${item}`)}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      <ThemeToggle />
    </div>
  );
}

export function ClientPortalPage() {
  const report = useLoaderData() as ClientPortalReport;
  const { pathname } = useLocation();
  const { token = '' } = useParams<{ token: string }>();
  const requestLocale = portalLocale(pathname);
  const locale = report.locale;
  const { t, i18n } = useTranslation('clientReports');
  const accent = safeAccent(report.branding.accentColor);
  const gsc = report.sections.gsc;

  useEffect(() => {
    void i18n.changeLanguage(locale);
  }, [i18n, locale]);

  return (
    <div className="min-h-screen bg-background text-foreground" dir={isRtl(locale) ? 'rtl' : 'ltr'}>
      <Helmet htmlAttributes={{ lang: locale, dir: isRtl(locale) ? 'rtl' : 'ltr' }}>
        <title>{`${report.site.label} — ${t('portal.title')}`}</title>
        <meta name="robots" content="noindex, nofollow" />
      </Helmet>
      <header
        className="border-b border-t-4 bg-card"
        style={accent ? { borderTopColor: accent } : undefined}
      >
        <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-4 px-4 py-5 sm:px-6">
          <div className="flex min-w-0 items-center gap-4">
            {report.branding.logoDataUrl ? (
              <img
                src={report.branding.logoDataUrl}
                alt=""
                className="max-h-12 max-w-40 object-contain"
                width={160}
                height={48}
              />
            ) : null}
            <div className="min-w-0">
              {report.branding.companyName ? (
                <p className="text-muted-foreground truncate text-sm">
                  {report.branding.companyName}
                </p>
              ) : null}
              <h1 className="truncate text-2xl font-semibold">{report.site.label}</h1>
            </div>
          </div>
          <LocaleControl locale={requestLocale} token={token} />
        </div>
      </header>

      <main className="mx-auto max-w-6xl space-y-6 px-4 py-8 sm:px-6">
        {report.sections.audit ? (
          <section aria-labelledby="portal-audit-title" className="space-y-4">
            <div>
              <h2 id="portal-audit-title" className="text-xl font-semibold">{t('portal.audit')}</h2>
              <SnapshotLabel value={report.sections.audit.snapshotDate} />
            </div>
            <div className="grid gap-4 sm:grid-cols-3">
              <Card data-snapshot-date={report.sections.audit.snapshotDate}>
                <CardHeader className="pb-2"><CardTitle className="text-sm">{t('portal.fixNow')}</CardTitle></CardHeader>
                <CardContent className="flex items-center gap-3">
                  <AlertTriangle className="text-destructive" aria-hidden="true" />
                  <span className="text-3xl font-semibold">{report.sections.audit.counts.fixNow}</span>
                </CardContent>
              </Card>
              <Card data-snapshot-date={report.sections.audit.snapshotDate}>
                <CardHeader className="pb-2"><CardTitle className="text-sm">{t('portal.watch')}</CardTitle></CardHeader>
                <CardContent className="flex items-center gap-3">
                  <Eye className="text-warning" aria-hidden="true" />
                  <span className="text-3xl font-semibold">{report.sections.audit.counts.watch}</span>
                </CardContent>
              </Card>
              <Card data-snapshot-date={report.sections.audit.snapshotDate}>
                <CardHeader className="pb-2"><CardTitle className="text-sm">{t('portal.passed')}</CardTitle></CardHeader>
                <CardContent className="flex items-center gap-3">
                  <CheckCircle2 className="text-success" aria-hidden="true" />
                  <span className="text-3xl font-semibold">{report.sections.audit.counts.passed}</span>
                </CardContent>
              </Card>
            </div>
            {report.sections.audit.findings.length > 0 ? (
              <div className="grid gap-4 md:grid-cols-2">
                {report.sections.audit.findings.map((finding) => (
                  <Card key={finding.ruleId}>
                    <CardHeader>
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <CardTitle className="text-base">{finding.title}</CardTitle>
                        <StatusChip tone={finding.bucket === 'fix-now' ? 'destructive' : finding.bucket === 'watch' ? 'warning' : 'success'}>
                          {t(`portal.${finding.bucket === 'fix-now' ? 'fixNow' : finding.bucket}`)}
                        </StatusChip>
                      </div>
                    </CardHeader>
                    <CardContent className="space-y-3 text-sm">
                      <p>{finding.why}</p>
                      <p className="text-muted-foreground">{finding.fix}</p>
                      {finding.affectedUrls.length > 0 ? (
                        <ul className="space-y-1 text-xs" dir="ltr">
                          {finding.affectedUrls.map((url) => <li key={url} className="break-all">{url}</li>)}
                        </ul>
                      ) : null}
                    </CardContent>
                  </Card>
                ))}
              </div>
            ) : null}
          </section>
        ) : null}

        {report.sections.ranks ? (
          <section aria-labelledby="portal-ranks-title" className="space-y-4">
            <div>
              <h2 id="portal-ranks-title" className="text-xl font-semibold">{t('portal.ranks')}</h2>
              <SnapshotLabel value={report.sections.ranks.snapshotDate} />
            </div>
            <Card>
              <CardContent className="pt-6">
                {report.sections.ranks.rows.length === 0 ? (
                  <p className="text-muted-foreground text-sm">{t('portal.empty')}</p>
                ) : (
                  <div className="overflow-x-auto">
                    <Table>
                      <TableHeader><TableRow>
                        <TableHead>{t('portal.keyword')}</TableHead>
                        <TableHead>{t('portal.engine')}</TableHead>
                        <TableHead>{t('portal.position')}</TableHead>
                      </TableRow></TableHeader>
                      <TableBody>
                        {report.sections.ranks.rows.map((row) => (
                          <TableRow
                            key={`${row.keyword}-${row.engine}`}
                            data-snapshot-date={row.checkedAt}
                          >
                            <TableCell className="font-medium">{row.keyword}</TableCell>
                            <TableCell>{row.engine}</TableCell>
                            <TableCell>{row.position ?? t('portal.notRanked')}</TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </div>
                )}
              </CardContent>
            </Card>
          </section>
        ) : null}

        {gsc ? (
          <section aria-labelledby="portal-gsc-title" className="space-y-4">
            <div>
              <h2 id="portal-gsc-title" className="text-xl font-semibold">{t('portal.gsc')}</h2>
              <SnapshotLabel value={gsc.snapshotDate} />
            </div>
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
              {([
                ['clicks', gsc.totalClicks],
                ['impressions', gsc.totalImpressions],
                ['ctr', `${(gsc.averageCtr * 100).toFixed(1)}%`],
                ['averagePosition', gsc.averagePosition.toFixed(1)],
              ] as const).map(([label, value]) => (
                <Card key={label} data-snapshot-date={gsc.snapshotDate}>
                  <CardHeader className="pb-2"><CardTitle className="text-sm">{t(`portal.${label}`)}</CardTitle></CardHeader>
                  <CardContent><span className="text-3xl font-semibold">{value}</span></CardContent>
                </Card>
              ))}
            </div>
            <Card>
              <CardHeader><CardTitle className="text-base">{t('portal.topQueries')}</CardTitle></CardHeader>
              <CardContent>
                {gsc.topQueries.length === 0 ? (
                  <p className="text-muted-foreground text-sm">{t('portal.empty')}</p>
                ) : (
                  <div className="overflow-x-auto">
                    <Table>
                      <TableHeader><TableRow>
                        <TableHead><span className="sr-only"><Search /></span>{t('portal.keyword')}</TableHead>
                        <TableHead>{t('portal.clicks')}</TableHead>
                        <TableHead>{t('portal.impressions')}</TableHead>
                        <TableHead>{t('portal.ctr')}</TableHead>
                        <TableHead>{t('portal.position')}</TableHead>
                      </TableRow></TableHeader>
                      <TableBody>
                        {gsc.topQueries.map((row) => (
                          <TableRow key={row.query} data-snapshot-date={row.snapshotDate}>
                            <TableCell className="font-medium">{row.query}</TableCell>
                            <TableCell>{row.clicks}</TableCell>
                            <TableCell>{row.impressions}</TableCell>
                            <TableCell>{(row.ctr * 100).toFixed(1)}%</TableCell>
                            <TableCell>{row.position.toFixed(1)}</TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </div>
                )}
              </CardContent>
            </Card>
          </section>
        ) : null}
      </main>
    </div>
  );
}

export function ClientPortalNotFound() {
  const { pathname } = useLocation();
  const locale = portalLocale(pathname);
  const { t, i18n } = useTranslation('clientReports');
  useEffect(() => {
    void i18n.changeLanguage(locale);
  }, [i18n, locale]);
  return (
    <main className="grid min-h-screen place-items-center bg-background px-4 text-foreground" dir={isRtl(locale) ? 'rtl' : 'ltr'}>
      <Helmet htmlAttributes={{ lang: locale, dir: isRtl(locale) ? 'rtl' : 'ltr' }}>
        <title>{t('portal.notFoundTitle')}</title>
        <meta name="robots" content="noindex, nofollow" />
      </Helmet>
      <Card className="w-full max-w-lg">
        <CardHeader>
          <h1 className="text-lg font-semibold">{t('portal.notFoundTitle')}</h1>
        </CardHeader>
        <CardContent>
          <p className="text-muted-foreground">{t('portal.notFoundDescription')}</p>
        </CardContent>
      </Card>
    </main>
  );
}

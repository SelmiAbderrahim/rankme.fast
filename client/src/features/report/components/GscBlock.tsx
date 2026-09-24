/**
 * GSC block — Search Analytics summary and/or sitemap health
 * rendered inside the `gsc-ctr-low` and `sitemap-errors` issue rows. Mirrors
 * `PageSpeedBlock`: flat 1px-bordered block, semantic tokens only, no gauges.
 *
 * States:
 *   - section null OR `status: 'not-connected'` → localized "Connect Google
 *     Search Console" prompt linking to `/sites/{siteId}?tab=google`.
 *   - `status: 'needs-reconnect'` → reconnect note (same link).
 *   - `status: 'unavailable'` → localized inline note (pageSpeed shape).
 *   - `status: 'no-data'` / `'no-sitemaps'` → honest empty note.
 *   - `status: 'ok'` → totals `<dl>`, top-5 queries/pages tables, delta
 *     badges, "sampled by Google · last 3 days excluded" footnote.
 *
 * RTL-safe: layout uses logical utilities; numeric cells pin `dir="ltr"` so
 * figures never flip in Arabic.
 */
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router-dom';
import { Badge } from '@shared/ui/badge';
import { TableHeaderHelp } from '@shared/ui/table-header-help';
import type { GscSearchSection, GscSitemapsSection } from '../types';

export interface GscBlockProps {
  search?: GscSearchSection | null;
  sitemaps?: GscSitemapsSection | null;
  siteId: string;
}

const formatInt = (locale: string, n: number): string => new Intl.NumberFormat(locale).format(n);
const formatPercent = (locale: string, n: number): string =>
  new Intl.NumberFormat(locale, {
    style: 'percent',
    maximumFractionDigits: 1,
  }).format(n);
const formatPosition = (locale: string, n: number): string =>
  new Intl.NumberFormat(locale, { maximumFractionDigits: 1 }).format(n);

type DegradedStatus = 'not-connected' | 'needs-reconnect' | 'unavailable';

const DegradedNote = ({
  status,
  siteId,
  testId,
}: {
  status: DegradedStatus;
  siteId: string;
  testId: string;
}) => {
  const { t } = useTranslation('report');
  if (status === 'not-connected') {
    return (
      <div
        className="border-border bg-muted/40 rounded-lg border p-4"
        data-testid={`${testId}-not-connected`}
        role="note"
      >
        <p className="text-sm font-semibold">{t('gscBlock.notConnectedTitle')}</p>
        <p className="text-muted-foreground mt-1 text-sm">{t('gscBlock.notConnectedBody')}</p>
        <Link
          to={`/sites/${siteId}?tab=google`}
          className="text-primary mt-2 inline-block text-sm font-medium underline"
        >
          {t('gscBlock.notConnectedCta')}
        </Link>
      </div>
    );
  }
  const title =
    status === 'needs-reconnect' ? t('gscBlock.reconnectTitle') : t('gscBlock.unavailableTitle');
  const body =
    status === 'needs-reconnect' ? t('gscBlock.reconnectBody') : t('gscBlock.unavailableBody');
  return (
    <div
      className="border-border bg-muted/40 rounded-lg border p-4"
      data-testid={`${testId}-${status}`}
      role="note"
    >
      <p className="text-sm font-semibold">{title}</p>
      <p className="text-muted-foreground mt-1 text-sm">{body}</p>
      {status === 'needs-reconnect' ? (
        <Link
          to={`/sites/${siteId}?tab=google`}
          className="text-primary mt-2 inline-block text-sm font-medium underline"
        >
          {t('gscBlock.notConnectedCta')}
        </Link>
      ) : null}
    </div>
  );
};

const TopTable = ({
  keyHeader,
  rows,
  locale,
}: {
  keyHeader: string;
  rows: Array<{
    key: string;
    clicks: number;
    impressions: number;
    ctr: number;
    position: number;
  }>;
  locale: string;
}) => {
  const { t } = useTranslation('report');
  return (
    <table className="w-full text-sm">
      <thead>
        <tr className="text-muted-foreground border-b text-xs">
          <th scope="col" className="py-1.5 text-start font-medium">
            {keyHeader}
          </th>
          <th scope="col" className="py-1.5 text-end font-medium">
            <TableHeaderHelp
              label={t('gscBlock.colClicks')}
              description={t('common:tableHelp.clicks')}
            />
          </th>
          <th scope="col" className="py-1.5 text-end font-medium">
            <TableHeaderHelp
              label={t('gscBlock.colImpressions')}
              description={t('common:tableHelp.impressions')}
            />
          </th>
          <th scope="col" className="py-1.5 text-end font-medium">
            <TableHeaderHelp label={t('gscBlock.colCtr')} description={t('common:tableHelp.ctr')} />
          </th>
          <th scope="col" className="py-1.5 text-end font-medium">
            <TableHeaderHelp
              label={t('gscBlock.colPosition')}
              description={t('common:tableHelp.averagePosition')}
            />
          </th>
        </tr>
      </thead>
      <tbody>
        {rows.map((row) => (
          <tr key={row.key} className="border-b last:border-b-0">
            <td className="max-w-0 truncate py-1.5 pe-2" title={row.key}>
              {row.key}
            </td>
            <td className="py-1.5 text-end tabular-nums" dir="ltr">
              {formatInt(locale, row.clicks)}
            </td>
            <td className="py-1.5 text-end tabular-nums" dir="ltr">
              {formatInt(locale, row.impressions)}
            </td>
            <td className="py-1.5 text-end tabular-nums" dir="ltr">
              {formatPercent(locale, row.ctr)}
            </td>
            <td className="py-1.5 text-end tabular-nums" dir="ltr">
              {formatPosition(locale, row.position)}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
};

const SearchSection = ({
  section,
  siteId,
}: {
  section: GscSearchSection | null;
  siteId: string;
}) => {
  const { t, i18n } = useTranslation('report');
  const locale = i18n.language;

  if (section === null || section.status === 'not-connected') {
    return <DegradedNote status="not-connected" siteId={siteId} testId="report-gsc-search" />;
  }
  if (section.status === 'needs-reconnect' || section.status === 'unavailable') {
    return <DegradedNote status={section.status} siteId={siteId} testId="report-gsc-search" />;
  }
  if (section.status === 'no-data') {
    return (
      <div
        className="border-border bg-muted/40 rounded-lg border p-4"
        data-testid="report-gsc-search-no-data"
        role="note"
      >
        <p className="text-sm font-semibold">{t('gscBlock.noDataTitle')}</p>
        <p className="text-muted-foreground mt-1 text-sm">{t('gscBlock.noDataBody')}</p>
      </div>
    );
  }

  const deltaEntries = [
    { key: 'clicks', value: section.delta.clicks, label: t('gscBlock.deltaClicks') },
    {
      key: 'impressions',
      value: section.delta.impressions,
      label: t('gscBlock.deltaImpressions'),
    },
  ].filter((d): d is { key: string; value: number; label: string } => d.value !== null);

  return (
    <div className="border-border rounded-lg border" data-testid="report-gsc-search-block">
      <div className="border-b px-4 py-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <p className="text-sm font-semibold">{t('gscBlock.sectionTitle')}</p>
          <span className="flex items-center gap-1.5">
            {deltaEntries.map((delta) => (
              <Badge
                key={delta.key}
                variant={delta.value >= 0 ? 'outline' : 'destructive'}
                data-testid={`report-gsc-delta-${delta.key}`}
              >
                <span dir="ltr">
                  {delta.value >= 0 ? '+' : ''}
                  {formatInt(locale, delta.value)}
                </span>
                &nbsp;{delta.label}
              </Badge>
            ))}
          </span>
        </div>
      </div>
      <div className="px-4 py-3">
        <dl className="flex flex-wrap gap-x-6 gap-y-1 text-sm">
          <div className="flex gap-2">
            <dt className="text-muted-foreground">{t('gscBlock.totalClicks')}</dt>
            <dd className="font-medium tabular-nums" dir="ltr">
              {formatInt(locale, section.totalClicks)}
            </dd>
          </div>
          <div className="flex gap-2">
            <dt className="text-muted-foreground">{t('gscBlock.totalImpressions')}</dt>
            <dd className="font-medium tabular-nums" dir="ltr">
              {formatInt(locale, section.totalImpressions)}
            </dd>
          </div>
          <div className="flex gap-2">
            <dt className="text-muted-foreground">{t('gscBlock.averageCtr')}</dt>
            <dd className="font-medium tabular-nums" dir="ltr">
              {formatPercent(locale, section.averageCtr)}
            </dd>
          </div>
          <div className="flex gap-2">
            <dt className="text-muted-foreground">{t('gscBlock.averagePosition')}</dt>
            <dd className="font-medium tabular-nums" dir="ltr">
              {formatPosition(locale, section.averagePosition)}
            </dd>
          </div>
        </dl>

        {section.topQueries.length > 0 ? (
          <div className="mt-4">
            <p className="text-muted-foreground text-xs font-medium uppercase tracking-wide">
              {t('gscBlock.topQueriesTitle')}
            </p>
            <div className="mt-1 overflow-x-auto">
              <TopTable
                keyHeader={t('gscBlock.colQuery')}
                locale={locale}
                rows={section.topQueries.slice(0, 5).map((q) => ({
                  key: q.query,
                  clicks: q.clicks,
                  impressions: q.impressions,
                  ctr: q.ctr,
                  position: q.position,
                }))}
              />
            </div>
          </div>
        ) : null}

        {section.topPages.length > 0 ? (
          <div className="mt-4">
            <p className="text-muted-foreground text-xs font-medium uppercase tracking-wide">
              {t('gscBlock.topPagesTitle')}
            </p>
            <div className="mt-1 overflow-x-auto">
              <TopTable
                keyHeader={t('gscBlock.colPage')}
                locale={locale}
                rows={section.topPages.slice(0, 5).map((p) => ({
                  key: p.url,
                  clicks: p.clicks,
                  impressions: p.impressions,
                  ctr: p.ctr,
                  position: p.position,
                }))}
              />
            </div>
          </div>
        ) : null}

        <p className="text-muted-foreground mt-3 text-xs italic">{t('gscBlock.sampledFootnote')}</p>
      </div>
    </div>
  );
};

const SitemapsSection = ({
  section,
  siteId,
}: {
  section: GscSitemapsSection | null;
  siteId: string;
}) => {
  const { t, i18n } = useTranslation('report');
  const locale = i18n.language;

  if (section === null || section.status === 'not-connected') {
    return <DegradedNote status="not-connected" siteId={siteId} testId="report-gsc-sitemaps" />;
  }
  if (section.status === 'needs-reconnect' || section.status === 'unavailable') {
    return <DegradedNote status={section.status} siteId={siteId} testId="report-gsc-sitemaps" />;
  }
  if (section.status === 'no-sitemaps') {
    return (
      <div
        className="border-border bg-muted/40 rounded-lg border p-4"
        data-testid="report-gsc-sitemaps-none"
        role="note"
      >
        <p className="text-sm font-semibold">{t('gscBlock.noSitemapsTitle')}</p>
        <p className="text-muted-foreground mt-1 text-sm">{t('gscBlock.noSitemapsBody')}</p>
      </div>
    );
  }

  const formatDate = (iso: string): string =>
    new Intl.DateTimeFormat(locale, { dateStyle: 'medium' }).format(new Date(iso));

  return (
    <div className="border-border rounded-lg border" data-testid="report-gsc-sitemaps-block">
      <div className="border-b px-4 py-3">
        <p className="text-sm font-semibold">{t('gscBlock.sitemapsTitle')}</p>
      </div>
      <ul className="flex flex-col divide-y">
        {section.sitemaps.map((sitemap) => (
          <li
            key={sitemap.path}
            className="flex flex-wrap items-center gap-x-3 gap-y-1 px-4 py-2.5"
            data-testid="report-gsc-sitemap-row"
          >
            <span
              className="min-w-0 flex-1 truncate font-mono text-xs"
              title={sitemap.path}
              dir="ltr"
            >
              {sitemap.path}
            </span>
            {sitemap.errors > 0 ? (
              <Badge variant="destructive" data-testid="report-gsc-sitemap-errors">
                {t('gscBlock.sitemapErrors', { count: sitemap.errors })}
              </Badge>
            ) : sitemap.warnings > 0 ? (
              <Badge variant="secondary" data-testid="report-gsc-sitemap-warnings">
                {t('gscBlock.sitemapWarnings', { count: sitemap.warnings })}
              </Badge>
            ) : (
              <Badge variant="outline" data-testid="report-gsc-sitemap-healthy">
                {t('gscBlock.sitemapHealthy')}
              </Badge>
            )}
            <span className="text-muted-foreground text-xs tabular-nums">
              {t('gscBlock.sitemapProcessed', { count: sitemap.processed })}
            </span>
            <span className="text-muted-foreground text-xs">
              {sitemap.lastDownloaded
                ? t('gscBlock.sitemapLastDownloaded', {
                    date: formatDate(sitemap.lastDownloaded),
                  })
                : t('gscBlock.sitemapNeverDownloaded')}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
};

export const GscBlock = ({ search, sitemaps, siteId }: GscBlockProps) => (
  <div className="flex flex-col gap-3" data-testid="report-gsc-block">
    {search !== undefined ? <SearchSection section={search} siteId={siteId} /> : null}
    {sitemaps !== undefined ? <SitemapsSection section={sitemaps} siteId={siteId} /> : null}
  </div>
);

import { useEffect } from 'react';
import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { Bdi } from '@shared/components/Bdi';
import { OpenIssuesChip } from '@shared/components/OpenIssuesChip';
import { RelativeTime } from '@shared/components/RelativeTime';
import { formatRelativeDate } from '@shared/lib/datetime';
import { GoogleReadinessText, type GoogleReadinessStatus } from '@features/google';
import { siteLabel } from '@shared/lib/siteLabel';
import { useAppDispatch, useAppSelector } from '@shared/hooks/redux';
import { Alert, AlertDescription } from '@shared/ui/alert';
import { Button } from '@shared/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@shared/ui/card';
import { Skeleton } from '@shared/ui/skeleton';
import { DeltaPill } from '@shared/ui/delta-pill';
import { StatusChip } from '@shared/ui/status-chip';
import { TAP_TARGET_LINK } from '@shared/ui/tap-target';
import { loadSiteHealth } from '../store/thunks';
import { selectSiteHealth, selectSiteHealthError, selectSiteHealthLoadedAt, selectSiteHealthLoading } from '../store/selectors';
import type { SiteHealthRow } from '../types';
import { PausedSitesPanel } from './PausedSitesPanel';

const READINESS_REASONS: ReadonlySet<GoogleReadinessStatus> = new Set(['not_connected', 'no_property', 'property_mismatch', 'error']);

/** One site's stored metrics, with missing or stale values named explicitly. */
export function HealthRow({ row }: { row: SiteHealthRow }) {
  const { t, i18n } = useTranslation('common');
  const name = siteLabel(row);
  const base = `/sites/${encodeURIComponent(row.id)}`;
  const count = (n: number) => new Intl.NumberFormat(i18n.language).format(n);
  const date = (value: string) => new Intl.DateTimeFormat(i18n.language, { dateStyle: 'medium', timeZone: 'UTC' }).format(new Date(value));
  const audit = row.lastAudit;
  const fixNow = row.openFixNow;
  const search = row.searchTrend;
  const rank = row.rankMovement;
  const readiness = search.state === 'unavailable' && READINESS_REASONS.has(search.reason as GoogleReadinessStatus)
    ? search.reason as Exclude<GoogleReadinessStatus, 'ok'> : null;
  const rankExcluded = rank.state === 'unavailable' ? [] : [
    rank.notCompared.failed > 0 ? t('dashboard.health.rank.notCompared.failed', { count: rank.notCompared.failed }) : null,
    rank.notCompared.skipped > 0 ? t('dashboard.health.rank.notCompared.skipped', { count: rank.notCompared.skipped }) : null,
    rank.notCompared.noPair > 0 ? t('dashboard.health.rank.notCompared.noPair', { count: rank.notCompared.noPair }) : null,
  ].filter((part): part is string => part !== null);
  const previousSearch = search.state !== 'unavailable' && search.previousClicks !== null && search.previousImpressions !== null;
  const staleSources = [
    audit.state === 'stale' ? { source: 'audit', asOf: audit.asOf } :
      fixNow.state === 'stale' ? { source: 'audit', asOf: fixNow.asOf } : null,
    search.state === 'stale' ? { source: 'search', asOf: search.asOf } : null,
    rank.state === 'stale' ? { source: 'rank', asOf: rank.asOf } : null,
  ].filter((entry): entry is { source: string; asOf: string } => entry !== null);
  return <li className="rounded-xl border p-4" data-testid={`site-health-row-${row.id}`}>
    <h3 className="mb-3 font-semibold"><Link to={base} className={`hover:underline ${TAP_TARGET_LINK}`}><Bdi>{name}</Bdi></Link></h3>
    {name !== row.domain ? <p className="mb-3 text-sm text-muted-foreground"><Bdi>{row.domain}</Bdi></p> : null}
    {staleSources.length > 0 ? <div role="group" aria-label={t('dashboard.health.stale')} className="mb-3 flex flex-wrap gap-1.5">
      {staleSources.map((entry) => <StatusChip key={entry.source} tone="warning"
        title={t(`dashboard.health.staleSource.${entry.source}.hint`)}>
        {t(`dashboard.health.staleSource.${entry.source}.label`, { date: date(entry.asOf) })}
        <span className="sr-only">. {t(`dashboard.health.staleSource.${entry.source}.hint`)}</span>
      </StatusChip>)}
    </div> : null}
    <dl className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
      <div><dt className="text-xs font-medium text-muted-foreground">{t('dashboard.health.columns.fixNow')}</dt>
        <dd className="mt-1 text-sm">{fixNow.state === 'unavailable'
          ? t(`dashboard.health.fixNow.unavailable.${fixNow.reason}`)
          : <><OpenIssuesChip metric={fixNow} />
            {fixNow.state === 'stale' ? <span className="ms-2 text-muted-foreground">{t('dashboard.health.asOf', { date: date(fixNow.asOf) })}</span> : null}</>}
        </dd>
        <dd><Link to={`${base}?tab=actions`} className={`text-xs underline ${TAP_TARGET_LINK}`}>{t('dashboard.health.open.actions')}<span className="sr-only"> — <Bdi>{name}</Bdi></span></Link></dd>
      </div>
      <div><dt className="text-xs font-medium text-muted-foreground">{t('dashboard.health.columns.lastAudit')}</dt>
        <dd className="mt-1 text-sm">{audit.state === 'unavailable' ? t('dashboard.health.lastAudit.never')
          : <><RelativeTime value={audit.finishedAt} />
            <span className="block text-xs text-muted-foreground">{date(audit.finishedAt)}</span>
            {audit.status !== 'succeeded' ? <span className="block">{t(`dashboard.health.lastAudit.status.${audit.status}`)}</span> : null}
            {audit.state === 'stale' ? <span className="block text-xs text-muted-foreground">{t('dashboard.health.stale')}</span> : null}</>}</dd>
        <dd><Link to={`${base}?tab=report`} className={`text-xs underline ${TAP_TARGET_LINK}`}>{t('dashboard.health.open.report')}<span className="sr-only"> — <Bdi>{name}</Bdi></span></Link></dd>
      </div>
      <div><dt className="text-xs font-medium text-muted-foreground">{t('dashboard.health.columns.search')}</dt>
        <dd className="mt-1 text-sm">{search.state === 'unavailable'
          ? readiness ? <GoogleReadinessText product="gsc" status={readiness} domain={row.domain} part="title" />
            : t(`dashboard.health.search.unavailable.${search.reason}`)
          : <>{t('dashboard.health.search.clicks', { n: count(search.clicks), count: search.clicks })}
              {previousSearch && (search.clicks !== 0 || search.previousClicks !== 0) ? <><DeltaPill value={search.clicks - search.previousClicks!} />
                <span className="sr-only">{t('dashboard.health.search.clicksDelta')}</span></> : null}
              <span className="block">{t('dashboard.health.search.impressions', { n: count(search.impressions), count: search.impressions })}
                {previousSearch && (search.impressions !== 0 || search.previousImpressions !== 0) ? <><DeltaPill value={search.impressions - search.previousImpressions!} />
                  <span className="sr-only">{t('dashboard.health.search.impressionsDelta')}</span></> : null}</span>
              <span className="block text-xs text-muted-foreground">{t(previousSearch ? 'dashboard.health.search.through' : 'dashboard.health.search.noPrevious', { date: date(search.asOf) })}</span>
              {search.state === 'stale' ? <span className="text-muted-foreground">{t('dashboard.health.stale')}</span> : null}</>}</dd>
        <dd><Link to={`${base}?tab=google`} className={`text-xs underline ${TAP_TARGET_LINK}`}>{t('dashboard.health.open.google')}<span className="sr-only"> — <Bdi>{name}</Bdi></span></Link></dd>
      </div>
      <div><dt className="text-xs font-medium text-muted-foreground">{t('dashboard.health.columns.keywords')}</dt>
        <dd className="mt-1 text-sm">{rank.state === 'unavailable' ? t(`dashboard.health.rank.unavailable.${rank.reason}`)
          : <>{t('dashboard.health.rank.summary', { improved: count(rank.improved), declined: count(rank.declined), unchanged: count(rank.unchanged) })}
            <span className="block text-xs text-muted-foreground">{t('dashboard.health.rank.compared', { compared: count(rank.compared), tracked: count(rank.tracked) })}</span>
            {rankExcluded.length > 0 ? <span className="block text-xs text-muted-foreground">{t('dashboard.health.rank.notCompared.lead', { parts: new Intl.ListFormat(i18n.language, { type: 'conjunction' }).format(rankExcluded) })}</span> : null}
            <span className="block text-xs text-muted-foreground">{t('dashboard.health.rank.lastCheck', { when: formatRelativeDate(rank.asOf, i18n.language) })}</span>
            {rank.state === 'stale' ? <span className="block text-xs text-muted-foreground">{t('dashboard.health.stale')}</span> : null}</>}</dd>
        <dd><Link to={`${base}?tab=keywords`} className={`text-xs underline ${TAP_TARGET_LINK}`}>{t('dashboard.health.open.keywords')}<span className="sr-only"> — <Bdi>{name}</Bdi></span></Link></dd>
      </div>
    </dl>
  </li>;
}

export function SiteHealthStrip() {
  const { t } = useTranslation('common');
  const dispatch = useAppDispatch();
  const health = useAppSelector(selectSiteHealth);
  const loading = useAppSelector(selectSiteHealthLoading);
  const loadedAt = useAppSelector(selectSiteHealthLoadedAt);
  const error = useAppSelector(selectSiteHealthError);
  useEffect(() => { void dispatch(loadSiteHealth()); }, [dispatch, loadedAt]);
  return <section aria-labelledby="site-health-title" className="mb-6" data-testid="site-health">
    <Card><CardHeader><CardTitle><h2 id="site-health-title">{t('dashboard.health.title')}</h2></CardTitle>
      <CardDescription>{t('dashboard.health.description')}</CardDescription></CardHeader>
      <CardContent className="space-y-4">
        {health === null && !error ? <div role="status" aria-label={t('dashboard.health.loading')}><Skeleton className="h-32 w-full" /></div> : null}
        {error && health === null ? <Alert variant="destructive" role="alert"><AlertDescription>{error}</AlertDescription>
          <Button type="button" variant="outline" size="sm" loading={loading} onClick={() => void dispatch(loadSiteHealth({ force: true }))}>{t('retry')}</Button>
        </Alert> : null}
        {health?.totalSites === 0 ? <p>{t('dashboard.health.empty.body')} <Link to="/sites" className="underline">{t('dashboard.health.empty.cta')}</Link></p> : null}
        {health && health.totalSites > 0 && health.sites.length === 0 ? <p>{t('dashboard.health.allPaused')}</p> : null}
        {health && health.sites.length > 0 ? <ul className="space-y-3">{health.sites.map((row) => <HealthRow key={row.id} row={row} />)}</ul> : null}
        {health?.hasMore ? <p className="text-sm text-muted-foreground">{t('dashboard.health.showing', { count: health.activeSites, shown: health.sites.length, total: health.activeSites })} <Link to="/sites" className="underline">{t('dashboard.health.seeAll', { count: health.totalSites, total: health.totalSites })}</Link></p> : null}
      </CardContent></Card>
      {health && health.pausedSites > 0 ? <PausedSitesPanel health={health} /> : null}
  </section>;
}

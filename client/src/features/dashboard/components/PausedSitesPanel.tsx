import { Play } from 'lucide-react';
import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import { Bdi } from '@shared/components/Bdi';
import { isolateText } from '@shared/lib/bidi';
import { siteLabel } from '@shared/lib/siteLabel';
import { formatRelativeDate } from '@shared/lib/datetime';
import { useAppDispatch, useAppSelector } from '@shared/hooks/redux';
import { resumeSite, selectPausingSiteId } from '@features/sites';
import { selectActiveWorkspaceRole } from '@features/workspace';
import { Button } from '@shared/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@shared/ui/card';
import { StatusChip } from '@shared/ui/status-chip';
import type { SiteHealthResponse } from '../types';

export function PausedSitesPanel({ health }: { health: SiteHealthResponse }) {
  const dispatch = useAppDispatch();
  const { t, i18n } = useTranslation(['common', 'sites']);
  const role = useAppSelector(selectActiveWorkspaceRole);
  const pausingId = useAppSelector(selectPausingSiteId);
  const more = health.pausedSites - health.pausedList.length;
  const resume = async (id: string, domain: string) => {
    const result = await dispatch(resumeSite(id));
    if (resumeSite.fulfilled.match(result)) toast.success(t('common:dashboard.health.paused.resumed', { domain: isolateText(domain) }));
    else toast.error(result.payload ?? t('common:dashboard.health.paused.resumeFailed'));
  };
  return <Card className="mt-4" data-testid="paused-sites-panel">
    <CardHeader><CardTitle><h2>{t('common:dashboard.health.paused.title', { n: health.pausedSites, count: health.pausedSites })}</h2></CardTitle>
      <CardDescription>{t('common:dashboard.health.paused.explain')}</CardDescription></CardHeader>
    <CardContent className="space-y-3"><ul className="space-y-2">{health.pausedList.map((site) => {
      const name = siteLabel(site);
      return <li key={site.id} className="flex flex-wrap items-center justify-between gap-3 rounded-lg border p-3">
        <div className="flex flex-wrap items-center gap-2">
          <Link to={`/sites/${encodeURIComponent(site.id)}`} className="font-medium underline"><Bdi>{name}</Bdi></Link>
          <StatusChip tone="warning">{t('sites:paused.chip')}</StatusChip>
          {site.pausedAt ? <span className="text-sm text-muted-foreground">{t('common:dashboard.health.paused.since', { when: formatRelativeDate(site.pausedAt, i18n.language) })}</span> : null}
        </div>
        {role === 'owner' ? <Button type="button" variant="outline" size="sm" loading={pausingId === site.id}
          loadingLabel={t('common:dashboard.health.paused.resuming')}
          aria-label={t('common:dashboard.health.paused.resumeSite', { name: isolateText(name) })}
          onClick={() => void resume(site.id, site.domain)}>
          <Play aria-hidden="true" />{t('common:dashboard.health.paused.resume')}
        </Button> : null}
      </li>;
    })}</ul>
      {more > 0 ? <p className="text-sm text-muted-foreground">{t('common:dashboard.health.paused.more', { count: more, n: more })}{' '}
        <Link to="/sites" className="underline">{t('common:dashboard.health.paused.manage')}</Link></p> : null}
      {role !== 'owner' ? <p className="text-sm text-muted-foreground">{t('common:dashboard.health.paused.ownerOnly')}</p> : null}
    </CardContent>
  </Card>;
}

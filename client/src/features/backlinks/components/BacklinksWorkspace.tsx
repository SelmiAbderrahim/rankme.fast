import { useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { ReportExportControl } from '@features/report-export';
import { loadSites, selectSites, selectSitesLoaded } from '@features/sites';
import { useAppDispatch, useAppSelector } from '@shared/hooks/redux';
import { DocsLink } from '@shared/docs/DocsLink';
import { cn } from '@shared/lib/utils';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@shared/ui/tabs';
import { loadList, loadSummary } from '../store/thunks';
import { BACKLINK_TABS, useBacklinkTab } from '../tabState';
import { BacklinksPanel } from './BacklinksPanel';
import {
  AnchorsView,
  BulkRankView,
  HistoryView,
  ReferringDomainsView,
  parseWorkspaceDomain,
} from './DeepPullViews';
import { GapWorkspace } from './GapWorkspace';
import { ToxicityWorkspace } from './ToxicityWorkspace';

interface BacklinksWorkspaceProps {
  siteId: string;
  embedded?: boolean;
}

export function BacklinksWorkspace({ siteId, embedded = false }: BacklinksWorkspaceProps) {
  const { t, i18n } = useTranslation('backlinks');
  const dispatch = useAppDispatch();
  const sites = useAppSelector(selectSites);
  const sitesLoaded = useAppSelector(selectSitesLoaded);
  const [tab, setTab] = useBacklinkTab(embedded ? 'view' : 'tab');
  const requested = useRef(new Set<string>());

  useEffect(() => {
    if (!sitesLoaded) void dispatch(loadSites({ direction: 'initial' }));
  }, [dispatch, sitesLoaded]);

  useEffect(() => {
    const key = `${siteId}:${tab}`;
    if (requested.current.has(key)) return;
    if (tab === 'overview') {
      requested.current.add(key);
      void dispatch(loadSummary({ siteId }));
    } else if (tab === 'rows') {
      requested.current.add(key);
      void dispatch(loadList({ siteId }));
    }
  }, [dispatch, siteId, tab]);

  const site = sites.find((candidate) => candidate.id === siteId);
  const domain = parseWorkspaceDomain(site?.domain ?? '');

  return (
    <section
      className={cn('flex flex-col gap-6', !embedded && 'px-4 py-8')}
      data-testid="link-intelligence-workspace"
      data-embedded={embedded ? 'true' : undefined}
      dir={i18n.dir()}
    >
      <header className="flex flex-wrap items-start justify-between gap-4">
        <div>
          {embedded ? (
            <h2 className="text-2xl font-semibold">{t('intelligence.title')}</h2>
          ) : (
            <h1 className="text-2xl font-semibold">{t('intelligence.title')}</h1>
          )}
          <p className="text-muted-foreground text-sm">{t('intelligence.description')}</p>
        </div>
        <div className="flex shrink-0 flex-col items-end gap-1">
          {tab === 'overview' || tab === 'rows' ? (
            <ReportExportControl
              kind={tab === 'overview' ? 'backlinks.summary' : 'backlinks.inventory'}
              target={{ scope: 'site', siteId }}
              selection={{}}
            />
          ) : null}
          <DocsLink slug="link-intelligence" className="text-muted-foreground hover:text-foreground text-xs underline underline-offset-2" />
        </div>
      </header>
      <Tabs value={tab} onValueChange={(value) => setTab(value as typeof tab)}>
        <div>
          <TabsList
            variant="line"
            aria-label={t('intelligence.tabs.label')}
            className="h-auto w-full flex-wrap justify-start sm:w-fit"
          >
            {BACKLINK_TABS.map((item) => (
              <TabsTrigger key={item} value={item} data-testid={`link-intel-tab-${item}`}>
                {t(`intelligence.tabs.${item}`)}
              </TabsTrigger>
            ))}
          </TabsList>
        </div>
        <TabsContent value="overview">
          <BacklinksPanel siteId={siteId} view="overview" managedExternally />
        </TabsContent>
        <TabsContent value="rows">
          <BacklinksPanel siteId={siteId} view="rows" managedExternally />
        </TabsContent>
        <TabsContent value="domains" className="flex flex-col gap-6">
          <ReferringDomainsView siteId={siteId} domain={domain} />
          <BulkRankView siteId={siteId} domain={domain} />
        </TabsContent>
        <TabsContent value="anchors">
          <AnchorsView siteId={siteId} domain={domain} />
        </TabsContent>
        <TabsContent value="history">
          <HistoryView siteId={siteId} domain={domain} />
        </TabsContent>
        <TabsContent value="gap">
          <GapWorkspace siteId={siteId} ownDomain={domain} />
        </TabsContent>
        <TabsContent value="toxicity">
          <ToxicityWorkspace siteId={siteId} />
        </TabsContent>
      </Tabs>
    </section>
  );
}

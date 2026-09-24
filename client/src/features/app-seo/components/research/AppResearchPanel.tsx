import { useCallback, useEffect, useMemo } from 'react';
import { FlaskConical } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { useSearchParams } from 'react-router-dom';
import { ReportExportControl } from '@features/report-export';
import { useAppDispatch, useAppSelector } from '@shared/hooks/redux';
import { Alert, AlertDescription, AlertTitle } from '@shared/ui/alert';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@shared/ui/card';
import { Empty, EmptyDescription, EmptyHeader, EmptyTitle } from '@shared/ui/empty';
import { Label } from '@shared/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@shared/ui/select';
import { Skeleton } from '@shared/ui/skeleton';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@shared/ui/tabs';
import { selectAppProfiles } from '../../store/selectors';
import { selectAppSeoResearch } from '../../store/research-selectors';
import { loadLatestAppResearch } from '../../store/research-thunks';
import type { AppProfile } from '../../types';
import type { AppResearchStore, AppResearchSurface } from '../../research-types';
import { CompetitorResearchPanel } from './CompetitorResearchPanel';
import { GapResearchPanel } from './GapResearchPanel';
import { KeywordResearchPanel } from './KeywordResearchPanel';

const PANELS: readonly AppResearchSurface[] = ['keywords', 'gap', 'competitors'];
const profileLabel = (profile: AppProfile) => profile.playPackageId ?? profile.appStoreId ?? profile.id;

export function AppResearchPanel({ siteId }: { siteId: string }) {
  const { t } = useTranslation('appSeoResearch');
  const dispatch = useAppDispatch();
  const profiles = useAppSelector(selectAppProfiles);
  const research = useAppSelector(selectAppSeoResearch);
  const [params, setParams] = useSearchParams();
  const panelParam = params.get('panel');
  const panel: AppResearchSurface = PANELS.includes(panelParam as AppResearchSurface)
    ? panelParam as AppResearchSurface
    : 'keywords';
  const profileId = params.get('profile') ?? profiles[0]?.id ?? '';
  const profile = profiles.find((candidate) => candidate.id === profileId) ?? profiles[0] ?? null;
  const requestedStore = params.get('store');
  const availableStores = useMemo(() => [
    ...(profile?.playPackageId ? ['google_play' as const] : []),
    ...(profile?.appStoreId ? ['app_store' as const] : []),
  ], [profile]);
  const store: AppResearchStore = availableStores.includes(requestedStore as AppResearchStore)
    ? requestedStore as AppResearchStore
    : availableStores[0] ?? 'google_play';
  const ownAppId = store === 'google_play' ? profile?.playPackageId : profile?.appStoreId;

  const setUrl = useCallback((values: Record<string, string | null>) => {
    const next = new URLSearchParams(params);
    Object.entries(values).forEach(([key, value]) => {
      if (value === null) next.delete(key); else next.set(key, value);
    });
    setParams(next, { replace: true });
  }, [params, setParams]);

  useEffect(() => {
    if (!profile || !ownAppId) return;
    if (!params.get('profile') || !params.get('store') || !params.get('panel')) {
      setUrl({ profile: profile.id, store, panel });
      return;
    }
    void dispatch(loadLatestAppResearch({ siteId, profileId: profile.id, store, surface: panel }));
  }, [dispatch, ownAppId, panel, params, profile, setUrl, siteId, store]);

  if (profiles.length === 0) {
    return <Empty data-testid="app-seo-view-research"><EmptyHeader><EmptyTitle>{t('empty.noProfileTitle')}</EmptyTitle><EmptyDescription>{t('empty.noProfileDescription')}</EmptyDescription></EmptyHeader></Empty>;
  }
  if (!profile || !ownAppId) return null;
  if (research.loadStatus === 'loading' && research.profileId !== profile.id) {
    return <Skeleton className="h-72 w-full" />;
  }
  const disabled = !research.researchEnabled;
  return (
    <div className="flex flex-col gap-6" data-testid="app-seo-view-research">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex items-start gap-3"><FlaskConical aria-hidden="true" className="mt-1 size-5" /><div><h3 className="text-lg font-semibold">{t('title')}</h3><p className="text-muted-foreground text-sm">{t('description')}</p></div></div>
        <ReportExportControl
          kind="app.research_result"
          target={{ scope: 'site_resource', siteId, resourceId: profile.id }}
          selection={{ surface: panel, store }}
          disabled={disabled}
        />
      </div>
      {research.error ? <Alert variant="destructive"><AlertTitle>{t('errors.title')}</AlertTitle><AlertDescription>{research.error}</AlertDescription></Alert> : null}
      {disabled ? <Alert><AlertTitle>{t('disabled.title')}</AlertTitle><AlertDescription>{t('disabled.description')}</AlertDescription></Alert> : null}
      <Card><CardHeader><CardTitle>{t('scope.title')}</CardTitle><CardDescription>{t('scope.description')}</CardDescription></CardHeader><CardContent className="grid gap-4 md:grid-cols-2"><div className="flex flex-col gap-2"><Label htmlFor="app-research-profile">{t('scope.profile')}</Label><Select value={profile.id} onValueChange={(value) => setUrl({ profile: value, store: null })}><SelectTrigger id="app-research-profile" className="w-full"><SelectValue /></SelectTrigger><SelectContent>{profiles.map((item) => <SelectItem key={item.id} value={item.id}>{profileLabel(item)}</SelectItem>)}</SelectContent></Select></div><div className="flex flex-col gap-2"><Label htmlFor="app-research-store">{t('scope.store')}</Label><Select value={store} onValueChange={(value) => setUrl({ store: value })}><SelectTrigger id="app-research-store" className="w-full"><SelectValue /></SelectTrigger><SelectContent>{availableStores.map((item) => <SelectItem key={item} value={item}>{t(`stores.${item}`)}</SelectItem>)}</SelectContent></Select></div></CardContent></Card>
      <Tabs value={panel} onValueChange={(value) => setUrl({ panel: value })}>
        <TabsList variant="line" className="h-auto w-full justify-start"><TabsTrigger value="keywords">{t('panels.keywords')}</TabsTrigger><TabsTrigger value="gap">{t('panels.gap')}</TabsTrigger><TabsTrigger value="competitors">{t('panels.competitors')}</TabsTrigger></TabsList>
        <TabsContent value="keywords"><KeywordResearchPanel siteId={siteId} profileId={profile.id} store={store} disabled={disabled} /></TabsContent>
        <TabsContent value="gap"><GapResearchPanel siteId={siteId} profileId={profile.id} store={store} ownAppId={ownAppId} disabled={disabled} /></TabsContent>
        <TabsContent value="competitors"><CompetitorResearchPanel siteId={siteId} profileId={profile.id} store={store} disabled={disabled} /></TabsContent>
      </Tabs>
    </div>
  );
}

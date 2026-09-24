import { useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { Smartphone } from 'lucide-react';
import { APP_SEO_VIEWS, useAppSeoView, type AppSeoView } from '@features/sites';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@shared/ui/tabs';
import { useAppDispatch } from '@shared/hooks/redux';
import { AppProfileForm } from './AppProfileForm';
import { AppProfileList } from './AppProfileList';
import { AppKeywordTrackingPanel } from './tracking/AppKeywordTrackingPanel';
import { AppResearchPanel } from './research/AppResearchPanel';
import { AppChartTrackingPanel } from './charts/AppChartTrackingPanel';
import { AppReviewsPanel } from './reviews/AppReviewsPanel';
import { AppSeoComparePanel } from './compare/AppSeoComparePanel';
import { AppListingPanel } from './listing/AppListingPanel';
import { loadAppProfiles } from '../store/thunks';

export interface AppsPanelProps {
  siteId: string;
}

const AppProfilesView = ({ siteId }: { siteId: string }) => (
  <div
    className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]"
    data-testid="app-seo-view-profiles"
  >
    <AppProfileForm siteId={siteId} />
    <AppProfileList siteId={siteId} />
  </div>
);

const renderView = (
  view: AppSeoView,
  siteId: string,
) => {
  switch (view) {
    case 'profiles':
      return <AppProfilesView siteId={siteId} />;
    case 'keywords':
      return <AppKeywordTrackingPanel siteId={siteId} />;
    case 'listing':
      return <AppListingPanel siteId={siteId} />;
    case 'research':
      return <AppResearchPanel siteId={siteId} />;
    case 'charts':
      return <AppChartTrackingPanel siteId={siteId} />;
    case 'reviews':
      return <AppReviewsPanel siteId={siteId} />;
    case 'compare':
      return <AppSeoComparePanel siteId={siteId} />;
  }
};

export const AppsPanel = ({ siteId }: AppsPanelProps) => {
  const { t } = useTranslation('appSeo');
  const dispatch = useAppDispatch();
  const [view, setView] = useAppSeoView();

  useEffect(() => {
    void dispatch(loadAppProfiles({ siteId }));
  }, [dispatch, siteId]);

  return (
    <section
      className="flex flex-col gap-6"
      aria-labelledby="app-seo-heading"
      data-testid="apps-panel"
    >
      <div className="flex items-start gap-3">
        <Smartphone aria-hidden="true" className="mt-1 size-5 shrink-0" />
        <div>
          <h2 id="app-seo-heading" className="text-xl font-semibold">
            {t('title')}
          </h2>
          <p className="text-muted-foreground text-sm">{t('description')}</p>
        </div>
      </div>
      <Tabs value={view} onValueChange={(next) => setView(next as AppSeoView)}>
        <div className="w-full overflow-x-auto pb-2">
          <TabsList variant="line" className="h-auto w-max min-w-full justify-start">
            {APP_SEO_VIEWS.map((candidate) => (
              <TabsTrigger
                key={candidate}
                value={candidate}
                data-testid={`app-seo-view-tab-${candidate}`}
              >
                {t(`views.${candidate}`)}
              </TabsTrigger>
            ))}
          </TabsList>
        </div>
        {APP_SEO_VIEWS.map((candidate) => (
          <TabsContent key={candidate} value={candidate} className="mt-0">
            {renderView(candidate, siteId)}
          </TabsContent>
        ))}
      </Tabs>
    </section>
  );
};

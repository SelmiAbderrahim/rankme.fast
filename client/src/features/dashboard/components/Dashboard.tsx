import { useEffect, useMemo } from 'react';
import { ArrowRight } from 'lucide-react';
import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { loadSites, selectSites, selectSitesLoaded, selectSitesLoading } from '@features/sites';
import type { Site } from '@features/sites';
import { PageHeader } from '@shared/components/PageHeader';
import { useAppDispatch, useAppSelector } from '@shared/hooks/redux';
import { APP_PAGE_ICONS } from '@shared/navigation/appPageIcons';
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from '@shared/ui/card';
import { Button } from '@shared/ui/button';
import { Skeleton } from '@shared/ui/skeleton';

type CardKey =
  | 'sites'
  | 'ranks'
  | 'keywordResearch'
  | 'backlinks'
  | 'competitors'
  | 'profile';

interface DashboardCard {
  key: CardKey;
  to: string;
}

/** Authenticated landing. Grid of every product surface. */
export const Dashboard = () => {
  const dispatch = useAppDispatch();
  const { t } = useTranslation('common');

  const sites = useAppSelector(selectSites);
  const sitesLoading = useAppSelector(selectSitesLoading);
  const sitesLoaded = useAppSelector(selectSitesLoaded);

  useEffect(() => {
    if (!sitesLoaded) {
      void dispatch(loadSites({}));
    }
  }, [dispatch, sitesLoaded]);

  const firstSite: Site | undefined = sites[0];

  const cards: DashboardCard[] = useMemo(() => {
    const list: DashboardCard[] = [{ key: 'sites', to: '/sites' }];
    if (firstSite) {
      list.push({ key: 'ranks', to: `/sites/${firstSite.id}?tab=keywords` });
    }
    list.push({ key: 'keywordResearch', to: '/keyword-research' });
    if (firstSite) {
      list.push(
        { key: 'backlinks', to: `/sites/${firstSite.id}?tab=backlinks` },
        { key: 'competitors', to: `/sites/${firstSite.id}?tab=competitors` },
      );
    }
    list.push({ key: 'profile', to: '/profile' });
    return list;
  }, [firstSite]);

  const initialLoading = sitesLoading && !sitesLoaded;

  return (
    <div className="dashboard px-4 py-8">
      <PageHeader
        className="mb-6"
        icon={APP_PAGE_ICONS.dashboard}
        title={t('dashboard.title')}
      />
      <Card className="mb-6" data-testid="dashboard-assistant-entry">
        <CardHeader>
          <CardTitle>{t('dashboard.cards.assistant.label')}</CardTitle>
          <CardDescription>{t('dashboard.cards.assistant.description')}</CardDescription>
        </CardHeader>
        <CardFooter className="justify-end">
          <Button asChild>
            <Link to="/assistant">
              {t('dashboard.cards.assistant.cta')}
              <ArrowRight data-icon="inline-end" aria-hidden="true" className="rtl:rotate-180" />
            </Link>
          </Button>
        </CardFooter>
      </Card>

      {initialLoading ? (
        <div
          role="status"
          aria-live="polite"
          aria-label={t('dashboard.loading')}
          className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3"
        >
          <Skeleton className="h-40 w-full" />
          <Skeleton className="h-40 w-full" />
          <Skeleton className="h-40 w-full" />
        </div>
      ) : (
        <nav
          aria-label={t('dashboard.title')}
          className="dashboard-nav grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3"
        >
          {cards.map((card) => (
            <Card key={card.key} className="flex flex-col">
              <CardHeader>
                <CardTitle>{t(`dashboard.cards.${card.key}.label`)}</CardTitle>
                <CardDescription>{t(`dashboard.cards.${card.key}.description`)}</CardDescription>
              </CardHeader>
              <CardContent className="mt-auto flex flex-col gap-3">
                <Button asChild variant="outline" className="w-full">
                  <Link to={card.to}>{t(`dashboard.cards.${card.key}.label`)}</Link>
                </Button>
              </CardContent>
            </Card>
          ))}
        </nav>
      )}
    </div>
  );
};

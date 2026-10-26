import { useEffect, useMemo } from 'react';
import { ArrowRight, ChevronDown } from 'lucide-react';
import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { TwoFactorRecommendation } from '@features/auth';
import { loadSites, selectCursorStack, selectNextCursor, selectSites, selectSitesLoaded, selectSitesLoading } from '@features/sites';
import type { Site } from '@features/sites';
import { Bdi } from '@shared/components/Bdi';
import { siteLabel } from '@shared/lib/siteLabel';
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
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger } from '@shared/ui/dropdown-menu';
import { SiteHealthStrip } from './SiteHealthStrip';

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
  cta: string;
  pickTab?: 'keywords' | 'backlinks' | 'competitors';
}

const PICKER_SITE_LIMIT = 8;

const SitePicker = ({ card, sites }: { card: DashboardCard; sites: readonly Site[] }) => {
  const { t } = useTranslation('common');
  const eligible = sites.filter((site) => !site.paused).slice(0, PICKER_SITE_LIMIT);
  if (eligible.length === 0) {
    return <Button asChild variant="outline" className="h-auto min-h-9 w-full whitespace-normal py-2 text-center">
      <Link to={card.to} aria-label={t(`dashboard.cards.${card.key}.pickCta`)}>{card.cta}</Link>
    </Button>;
  }
  return <DropdownMenu>
    <DropdownMenuTrigger asChild>
      <Button variant="outline" className="h-auto min-h-9 w-full whitespace-normal py-2 text-center"
        aria-label={t(`dashboard.cards.${card.key}.pickCta`)}>
        {card.cta}<ChevronDown aria-hidden="true" />
      </Button>
    </DropdownMenuTrigger>
    <DropdownMenuContent align="start" className="max-h-80 min-w-56 overflow-y-auto">
      <DropdownMenuLabel>{t('dashboard.cards.pickSiteMenu')}</DropdownMenuLabel>
      {eligible.map((site) => <DropdownMenuItem key={site.id} asChild>
        <Link to={`/sites/${site.id}?tab=${card.pickTab}`}><Bdi>{siteLabel(site)}</Bdi></Link>
      </DropdownMenuItem>)}
      <DropdownMenuSeparator />
      <DropdownMenuItem asChild><Link to={card.to}>{t('dashboard.cards.pickSiteAll')}</Link></DropdownMenuItem>
    </DropdownMenuContent>
  </DropdownMenu>;
};

/** Authenticated landing. Grid of every product surface. */
export const Dashboard = () => {
  const dispatch = useAppDispatch();
  const { t } = useTranslation('common');

  const sites = useAppSelector(selectSites);
  const sitesLoading = useAppSelector(selectSitesLoading);
  const sitesLoaded = useAppSelector(selectSitesLoaded);
  const nextCursor = useAppSelector(selectNextCursor);
  const cursorStack = useAppSelector(selectCursorStack);

  useEffect(() => {
    if (!sitesLoaded) {
      void dispatch(loadSites({}));
    }
  }, [dispatch, sitesLoaded]);

  const onlySite: Site | undefined = sites.length === 1 && !sites[0]?.paused && nextCursor === null && cursorStack.length === 0
    ? sites[0] : undefined;

  const cards: DashboardCard[] = useMemo(() => {
    const card = (key: CardKey, to: string): DashboardCard => ({ key, to, cta: t(`dashboard.cards.${key}.cta`) });
    const siteCard = (key: 'ranks' | 'backlinks' | 'competitors', tab: 'keywords' | 'backlinks' | 'competitors'):
      DashboardCard => onlySite
        ? card(key, `/sites/${onlySite.id}?tab=${tab}`)
        : { key, to: `/sites?open=${tab}`, cta: t('dashboard.cards.pickSiteCta'), pickTab: tab };
    const list: DashboardCard[] = [card('sites', '/sites')];
    if (sites.length > 0) {
      list.push(siteCard('ranks', 'keywords'));
    }
    list.push(card('keywordResearch', '/keyword-research'));
    if (sites.length > 0) {
      list.push(
        siteCard('backlinks', 'backlinks'),
        siteCard('competitors', 'competitors'),
      );
    }
    list.push(card('profile', '/profile'));
    return list;
  }, [onlySite, sites, t]);

  const initialLoading = sitesLoading && !sitesLoaded;

  return (
    <div className="dashboard px-4 py-8">
      <PageHeader
        className="mb-6"
        icon={APP_PAGE_ICONS.dashboard}
        title={t('dashboard.title')}
      />
      <TwoFactorRecommendation className="mb-6" />
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

      <SiteHealthStrip />

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
                {card.pickTab ? <SitePicker card={card} sites={sites} /> : (
                  <Button asChild variant="outline" className="h-auto min-h-9 w-full whitespace-normal py-2 text-center">
                    <Link to={card.to}>{card.cta}</Link>
                  </Button>
                )}
              </CardContent>
            </Card>
          ))}
        </nav>
      )}
    </div>
  );
};

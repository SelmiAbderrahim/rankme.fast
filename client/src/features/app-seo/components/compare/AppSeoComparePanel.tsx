import { useCallback, useEffect } from 'react';
import { ArrowLeftRight } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Link, useSearchParams } from 'react-router-dom';
import { useAppDispatch, useAppSelector } from '@shared/hooks/redux';
import { Alert, AlertDescription, AlertTitle } from '@shared/ui/alert';
import { Button } from '@shared/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@shared/ui/card';
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from '@shared/ui/empty';
import { Label } from '@shared/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@shared/ui/select';
import { Skeleton } from '@shared/ui/skeleton';
import { selectAppProfiles } from '../../store/selectors';
import { selectAppSeoCompare } from '../../store/compare-selectors';
import { loadAppSeoComparison } from '../../store/compare-thunks';
import type { AppProfile } from '../../types';
import { AppComparisonHeader } from './AppComparisonHeader';
import { ChartComparisonSection } from './ChartComparisonSection';
import { ListingParitySection } from './ListingParitySection';
import { RankComparisonSection } from './RankComparisonSection';

const profileLabel = (profile: AppProfile) =>
  profile.playPackageId ?? profile.appStoreId ?? profile.id;

export function AppSeoComparePanel({ siteId }: { siteId: string }) {
  const { t } = useTranslation('appSeoCompare');
  const dispatch = useAppDispatch();
  const profiles = useAppSelector(selectAppProfiles);
  const state = useAppSelector(selectAppSeoCompare);
  const [params, setParams] = useSearchParams();
  const requestedProfileId = params.get('profile');
  const profileId =
    requestedProfileId && profiles.some((profile) => profile.id === requestedProfileId)
      ? requestedProfileId
      : (profiles[0]?.id ?? '');
  const profile = profiles.find((candidate) => candidate.id === profileId) ?? null;

  const setProfile = useCallback(
    (value: string) => {
      const next = new URLSearchParams(params);
      next.set('profile', value);
      setParams(next, { replace: true });
    },
    [params, setParams],
  );

  useEffect(() => {
    if (!requestedProfileId && profileId) setProfile(profileId);
  }, [profileId, requestedProfileId, setProfile]);

  useEffect(() => {
    if (profileId) void dispatch(loadAppSeoComparison({ siteId, profileId }));
  }, [dispatch, profileId, siteId]);

  const href = (view: 'profiles' | 'keywords' | 'listing' | 'charts') =>
    `/sites/${encodeURIComponent(siteId)}?tab=apps&view=${view}${
      profileId ? `&profile=${encodeURIComponent(profileId)}` : ''
    }`;

  if (profiles.length === 0) {
    return (
      <Empty data-testid="app-seo-view-compare">
        <EmptyHeader>
          <EmptyMedia variant="icon">
            <ArrowLeftRight aria-hidden="true" />
          </EmptyMedia>
          <EmptyTitle>{t('empty.title')}</EmptyTitle>
          <EmptyDescription>{t('empty.description')}</EmptyDescription>
        </EmptyHeader>
        <EmptyContent>
          <Button asChild>
            <Link to={href('profiles')}>{t('empty.cta')}</Link>
          </Button>
        </EmptyContent>
      </Empty>
    );
  }

  if (state.status === 'loading' && state.profileId !== profileId) {
    return <Skeleton className="h-96 w-full" />;
  }

  return (
    <div className="flex flex-col gap-6" data-testid="app-seo-view-compare">
      <Card>
        <CardHeader>
          <CardTitle>{t('title')}</CardTitle>
          <CardDescription>{t('description')}</CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-2">
          <Label htmlFor="app-seo-compare-profile">{t('profile.label')}</Label>
          <Select value={profileId} onValueChange={setProfile}>
            <SelectTrigger id="app-seo-compare-profile" className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {profiles.map((item) => (
                <SelectItem key={item.id} value={item.id}>
                  {profileLabel(item)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </CardContent>
      </Card>
      {state.error ? (
        <Alert variant="destructive">
          <AlertTitle>{t('errors.title')}</AlertTitle>
          <AlertDescription>{state.error}</AlertDescription>
        </Alert>
      ) : null}
      {profile && !profile.paired ? (
        <Empty>
          <EmptyHeader>
            <EmptyMedia variant="icon">
              <ArrowLeftRight aria-hidden="true" />
            </EmptyMedia>
            <EmptyTitle>{t('unpaired.title')}</EmptyTitle>
            <EmptyDescription>{t('unpaired.description')}</EmptyDescription>
          </EmptyHeader>
          <EmptyContent>
            <Button asChild>
              <Link to={href('profiles')}>{t('unpaired.cta')}</Link>
            </Button>
          </EmptyContent>
        </Empty>
      ) : state.comparison && state.comparison.profile.id === profileId ? (
        <>
          <AppComparisonHeader comparison={state.comparison} />
          <RankComparisonSection comparison={state.comparison} keywordsHref={href('keywords')} />
          <ListingParitySection comparison={state.comparison} listingHref={href('listing')} />
          <ChartComparisonSection comparison={state.comparison} chartsHref={href('charts')} />
        </>
      ) : state.status === 'loading' ? (
        <Skeleton className="h-96 w-full" />
      ) : null}
    </div>
  );
}

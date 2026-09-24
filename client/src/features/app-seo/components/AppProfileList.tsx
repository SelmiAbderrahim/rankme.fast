import { useTranslation } from 'react-i18next';
import { PackageSearch, Trash2 } from 'lucide-react';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from '@shared/ui/alert-dialog';
import { Badge } from '@shared/ui/badge';
import { Button } from '@shared/ui/button';
import { Card, CardAction, CardContent, CardHeader, CardTitle } from '@shared/ui/card';
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from '@shared/ui/empty';
import { useAppDispatch, useAppSelector } from '@shared/hooks/redux';
import { selectAppProfiles, selectAppSeoRegistration } from '../store/selectors';
import { unregisterAppProfile } from '../store/thunks';

export const AppProfileList = ({ siteId }: { siteId: string }) => {
  const { t } = useTranslation('appSeo');
  const dispatch = useAppDispatch();
  const profiles = useAppSelector(selectAppProfiles);
  const registration = useAppSelector(selectAppSeoRegistration);
  const loading = registration.status === 'loading';

  if (profiles.length === 0) {
    return (
      <Empty data-testid="app-profile-empty">
        <EmptyHeader>
          <EmptyMedia variant="icon">
            <PackageSearch aria-hidden="true" />
          </EmptyMedia>
          <EmptyTitle>{t('profiles.emptyTitle')}</EmptyTitle>
          <EmptyDescription>{t('profiles.emptyDescription')}</EmptyDescription>
        </EmptyHeader>
      </Empty>
    );
  }

  return (
    <div className="grid gap-4" data-testid="app-profile-list">
      {profiles.map((profile) => (
        <Card key={profile.id} data-testid={`app-profile-${profile.id}`}>
          <CardHeader>
            <CardTitle>{profile.playPackageId ?? profile.appStoreId}</CardTitle>
            <CardAction>
              <AlertDialog>
                <AlertDialogTrigger asChild>
                  <Button
                    variant="outline"
                    size="icon-sm"
                    aria-label={t('profiles.deleteLabel', {
                      id: profile.playPackageId ?? profile.appStoreId,
                    })}
                    disabled={loading}
                  >
                    <Trash2 aria-hidden="true" />
                  </Button>
                </AlertDialogTrigger>
                <AlertDialogContent>
                  <AlertDialogHeader>
                    <AlertDialogTitle>{t('profiles.deleteTitle')}</AlertDialogTitle>
                    <AlertDialogDescription>
                      {t('profiles.deleteDescription')}
                    </AlertDialogDescription>
                  </AlertDialogHeader>
                  <AlertDialogFooter>
                    <AlertDialogCancel>{t('profiles.cancel')}</AlertDialogCancel>
                    <AlertDialogAction
                      variant="destructive"
                      onClick={() => {
                        void dispatch(unregisterAppProfile({ siteId, profileId: profile.id }));
                      }}
                    >
                      {t('profiles.confirmDelete')}
                    </AlertDialogAction>
                  </AlertDialogFooter>
                </AlertDialogContent>
              </AlertDialog>
            </CardAction>
          </CardHeader>
          <CardContent className="flex flex-wrap gap-2">
            {profile.playPackageId ? (
              <Badge variant="secondary">{t('profiles.googlePlay')}</Badge>
            ) : null}
            {profile.appStoreId ? (
              <Badge variant="secondary">{t('profiles.appStore')}</Badge>
            ) : null}
            {profile.paired ? <Badge variant="outline">{t('profiles.paired')}</Badge> : null}
            {profile.playPackageId ? (
              <span className="text-muted-foreground text-sm">{profile.playPackageId}</span>
            ) : null}
            {profile.appStoreId ? (
              <span className="text-muted-foreground text-sm">{profile.appStoreId}</span>
            ) : null}
          </CardContent>
        </Card>
      ))}
    </div>
  );
};

import { BarChart3 } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from '@shared/ui/empty';
import type { AppSeoView } from '@features/sites';

export const AppSeoViewShell = ({ view }: { view: Exclude<AppSeoView, 'profiles'> }) => {
  const { t } = useTranslation('appSeo');
  return (
    <Empty data-testid={`app-seo-view-${view}`}>
      <EmptyHeader>
        <EmptyMedia variant="icon">
          <BarChart3 aria-hidden="true" />
        </EmptyMedia>
        <EmptyTitle>{t(`views.${view}`)}</EmptyTitle>
        <EmptyDescription>{t('views.comingSoon')}</EmptyDescription>
      </EmptyHeader>
    </Empty>
  );
};

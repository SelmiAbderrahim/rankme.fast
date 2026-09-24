import { useTranslation } from 'react-i18next';
import { Link } from 'react-router-dom';
import { Button } from '@shared/ui/button';
import { appHref } from '@shared/navigation/appHref';
import { Empty, EmptyContent, EmptyDescription, EmptyTitle } from '@shared/ui/empty';

/**
 * Shared 404 surface. Used as a client-side courtesy when a role-gated screen
 * is reached by someone who cannot see it (the server is the real gate). Kept in
 * `shared/` so every feature renders the same not-found language.
 */
export const NotFound = () => {
  const { t } = useTranslation('common');
  return (
    <div className="mx-auto flex max-w-md flex-col items-center py-16">
      <Empty>
        <EmptyContent>
          <EmptyTitle>{t('notFound.title')}</EmptyTitle>
          <EmptyDescription>{t('notFound.description')}</EmptyDescription>
        </EmptyContent>
      </Empty>
      <Button asChild className="mt-4">
        <Link to={appHref('/dashboard')}>{t('notFound.backToDashboard')}</Link>
      </Button>
    </div>
  );
};

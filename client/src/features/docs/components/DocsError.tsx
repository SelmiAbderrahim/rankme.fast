import { Link, isRouteErrorResponse, useRouteError } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { Button } from '@shared/ui/button';
import { docsUrl } from '@shared/docs/docsUrl';
import { useMarketingRoute } from '@shared/i18n/localePath';

export const DocsError = () => {
  const error = useRouteError();
  const { locale } = useMarketingRoute();
  const { t } = useTranslation('docs');
  const notFound = isRouteErrorResponse(error) && error.status === 404;
  return (
    <main className="mx-auto max-w-2xl px-5 py-24 text-center" role="alert">
      <p className="text-sm font-semibold uppercase tracking-wide text-highlight">{notFound ? '404' : '500'}</p>
      <h1 className="mt-3 font-serif text-4xl font-semibold">{notFound ? t('error.notFoundTitle') : t('error.title')}</h1>
      <p className="mt-4 text-muted-foreground">{notFound ? t('error.notFoundBody') : t('error.body')}</p>
      <Button asChild className="mt-7"><Link to={docsUrl('index', locale)}>{t('error.back')}</Link></Button>
    </main>
  );
};

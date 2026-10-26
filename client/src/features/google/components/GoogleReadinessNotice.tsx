import { Link } from 'react-router-dom';
import { Trans, useTranslation } from 'react-i18next';
import { Alert, AlertDescription, AlertTitle } from '@shared/ui/alert';
import { Button } from '@shared/ui/button';
import { Bdi } from '@shared/components/Bdi';
import type { GoogleProductReadiness, GoogleReadinessStatus } from '../types';

export type GoogleProduct = 'gsc' | 'ga4';
type NotReady = Exclude<GoogleReadinessStatus, 'ok'>;

export function GoogleReadinessText({ product, status, domain, part }: {
  product: GoogleProduct;
  status: NotReady;
  domain: string;
  part: 'title' | 'body';
}) {
  const { t } = useTranslation('google');
  const key = `readiness.${product}.${status}`;
  if (part === 'title') return <>{t(`${key}.title`)}</>;
  return <Trans t={t} i18nKey={`${key}.body`} values={{ domain }} components={{ site: <Bdi /> }} />;
}

/** An actionable explanation of why a site's Google product is unavailable. */
export function GoogleReadinessNotice({ siteId, domain, product, readiness, showAction = true }: {
  siteId: string;
  domain: string;
  product: GoogleProduct;
  readiness: GoogleProductReadiness | undefined;
  showAction?: boolean;
}) {
  const { t } = useTranslation('google');
  if (!readiness || readiness.status === 'ok') return null;
  const { status } = readiness;
  const key = `readiness.${product}.${status}`;
  return (
    <Alert role="status" data-testid={`google-readiness-${product}`} data-status={status}>
      <AlertTitle><GoogleReadinessText product={product} status={status} domain={domain} part="title" /></AlertTitle>
      <AlertDescription>
        <p><GoogleReadinessText product={product} status={status} domain={domain} part="body" /></p>
        {status === 'no_property' && readiness.matching ? (
          <p className="text-muted-foreground">{t('readiness.matching')}</p>
        ) : null}
        {showAction ? (
          <Button asChild variant="outline" size="sm" className="mt-2">
            <Link to={`/sites/${encodeURIComponent(siteId)}?tab=google`}>{t(`${key}.cta`)}</Link>
          </Button>
        ) : null}
      </AlertDescription>
    </Alert>
  );
}

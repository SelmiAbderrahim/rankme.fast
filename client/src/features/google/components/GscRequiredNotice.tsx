import { Plug } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router-dom';
import { Alert, AlertDescription, AlertTitle } from '@shared/ui/alert';
import { Button } from '@shared/ui/button';

export interface GscRequiredNoticeProps {
  siteId: string;
  /** Which tool is asking; picks the sentence that says what it needs Search Console for. */
  tool: 'cannibalization' | 'internalLinks';
}

/** Says a tool needs Search Console and links to the site's Google tab to connect it. */
export const GscRequiredNotice = ({ siteId, tool }: GscRequiredNoticeProps) => {
  const { t } = useTranslation('google');
  return (
    <Alert role="status" data-testid="gsc-required-notice">
      <Plug aria-hidden="true" />
      <AlertTitle>{t('required.title')}</AlertTitle>
      <AlertDescription className="flex flex-col items-start gap-3">
        <p>{t(`required.body.${tool}`)}</p>
        <Button asChild variant="outline" size="sm">
          <Link to={`/sites/${encodeURIComponent(siteId)}?tab=google`}>{t('required.cta')}</Link>
        </Button>
      </AlertDescription>
    </Alert>
  );
};

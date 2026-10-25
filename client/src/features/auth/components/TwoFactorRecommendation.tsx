import { Link } from 'react-router-dom';
import { ShieldCheck, X } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { cn } from '@shared/lib/utils';
import { Alert, AlertDescription, AlertTitle } from '@shared/ui/alert';
import { Button } from '@shared/ui/button';
import { useTwoFactorRecommendation } from '../useTwoFactorRecommendation';

export const TwoFactorRecommendation = ({ className }: { className?: string }) => {
  const { t } = useTranslation('auth');
  const { visible, dismiss } = useTwoFactorRecommendation();
  if (!visible) return null;

  return <Alert role="region" aria-labelledby="two-factor-recommendation-title"
    className={cn('pe-12', className)} data-testid="two-factor-recommendation">
    <ShieldCheck aria-hidden="true" />
    <AlertTitle id="two-factor-recommendation-title">{t('twoFactorPrompt.title')}</AlertTitle>
    <AlertDescription>
      <p>{t('twoFactorPrompt.body')}</p>
      <div className="mt-2"><Button asChild size="sm"><Link to="/settings/security">
        {t('twoFactorPrompt.cta')}
      </Link></Button></div>
    </AlertDescription>
    <Button type="button" variant="ghost" size="icon-sm" className="absolute end-2 top-2"
      aria-label={t('twoFactorPrompt.dismiss')} onClick={() => void dismiss()}>
      <X aria-hidden="true" />
    </Button>
  </Alert>;
};

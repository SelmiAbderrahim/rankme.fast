import { useTranslation } from 'react-i18next';
import { Link } from 'react-router-dom';
import { Button } from '@shared/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@shared/ui/card';

/** The privacy tab points to the single deletion flow in Security settings. */
export const DeleteAccountLink = () => {
  const { t } = useTranslation('account');
  return <Card className="w-full">
    <CardHeader>
      <CardTitle className="text-xl">{t('privacy.delete.title')}</CardTitle>
      <p className="text-muted-foreground text-sm">{t('privacy.delete.description')}</p>
    </CardHeader>
    <CardContent><Button asChild variant="outline" className="w-fit">
      <Link to="/settings/security">{t('privacy.delete.link')}</Link>
    </Button></CardContent>
  </Card>;
};

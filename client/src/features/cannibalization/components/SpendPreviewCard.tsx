import { useTranslation } from 'react-i18next';
import { Card, CardDescription, CardHeader, CardTitle } from '@shared/ui/card';

/**
 * The disclosure shown BEFORE the user confirms. Usage is not metered, so the
 * card only states that; the generate call still repeats every server check.
 */
export const SpendPreviewCard = () => {
  const { t } = useTranslation('cannibalization');
  return (
    <Card data-testid="cannibalization-preview">
      <CardHeader>
        <CardTitle>{t('preview.title')}</CardTitle>
        <CardDescription>{t('common:capacity.selfHost')}</CardDescription>
      </CardHeader>
    </Card>
  );
};

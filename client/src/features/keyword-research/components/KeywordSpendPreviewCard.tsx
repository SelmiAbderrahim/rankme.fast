/**
 * Pre-confirm disclosure for the vendor-backed workspace forms. Usage is not
 * metered, so the card only states that. The confirm/cancel controls are
 * owned by the calling form; this card only presents.
 */
import { useTranslation } from 'react-i18next';
import { Card, CardContent, CardHeader, CardTitle } from '@shared/ui/card';
import { Skeleton } from '@shared/ui/skeleton';
import type { KeywordSpendPreview } from '../types';

interface KeywordSpendPreviewCardProps {
  preview: KeywordSpendPreview | null;
  loading: boolean;
}

export const KeywordSpendPreviewCard = ({
  preview,
  loading,
}: KeywordSpendPreviewCardProps) => {
  const { t } = useTranslation();

  if (loading && !preview) {
    return (
      <Card data-testid="kw-preview-loading" aria-busy="true">
        <CardHeader>
          <CardTitle>{t('keywordResearch:preview.title')}</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-2">
          <Skeleton className="h-4 w-2/3" />
          <Skeleton className="h-4 w-1/2" />
          <Skeleton className="h-4 w-1/3" />
        </CardContent>
      </Card>
    );
  }

  if (!preview) return null;

  return (
    <Card data-testid="kw-preview">
      <CardHeader>
        <CardTitle>{t('keywordResearch:preview.title')}</CardTitle>
      </CardHeader>
      <CardContent className="text-muted-foreground text-sm">
        {t('common:capacity.selfHost')}
      </CardContent>
    </Card>
  );
};

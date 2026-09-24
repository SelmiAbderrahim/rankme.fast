import { useTranslation } from 'react-i18next';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@shared/ui/card';
import { Skeleton } from '@shared/ui/skeleton';
import type { BrandRadarPreview } from '../types';

interface SpendPreviewCardProps {
  preview: BrandRadarPreview | null;
  loading: boolean;
}

/** Confirms the server accepted the scan input before a paid scan starts. */
export const SpendPreviewCard = ({ preview, loading }: SpendPreviewCardProps) => {
  const { t } = useTranslation('brandRadar');

  if (loading && !preview) {
    return (
      <Card aria-busy="true" aria-live="polite" data-testid="brand-radar-preview-loading">
        <CardHeader>
          <CardTitle>{t('preview.title')}</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-2">
          <Skeleton className="h-4 w-2/3" />
          <Skeleton className="h-4 w-1/2" />
        </CardContent>
      </Card>
    );
  }
  if (!preview) return null;

  return (
    <Card data-testid="brand-radar-preview">
      <CardHeader>
        <CardTitle>{t('preview.title')}</CardTitle>
        <CardDescription>{t('common:capacity.selfHost')}</CardDescription>
      </CardHeader>
    </Card>
  );
};

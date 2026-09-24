import { useTranslation } from 'react-i18next';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@shared/ui/card';
import { Skeleton } from '@shared/ui/skeleton';
import type { SpendPreview } from '../types';

interface SpendPreviewPanelProps {
  preview: SpendPreview | null;
  loading: boolean;
}

/** Read-only spend preview shown before a vendor pull is confirmed. */
export function SpendPreviewPanel({ preview, loading }: SpendPreviewPanelProps) {
  const { t } = useTranslation('backlinks');

  if (loading && !preview) {
    return (
      <Card aria-busy="true" data-testid="link-intel-preview-loading">
        <CardHeader>
          <CardTitle>{t('intelligence.preview.title')}</CardTitle>
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
    <Card data-testid="link-intel-preview">
      <CardHeader>
        <CardTitle>{t('intelligence.preview.title')}</CardTitle>
        <CardDescription>{t('common:capacity.selfHost')}</CardDescription>
      </CardHeader>
    </Card>
  );
}

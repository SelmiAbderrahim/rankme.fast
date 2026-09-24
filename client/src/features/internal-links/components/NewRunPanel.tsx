import { CalendarDays, Sparkles } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Alert, AlertDescription } from '@shared/ui/alert';
import { Button } from '@shared/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@shared/ui/card';
import { Separator } from '@shared/ui/separator';
import type { InternalLinkPreview, InternalLinkUiState } from '../types';
import { StateNotice } from './StateNotice';

interface NewRunPanelProps {
  inventoryHref?: string;
  preview: InternalLinkPreview | null;
  previewing: boolean;
  starting: boolean;
  gate: InternalLinkUiState | null;
  onPreview: () => void;
  onCancel: () => void;
  onConfirm: () => void;
}

export const NewRunPanel = ({
  inventoryHref,
  preview,
  previewing,
  starting,
  gate,
  onPreview,
  onCancel,
  onConfirm,
}: NewRunPanelProps) => {
  const { t } = useTranslation('internalLinks');
  if (gate) return <StateNotice kind={gate} />;
  if (preview && !preview.ready) {
    return <StateNotice kind={preview.reason ?? 'missing'} inventoryHref={inventoryHref} />;
  }

  return (
    <Card data-testid="internal-links-new-run">
      <CardHeader>
        <CardTitle>{t('newRun.title')}</CardTitle>
        <CardDescription>{t('newRun.description')}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {preview?.ready ? (
          <div className="space-y-4" data-testid="internal-links-preview">
            <Alert>
              <Sparkles aria-hidden="true" />
              <AlertDescription>{t('newRun.guidanceOnly')}</AlertDescription>
            </Alert>
            <dl className="grid gap-3">
              <div className="border-border bg-muted/40 flex gap-3 border p-3">
                <CalendarDays
                  className="text-muted-foreground mt-0.5 size-4"
                  aria-hidden="true"
                />
                <div>
                  <dt className="text-muted-foreground text-xs">
                    {t('newRun.inventoryLabel')}
                  </dt>
                  <dd className="text-sm font-medium" data-testid="internal-links-preview-date">
                    {preview.inventoryDate}
                  </dd>
                </div>
              </div>
            </dl>
            <p className="text-muted-foreground text-sm">{t('common:capacity.selfHost')}</p>
            <Separator />
            <div className="flex flex-wrap gap-2">
              <Button
                type="button"
                onClick={onConfirm}
                loading={starting}
                loadingLabel={t('newRun.starting')}
                data-testid="internal-links-confirm"
              >
                {t('newRun.confirm')}
              </Button>
              <Button
                type="button"
                variant="outline"
                onClick={onCancel}
                disabled={starting}
                data-testid="internal-links-cancel"
              >
                {t('newRun.cancel')}
              </Button>
            </div>
          </div>
        ) : (
          <Button
            type="button"
            onClick={onPreview}
            loading={previewing}
            loadingLabel={t('newRun.previewing')}
            data-testid="internal-links-preview-button"
          >
            {t('newRun.preview')}
          </Button>
        )}
      </CardContent>
    </Card>
  );
};

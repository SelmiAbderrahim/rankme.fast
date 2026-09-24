import { Layers, Sparkles } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Alert, AlertDescription } from '@shared/ui/alert';
import { Button } from '@shared/ui/button';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@shared/ui/card';
import { Separator } from '@shared/ui/separator';
import type { KeywordClusterPreview, KeywordClusterUiState } from '../types';
import { BlockedKeywords } from './BlockedKeywords';
import { StateNotice } from './StateNotice';

interface NewRunPanelProps {
  ranksHref?: string;
  preview: KeywordClusterPreview | null;
  previewing: boolean;
  starting: boolean;
  gate: KeywordClusterUiState | null;
  canPreview: boolean;
  onPreview: () => void;
  onCancel: () => void;
  onConfirm: () => void;
}

export const NewRunPanel = ({
  ranksHref,
  preview,
  previewing,
  starting,
  gate,
  canPreview,
  onPreview,
  onCancel,
  onConfirm,
}: NewRunPanelProps) => {
  const { t } = useTranslation('keywordClusters');
  if (gate) return <StateNotice kind={gate} ranksHref={ranksHref} />;
  if (preview && !preview.ready) {
    return (
      <div className="space-y-4">
        <StateNotice kind="notEnoughKeywords" ranksHref={ranksHref} />
        <BlockedKeywords
          blocked={preview.blocked}
          total={preview.blockedTotal}
          ranksHref={ranksHref}
        />
      </div>
    );
  }

  return (
    <Card data-testid="keyword-clusters-new-run">
      <CardHeader>
        <CardTitle>{t('newRun.title')}</CardTitle>
        <CardDescription>{t('newRun.description')}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {preview?.ready ? (
          <div className="space-y-4" data-testid="keyword-clusters-preview">
            <Alert>
              <Sparkles aria-hidden="true" />
              <AlertDescription>{t('newRun.storedOnly')}</AlertDescription>
            </Alert>
            <dl className="grid gap-3">
              <div className="border-border bg-muted/40 border p-3">
                <dt className="text-muted-foreground flex items-center gap-3 text-xs">
                  <Layers className="size-4" aria-hidden="true" />
                  {t('newRun.scopeLabel')}
                </dt>
                <dd
                  className="ms-7 text-sm font-medium"
                  data-testid="keyword-clusters-preview-scope"
                >
                  {t('newRun.scopeValue', { count: preview.readyCount })}
                </dd>
              </div>
            </dl>
            <p className="text-muted-foreground text-sm">
              {t('newRun.method', {
                shared: preview.minSharedUrls,
                window: preview.topUrlWindow,
                days: preview.freshnessDays,
              })}
            </p>
            <p className="text-muted-foreground text-sm">
              {t('newRun.labelingIncluded')}
            </p>
            <p className="text-muted-foreground text-sm">{t('common:capacity.selfHost')}</p>
            <BlockedKeywords
              blocked={preview.blocked}
              total={preview.blockedTotal}
              ranksHref={ranksHref}
            />
            <Separator />
            <div className="flex flex-wrap gap-2">
              <Button
                type="button"
                onClick={onConfirm}
                loading={starting}
                loadingLabel={t('newRun.starting')}
                data-testid="keyword-clusters-confirm"
              >
                {t('newRun.confirm')}
              </Button>
              <Button
                type="button"
                variant="outline"
                onClick={onCancel}
                disabled={starting}
                data-testid="keyword-clusters-cancel"
              >
                {t('newRun.cancel')}
              </Button>
            </div>
          </div>
        ) : (
          <Button
            type="button"
            onClick={onPreview}
            disabled={!canPreview}
            loading={previewing}
            loadingLabel={t('newRun.previewing')}
            data-testid="keyword-clusters-preview-button"
          >
            {t('newRun.preview')}
          </Button>
        )}
      </CardContent>
    </Card>
  );
};

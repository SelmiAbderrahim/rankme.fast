import { useEffect, useMemo, useState } from 'react';
import { ChevronDown, Copy, Download, RotateCcw, Share2 } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import type { SupportedLocale } from '@shared/i18n';
import { rootReducer } from '@app/store';
import { useAppDispatch, useAppSelector } from '@shared/hooks/redux';
import { writeToClipboard } from '@shared/lib/clipboard';
import { Alert, AlertDescription } from '@shared/ui/alert';
import { Button } from '@shared/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@shared/ui/dropdown-menu';
import type { ReportFormat, ReportTarget, ReportViewFilters } from '../types';
import { reportExportReducer } from '../store/slice';
import {
  selectReportExportActiveOperation,
  selectReportExportCapabilities,
  selectReportExportCapabilitiesError,
  selectReportExportCapabilitiesLoaded,
  selectReportExportCapabilitiesLoading,
  selectReportExportEnabled,
} from '../store/selectors';
import { createAndDownloadReport, loadReportExportCapabilities } from '../store/thunks';
import { ReportShareDialog } from './ReportShareDialog';

rootReducer.inject({ reducerPath: 'reportExport', reducer: reportExportReducer });

export interface ReportExportControlProps {
  kind: string;
  target: ReportTarget;
  selection?: ReportViewFilters;
  disabled?: boolean;
  className?: string;
  locale?: SupportedLocale;
  clipboardText?: string;
}

export function ReportExportControl({
  kind,
  target,
  selection = {},
  disabled = false,
  className,
  locale,
  clipboardText,
}: ReportExportControlProps) {
  const { t, i18n } = useTranslation('report');
  const dispatch = useAppDispatch();
  const capabilities = useAppSelector(selectReportExportCapabilities);
  const loaded = useAppSelector(selectReportExportCapabilitiesLoaded);
  const loading = useAppSelector(selectReportExportCapabilitiesLoading);
  const capabilitiesError = useAppSelector(selectReportExportCapabilitiesError);
  const enabled = useAppSelector(selectReportExportEnabled);
  const activeOperation = useAppSelector(selectReportExportActiveOperation);
  const capability = useMemo(
    () => capabilities.find((item) => item.kind === kind),
    [capabilities, kind],
  );
  const operationKey = `${kind}:${target.scope}:${'resourceId' in target ? target.resourceId : target.siteId}`;
  const busy = activeOperation === operationKey;
  const [shareOpen, setShareOpen] = useState(false);
  const [localError, setLocalError] = useState('');
  const [retryFormat, setRetryFormat] = useState<ReportFormat | null>(null);

  useEffect(() => {
    if (!loaded && !loading) void dispatch(loadReportExportCapabilities());
  }, [dispatch, loaded, loading]);

  const download = async (format: ReportFormat) => {
    setLocalError('');
    setRetryFormat(format);
    const action = await dispatch(
      createAndDownloadReport({
        operationKey,
        input: {
          kind,
          format,
          target,
          selection,
          locale,
        },
      }),
    );
    if (createAndDownloadReport.rejected.match(action)) {
      setLocalError(action.payload!);
    } else {
      setRetryFormat(null);
    }
  };

  const copyToClipboard = async (text: string) => {
    if (await writeToClipboard(text)) {
      toast.success(t('exportUi.clipboard.success'));
      return;
    }
    toast.error(t('exportUi.clipboard.error'));
  };

  if (loaded && (!enabled || !capability)) {
    return (
      <Button type="button" variant="outline" disabled className={className}>
        <Download data-icon="inline-start" />
        {t('exportUi.unavailable')}
      </Button>
    );
  }

  return (
    <div className="flex flex-col items-stretch gap-2 sm:items-end">
      <DropdownMenu dir={i18n.dir()}>
        <DropdownMenuTrigger asChild>
          <Button
            type="button"
            variant="outline"
            loading={loading || busy}
            loadingLabel={t(busy ? 'exportUi.preparing' : 'exportUi.loading')}
            disabled={disabled || Boolean(capabilitiesError)}
            className={className}
            aria-label={t('exportUi.trigger')}
          >
            <Download data-icon="inline-start" />
            {t('exportUi.trigger')}
            <ChevronDown data-icon="inline-end" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="min-w-56">
          <DropdownMenuGroup>
            <DropdownMenuLabel>{capability?.title ?? t('exportUi.formatsLabel')}</DropdownMenuLabel>
            {capability?.formats.map((format) => (
              <DropdownMenuItem key={format} onSelect={() => void download(format)}>
                <Download />
                {t(`exportUi.formats.${format}`)}
              </DropdownMenuItem>
            ))}
          </DropdownMenuGroup>
          {clipboardText || capability?.share.eligible ? (
            <>
              <DropdownMenuSeparator />
              <DropdownMenuGroup>
                {clipboardText ? (
                  <DropdownMenuItem onSelect={() => void copyToClipboard(clipboardText)}>
                    <Copy />
                    {t('exportUi.clipboard.action')}
                  </DropdownMenuItem>
                ) : null}
                {capability?.share.eligible ? (
                  <DropdownMenuItem onSelect={() => setShareOpen(true)}>
                    <Share2 />
                    {t('exportUi.share.action')}
                  </DropdownMenuItem>
                ) : null}
              </DropdownMenuGroup>
            </>
          ) : null}
        </DropdownMenuContent>
      </DropdownMenu>
      {localError || capabilitiesError ? (
        <Alert variant="destructive" role="alert" className="max-w-md">
          <AlertDescription className="flex flex-wrap items-center justify-between gap-2">
            <span>{localError || capabilitiesError}</span>
            <Button
              type="button"
              variant="outline"
              size="sm"
              loading={loading}
              onClick={() =>
                retryFormat
                  ? void download(retryFormat)
                  : void dispatch(loadReportExportCapabilities())
              }
            >
              <RotateCcw data-icon="inline-start" />
              {t('exportUi.actions.retry')}
            </Button>
          </AlertDescription>
        </Alert>
      ) : null}
      {capability ? (
        <ReportShareDialog
          open={shareOpen}
          onOpenChange={setShareOpen}
          capability={capability}
          target={target}
          selection={selection}
        />
      ) : null}
      <span className="sr-only" aria-live="polite">
        {busy ? t('exportUi.preparing') : localError}
      </span>
    </div>
  );
}

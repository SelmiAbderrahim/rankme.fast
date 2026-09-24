import { useCallback, useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '@shared/ui/button';
import { ReportExportControl } from '@features/report-export';
import { DocsLink } from '@shared/docs/DocsLink';
import { useAppSelector } from '@shared/hooks/redux';
import { rootReducer } from '@app/store';
import { audienceResearchReducer } from '../store/slice';
import { selectStartStatus } from '../store/selectors';
import { useAudienceResearchQuery } from '../tabState';
import { NewRunForm } from './NewRunForm';
import { RunHistoryTable } from './RunHistoryTable';
import { RunStatusCard } from './RunStatusCard';

interface AudienceResearchPanelProps {
  siteId: string;
}

/**
 * Top-level workspace tab. Lazily injects the `audienceResearch` reducer
 * (idempotent — `combineSlices().inject()` dedupes by `reducerPath`, so
 * calling it on every render is safe) so the slice works whether this panel
 * was reached via `SiteWorkspacePage`'s own lazy `import()` wiring or
 * rendered directly in a test harness.
 */
export function AudienceResearchPanel({ siteId }: AudienceResearchPanelProps) {
  rootReducer.inject({ reducerPath: 'audienceResearch', reducer: audienceResearchReducer });

  const { t } = useTranslation('audienceResearch');
  const [query, setQuery] = useAudienceResearchQuery();
  const startStatus = useAppSelector(selectStartStatus);

  // After a successful start (202), the URL becomes the source of truth for
  // the selected run — sync it once per new `lastStartedId`.
  const syncedStartedId = useRef<string | null>(null);
  useEffect(() => {
    if (
      startStatus.lastStartedId &&
      startStatus.lastStartedId !== syncedStartedId.current &&
      query.run !== startStatus.lastStartedId
    ) {
      syncedStartedId.current = startStatus.lastStartedId;
      setQuery({ run: startStatus.lastStartedId });
    }
  }, [query.run, setQuery, startStatus.lastStartedId]);

  const onOpenRun = useCallback(
    (runId: string) => {
      setQuery({ run: runId });
    },
    [setQuery],
  );

  const onBack = useCallback(() => {
    setQuery({ run: null });
  }, [setQuery]);

  if (query.run) {
    return (
      <div className="flex flex-col gap-4" data-testid="audience-research-panel">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={onBack}
            data-testid="audience-research-back"
          >
            {t('progress.back')}
          </Button>
          <ReportExportControl
            kind="audience.research_run"
            target={{ scope: 'site_resource', siteId, resourceId: query.run }}
            selection={{}}
          />
        </div>
        <RunStatusCard siteId={siteId} runId={query.run} />
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-4" data-testid="audience-research-panel">
      <NewRunForm siteId={siteId} />
      <RunHistoryTable siteId={siteId} onOpen={onOpenRun} />
      <DocsLink slug="audience-research" />
    </div>
  );
}

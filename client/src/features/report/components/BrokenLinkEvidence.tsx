import { useId, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Download } from 'lucide-react';
import { safeExternalHref } from '@shared/security';
import { Bdi } from '@shared/components/Bdi';
import { Button } from '@shared/ui/button';
import { StatusChip, type StatusTone } from '@shared/ui/status-chip';
import { saveBlobAs } from '@features/report-export';
import { buildBrokenLinkEvidenceCsv } from '../urlsCsv';
import type { BrokenLinkEvidenceRow, BrokenLinkOutcome } from '../types';

/** Rows shown before "Show all"; the CSV and the export always carry every row. */
export const BROKEN_LINK_ROWS_COLLAPSED = 20;

const OUTCOME_TONE: Record<BrokenLinkOutcome, StatusTone> = {
  confirmed: 'destructive',
  unverified: 'warning',
  reported: 'muted',
  cleared: 'success',
};

interface BrokenLinkEvidenceProps {
  ruleId: string;
  rows: readonly BrokenLinkEvidenceRow[];
  /** True row count when the report cut the list. */
  total?: number | undefined;
  /** Loads every row of a previewed list, so the CSV never holds only the preview. */
  loadAllRows?: (() => Promise<readonly BrokenLinkEvidenceRow[] | null>) | undefined;
}

const UrlLink = ({ url }: { url: string }) => (
  <a
    href={safeExternalHref(url)}
    target="_blank"
    rel="nofollow ugc noopener noreferrer"
    className="inline-flex min-h-6 items-center font-mono text-xs text-primary underline break-all"
  >
    <Bdi>{url}</Bdi>
  </a>
);

function EvidenceRow({ row }: { row: BrokenLinkEvidenceRow }) {
  const { t } = useTranslation('report');
  const result =
    row.status !== null
      ? t('detail.brokenLinks.http', { status: row.status })
      : row.failure
        ? t(`detail.brokenLinks.failure.${row.failure}`)
        : t('detail.brokenLinks.noAnswer');
  return (
    <li className="flex flex-col gap-1 py-2" data-testid="report-broken-link-row">
      <div className="flex flex-wrap items-center gap-2">
        <StatusChip tone={OUTCOME_TONE[row.outcome]} data-testid="report-broken-link-outcome">
          {t(`detail.brokenLinks.outcome.${row.outcome}`)}
        </StatusChip>
        <span className="text-xs text-muted-foreground" data-testid="report-broken-link-result">
          {result}
        </span>
      </div>
      <p className="text-xs text-muted-foreground">
        {t('detail.brokenLinks.linkedFrom')} <UrlLink url={row.source} />
      </p>
      <p className="text-xs text-muted-foreground">
        {t('detail.brokenLinks.pointsTo')} <UrlLink url={row.target} />
      </p>
      {row.finalUrl ? (
        <p className="text-xs text-muted-foreground">
          {t('detail.brokenLinks.redirectsTo')} <UrlLink url={row.finalUrl} />
        </p>
      ) : null}
    </li>
  );
}

/**
 * Source → target pairs of a broken-links finding with what re-requesting each
 * target found. The first 20 rows show; "Show all" reveals the
 * rest; targets that turned out to work are listed apart as dismissed. The CSV
 * button always downloads every row, dismissed ones included.
 */
export const BrokenLinkEvidence = ({ ruleId, rows, total, loadAllRows }: BrokenLinkEvidenceProps) => {
  const { t } = useTranslation('report');
  const listId = useId();
  const dismissedId = useId();
  const [showAll, setShowAll] = useState(false);
  const [showDismissed, setShowDismissed] = useState(false);
  const [downloading, setDownloading] = useState(false);
  const active = rows.filter((row) => row.outcome !== 'cleared');
  const dismissed = rows.filter((row) => row.outcome === 'cleared');
  const visible = showAll ? active : active.slice(0, BROKEN_LINK_ROWS_COLLAPSED);
  const cut = total !== undefined && total > rows.length;

  const download = async () => {
    let all: readonly BrokenLinkEvidenceRow[] | null = rows;
    if (cut && loadAllRows) {
      setDownloading(true);
      all = await loadAllRows();
      setDownloading(false);
    }
    if (!all) return;
    saveBlobAs(
      new Blob([buildBrokenLinkEvidenceCsv({ ruleId, brokenLinkEvidence: all })], {
        type: 'text/csv;charset=utf-8',
      }),
      `${ruleId}-links.csv`,
    );
  };

  return (
    <div className="mb-4" data-testid="report-broken-link-evidence">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="text-sm font-semibold">{t('detail.brokenLinks.title')}</h3>
        <Button
          type="button"
          variant="outline"
          size="sm"
          loading={downloading}
          loadingLabel={t('detail.loadingFullList')}
          onClick={() => void download()}
          data-testid="report-issue-download-urls"
        >
          <Download aria-hidden="true" />
          {t('detail.brokenLinks.download')}
        </Button>
      </div>

      {active.length > 0 ? (
        <>
          <ul id={listId} className="mt-1 divide-y" data-testid="report-broken-link-list">
            {visible.map((row) => (
              <EvidenceRow key={`${row.source}\u0000${row.target}`} row={row} />
            ))}
          </ul>
          {active.length > BROKEN_LINK_ROWS_COLLAPSED ? (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              aria-expanded={showAll}
              aria-controls={listId}
              onClick={() => setShowAll((value) => !value)}
              data-testid="report-broken-link-show-all"
            >
              {showAll
                ? t('detail.brokenLinks.showFewer')
                : t('detail.brokenLinks.showAll', { count: active.length })}
            </Button>
          ) : null}
        </>
      ) : null}

      {dismissed.length > 0 ? (
        <div className="mt-2">
          <Button
            type="button"
            variant="ghost"
            size="sm"
            aria-expanded={showDismissed}
            aria-controls={dismissedId}
            onClick={() => setShowDismissed((value) => !value)}
            data-testid="report-broken-link-dismissed-toggle"
          >
            {t('detail.brokenLinks.dismissedTitle', { count: dismissed.length })}
          </Button>
          {showDismissed ? (
            <div id={dismissedId} data-testid="report-broken-link-dismissed">
              <p className="text-xs text-muted-foreground">{t('detail.brokenLinks.dismissedHelp')}</p>
              <ul className="divide-y">
                {dismissed.map((row) => (
                  <EvidenceRow key={`${row.source}\u0000${row.target}`} row={row} />
                ))}
              </ul>
            </div>
          ) : null}
        </div>
      ) : null}

      {cut ? (
        <p className="mt-1 text-xs text-muted-foreground" data-testid="report-broken-link-cut">
          {t('detail.brokenLinks.cut', { shown: rows.length, total })}
        </p>
      ) : null}
    </div>
  );
};

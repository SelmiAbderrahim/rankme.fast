import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ChevronDown, ChevronRight } from 'lucide-react';
import { Button } from '@shared/ui/button';
import { StatusChip, type StatusTone } from '@shared/ui/status-chip';
import { useAppDispatch, useAppSelector } from '@shared/hooks/redux';
import {
  StateChangeDialog,
  loadActions,
  nextActionsRequestSeq,
  selectAuditActionByRuleId,
  type ActionState,
} from '@features/actions';
import type {
  DiffKind,
  AiVisibilitySection,
  GscSearchSection,
  GscSitemapsSection,
  LocalSeoSection,
  LocalizedFinding,
  PageSpeedSection,
  RuleSeverity,
} from '../types';
import { IssueDetail } from './IssueDetail';
import { presentationRequestIdentity } from '@shared/i18n';

// SPEC-06 status semantics: critical → destructive, warning → warning,
// info → info (soft-tint chips).
const severityTone: Record<RuleSeverity, StatusTone> = {
  critical: 'destructive',
  warning: 'warning',
  info: 'info',
};

export interface IssueRowProps {
  finding: LocalizedFinding;
  ruleDiffKind?: DiffKind | undefined;
  diffByUrl: Map<string, DiffKind>;
  pageSpeed?: PageSpeedSection | null;
  gscSearch?: GscSearchSection | null;
  gscSitemaps?: GscSitemapsSection | null;
  aiVisibility?: AiVisibilitySection | null;
  localSeo?: LocalSeoSection | null;
  siteId?: string;
  /**
   * True when the page shows the site's latest report. Finding decisions are
   * site-level (per rule, not per run), so the controls only render on the
   * latest view — a deep-linked historical run stays read-only.
   */
  isLatestRun?: boolean;
  /** Open the matching detail when an action source link targets this rule. */
  initiallyExpanded?: boolean;
}

/** Stable no-match selector for rows without an action mapping context. */
const selectNoAction = () => null;

export const IssueRow = ({
  finding,
  ruleDiffKind,
  diffByUrl,
  pageSpeed,
  gscSearch,
  gscSitemaps,
  aiVisibility,
  localSeo,
  siteId,
  isLatestRun = false,
  initiallyExpanded = false,
}: IssueRowProps) => {
  const { t } = useTranslation(['report', 'actions']);
  const dispatch = useAppDispatch();
  const [expanded, setExpanded] = useState(initiallyExpanded);
  const affectedCount = finding.affectedUrls.length;

  // Map the ruleId onto its unified action row using the server-supplied
  // identity from the actions list response — the client never re-hashes
  // action ids. Passed findings carry no decision control by
  // contract.
  const mappable =
    Boolean(siteId) && isLatestRun && finding.bucket !== 'passed';
  const actionRef = useAppSelector(
    mappable ? selectAuditActionByRuleId(finding.ruleId) : selectNoAction,
  );
  const [dialogTarget, setDialogTarget] = useState<ActionState | null>(null);

  return (
    <div
      className="rounded-xl border shadow-sm"
      data-testid="report-issue-row"
      data-rule-id={finding.ruleId}
    >
      <button
        type="button"
        onClick={() => setExpanded((v) => !v)}
        aria-expanded={expanded}
        aria-controls={`report-detail-${finding.ruleId}`}
        className="flex w-full items-center gap-3 rounded-xl bg-card px-4 py-3 text-start hover:bg-accent/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        {expanded ? (
          <ChevronDown className="size-4 shrink-0" aria-hidden="true" />
        ) : (
          <ChevronRight className="size-4 shrink-0 rtl:rotate-180" aria-hidden="true" />
        )}
        <span className="min-w-0 flex-1">
          <span className="block font-medium">{finding.copy.title}</span>
          <span className="text-muted-foreground block text-xs">
            {finding.bucket === 'passed'
              ? t('row.passedSummary')
              : affectedCount === 1
                ? t('row.affectedPagesOne')
                : affectedCount > 1
                  ? t('row.affectedPages', { count: affectedCount })
                  : t('row.siteWide')}
          </span>
        </span>
        <span className="flex shrink-0 items-center gap-2">
          {ruleDiffKind === 'fixed' ? (
            <StatusChip tone="success" data-testid="report-badge-fixed">
              {t('badges.fixed')}
            </StatusChip>
          ) : null}
          {ruleDiffKind === 'regressed' ? (
            <StatusChip tone="destructive" data-testid="report-badge-regressed">
              {t('badges.regressed')}
            </StatusChip>
          ) : null}
          <StatusChip
            tone={severityTone[finding.severity]}
            data-testid={`report-badge-severity-${finding.severity}`}
          >
            {t(`severity.${finding.severity}`)}
          </StatusChip>
        </span>
      </button>
      {actionRef && siteId ? (
        <div className="flex flex-wrap items-center gap-2 border-t px-4 py-2">
          {actionRef.state === 'dismissed' ? (
            <>
              <StatusChip tone="muted" data-testid="report-finding-dismissed">
                {t('actions:report.dismissedLabel')}
              </StatusChip>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={() => setDialogTarget('open')}
                data-testid="report-finding-reopen"
              >
                {t('actions:report.reopenCta')}
              </Button>
            </>
          ) : actionRef.state === 'completed' ? (
            <>
              {/* A later audit still reports this rule — the fix claim did
                  not hold, or the problem came back. */}
              {actionRef.reappearedAfterFix ? (
                <StatusChip
                  tone="destructive"
                  data-testid="report-finding-reappeared"
                >
                  {t('actions:report.reappearedLabel')}
                </StatusChip>
              ) : (
                <StatusChip tone="success" data-testid="report-finding-fixed">
                  {t('actions:report.fixedLabel')}
                </StatusChip>
              )}
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={() => setDialogTarget('open')}
                data-testid="report-finding-reopen"
              >
                {t('actions:report.reopenCta')}
              </Button>
            </>
          ) : (
            <>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={() => setDialogTarget('completed')}
                data-testid="report-finding-fix"
              >
                {t('actions:report.fixCta')}
              </Button>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={() => setDialogTarget('dismissed')}
                data-testid="report-finding-dismiss"
              >
                {t('actions:report.dismissCta')}
              </Button>
            </>
          )}
          {dialogTarget ? (
            <StateChangeDialog
              open
              onOpenChange={(open) => {
                if (!open) setDialogTarget(null);
              }}
              siteId={siteId}
              actionId={actionRef.id}
              actionTitle={finding.copy.title}
              targetState={dialogTarget}
              expectedVersion={actionRef.version}
              onConflictReload={() =>
                void dispatch(
                  loadActions({
                    siteId,
                    filters: { source: ['audit_finding'] },
                    requestSeq: nextActionsRequestSeq(),
                    ...presentationRequestIdentity(),
                  }),
                )
              }
            />
          ) : null}
        </div>
      ) : null}
      {expanded ? (
        <div id={`report-detail-${finding.ruleId}`}>
          <IssueDetail
            finding={finding}
            diffByUrl={diffByUrl}
            pageSpeed={pageSpeed}
            gscSearch={gscSearch}
            gscSitemaps={gscSitemaps}
            aiVisibility={aiVisibility}
            localSeo={localSeo}
            siteId={siteId}
            isLatestRun={isLatestRun}
          />
        </div>
      ) : null}
    </div>
  );
};

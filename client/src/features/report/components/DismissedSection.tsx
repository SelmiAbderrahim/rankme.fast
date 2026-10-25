/**
 * The one "Dismissed" section of a report.
 *
 * Every dismissed Fix-now / Watch finding sits here, on the latest report and
 * on a pinned run alike, with who dismissed it, when and why, whether the
 * newest audit still detects it, a targeted re-check of its URLs where one
 * can prove the dismissal right or wrong, and Restore.
 */
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Alert, AlertDescription } from '@shared/ui/alert';
import { Button } from '@shared/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@shared/ui/dialog';
import { Skeleton } from '@shared/ui/skeleton';
import { Bdi } from '@shared/components/Bdi';
import { useAppDispatch, useAppSelector } from '@shared/hooks/redux';
import { formatAbsoluteDate } from '@shared/lib/datetime';
import { presentationRequestIdentity } from '@shared/i18n';
import {
  StateChangeDialog,
  loadActions,
  nextActionsRequestSeq,
  selectAuditActionByRuleId,
} from '@features/actions';
import { fetchFindingRecheckPreviewRequest, runFindingRecheckRequest } from '../api';
import { reportErrorMessage } from '../errorMessage';
import type { FindingRecheck, FindingRecheckPreview, LocalizedFinding } from '../types';

interface DismissedSectionProps {
  findings: LocalizedFinding[];
  siteId: string;
  runId: string;
}

export const DismissedSection = ({ findings, siteId, runId }: DismissedSectionProps) => {
  const { t } = useTranslation('report');
  return (
    <section
      aria-labelledby="report-dismissed-title"
      className="flex flex-col gap-3"
      data-testid="report-dismissed"
    >
      <div>
        <h3 id="report-dismissed-title" className="text-sm font-semibold">
          {t('dismissed.title', { count: findings.length })}
        </h3>
        <p className="text-muted-foreground text-sm">{t('dismissed.description')}</p>
      </div>
      <ul className="flex flex-col gap-3">
        {findings.map((finding) => (
          <DismissedRow key={finding.ruleId} finding={finding} siteId={siteId} runId={runId} />
        ))}
      </ul>
    </section>
  );
};

const DismissedRow = ({
  finding,
  siteId,
  runId,
}: {
  finding: LocalizedFinding;
  siteId: string;
  runId: string;
}) => {
  const { t, i18n } = useTranslation(['report', 'actions']);
  const dispatch = useAppDispatch();
  const actionRef = useAppSelector(selectAuditActionByRuleId(finding.ruleId));
  const [restoreOpen, setRestoreOpen] = useState(false);
  const [recheckOpen, setRecheckOpen] = useState(false);
  const decision = finding.decision?.state === 'dismissed' ? finding.decision : null;
  const [recheck, setRecheck] = useState<FindingRecheck | null>(decision?.recheck ?? null);
  const date = (iso: string) => formatAbsoluteDate(iso, i18n.language);

  return (
    <li
      className="bg-card flex flex-col gap-2 rounded-xl border p-4"
      data-testid="report-dismissed-row"
      data-rule-id={finding.ruleId}
    >
      <p className="font-medium">
        <Bdi>{finding.copy.title}</Bdi>
      </p>
      <p className="text-muted-foreground text-sm" data-testid="report-dismissed-by">
        {!decision
          ? t('dismissed.justNow')
          : decision.decidedBy
            ? t('dismissed.byOn', { name: decision.decidedBy, date: date(decision.decidedAt) })
            : t('dismissed.on', { date: date(decision.decidedAt) })}
      </p>
      {decision?.reason ? (
        <p className="text-sm" data-testid="report-dismissed-reason">
          {t('dismissed.reason', { reason: t(`actions:stateDialog.reasons.${decision.reason}`) })}
        </p>
      ) : null}
      {decision?.latest ? (
        <p className="text-sm" data-testid="report-dismissed-latest">
          {decision.latest.detected
            ? t('dismissed.stillDetected', { count: decision.latest.affectedCount })
            : t('dismissed.notDetected')}
        </p>
      ) : null}
      {recheck ? (
        <p className="text-sm" data-testid="report-dismissed-recheck-result" aria-live="polite">
          {t('dismissed.recheckResult', {
            date: date(recheck.checkedAt),
            checked: recheck.checked,
            stillFailing: recheck.stillFailing,
            cleared: recheck.cleared,
            unverified: recheck.unverified,
          })}
        </p>
      ) : null}
      {decision && !decision.recheckable ? (
        <p className="text-muted-foreground text-xs" data-testid="report-dismissed-recheck-by-audit">
          {t('dismissed.recheckByAudit')}
        </p>
      ) : null}
      <div className="flex flex-wrap items-center gap-2">
        {decision?.recheckable ? (
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => setRecheckOpen(true)}
            data-testid="report-dismissed-recheck"
          >
            {t('dismissed.recheckCta')}
          </Button>
        ) : null}
        {actionRef ? (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={() => setRestoreOpen(true)}
            data-testid="report-dismissed-restore"
          >
            {t('dismissed.restoreCta')}
          </Button>
        ) : null}
      </div>
      {recheckOpen ? (
        <RecheckDialog
          runId={runId}
          ruleId={finding.ruleId}
          title={finding.copy.title}
          onOpenChange={setRecheckOpen}
          onDone={(result) => {
            setRecheck(result);
            setRecheckOpen(false);
          }}
        />
      ) : null}
      {actionRef ? (
        <StateChangeDialog
          open={restoreOpen}
          onOpenChange={setRestoreOpen}
          siteId={siteId}
          actionId={actionRef.id}
          actionTitle={finding.copy.title}
          targetState="open"
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
    </li>
  );
};

/**
 * Preview first (how many URLs it requests), then the re-check itself.
 * Nothing is requested until the user confirms.
 */
const RecheckDialog = ({
  runId,
  ruleId,
  title,
  onOpenChange,
  onDone,
}: {
  runId: string;
  ruleId: string;
  title: string;
  onOpenChange: (open: boolean) => void;
  onDone: (result: FindingRecheck) => void;
}) => {
  const { t } = useTranslation('report');
  const [preview, setPreview] = useState<FindingRecheckPreview | null>(null);
  const [error, setError] = useState('');
  const [running, setRunning] = useState(false);

  useEffect(() => {
    let active = true;
    fetchFindingRecheckPreviewRequest(runId, ruleId).then(
      (next) => {
        if (active) setPreview(next);
      },
      (err: unknown) => {
        if (active) setError(reportErrorMessage(err, 'report:dismissed.recheckFailed'));
      },
    );
    return () => {
      active = false;
    };
  }, [ruleId, runId]);

  const confirm = async () => {
    setRunning(true);
    setError('');
    try {
      onDone((await runFindingRecheckRequest(runId, ruleId)).recheck);
    } catch (err) {
      setError(reportErrorMessage(err, 'report:dismissed.recheckFailed'));
      setRunning(false);
    }
  };

  return (
    <Dialog open onOpenChange={onOpenChange}>
      <DialogContent data-testid="report-recheck-dialog">
        <DialogHeader>
          <DialogTitle>{t('dismissed.recheckTitle')}</DialogTitle>
          <DialogDescription>
            <Bdi>{title}</Bdi>
          </DialogDescription>
        </DialogHeader>
        {preview ? (
          <div className="flex flex-col gap-1 text-sm" data-testid="report-recheck-preview">
            <p>{t('dismissed.recheckUrls', { urls: preview.urlCount, total: preview.totalUrls })}</p>
            <p className="text-muted-foreground">{t('dismissed.recheckNote')}</p>
          </div>
        ) : error ? null : (
          <Skeleton className="h-10 w-full" data-testid="report-recheck-preview-loading" />
        )}
        {error ? (
          <Alert variant="destructive" role="alert" data-testid="report-recheck-error">
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        ) : null}
        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)} disabled={running}>
            {t('common:cancel')}
          </Button>
          <Button
            type="button"
            onClick={() => void confirm()}
            loading={running}
            loadingLabel={t('dismissed.recheckRunning')}
            disabled={preview === null}
            data-testid="report-recheck-confirm"
          >
            {t('dismissed.recheckConfirm')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};

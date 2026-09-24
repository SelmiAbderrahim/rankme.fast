/**
 * Dismiss-cluster confirmation dialog. Dismissals are
 * terminal on the append-only decision log — the copy says so before the
 * user confirms. Same reserved-once idempotency key contract as accept; a
 * 409 (someone accepted it meanwhile, or a replay with a different kind)
 * closes the dialog and lets the parent refresh the cluster state.
 */
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@shared/ui/dialog';
import { Button } from '@shared/ui/button';
import { useAppDispatch, useAppSelector } from '@shared/hooks/redux';
import { decideCluster } from '../store/thunks';
import { selectClusterDecision } from '../store/selectors';
import { newIdempotencyKey } from './AcceptClusterDialog';
import type { ClusterResult } from '../types';

interface DismissClusterDialogProps {
  runId: string;
  cluster: ClusterResult;
  onClose: () => void;
  /** Called after a 409 so the parent can refetch the run's decisions. */
  onConflict: () => void;
}

export const DismissClusterDialog = ({
  runId,
  cluster,
  onClose,
  onConflict,
}: DismissClusterDialogProps) => {
  const { t } = useTranslation();
  const dispatch = useAppDispatch();
  const decision = useAppSelector(selectClusterDecision(runId, cluster.clusterId));
  const [idempotencyKey] = useState(newIdempotencyKey);

  const pending = Boolean(decision?.pending);
  const alreadyDismissed =
    decision?.result != null && decision.result.kind === 'dismissed';

  const onConfirm = async () => {
    const action = await dispatch(
      decideCluster({
        runId,
        clusterId: cluster.clusterId,
        kind: 'dismissed',
        idempotencyKey,
      }),
    );
    if (decideCluster.fulfilled.match(action)) {
      toast.success(t('keywordResearch:clusters.dismissSuccess'));
      onClose();
    } else if (
      decideCluster.rejected.match(action) &&
      action.payload?.status === 409
    ) {
      onConflict();
      onClose();
    }
  };

  return (
    <Dialog open onOpenChange={(v) => (!v ? onClose() : undefined)}>
      <DialogContent data-testid="kw-dismiss-dialog">
        <DialogHeader>
          <DialogTitle>{t('keywordResearch:clusters.dismissTitle')}</DialogTitle>
          <DialogDescription>
            {t('keywordResearch:clusters.dismissBody')}
          </DialogDescription>
        </DialogHeader>
        <p className="break-words text-sm">
          <strong>{t('keywordResearch:clusters.clusterLabel')}: </strong>
          {cluster.label}
        </p>
        {alreadyDismissed ? (
          <p
            className="text-muted-foreground text-xs"
            data-testid="kw-dismiss-replay-hint"
          >
            {t('keywordResearch:clusters.dismissReplayHint')}
          </p>
        ) : null}
        {decision?.error && !decision.conflict ? (
          <p
            role="alert"
            className="text-destructive text-xs"
            data-testid="kw-dismiss-error"
          >
            {decision.error}
          </p>
        ) : null}
        <DialogFooter>
          <Button variant="outline" type="button" onClick={onClose}>
            {t('keywordResearch:clusters.cancel')}
          </Button>
          <Button
            type="button"
            variant="destructive"
            onClick={onConfirm}
            disabled={pending || alreadyDismissed}
            loading={pending}
            loadingLabel={t('keywordResearch:clusters.submitting')}
            data-testid="kw-dismiss-confirm"
          >
            {t('keywordResearch:clusters.dismissConfirm')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};

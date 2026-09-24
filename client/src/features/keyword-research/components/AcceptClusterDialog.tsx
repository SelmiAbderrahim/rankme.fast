/**
 * Accept-cluster dialog.
 *
 * Owned-site picker via the sites feature public API; the idempotency key is
 * reserved ONCE per dialog open so re-clicks replay the same decision (the
 * server dedupes on account+run+cluster+key). On success the dialog offers
 * the two shipped deep links:
 *   - the created Content Intelligence recommendation —
 *     `/sites/<siteId>?tab=content&recommendation=<recommendationId>`
 *     (the shipped CI link format; `tab=content`, NOT `tab=content-intelligence`);
 *   - the generic Next Actions tab — `/sites/<siteId>?tab=actions`.
 * The decision response carries no per-action id, so no per-action deep link
 * is fabricated. A 409 closes the dialog and lets the parent refresh.
 */
import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
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
import { cn } from '@shared/lib/utils';
import { useAppDispatch, useAppSelector } from '@shared/hooks/redux';
import {
  loadSites,
  selectSites,
  selectSitesLoaded,
  selectSitesLoading,
} from '@features/sites';
import { decideCluster } from '../store/thunks';
import { selectClusterDecision } from '../store/selectors';
import type { ClusterResult } from '../types';

export function newIdempotencyKey(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  // Test/SSR fallback — namespaced so it never collides with a UUID.
  return `ik-${Math.random().toString(36).slice(2)}-${Date.now().toString(36)}`;
}

interface AcceptClusterDialogProps {
  runId: string;
  cluster: ClusterResult;
  onClose: () => void;
  /** Called after a 409 so the parent can refetch the run's decisions. */
  onConflict: () => void;
}

export const AcceptClusterDialog = ({
  runId,
  cluster,
  onClose,
  onConflict,
}: AcceptClusterDialogProps) => {
  const { t } = useTranslation();
  const dispatch = useAppDispatch();
  const navigate = useNavigate();

  const sites = useAppSelector(selectSites);
  const sitesLoading = useAppSelector(selectSitesLoading);
  const sitesLoaded = useAppSelector(selectSitesLoaded);
  const decision = useAppSelector(selectClusterDecision(runId, cluster.clusterId));

  const [siteId, setSiteId] = useState<string | null>(null);
  // Reserved once per dialog open — idempotent replay contract.
  const [idempotencyKey] = useState(newIdempotencyKey);

  useEffect(() => {
    if (sitesLoaded || sitesLoading) return;
    void dispatch(loadSites({ direction: 'initial' }));
  }, [dispatch, sitesLoaded, sitesLoading]);

  const terminal =
    decision?.result && decision.result.kind === 'accepted'
      ? decision.result
      : null;
  const pending = Boolean(decision?.pending);

  const onConfirm = async () => {
    if (!siteId) return;
    const action = await dispatch(
      decideCluster({
        runId,
        clusterId: cluster.clusterId,
        kind: 'accepted',
        siteId,
        idempotencyKey,
      }),
    );
    if (decideCluster.fulfilled.match(action)) {
      toast.success(t('keywordResearch:clusters.acceptSuccess'));
    } else if (
      decideCluster.rejected.match(action) &&
      action.payload?.status === 409
    ) {
      onConflict();
      onClose();
    }
  };

  const openRecommendation = () => {
    if (!terminal?.siteId || !terminal.recommendationId) return;
    navigate(
      `/sites/${encodeURIComponent(terminal.siteId)}?tab=content&recommendation=${encodeURIComponent(terminal.recommendationId)}`,
    );
    onClose();
  };

  const openActions = () => {
    if (!terminal?.siteId) return;
    navigate(`/sites/${encodeURIComponent(terminal.siteId)}?tab=actions`);
    onClose();
  };

  return (
    <Dialog open onOpenChange={(v) => (!v ? onClose() : undefined)}>
      <DialogContent data-testid="kw-accept-dialog">
        <DialogHeader>
          <DialogTitle>{t('keywordResearch:clusters.acceptTitle')}</DialogTitle>
          <DialogDescription>
            {t('keywordResearch:clusters.acceptBody')}
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-col gap-3 text-sm">
          <p className="break-words">
            <strong>{t('keywordResearch:clusters.clusterLabel')}: </strong>
            {cluster.label}
          </p>

          {terminal ? (
            <p
              className="text-muted-foreground text-xs"
              data-testid="kw-accept-replay-hint"
            >
              {t('keywordResearch:clusters.replayHint')}
            </p>
          ) : (
            <fieldset className="flex flex-col gap-2">
              <legend className="mb-1 text-sm font-medium">
                {t('keywordResearch:clusters.sitePickerLabel')}
              </legend>
              {sitesLoading && sites.length === 0 ? (
                <p
                  className="text-muted-foreground text-xs"
                  aria-live="polite"
                  data-testid="kw-accept-sites-loading"
                >
                  {t('keywordResearch:clusters.sitesLoading')}
                </p>
              ) : sites.length === 0 ? (
                <p
                  className="text-muted-foreground text-xs"
                  data-testid="kw-accept-sites-empty"
                >
                  {t('keywordResearch:clusters.sitesEmpty')}
                </p>
              ) : (
                sites.map((site) => {
                  const selected = siteId === site.id;
                  return (
                    <label
                      key={site.id}
                      className={cn(
                        'border-border flex cursor-pointer items-center gap-2 rounded-md border px-3 py-2',
                        selected && 'border-primary',
                      )}
                    >
                      <input
                        type="radio"
                        name="kw-accept-site"
                        value={site.id}
                        checked={selected}
                        onChange={() => setSiteId(site.id)}
                        data-testid={`kw-accept-site-${site.id}`}
                      />
                      <span className="flex flex-col">
                        <span className="font-medium">{site.displayName}</span>
                        <span className="text-muted-foreground text-xs">
                          {site.domain}
                        </span>
                      </span>
                    </label>
                  );
                })
              )}
            </fieldset>
          )}

          {decision?.error && !decision.conflict ? (
            <p
              role="alert"
              className="text-destructive text-xs"
              data-testid="kw-accept-error"
            >
              {decision.error}
            </p>
          ) : null}
        </div>

        <DialogFooter>
          <Button variant="outline" type="button" onClick={onClose}>
            {t('keywordResearch:clusters.cancel')}
          </Button>
          {terminal ? (
            <>
              <Button
                type="button"
                variant="outline"
                onClick={openActions}
                data-testid="kw-accept-open-actions"
              >
                {t('keywordResearch:clusters.openActions')}
              </Button>
              <Button
                type="button"
                onClick={openRecommendation}
                data-testid="kw-accept-open-recommendation"
              >
                {t('keywordResearch:clusters.openRecommendation')}
              </Button>
            </>
          ) : (
            <Button
              type="button"
              onClick={onConfirm}
              disabled={pending || !siteId}
              loading={pending}
              loadingLabel={t('keywordResearch:clusters.submitting')}
              data-testid="kw-accept-confirm"
            >
              {t('keywordResearch:clusters.acceptConfirm')}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};

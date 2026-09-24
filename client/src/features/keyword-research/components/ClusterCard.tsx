/**
 * One AI keyword cluster.
 *
 * Everything shown here is a stored server field: label, `suggestedRoute`
 * (badged and labelled AI interpretation), deterministic confidence with its
 * rationale copy, summed volume, and the expandable member list citing the
 * stored member refs (keyword, source, observedAt) the cluster was built
 * from. The client never authors evidence, confidence, or order.
 */
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ChevronDown, ChevronRight } from 'lucide-react';
import { Button } from '@shared/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@shared/ui/card';
import { StatusChip, type StatusTone } from '@shared/ui/status-chip';
import { keywordSlug } from './KeywordResearchPanel';
import { ProvenanceKindChip } from './ProvenanceBadge';
import type {
  ClusterConfidence,
  ClusterDecisionState,
  ClusterResult,
  ClusterRun,
} from '../types';

const CONFIDENCE_TONE: Record<ClusterConfidence, StatusTone> = {
  low: 'muted',
  medium: 'warning',
  high: 'success',
};

interface ClusterCardProps {
  run: ClusterRun;
  cluster: ClusterResult;
  decision: ClusterDecisionState | undefined;
  onAccept: () => void;
  onDismiss: () => void;
}

export const ClusterCard = ({
  run,
  cluster,
  decision,
  onAccept,
  onDismiss,
}: ClusterCardProps) => {
  const { t, i18n } = useTranslation();
  const [expanded, setExpanded] = useState(false);

  const refByKeyword = new Map(run.memberRefs.map((ref) => [ref.keyword, ref]));
  const decided = decision?.result ?? null;
  const formatVolume = (v: number): string =>
    new Intl.NumberFormat(i18n.language).format(v);
  const formatDate = (iso: string): string =>
    new Intl.DateTimeFormat(i18n.language, { dateStyle: 'medium' }).format(
      new Date(iso),
    );

  return (
    <Card data-testid={`kw-cluster-card-${cluster.clusterId}`}>
      <CardHeader className="flex flex-col gap-2">
        <CardTitle className="text-base break-words">{cluster.label}</CardTitle>
        <div className="flex flex-wrap items-center gap-2">
          <StatusChip
            tone="primary"
            data-testid={`kw-cluster-route-${cluster.clusterId}`}
          >
            {t(`keywordResearch:clusters.route.${cluster.suggestedRoute}`)}
          </StatusChip>
          <ProvenanceKindChip kind="ai_interpretation" />
          <StatusChip
            tone={CONFIDENCE_TONE[cluster.confidence]}
            data-testid={`kw-cluster-confidence-${cluster.clusterId}`}
          >
            {t(`keywordResearch:clusters.confidence.${cluster.confidence}`)}
          </StatusChip>
          {decided ? (
            <StatusChip
              tone={decided.kind === 'accepted' ? 'success' : 'muted'}
              data-testid={`kw-cluster-decision-${cluster.clusterId}`}
            >
              {decided.kind === 'accepted'
                ? t('keywordResearch:decision.acceptedLabel')
                : t('keywordResearch:decision.dismissedLabel')}
            </StatusChip>
          ) : null}
        </div>
        <p className="text-muted-foreground text-xs">
          {t('keywordResearch:clusters.confidenceNote')}
        </p>
      </CardHeader>
      <CardContent className="flex flex-col gap-3 text-sm">
        <p className="text-muted-foreground" data-testid={`kw-cluster-volume-${cluster.clusterId}`}>
          {t('keywordResearch:clusters.summedVolume', {
            volume: formatVolume(cluster.summedSearchVolume),
          })}
        </p>
        <div>
          <button
            type="button"
            className="inline-flex cursor-pointer items-center gap-1 text-sm font-medium underline-offset-2 hover:underline"
            aria-expanded={expanded}
            onClick={() => setExpanded((v) => !v)}
            data-testid={`kw-cluster-members-toggle-${cluster.clusterId}`}
          >
            {expanded ? (
              <ChevronDown className="size-4" aria-hidden="true" />
            ) : (
              <ChevronRight className="size-4 rtl:rotate-180" aria-hidden="true" />
            )}
            {t('keywordResearch:clusters.membersToggle', {
              count: cluster.memberKeywords.length,
            })}
          </button>
          {expanded ? (
            <ul
              className="mt-2 flex flex-col gap-1.5"
              data-testid={`kw-cluster-members-${cluster.clusterId}`}
            >
              {cluster.memberKeywords.map((keyword) => {
                const ref = refByKeyword.get(keyword);
                return (
                  <li
                    key={keyword}
                    className="border-border rounded-md border px-2.5 py-1.5 text-xs"
                    data-testid={`kw-cluster-member-${cluster.clusterId}-${keywordSlug(keyword)}`}
                  >
                    <span className="font-medium break-words">{keyword}</span>
                    {ref ? (
                      <span className="text-muted-foreground ms-2">
                        {t(`keywordResearch:clusters.memberSource.${ref.source}`)}{' '}
                        ·{' '}
                        {t('keywordResearch:provenance.observedAt', {
                          time: formatDate(ref.observedAt),
                        })}
                      </span>
                    ) : null}
                  </li>
                );
              })}
            </ul>
          ) : null}
        </div>
        {decision?.conflict ? (
          <p
            role="alert"
            className="text-destructive text-xs"
            data-testid={`kw-cluster-conflict-${cluster.clusterId}`}
          >
            {t('keywordResearch:errors.decisionConflict')}{' '}
            {t('keywordResearch:decision.conflictHelp')}
          </p>
        ) : null}
        {!decided ? (
          <div className="flex gap-2">
            <Button
              size="sm"
              onClick={onAccept}
              disabled={Boolean(decision?.pending)}
              data-testid={`kw-cluster-accept-${cluster.clusterId}`}
            >
              {t('keywordResearch:clusters.accept')}
            </Button>
            <Button
              size="sm"
              variant="outline"
              onClick={onDismiss}
              disabled={Boolean(decision?.pending)}
              data-testid={`kw-cluster-dismiss-${cluster.clusterId}`}
            >
              {t('keywordResearch:clusters.dismiss')}
            </Button>
          </div>
        ) : null}
      </CardContent>
    </Card>
  );
};

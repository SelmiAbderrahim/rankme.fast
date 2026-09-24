import { Sparkles } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Badge } from '@shared/ui/badge';
import { Button } from '@shared/ui/button';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@shared/ui/table';
import { TableHeaderHelp } from '@shared/ui/table-header-help';
import type { KeywordCluster } from '../types';

interface ClusterListProps {
  clusters: readonly KeywordCluster[];
  openClusterId: string | null;
  onToggle: (clusterId: string | null) => void;
}

/**
 * Keywords, URLs, and AI labels are rendered as React text nodes only. No
 * suggestion URL becomes an `<a>` — a stored SERP URL is evidence, not a
 * destination this product endorses.
 */
export const ClusterList = ({ clusters, openClusterId, onToggle }: ClusterListProps) => {
  const { t } = useTranslation('keywordClusters');

  return (
    <ul className="space-y-4" data-testid="keyword-clusters-list">
      {clusters.map((cluster) => {
        const open = openClusterId === cluster.id;
        return (
          <li
            key={cluster.id}
            className="border-border space-y-3 border p-4"
            data-testid={`keyword-cluster-${cluster.id}`}
          >
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div className="space-y-1">
                <div className="flex flex-wrap items-center gap-2">
                  <h3 className="text-base font-semibold">
                    {cluster.label ?? t('cluster.unlabeled')}
                  </h3>
                  {cluster.labelSource === 'ai' ? (
                    <Badge
                      variant="outline"
                      className="gap-1"
                      data-testid={`keyword-cluster-label-suggestion-${cluster.id}`}
                    >
                      <Sparkles className="size-3" aria-hidden="true" />
                      {t('cluster.aiSuggestion')}
                    </Badge>
                  ) : null}
                  <Badge variant="outline">
                    {cluster.size > 1
                      ? t('cluster.grouped', { count: cluster.size })
                      : t('cluster.singleton')}
                  </Badge>
                </div>
                <p className="text-muted-foreground text-sm">
                  {cluster.sharedUrls.length > 0
                    ? t('cluster.commonCore', { count: cluster.sharedUrls.length })
                    : t('cluster.noCommonCore')}
                </p>
              </div>
              <Button
                type="button"
                variant="outline"
                size="sm"
                aria-expanded={open}
                onClick={() => onToggle(open ? null : cluster.id)}
                data-testid={`keyword-cluster-toggle-${cluster.id}`}
              >
                {open ? t('cluster.hideEvidence') : t('cluster.showEvidence')}
              </Button>
            </div>

            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead scope="col">{t('cluster.columns.keyword')}</TableHead>
                  <TableHead scope="col">{t('cluster.columns.observedAt')}</TableHead>
                  <TableHead scope="col">
                    <TableHeaderHelp
                      label={t('cluster.columns.sharedUrls')}
                      description={t('common:tableHelp.sharedUrls')}
                    />
                  </TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {cluster.members.map((member) => (
                  <TableRow
                    key={member.keywordId}
                    data-testid={`keyword-cluster-member-${member.keywordId}`}
                  >
                    <TableHead scope="row" className="whitespace-normal font-medium">
                      {member.phrase}
                      {member.isPivot ? (
                        <Badge variant="outline" className="ms-2">
                          {t('cluster.pivot')}
                        </Badge>
                      ) : null}
                    </TableHead>
                    <TableCell className="whitespace-normal">{member.observedAt}</TableCell>
                    <TableCell className="whitespace-normal">
                      {member.isPivot
                        ? t('cluster.pivotWindow', { count: member.sharedUrlCount })
                        : t('cluster.sharedWithPivot', {
                            count: member.sharedUrlCount,
                          })}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>

            {open ? (
              <div
                className="bg-muted/40 border-border space-y-3 border p-3"
                data-testid={`keyword-cluster-evidence-${cluster.id}`}
              >
                <div>
                  <h4 className="text-sm font-semibold">{t('cluster.evidenceTitle')}</h4>
                  <p className="text-muted-foreground text-xs">
                    {t('cluster.evidenceBody', {
                      window: cluster.members[0]?.sharedUrlCount ?? 0,
                    })}
                  </p>
                </div>
                {cluster.members
                  .filter((member) => !member.isPivot)
                  .map((member) => (
                    <div key={member.keywordId} className="space-y-1">
                      <p className="text-sm font-medium">{member.phrase}</p>
                      <ul className="text-muted-foreground space-y-0.5 text-xs">
                        {member.sharedUrls.map((sharedUrl) => (
                          <li key={sharedUrl} className="break-all">
                            {sharedUrl}
                          </li>
                        ))}
                      </ul>
                    </div>
                  ))}
                {cluster.size === 1 ? (
                  <p className="text-muted-foreground text-xs">{t('cluster.singletonEvidence')}</p>
                ) : null}
              </div>
            ) : null}
          </li>
        );
      })}
    </ul>
  );
};

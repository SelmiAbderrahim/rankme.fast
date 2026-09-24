import { useTranslation } from 'react-i18next';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@shared/ui/card';
import { Badge } from '@shared/ui/badge';
import { Empty, EmptyContent, EmptyDescription, EmptyMedia, EmptyTitle } from '@shared/ui/empty';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@shared/ui/table';
import type { InventoryTopicCluster } from '../../types';

interface ClusterViewProps {
  clusters: InventoryTopicCluster[];
}

/**
 * Topic clusters, rendered as an accessible data table (label · page count ·
 * shared terms). All URLs and terms are crawled/derived text — rendered as
 * React text nodes only (SEC-OUT / output-encoding).
 */
export function ClusterView({ clusters }: ClusterViewProps) {
  const { t } = useTranslation('contentIntelligence');
  return (
    <Card data-testid="inventory-clusters">
      <CardHeader>
        <CardTitle>{t('inventory.findings.clusters.title')}</CardTitle>
        <CardDescription>{t('inventory.findings.clusters.description')}</CardDescription>
      </CardHeader>
      <CardContent>
        {clusters.length === 0 ? (
          <Empty data-testid="inventory-clusters-empty">
            <EmptyMedia />
            <EmptyContent>
              <EmptyTitle>{t('inventory.findings.clusters.empty')}</EmptyTitle>
              <EmptyDescription>
                {t('inventory.findings.clusters.emptyHint')}
              </EmptyDescription>
            </EmptyContent>
          </Empty>
        ) : (
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{t('inventory.findings.clusters.columns.label')}</TableHead>
                  <TableHead className="text-end">
                    {t('inventory.findings.clusters.columns.pages')}
                  </TableHead>
                  <TableHead>{t('inventory.findings.clusters.columns.terms')}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {clusters.map((cluster) => (
                  <TableRow key={cluster.id} data-testid={`inventory-cluster-${cluster.id}`}>
                    <TableCell className="font-medium">{cluster.label}</TableCell>
                    <TableCell className="text-end tabular-nums">
                      {cluster.urls.length}
                    </TableCell>
                    <TableCell>
                      <div className="flex flex-wrap gap-1">
                        {cluster.sharedTerms.map((term) => (
                          <Badge
                            key={`${cluster.id}-${term}`}
                            variant="outline"
                            className="font-normal"
                          >
                            {term}
                          </Badge>
                        ))}
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

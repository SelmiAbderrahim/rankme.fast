import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@shared/ui/card';
import { Badge } from '@shared/ui/badge';
import { Empty, EmptyContent, EmptyDescription, EmptyMedia, EmptyTitle } from '@shared/ui/empty';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@shared/ui/table';
import { TableHeaderHelp } from '@shared/ui/table-header-help';
import type { InventoryRunPage } from '../../types';

interface InternalLinksTableProps {
  pages: InventoryRunPage[];
}

interface LinkRow {
  url: string;
  inbound: number;
  outbound: number;
  flags: string[];
}

/**
 * Accessible data-table alternative to an internal-link graph. Inbound counts
 * are derived deterministically from every page's same-origin out-links; only
 * out-links that point at another crawled page count toward its inbound total.
 */
export function InternalLinksTable({ pages }: InternalLinksTableProps) {
  const { t } = useTranslation('contentIntelligence');

  const rows = useMemo<LinkRow[]>(() => {
    const known = new Set(pages.map((p) => p.url));
    const inbound = new Map<string, number>();
    for (const page of pages) {
      for (const target of page.facts.internalOutLinks) {
        if (target !== page.url && known.has(target)) {
          inbound.set(target, (inbound.get(target) ?? 0) + 1);
        }
      }
    }
    return pages.map((page) => ({
      url: page.url,
      inbound: inbound.get(page.url) ?? 0,
      outbound: page.facts.internalOutLinks.length,
      flags: page.facts.qualityFlags,
    }));
  }, [pages]);

  return (
    <Card data-testid="inventory-internal-links">
      <CardHeader>
        <CardTitle>{t('inventory.findings.links.title')}</CardTitle>
        <CardDescription>{t('inventory.findings.links.description')}</CardDescription>
      </CardHeader>
      <CardContent>
        {rows.length === 0 ? (
          <Empty data-testid="inventory-links-empty">
            <EmptyMedia />
            <EmptyContent>
              <EmptyTitle>{t('inventory.findings.links.empty')}</EmptyTitle>
              <EmptyDescription>{t('inventory.findings.links.emptyHint')}</EmptyDescription>
            </EmptyContent>
          </Empty>
        ) : (
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{t('inventory.findings.links.columns.page')}</TableHead>
                  <TableHead className="text-end">
                    <TableHeaderHelp
                      label={t('inventory.findings.links.columns.inbound')}
                      description={t('common:tableHelp.inboundLinks')}
                    />
                  </TableHead>
                  <TableHead className="text-end">
                    <TableHeaderHelp
                      label={t('inventory.findings.links.columns.outbound')}
                      description={t('common:tableHelp.outboundLinks')}
                    />
                  </TableHead>
                  <TableHead>
                    <TableHeaderHelp
                      label={t('inventory.findings.links.columns.flags')}
                      description={t('common:tableHelp.contentFlags')}
                    />
                  </TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((row) => (
                  <TableRow key={row.url} data-testid="inventory-link-row">
                    <TableCell className="max-w-[280px] truncate font-medium">{row.url}</TableCell>
                    <TableCell className="text-end tabular-nums">{row.inbound}</TableCell>
                    <TableCell className="text-end tabular-nums">{row.outbound}</TableCell>
                    <TableCell>
                      <div className="flex flex-wrap gap-1">
                        {row.flags.map((flag) => (
                          <Badge
                            key={`${row.url}-${flag}`}
                            variant="secondary"
                            className="font-normal"
                          >
                            {t(`inventory.table.qualityFlags.${flag}`, { defaultValue: flag })}
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

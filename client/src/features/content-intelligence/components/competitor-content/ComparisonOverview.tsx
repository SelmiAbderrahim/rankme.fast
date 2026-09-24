import { useMemo } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@shared/ui/card';
import { Button } from '@shared/ui/button';
import { Badge } from '@shared/ui/badge';
import { Input } from '@shared/ui/input';
import { Label } from '@shared/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@shared/ui/select';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@shared/ui/table';
import { TableHeaderHelp } from '@shared/ui/table-header-help';
import { Empty, EmptyContent, EmptyDescription, EmptyMedia, EmptyTitle } from '@shared/ui/empty';
import type { CompetitorDelta } from '../../types';

interface ComparisonOverviewProps {
  deltas: CompetitorDelta[];
  partialDomains: string[];
}

const ALL = 'all';
const DIMENSIONS = ['all', 'length', 'structure', 'links', 'schema', 'topics'] as const;
type Dimension = (typeof DIMENSIONS)[number];

function matchesDimension(delta: CompetitorDelta, dim: Dimension): boolean {
  switch (dim) {
    case 'length':
      return delta.wordCountDelta > 0;
    case 'structure':
      return delta.headingCountDelta > 0;
    case 'links':
      return delta.internalLinkDelta > 0 || delta.externalLinkDelta > 0;
    case 'schema':
      return delta.missingSchemaTypes.length > 0;
    case 'topics':
      return delta.missingTopics.length > 0;
    default:
      return true;
  }
}

function signed(value: number): string {
  return value > 0 ? `+${value}` : String(value);
}

/**
 * Deterministic per-competitor deltas across the compared dimensions
 * (length / structure / links / schema / topics). The domain text filter and
 * the dimension select persist in the URL search params (url-tab-state). All
 * derived text renders as React text nodes.
 */
export function ComparisonOverview({ deltas, partialDomains }: ComparisonOverviewProps) {
  const { t } = useTranslation('contentIntelligence');
  const [params, setParams] = useSearchParams();

  const domainFilter = params.get('ccDomain') ?? '';
  const rawDim = params.get('ccDim') ?? '';
  const dim: Dimension = (DIMENSIONS as readonly string[]).includes(rawDim)
    ? (rawDim as Dimension)
    : 'all';

  const update = (patch: Record<string, string | null>) => {
    const next = new URLSearchParams(params);
    for (const [key, value] of Object.entries(patch)) {
      if (value === null || value === '') next.delete(key);
      else next.set(key, value);
    }
    setParams(next, { replace: true });
  };

  const filtered = useMemo(() => {
    const needle = domainFilter.toLowerCase();
    return deltas.filter((d) => {
      if (needle && !d.competitorDomain.toLowerCase().includes(needle)) return false;
      if (!matchesDimension(d, dim)) return false;
      return true;
    });
  }, [deltas, domainFilter, dim]);

  const clearFilters = () => update({ ccDomain: null, ccDim: null });

  return (
    <Card data-testid="competitor-comparison">
      <CardHeader>
        <CardTitle>{t('competitorContent.comparison.title')}</CardTitle>
        <CardDescription>{t('competitorContent.comparison.description')}</CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        {partialDomains.length > 0 ? (
          <p className="text-muted-foreground text-sm" data-testid="competitor-partial-domains">
            {t('competitorContent.comparison.partialDomains', {
              domains: partialDomains.join(', '),
            })}
          </p>
        ) : null}

        {deltas.length === 0 ? (
          <Empty data-testid="competitor-comparison-empty">
            <EmptyMedia />
            <EmptyContent>
              <EmptyTitle>{t('competitorContent.comparison.empty')}</EmptyTitle>
              <EmptyDescription>{t('competitorContent.comparison.emptyHint')}</EmptyDescription>
            </EmptyContent>
          </Empty>
        ) : (
          <>
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="competitor-filter-domain">
                  {t('competitorContent.comparison.filters.domain')}
                </Label>
                <Input
                  id="competitor-filter-domain"
                  value={domainFilter}
                  placeholder={t('competitorContent.comparison.filters.domainPlaceholder')}
                  onChange={(e) => update({ ccDomain: e.target.value })}
                  data-testid="competitor-filter-domain"
                />
              </div>
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="competitor-filter-dimension">
                  {t('competitorContent.comparison.filters.dimension')}
                </Label>
                <Select value={dim} onValueChange={(v) => update({ ccDim: v === ALL ? null : v })}>
                  <SelectTrigger
                    id="competitor-filter-dimension"
                    data-testid="competitor-filter-dimension"
                  >
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {DIMENSIONS.map((d) => (
                      <SelectItem key={d} value={d}>
                        {t(`competitorContent.comparison.dimensions.${d}`)}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>

            {filtered.length === 0 ? (
              <div
                className="text-muted-foreground flex flex-col items-start gap-2 py-4 text-sm"
                data-testid="competitor-comparison-nomatch"
              >
                <span>{t('competitorContent.comparison.noMatches')}</span>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={clearFilters}
                  data-testid="competitor-comparison-clear"
                >
                  {t('competitorContent.comparison.clearFilters')}
                </Button>
              </div>
            ) : (
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>{t('competitorContent.comparison.columns.competitor')}</TableHead>
                      <TableHead className="text-end">
                        {t('competitorContent.comparison.columns.words')}
                      </TableHead>
                      <TableHead className="text-end">
                        {t('competitorContent.comparison.columns.headings')}
                      </TableHead>
                      <TableHead className="text-end">
                        {t('competitorContent.comparison.columns.internalLinks')}
                      </TableHead>
                      <TableHead className="text-end">
                        {t('competitorContent.comparison.columns.externalLinks')}
                      </TableHead>
                      <TableHead>
                        <TableHeaderHelp
                          label={t('competitorContent.comparison.columns.missingSchema')}
                          description={t('common:tableHelp.missingSchema')}
                        />
                      </TableHead>
                      <TableHead>
                        <TableHeaderHelp
                          label={t('competitorContent.comparison.columns.missingTopics')}
                          description={t('common:tableHelp.missingTopics')}
                        />
                      </TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {filtered.map((d) => (
                      <TableRow
                        key={d.competitorUrl}
                        data-testid={`competitor-delta-${d.competitorDomain}`}
                      >
                        <TableCell className="max-w-[220px] truncate font-medium">
                          {d.competitorDomain}
                        </TableCell>
                        <TableCell className="text-end tabular-nums">
                          {signed(d.wordCountDelta)}
                        </TableCell>
                        <TableCell className="text-end tabular-nums">
                          {signed(d.headingCountDelta)}
                        </TableCell>
                        <TableCell className="text-end tabular-nums">
                          {signed(d.internalLinkDelta)}
                        </TableCell>
                        <TableCell className="text-end tabular-nums">
                          {signed(d.externalLinkDelta)}
                        </TableCell>
                        <TableCell>
                          <div className="flex flex-wrap gap-1">
                            {d.missingSchemaTypes.length === 0 ? (
                              <span className="text-muted-foreground">—</span>
                            ) : (
                              d.missingSchemaTypes.map((s) => (
                                <Badge
                                  key={`${d.competitorUrl}-schema-${s}`}
                                  variant="secondary"
                                  className="font-normal"
                                >
                                  {s}
                                </Badge>
                              ))
                            )}
                          </div>
                        </TableCell>
                        <TableCell>
                          <div className="flex flex-wrap gap-1">
                            {d.missingTopics.length === 0 ? (
                              <span className="text-muted-foreground">—</span>
                            ) : (
                              d.missingTopics.map((topic) => (
                                <Badge
                                  key={`${d.competitorUrl}-topic-${topic}`}
                                  variant="secondary"
                                  className="font-normal"
                                >
                                  {topic}
                                </Badge>
                              ))
                            )}
                          </div>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            )}
          </>
        )}
      </CardContent>
    </Card>
  );
}

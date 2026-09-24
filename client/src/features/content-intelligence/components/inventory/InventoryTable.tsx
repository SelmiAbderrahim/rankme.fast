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
import type { InventoryRunPage } from '../../types';

interface InventoryTableProps {
  pages: InventoryRunPage[];
}

const PAGE_SIZE = 10;
const ALL = 'all';

/**
 * Per-run owned-page facts, filterable by URL, language, issue (quality flag),
 * and topic — every filter plus the page cursor persisted in the URL search
 * params (url-tab-state). All page text is derived/crawled → rendered as React
 * text nodes only.
 */
export function InventoryTable({ pages }: InventoryTableProps) {
  const { t } = useTranslation('contentIntelligence');
  const [params, setParams] = useSearchParams();

  const urlFilter = params.get('invUrl') ?? '';
  const langFilter = params.get('invLang') ?? '';
  const issueFilter = params.get('invIssue') ?? '';
  const topicFilter = params.get('invTopic') ?? '';
  const pageParam = Math.max(1, Number.parseInt(params.get('invPage') ?? '', 10) || 1);

  const update = (patch: Record<string, string | null>) => {
    const next = new URLSearchParams(params);
    for (const [key, value] of Object.entries(patch)) {
      if (value === null || value === '') next.delete(key);
      else next.set(key, value);
    }
    setParams(next, { replace: true });
  };

  const languages = useMemo(() => {
    const set = new Set<string>();
    for (const page of pages) {
      if (page.facts.language) set.add(page.facts.language);
    }
    return [...set].sort();
  }, [pages]);

  const issues = useMemo(() => {
    const set = new Set<string>();
    for (const page of pages) {
      for (const flag of page.facts.qualityFlags) set.add(flag);
    }
    return [...set].sort();
  }, [pages]);

  const filtered = useMemo(() => {
    const url = urlFilter.toLowerCase();
    const topic = topicFilter.toLowerCase();
    return pages.filter((page) => {
      const f = page.facts;
      if (url && !f.url.toLowerCase().includes(url)) return false;
      if (langFilter && f.language !== langFilter) return false;
      if (issueFilter && !f.qualityFlags.includes(issueFilter as never)) return false;
      if (topic) {
        const joined = [...f.primaryTopics, ...f.secondaryTopics].join(' ').toLowerCase();
        if (!joined.includes(topic)) return false;
      }
      return true;
    });
  }, [pages, urlFilter, langFilter, issueFilter, topicFilter]);

  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const currentPage = Math.min(pageParam, totalPages);
  const start = (currentPage - 1) * PAGE_SIZE;
  const visible = filtered.slice(start, start + PAGE_SIZE);

  const clearFilters = () =>
    update({ invUrl: null, invLang: null, invIssue: null, invTopic: null, invPage: null });

  return (
    <Card data-testid="inventory-table">
      <CardHeader>
        <CardTitle>{t('inventory.table.title')}</CardTitle>
        <CardDescription>{t('inventory.table.description')}</CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        {pages.length === 0 ? (
          <Empty data-testid="inventory-table-empty">
            <EmptyMedia />
            <EmptyContent>
              <EmptyTitle>{t('inventory.table.empty')}</EmptyTitle>
              <EmptyDescription>{t('inventory.table.emptyHint')}</EmptyDescription>
            </EmptyContent>
          </Empty>
        ) : (
          <>
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="inventory-filter-url">{t('inventory.table.filters.url')}</Label>
                <Input
                  id="inventory-filter-url"
                  value={urlFilter}
                  placeholder={t('inventory.table.filters.urlPlaceholder')}
                  onChange={(e) => update({ invUrl: e.target.value, invPage: null })}
                  data-testid="inventory-filter-url"
                />
              </div>
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="inventory-filter-topic">{t('inventory.table.filters.topic')}</Label>
                <Input
                  id="inventory-filter-topic"
                  value={topicFilter}
                  placeholder={t('inventory.table.filters.topicPlaceholder')}
                  onChange={(e) => update({ invTopic: e.target.value, invPage: null })}
                  data-testid="inventory-filter-topic"
                />
              </div>
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="inventory-filter-language">
                  {t('inventory.table.filters.language')}
                </Label>
                <Select
                  value={langFilter || ALL}
                  onValueChange={(v) => update({ invLang: v === ALL ? null : v, invPage: null })}
                >
                  <SelectTrigger
                    id="inventory-filter-language"
                    data-testid="inventory-filter-language"
                  >
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value={ALL}>{t('inventory.table.filters.allLanguages')}</SelectItem>
                    {languages.map((lang) => (
                      <SelectItem key={lang} value={lang}>
                        {lang}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="inventory-filter-issue">{t('inventory.table.filters.issue')}</Label>
                <Select
                  value={issueFilter || ALL}
                  onValueChange={(v) => update({ invIssue: v === ALL ? null : v, invPage: null })}
                >
                  <SelectTrigger id="inventory-filter-issue" data-testid="inventory-filter-issue">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value={ALL}>{t('inventory.table.filters.allIssues')}</SelectItem>
                    {issues.map((issue) => (
                      <SelectItem key={issue} value={issue}>
                        {t(`inventory.table.qualityFlags.${issue}`, { defaultValue: issue })}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>

            {filtered.length === 0 ? (
              <div
                className="text-muted-foreground flex flex-col items-start gap-2 py-4 text-sm"
                data-testid="inventory-table-nomatch"
              >
                <span>{t('inventory.table.noMatches')}</span>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={clearFilters}
                  data-testid="inventory-table-clear"
                >
                  {t('inventory.table.clearFilters')}
                </Button>
              </div>
            ) : (
              <>
                <div className="overflow-x-auto">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>{t('inventory.table.columns.url')}</TableHead>
                        <TableHead>{t('inventory.table.columns.language')}</TableHead>
                        <TableHead className="text-end">
                          {t('inventory.table.columns.words')}
                        </TableHead>
                        <TableHead className="text-end">
                          {t('inventory.table.columns.links')}
                        </TableHead>
                        <TableHead>
                          <TableHeaderHelp
                            label={t('inventory.table.columns.topics')}
                            description={t('common:tableHelp.primaryTopics')}
                          />
                        </TableHead>
                        <TableHead>
                          <TableHeaderHelp
                            label={t('inventory.table.columns.flags')}
                            description={t('common:tableHelp.contentFlags')}
                          />
                        </TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {visible.map((page) => (
                        <TableRow key={page.url} data-testid="inventory-page-row">
                          <TableCell className="max-w-[240px] truncate font-medium">
                            {page.facts.url}
                          </TableCell>
                          <TableCell>{page.facts.language ?? '—'}</TableCell>
                          <TableCell className="text-end tabular-nums">
                            {page.facts.wordCount}
                          </TableCell>
                          <TableCell className="text-end tabular-nums">
                            {page.facts.internalLinkCount}
                          </TableCell>
                          <TableCell className="max-w-[200px] truncate">
                            {page.facts.primaryTopics.join(', ')}
                          </TableCell>
                          <TableCell>
                            <div className="flex flex-wrap gap-1">
                              {page.facts.qualityFlags.map((flag) => (
                                <Badge
                                  key={`${page.url}-${flag}`}
                                  variant="secondary"
                                  className="font-normal"
                                >
                                  {t(`inventory.table.qualityFlags.${flag}`, {
                                    defaultValue: flag,
                                  })}
                                </Badge>
                              ))}
                            </div>
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
                <div className="flex items-center justify-between gap-4">
                  <span
                    className="text-muted-foreground text-sm"
                    data-testid="inventory-table-page"
                  >
                    {t('inventory.table.pageOf', { page: currentPage, total: totalPages })}
                  </span>
                  <div className="flex gap-2">
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={currentPage <= 1}
                      onClick={() => update({ invPage: String(currentPage - 1) })}
                      data-testid="inventory-table-prev"
                    >
                      {t('inventory.table.prev')}
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={currentPage >= totalPages}
                      onClick={() => update({ invPage: String(currentPage + 1) })}
                      data-testid="inventory-table-next"
                    >
                      {t('inventory.table.next')}
                    </Button>
                  </div>
                </div>
              </>
            )}
          </>
        )}
      </CardContent>
    </Card>
  );
}

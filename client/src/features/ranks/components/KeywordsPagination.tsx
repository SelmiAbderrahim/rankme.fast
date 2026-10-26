import { ChevronLeft, ChevronRight } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Button } from '@shared/ui/button';
import { Label } from '@shared/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@shared/ui/select';
import { KEYWORD_PAGE_SIZES, type KeywordPageSize } from '../types';
import { keywordPageCount, pageWindow } from '../keywordListParams';

export interface KeywordsPaginationProps {
  page: number;
  pageSize: KeywordPageSize;
  total: number;
  shown: number;
  onPageChange: (page: number) => void;
  onPageSizeChange: (pageSize: KeywordPageSize) => void;
}

export function KeywordsPagination({ page, pageSize, total, shown, onPageChange, onPageSizeChange }: KeywordsPaginationProps) {
  const { t, i18n } = useTranslation('ranks');
  const pageCount = keywordPageCount(total, pageSize);
  const from = shown === 0 ? 0 : (page - 1) * pageSize + 1;
  const to = shown === 0 ? 0 : from + shown - 1;
  const PreviousIcon = i18n.dir() === 'rtl' ? ChevronRight : ChevronLeft;
  const NextIcon = i18n.dir() === 'rtl' ? ChevronLeft : ChevronRight;
  return <nav aria-label={t('keywordList.pagination.label')}
    className="border-border flex flex-col gap-3 border-t pt-4 lg:flex-row lg:items-center lg:justify-between"
    data-testid="keywords-pagination">
    <p className="text-muted-foreground text-sm" data-testid="keywords-pagination-range">
      {t('keywordList.pagination.range', { from, to, total })}
    </p>
    <div className="flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-center">
      <div className="flex items-center gap-2">
        <Label htmlFor="keywords-page-size" className="text-muted-foreground font-normal">
          {t('keywordList.pagination.rowsPerPage')}
        </Label>
        <Select value={String(pageSize)} onValueChange={(next) => onPageSizeChange(Number(next) as KeywordPageSize)}>
          <SelectTrigger id="keywords-page-size" size="sm" className="min-w-20"><SelectValue /></SelectTrigger>
          <SelectContent>{KEYWORD_PAGE_SIZES.map((size) => <SelectItem key={size} value={String(size)}>{size}</SelectItem>)}</SelectContent>
        </Select>
      </div>
      <div className="flex items-center gap-1">
        <Button type="button" variant="outline" size="sm" disabled={page <= 1} onClick={() => onPageChange(page - 1)}>
          <PreviousIcon aria-hidden="true" />{t('keywordList.pagination.previous')}
        </Button>
        <span className="text-muted-foreground px-2 text-sm whitespace-nowrap sm:hidden" aria-current="page">
          {t('keywordList.pagination.pageOf', { page, pages: pageCount })}
        </span>
        <ul className="hidden items-center gap-1 sm:flex">
          {pageWindow(page, pageCount).map((entry, index) => entry === 'gap'
            ? <li key={`gap-${index}`} aria-hidden="true" className="text-muted-foreground px-1 text-sm">…</li>
            : <li key={entry}><Button type="button" variant={entry === page ? 'secondary' : 'ghost'} size="sm"
                className="min-w-8 tabular-nums" aria-current={entry === page ? 'page' : undefined}
                aria-label={t('keywordList.pagination.goToPage', { page: entry })}
                onClick={() => onPageChange(entry)} data-testid={`keywords-page-${entry}`}>
                {new Intl.NumberFormat(i18n.language).format(entry)}
              </Button></li>) }
        </ul>
        <Button type="button" variant="outline" size="sm" disabled={page >= pageCount} onClick={() => onPageChange(page + 1)}>
          {t('keywordList.pagination.next')}<NextIcon aria-hidden="true" />
        </Button>
      </div>
    </div>
  </nav>;
}

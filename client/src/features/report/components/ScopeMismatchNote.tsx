import { useTranslation } from 'react-i18next';
import { Info } from 'lucide-react';
import type { ReportComparison } from '../types';

/**
 * Neutral note shown when this run and the one it compares with crawled a
 * materially different set of pages: page counts then say
 * nothing about better or worse, which is why such findings read "Not
 * comparable" instead of "Regressed" or "Improved".
 */
export function ScopeMismatchNote({ comparison }: { comparison: ReportComparison }) {
  const { t, i18n } = useTranslation('report');
  const format = (value: number) => new Intl.NumberFormat(i18n.language).format(value);
  const { previous, current } = comparison;
  const text =
    previous.pagesCrawled !== null && current.pagesCrawled !== null
      ? t('comparison.scopeNote', {
          previous: format(previous.pagesCrawled),
          current: format(current.pagesCrawled),
        })
      : t('comparison.scopeNoteLimits', {
          previous: format(previous.pageCap),
          current: format(current.pageCap),
        });
  return (
    <p
      role="note"
      className="text-muted-foreground flex items-start gap-2 text-sm"
      data-testid="report-scope-mismatch"
    >
      <Info aria-hidden="true" className="mt-0.5 size-4 shrink-0" />
      <span>{text}</span>
    </p>
  );
}

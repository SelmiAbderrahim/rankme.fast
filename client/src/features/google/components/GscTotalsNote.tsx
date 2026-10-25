/**
 * GscTotalsNote — the ONE inline sentence that explains why Search Console
 * numbers on different views can disagree. Rendered by the Overview, Google
 * and Pages surfaces so the explanation never drifts between them.
 *
 * Why they differ: the site totals add up every day of Search Console's daily
 * data, while the searches, pages, countries and devices tables only add up
 * their own rows (rare searches are left out of the searches list, and a page
 * table counts every page one search showed). All are real Search Console
 * numbers — they just cover different row scopes.
 */
import { useTranslation } from 'react-i18next';
import { cn } from '@shared/lib/utils';

export interface GscTotalsNoteProps {
  className?: string;
  testId?: string;
}

export const GscTotalsNote = ({
  className,
  testId = 'gsc-totals-note',
}: GscTotalsNoteProps) => {
  const { t } = useTranslation('google');
  return (
    <p className={cn('text-muted-foreground text-xs', className)} data-testid={testId}>
      {t('searchSummary.scopeNote')}
    </p>
  );
};
